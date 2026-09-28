const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await pg.keyboard.press('4');
  const find = async (name, test) => pg.evaluate(([n, t]) => { const part = __qs.parts.find(p => p.name === n), geo = part.mesh.geometry, topo = __qs.topology(geo);
    const pred = new Function('s', 'return ' + t);
    for (let f = 0; f < topo.fStart.length - 1; f++) if (pred(__qs.faceInfo(geo, f).surf)) return f; return -1; }, [name, test]);
  const pair = async (a, b) => pg.evaluate(([a, b]) => {
    __qs.measureClear(false);
    for (const [n, f] of [a, b]) __qs.addMeasureEntity(__qs.faceEntity(__qs.parts.find(p => p.name === n), f, null));
    return {keep:document.getElementById('btnMeasKeep').disabled ? 'disabled' : 'enabled',
            items:__qs.measItems.filter(i => i.type !== 'center' && i.type !== 'edge').map(i => i.type + (i.text ? ':' + i.text : '')).join(','),
            panel:[...document.getElementById('measbody').children].map(d => [...d.children].map(c => c.textContent.trim()).filter(Boolean).join(' ') || d.textContent.trim()).join(' | ')};
  }, [a, b]);
  // A. two faces meeting at an edge: plate top and its +x side, 90°, touching
  const top = await find('plate', "s.type === 'plane' && Math.abs(s.n.z) > 0.99 && Math.abs(s.p.z - 0.005) < 1e-9");
  const side = await find('plate', "s.type === 'plane' && Math.abs(s.n.x) > 0.99 && Math.abs(s.p.x - 0.05) < 1e-9");
  let r = await pair(['plate', top], ['plate', side]);
  console.log('   top + side:', r.keep, '|', r.items, '|', r.panel);
  check('touching planes: angle drawn', r.items, /^tag:90\.00°$/);
  check('touching planes: Keep enabled', r.keep, /^enabled$/);
  const at = await pg.evaluate(() => { const t = __qs.measItems.find(i => i.type === 'tag'); return [t.a.p.x, t.a.p.z].map(v => (v * 1000).toFixed(3)).join(','); });
  check('label sits on the shared edge (x = 50, z = 5)', at, /^50\.000,5\.000$/);
  // B. apart: plate top and a bracket wall (bracket floor is 5 mm above the plate)
  const wall = await find('bracket', "s.type === 'plane' && Math.abs(s.p.y - 0.01) < 1e-6 && Math.abs(Math.abs(s.n.y) - 1) < 1e-6");
  r = await pair(['plate', top], ['bracket', wall]);
  console.log('   top + wall:', r.items, '|', r.panel);
  check('apart planes: angle and min distance drawn', r.items, /^tag:90\.00°,dim$/);
  // C. chamfer cone along a bracket wall: axis 10 mm from the wall, widest radius 9 mm
  const cone = await find('plate', "s.type === 'cone'");
  r = await pair(['plate', cone], ['bracket', wall]);
  console.log('   cone + wall:', r.panel);
  check('cone clearance to a plane along it', r.panel, /axis to plane 10\.00 mm \| min to plane \(mesh\) 1\.000 mm \| max to plane \(mesh\) 19\.00 mm/);
  // D. every other angle row carries a matching label (synthetic picks)
  const d = await pg.evaluate(() => {
    const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), part = __qs.parts[0], o = {};
    const ent = (geom, hit) => ({kind:'face', part, geom, exact:true, hit});
    const tilt = V(Math.sin(0.5), 0, Math.cos(0.5));
    const plane = ent({type:'plane', p:V(0, 0, 0), n:V(0, 0, 1)}, V(0.01, 0.01, 0));
    const cyl = ent({type:'cylinder', p:V(0, 0, 0.02), a:tilt, r:0.004, h0:-0.01, h1:0.01}, V(0, 0.004, 0.02));
    const cyl2 = ent({type:'cylinder', p:V(0.03, 0, 0.02), a:V(0, 1, 0), r:0.004, h0:-0.01, h1:0.01}, V(0.03, 0, 0.024));
    const line = (p0, p1) => ({kind:'edge', part, geom:{type:'line', p0, p1, d:p1.clone().sub(p0).normalize(), len:p0.distanceTo(p1)}, exact:true, hit:p0.clone().lerp(p1, .5)});
    const e1 = line(V(0, 0, 0.01), V(0.01, 0, 0.02)), e2 = line(V(0, 0.02, 0.01), V(0, 0.03, 0.01));
    const cases = {'plane + oblique cylinder':[plane, cyl], 'plane + oblique edge':[plane, e1], 'crossing axes':[cyl, cyl2], 'axis + oblique edge':[cyl2, e1], 'two crossing edges':[e1, e2]};
    for (const [k, [a, b]] of Object.entries(cases)){
      const res = __qs.relate(a, b, null), ang = res.rows.find(x => /angle/.test(x[0])), tag = res.items.find(i => i.type === 'tag');
      o[k] = (ang ? ang[0] + ' ' + ang[1] : 'no angle row') + ' | tag ' + (tag ? tag.text : 'none');
    }
    return o;
  });
  console.log('   synthetic:', JSON.stringify(d, null, 1));
  for (const [k, v] of Object.entries(d)){ const m = /^(.*angle.*) (\S+°) \| tag (\S+)$/.exec(v); check(k + ': angle drawn', m && m[2] === m[3] ? 'ok' : v, /^ok$/); }
  console.log('   errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
