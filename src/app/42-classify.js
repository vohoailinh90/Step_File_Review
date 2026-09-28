// What an edge is: a circle or arc (snapped to an adjacent cylinder, cone, torus or sphere), a
// straight line, or some other curve. A handful of mesh points fits a circle on a sphere, or a
// line, whatever the real curve is, so an edge is only exact when both of its B-rep faces are
// exact and meet in exactly that circle or line.
function classifyEdge(pts, closed, surfs){
  const n = pts.length;
  let len = 0;
  for (let i = 1; i < n; i++) len += pts[i].distanceTo(pts[i-1]);
  if (closed) len += pts[n-1].distanceTo(pts[0]);
  for (const s of surfs){
    const c = circleOn(s, pts);
    if (!c) continue;
    let exact = false;
    for (const o of surfs){
      const e = s.exact && o !== s && o.exact ? exactCircle(s, o, c) : null;
      if (e){ Object.assign(c, e); exact = true; break; }
    }
    return circleEdge(c, pts, closed, exact);
  }
  if (!closed){
    const p0 = pts[0], p1 = pts[n-1], l = p0.distanceTo(p1);
    if (l > 0){
      const d = p1.clone().sub(p0).divideScalar(l);
      let dev = 0;
      for (const p of pts){ _t.subVectors(p, p0); dev = Math.max(dev, _t.addScaledVector(d, -_t.dot(d)).length()); }
      if (dev <= 1e-5 * l) return {type:'line', p0:p0.clone(), p1:p1.clone(), d, len:l, exact:straightByFaces(surfs, p0, d, l)};
    }
  }
  if (n >= 4 || (closed && n >= 3)){
    const pl = fitPlane(pts), size = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
    if (pl.dev <= 1e-4 * size){
      const u = anyPerp(pl.n), v = pl.n.clone().cross(u), xs = pts.map(p => p.dot(u)), ys = pts.map(p => p.dot(v));
      const cf = fitCircle2(xs, ys);
      let dev = 0;
      if (cf) for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(Math.hypot(xs[i]-cf.cx, ys[i]-cf.cy) - cf.r));
      if (cf && dev <= 1e-3 * cf.r){
        const c = u.multiplyScalar(cf.cx).addScaledVector(v, cf.cy).addScaledVector(pl.n, pl.c.dot(pl.n));
        return circleEdge({c, a:pl.n, r:cf.r}, pts, closed, false);
      }
    }
  }
  return {type:'curve', len, exact:false};
}
// Two exact faces meeting in straight lines: planes that are not parallel (coplanar faces can
// share a curved edge), a plane along a cylinder's axis or through a cone's apex, or two
// cylinders with parallel axes that are not patches of one cylinder (which, like coplanar
// faces, can share any curve).
function straightByFaces(surfs, p0, d, l){
  if (surfs.length !== 2 || !surfs.every(s => s.exact)) return false;
  const [a, b] = surfs[1].type === 'plane' ? [surfs[1], surfs[0]] : surfs;
  const tol = 1e-6 * (l + modelSize);
  if (a.type === 'plane' && b.type === 'plane') return Math.abs(a.n.dot(b.n)) < PAR;
  if (a.type === 'plane' && b.type === 'cylinder') return Math.abs(a.n.dot(b.a)) <= PERP && Math.abs(d.dot(b.a)) >= PAR;
  if (a.type === 'plane' && b.type === 'cone')
    return Math.abs(_t.subVectors(b.apex, a.p).dot(a.n)) <= tol && _t.subVectors(p0, b.apex).cross(d).length() <= tol;
  if (a.type === 'cylinder' && b.type === 'cylinder'){
    const one = Math.abs(a.r - b.r) <= tol && _t.subVectors(b.p, a.p).cross(a.a).length() <= tol;
    return !one && Math.abs(a.a.dot(b.a)) >= PAR && Math.abs(d.dot(a.a)) >= PAR;
  }
  return false;
}
// The circle where exact surface s (the one mesh circle c was found on) meets exact surface o.
// Two surfaces meet in circles when they turn about one axis — a plane counts when square to it,
// and a sphere turns about any line through its centre — so cut both with a half-plane through
// that axis and cross their profiles, lines and circles in (ρ, z). Centre and radius then come
// from the surface parameters, not the mesh; the crossing that matches mesh circle c is the edge.
function exactCircle(s, o, c){
  const tol = 1e-4 * c.r + 1e-6 * modelSize;
  const own = t => t.type === 'cylinder' ? {p:t.p, a:t.a} : t.type === 'cone' ? {p:t.apex, a:t.a} : t.type === 'torus' ? {p:t.c, a:t.a} : null;
  const sph = [s, o].filter(t => t.type === 'sphere'), pl = [s, o].find(t => t.type === 'plane');
  let ax = own(s) || own(o);
  if (!ax && sph.length){                                   // spheres: through both centres, or square to the plane
    const d = sph.length === 2 ? _t.subVectors(sph[1].c, sph[0].c) : pl ? pl.n : null;
    if (d && d.length() > tol) ax = {p:sph[0].c, a:d.clone().normalize()};
  }
  if (!ax) return null;
  const O = ax.p, a = ax.a, z = p => _t.subVectors(p, O).dot(a);
  const rho = p => { _t.subVectors(p, O); return _t.addScaledVector(a, -_t.dot(a)).length(); };
  // the profile: lines [ρ, z, dρ, dz] through a point along a unit direction, circles [ρ, z, r]
  const profile = t => {
    const f = own(t);
    if (f && (Math.abs(f.a.dot(a)) < PAR || rho(f.p) > tol)) return null;          // not on this axis
    switch (t.type){
      case 'plane': return Math.abs(t.n.dot(a)) < PAR ? null : {L:[[0, _t.subVectors(t.p, O).dot(t.n) / t.n.dot(a), 1, 0]], C:[]};
      case 'cylinder': return {L:[[t.r, 0, 0, 1]], C:[]};
      case 'cone': { const za = z(t.apex), sn = Math.sin(t.semi), cs = Math.cos(t.semi); return {L:[[0, za, sn, cs], [0, za, sn, -cs]], C:[]}; }
      case 'sphere': return rho(t.c) > tol ? null : {L:[], C:[[0, z(t.c), t.r]]};
      case 'torus': { const zc = z(t.c); return {L:[], C:[[t.R, zc, t.r], [-t.R, zc, t.r]]}; }
    }
    return null;
  };
  const P = profile(s), Q = profile(o);
  if (!P || !Q) return null;
  const hits = [], put = (r, h) => { if (r > 0) hits.push({c:O.clone().addScaledVector(a, h), a:a.clone(), r}); };
  const root = q => q < -4 * tol * tol ? null : Math.sqrt(Math.max(q, 0));        // tangent profiles give q ≈ 0
  const lineLine = ([x1, z1, u1, w1], [x2, z2, u2, w2]) => {
    const den = u1 * w2 - w1 * u2;
    if (Math.abs(den) < 1e-9) return;                                             // parallel: no single crossing
    const t = ((x2 - x1) * w2 - (z2 - z1) * u2) / den;
    put(x1 + t * u1, z1 + t * w1);
  };
  const lineCircle = ([x, h, u, w], [cx, cz, r]) => {
    const b = u * (x - cx) + w * (h - cz), q = root(b * b - (x - cx) ** 2 - (h - cz) ** 2 + r * r);
    if (q !== null) for (const t of [q - b, -q - b]) put(x + t * u, h + t * w);
  };
  const circleCircle = ([x1, z1, r1], [x2, z2, r2]) => {
    const D = Math.hypot(x2 - x1, z2 - z1);
    if (D <= tol) return;                                                         // concentric: never a single circle
    const m = (r1 * r1 - r2 * r2 + D * D) / (2 * D), q = root(r1 * r1 - m * m), ux = (x2 - x1) / D, uz = (z2 - z1) / D;
    if (q !== null) for (const k of [q, -q]) put(x1 + m * ux - k * uz, z1 + m * uz + k * ux);
  };
  for (const l of P.L){ Q.L.forEach(k => lineLine(l, k)); Q.C.forEach(k => lineCircle(l, k)); }
  for (const l of P.C){ Q.L.forEach(k => lineCircle(k, l)); Q.C.forEach(k => circleCircle(l, k)); }
  return hits.find(x => Math.abs(x.r - c.r) <= tol && x.c.distanceTo(c.c) <= tol) || null;
}
function circleOn(s, pts){
  if (s.type === 'cylinder' || s.type === 'cone' || s.type === 'torus'){
    const o = s.type === 'cylinder' ? s.p : s.type === 'cone' ? s.apex : s.c;
    let h0 = Infinity, h1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const p of pts){
      _t.subVectors(p, o);
      const h = _t.dot(s.a), rho = _t.addScaledVector(s.a, -h).length();
      h0 = Math.min(h0, h); h1 = Math.max(h1, h); r0 = Math.min(r0, rho); r1 = Math.max(r1, rho);
    }
    const r = s.type === 'cylinder' ? s.r : (r0 + r1) / 2, tol = 1e-4 * r;
    if (!(r > 0) || h1 - h0 > tol || r1 - r0 > tol || Math.abs(r0 - r) > tol) return null;
    return {c:o.clone().addScaledVector(s.a, (h0 + h1) / 2), a:s.a.clone(), r};
  }
  if (s.type === 'sphere' && pts.length >= 3){
    const pl = fitPlane(pts);
    if (pl.dev > 1e-4 * s.r) return null;
    const d = _t.subVectors(s.c, pl.c).dot(pl.n), r2 = s.r*s.r - d*d;
    if (!(r2 > 0)) return null;
    const c = s.c.clone().addScaledVector(pl.n, -d), r = Math.sqrt(r2);
    if (pts.some(p => Math.abs(p.distanceTo(c) - r) > 1e-4 * s.r)) return null;
    return {c, a:pl.n.clone(), r};
  }
  return null;
}
function circleEdge(c, pts, closed, exact){
  let sweep = 2 * Math.PI;
  if (!closed){
    const u = anyPerp(c.a), v = c.a.clone().cross(u);
    let prev = null;
    sweep = 0;
    for (const p of pts){
      _t.subVectors(p, c.c);
      const ang = Math.atan2(_t.dot(v), _t.dot(u));
      if (prev !== null){ let d = ang - prev; if (d > Math.PI) d -= 2*Math.PI; else if (d < -Math.PI) d += 2*Math.PI; sweep += d; }
      prev = ang;
    }
    sweep = Math.abs(sweep);
  }
  return {type:'circle', c:c.c, a:c.a, r:c.r, closed, sweep, len:c.r * sweep, exact:!!exact};
}

// dimension items: points in assembled coordinates, each with the part it rides on
function radialDir(c, a, toward){
  const u = toward ? toward.clone().sub(c) : new THREE.Vector3();
  if (a) u.addScaledVector(a, -u.dot(a));
  return u.lengthSq() > 1e-24 ? u.normalize() : anyPerp(a || new THREE.Vector3(0, 0, 1));
}
function diaDim(part, c, a, r, toward){
  const u = radialDir(c, a, toward);
  return {type:'dim', a:{part, p:c.clone().addScaledVector(u, -r)}, b:{part, p:c.clone().addScaledVector(u, r)}, value:2*r, prefix:'Ø'};
}
function radDim(part, c, a, r, toward){
  const u = radialDir(c, a, toward);
  return {type:'dim', a:{part, p:c.clone()}, b:{part, p:c.clone().addScaledVector(u, r)}, value:r, prefix:'R', single:true};
}
function axisMark(part, p, a, h0, h1){
  const ext = 0.12 * (h1 - h0) + modelSize * 0.01;
  return {type:'center', a:{part, p:p.clone().addScaledVector(a, h0 - ext)}, b:{part, p:p.clone().addScaledVector(a, h1 + ext)}};
}

// Size and type of one picked face or edge: panel rows plus the dimensions to draw.
function describe(e){
  const g = e.geom, rows = [], items = [], marks = [];
  const lin = v => L(v) + MM(), dir = v => [v.x, v.y, v.z].map(x => x.toFixed(3)).join(', ');
  const at = v => [v.x, v.y, v.z].map(x => L(Math.abs(x) < modelSize * 1e-9 ? 0 : x)).join(', ');   // no -8e-16
  const deg = r => (r * 180 / Math.PI).toFixed(2) + '°';
  let title = 'Freeform surface', short = '';
  if (e.kind === 'edge') marks.push({type:'edge', part:e.part, pts:e.pts, closed:e.closed, color:e.color || COL_A});
  switch (g.type){
    case 'plane':
      title = 'Plane';
      rows.push(['normal', dir(g.n)]);
      break;
    case 'cylinder':
      title = g.hole ? 'Cylinder (hole)' : 'Cylinder (boss)'; short = 'Ø' + L(2*g.r);
      rows.push(['diameter', 'Ø' + lin(2*g.r)], ['radius', 'R' + lin(g.r)], ['length (mesh)', lin(g.h1 - g.h0)], ['axis', dir(g.a)]);
      items.push(diaDim(e.part, footOnLine(e.hit, g.p, g.a), g.a, g.r, e.hit));
      marks.push(axisMark(e.part, g.p, g.a, g.h0, g.h1));
      break;
    case 'cone':
      title = 'Cone'; short = deg(2*g.semi);
      rows.push(['included angle', deg(2*g.semi)], ['diameter (mesh)', 'Ø' + L(2*g.rMin) + ' – Ø' + lin(2*g.rMax)],
                ['length (mesh)', lin(g.h1 - g.h0)], ['axis', dir(g.a)]);
      items.push({type:'tag', a:{part:e.part, p:e.hit.clone()}, text:deg(2*g.semi)});
      marks.push(axisMark(e.part, g.apex, g.a, g.h0, g.h1));
      break;
    case 'sphere':
      title = g.hole ? 'Sphere (socket)' : 'Sphere'; short = 'Ø' + L(2*g.r);
      rows.push(['diameter', 'Ø' + lin(2*g.r)], ['radius', 'R' + lin(g.r)], ['centre', at(g.c)]);
      items.push(diaDim(e.part, g.c, null, g.r, e.hit));
      break;
    case 'torus':
      title = 'Torus'; short = 'R' + L(g.r);
      rows.push(['tube radius', 'R' + lin(g.r)], ['ring radius', 'R' + lin(g.R)], ['axis', dir(g.a)]);
      items.push(radDim(e.part, g.c.clone().addScaledVector(radialDir(g.c, g.a, e.hit), g.R), null, g.r, e.hit));
      break;
    case 'line':
      title = 'Straight edge'; short = lin(g.len);
      rows.push(['length', lin(g.len)], ['direction', dir(g.d)]);
      items.push({type:'tag', a:{part:e.part, p:g.p0.clone().lerp(g.p1, .5)}, value:g.len});
      break;
    case 'circle':
      title = g.closed ? 'Circle' : 'Arc'; short = g.closed ? 'Ø' + L(2*g.r) : 'R' + L(g.r);
      rows.push(['diameter', 'Ø' + lin(2*g.r)], ['radius', 'R' + lin(g.r)], ['centre', at(g.c)], ['axis', dir(g.a)]);
      if (!g.closed) rows.push(['arc angle', deg(g.sweep)], ['arc length', lin(g.len)]);
      items.push(g.closed ? diaDim(e.part, g.c, g.a, g.r, e.hit) : radDim(e.part, g.c, g.a, g.r, e.hit));
      break;
    case 'curve':
      title = 'Curve'; short = lin(g.len);
      rows.push(['length', lin(g.len)]);
      items.push({type:'tag', a:{part:e.part, p:e.hit.clone()}, value:g.len});
      break;
  }
  if (e.kind === 'face'){
    rows.push(['area (mesh)', A2(e.area) + MM2()]);      // summed over the triangles, even when exact
    // a plane or freeform face has no other size: label its area, so Keep and screenshots carry it
    if (!items.length) items.push({type:'tag', a:{part:e.part, p:e.hit.clone()}, prefix:'area ', value:e.area, area:true});
  }
  rows.push(['source', SOURCES[provenance(e)]]);
  return {title, short, rows, items, marks};
}

// where a pick's numbers come from, strongest first; a pair is only as good as its weaker pick
const SOURCES = ['exact (STEP B-rep)', 'fitted to the mesh', 'mesh'];
const provenance = e => e.exact ? 0 : ['surface', 'curve', 'line'].includes(e.geom.type) ? 2 : 1;

function axisOf(g){
  if (g.type === 'cylinder') return {p:g.p, a:g.a};
  if (g.type === 'cone') return {p:g.apex, a:g.a};
  if (g.type === 'torus' || g.type === 'circle') return {p:g.c, a:g.a};
  return null;
}
