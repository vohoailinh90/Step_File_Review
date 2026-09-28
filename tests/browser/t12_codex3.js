const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  // A. non-uniform scale on a part's placement
  const a = await pg.evaluate(() => {
    const T = __qs.THREE, out = {};
    const find = (part, pred) => { const topo = __qs.topology(part.mesh.geometry); for (let f = 0; f < topo.fStart.length - 1; f++){ const i = __qs.faceInfo(part.mesh.geometry, f); if (pred(i.surf)) return f; } return -1; };
    const br = __qs.parts.find(p => p.name === 'bracket'), rest = br.restMatrix.clone();
    const f1 = find(br, s => s.type === 'plane' && Math.abs(s.p.y - 0.01) < 1e-6 && Math.abs(Math.abs(s.n.y) - 1) < 1e-6);
    const f2 = find(br, s => s.type === 'plane' && Math.abs(s.p.y + 0.01) < 1e-6 && Math.abs(Math.abs(s.n.y) - 1) < 1e-6);
    // expected distance between the two walls after a world-space scale S = diag(2,1,1)
    const S = new T.Matrix4().makeScale(2, 1, 1), M = S.clone().multiply(rest);
    const p1 = new T.Vector3(0, 0.01, 0).applyMatrix4(M), p2 = new T.Vector3(0, -0.01, 0).applyMatrix4(M);
    const n = new T.Vector3(0, 1, 0).applyMatrix3(new T.Matrix3().getNormalMatrix(M)).normalize();
    out.expected = (Math.abs(p1.clone().sub(p2).dot(n)) * 1000).toFixed(2);
    br.restMatrix.copy(M);
    const A = __qs.faceEntity(br, f1, null), B = __qs.faceEntity(br, f2, null);
    out.walls = __qs.relate(A, B, __qs.minDistance(A, B)).rows.map(r => r.join(' ')).join(' | ');
    br.restMatrix.copy(rest);
    const pl = __qs.parts.find(p => p.name === 'plate'), prest = pl.restMatrix.clone();
    const hole = find(pl, s => s.type === 'cylinder' && Math.abs(s.r - 0.005) < 1e-9 && s.hole);
    pl.restMatrix.copy(new T.Matrix4().makeScale(1, 2, 1).multiply(prest));
    const H = __qs.faceEntity(pl, hole, null), dH = __qs.describe(H);
    out.stretched = H.geom.type + ' exact=' + H.exact + ' | ' + dH.title + ' | ' + dH.rows.map(r => r.join(' ')).join(' | ');
    pl.restMatrix.copy(new T.Matrix4().makeScale(2, 2, 2).multiply(prest));
    const U = __qs.faceEntity(pl, hole, null);
    out.uniform = U.geom.type + ' r=' + (U.geom.r * 1000).toFixed(3) + ' exact=' + U.exact;
    pl.restMatrix.copy(prest);
    return out;
  });
  console.log('  walls under diag(2,1,1):', a.walls, '| expected', a.expected);
  check('plane normals through the inverse transpose', a.walls, new RegExp('^distance ' + a.expected.replace('.', '\\.') + ' mm \\| planes parallel'));
  console.log('  hole under diag(1,2,1):', a.stretched);
  check('stretched cylinder becomes freeform, not exact', a.stretched, /^surface exact=false \| Freeform surface \|.*source mesh$/);
  console.log('  hole under uniform x2:', a.uniform);
  check('uniform scale keeps the exact cylinder', a.uniform, /^cylinder r=10\.000 exact=true$/);
  // B. an edge is exact only when both of its exact faces meet in exactly that line or circle
  const b = await pg.evaluate(() => {
    const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), line = [V(0, 0, 0), V(0.01, 0, 0)];
    const plane = (p, n, e = true) => ({type:'plane', p, n:n.normalize(), exact:e});
    const lineCases = {
      'two non-parallel planes': [plane(V(0, 0, 0), V(0, 1, 0)), plane(V(0, 0, 0), V(0, 0, 1))],
      'coplanar planes': [plane(V(0, 0, 0), V(0, 0, 1)), plane(V(0.02, 0, 0), V(0, 0, 1))],
      'plane + B-spline': [plane(V(0, 0, 0), V(0, 1, 0)), {type:'surface', exact:false}],
      'plane + fitted plane': [plane(V(0, 0, 0), V(0, 1, 0)), plane(V(0, 0, 0), V(0, 0, 1), false)],
      'lone exact plane': [plane(V(0, 0, 0), V(0, 1, 0))],
      'plane along cylinder axis': [plane(V(0, 0, 0), V(0, 1, 0)), {type:'cylinder', p:V(0, 0, 0.005), a:V(1, 0, 0), r:0.005, exact:true}],
      'cylinder + B-spline': [{type:'cylinder', p:V(0, 0, 0.005), a:V(1, 0, 0), r:0.005, exact:true}, {type:'surface', exact:false}],
      'plane through cone apex': [plane(V(0, 0, 0), V(0, 1, 0)), {type:'cone', apex:V(-0.02, 0, 0), a:V(1, 0, 1).normalize(), semi:Math.PI/4, exact:true}],
      'cone + B-spline': [{type:'cone', apex:V(-0.02, 0, 0), a:V(1, 0, 1).normalize(), semi:Math.PI/4, exact:true}, {type:'surface', exact:false}],
    };
    const o = {};
    for (const [k, s] of Object.entries(lineCases)){ const g = __qs.classifyEdge(line.map(p => p.clone()), false, s); o[k] = g.type + ' exact=' + g.exact; }
    // a three-point arc on a sphere of radius 10 mm centred at the origin, in the plane z = 6 mm
    const R = 0.010, z = 0.006, rr = Math.sqrt(R*R - z*z), arc = [0, 0.4, 0.8].map(t => V(rr*Math.cos(t), rr*Math.sin(t), z));
    const sphere = {type:'sphere', c:V(0, 0, 0), r:R, exact:true};
    const arcCases = {
      'sphere + B-spline': [sphere, {type:'surface', exact:false}],
      'sphere + exact plane z=6': [sphere, plane(V(0, 0, z), V(0, 0, 1))],
      'sphere + coaxial cylinder': [sphere, {type:'cylinder', p:V(0, 0, 0), a:V(0, 0, 1), r:rr, exact:true}],
      'sphere + off-axis cylinder': [sphere, {type:'cylinder', p:V(0.003, 0, 0), a:V(0, 0, 1), r:rr, exact:true}],
    };
    for (const [k, s] of Object.entries(arcCases)){ const g = __qs.classifyEdge(arc.map(p => p.clone()), false, s); o[k] = g.type + ' exact=' + g.exact + (g.r ? ' r=' + (g.r*1000).toFixed(3) : ''); }
    return o;
  });
  console.log('  edges:', JSON.stringify(b, null, 1));
  const want = {'two non-parallel planes':'line exact=true', 'coplanar planes':'line exact=false', 'plane + B-spline':'line exact=false',
    'plane + fitted plane':'line exact=false', 'lone exact plane':'line exact=false', 'plane along cylinder axis':'line exact=true',
    'cylinder + B-spline':'line exact=false', 'plane through cone apex':'line exact=true', 'cone + B-spline':'line exact=false',
    'sphere + B-spline':'circle exact=false r=8.000', 'sphere + exact plane z=6':'circle exact=true r=8.000',
    'sphere + coaxial cylinder':'circle exact=true r=8.000', 'sphere + off-axis cylinder':'circle exact=false r=8.000'};
  for (const [k, v] of Object.entries(want)) check(k, b[k], new RegExp('^' + v.replace(/[.+]/g, m => '\\' + m) + '$'));
  console.log('  errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
