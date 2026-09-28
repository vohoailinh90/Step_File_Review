const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  // A. every circular B-rep edge of the real model: exact, with the centre and radius of the design
  const circles = await pg.evaluate(() => {
    const T = __qs.THREE, out = [];
    for (const part of __qs.parts){
      const geo = part.mesh.geometry, topo = __qs.topology(geo), pos = geo.attributes.position, seen = new Set();
      for (let h = 0; h < topo.nTri * 3; h++){
        const t = (h / 3) | 0, u = topo.nbr[h], G = u >= 0 ? topo.faceId[u] : -1;   // nbr holds the neighbouring triangle
        if (topo.sliver[t] || G === topo.faceId[t]) continue;
        const hit = new T.Vector3().fromBufferAttribute(pos, topo.vert[h]).applyMatrix4(part.restMatrix);
        const e = __qs.edgeEntity(part, h, hit);
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        if (e.geom.type !== 'circle') continue;
        const g = e.geom, f = v => v * 1000;
        out.push({part:part.name, r:f(g.r), c:[g.c.x, g.c.y, g.c.z].map(f), exact:g.exact, closed:g.closed,
                  sweep:(g.sweep * 180 / Math.PI).toFixed(4), axis:[g.a.x, g.a.y, g.a.z].map(v => Math.abs(v).toFixed(9)).join(',')});
      }
    }
    return out;
  });
  const want = [
    ['plate', 5, [-30, 0, 5], 360], ['plate', 5, [-30, 0, -5], 360],                   // D10 hole
    ['plate', 8, [20, 0, -5], 360], ['plate', 8, [20, 0, 4], 360], ['plate', 9, [20, 0, 5], 360],   // D16 hole, chamfer
    ...[-45, 45].flatMap(x => [-25, 25].flatMap(y => [-5, 5].map(z => ['plate', 5, [x, y, z], 90]))),  // corner rounds
    ['shaft', 10, [-30, 0, 5], 360], ['shaft', 10, [-30, 0, 35], 360],                  // D20 ends
    ['shaft', 8, [-30, 0, 35], 360], ['shaft', 6, [-30, 0, 37], 360],                   // R2 fillet: plane, cylinder
    ['shaft', 6, [-30, 0, 60], 360],                                                     // sphere cap on D12
  ];
  console.log('  circular edges found:', circles.length, '(expected', want.length + ')');
  check('circle count', String(circles.length), new RegExp('^' + want.length + '$'));
  // positions carry the float32 node placement (the shaft sits at -29.9999993 mm), so compare to 1e-5 mm
  const near = (x, part, r, c) => x.part === part && Math.abs(x.r - r) < 1e-5 && x.c.every((v, i) => Math.abs(v - c[i]) < 1e-5);
  const worst = {r:0, c:0};
  for (const [part, r, c, sw] of want){
    const m = circles.find(x => near(x, part, r, c));
    if (m){ worst.r = Math.max(worst.r, Math.abs(m.r - r)); worst.c = Math.max(worst.c, ...m.c.map((v, i) => Math.abs(v - c[i]))); }
    check(part + ' R' + r + ' at ' + c.join(','), m ? 'exact=' + m.exact + ' sweep=' + m.sweep : 'missing in ' + JSON.stringify(circles.filter(x => x.part === part).map(x => x.r.toFixed(6) + '@' + x.c.map(v => v.toFixed(6)))),
          new RegExp('^exact=true sweep=' + (sw === 360 ? '360\\.0000' : '90\\.00\\d\\d') + '$'));
  }
  console.log('  worst deviation from the design: radius', worst.r.toExponential(1), 'mm, centre', worst.c.toExponential(1), 'mm');
  console.log('  inexact circles:', JSON.stringify(circles.filter(x => !x.exact)));

  // B. surfaces of revolution on one axis, synthetic: exact centre and radius from the parameters
  const b = await pg.evaluate(() => {
    const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), Z = V(0, 0, 1);
    const ringPts = (c, a, r, n = 3, t0 = 0.2) => { const u = new T.Vector3(1, 0, 0); if (Math.abs(u.dot(a)) > .9) u.set(0, 1, 0); u.addScaledVector(a, -u.dot(a)).normalize();
      const v = a.clone().cross(u); return Array.from({length:n}, (_, i) => c.clone().addScaledVector(u, r * Math.cos(t0 + i * .4)).addScaledVector(v, r * Math.sin(t0 + i * .4))); };
    const ex = e => true;
    const cone = (apex, a, semi, e = true) => ({type:'cone', apex, a, semi, exact:e});
    const cyl = (p, a, r, e = true) => ({type:'cylinder', p, a, r, exact:e});
    const sph = (c, r, e = true) => ({type:'sphere', c, r, exact:e});
    const tor = (c, a, R, r, e = true) => ({type:'torus', c, a, R, r, exact:e});
    const pln = (p, n, e = true) => ({type:'plane', p, n:n.clone().normalize(), exact:e});
    const tilt = V(Math.sin(0.3), 0, Math.cos(0.3));                     // an axis off the coordinate axes
    const at = (x, y, z) => V(x, y, z);
    // cone 45° from the origin up, cone 30° from z=20 mm down: meet at z = ρ = 20·tan30/(1+tan30)
    const zc = 0.02 * Math.tan(Math.PI/6) / (1 + Math.tan(Math.PI/6));
    // cone 45° from the origin and sphere r 8 at z 10: ρ = z, 2z² − 0.02z + 0.000036 = 0
    const zs = (0.02 - Math.sqrt(0.0004 - 8 * 0.000036)) / 4;
    // spheres r 10 at the origin and r 8 at 12 mm along the tilted axis
    const mS = (1e-4 - 6.4e-5 + 1.44e-4) / 0.024, rS = Math.sqrt(1e-4 - mS * mS);
    const cases = {
      'cone + coaxial cone': [[cone(V(0, 0, 0), Z, Math.PI/4), cone(V(0, 0, 0.02), Z.clone().negate(), Math.PI/6)], V(0, 0, zc), Z, zc],
      'cone + coaxial sphere': [[cone(V(0, 0, 0), Z, Math.PI/4), sph(V(0, 0, 0.01), 0.008)], V(0, 0, zs), Z, zs],
      'sphere + sphere, tilted axis': [[sph(V(0, 0, 0), 0.01), sph(tilt.clone().multiplyScalar(0.012), 0.008)], tilt.clone().multiplyScalar(mS), tilt, rS],
      'sphere + tilted plane': [[sph(V(0, 0, 0), 0.01), pln(tilt.clone().multiplyScalar(0.006), tilt)], tilt.clone().multiplyScalar(0.006), tilt, 0.008],
      'torus + plane (fillet foot)': [[tor(V(0, 0, 0.032), Z, 0.008, 0.002), pln(V(0.05, 0, 0.030), Z)], V(0, 0, 0.030), Z, 0.008],
      'torus + cylinder (fillet top)': [[tor(V(0, 0, 0.032), Z, 0.008, 0.002), cyl(V(0, 0, -0.1), Z, 0.006)], V(0, 0, 0.032), Z, 0.006],
      'torus + coaxial sphere': [[tor(V(0, 0, 0), Z, 0.008, 0.003), sph(V(0, 0, 0.002), Math.hypot(0.008, 0.002))], null, Z, null],
      'cone + plane square to it': [[cone(V(0, 0, -0.004), Z, Math.PI/4), pln(V(0.02, 0.01, 0.005), Z.clone().negate())], V(0, 0, 0.005), Z, 0.009],
      'cone + plane tilted 1°': [[cone(V(0, 0, -0.004), Z, Math.PI/4), pln(V(0, 0, 0.005), V(Math.sin(Math.PI/180), 0, Math.cos(Math.PI/180)))], V(0, 0, 0.005), Z, 0.009],
      'cylinder + coaxial cylinder, same radius': [[cyl(V(0, 0, 0), Z, 0.006), cyl(V(0, 0, 0.01), Z, 0.006)], V(0, 0, 0.004), Z, 0.006],
      'cylinder + off-axis cone': [[cyl(V(0, 0, 0), Z, 0.008), cone(V(0.001, 0, -0.004), Z, Math.PI/4)], V(0, 0, 0.004), Z, 0.008],
      'cylinder + fitted cone': [[cyl(V(0, 0, 0), Z, 0.008), cone(V(0, 0, -0.004), Z, Math.PI/4, false)], V(0, 0, 0.004), Z, 0.008],
    };
    const o = {};
    for (const [k, [s, c, a, r]] of Object.entries(cases)){
      let cc = c, rr = r;
      if (!cc){                                                        // torus ∩ sphere: solve it here for the check
        const R = 0.008, rt = 0.003, zS = 0.002, RS = Math.hypot(0.008, 0.002), D = Math.hypot(R, zS);
        const m = (rt*rt - RS*RS + D*D) / (2*D), q = Math.sqrt(rt*rt - m*m), ux = -R / D, uz = zS / D;
        const cands = [[R + m*ux - q*uz, m*uz + q*ux], [R + m*ux + q*uz, m*uz - q*ux]].filter(p => p[0] > 0);
        const best = cands[0]; rr = best[0]; cc = V(0, 0, best[1]);
      }
      const g = __qs.classifyEdge(ringPts(cc, a, rr), false, s);
      o[k] = g.type + ' exact=' + g.exact + (g.r ? ' r=' + (g.r*1000).toFixed(6) + ' dc=' + (g.c.distanceTo(cc)*1000).toExponential(1) + ' dr=' + Math.abs(g.r - rr).toExponential(1) : '');
      o[k + ' expected r'] = (rr * 1000).toFixed(6);
    }
    return o;
  });
  const exactOK = k => { const m = /^circle exact=true r=([\d.]+) dc=([\d.e+-]+) dr=([\d.e+-]+)$/.exec(b[k]); return m && m[1] === b[k + ' expected r'] && +m[2] < 1e-9 && +m[3] < 1e-15 ? 'ok' : b[k]; };
  for (const k of ['cone + coaxial cone', 'cone + coaxial sphere', 'sphere + sphere, tilted axis', 'sphere + tilted plane', 'torus + plane (fillet foot)',
                   'torus + cylinder (fillet top)', 'torus + coaxial sphere', 'cone + plane square to it'])
    check('exact: ' + k, exactOK(k), /^ok$/);
  for (const k of ['cone + plane tilted 1°', 'cylinder + coaxial cylinder, same radius', 'cylinder + off-axis cone', 'cylinder + fitted cone'])
    check('not exact: ' + k, b[k], /^circle exact=false/);
  console.log('  synthetic:', JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k]) => !k.endsWith('expected r'))), null, 1));

  // C. Keep needs a drawn number; cone and cylinder lengths are mesh values; ends-to-plane too
  await pg.keyboard.press('4');
  const find = async (name, test) => pg.evaluate(([n, t]) => { const part = __qs.parts.find(p => p.name === n), geo = part.mesh.geometry, topo = __qs.topology(geo);
    const pred = new Function('s', 'return ' + t);
    for (let f = 0; f < topo.fStart.length - 1; f++) if (pred(__qs.faceInfo(geo, f).surf)) return f; return -1; }, [name, test]);
  const pickFace = async (name, f) => pg.evaluate(([n, f]) => { const part = __qs.parts.find(p => p.name === n); __qs.addMeasureEntity(__qs.faceEntity(part, f, null)); }, [name, f]);
  const state = async () => pg.evaluate(() => ({keep:document.getElementById('btnMeasKeep').disabled ? 'disabled' : 'enabled',
    items:__qs.measItems.map(i => i.type + (i.text ? ':' + i.text : '')).join(','), kept:__qs.keptItems.length,
    panel:[...document.getElementById('measbody').children].map(d => [...d.children].map(c => c.textContent.trim()).filter(Boolean).join(' ') || d.textContent.trim()).join(' | ')}));
  const top = await find('plate', "s.type === 'plane' && Math.abs(s.n.z) > 0.99 && Math.abs(s.p.z - 0.005) < 1e-9");
  const coneF = await find('plate', "s.type === 'cone'");
  const d20 = await find('shaft', "s.type === 'cylinder' && Math.abs(s.r - 0.01) < 1e-9");
  await pickFace('plate', top);
  let st = await state();
  console.log('  plane alone:', st.keep, '|', st.items, '|', st.panel);
  check('Keep enabled for a lone plane (area label, round 12)', st.keep, /^enabled$/);
  await pg.keyboard.press('k');
  check('K keeps the lone plane area label', String((await state()).kept), /^1$/);
  await pg.evaluate(() => __qs.measureClear(true));
  await pg.keyboard.press('Escape');
  await pickFace('plate', coneF);
  st = await state();
  console.log('  cone alone:', st.keep, '|', st.items, '|', st.panel);
  check('Keep enabled for a cone', st.keep, /^enabled$/);
  check('cone draws its angle', st.items, /tag:90\.00°/);
  check('cone diameter range is mesh', st.panel, /diameter \(mesh\) Ø16\.00 – Ø18\.00 mm/);
  check('cone length is mesh', st.panel, /length \(mesh\) 1\.000 mm/);
  await pg.keyboard.press('k');
  st = await state();
  check('K keeps the angle tag', st.items + ' kept=' + st.kept + ' | ' + st.panel, /^ kept=2 \| 1 dimension kept on screen/);
  const drawn = await pg.evaluate(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.getElementById('annot'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < x.length; i += 4) n += x[i] > 0;
    const it = __qs.keptItems.find(i => i.type === 'tag'), v = it.a.p.clone().add(it.a.part.offset).project(__qs.camera);
    return {n, ndc:[v.x, v.y, v.z].map(x => x.toFixed(3)).join(','), cam:__qs.camera.position.toArray().map(x => x.toFixed(3)).join(',')}; });
  console.log('  overlay after K:', JSON.stringify(drawn));
  check('kept tag is drawn', String(drawn.n > 50), /^true$/);
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape');
  await pickFace('plate', top); await pickFace('shaft', d20);
  st = await state();
  console.log('  plane + D20 boss:', st.panel);
  check('ends to plane are mesh', st.panel, /far end to plane \(mesh\) 30\.00 mm \| near end to plane \(mesh\) 0\.00 mm/);
  await pg.keyboard.press('Escape');
  // D. curve (B-spline edge on the loft) keeps its length
  console.log('  errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
