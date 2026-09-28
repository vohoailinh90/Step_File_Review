// ── Measure ──────────────────────────────────────────────────
// Click a face or an edge (an edge wins within a few pixels of the cursor) for its size;
// click a second one for the distances between the two. Everything is computed on the
// assembled geometry, from the exact B-rep surfaces when the file carries them.
const COL_A = '#ff7a45', COL_B = '#5aa7e8', EDGE_PX = 7;
const PAR = Math.cos(THREE.MathUtils.degToRad(0.5)), PERP = Math.sin(THREE.MathUtils.degToRad(0.5));
let measA = null, measB = null, measMd = null, measItems = [], keptItems = [];

$('btnMeasKeep').addEventListener('click', measureKeep);
$('btnMeasClear').addEventListener('click', ()=> measureClear(true));

function meshHit(x, y, r){          // nearest visible, unclipped mesh under a viewport pixel
  ndc.set(x / r.width * 2 - 1, -(y / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(parts.filter(p => p.visible).map(p => p.mesh), false);
  return hits.find(h => notClipped(h.point, h.object)) || null;
}
function pickMeasure(e){
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let hit = meshHit(x, y, r);
  const onFace = !!hit;
  // a click just outside a silhouette can still land on the edge there
  for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]){ if (hit) break; hit = meshHit(x + dx*EDGE_PX, y + dy*EDGE_PX, r); }
  if (!hit){ measureClear(false); return; }
  const part = parts.find(p => p.mesh === hit.object);
  const topo = topology(part.mesh.geometry), f = topo.faceId[hit.faceIndex];
  const rest = hit.point.clone().sub(part.offset);
  const near = nearestBoundary(part, topo, f, hit, x, y, r);
  const ent = near && near.px <= EDGE_PX ? edgeEntity(part, near.h, rest) : onFace ? faceEntity(part, f, rest) : null;
  if (!ent){ measureClear(false); return; }
  addMeasureEntity(ent);
}
// The boundary segment of face f nearest the cursor (CSS px), ignoring segments clearly
// behind the picked point — the far rim of a shaft seen from the side.
function nearestBoundary(part, topo, f, hit, x, y, r){
  const pos = part.mesh.geometry.attributes.position, m = part.mesh.matrixWorld;
  const px = 2 * hit.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / r.height;
  const slack = Math.max(4 * EDGE_PX * px, hit.distance * 1e-3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), sa = new THREE.Vector3(), sb = new THREE.Vector3(), q = new THREE.Vector3();
  let best = null;
  for (const t of faceTris(topo, f)) for (let k = 0; k < 3; k++){
    const h = t*3 + k, u = topo.nbr[h];
    if (topo.sliver[t] || (u >= 0 && topo.faceId[u] === f)) continue;   // inside the face, or the seam of a closed face
    a.fromBufferAttribute(pos, topo.vert[h]).applyMatrix4(m);
    b.fromBufferAttribute(pos, topo.vert[t*3 + (k+1)%3]).applyMatrix4(m);
    sa.copy(a).project(camera); sb.copy(b).project(camera);
    if (Math.abs(sa.z) > 1 || Math.abs(sb.z) > 1) continue;
    const ax = (sa.x + 1) / 2 * r.width, ay = (1 - sa.y) / 2 * r.height;
    const dx = (sb.x + 1) / 2 * r.width - ax, dy = (1 - sb.y) / 2 * r.height - ay, l2 = dx*dx + dy*dy;
    const s = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax)*dx + (y - ay)*dy) / l2)) : 0;
    const d = Math.hypot(ax + s*dx - x, ay + s*dy - y);
    if (best && d >= best.px) continue;
    q.copy(a).lerp(b, s);
    if (!notClipped(q, part.mesh) || q.distanceTo(camera.position) > hit.distance + slack) continue;
    best = {px:d, h};
  }
  return best;
}
// The B-rep edge through boundary half-edge h0: every boundary segment of its face that
// borders the same neighbouring face, walked into one ordered polyline (geometry frame).
function edgeChain(topo, geo, h0){
  const F = topo.faceId[(h0/3)|0], u0 = topo.nbr[h0], G = u0 >= 0 ? topo.faceId[u0] : -1;
  const nx = h => h - h%3 + (h%3 + 1)%3, wv = h => topo.weld[topo.vert[h]], byV = new Map();
  for (const t of faceTris(topo, F)) for (let k = 0; k < 3; k++){
    const h = t*3 + k, u = topo.nbr[h];
    if (topo.sliver[t] || (u >= 0 ? topo.faceId[u] : -1) !== G) continue;
    for (const w of [wv(h), wv(nx(h))]){ let l = byV.get(w); if (!l) byV.set(w, l = []); l.push(h); }
  }
  // A face's free boundary (an open sheet, a gap in the mesh) has no neighbour to tell its
  // B-rep edges apart, so the run also stops at corners, as Edge mode does: segments that
  // turn more than 35° from one another belong to different edges.
  const pos = geo.attributes.position, dirs = new Map(), bend = Math.cos(THREE.MathUtils.degToRad(35));
  const dir = h => { let d = dirs.get(h);
    if (!d){ d = new THREE.Vector3().fromBufferAttribute(pos, topo.rep[wv(nx(h))]).sub(_t.fromBufferAttribute(pos, topo.rep[wv(h)])).normalize(); dirs.set(h, d); }
    return d; };
  const joins = (h, o) => G >= 0 || Math.abs(dir(h).dot(dir(o))) >= bend;
  const comp = new Set([h0]), stack = [h0];               // the connected run holding h0
  while (stack.length){
    const h = stack.pop();
    for (const w of [wv(h), wv(nx(h))]) for (const o of byV.get(w)) if (!comp.has(o) && joins(h, o)){ comp.add(o); stack.push(o); }
  }
  const deg = w => byV.get(w).reduce((n, o) => n + comp.has(o), 0);
  let start = h0, cur = wv(h0);                            // walk it from an open end if it has one
  outer: for (const h of comp) for (const w of [wv(h), wv(nx(h))]) if (deg(w) === 1){ start = h; cur = w; break outer; }
  const ids = [cur], used = new Set();
  for (let h = start; h !== undefined; ){
    used.add(h);
    cur = wv(h) === cur ? wv(nx(h)) : wv(h);
    ids.push(cur);
    h = byV.get(cur).find(o => comp.has(o) && !used.has(o));
  }
  const closed = ids.length > 3 && ids[0] === ids[ids.length - 1];
  if (closed) ids.pop();
  return {pts:ids.map(w => new THREE.Vector3().fromBufferAttribute(pos, topo.rep[w])), closed,
          faces:G >= 0 ? [F, G] : [F],
          // the same from either face; pieces of a free boundary can share a corner, so name them by their segments
          key:G >= 0 ? 'e' + Math.min(F, G) + '_' + Math.max(F, G) + '_' + ids.reduce((m, w) => Math.min(m, w), Infinity)
                     : 'e' + F + '_free_' + [...comp].reduce((m, h) => Math.min(m, h), Infinity)};
}
function edgeEntity(part, h, hit){
  const geo = part.mesh.geometry, topo = topology(geo), ch = edgeChain(topo, geo, h), m = part.restMatrix;
  const pts = ch.pts.map(p => p.applyMatrix4(m));
  const surfs = ch.faces.map(f => { const i = faceInfo(geo, f), w = surfToWorld(i.surf, m); return Object.assign(w, {exact:i.exact && w.type === i.surf.type}); });
  const geom = classifyEdge(pts, ch.closed, surfs);
  const nSeg = pts.length - (ch.closed ? 0 : 1), prims = new Float64Array(nSeg * 6);
  for (let i = 0; i < nSeg; i++){
    const p = pts[i], q = pts[(i+1) % pts.length];
    prims.set([p.x, p.y, p.z, q.x, q.y, q.z], i*6);
  }
  return {kind:'edge', part, key:ch.key, geom, exact:!!geom.exact, prims, stride:6, count:nSeg,
          pts, closed:ch.closed, hit:closestOnPolyline(pts, ch.closed, hit)};
}
function closestOnPolyline(pts, closed, q){
  const best = pts[0].clone(), seg = new THREE.Line3(), c = new THREE.Vector3();
  let bd = Infinity;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++){
    seg.set(pts[i], pts[(i+1) % pts.length]).closestPointToPoint(q, true, c);
    const d = c.distanceToSquared(q);
    if (d < bd){ bd = d; best.copy(c); }
  }
  return best;
}
