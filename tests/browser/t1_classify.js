const {launch, openModel} = require('./lib.js');
(async () => {
  const browser = await launch();
  for (const model of ['asm_brep.glb', 'asm_plain.glb', 'plate.stl']){
    const {pg, errors} = await openModel(browser, model);
    const res = await pg.evaluate(() => {
      const mm = v => v === undefined ? undefined : +(v * __qs.renderer && v * (__qs.parts[0] ? 1 : 1)).toFixed(6);
      const out = [];
      const t0 = performance.now();
      for (const p of __qs.parts){
        const geo = p.mesh.geometry, topo = __qs.topology(geo), faces = {};
        for (let f = 0; f < topo.fStart.length - 1; f++){
          if (topo.fStart[f+1] === topo.fStart[f]) continue;
          const info = __qs.faceInfo(geo, f), s = info.surf;
          const k = s.type + (info.exact ? '*' : '');
          const d = s.type === 'cylinder' ? 'r=' + (s.r) + (s.hole ? ' hole' : ' boss') + ' len=' + (s.h1 - s.h0)
                  : s.type === 'sphere' ? 'r=' + s.r + (s.hole ? ' socket' : '')
                  : s.type === 'torus' ? 'R=' + s.R + ' r=' + s.r
                  : s.type === 'cone' ? 'semi=' + (s.semi * 180 / Math.PI).toFixed(3) + ' rMin=' + s.rMin + ' rMax=' + s.rMax
                  : s.type === 'plane' ? 'n=' + [s.n.x, s.n.y, s.n.z].map(v => v.toFixed(3)).join(',') : '';
          (faces[k] = faces[k] || []).push(d);
        }
        out.push({name:p.name, source:topo.source, nTri:topo.nTri, faces});
      }
      return {out, ms: performance.now() - t0, unit: document.getElementById('stUnits').textContent};
    });
    console.log('=====', model, 'errors:', errors.length ? errors : 'none', 'analysis ms', res.ms.toFixed(1));
    for (const p of res.out){
      console.log('  part', p.name, 'source', p.source, 'tris', p.nTri);
      for (const [k, v] of Object.entries(p.faces)) console.log('    ', k.padEnd(10), v.length, v.slice(0, 8).join(' | '));
    }
    await pg.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
