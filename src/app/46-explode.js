// ── Exploded view ────────────────────────────────────────────
// Each part slides away from the assembly centre along the line through its own centre (or
// just that line's X, Y or Z part, or its part along the picked axis), and then by its own move
// along a picked axis (`moved`, 47-move.js). The move is made in world space and turned into the
// part's parent frame, so nested assemblies stay consistent; edges, section caps and
// highlights move along. Measurements keep using the assembled geometry.
// Scope Picked explodes only the parts picked for it (Pick parts…, or Ctrl+click a part in the view or
// the list): they move together, as one rigid group, along the chosen direction — X, Y or Z (Flip for
// the minus side), the picked axis, or with All straight away from the assembly centre through the
// group's own centre — up to EXPLODE_PICKED model sizes at 100 %. Every other part stays assembled.
let explodeAmt = 0, explodeAxis = 'all', explodeScope = 'all', explodeSign = 1, explodePickMode = false;
const EXPLODE_MAX = 2;               // at 100 % a part ends up three times as far from the centre
const EXPLODE_PICKED = 1;            // at 100 % a picked group has moved one model size (largest bbox side)
const explodeSel = new Set();        // the parts Scope Picked explodes
$('btnExplode').addEventListener('click', ()=>{
  if (!modelRoot){ toast('Load a model first'); return; }
  const open = $('explodepanel').classList.toggle('show');
  $('btnExplode').classList.toggle('active', open);
  if (open && parts.length < 2) toast('A single part — nothing to explode');
  if (!open && axisPickMode) movePickCancel();
  if (!open && explodePickMode) explodePickCancel();
});
document.querySelectorAll('[data-expscope]').forEach(b => b.addEventListener('click', ()=> setExplodeScope(b.dataset.expscope)));
$('btnExpPick').addEventListener('click', ()=>{ if (explodePickMode) explodePickCancel(); else explodePickStart(); });
$('btnExpClear').addEventListener('click', ()=>{ [...explodeSel].forEach(p => explodeToggle(p)); setExplodeScope('all'); });
$('btnExpFlip').addEventListener('click', ()=>{
  explodeSign = -explodeSign;
  $('btnExpFlip').classList.toggle('active', explodeSign < 0);
  applyExplode();
});
function setExplodeScope(k){
  explodeScope = k;
  document.querySelectorAll('[data-expscope]').forEach(x => x.classList.toggle('active', x.dataset.expscope === k));
  applyExplode();
}
function explodePickStart(){
  if (!modelRoot){ toast('Load a model first'); return; }
  if (axisPickMode) movePickCancel();
  if (normalPickMode) normalPickCancel();
  explodePickMode = true;
  $('btnExpPick').classList.add('active');
  moveCursor();
}
function explodePickCancel(){
  explodePickMode = false;
  $('btnExpPick').classList.remove('active');
  moveCursor();
}
// Add a part to the picked group, or take it out; the first one picked switches the scope to Picked.
function explodeToggle(p){
  if (explodeSel.has(p)) explodeSel.delete(p); else explodeSel.add(p);
  if (p.rowEl) p.rowEl.classList.toggle('expsel', explodeSel.has(p));
  if (p !== selected && p !== hovered) emis(p, baseEmis(p));
  $('expPickCount').textContent = explodeSel.size;
  if (explodeSel.size && explodeScope !== 'picked') setExplodeScope('picked'); else applyExplode();
}
// The click while Pick parts… is on, or a Ctrl+click in Part mode with the panel open (30-select.js).
function pickExplodePart(){
  const hit = raycaster.intersectObjects(parts.filter(p => p.visible).map(p => p.mesh), false)
                       .find(h => notClipped(h.point, h.object));
  if (!hit) return;
  const part = parts.find(p => p.mesh === hit.object);
  explodeToggle(part);
  selectPart(part);
}
$('expAmount').addEventListener('input', e => setExplode(e.target.value / 100));
document.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', ()=>{
  setExplodeAxis(b.dataset.exp);
  if (explodeAxis === 'axis' && !moveAxis) movePickStart();     // explodes radially until an axis is picked
  applyExplode();
}));
$('btnExpReset').addEventListener('click', ()=>{ parts.forEach(p => p.moved.set(0, 0, 0)); setExplode(0); });
function setExplodeAxis(k){
  explodeAxis = k;
  document.querySelectorAll('[data-exp]').forEach(x => x.classList.toggle('active', x.dataset.exp === k));
}
function setExplode(v){
  explodeAmt = v;
  $('expAmount').value = Math.round(v * 100);
  $('expAmountVal').textContent = Math.round(v * 100) + ' %';
  applyExplode();
}
function resetExplode(){             // a newly loaded model starts assembled
  explodeAmt = 0;
  explodeSel.clear(); $('expPickCount').textContent = 0; explodePickCancel();
  explodeSign = 1; $('btnExpFlip').classList.remove('active'); setExplodeScope('all');
  $('expAmount').value = 0; $('expAmountVal').textContent = '0 %';
  moveReset();
}
function exploded(){ return parts.some(p => p.offset.lengthSq() > 0); }    // any part drawn off its assembled place
const _inv = new THREE.Matrix4(), _wp = new THREE.Vector3(), _zero = new THREE.Vector3(), _gs = new THREE.Vector3();
// The one vector the picked group moves by: along X / Y / Z (signed by Flip), the picked axis (its own
// direction, signed by Flip too), or All: away from the assembly centre through the group's centre.
function groupShift(){
  _gs.set(0, 0, 0);
  if (!explodeSel.size) return _gs;
  const k = {x:0, y:1, z:2}[explodeAxis];
  if (k !== undefined) _gs.setComponent(k, explodeSign);
  else if (explodeAxis === 'axis' && moveAxis) _gs.copy(moveAxis.d).multiplyScalar(explodeSign);
  else {
    explodeSel.forEach(p => _gs.add(p.restCenter));
    _gs.divideScalar(explodeSel.size).sub(modelCenter);
    if (_gs.lengthSq() < 1e-12 * modelSize * modelSize) _gs.set(0, 1, 0);   // a group on the centre goes up
    _gs.normalize().multiplyScalar(explodeSign);
  }
  return _gs.multiplyScalar(explodeAmt * EXPLODE_PICKED * modelSize);
}
function applyExplode(){
  if (!modelRoot) return;
  const f = explodeAmt * EXPLODE_MAX, k = {x:0, y:1, z:2}[explodeAxis], ax = explodeAxis === 'axis' && moveAxis ? moveAxis.d : null;
  const group = explodeScope === 'picked' ? groupShift() : null;
  parts.forEach(p=>{
    if (group){ p.offset.copy(explodeSel.has(p) ? group : _zero).add(p.moved); return; }
    p.offset.subVectors(p.restCenter, modelCenter);
    if (k !== undefined) for (let i = 0; i < 3; i++) if (i !== k) p.offset.setComponent(i, 0);
    if (ax){ const s = p.offset.dot(ax); p.offset.copy(ax).multiplyScalar(s); }
    p.offset.multiplyScalar(f).add(p.moved);
  });
  parts.forEach(p=>{                  // `parts` lists parents before their children
    const m = p.mesh;
    _wp.setFromMatrixPosition(p.restMatrix).add(p.offset).applyMatrix4(_inv.copy(m.parent.matrixWorld).invert());
    m.position.copy(_wp);
    m.updateMatrixWorld(true);
    if (p.edges){ p.edges.position.setFromMatrixPosition(m.matrixWorld); p.edges.updateMatrixWorld(true); }
    if (p.capBack){
      p.capBack.matrix.copy(m.matrixWorld); p.capFront.matrix.copy(m.matrixWorld);
      p.capBack.matrixWorldNeedsUpdate = p.capFront.matrixWorldNeedsUpdate = true;
    }
  });
  followers.forEach(o => { const fl = o.userData.follow; o.position.copy(fl.part.offset).sub(fl.base); });
  if (sectionActive) syncClips();
  if (mode === 'measure') renderMeasure();
  moveSync();                        // the move box reads where the part sits, explode included
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
      const lines = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({color:0x2a2a2a, clippingPlanes:sectionActive ? [p.clip] : null}));
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

