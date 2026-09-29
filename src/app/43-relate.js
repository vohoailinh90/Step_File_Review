// Distances and angles between two picks. The first row is the headline figure: the
// normal distance between parallel planes, the centre distance of parallel axes, and so on.
// The minimum distance between the actual picked geometry always closes the list.
function relate(A, B, md){
  const rows = [], items = [];
  const RANK = {plane:0, cylinder:1, cone:1, torus:1, circle:1, sphere:2, line:3};
  const rank = e => e.geom.type in RANK ? RANK[e.geom.type] : 9;
  const [X, Y] = rank(B) < rank(A) ? [B, A] : [A, B];
  const gx = X.geom, gy = Y.geom, ax = axisOf(gx), ay = axisOf(gy);
  const eps = modelSize * 1e-7, lin = v => L(Math.abs(v) <= eps ? 0 : v) + MM(), deg = r => (r * 180 / Math.PI).toFixed(2) + '°';   // no 1e-7 mm
  const row = (k, v) => rows.push([k, v]);
  let drawn = false;
  const dim = (e1, p1, e2, p2, value) => {
    if (!(value > eps)) return;
    items.push({type:'dim', a:{part:e1.part, p:p1.clone()}, b:{part:e2.part, p:p2.clone()}, value});
    drawn = true;
  };
  // an angle is drawn too, as a label: where the picks touch, else at the first pick
  const angle = (k, r) => {
    const v = deg(r), [e, p] = md && md.d <= eps ? [A, md.pa] : [X, X.hit];
    row(k, v);
    items.push({type:'tag', a:{part:e.part, p:p.clone()}, text:v});
  };
  const radius = g => g.type === 'cylinder' || g.type === 'circle' ? g.r : null;
  const onAxis = (e, g, a) => g.type === 'circle' ? g.c.clone() : footOnLine(e.hit, a.p, a.a);   // axis point by the pick

  if (gx.type === 'plane' && gy.type === 'plane'){
    const c = Math.abs(gx.n.dot(gy.n));
    if (c >= PAR){
      const d = Math.abs(_t.subVectors(gy.p, gx.p).dot(gx.n));
      row('distance', d <= eps ? '0 (coplanar)' : lin(d));
      row('planes', 'parallel');
      if (md && Math.abs(md.d - d) <= Math.max(eps, d * 1e-4)) dim(A, md.pa, B, md.pb, d);   // faces overlap: draw it there
      else dim(X, X.hit, Y, footOnPlane(X.hit, gy.p, gy.n), d);
    } else angle('angle', Math.acos(c));
  } else if (gx.type === 'plane' && ay){
    const s = Math.abs(gx.n.dot(ay.a)), q = onAxis(Y, gy, ay), d = Math.abs(_t.subVectors(q, gx.p).dot(gx.n));
    if (s <= PERP){                                       // axis parallel to the plane
      row(gy.type === 'circle' ? 'centre to plane' : 'axis to plane', lin(d));
      // to the surface: a cylinder's or circle's radius, or a cone's widest point, off its vertices
      const r = radius(gy), R = r !== null ? r : gy.type === 'cone' ? gy.rMax : null, m = r !== null ? '' : ' (mesh)';
      if (R !== null){
        if (d >= R){ row('min to plane' + m, lin(d - R)); row('max to plane' + m, lin(d + R)); }
        else row('plane', 'cuts through it');
      }
      dim(Y, q, X, footOnPlane(q, gx.p, gx.n), d);
    } else if (s >= PAR){                                 // axis square to the plane
      if (gy.type === 'circle' || gy.type === 'torus'){
        const dc = Math.abs(_t.subVectors(gy.c, gx.p).dot(gx.n));
        row('distance', lin(dc) + (gy.type === 'circle' ? ' (circle ∥ plane)' : ''));
        dim(Y, gy.c, X, footOnPlane(gy.c, gx.p, gx.n), dc);
      } else {
        row('axis', 'square to the plane');
        const hp = _t.subVectors(gx.p, ay.p).dot(gx.n) / ay.a.dot(gx.n), e0 = Math.abs(gy.h0 - hp), e1 = Math.abs(gy.h1 - hp);
        row('far end to plane (mesh)', lin(Math.max(e0, e1)));        // the face's extent, off its vertices
        row('near end to plane (mesh)', lin(Math.min(e0, e1)));
        const far = ay.p.clone().addScaledVector(ay.a, e0 > e1 ? gy.h0 : gy.h1);
        dim(Y, far, X, footOnPlane(far, gx.p, gx.n), Math.max(e0, e1));
      }
    } else {
      angle('axis angle to plane', Math.asin(Math.min(1, s)));
      if (gy.type === 'circle'){ row('centre to plane', lin(d)); dim(Y, q, X, footOnPlane(q, gx.p, gx.n), d); }
    }
  } else if (gx.type === 'plane' && gy.type === 'sphere'){
    const d = Math.abs(_t.subVectors(gy.c, gx.p).dot(gx.n));
    row('centre to plane', lin(d));
    if (d >= gy.r) row('min to plane', lin(d - gy.r)); else row('plane', 'cuts through it');
    dim(Y, gy.c, X, footOnPlane(gy.c, gx.p, gx.n), d);
  } else if (gx.type === 'plane' && gy.type === 'line'){
    const s = Math.abs(gx.n.dot(gy.d));
    if (s <= PERP){
      const d = Math.abs(_t.subVectors(gy.p0, gx.p).dot(gx.n));
      row('distance', lin(d) + ' (edge ∥ plane)');
      dim(Y, Y.hit, X, footOnPlane(Y.hit, gx.p, gx.n), d);
    } else {
      angle('angle to plane', Math.asin(Math.min(1, s)));
      const d0 = Math.abs(_t.subVectors(gy.p0, gx.p).dot(gx.n)), d1 = Math.abs(_t.subVectors(gy.p1, gx.p).dot(gx.n));
      row('edge ends to plane', lin(Math.min(d0, d1)) + ' / ' + lin(Math.max(d0, d1)));
    }
  } else if (ax && ay){
    const c = Math.abs(ax.a.dot(ay.a));
    if (c >= PAR){                                        // parallel axes: centre distance
      const q1 = onAxis(X, gx, ax), q2 = footOnLine(q1, ay.p, ay.a), d = q1.distanceTo(q2);
      row('centre distance', d <= eps * 10 ? '0 (coaxial)' : lin(d));
      if (gx.type === 'circle' && gy.type === 'circle' && gx.c.distanceTo(gy.c) - d > eps * 10){
        row('centre to centre', lin(gx.c.distanceTo(gy.c)));
        row('axial offset', lin(Math.abs(_t.subVectors(gy.c, gx.c).dot(ax.a))));
      }
      const r1 = radius(gx), r2 = radius(gy);
      if (r1 !== null && r2 !== null){
        if (d >= r1 + r2){ row('gap', lin(d - r1 - r2)); row('outside to outside', lin(d + r1 + r2)); }
        else if (d <= Math.abs(r1 - r2)) row('radial clearance', lin(Math.abs(r1 - r2) - d));
        else row('circles', 'overlap');
      }
      dim(X, q1, Y, q2, d);
    } else {
      angle('angle between axes', Math.acos(c));
      const cl = closestLines(ax.p, ax.a, ay.p, ay.a);
      if (cl.d <= eps * 10) row('axes', 'intersect');
      else { row('axis to axis', lin(cl.d)); dim(X, cl.c1, Y, cl.c2, cl.d); }
    }
  } else if (ax && gy.type === 'sphere'){
    if (gx.type === 'circle'){ const d = gx.c.distanceTo(gy.c); row('centre to centre', lin(d)); dim(X, gx.c, Y, gy.c, d); }
    else {
      const f = footOnLine(gy.c, ax.p, ax.a), d = gy.c.distanceTo(f);
      row('centre to axis', d <= eps * 10 ? '0 (on the axis)' : lin(d));
      dim(Y, gy.c, X, f, d);
    }
  } else if (ax && gy.type === 'line'){
    if (gx.type === 'circle'){
      // to the picked edge itself, not its extension (pick a face for a distance to its plane)
      const t = Math.min(Math.max(_t.subVectors(gx.c, gy.p0).dot(gy.d), 0), gy.len);
      const f = gy.p0.clone().addScaledVector(gy.d, t), d = gx.c.distanceTo(f);
      row('centre to edge', lin(d));
      // circle to edge is d − r only for an edge lying in the circle's plane
      const inPlane = Math.abs(gy.d.dot(gx.a)) <= PERP && Math.abs(_t.subVectors(gy.p0, gx.c).dot(gx.a)) <= Math.max(eps * 10, 1e-4 * gx.r);
      if (inPlane && d >= gx.r) row('circle to edge', lin(d - gx.r));
      dim(X, gx.c, Y, f, d);
    } else {
      const c = Math.abs(ax.a.dot(gy.d));
      let d, p1, p2;
      if (c >= PAR){
        p2 = Y.hit.clone(); p1 = footOnLine(p2, ax.p, ax.a); d = p1.distanceTo(p2);
        row('axis to edge', lin(d));
      } else {
        const cl = closestLines(ax.p, ax.a, gy.p0, gy.d);
        p1 = cl.c1; p2 = cl.c2; d = cl.d;
        row('axis to edge line', d <= eps * 10 ? '0 (they meet)' : lin(d));
        angle('angle to edge', Math.acos(c));
      }
      const r = radius(gx);
      if (r !== null && d >= r) row('surface to edge', lin(d - r));
      dim(X, p1, Y, p2, d);
    }
  } else if (gx.type === 'sphere' && gy.type === 'sphere'){
    const d = gx.c.distanceTo(gy.c);
    row('centre distance', lin(d));
    if (d >= gx.r + gy.r) row('gap', lin(d - gx.r - gy.r));
    dim(X, gx.c, Y, gy.c, d);
  } else if (gx.type === 'sphere' && gy.type === 'line'){
    const f = footOnLine(gx.c, gy.p0, gy.d), d = gx.c.distanceTo(f);
    row('centre to edge line', lin(d));
    dim(X, gx.c, Y, f, d);
  } else if (gx.type === 'line' && gy.type === 'line'){
    const c = Math.abs(gx.d.dot(gy.d));
    if (c >= PAR){
      // the gap between the picked edges themselves: square across where they overlap along
      // their direction, else from end to nearest end
      const u = gx.d, s0 = _t.subVectors(gy.p0, gx.p0).dot(u), s1 = _t.subVectors(gy.p1, gx.p0).dot(u);
      const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(gx.len, Math.max(s0, s1));
      const sep = footOnLine(gx.p0, gy.p0, gy.d).distanceTo(gx.p0), sepText = sep <= eps ? '0 (collinear)' : lin(sep) + ' (parallel)';
      let p1, p2;
      if (hi >= lo - eps){
        const s = hi > lo ? Math.min(Math.max(_t.subVectors(X.hit, gx.p0).dot(u), lo), hi) : (lo + hi) / 2;
        p1 = gx.p0.clone().addScaledVector(u, s); p2 = footOnLine(p1, gy.p0, gy.d);
        row('distance', sepText);
      } else {
        const after = Math.min(s0, s1) > gx.len;           // Y lies beyond X's p1 end, else before its p0 end
        p1 = after ? gx.p1.clone() : gx.p0.clone();
        p2 = (after === (s0 < s1) ? gy.p0 : gy.p1).clone();
        row('distance', lin(p1.distanceTo(p2)) + ' (end to end)');
        row('line separation', sepText);
      }
      dim(X, p1, Y, p2, p1.distanceTo(p2));
    } else angle('angle', Math.acos(c));
  }
  if (md){
    row('min distance (mesh)', md.d <= eps ? '0 (touching)' : lin(md.d));
    if (!drawn) dim(A, md.pa, B, md.pb, md.d);
  }
  // figures that are all zero — flush faces, a line-to-line fit — have no length to draw:
  // label the headline where the picks meet instead, so Keep and screenshots still carry it
  if (rows.length && !items.some(it => it.type === 'dim' || it.type === 'tag')){
    const [e, p, o, q] = md ? [A, md.pa, B, md.pb] : [X, X.hit, Y, Y.hit];
    items.push({type:'tag', a:{part:e.part, p:p.clone()}, b:{part:o.part, p:q.clone()}, text:rows[0][1]});   // b: marks it (assembled) when exploded
  }
  row('source', SOURCES[Math.max(provenance(A), provenance(B))]);
  return {rows, items};
}

function addMeasureEntity(ent){
  if (measA && measB) measureClear(false);
  if (measA && measA.part === ent.part && measA.key === ent.key){ toast('Already picked — pick another face or edge'); return; }
  ent.color = measA ? COL_B : COL_A;
  if (ent.kind === 'face') ent.overlay = entityOverlay(ent, ent.color);
  if (!measA) measA = ent;
  else { measB = ent; measMd = minDistance(measA, measB); }
  renderMeasure();
}
function measureClear(all){
  [measA, measB].forEach(e => { if (e && e.overlay) disposeOverlay(e.overlay); });
  measA = measB = measMd = null;
  if (all) keptItems = [];
  renderMeasure();
}
const hasNumbers = items => items.some(it => it.type === 'dim' || it.type === 'tag');
function measureKeep(){             // freeze the current dimensions on screen, start the next
  if (!hasNumbers(measItems)) return;
  keptItems = keptItems.concat(measItems.filter(it => it.type !== 'edge'));
  measureClear(false);
}
// Built with textContent, never innerHTML: a part name comes from the model file (see showInfo)
function renderMeasure(){
  const el = (cls, text, tag) => { const d = document.createElement(tag || 'div'); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };
  const row = (r, main) => { const d = el(main ? 'r main' : 'r'); d.append(el('k', r[0], 'span'), el('v', r[1], 'span')); return d; };
  const head = (e, d, tag) => {
    const h = el('ent'), sw = el(null, null, 'i');
    if (tag === 'A') sw.style.backgroundColor = COL_A; else sw.style.backgroundColor = COL_B;
    h.append(sw, el(null, tag + ' · ' + d.title + (d.short ? ' ' + d.short : ''), 'span'), el('nm', e.part.name, 'span'));
    return h;
  };
  const body = [];
  measItems = [];
  if (measA && !measB){
    const d = describe(measA);
    body.push(head(measA, d, 'A'), ...d.rows.map(r => row(r)));
    measItems = d.marks.concat(d.items);
  } else if (measA){
    const da = describe(measA), db = describe(measB), rel = relate(measA, measB, measMd);
    body.push(head(measA, da, 'A'), head(measB, db, 'B'), el('div'), ...rel.rows.map((r, i) => row(r, i === 0)));
    if (measA.part !== measB.part && !measA.part.offset.equals(measB.part.offset)) body.push(el('hint', 'Exploded view: distances are for the assembled positions.'));
    measItems = da.marks.concat(db.marks, rel.items);
  } else if (keptItems.length){
    const n = keptItems.filter(it => it.type === 'dim' || it.type === 'tag').length;
    body.push(el('k', n + (n === 1 ? ' dimension' : ' dimensions') + ' kept on screen. Clear removes them.'));
  }
  $('measbody').replaceChildren(...body);
  $('btnMeasKeep').disabled = !hasNumbers(measItems);
  $('btnMeasClear').disabled = !measA && !keptItems.length;
}

