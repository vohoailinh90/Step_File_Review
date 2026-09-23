// ── Edge picking + circle fitting ────────────────────────────
function pickEdge(){
  if (!edgeRoot){ toast('Feature edges are still building'); return; }
  raycaster.params.Line.threshold = modelSize * 0.005;
  const lines = edgeRoot.children.filter(l => l.visible);
  const hits = raycaster.intersectObjects(lines, false).filter(h => notClipped(h.point));
  if (!hits.length){ clearSubSelection(); return; }
  const hit = hits[0];
  const part = parts.find(p => p.edges === hit.object);
  if (part) selectPart(part);
  clearSubSelection();

  const chain = chainFrom(hit.object, hit.index);
  if (!chain){ toast('Could not trace that edge'); return; }
  drawEdgeOverlay(chain.points);

  const fit = fitCircle(chain.points);
  const len = polylineLength(chain.points, chain.closed);
  if (fit && fit.rms < 0.03){
    pickedCircle = fit;
    showInfo({title:'CIRCULAR EDGE', rows:[
      ['diameter', L(fit.radius*2) + ' mm'], ['radius', L(fit.radius) + ' mm'],
      ['centre', [fit.center.x,fit.center.y,fit.center.z].map(v=>L(v)).join(', ')],
      ['axis', [fit.axis.x,fit.axis.y,fit.axis.z].map(v=>v.toFixed(3)).join(', ')],
      ['arc', chain.closed ? 'closed' : 'open']],
      foot:'Section → Plane from circle uses this axis.'});
    $('btnPickCircle').disabled = false;
    if (circlePickMode) applyCirclePlane();
  } else {
    pickedCircle = null;
    showInfo({title:'EDGE', rows:[['length', L(len)+' mm'], ['segments', chain.count],
                                  ['shape', chain.closed ? 'closed loop' : 'open']],
              foot:'Pick a circular edge to derive a section plane from it.'});
  }
}
// walk connected segments of a LineSegments geometry starting at a hit segment
function chainFrom(lineObj, hitIndex){
  const geo = lineObj.geometry, pos = geo.attributes.position;
  const nSeg = pos.count/2;
  let seg = Math.floor((hitIndex||0)/2);
  if (seg < 0 || seg >= nSeg) seg = 0;
  const q = Math.max(modelSize*1e-6, 1e-9);
  const key = i => Math.round(pos.getX(i)/q)+'_'+Math.round(pos.getY(i)/q)+'_'+Math.round(pos.getZ(i)/q);
  if (!geo.userData._vmap){
    const map = new Map();
    for (let s=0; s<nSeg; s++){
      for (const e of [s*2, s*2+1]){
        const k = key(e);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
      }
    }
    geo.userData._vmap = map;
  }
  const map = geo.userData._vmap;
  // BFS over segments sharing endpoints, keeping tangent continuity so we don't
  // jump onto a different feature at a corner
  const dirOf = s => new THREE.Vector3().subVectors(
      new THREE.Vector3().fromBufferAttribute(pos, s*2+1),
      new THREE.Vector3().fromBufferAttribute(pos, s*2)).normalize();
  const seen = new Set([seg]), queue = [seg], segs = [];
  while (queue.length){
    const s = queue.pop(); segs.push(s);
    const d = dirOf(s);
    for (const e of [s*2, s*2+1]){
      for (const nb of (map.get(key(e)) || [])){
        if (seen.has(nb)) continue;
        if (Math.abs(d.dot(dirOf(nb))) < Math.cos(THREE.MathUtils.degToRad(35))) continue;
        seen.add(nb); queue.push(nb);
      }
      if (segs.length > 20000) break;
    }
  }
  // order endpoints into a polyline
  const pts = [], used = new Set();
  const world = lineObj.matrixWorld;
  const startSeg = segs[0];
  let curKey = key(startSeg*2);
  pts.push(new THREE.Vector3().fromBufferAttribute(pos, startSeg*2).applyMatrix4(world));
  let cur = startSeg, curEnd = startSeg*2+1;
  const total = segs.length;
  const segSet = new Set(segs);
  for (let guard=0; guard<total+2; guard++){
    used.add(cur);
    pts.push(new THREE.Vector3().fromBufferAttribute(pos, curEnd).applyMatrix4(world));
    const k = key(curEnd);
    const next = (map.get(k) || []).find(s => segSet.has(s) && !used.has(s));
    if (next === undefined) break;
    curEnd = (key(next*2) === k) ? next*2+1 : next*2;
    cur = next;
  }
  if (pts.length < 2) return null;
  const closed = pts.length > 2 && pts[0].distanceTo(pts[pts.length-1]) < modelSize*1e-4;
  if (closed) pts.pop();          // drop the duplicated closing point so it doesn't bias the fit
  return {points:pts, closed, count:total};
}
function drawEdgeOverlay(points){
  const g = new THREE.BufferGeometry().setFromPoints(points);
  edgeOverlay = new THREE.Line(g, new THREE.LineBasicMaterial({color:0xff7a45, depthTest:false}));
  edgeOverlay.renderOrder = 4;
  scene.add(edgeOverlay);
}
function polylineLength(pts, closed){
  let L = 0;
  for (let i=1;i<pts.length;i++) L += pts[i].distanceTo(pts[i-1]);
  if (closed && pts.length>2) L += pts[0].distanceTo(pts[pts.length-1]);
  return L;
}
// Newell normal + least-squares radius; rms is the relative radius scatter
function fitCircle(pts){
  if (pts.length < 5) return null;
  const n = new THREE.Vector3();
  for (let i=0;i<pts.length;i++){
    const p = pts[i], q = pts[(i+1)%pts.length];
    n.x += (p.y - q.y)*(p.z + q.z);
    n.y += (p.z - q.z)*(p.x + q.x);
    n.z += (p.x - q.x)*(p.y + q.y);
  }
  if (n.length() < 1e-12){
    const v1 = pts[1].clone().sub(pts[0]), v2 = pts[pts.length-1].clone().sub(pts[0]);
    n.copy(v1.cross(v2));
    if (n.length() < 1e-12) return null;
  }
  n.normalize();
  const center = new THREE.Vector3();
  pts.forEach(p => center.add(p));
  center.multiplyScalar(1/pts.length);
  // planarity check
  let planeDev = 0;
  pts.forEach(p => { planeDev = Math.max(planeDev, Math.abs(p.clone().sub(center).dot(n))); });
  let rMean = 0;
  pts.forEach(p => rMean += p.distanceTo(center));
  rMean /= pts.length;
  if (rMean < 1e-9) return null;
  if (planeDev / rMean > 0.02) return null;      // not planar => not a circle
  let varSum = 0;
  pts.forEach(p => { const d = p.distanceTo(center) - rMean; varSum += d*d; });
  const rms = Math.sqrt(varSum/pts.length) / rMean;
  return {center, axis:n, radius:rMean, rms};
}

// ── Info panel ───────────────────────────────────────────────
function fmt(v){
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10) return v.toFixed(2);
  if (a >= 0.1) return v.toFixed(3);
  return v.toPrecision(3);
}
// Built with textContent, never innerHTML: a part name comes from the model file,
// and a supplier's .gltf named a part <style>@import'\68ttps...'</style> -- which
// fetched off the machine the moment the part was clicked.
function infoLine(cls, text){
  const d = document.createElement(cls ? 'span' : 'div');
  if (cls) d.className = cls;
  d.textContent = text;
  return d;
}
function showInfo(data){
  const el = $('info');
  el.replaceChildren();
  if (!data){ el.classList.remove('show'); return; }
  const hd = infoLine(null, data.title); hd.className = 'hd'; el.append(hd);
  data.rows.forEach(([k,v]) => {
    const row = document.createElement('div');
    row.append(infoLine('k', k), ' ', infoLine('v', v));
    el.append(row);
  });
  if (data.foot){
    const f = infoLine(null, data.foot); f.className = 'k'; f.style.marginTop = '5px'; el.append(f);
  }
  el.classList.add('show');
}

// ── Edges ────────────────────────────────────────────────────
$('btnEdges').addEventListener('click', toggleEdges);
function toggleEdges(){
  edgesOn = !edgesOn;
  $('btnEdges').classList.toggle('active', edgesOn);
  if (edgesOn && !edgeRoot && modelRoot){
    edgeRoot = new THREE.Group();
    parts.forEach(p=>{
      if (p.tris > 400000) return;
      const eg = new THREE.EdgesGeometry(p.mesh.geometry, 25);
      const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({color:0x2a2a2a}));
      p.mesh.updateWorldMatrix(true, false);
      lines.applyMatrix4(p.mesh.matrixWorld);
      lines.updateMatrixWorld(true);
      p.edges = lines;
      edgeRoot.add(lines);
    });
    scene.add(edgeRoot);
  }
  if (edgeRoot) parts.forEach(p=>{ if (p.edges) p.edges.visible = edgesOn && p.visible; });
}

