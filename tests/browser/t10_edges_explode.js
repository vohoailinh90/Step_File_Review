const L = require('./lib.js');
const {launch, openModel, setCam, click, check} = L;
// max distance (mm) from sampled feature-edge vertices to the nearest vertex of their own mesh, in world space
const ALIGN = () => __qs.parts.map(p => {
  const T = __qs.THREE, ep = p.edges.geometry.attributes.position, mp = p.mesh.geometry.attributes.position;
  const mesh = []; for (let i = 0; i < mp.count; i++) mesh.push(new T.Vector3().fromBufferAttribute(mp, i).applyMatrix4(p.mesh.matrixWorld));
  let worst = 0;
  for (let i = 0; i < ep.count; i += Math.max(1, (ep.count / 60) | 0)){
    const v = new T.Vector3().fromBufferAttribute(ep, i).applyMatrix4(p.edges.matrixWorld);
    let best = Infinity; for (const m of mesh) best = Math.min(best, m.distanceTo(v));
    worst = Math.max(worst, best);
  }
  const t = new T.Vector3().setFromMatrixPosition(p.restMatrix);
  return p.name + ' (node offset ' + t.toArray().map(x => (x*1000).toFixed(0)).join(',') + ') ' + (worst * 1000).toExponential(1) + ' mm';
}).join(' | ');
// every part's worst distance, as a number, must be float noise: 1e-6 mm is far below any misplacement
const TOL = 1e-6;
const aligned = s => {
  const d = [...s.matchAll(/ (-?\d\.\de[-+]\d+) mm/g)].map(m => +m[1]);
  return d.length === 3 && d.every(x => x < TOL) ? 'ok' : 'worst ' + Math.max(...d) + ' mm over ' + d.length + ' parts: ' + s;
};
(async () => {
  const browser = await launch();
  {
    const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
    await pg.evaluate(() => __qs.toggleEdges());                 // edges built assembled
    const a0 = await pg.evaluate(ALIGN);
    await pg.evaluate(() => __qs.setExplode(0.5));
    const a1 = await pg.evaluate(ALIGN);
    await pg.evaluate(() => __qs.setExplode(0.9));
    const a2 = await pg.evaluate(ALIGN);
    console.log('  built assembled      :', a0); console.log('  exploded 50 %        :', a1); console.log('  exploded 90 %        :', a2);
    for (const [k, v] of [['assembled', a0], ['50%', a1], ['90%', a2]]) check('edges on their mesh, ' + k, aligned(v), /^ok$/);
    // Edge mode while exploded: the shaft's shoulder rim reports its centre where the shaft is drawn
    await pg.evaluate(() => __qs.setExplode(0.5));
    await pg.keyboard.press('3');
    await L.hideAllBut(pg, ['shaft']);
    await pg.evaluate(() => __qs.camera.up.set(0, 0, 1));
    const off = await pg.evaluate(() => __qs.parts.find(p => p.name === 'shaft').offset.toArray());
    const c = [-0.03 + off[0], off[1], 0.035 + off[2]];
    await setCam(pg, [c[0] + 0.07, c[1] - 0.09, c[2] + 0.05], c);
    const dx = 0.07, dy = -0.09, l = Math.hypot(dx, dy);
    await click(pg, [c[0] + 0.01*dx/l, c[1] + 0.01*dy/l, c[2]]);
    const info = await pg.evaluate(() => document.getElementById('info').innerText.replace(/\n+/g, ' | '));
    const expect = [c[0], c[1], c[2]].map(v => (v * 1000).toFixed(2));
    console.log('  edge-mode pick while exploded:', info, '\n  expected centre ~', expect.join(', '));
    check('edge mode rim Ø20 at the drawn shaft', info, new RegExp('diameter 20\\.00 mm.*centre ' + expect[0].replace('-', '\\-').slice(0, -1)));
    console.log('  errors:', errors.filter(e => !/Failed to load resource/.test(e)));
    await pg.close();
  }
  {
    const {pg} = await openModel(browser, 'asm_brep.glb', 'asm.step');
    await pg.evaluate(() => __qs.setExplode(0.5));
    await pg.evaluate(() => __qs.toggleEdges());                 // edges built while exploded
    const b0 = await pg.evaluate(ALIGN);
    await pg.evaluate(() => __qs.setExplode(0.8));
    const b1 = await pg.evaluate(ALIGN);
    await pg.evaluate(() => __qs.setExplode(0));
    const b2 = await pg.evaluate(ALIGN);
    console.log('  built at 50 %        :', b0); console.log('  then 80 %            :', b1); console.log('  then assembled       :', b2);
    for (const [k, v] of [['built exploded', b0], ['re-exploded', b1], ['reassembled', b2]]) check('edges on their mesh, ' + k, aligned(v), /^ok$/);
    await pg.screenshot({path: L.OUT + '10_edges_exploded.png'});
    await pg.close();
  }
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
