#!/usr/bin/env python3
"""Port of n64decomp/mk64 tools/libtkmk00.c tkmk00_decode (standard library only).

Decodes TKMK00 menu background images (blue sky / sunset) from a local US ROM.
Output: 320x240 RGBA PNG with the alpha_colour (usually 0x01) pixels zeroed.
"""
import struct
import zlib


class Tkmk00:
    def __init__(self, data, alpha_color):
        self.tkmk = data
        self.alpha = alpha_color
        self.width = struct.unpack_from('>H', data, 0x8)[0]
        self.height = struct.unpack_from('>H', data, 0xA)[0]
        self.header6 = data[0x6]
        self.rgba_buf = [0xFFFF] * 0x40
        self.buffer80 = [0] * 0x3F
        self.bufferFE = [0] * 0x3F
        self.byte_buffer = [0] * 8
        self.some_ptrs = []
        for i in range(8):
            offset = struct.unpack_from('>I', data, 0xC + i * 4)[0]
            if 0 == (self.header6 & (1 << i)):
                offset -= 4
            self.some_ptrs.append(0xC + i * 4 and offset)  # store absolute offsets
        self.some_u16s = [0] * 8
        self.some_offset = 0
        self.some_flags = struct.unpack_from('>I', data, 0x2C)[0]
        self.in_ptr = 0x30
        self.some_u32s = [0] * 0x80
        val = [0x20]
        self.v0 = self.v1 = self.t1 = self.t7 = self.t8 = self.t9 = 0
        self.s0 = self.s1 = self.s3 = self.s4 = self.s6 = 0
        self._bc0(0x80 - 4, val)
        self.t1 = self.v0
        self.t7 = 0

    def u32(self, off):
        return struct.unpack_from('>I', self.tkmk, off)[0]

    def _ac8(self):
        # proc_80040AC8: outputs bit for stream v1
        t8 = (self.header6 >> self.v1) & 0x1
        t9 = t8 & 1
        s7 = self.some_u16s[self.v1]
        if t9 == 0:
            s6ptr = self.some_ptrs[self.v1]
            if s7 == 0:
                s6ptr += 4
                s7 = 0x20
                self.some_ptrs[self.v1] = s6ptr
            t9 = self.u32(s6ptr)
            s7 -= 1
            self.some_u16s[self.v1] = s7
            self.v0 = (t9 >> s7) & 0x1
        else:
            s6ptr = self.some_ptrs[self.v1]
            if s7 == 0:
                s7 = self.tkmk[s6ptr]
                v0 = 0x100 << self.v1
                if (s7 & 0x80) == 0:
                    v0 = ~v0 & 0xFFFFFFFFFFFFFFFF
                    mask = ~(1 << self.v1) & 0xFF
                    self.header6 &= mask
                    s7 += 3
                else:
                    s7 &= 0x7F
                    s7 += 1
                    self.header6 |= (1 << self.v1)
                v0 = self.tkmk[s6ptr + 1]
                s6ptr += 2
                s7 <<= 3
                self.byte_buffer[self.v1] = v0
                self.some_ptrs[self.v1] = s6ptr
            self.v0 = self.byte_buffer[self.v1]
            s7 -= 1
            self.some_u16s[self.v1] = s7
            t8 = s7 & 0x7
            self.v0 = (self.v0 >> t8) & 0x1
            if t8 == 0 and s7 != 0:
                mask = (0x100 << self.v1) & self.header6
                if mask != 0:
                    s6ptr = self.some_ptrs[self.v1]
                    self.byte_buffer[self.v1] = self.tkmk[s6ptr]
                    self.some_ptrs[self.v1] = s6ptr + 1
        # return v0 via self.v0

    def _a60(self):
        # proc_80040A60: bit reader for some_flags/in_ptr
        this_offset = self.some_offset + self.v1
        t8 = 0x20 - self.v1
        v0 = (self.some_flags >> t8) & 0xFFFFFFFF
        if v0 & 0xFFFFFFFFFFFFFFFF == 0xFFFFFFFF:  # keep arithmetic simple below
            pass
        v0 = self.some_flags
        v0 = (v0 & ((1 << 32) - 1))
        # SRL on 32-bit
        self.v0 = (self.some_flags >> t8) & 0xFFFFFFFF if t8 < 32 else 0
        if this_offset < 0x21:
            if this_offset != 0x20:
                self.some_flags = (self.some_flags << self.v1) & 0xFFFFFFFF
                self.some_offset += self.v1
            else:
                self.some_flags = self.u32(self.in_ptr)
                self.some_offset = 0
                self.in_ptr += 4
        else:
            this_offset = 0x40
            self.some_flags = self.u32(self.in_ptr)
            this_offset -= self.v1
            this_offset -= self.some_offset
            self.some_offset -= t8
            t8v = this_offset
            self.v0 |= (self.some_flags >> t8v) & 0xFFFFFFFF if t8v < 32 else 0
            self.in_ptr += 4
            self.some_flags = (self.some_flags << self.some_offset) & 0xFFFFFFFF

    def _bc0(self, u32idx, val):
        # proc_80040BC0: builds buffer80/bufferFE tree, returns v0
        u32idx -= 1
        self.v1 = 0
        self._ac8()
        if self.v0 != 0:
            self.some_u32s[u32idx] = val[0]
            val[0] += 1
            self._bc0(u32idx, val)
            idx = self.some_u32s[u32idx]
            self.buffer80[idx] = self.v0
            self._bc0(u32idx, val)
            idx = self.some_u32s[u32idx]
            u32idx += 1
            self.s6 = idx
            self.bufferFE[idx] = self.v0
            self.v0 = self.s6
        else:
            s0 = 0
            for _ in range(5):
                self.v1 = 0
                self._ac8()
                s0 = self.v0 + s0 * 2
            u32idx += 1
            self.v0 = s0

    def _c54(self):
        # proc_80040C54: descend the tree t1 times
        s4 = self.t1
        while s4 >= 0x20:
            self.v1 = 0
            self._ac8()
            if self.v0 == 0:
                s4 = self.buffer80[s4]
            else:
                s4 = self.bufferFE[s4]
        self.s4 = s4

    def _c94(self):
        # proc_80040C94: zigzag decode; t8 input, t9 input -> t9 output
        t8 = self.t8
        t9 = self.t9
        if t8 >= 0x10:
            v0 = (0x1F - t8) * 2
            if v0 < t9:
                v0 = 0x1F
                t9 = v0 - t9
            else:
                v0 = t9 & 0x1
                t9 >>= 1
                if v0 != 0:
                    t9 += t8 + 1
                else:
                    t9 = t8 - t9
        else:
            v0 = t8 << 1
            if v0 >= t9:
                v0 = t9 & 0x1
                t9 >>= 1
                if v0 != 0:
                    t9 += t8 + 1
                else:
                    t9 = t8 - t9
        self.t9 = t9

    def decode(self):
        w, h = self.width, self.height
        pixels = w * h
        rgba16 = [0] * pixels   # u16 per pixel, big-endian conceptually
        tmp_buf = [0] * pixels
        for row in range(h):
            for col in range(w):
                p = row * w + col
                t9 = rgba16[p]
                if t9 != 0:
                    s3 = t9 & 0xFFFE
                    self.t7 = t9
                    if self.alpha == s3:
                        rgba16[p] = s3
                        self.t7 = s3
                else:
                    self.v1 = tmp_buf[p] + 1
                    self._ac8()
                    if self.v0 == 0:
                        rgba16[p] = self.t7
                    else:
                        self.v1 = 1
                        self._a60()
                        if self.v0 != 0:
                            self._c54()
                            s0 = self.s4
                            self._c54()
                            s1 = self.s4
                            self._c54()

                            rgba0 = 0
                            rgba1 = 0
                            if row != 0:
                                rgba0 = rgba16[p - w]
                            if not (row == 0 and col == 0):
                                if col != 0 or row != 0:
                                    rgba1 = rgba16[p - 1]
                            else:
                                rgba1 = 0
                            if row == 0 and col == 0:
                                rgba0 = rgba1 = 0

                            red0 = (rgba0 & 0x7C0) >> 6
                            red1 = (rgba1 & 0x7C0) >> 6
                            self.t8 = (red0 + red1) // 2
                            self.t9 = s0
                            self._c94()
                            s0 = self.t9

                            v1 = self.t9 - self.t8
                            green0 = (rgba0 & 0xF800) >> 11
                            green1 = (rgba1 & 0xF800) >> 11
                            self.t8 = v1 + (green0 + green1) // 2
                            if self.t8 >= 0x20:
                                self.t8 = 0x1F
                            elif self.t8 < 0:
                                self.t8 = 0
                            self.t9 = s1
                            self._c94()
                            s1 = self.t9

                            blue0 = (rgba0 & 0x3E) >> 1
                            blue1 = (rgba1 & 0x3E) >> 1
                            self.t8 = v1 + (blue0 + blue1) // 2
                            self.t9 = self.s4
                            self._c94()

                            self.t7 = (s1 << 11) | (s0 << 6) | (self.t9 << 1)
                            if self.t7 != self.alpha:
                                self.t7 |= 0x1
                            # insert into rgba_buf at front
                            self.rgba_buf.insert(0, self.t7)
                            self.rgba_buf.pop()
                        else:
                            self.v1 = 6
                            self._a60()
                            t7 = self.rgba_buf[self.v0]
                            if self.v0 != 0:
                                # shift
                                for i in range(self.v0, 0, -1):
                                    self.rgba_buf[i] = self.rgba_buf[i - 1]
                                self.rgba_buf[0] = t7
                            self.t7 = t7
                        rgba16[p] = self.t7
                        # test_bits and neighbor increments
                        test_bits = 0
                        if col != 0:
                            test_bits |= 0x01
                        if col < (w - 1):
                            test_bits |= 0x02
                        if col < (w - 2):
                            test_bits |= 0x04
                        if row < (h - 1):
                            test_bits |= 0x08
                        if row < (h - 2):
                            test_bits |= 0x10
                        if 0x2 == (test_bits & 0x2):
                            tmp_buf[p + 1] += 1
                        if 0x4 == (test_bits & 0x4):
                            tmp_buf[p + 2] += 1
                        if 0x9 == (test_bits & 0x9):
                            tmp_buf[p + w - 1] += 1
                        if 0x8 == (test_bits & 0x8):
                            tmp_buf[p + w] += 1
                        if 0xA == (test_bits & 0xA):
                            tmp_buf[p + w + 1] += 1
                        if 0x10 == (test_bits & 0x10):
                            tmp_buf[p + 2 * w] += 1

                        self.v1 = 1
                        self._a60()
                        if self.v0 != 0:
                            # run of extra pixels: walk and fill s3 = t7|1
                            s0 = w
                            s3 = self.t7 | 0x1
                            out = p
                            while True:
                                self.v1 = 2
                                self._a60()
                                if self.v0 == 0:
                                    self.v1 = 1
                                    self._a60()
                                    if self.v0 == 0:
                                        break
                                    else:
                                        self.v1 = 1
                                        self._a60()
                                        out += 2
                                        if self.v0 == 0:
                                            out -= 4
                                elif self.v0 == 1:
                                    out -= 1
                                elif self.v0 == 3:
                                    out += 1
                                out += s0
                                if 0 <= out < pixels:
                                    rgba16[out] = s3
        # to RGBA8888
        out = bytearray()
        for px in rgba16:
            r = (px >> 11) & 31
            g = (px >> 6) & 31
            b = (px >> 1) & 31
            a = 255 if (px & 1) else 0
            out += bytes([round(r * 255 / 31), round(g * 255 / 31), round(b * 255 / 31), a])
        return w, h, bytes(out)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def png(width, height, rgba):
    stride = width * 4
    scanlines = b''.join(b'\0' + rgba[y * stride:(y + 1) * stride] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))


def decode_tkmk00(data, alpha_color=0x01):
    t = Tkmk00(data, alpha_color)
    return t.decode()