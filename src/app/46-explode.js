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
// Distance X / Y / Z: an exact explode, typed in the shown units and kept in mesh units. Picked: the group
// moves by exactly (dX, dY, dZ). All: along each axis a part slides away from the assembly centre in
// proportion to how far off it its centre sits, so the outermost part centre moves exactly that distance.
// It adds to the % explode and to a part's own move.
const explodeDist = new THREE.Vector3();
['x', 'y', 'z'].forEach((a, i) => $('expD' + a).addEventListener('change', e =>
  setExplodeDist(i, e.target.validity && e.target.validity.badInput ? 'bad' : e.target.value)));   // '1,5' reads '' in some locales
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
  $('btnExpFlip').disabled = k !== 'picked';         // Flip turns the picked group; scope All has nothing to flip
  applyExplode();
}
function explodePickStart(){
  if (!modelRoot){ toast('Load a model first'); return; }
  endPickModes();
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
  if (explodeSel.size && explodeScope !== 'picked') setExplodeScope('picked');
  else if (!explodeSel.size && explodeScope === 'picked') setExplodeScope('all');   // the last one taken out
  else applyExplode();
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
$('btnExpReset').addEventListener('click', ()=>{ parts.forEach(p => p.moved.set(0, 0, 0)); explodeDist.set(0, 0, 0); explodeDistSync(); setExplode(0); });
function setExplodeDist(i, typed){   // i: 0 X, 1 Y, 2 Z; typed in the shown units ('' is 0)
  const v = typed === '' ? 0 : Number(typed);
  if (!Number.isFinite(v)) toast('Not a number');
  else if (Math.abs(v / unitScale) > 100 * modelSize) toast('Too far: more than 100 times the size of the model');
  else explodeDist.setComponent(i, v / unitScale);
  explodeDistSync();
  applyExplode();
  if (v && explodeScope === 'all' && modelRoot && _dspan.getComponent(i) <= 1e-9 * modelSize)
    toast('No visible part sits off the centre along ' + 'XYZ'[i] + ' — pick parts to move them by this distance');
}
function explodeDistSync(){          // the boxes, after a change of value or of units
  ['x', 'y', 'z'].forEach((a, i) => { const d = explodeDist.getComponent(i); $('expD' + a).value = d ? moveNum(d) : ''; });
  $('expDistUnit').textContent = unitsRaw ? '' : 'mm';
}
const _dspan = new THREE.Vector3();
// The vector the typed distances add to part p: (dX, dY, dZ) for a picked part, nothing for one that is not;
// in scope All, each axis scaled by where p sits between the centre and the farthest part centre on it.
function distShift(p, out){
  out.set(0, 0, 0);
  if (explodeDist.lengthSq() === 0) return out;
  if (explodeScope === 'picked') return explodeSel.has(p) ? out.copy(explodeDist) : out;
  for (let i = 0; i < 3; i++){
    const span = _dspan.getComponent(i);
    if (span > 1e-9 * modelSize) out.setComponent(i, explodeDist.getComponent(i) * (p.restCenter.getComponent(i) - modelCenter.getComponent(i)) / span);
  }
  return out;
}
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
  explodeSel.clear(); $('expPickCount').textContent = 0; endPickModes();
  explodeSign = 1; $('btnExpFlip').classList.remove('active'); setExplodeScope('all');
  $('expAmount').value = 0; $('expAmountVal').textContent = '0 %';
  explodeDist.set(0, 0, 0); explodeDistSync();
  moveReset();
}
function exploded(){ return parts.some(p => p.offset.lengthSq() > 0); }    // any part drawn off its assembled place
const _inv = new THREE.Matrix4(), _wp = new THREE.Vector3(), _zero = new THREE.Vector3(), _gs = new THREE.Vector3(), _ds = new THREE.Vector3();
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
  _dspan.set(0, 0, 0);                // per axis, the farthest visible part centre from the assembly centre
  parts.forEach(p => { if (p.visible) for (let i = 0; i < 3; i++)
    _dspan.setComponent(i, Math.max(_dspan.getComponent(i), Math.abs(p.restCenter.getComponent(i) - modelCenter.getComponent(i)))); });
  parts.forEach(p=>{
    if (group){ p.offset.copy(explodeSel.has(p) ? group : _zero).add(distShift(p, _ds)).add(p.moved); return; }
    p.offset.subVectors(p.restCenter, modelCenter);
    if (k !== undefined) for (let i = 0; i < 3; i++) if (i !== k) p.offset.setComponent(i, 0);
    if (ax){ const s = p.offset.dot(ax); p.offset.copy(ax).multiplyScalar(s); }
    p.offset.multiplyScalar(f).add(distShift(p, _ds)).add(p.moved);
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

