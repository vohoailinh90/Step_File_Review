function surfFromBrep(d){
  const V = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? new THREE.Vector3(a[0], a[1], a[2]) : null;
  const dir = a => { const v = V(a); return v && v.lengthSq() > 0 ? v.normalize() : null; };
  const len = x => Number.isFinite(x) && x > 0;
  if (d.type === 'plane'){ const p = V(d.origin), n = dir(d.normal); return p && n ? {type:'plane', p, n} : null; }
  if (d.type === 'cylinder'){ const p = V(d.origin), a = dir(d.axis); return p && a && len(d.radius) ? {type:'cylinder', p, a, r:d.radius} : null; }
  if (d.type === 'cone'){
    const apex = V(d.apex), a = dir(d.axis);
    return apex && a && Number.isFinite(d.semi_angle) && d.semi_angle !== 0 ? {type:'cone', apex, a, semi:Math.abs(d.semi_angle)} : null;
  }
  if (d.type === 'sphere'){ const c = V(d.center); return c && len(d.radius) ? {type:'sphere', c, r:d.radius} : null; }
  if (d.type === 'torus'){
    const c = V(d.center), a = dir(d.axis);
    return c && a && len(d.major_radius) && len(d.minor_radius) ? {type:'torus', c, a, R:d.major_radius, r:d.minor_radius} : null;
  }
  return null;
}
function surfDist(s, v){
  switch (s.type){
    case 'plane': return Math.abs(_t.subVectors(v, s.p).dot(s.n));
    case 'cylinder': { _t.subVectors(v, s.p); const h = _t.dot(s.a); return Math.abs(_t.addScaledVector(s.a, -h).length() - s.r); }
    case 'cone': {
      _t.subVectors(v, s.apex); const h = _t.dot(s.a), rho = _t.addScaledVector(s.a, -h).length();
      return Math.abs(rho * Math.cos(s.semi) - Math.abs(h) * Math.sin(s.semi));
    }
    case 'sphere': return Math.abs(v.distanceTo(s.c) - s.r);
    case 'torus': {
      _t.subVectors(v, s.c); const h = _t.dot(s.a), rho = _t.addScaledVector(s.a, -h).length();
      return Math.abs(Math.hypot(rho - s.R, h) - s.r);
    }
  }
  return 0;
}
function onSurface(s, P, size, diag){
  const tol = Math.max(1e-4 * (s.r || size), 1e-5 * size, 1e-6 * diag);
  const step = Math.max(1, Math.floor(P.length / 64));
  for (let i = 0; i < P.length; i += step) if (!(surfDist(s, P[i]) <= tol)) return false;
  return true;
}
// Without B-rep data: plane, then cylinder, then sphere. OpenCASCADE puts mesh vertices
// exactly on the surface, so the fits are held to tight tolerances, and where the mesh has
// true vertex normals (smoothN) they must agree too. A sphere also needs a vertex inside the
// face: a band whose vertices all sit on its two rims (a chamfer) fits a sphere as well.
function fitSurface(P, N, smoothN, inner, size, diag){
  if (P.length >= 3){
    const pl = fitPlane(P);
    if (pl.dev <= Math.max(1e-5 * size, 1e-6 * diag)) return {type:'plane', p:pl.c, n:pl.n};
  }
  const radial = (i, o, a) => { _t.subVectors(P[i], o); if (a) _t.addScaledVector(a, -_t.dot(a)); return _t.normalize(); };
  const normalsFit = (o, a) => !smoothN || N.every((n, i) => Math.abs(n.dot(radial(i, o, a))) > 0.9994);   // within 2°
  const cy = fitCylinder(P, N);
  if (cy && cy.r < 1e3 * size && cy.dev <= Math.max(2e-4 * cy.r, 1e-6 * diag) && normalsFit(cy.p, cy.a))
    return {type:'cylinder', p:cy.p, a:cy.a, r:cy.r};
  const sp = inner ? fitSphere(P) : null;
  if (sp && sp.r < 1e3 * size && sp.dev <= Math.max(2e-4 * sp.r, 1e-6 * diag) && normalsFit(sp.c, null))
    return {type:'sphere', c:sp.c, r:sp.r};
  return {type:'surface'};
}
// Which way a plane faces, whether a cylinder or sphere is convex (a boss) or concave
// (a hole), and how far an axial surface runs along its axis and away from it.
function shapeSurface(s, P, tris, topo, pos){
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let facing = 0, bulge = 0;
  if (s.type === 'plane' || s.type === 'cylinder' || s.type === 'sphere'){
    for (let i = 0; i < tris.length; i++){
      const t = tris[i]*3;
      a.fromBufferAttribute(pos, topo.vert[t]); b.fromBufferAttribute(pos, topo.vert[t+1]); c.fromBufferAttribute(pos, topo.vert[t+2]);
      n.subVectors(b, a).cross(_t.subVectors(c, a));          // normal scaled by twice the area
      if (s.type === 'plane'){ facing += n.dot(s.n); continue; }
      _t.addVectors(a, b).add(c).divideScalar(3);
      if (s.type === 'cylinder'){ _t.sub(s.p); _t.addScaledVector(s.a, -_t.dot(s.a)); }
      else _t.sub(s.c);
      bulge += n.dot(_t);
    }
  }
  if (s.type === 'plane' && facing < 0) s.n.negate();
  if (s.type === 'cylinder' || s.type === 'sphere') s.hole = bulge < 0;
  const o = s.type === 'cylinder' ? s.p : s.type === 'cone' ? s.apex : s.type === 'torus' ? s.c : null;
  if (!o) return;
  let h0 = Infinity, h1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (const p of P){
    _t.subVectors(p, o);
    const h = _t.dot(s.a), rho = _t.addScaledVector(s.a, -h).length();
    h0 = Math.min(h0, h); h1 = Math.max(h1, h); r0 = Math.min(r0, rho); r1 = Math.max(r1, rho);
  }
  Object.assign(s, {h0, h1, rMin:r0, rMax:r1});
}
// A local surface description carried into world space by a part's matrix. A plane survives
// any affine map (its normal goes through the inverse transpose); circles only survive a
// similarity — rotation, mirror and one uniform scale — so under a non-uniform scale or a shear
// a curved surface is reported as freeform rather than with a wrong radius.
const _nm = new THREE.Matrix3();
function isSimilarity(m){
  const e = m.elements, c = [0, 4, 8].map(i => new THREE.Vector3(e[i], e[i+1], e[i+2])), l = c.map(v => v.length());
  const tol = 1e-6 * Math.max(l[0], l[1], l[2]);
  return Math.abs(l[0] - l[1]) <= tol && Math.abs(l[0] - l[2]) <= tol &&
         Math.abs(c[0].dot(c[1])) <= tol * l[0] && Math.abs(c[0].dot(c[2])) <= tol * l[0] && Math.abs(c[1].dot(c[2])) <= tol * l[1];
}
function surfToWorld(s, m){
  if (s.type === 'plane') return {type:'plane', p:s.p.clone().applyMatrix4(m), n:s.n.clone().applyMatrix3(_nm.getNormalMatrix(m)).normalize()};
  if (s.type === 'surface' || !isSimilarity(m)) return {type:'surface'};
  const k = Math.cbrt(Math.abs(m.determinant())) || 1, o = Object.assign({}, s);
  ['p', 'c', 'apex'].forEach(key => { if (s[key]) o[key] = s[key].clone().applyMatrix4(m); });
  if (s.a) o.a = s.a.clone().transformDirection(m);
  ['r', 'R', 'h0', 'h1', 'rMin', 'rMax'].forEach(key => { if (s[key] !== undefined) o[key] = s[key] * k; });
  return o;
}
// A picked face in assembled world coordinates: its triangles, surface and area.
// `hit` is the picked point, also in assembled coordinates.
function faceEntity(part, f, hit){
  const geo = part.mesh.geometry, topo = topology(geo), info = faceInfo(geo, f), m = part.restMatrix;
  const pos = geo.attributes.position, tris = info.tris, prims = new Float64Array(tris.length * 9), v = new THREE.Vector3();
  for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++){
    v.fromBufferAttribute(pos, topo.vert[tris[i]*3 + k]).applyMatrix4(m);
    prims[i*9 + k*3] = v.x; prims[i*9 + k*3 + 1] = v.y; prims[i*9 + k*3 + 2] = v.z;
  }
  let area = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < prims.length; i += 9){
    e1.set(prims[i+3]-prims[i], prims[i+4]-prims[i+1], prims[i+5]-prims[i+2]);
    e2.set(prims[i+6]-prims[i], prims[i+7]-prims[i+1], prims[i+8]-prims[i+2]);
    area += e1.cross(e2).length() / 2;
  }
  const geom = surfToWorld(info.surf, m);
  return {kind:'face', part, key:'f' + f, geom, exact:info.exact && geom.type === info.surf.type, area,
          prims, stride:9, count:tris.length, hit: hit ? hit.clone() : new THREE.Vector3(prims[0], prims[1], prims[2])};
}
function entityOverlay(ent, color){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ent.prims), 3));
  const o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent:true, opacity:.5, side:THREE.DoubleSide,
    depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}));
  o.renderOrder = 3;
  follow(o, ent.part, null);
  scene.add(o);
  return o;
}
const FACE_FOOT = {
  brep:'Exact B-rep face from the STEP file.',
  index:'B-rep face recovered from the mesh; its surface is fitted to the vertices.',
  angle:'Face is grown across triangles up to a 20° break angle.'
};
function selectFace(part, faceIndex, point){
  const topo = topology(part.mesh.geometry);
  const ent = faceEntity(part, topo.faceId[faceIndex], point);
  faceOverlay = entityOverlay(ent, 0xff7a45);
  const d = describe(ent);
  showInfo({title:'FACE', rows:[['part', part.name], ['triangles', ent.count.toLocaleString()],
                                ['type', d.title.toLowerCase()], ...d.rows], foot:FACE_FOOT[topo.source]});
}

