// ── Exploded view ────────────────────────────────────────────
// Each part slides away from the assembly centre along the line through its own centre (or
// just that line's X, Y or Z part, or its part along the picked axis), and then by its own move
// along a picked axis (`moved`, 47-move.js). The move is made in world space and turned into the
// part's parent frame, so nested assemblies stay consistent; edges, section caps and
// highlights move along. Measurements keep using the assembled geometry.
let explodeAmt = 0, explodeAxis = 'all';
const EXPLODE_MAX = 2;               // at 100 % a part ends up three times as far from the centre
$('btnExplode').addEventListener('click', ()=>{
  if (!modelRoot){ toast('Load a model first'); return; }
  const open = $('explodepanel').classList.toggle('show');
  $('btnExplode').classList.toggle('active', open);
  if (open && parts.length < 2) toast('A single part — nothing to explode');
  if (!open && axisPickMode) movePickCancel();
});
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
  $('expAmount').value = 0; $('expAmountVal').textContent = '0 %';
  moveReset();
}
function exploded(){ return parts.some(p => p.offset.lengthSq() > 0); }    // any part drawn off its assembled place
const _inv = new THREE.Matrix4(), _wp = new THREE.Vector3();
function applyExplode(){
  if (!modelRoot) return;
  const f = explodeAmt * EXPLODE_MAX, k = {x:0, y:1, z:2}[explodeAxis], ax = explodeAxis === 'axis' && moveAxis ? moveAxis.d : null;
  parts.forEach(p=>{
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

