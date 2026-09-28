// ── Geometry helpers ─────────────────────────────────────────
const _t = new THREE.Vector3();
function anyPerp(a){
  const u = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  return u.addScaledVector(a, -u.dot(a)).normalize();
}
function footOnLine(q, p, a){ return p.clone().addScaledVector(a, _t.subVectors(q, p).dot(a)); }
function footOnPlane(q, p, n){ return q.clone().addScaledVector(n, -_t.subVectors(q, p).dot(n)); }
// closest points of two infinite lines (unit directions)
function closestLines(p1, a1, p2, a2){
  const w = new THREE.Vector3().subVectors(p1, p2), b = a1.dot(a2), d = a1.dot(w), e = a2.dot(w), den = 1 - b*b;
  const s = den > 1e-12 ? (b*e - d) / den : 0, t = den > 1e-12 ? (e - b*d) / den : e;
  const c1 = p1.clone().addScaledVector(a1, s), c2 = p2.clone().addScaledVector(a2, t);
  return {c1, c2, d:c1.distanceTo(c2)};
}
// Gaussian elimination with partial pivoting; null when singular
function solveLin(A, b){
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++){
    let piv = c;
    for (let r = c+1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c+1; r < n; r++){
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n-1; r >= 0; r--){
    let s = M[r][n];
    for (let k = r+1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}
// eigen-decomposition of a symmetric 3×3 matrix (Jacobi), ascending eigenvalues
function eigSym3(S){
  const A = S.map(r => r.slice()), V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let sweep = 0; sweep < 50; sweep++){
    const off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off <= 1e-15 * (Math.abs(A[0][0]) + Math.abs(A[1][1]) + Math.abs(A[2][2])) + 1e-300) break;
    for (const [p, q] of [[0,1],[0,2],[1,2]]){
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th*th + 1));
      const c = 1 / Math.sqrt(t*t + 1), s = t * c;
      for (let k = 0; k < 3; k++){ const x = A[k][p], y = A[k][q]; A[k][p] = c*x - s*y; A[k][q] = s*x + c*y; }
      for (let k = 0; k < 3; k++){ const x = A[p][k], y = A[q][k]; A[p][k] = c*x - s*y; A[q][k] = s*x + c*y; }
      for (let k = 0; k < 3; k++){ const x = V[k][p], y = V[k][q]; V[k][p] = c*x - s*y; V[k][q] = s*x + c*y; }
    }
  }
  const order = [0,1,2].sort((i, j) => A[i][i] - A[j][j]);
  return {values:order.map(i => A[i][i]), vectors:order.map(i => new THREE.Vector3(V[0][i], V[1][i], V[2][i]))};
}
function centroid(P){ const c = new THREE.Vector3(); P.forEach(p => c.add(p)); return c.divideScalar(P.length || 1); }
function fitPlane(P){
  const c = centroid(P), M = [[0,0,0],[0,0,0],[0,0,0]];
  for (const p of P){
    const x = p.x-c.x, y = p.y-c.y, z = p.z-c.z;
    M[0][0] += x*x; M[0][1] += x*y; M[0][2] += x*z; M[1][1] += y*y; M[1][2] += y*z; M[2][2] += z*z;
  }
  M[1][0] = M[0][1]; M[2][0] = M[0][2]; M[2][1] = M[1][2];
  const n = eigSym3(M).vectors[0].normalize();
  let dev = 0;
  for (const p of P) dev = Math.max(dev, Math.abs(_t.subVectors(p, c).dot(n)));
  return {c, n, dev};
}
// least-squares circle through 2D points: algebraic (Kåsa) start, geometric Gauss–Newton finish
function fitCircle2(xs, ys){
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0, my = 0, s = 0;
  for (let i = 0; i < n; i++){ mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  for (let i = 0; i < n; i++) s += Math.hypot(xs[i]-mx, ys[i]-my);
  s /= n;
  if (!(s > 0)) return null;
  let Suu = 0, Suv = 0, Svv = 0, Su = 0, Sv = 0, Suz = 0, Svz = 0, Sz = 0;
  for (let i = 0; i < n; i++){
    const u = (xs[i]-mx)/s, v = (ys[i]-my)/s, z = u*u + v*v;
    Suu += u*u; Suv += u*v; Svv += v*v; Su += u; Sv += v; Suz += u*z; Svz += v*z; Sz += z;
  }
  const k = solveLin([[Suu,Suv,Su],[Suv,Svv,Sv],[Su,Sv,n]], [-Suz,-Svz,-Sz]);
  if (!k) return null;
  let cx = -k[0]/2, cy = -k[1]/2, r = Math.sqrt(cx*cx + cy*cy - k[2]);
  if (!Number.isFinite(r)) return null;
  for (let it = 0; it < 20; it++){
    const J = [[0,0,0],[0,0,0],[0,0,0]], g = [0,0,0];
    for (let i = 0; i < n; i++){
      const dx = (xs[i]-mx)/s - cx, dy = (ys[i]-my)/s - cy, d = Math.hypot(dx, dy) || 1e-12;
      const j = [-dx/d, -dy/d, -1], res = d - r;
      for (let a = 0; a < 3; a++){ g[a] -= j[a]*res; for (let b = 0; b < 3; b++) J[a][b] += j[a]*j[b]; }
    }
    const st = solveLin(J, g);
    if (!st) break;
    cx += st[0]; cy += st[1]; r += st[2];
    if (Math.abs(st[0]) + Math.abs(st[1]) + Math.abs(st[2]) < 1e-13) break;
  }
  return {cx:mx + cx*s, cy:my + cy*s, r:Math.abs(r)*s};
}
// cylinder: its axis is the one direction every surface normal is perpendicular to
function fitCylinder(P, N){
  if (P.length < 4 || N.length < 3) return null;
  const M = [[0,0,0],[0,0,0],[0,0,0]];
  for (const n of N){
    M[0][0] += n.x*n.x; M[0][1] += n.x*n.y; M[0][2] += n.x*n.z; M[1][1] += n.y*n.y; M[1][2] += n.y*n.z; M[2][2] += n.z*n.z;
  }
  M[1][0] = M[0][1]; M[2][0] = M[0][2]; M[2][1] = M[1][2];
  const e = eigSym3(M);
  if (!(e.values[1] > 0) || e.values[0] > 0.02 * e.values[1]) return null;
  const a = e.vectors[0].normalize(), u = anyPerp(a), v = a.clone().cross(u);
  const xs = [], ys = [];
  let hm = 0;
  for (const p of P){ xs.push(p.dot(u)); ys.push(p.dot(v)); hm += p.dot(a); }
  const c = fitCircle2(xs, ys);
  if (!c) return null;
  let dev = 0;
  for (let i = 0; i < P.length; i++) dev = Math.max(dev, Math.abs(Math.hypot(xs[i]-c.cx, ys[i]-c.cy) - c.r));
  return {p:u.multiplyScalar(c.cx).addScaledVector(v, c.cy).addScaledVector(a, hm / P.length), a, r:c.r, dev};
}
function fitSphere(P){
  const n = P.length;
  if (n < 5) return null;
  const m = centroid(P);
  let s = 0;
  for (const p of P) s += p.distanceTo(m);
  s /= n;
  if (!(s > 0)) return null;
  const A = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], b = [0,0,0,0];
  for (const p of P){
    const x = (p.x-m.x)/s, y = (p.y-m.y)/s, z = (p.z-m.z)/s, w = -(x*x + y*y + z*z), row = [x, y, z, 1];
    for (let i = 0; i < 4; i++){ b[i] += row[i]*w; for (let j = 0; j < 4; j++) A[i][j] += row[i]*row[j]; }
  }
  const k = solveLin(A, b);
  if (!k) return null;
  const cx = -k[0]/2, cy = -k[1]/2, cz = -k[2]/2, r2 = cx*cx + cy*cy + cz*cz - k[3];
  if (!(r2 > 0)) return null;
  const c = new THREE.Vector3(m.x + cx*s, m.y + cy*s, m.z + cz*s), r = Math.sqrt(r2) * s;
  let dev = 0;
  for (const p of P) dev = Math.max(dev, Math.abs(p.distanceTo(c) - r));
  return {c, r, dev};
}

