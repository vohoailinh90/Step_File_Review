// ── Selection ────────────────────────────────────────────────
let mode = 'part';
let selected = null;            // selected part
let faceOverlay = null, edgeOverlay = null;
let pickedCircle = null;        // {center, axis, radius}

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', ()=> setMode(b.dataset.mode)));
function setMode(m){
  mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'edge' && !edgesOn) toggleEdges();          // edges must exist to be picked
  clearSubSelection();
}
function clearSubSelection(){
  if (faceOverlay){ scene.remove(faceOverlay); faceOverlay.geometry.dispose(); faceOverlay.material.dispose(); faceOverlay = null; }
  if (edgeOverlay){ scene.remove(edgeOverlay); edgeOverlay.geometry.dispose(); edgeOverlay.material.dispose(); edgeOverlay = null; }
  showInfo(null);
}
function clearSelection(){
  clearSubSelection();
  if (selected){ emis(selected, 0); selected.rowEl.classList.remove('selected'); }
  selected = null;
}
function selectPart(p, scroll){
  if (selected === p) return;
  if (selected){ emis(selected, 0); selected.rowEl.classList.remove('selected'); }
  selected = p;
  if (p){
    emis(p, 0x5a2410);
    p.rowEl.classList.add('selected');
    if (scroll !== false) p.rowEl.scrollIntoView({block:'nearest'});
    if ($('sidebar').classList.contains('hidden') && parts.length > 1){
      $('sidebar').classList.remove('hidden'); $('btnParts').classList.add('active');
    }
  }
}

// pointer: distinguish click from orbit drag
let downPos = null;
canvas.addEventListener('pointerdown', e => { downPos = {x:e.clientX, y:e.clientY, b:e.button}; });
canvas.addEventListener('pointerup', e => {
  if (!downPos || downPos.b !== 0) { downPos = null; return; }
  const moved = Math.hypot(e.clientX-downPos.x, e.clientY-downPos.y);
  downPos = null;
  if (moved < 4) pick(e);
});

const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
function setRay(e){
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX-r.left)/r.width)*2 - 1;
  ndc.y = -((e.clientY-r.top)/r.height)*2 + 1;
  raycaster.setFromCamera(ndc, camera);
}
function notClipped(pt){ return !sectionActive || sectionPlane.distanceToPoint(pt) >= 0; }

function pick(e){
  if (!modelRoot) return;
  setRay(e);
  if (circlePickMode) return pickCircle();
  if (mode === 'edge') return pickEdge();

  const meshes = parts.filter(p=>p.visible).map(p=>p.mesh);
  const hits = raycaster.intersectObjects(meshes, false).filter(h => notClipped(h.point));
  if (!hits.length){ clearSelection(); return; }
  const hit = hits[0];
  const part = parts.find(p => p.mesh === hit.object);
  clearSubSelection();
  selectPart(part);
  if (mode === 'face') selectFace(part, hit.faceIndex);
  else showInfo({title:'PART', rows:[['name', part.name], ['triangles', part.tris.toLocaleString()],
                                     ['visible', part.visible ? 'yes' : 'no']],
                 foot:'H hides it · I isolates it · click its row to toggle'});
}

// ── Face detection: flood fill over triangles with continuous normals
function triAdjacency(geo){
  if (geo.userData._adj) return geo.userData._adj;
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const nTri = idx ? idx.length/3 : pos.count/3;
  const q = Math.max(modelSize * 1e-6, 1e-9);
  const vkey = i => {
    const j = idx ? idx[i] : i;
    return Math.round(pos.getX(j)/q)+'_'+Math.round(pos.getY(j)/q)+'_'+Math.round(pos.getZ(j)/q);
  };
  const edgeMap = new Map(), adj = new Array(nTri);
  for (let t=0; t<nTri; t++){
    adj[t] = [];
    const k = [vkey(t*3), vkey(t*3+1), vkey(t*3+2)];
    for (let s=0; s<3; s++){
      const a = k[s], b = k[(s+1)%3];
      const ek = a < b ? a+'|'+b : b+'|'+a;
      const other = edgeMap.get(ek);
      if (other === undefined) edgeMap.set(ek, t);
      else { adj[t].push(other); adj[other].push(t); }
    }
  }
  geo.userData._adj = adj;
  return adj;
}
function triNormal(geo, t, out, a, b, c){
  const pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
  const gi = i => idx ? idx[i] : i;
  a.fromBufferAttribute(pos, gi(t*3)); b.fromBufferAttribute(pos, gi(t*3+1)); c.fromBufferAttribute(pos, gi(t*3+2));
  return out.copy(c).sub(b).cross(a.clone().sub(b)).normalize();
}
function selectFace(part, faceIndex){
  const geo = part.mesh.geometry;
  const adj = triAdjacency(geo);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n0 = triNormal(geo, faceIndex, new THREE.Vector3(), a, b, c).clone();
  const nCur = new THREE.Vector3(), nNb = new THREE.Vector3();
  const COS = Math.cos(THREE.MathUtils.degToRad(20));   // stays on one face, stops at real edges
  const seen = new Set([faceIndex]), stack = [faceIndex], tris = [];
  while (stack.length){
    const t = stack.pop(); tris.push(t);
    triNormal(geo, t, nCur, a, b, c);
    for (const nb of adj[t]){
      if (seen.has(nb)) continue;
      triNormal(geo, nb, nNb, a, b, c);
      if (Math.abs(nCur.dot(nNb)) > COS){ seen.add(nb); stack.push(nb); }
    }
    if (tris.length > 200000) break;
  }
  // build overlay + measure area in world units
  const pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
  const gi = i => idx ? idx[i] : i;
  const arr = new Float32Array(tris.length*9);
  const m = part.mesh.matrixWorld;
  let area = 0, flat = true;
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  tris.forEach((t, k)=>{
    p0.fromBufferAttribute(pos, gi(t*3)).applyMatrix4(m);
    p1.fromBufferAttribute(pos, gi(t*3+1)).applyMatrix4(m);
    p2.fromBufferAttribute(pos, gi(t*3+2)).applyMatrix4(m);
    arr.set([p0.x,p0.y,p0.z, p1.x,p1.y,p1.z, p2.x,p2.y,p2.z], k*9);
    area += p1.clone().sub(p0).cross(p2.clone().sub(p0)).length()/2;
    triNormal(geo, t, nCur, a, b, c);
    if (Math.abs(nCur.dot(n0)) < 0.999) flat = false;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  faceOverlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color:0xff7a45, transparent:true, opacity:.5, side:THREE.DoubleSide,
    depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}));
  faceOverlay.renderOrder = 3;
  scene.add(faceOverlay);

  const rows = [['part', part.name], ['triangles', tris.length.toLocaleString()],
                ['type', flat ? 'planar' : 'curved'], ['area', A2(area) + ' mm²']];
  if (flat) rows.push(['normal', [n0.x,n0.y,n0.z].map(v=>v.toFixed(3)).join(', ')]);
  showInfo({title:'FACE', rows, foot:'Face is grown across triangles up to a 20° break angle.'});
}

