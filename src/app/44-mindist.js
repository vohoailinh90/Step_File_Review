// ── Minimum distance ─────────────────────────────────────────
// Between the geometry actually picked — the triangles of a face, the segments of an edge —
// using a small bounding-box tree per pick, searched pairwise: exact on the tessellation.
function bvh(e){
  if (e.bvh) return e.bvh;
  const P = e.prims, S = e.stride, nv = S / 3, n = e.count, order = new Int32Array(n), cen = new Float64Array(n * 3);
  for (let i = 0; i < n; i++){
    order[i] = i;
    for (let k = 0; k < 3; k++){ let s = 0; for (let v = 0; v < nv; v++) s += P[i*S + v*3 + k]; cen[i*3 + k] = s / nv; }
  }
  const build = (lo, hi) => {
    const nd = {lo, hi, min:[Infinity, Infinity, Infinity], max:[-Infinity, -Infinity, -Infinity], l:null, r:null};
    for (let j = lo; j < hi; j++){
      const o = order[j] * S;
      for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++){
        const x = P[o + v*3 + k];
        if (x < nd.min[k]) nd.min[k] = x;
        if (x > nd.max[k]) nd.max[k] = x;
      }
    }
    if (hi - lo > 4){
      let ax = 0;
      for (let k = 1; k < 3; k++) if (nd.max[k] - nd.min[k] > nd.max[ax] - nd.min[ax]) ax = k;
      const mid = (lo + hi) >> 1;
      nthElement(order, lo, hi, mid, i => cen[i*3 + ax]);
      nd.l = build(lo, mid); nd.r = build(mid, hi);
    }
    return nd;
  };
  return e.bvh = {root:build(0, n), order};
}
// reorders a[lo..hi) so that a[k] holds what a full sort by key would put there
function nthElement(a, lo, hi, k, key){
  hi--;
  while (hi > lo){
    const pv = key(a[(lo + hi) >> 1]);
    let i = lo, j = hi;
    while (i <= j){
      while (key(a[i]) < pv) i++;
      while (key(a[j]) > pv) j--;
      if (i <= j){ const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}
function boxDist2(a, b){
  let s = 0;
  for (let k = 0; k < 3; k++){ const d = Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k], 0); s += d*d; }
  return s;
}
function minDistance(A, B){
  const ta = bvh(A), tb = bvh(B), pa = new THREE.Vector3(), pb = new THREE.Vector3(), stack = [ta.root, tb.root];
  let best = Infinity;
  while (stack.length && best > 0){
    const nb = stack.pop(), na = stack.pop();
    if (boxDist2(na, nb) >= best) continue;
    if (!na.l && !nb.l){
      for (let x = na.lo; x < na.hi; x++) for (let y = nb.lo; y < nb.hi; y++){
        if (primDist(A, ta.order[x], B, tb.order[y]) < best){ best = _pd; pa.copy(_ca); pb.copy(_cb); }
      }
    } else if (!nb.l || (na.l && na.hi - na.lo >= nb.hi - nb.lo)){
      if (boxDist2(na.l, nb) < boxDist2(na.r, nb)) stack.push(na.r, nb, na.l, nb); else stack.push(na.l, nb, na.r, nb);
    } else {
      if (boxDist2(na, nb.l) < boxDist2(na, nb.r)) stack.push(na, nb.r, na, nb.l); else stack.push(na, nb.l, na, nb.r);
    }
  }
  return {d:Math.sqrt(best), pa, pb};
}
const _va = [0,1,2].map(() => new THREE.Vector3()), _vb = [0,1,2].map(() => new THREE.Vector3());
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _q1 = new THREE.Vector3(), _q2 = new THREE.Vector3();
let _pd = Infinity;
function closer(p, q){ const d = p.distanceToSquared(q); if (d < _pd){ _pd = d; _ca.copy(p); _cb.copy(q); } }
function loadPrim(e, i, out){
  const P = e.prims, o = i * e.stride, n = e.stride / 3;
  for (let v = 0; v < n; v++) out[v].set(P[o + v*3], P[o + v*3 + 1], P[o + v*3 + 2]);
  return n;
}
// squared distance between two triangles / segments; closest points left in _ca, _cb
function primDist(A, i, B, j){
  const na = loadPrim(A, i, _va), nb = loadPrim(B, j, _vb), ea = na === 3 ? 3 : 1, eb = nb === 3 ? 3 : 1;
  _pd = Infinity;
  for (let x = 0; x < ea; x++) for (let y = 0; y < eb; y++){
    segSeg(_va[x], _va[(x+1) % na], _vb[y], _vb[(y+1) % nb], _q1, _q2); closer(_q1, _q2);
  }
  if (nb === 3) for (let x = 0; x < na; x++){ closestOnTri(_va[x], _vb[0], _vb[1], _vb[2], _q2); closer(_va[x], _q2); }
  if (na === 3) for (let y = 0; y < nb; y++){ closestOnTri(_vb[y], _va[0], _va[1], _va[2], _q1); closer(_q1, _vb[y]); }
  // an edge running through a triangle
  if (_pd > 0 && nb === 3) for (let x = 0; x < ea; x++)
    if (segHitsTri(_va[x], _va[(x+1) % na], _vb[0], _vb[1], _vb[2], _q1)){ _pd = 0; _ca.copy(_q1); _cb.copy(_q1); break; }
  if (_pd > 0 && na === 3) for (let y = 0; y < eb; y++)
    if (segHitsTri(_vb[y], _vb[(y+1) % nb], _va[0], _va[1], _va[2], _q1)){ _pd = 0; _ca.copy(_q1); _cb.copy(_q1); break; }
  return _pd;
}
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _rr = new THREE.Vector3();
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
function segSeg(p1, q1, p2, q2, c1, c2){       // Ericson, Real-Time Collision Detection 5.1.9
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _rr.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_rr);
  let s = 0, t = 0;
  if (a > 1e-30 || e > 1e-30){
    if (a <= 1e-30) t = clamp01(f / e);
    else {
      const c = _d1.dot(_rr);
      if (e <= 1e-30) s = clamp01(-c / a);
      else {
        const b = _d1.dot(_d2), den = a*e - b*b;
        s = den > 1e-12 * a * e ? clamp01((b*f - c*e) / den) : 0;
        t = (b*s + f) / e;
        if (t < 0){ t = 0; s = clamp01(-c / a); }
        else if (t > 1){ t = 1; s = clamp01((b - c) / a); }
      }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s); c2.copy(p2).addScaledVector(_d2, t);
}
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _ap = new THREE.Vector3();
function closestOnTri(p, a, b, c, out){       // Ericson 5.1.5
  _ab.subVectors(b, a); _ac.subVectors(c, a); _ap.subVectors(p, a);
  const d1 = _ab.dot(_ap), d2 = _ac.dot(_ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  _ap.subVectors(p, b);
  const d3 = _ab.dot(_ap), d4 = _ac.dot(_ap);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1*d4 - d3*d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(_ab, d1 / (d1 - d3));
  _ap.subVectors(p, c);
  const d5 = _ab.dot(_ap), d6 = _ac.dot(_ap);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5*d2 - d1*d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(_ac, d2 / (d2 - d6));
  const va = d3*d6 - d5*d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return out.copy(b).addScaledVector(_ap.subVectors(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const sum = va + vb + vc;
  if (!(sum > 0)) return out.copy(a);           // degenerate triangle
  return out.copy(a).addScaledVector(_ab, vb / sum).addScaledVector(_ac, vc / sum);
}
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _hh = new THREE.Vector3(), _ss = new THREE.Vector3(), _qq = new THREE.Vector3();
function segHitsTri(p, q, a, b, c, out){      // Möller–Trumbore, limited to the segment
  _d1.subVectors(q, p); _e1.subVectors(b, a); _e2.subVectors(c, a);
  _hh.crossVectors(_d1, _e2);
  const det = _e1.dot(_hh);
  if (Math.abs(det) < 1e-30) return false;
  _ss.subVectors(p, a);
  const u = _ss.dot(_hh) / det;
  if (u < 0 || u > 1) return false;
  _qq.crossVectors(_ss, _e1);
  const v = _d1.dot(_qq) / det;
  if (v < 0 || u + v > 1) return false;
  const t = _e2.dot(_qq) / det;
  if (t < 0 || t > 1) return false;
  out.copy(p).addScaledVector(_d1, t);
  return true;
}

