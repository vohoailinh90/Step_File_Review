const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const {pg} = await openModel(browser, 'big_brep.glb', 'big.step');
  const r = await pg.evaluate(() => {
    const plate = __qs.parts.find(p => p.name === 'bigplate'), pg = plate.mesh.geometry, ptopo = __qs.topology(pg);
    const shared = new Set(__qs.parts.filter(p => p.name.startsWith('bolt')).map(p => p.mesh.geometry.uuid)).size;
    const res = [];
    for (const name of ['bolt_0_0', 'bolt_19_7', 'bolt_12_19']){
      const bolt = __qs.parts.find(p => p.name === name), bg = bolt.mesh.geometry, btopo = __qs.topology(bg);
      // the bolt shank (r = 3.9) and the plate hole it sits in
      let fb = -1; for (let f = 0; f < btopo.fStart.length - 1; f++){ const s = __qs.faceInfo(bg, f).surf; if (s.type === 'cylinder' && Math.abs(s.r - 0.0039) < 1e-7) fb = f; }
      const B = __qs.faceEntity(bolt, fb, null);
      const c = new __qs.THREE.Vector3(); B.geom.p.clone();
      let fh = -1, best = Infinity;
      for (let f = 0; f < ptopo.fStart.length - 1; f++){ const s = __qs.faceInfo(pg, f).surf; if (s.type !== 'cylinder') continue;
        const w = __qs.faceEntity(plate, f, null).geom; const d = Math.hypot(w.p.x - B.geom.p.x, w.p.y - B.geom.p.y); if (d < best){ best = d; fh = f; } }
      const H = __qs.faceEntity(plate, fh, null);
      B.hit = B.geom.p.clone(); H.hit = H.geom.p.clone();
      const rel = __qs.relate(H, B, __qs.minDistance(H, B));
      res.push(name + ': ' + rel.rows.map(x => x.join(' ')).join(' | '));
    }
    return {shared, res};
  });
  console.log('  distinct bolt geometries:', r.shared); r.res.forEach(x => console.log('  ' + x));
  check('the 400 bolts share one geometry', String(r.shared), /^1$/);
  r.res.forEach(x => check('bolt coaxial in its hole, 0.1 mm clearance', x, /centre distance 0 \(coaxial\) \| radial clearance 0\.100 mm/));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
