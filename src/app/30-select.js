// ── Selection ────────────────────────────────────────────────
let mode = 'part';
let selected = null;            // selected part
let faceOverlay = null, edgeOverlay = null;
let pickedCircle = null;        // {center, axis, radius}
const followers = new Set();    // highlight meshes that move with their part in an exploded view

document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', ()=> setMode(b.dataset.mode)));
function setMode(m){
  const was = mode;
  mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if ((m === 'edge' || m === 'measure') && !edgesOn) toggleEdges();   // edges must exist to be picked
  clearSubSelection();
  if (was === 'measure' && m !== 'measure') measureClear(true);
  $('measurepanel').classList.toggle('show', m === 'measure');
  if (m === 'measure') renderMeasure();
}
// `base` is the part offset the highlight was built at (null: built at the assembled position)
function follow(o, part, base){
  o.userData.follow = {part, base: base ? base.clone() : new THREE.Vector3()};
  o.position.copy(part.offset).sub(o.userData.follow.base);
  followers.add(o);
}
function disposeOverlay(o){
  scene.remove(o); followers.delete(o);
  o.geometry.dispose(); o.material.dispose();
}
function clearSubSelection(){
  if (faceOverlay){ disposeOverlay(faceOverlay); faceOverlay = null; }
  if (edgeOverlay){ disposeOverlay(edgeOverlay); edgeOverlay = null; }
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
// is a point on obj left standing by the section? obj is clipped by its own part's cut
function notClipped(pt, obj){
  const planes = sectionActive && obj.material.clippingPlanes;
  return !planes || planes.every(pl => pl.distanceToPoint(pt) >= 0);
}

function pick(e){
  if (!modelRoot) return;
  setRay(e);
  if (circlePickMode || mode === 'edge') return pickEdge();
  if (mode === 'measure') return pickMeasure(e);

  const meshes = parts.filter(p=>p.visible).map(p=>p.mesh);
  const hits = raycaster.intersectObjects(meshes, false).filter(h => notClipped(h.point, h.object));
  if (!hits.length){ clearSelection(); return; }
  const hit = hits[0];
  const part = parts.find(p => p.mesh === hit.object);
  clearSubSelection();
  selectPart(part);
  if (mode === 'face') selectFace(part, hit.faceIndex, hit.point.clone().sub(part.offset));
  else showInfo({title:'PART', rows:[['name', part.name], ['triangles', part.tris.toLocaleString()],
                                     ['visible', part.visible ? 'yes' : 'no']],
                 foot:'H hides it · I isolates it · click its row to toggle'});
}

