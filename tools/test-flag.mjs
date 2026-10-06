import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_COLS, FLAG_ROWS, FLAG_STEP, flagPositions, flagNormals, flagIsWhite } from '../src/flag.js';

// func_800AF9E4 / func_800B0004 reference, written independently of flag.js's loop layout
function refQuad(phase, row, col) {
  const sins = a => Math.sin(((a & 0xffff) / 65536) * Math.PI * 2);
  const res1 = Math.trunc(sins(phase - col * FLAG_STEP) * 84 * col * 0.18);
  const res2 = Math.trunc(sins(phase - (col + 1) * FLAG_STEP) * 84 * (col + 1) * 0.18);
  const q = [];
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 84 + col * 84 - 504;
    let y = (i >> 1) === 0 ? row * 84 - 420 : row * 84 + 84 - 420;
    y += Math.trunc((i % 2 === 0 ? col * col : (col + 1) * (col + 1)) * -0.07);
    q.push([x, y, i % 2 === 0 ? res1 : res2]);
  }
  return q;
}

test('quad vertices follow func_800AF9E4 for every row/col and several phases', () => {
  for (const phase of [0, 0x9C0, 0x4000, 0x8000, 0xC000, 0xFFFF]) {
    const p = flagPositions(phase);
    for (let row = 0; row < FLAG_ROWS; row++) for (let col = 0; col < FLAG_COLS; col++) {
      const q = refQuad(phase, row, col);
      for (let i = 0; i < 4; i++) {
        const o = ((row * FLAG_COLS + col) * 4 + i) * 3;
        assert.deepEqual([p[o], p[o + 1], p[o + 2]], q[i], `phase ${phase} row ${row} col ${col} v${i}`);
      }
    }
  }
});

test('grid spans x -504..504, y -420..420 (minus droop), column 0 is flat (pole edge)', () => {
  const p = flagPositions(0x1234);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < p.length; i += 3) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]); }
  assert.equal(minX, -504); assert.equal(maxX, 504);
  assert.equal(maxY, 420); assert.ok(minY <= -420 && minY >= -420 - 11);   // -0.07 * 12^2 = -10.08
  for (let row = 0; row < FLAG_ROWS; row++) assert.equal(p[(row * FLAG_COLS) * 4 * 3 + 2], 0);   // res1 at col 0 is sin*0
});

test('checker: 2x2-quad cells, (col/2 + row/2) & 1', () => {
  assert.equal(flagIsWhite(0, 0), false); assert.equal(flagIsWhite(0, 1), false);
  assert.equal(flagIsWhite(0, 2), true); assert.equal(flagIsWhite(1, 2), true);
  assert.equal(flagIsWhite(2, 0), true); assert.equal(flagIsWhite(2, 2), false);
  assert.equal(flagIsWhite(3, 11), false); assert.equal(flagIsWhite(9, 11), true);   // (5+1)&1 = 0, (5+4)&1 = 1
});

test('normals face +z, are averaged across neighbouring strips and shared by every row', () => {
  const p = flagPositions(0x2000);
  const n = flagNormals(p);
  for (let row = 0; row < FLAG_ROWS; row++) for (let col = 0; col < FLAG_COLS; col++) for (let i = 0; i < 4; i++) {
    const o = ((row * FLAG_COLS + col) * 4 + i) * 3;
    const o0 = ((0 * FLAG_COLS + col) * 4 + i) * 3;
    assert.ok(n[o + 2] > 0, 'normal z positive');
    assert.equal(n[o + 1], 0, 'normal y is 0 (ripple only in x/z)');
    assert.deepEqual([n[o], n[o + 1], n[o + 2]], [n[o0], n[o0 + 1], n[o0 + 2]], 'same as row 0');
    assert.ok(Math.hypot(n[o], n[o + 1], n[o + 2]) <= 121);
  }
  // right verts of col c equal left verts of col c+1 (both avg(n[c], n[c+1]))
  for (let col = 0; col < FLAG_COLS - 1; col++) {
    const r = (col * 4 + 1) * 3, l = ((col + 1) * 4) * 3;
    assert.deepEqual([n[r], n[r + 1], n[r + 2]], [n[l], n[l + 1], n[l + 2]]);
  }
});
