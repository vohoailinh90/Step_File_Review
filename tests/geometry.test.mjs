/**
 * Unit tests for the viewer's pure geometry maths (src/app/40-geometry.js).
 *
 *   node --test tests/
 *
 * The module is a plain script fragment, not an ES module, so it is evaluated in
 * a vm context with a minimal THREE.Vector3 and a $() stub. That surface is 11
 * methods wide; stubbing it is cheaper and far more honest than booting a
 * headless WebGL context to test arithmetic.
 *
 * README.md makes two measurable claims about fitCircle. Both are asserted here:
 *   - "the fit recovered known diameters to within 0.02%"
 *   - "a coarse tessellation will inscribe the polygon slightly inside the true
 *      circle" -- i.e. the bias is one-directional, never an over-estimate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}

/** Evaluate a viewer module fragment and hand back the named globals. */
function loadModule(rel, names) {
  const stubEl = { addEventListener() {}, textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const ctx = createContext({
    THREE: { Vector3 },
    $: () => stubEl,
    document: { getElementById: () => stubEl },
    Math, console,
  });
  runInContext(readFileSync(join(ROOT, rel), 'utf8'), ctx);
  const out = {};
  for (const n of names) {
    out[n] = runInContext(n, ctx);
    assert.equal(typeof out[n], 'function', `${rel} should define ${n}()`);
  }
  return out;
}

const { fitCircle, polylineLength, fmt } =
  loadModule('src/app/40-geometry.js', ['fitCircle', 'polylineLength', 'fmt']);

/** A circle tessellated as an inscribed n-gon -- what a STEP rim actually becomes. */
function inscribedRing(radius, n, { cx = 0, cy = 0, cz = 0, axis = 'z' } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const u = radius * Math.cos(a), v = radius * Math.sin(a);
    if (axis === 'z') pts.push(new Vector3(cx + u, cy + v, cz));
    else if (axis === 'x') pts.push(new Vector3(cx, cy + u, cz + v));
    else pts.push(new Vector3(cx + v, cy, cz + u));
  }
  return pts;
}

test('fitCircle recovers a fine-tessellated diameter to within 0.02%', () => {
  // 128 segments is what --fine produces on a bore of this size.
  const truth = 12.7;                            // a 1/2" bore, in mesh units
  const fit = fitCircle(inscribedRing(truth, 128));
  assert.ok(fit, 'a 128-gon should be recognised as a circle');
  const errPct = Math.abs(fit.radius - truth) / truth * 100;
  assert.ok(errPct < 0.02, `radius error ${errPct.toFixed(5)}% should be < 0.02%`);
});

test('fitCircle never over-estimates a tessellated radius (inscribed bias)', () => {
  // README states the polygon sits inside the true circle. If this ever flips,
  // a reported bore diameter could read larger than the real hole -- the one
  // direction of error that would mislead an engineer checking clearance.
  for (const n of [8, 16, 32, 64, 128, 256]) {
    const fit = fitCircle(inscribedRing(25, n));
    assert.ok(fit, `${n}-gon should fit`);
    assert.ok(fit.radius <= 25 + 1e-12,
      `${n}-gon radius ${fit.radius} must not exceed the true 25`);
  }
});

test('fitCircle is EXACT for a uniformly sampled complete rim, at any density', () => {
  // Measured, not assumed: an inscribed polygon's *vertices* lie on the true
  // circle, and fitCircle's centroid of a uniform ring is the true centre, so
  // the mean radius is the true radius -- even for an 8-gon. Accuracy here is
  // set by how uniformly the rim was sampled, NOT by tessellation density.
  // README's "within 0.02%" is a floor for this case, not a ceiling.
  for (const n of [8, 16, 32, 64, 128, 256]) {
    const fit = fitCircle(inscribedRing(25, n));
    assert.ok(Math.abs(fit.radius - 25) < 1e-9,
      `n=${n} should recover r=25 exactly, got ${fit.radius}`);
  }
});

// ---- the rms gate: what the viewer is actually willing to report -----------
// pickEdge() only reports a diameter when fit.rms < 0.03. That gate is the real
// accuracy guarantee, so it is tested as a unit with the fit. If the gate is
// ever loosened, GATE_BOUND_PCT below stops being true and these tests fail.
const GATE = 0.03;
const GATE_BOUND_PCT = 0.14;   // worst error measured across all passing sweeps

test('the reported gate constant is still 0.03', () => {
  // Drift guard: the bounds asserted below were measured against this value.
  const src = readFileSync(join(ROOT, 'src/app/40-geometry.js'), 'utf8');
  assert.match(src, /fit\.rms\s*<\s*0\.03/,
    'pickEdge no longer gates on rms < 0.03 -- re-measure GATE_BOUND_PCT');
});

/** A rim traced only part of the way round, as a broken edge chain would be. */
function arc(radius, n, sweepDeg) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (sweepDeg * Math.PI / 180) * i / (n - 1);
    pts.push(new Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
  }
  return pts;
}

test('the gate refuses a partially traced rim instead of under-reporting it', () => {
  // This is the failure that would matter: a half-traced bore fits a much
  // smaller radius (a 180 deg sweep reads ~26% small). The gate must reject it
  // rather than report a confident, wrong diameter to someone checking a hole.
  for (const deg of [90, 120, 180, 240, 300]) {
    const fit = fitCircle(arc(25, 64, deg));
    assert.ok(!fit || fit.rms >= GATE,
      `a ${deg} deg sweep must not pass the gate (rms ${fit && fit.rms})`);
  }
});

test('every fit that passes the gate is within the measured error bound', () => {
  let worst = 0, worstAt = null;
  for (let deg = 5; deg <= 360; deg += 0.5) {
    for (const n of [8, 16, 24, 32, 48, 64, 96, 128, 256]) {
      const fit = fitCircle(arc(25, n, deg));
      if (!fit || fit.rms >= GATE) continue;
      const errPct = Math.abs(fit.radius - 25) / 25 * 100;
      if (errPct > worst) { worst = errPct; worstAt = `${deg}deg/n=${n}`; }
    }
  }
  assert.ok(worst < GATE_BOUND_PCT,
    `worst gated error ${worst.toFixed(4)}% at ${worstAt} exceeds ${GATE_BOUND_PCT}%`);
});

test('radial jitter degrades the radius gracefully, never catastrophically', () => {
  // Tessellation noise, not sweep truncation. The gate does not reject these,
  // so the fit itself has to stay usable.
  const jitterErr = (jit, seed) => {
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pts = [];
    for (let i = 0; i < 128; i++) {
      const a = 2 * Math.PI * i / 128, r = 25 * (1 + (rnd() * 2 - 1) * jit);
      pts.push(new Vector3(r * Math.cos(a), r * Math.sin(a), 0));
    }
    const fit = fitCircle(pts);
    assert.ok(fit && fit.rms < GATE, `jitter ${jit} should still fit and pass`);
    return Math.abs(fit.radius - 25) / 25 * 100;
  };
  for (let seed = 1; seed <= 20; seed++) {
    assert.ok(jitterErr(0.001, seed) < 0.05, '0.1% jitter -> under 0.05% error');
    assert.ok(jitterErr(0.02, seed) < 0.5, '2% jitter -> under 0.5% error');
  }
});

test('fitCircle reports centre and axis of an off-origin, off-axis ring', () => {
  const fit = fitCircle(inscribedRing(8, 96, { cx: 3, cy: -4, cz: 15, axis: 'x' }));
  assert.ok(fit);
  assert.ok(Math.abs(fit.center.x - 3) < 1e-9, 'centre x');
  assert.ok(Math.abs(fit.center.y + 4) < 1e-9, 'centre y');
  assert.ok(Math.abs(fit.center.z - 15) < 1e-9, 'centre z');
  // a ring in the YZ plane has an axis along X
  assert.ok(Math.abs(Math.abs(fit.axis.x) - 1) < 1e-9, `axis should be +/-X, got ${fit.axis.x}`);
  assert.ok(Math.abs(fit.axis.length() - 1) < 1e-12, 'axis must be unit length');
});

test('fitCircle rejects too-few points', () => {
  assert.equal(fitCircle(inscribedRing(10, 4)), null, '4 points is not enough to fit');
});

test('fitCircle rejects a non-planar loop', () => {
  const pts = inscribedRing(10, 32);
  pts[5].z += 3;                                  // 30% of radius out of plane
  assert.equal(fitCircle(pts), null, 'a warped loop is not a circle');
});

test('a square never passes the gate as a circle', () => {
  const square = [[0,0],[10,0],[10,10],[0,10],[0,0],[5,0]]
    .map(([x, y]) => new Vector3(x, y, 0));
  const fit = fitCircle(square);
  assert.ok(!fit || fit.rms >= GATE,
    `a square must not be reported as a circle (rms ${fit && fit.rms})`);
});

test('fitCircle rms is near zero for a true circle', () => {
  assert.ok(fitCircle(inscribedRing(25, 256)).rms < 1e-3);
});

test('polylineLength measures open and closed runs', () => {
  const pts = [[0,0],[3,0],[3,4]].map(([x, y]) => new Vector3(x, y, 0));
  assert.equal(polylineLength(pts, false), 7);          // 3 + 4
  assert.equal(polylineLength(pts, true), 12);          // + 5 back to start
  assert.equal(polylineLength([new Vector3()], false), 0);
});

test('polylineLength of a closed ring approaches the circumference', () => {
  const L = polylineLength(inscribedRing(25, 512), true);
  const circ = 2 * Math.PI * 25;
  assert.ok(L <= circ, 'an inscribed polygon is shorter than its circle');
  assert.ok((circ - L) / circ < 1e-4, 'a 512-gon should be within 0.01%');
});

test('fmt switches precision by magnitude', () => {
  assert.equal(fmt(1234.5), '1235');       // >= 1000 -> integer
  assert.equal(fmt(12.345), '12.35');      // >= 10   -> 2dp
  assert.equal(fmt(1.2345), '1.234');      // >= 0.1  -> 3dp
  assert.equal(fmt(0.012345), '0.0123');   // < 0.1   -> 3 significant
  assert.equal(fmt(-12.345), '-12.35', 'negatives use magnitude, keep sign');
});
