const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const edges = async pg => pg.evaluate(() => {
    const T = __qs.THREE, part = __qs.parts[0], geo = part.mesh.geometry, topo = __qs.topology(geo), pos = geo.attributes.position, seen = new Map();
    for (let h = 0; h < topo.nTri * 3; h++){
      const t = (h / 3) | 0, u = topo.nbr[h];
      if (topo.sliver[t] || u >= 0) continue;                                    // free boundary only
      const hit = new T.Vector3().fromBufferAttribute(pos, topo.vert[h]).applyMatrix4(part.restMatrix);
      const e = __qs.edgeEntity(part, h, hit);
      if (!seen.has(e.key)) seen.set(e.key, e.geom.type + (e.geom.type === 'circle' ? ' r=' + e.geom.r.toFixed(3) + (e.geom.closed ? ' closed' : '') : ' ' + e.geom.len.toFixed(3)));
    }
    return [...seen.values()].sort();
  });
  // A. rectangle 40 x 20 mm meshed 4 x 2: four sides, not one perimeter
  let {pg, errors} = await openModel(browser, 'sheet_rect.stl', 'sheet_rect.stl');
  let e = await edges(pg);
  console.log('   rect 4x2:', JSON.stringify(e));
  check('meshed rectangle: its four sides', JSON.stringify(e), /^\["line 20\.000","line 20\.000","line 40\.000","line 40\.000"\]$/);
  // two opposite sides can be picked as a pair (distinct keys) and read 20 mm apart
  await pg.keyboard.press('4');
  const pair = await pg.evaluate(() => {
    const T = __qs.THREE, part = __qs.parts[0], geo = part.mesh.geometry, topo = __qs.topology(geo), pos = geo.attributes.position, byLen = {};
    for (let h = 0; h < topo.nTri * 3; h++){
      if (topo.nbr[h] >= 0) continue;
      const e = __qs.edgeEntity(part, h, new T.Vector3().fromBufferAttribute(pos, topo.vert[h]).applyMatrix4(part.restMatrix));
      const y = e.geom.p0 ? Math.round(e.geom.p0.y) : null;
      if (e.geom.type === 'line' && Math.abs(e.geom.len - 40) < 1e-6) byLen['y' + y] = e;
    }
    __qs.measureClear(false); __qs.addMeasureEntity(byLen.y0); __qs.addMeasureEntity(byLen.y20);
    return [...document.getElementById('measbody').children].map(d => [...d.children].map(c => c.textContent.trim()).filter(Boolean).join(' ') || d.textContent.trim()).join(' | ');
  });
  console.log('   opposite sides:', pair);
  check('two opposite sides pair up, 20 mm apart', pair, /A · Straight edge 40\.00 mm .*B · Straight edge 40\.00 mm .*distance 20\.00 mm \(parallel\)/);
  await pg.close();
  // B. the same rectangle as two bare triangles: every side is a single segment
  ({pg, errors} = await openModel(browser, 'sheet_bare.stl', 'sheet_bare.stl'));
  e = await edges(pg);
  console.log('   rect 1x1:', JSON.stringify(e));
  check('bare rectangle: its four sides', JSON.stringify(e), /^\["line 20\.000","line 20\.000","line 40\.000","line 40\.000"\]$/);
  await pg.close();
  // C. a disc: its rim turns 11.25° per segment and stays one closed circle
  ({pg, errors} = await openModel(browser, 'sheet_disc.stl', 'sheet_disc.stl'));
  e = await edges(pg);
  console.log('   disc:', JSON.stringify(e));
  check('disc rim: one closed circle R10', JSON.stringify(e), /^\["circle r=\d+\.\d+ closed"\]$/);
  check('disc rim radius (32-gon fitted)', e[0], /r=(9\.9[5-9]\d|10\.0[0-4]\d)/);
  console.log('   errors:', errors.filter(x => !/Failed to load resource/.test(x)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
