#!/usr/bin/env python3
"""Move duplicated course images into public/mk64/common/.

Usage: python3 tools/dedupe-textures.py [--dry-run]

Scans every JSON file in every public/mk64/<course>/ folder (course.json textures, props.json,
train.json, piranha.json, ...), hashes each referenced PNG and, for any image whose bytes exist
under more than one path (shared by several courses or stored twice in one), writes it once as
common/<name>.png (course prefix like gLR/gMR stripped), rewrites the JSON refs to that path and
deletes the per-course copies. Loaders resolve an image starting with `common/` relative to
public/mk64 instead of the course folder (src/hd.js loadTexture, src/track.js,
tools/build-hd-textures.py). Idempotent; extract-course.py runs it after writing a course so
re-extracts don't bring the copies back.
"""
import hashlib, json, os, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'mk64'
COMMON = ROOT / 'common'
PREFIX = re.compile(r'^g[A-Z]{2,3}Texture')
HEX_NAME = re.compile(r'Texture[0-9A-F]{6}\.png$')


def png_refs(node):
    """Yield (container, key) for every string value ending in .png anywhere in a JSON document."""
    items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
    for key, value in items:
        if isinstance(value, str):
            if value.endswith('.png'):
                yield node, key
        else:
            yield from png_refs(value)


def main(dry_run):
    refs = defaultdict(list)            # sha256 -> [(course, json name, container, key, image)]
    docs = {}                           # (course, json name) -> parsed document
    for cj in sorted(ROOT.glob('*/course.json')):
        course = cj.parent.name
        for jf in sorted(cj.parent.glob('*.json')):
            docs[course, jf.name] = data = json.loads(jf.read_text())
            for container, key in png_refs(data):
                img = container[key]
                path = ROOT / img if img.startswith('common/') else cj.parent / img
                if not path.is_file():
                    continue
                refs[hashlib.sha256(path.read_bytes()).hexdigest()].append((course, jf.name, container, key, img))

    def resolved(course, img):
        return ROOT / img if img.startswith('common/') else ROOT / course / img

    shared = {h: v for h, v in refs.items() if len({resolved(c, i) for c, _, _, _, i in v}) > 1}
    names = {}
    for h, v in shared.items():
        candidates = set()
        for _, _, _, _, img in v:
            base = img.split('/')[-1]
            candidates.add('g' + PREFIX.sub('Texture', base) if PREFIX.match(base) else base)
        name = 'common/' + min(candidates, key=lambda n: (bool(HEX_NAME.search(n)), n))   # prefer descriptive names
        if name in names and names[name] != h:
            sys.exit(f'name collision for {name}: two different textures')
        names[name] = h

    moved = 0
    changed, written, removed = set(), set(), set()
    for name, h in sorted(names.items()):
        dest = ROOT / name
        for course, jname, container, key, img in shared[h]:
            if img == name:
                continue
            src = resolved(course, img)
            if not dest.exists() and name not in written:
                print(f'{course}/{img} -> {name}')
                if not dry_run:
                    COMMON.mkdir(exist_ok=True)
                    dest.write_bytes(src.read_bytes())
                written.add(name)
                moved += 1
            container[key] = name
            changed.add((course, jname))
            if src != dest and src not in removed and src.exists():
                if not dry_run:
                    src.unlink()
                removed.add(src)
    if not dry_run:
        for course, jname in changed:
            (ROOT / course / jname).write_text(json.dumps(docs[course, jname], separators=(',', ':')) + '\n')
    print(f'{len(shared)} shared images, {moved} written to common/, {len(removed)} per-course copies removed, '
          f'{len(changed)} JSON files updated' + (' (dry run)' if dry_run else ''))


if __name__ == '__main__':
    main('--dry-run' in sys.argv[1:])
