/**
 * Unit tests for the viewer behaviour that geometry.test.mjs does not reach:
 * unit scaling (src/app/00-scene.js), the same-origin URL guard and the info
 * panel. The face flood-fill moved to src/app/32-faces.js with Measure mode
 * (PR #2) and is tested, with the rest of Measure, in tests/measure.test.mjs.
 *
 *   node --test tests/viewer.test.mjs
 *
 * Scene and selection were once uncovered, which meant two silent 1000x-class
 * defects passed the whole suite: changing `unitScale` from 1000 to 1, and
 * widening the face break angle from 20 deg to 85 deg. Mutations for both
 * live in tests/mutation_check.py; the unit-scale ones are caught here.
 *
 * Modules load in filename order via tests/harness.mjs, matching build.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInContext } from 'node:vm';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadViewer, PAGE, ROOT } from './harness.mjs';

// ---------------------------------------------------------------------------
// Unit scaling. OpenCASCADE writes glTF in METRES whatever the STEP authored,
// so the viewer reports mesh units x 1000. Every length and area an engineer
// reads passes through L() or A2(); a wrong scale here is a 1000x or 1e6x error
// that still looks like a plausible number.
// ---------------------------------------------------------------------------
const scene = loadViewer(
  ['src/app/00-scene.js', 'src/app/40-geometry.js'],
  ['unitScale', 'L', 'A2', 'fmt'],
);

test('unitScale defaults to 1000 (glTF metres -> mm)', () => {
  assert.equal(scene.unitScale, 1000,
    'GLB/glTF from OpenCASCADE is in metres; the viewer reports mm');
});

test('L() converts mesh units to millimetres', () => {
  assert.equal(scene.L(0.0127), '12.70', 'a 1/2 inch bore is 12.70 mm');
  assert.equal(scene.L(1), '1000', '1 mesh unit is 1000 mm');
  assert.equal(scene.L(0.1), '100.00');
});

test('A2() scales area by unitScale SQUARED, not by unitScale', () => {
  // The classic error: reusing the length scale for an area, giving mm² values
  // 1000x too small. 1e-6 m² is exactly 1 mm².
  assert.equal(scene.A2(1e-6), '1.000', '1e-6 mesh-units² is 1.000 mm²');
  assert.notEqual(scene.A2(1e-6), scene.L(1e-6), 'area must not use the length scale');
  assert.equal(scene.A2(1), '1000000', '1 mesh-unit² is 1e6 mm²');
});

test('L() and A2() agree with fmt() on the scaled value', () => {
  for (const v of [0.001, 0.0127, 0.5, 3, 1234]) {
    assert.equal(scene.L(v), scene.fmt(v * 1000));
    assert.equal(scene.A2(v), scene.fmt(v * 1e6));
  }
});

// ---------------------------------------------------------------------------
// The units toggle in the status bar (src/app/60-io.js). mm is the file's own
// scale -- glTF is in metres (x1000), an STL is taken to be in mm (x1) -- and
// "raw" is the mesh numbers as they are. For an STL the two are the same
// numbers: the toggle used to multiply every STL length by 1000 and still
// label it mm, so one click made a 10 mm plate read 10000 mm.
// ---------------------------------------------------------------------------
const ALL = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort().map(f => 'src/app/' + f);
const app = loadViewer(ALL, ['setUnitsRaw', 'mmScale', 'sniff', 'L', 'A2', 'MM', 'loadArrayBuffer'], { three: 'real' });
const units = () => runInContext('[unitScale, unitsRaw]', app.ctx);

test('the loader takes glTF as metres and an STL as millimetres', () => {
  const buf = text => new TextEncoder().encode(text).buffer;
  assert.equal(app.mmScale(app.sniff(buf('glTF\x02\x00\x00\x00'))), 1000, 'GLB: metres, shown x1000');
  assert.equal(app.mmScale(app.sniff(buf('{"asset":{"version":"2.0"}}'))), 1000, 'glTF JSON: metres');
  assert.equal(app.mmScale(app.sniff(buf('solid plate\nfacet normal 0 0 1'))), 1, 'ASCII STL: mm as it stands');
  assert.equal(app.mmScale(app.sniff(new Uint8Array(84).buffer)), 1, 'binary STL: mm as it stands');
});

test('the units toggle shows a glTF in mm or in raw metres, and back', () => {
  runInContext('unitMm = 1000; unitScale = 1000; unitsRaw = false;', app.ctx);
  app.setUnitsRaw(true);
  assert.deepEqual([...units()], [1, true]);
  assert.equal(app.L(0.0127) + app.MM(), '0.0127', 'raw: the mesh number, no unit');
  app.setUnitsRaw(false);
  assert.deepEqual([...units()], [1000, false]);
  assert.equal(app.L(0.0127) + app.MM(), '12.70 mm');
});

test('the units toggle never multiplies an STL by 1000', () => {
  runInContext('unitMm = 1; unitScale = 1; unitsRaw = false;', app.ctx);      // as the loader leaves an STL
  assert.equal(app.L(10) + app.MM(), '10.00 mm', 'a 10 mm plate');
  app.setUnitsRaw(true);
  assert.equal(app.L(10) + app.MM(), '10.00', 'raw: the same number, the unit dropped (was "10000 mm")');
  assert.equal(app.A2(6000), '6000', 'and areas too (was 6000000000)');
  app.setUnitsRaw(false);
  assert.equal(app.L(10) + app.MM(), '10.00 mm', 'back to mm: still the same number');
  runInContext('unitMm = 1000; unitScale = 1000; unitsRaw = false;', app.ctx);
});

// A file's units take effect only with the file. They used to be set before the
// parse, so a file that then failed left the old model on screen at the new
// scale: an STL after a corrupt .glb read x1000 and still said mm (geometry
// review of the STL fix; reproduced in headless Chromium).
const bytes = text => new TextEncoder().encode(text).buffer;
test('a file that fails to load leaves the model on screen at its own units', () => {
  runInContext(`unitMm = 1; unitScale = 1; unitsRaw = false; var __failed = [];
    fail = e => { __failed.push(e); };
    gltfLoader.parse = (b, p, ok, bad) => bad(new Error('THREE.GLTFLoader: JSON content not found.'));`, app.ctx);
  app.loadArrayBuffer(bytes('glTF\x02\x00\x00\x00junk'), 'bad.glb');
  assert.deepEqual([...units(), runInContext('unitMm', app.ctx)], [1, false, 1],
    'an STL on screen keeps its mm after a corrupt .glb, not x1000');
  runInContext('unitMm = 1000; unitScale = 1000;', app.ctx);             // a glTF on screen now
  app.loadArrayBuffer(bytes('ISO-10303-21;'), 'part.step');               // a STEP file handed straight to the viewer
  assert.deepEqual([...units(), runInContext('unitMm', app.ctx)], [1000, false, 1000],
    'and a glTF keeps its x1000 after a file it cannot open, not x1');
  assert.equal(runInContext('__failed.length', app.ctx), 2, 'both loads failed');
});

test('a file that loads brings its own units, and mm again', () => {
  runInContext(`unitMm = 1; unitScale = 1; unitsRaw = true;
    gltfLoader.parse = (b, p, ok) => ok({ scene: new THREE.Group() });`, app.ctx);
  app.loadArrayBuffer(bytes('glTF\x02\x00\x00\x00'), 'good.glb');
  assert.deepEqual([...units(), runInContext('unitMm', app.ctx)], [1000, false, 1000], 'a glTF is metres, shown in mm');
  runInContext('modelRoot = null; parts = []; bboxCached = null;', app.ctx);
});

// ---------------------------------------------------------------------------
// The runtime half of the air-gap (src/app/10-load.js). A URL that only exists
// at runtime -- a ?model= query, a buffer or image uri inside a .gltf -- cannot
// be judged by tests/check_invariants.py, so every such route goes through
// sameOrigin(). Codex review round 9 on PR #1: ?model=https://... fetched off
// the machine, and so did a .gltf's buffer uri.
// ---------------------------------------------------------------------------
const io = loadViewer(['src/app/10-load.js'], ['sameOrigin']);

test('sameOrigin passes the page\'s own origin, data: and blob:', () => {
  const origin = new URL(PAGE).origin;
  for (const u of ['/model.glb', 'model.glb', 'geo.bin', './a/b.bin', origin + '/x.glb',
                   'data:application/octet-stream;base64,AAAA', 'blob:' + origin + '/1234']) {
    assert.doesNotThrow(() => io.sameOrigin(u), u);
  }
});

test('sameOrigin refuses every other host, however it is spelled', () => {
  for (const u of ['https://example.com/x.glb', 'http://127.0.0.1:9999/x.glb', '//intranet/x.glb',
                   '\\\\intranet\\x.glb', '/\\intranet/x.glb', 'https:example.com/x', ' //intranet/x',
                   'ws://127.0.0.1:8000/x', 'file://server/share/x.bin']) {
    assert.throws(() => io.sameOrigin(u), /blocked a request to another host/, u);
  }
});

test('a hostless file: path is local, so a viewer opened from disk still loads', () => {
  assert.doesNotThrow(() => io.sameOrigin('file:///C:/models/part.glb'));
});

test('every three.js loader URL is routed through sameOrigin', () => {
  const hook = io.THREE.DefaultLoadingManager.urlModifier;
  assert.equal(hook, io.sameOrigin, 'DefaultLoadingManager has no sameOrigin URL hook');
  assert.throws(() => hook('https://example.com/geo.bin'), /another host/);
});

// ---------------------------------------------------------------------------
// The info panel (src/app/40-geometry.js). A part name comes from the model
// file. Codex review round 11 on PR #1 led to a .gltf whose part was named
// <style>@import'\\68ttps...'</style>: showInfo() joined it into innerHTML, and
// clicking the part fetched off the machine. Text from a model must arrive as
// text -- every value goes in through textContent, and nothing is parsed.
// ---------------------------------------------------------------------------
const panel = loadViewer(['src/app/00-scene.js', 'src/app/40-geometry.js'], ['showInfo']);

function texts(node) {
  return [typeof node === 'string' ? node : node.textContent || '',
          ...((node && node.children) || []).flatMap(texts)];
}

test('showInfo puts a model-supplied name in as text, never as markup', () => {
  const hostile = "<style>@import'\\68ttps\\3a\\2f\\2fexample'</style><img src=https://example.com/x>";
  const el = runInContext("$('info')", panel.ctx);
  el.innerHTML = 'UNTOUCHED';
  panel.showInfo({ title: 'PART', rows: [['name', hostile]], foot: 'foot' });
  assert.equal(el.innerHTML, 'UNTOUCHED', 'showInfo wrote markup through innerHTML');
  assert.ok(texts(el).includes(hostile), 'the name should be present, verbatim, as text');
});
