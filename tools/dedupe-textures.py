#!/usr/bin/env python3
"""Move course textures shared by two or more courses into public/mk64/common/.

Usage: python3 tools/dedupe-textures.py [--dry-run]

Scans every public/mk64/<course>/course.json, hashes each referenced PNG and, for any image whose
bytes appear in more than one course, writes it once as common/gTexture<suffix>.png (course prefix
like gLR/gMR stripped), rewrites the course.json `image` refs to that path and deletes the per-course
copies. src/track.js and tools/build-hd-textures.py treat an image starting with `common/` as
relative to public/mk64 instead of the course folder. Idempotent; extract-course.py runs it after
writing a course so re-extracts don't bring the copies back.
"""
import hashlib, json, os, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'mk64'
COMMON = ROOT / 'common'
PREFIX = re.compile(r'^g[A-Z]{2,3}Texture')


def main(dry_run):
    refs = defaultdict(list)            # sha256 -> [(course, key, image)]
    docs = {}
    for cj in sorted(ROOT.glob('*/course.json')):
        course = cj.parent.name
        if course == 'common':
            continue
        docs[course] = data = json.loads(cj.read_text())
        for key, tex in data['textures'].items():
            img = tex['image']
            path = ROOT / img if img.startswith('common/') else cj.parent / img
            refs[hashlib.sha256(path.read_bytes()).hexdigest()].append((course, key, img))

    shared = {h: v for h, v in refs.items() if len({c for c, _, _ in v}) > 1}
    names = {}
    for h, v in shared.items():
        base = v[0][2].split('/')[-1]
        name = 'common/' + ('g' + PREFIX.sub('Texture', base) if PREFIX.match(base) else base)
        if name in names and names[name] != h:
            sys.exit(f'name collision for {name}: two different textures')
        names[name] = h

    moved = removed = 0
    changed, written = set(), set()
    for name, h in sorted(names.items()):
        dest = ROOT / name
        for course, key, img in shared[h]:
            if img == name:
                continue
            src = ROOT / img if img.startswith('common/') else ROOT / course / img
            if not dest.exists() and name not in written:
                print(f'{course}/{img} -> {name}')
                if not dry_run:
                    COMMON.mkdir(exist_ok=True)
                    dest.write_bytes(src.read_bytes())
                written.add(name)
                moved += 1
            docs[course]['textures'][key]['image'] = name
            changed.add(course)
            if src.exists() and src != dest:
                if not dry_run:
                    src.unlink()
                removed += 1
    if not dry_run:
        for course in changed:
            path = ROOT / course / 'course.json'
            path.write_text(json.dumps(docs[course], separators=(',', ':')) + '\n')
    print(f'{len(shared)} shared textures, {moved} written to common/, {removed} per-course copies removed, '
          f'{len(changed)} course.json updated' + (' (dry run)' if dry_run else ''))


if __name__ == '__main__':
    main('--dry-run' in sys.argv[1:])
