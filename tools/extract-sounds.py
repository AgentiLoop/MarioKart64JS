#!/usr/bin/env python3
"""Extract Mario Kart 64 sounds from a local US ROM (standard library only).

Usage: python3 tools/extract-sounds.py ROM [--out public/mk64/audio]
Layout follows n64decomp/mk64 assets.json and src/audio/load.c: the ctl (audio banks) at 0x966260,
the tbl (VADPCM sample data) at 0x979AA0. Instrument/sound ids come from the sequence 0 sound scripts.
Writes welcome.wav: "Welcome to Mario Kart" (SOUND_INTRO_WELCOME, seq 0 bank 4 sound 9 ->
bank 0 instrument 0x7C, key 39), plus the raw ctl/tbl/seq/bank-set data that src/m64.js plays.
"""
import argparse
import hashlib
from pathlib import Path
import struct
import wave

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'
CTL, TBL = 0x966260, 0x979AA0
OUTPUT_RATE = 26800   # gAudioSessionPresets[].frequency (0x68B0)
BLOBS = (
    ('ctl.bin', CTL, 0x13840),             # audio_banks: instruments, drums, envelopes, ADPCM books
    ('tbl.bin', TBL, 0x24C4C0),            # audio_tables: VADPCM sample data
    ('seq.bin', 0xBC5F60, 0x23170),        # sequences: ALSeqFile header + 30 .m64 sequences
    ('banksets.bin', 0xBE90E0, 0x100),     # instrument_sets: seq id -> bank ids (ALIGN(0x40) after sequences)
)


def table(rom, base):
    count = struct.unpack_from('>H', rom, base + 2)[0]
    return [struct.unpack_from('>II', rom, base + 4 + 8 * i) for i in range(count)]


def vadpcm(data, book, order):
    """Decode N64 VADPCM frames (9 bytes -> 16 samples), as the RSP ADPCM command does."""
    out, hist = [], [0] * 8
    for f in range(len(data) // 9):
        hdr = data[f * 9]
        scale, pred = 1 << (hdr >> 4), hdr & 0xF
        coefs = book[pred]
        for half in range(2):
            ins = []
            for b in data[f * 9 + 1 + half * 4:f * 9 + 5 + half * 4]:
                for n in (b >> 4, b & 0xF):
                    ins.append((n - 16 if n >= 8 else n) * scale)
            cur = []
            for i in range(8):
                acc = ins[i] << 11
                for k in range(order):
                    acc += coefs[k][i] * hist[8 - order + k]
                for j in range(i):
                    acc += coefs[order - 1][i - 1 - j] * ins[j]
                cur.append(max(-32768, min(32767, acc >> 11)))
            out += cur
            hist = cur
    return out


class Bank:
    def __init__(self, rom, bank_id):
        ctl, tbl = table(rom, CTL), table(rom, TBL)
        off, _ = ctl[bank_id]
        self.rom = rom
        self.num_inst, self.num_drums = struct.unpack_from('>II', rom, CTL + off)
        self.base = CTL + off + 0x10
        t_off, t_len = tbl[bank_id]
        if t_len == 0:
            t_off = tbl[t_off][0]
        self.tbl = TBL + t_off

    def u32(self, o):
        return struct.unpack_from('>I', self.rom, self.base + o)[0]

    def instrument(self, inst_id):
        p = self.u32(4 + 4 * inst_id)
        lo, hi = self.rom[self.base + p + 1], self.rom[self.base + p + 2]
        sounds = [struct.unpack_from('>If', self.rom, self.base + p + 8 + 8 * i) for i in range(3)]
        return lo, hi, sounds

    def sound_for_key(self, inst_id, key):
        lo, hi, sounds = self.instrument(inst_id)
        return sounds[0] if key < lo else sounds[2] if key > hi else sounds[1]

    def sample(self, sample_ptr):
        addr, _, book_ptr, size = struct.unpack_from('>IIII', self.rom, self.base + sample_ptr + 4)
        order, npred = struct.unpack_from('>ii', self.rom, self.base + book_ptr)
        flat = struct.unpack_from(f'>{8 * order * npred}h', self.rom, self.base + book_ptr + 8)
        book = [[flat[(p * order + k) * 8:(p * order + k) * 8 + 8] for k in range(order)] for p in range(npred)]
        return vadpcm(self.rom[self.tbl + addr:self.tbl + addr + size], book, order)


def write_wav(path, pcm, rate):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(round(rate))
        w.writeframes(struct.pack(f'<{len(pcm)}h', *pcm))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('rom')
    ap.add_argument('--out', default='public/mk64/audio')
    a = ap.parse_args()
    rom = Path(a.rom).read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (.z64, big-endian)')
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bank = Bank(rom, 0)
    key = 39   # gNoteFrequencies[39] == 1.0
    sample_ptr, tuning = bank.sound_for_key(0x7C, key)
    pcm = bank.sample(sample_ptr)
    write_wav(out / 'welcome.wav', pcm, OUTPUT_RATE * tuning)
    print(f'welcome.wav: {len(pcm)} samples @ {OUTPUT_RATE * tuning:.0f} Hz')
    # Raw sound data for the browser sequencer (src/m64.js), cut at the mk64.ld segments
    for name, start, size in BLOBS:
        (out / name).write_bytes(rom[start:start + size])
        print(f'{name}: {size:#x} bytes')


if __name__ == '__main__':
    main()
