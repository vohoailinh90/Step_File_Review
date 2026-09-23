// ── Section planes ───────────────────────────────────────────
const sectionPlane = new THREE.Plane(new THREE.Vector3(1,0,0), 0);
let sectionActive = false, sectionNormalBase = new THREE.Vector3(1,0,0),
    sectionPoint = new THREE.Vector3(), sectionFlip = 1, sectionOffset = 0,
    sectionKind = null, capsWanted = true, capGroup = null, capQuad = null,
    circlePickMode = false;

$('btnSection').addEventListener('click', ()=>{
  const open = $('sectionpanel').classList.toggle('show');
  $('btnSection').classList.toggle('active', open);
});
document.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', ()=>{
  const n = {right:new THREE.Vector3(1,0,0), top:new THREE.Vector3(0,1,0), front:new THREE.Vector3(0,0,1)}[b.dataset.sec];
  sectionKind = 'standard';
  $('secAngle').disabled = true;      // angle only applies to circle-derived planes
  sectionNormalBase.copy(n);
  sectionPoint.copy(modelCenter);
  sectionOffset = 0; $('secOffset').value = 0;
  document.querySelectorAll('[data-sec]').forEach(x => x.classList.toggle('active', x === b));
  $('secHint').textContent = 'Cutting on the ' + b.textContent.toLowerCase() +
      ' plane. Drag offset to move it, Flip to swap the kept side.';
  sectionOn();
}));
$('btnSecFlip').addEventListener('click', ()=>{ sectionFlip *= -1; updatePlane(); });
$('btnSecOff').addEventListener('click', sectionOff);
$('secOffset').addEventListener('input', e=>{
  sectionOffset = parseFloat(e.target.value) * modelSize * 0.6;
  $('secOffsetVal').textContent = L(sectionOffset);
  updatePlane();
});
$('secAngle').addEventListener('input', e=>{
  $('secAngleVal').textContent = parseFloat(e.target.value).toFixed(1) + '°';
  updatePlane();
});
$('btnCaps').addEventListener('click', ()=>{
  capsWanted = !capsWanted;
  $('btnCaps').classList.toggle('active', capsWanted);
  if (sectionActive){ disposeCaps(); if (capsWanted) buildCaps(); updatePlane(); }
});
$('btnPickCircle').addEventListener('click', ()=>{
  if (pickedCircle){ applyCirclePlane(); return; }
  circlePickMode = true;
  setMode('edge');
  $('btnPickCircle').classList.add('active');
  $('secHint').innerHTML = '<b>Click a circular edge</b> in the 3D view — a hole rim, a boss, a bore. ' +
    'The plane is built through its axis and the angle slider sweeps it around that axis.';
});
function applyCirclePlane(){
  if (!pickedCircle) return;
  circlePickMode = false;
  $('btnPickCircle').classList.remove('active');
  sectionKind = 'circle';
  sectionPoint.copy(pickedCircle.center);
  $('secAngle').disabled = false;
  document.querySelectorAll('[data-sec]').forEach(x => x.classList.remove('active'));
  sectionOffset = 0; $('secOffset').value = 0; $('secOffsetVal').textContent = '0.00';
  $('secHint').innerHTML = 'Plane runs through the axis of the Ø' + L(pickedCircle.radius*2) + ' mm' +
    ' circle. <b>Angle</b> rotates it around that axis; offset shifts it sideways.';
  $('sectionpanel').classList.add('show'); $('btnSection').classList.add('active');
  sectionOn();
}
// normal of the circle-derived plane at angle t: perpendicular to the circle axis,
// so the plane always contains the axis and sweeps around it
function circleNormal(deg){
  const axis = pickedCircle.axis.clone().normalize();
  let u = new THREE.Vector3(0,0,1).cross(axis);
  if (u.lengthSq() < 1e-8) u = new THREE.Vector3(0,1,0).cross(axis);
  u.normalize();
  const v = axis.clone().cross(u).normalize();
  const t = THREE.MathUtils.degToRad(deg);
  return u.multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)).normalize();
}
function sectionOn(){
  sectionActive = true;
  parts.forEach(p=>{ p.mesh.material.clippingPlanes = [sectionPlane]; p.mesh.material.needsUpdate = true; });
  if (edgeRoot) edgeRoot.children.forEach(l=>{ l.material.clippingPlanes = [sectionPlane]; l.material.needsUpdate = true; });
  if (capsWanted && !capGroup) buildCaps();
  updatePlane();
}
function sectionOff(){
  sectionActive = false;
  sectionKind = null;
  parts.forEach(p=>{ if (p.mesh.material){ p.mesh.material.clippingPlanes = null; p.mesh.material.needsUpdate = true; } });
  if (edgeRoot) edgeRoot.children.forEach(l=>{ l.material.clippingPlanes = null; l.material.needsUpdate = true; });
  disposeCaps();
  document.querySelectorAll('[data-sec]').forEach(x => x.classList.remove('active'));
  $('secAngle').disabled = true;
  $('secHint').textContent = 'Pick a standard plane, or build one from a circular edge.';
}
function updatePlane(){
  if (!sectionActive) return;
  const n = (sectionKind === 'circle' && pickedCircle)
      ? circleNormal(parseFloat($('secAngle').value))
      : sectionNormalBase.clone();
  n.multiplyScalar(sectionFlip);
  sectionPlane.setFromNormalAndCoplanarPoint(n, sectionPoint);
  sectionPlane.constant -= sectionOffset;
  if (capQuad){
    const p = n.clone().multiplyScalar(-sectionPlane.constant);
    capQuad.position.copy(p);
    capQuad.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n);
  }
}
function buildCaps(){
  if (!parts.length) return;
  capGroup = new THREE.Group();
  const mkStencil = (side, op) => new THREE.MeshBasicMaterial({
    depthWrite:false, depthTest:false, colorWrite:false, side,
    stencilWrite:true, stencilFunc:THREE.AlwaysStencilFunc,
    stencilFail:op, stencilZFail:op, stencilZPass:op});
  const backMat  = mkStencil(THREE.BackSide,  THREE.IncrementWrapStencilOp);
  const frontMat = mkStencil(THREE.FrontSide, THREE.DecrementWrapStencilOp);
  parts.forEach(p=>{
    const b = new THREE.Mesh(p.mesh.geometry, backMat);
    const f = new THREE.Mesh(p.mesh.geometry, frontMat);
    [b,f].forEach(m=>{
      m.matrixAutoUpdate = false;
      m.matrix.copy(p.mesh.matrixWorld);
      m.matrixWorldNeedsUpdate = true;
      m.renderOrder = 1;
      m.visible = p.visible;
      capGroup.add(m);
    });
    p.capBack = b; p.capFront = f;
  });
  const capMat = new THREE.MeshStandardMaterial({
    color:0x6f7885, metalness:.1, roughness:.85, side:THREE.DoubleSide,
    stencilWrite:true, stencilRef:0, stencilFunc:THREE.NotEqualStencilFunc,
    stencilFail:THREE.ReplaceStencilOp, stencilZFail:THREE.ReplaceStencilOp, stencilZPass:THREE.ReplaceStencilOp});
  capQuad = new THREE.Mesh(new THREE.PlaneGeometry(modelSize*4, modelSize*4), capMat);
  capQuad.renderOrder = 2;
  capQuad.onAfterRender = r => r.clearStencil();
  capGroup.add(capQuad);
  scene.add(capGroup);
}
function disposeCaps(){
  if (!capGroup) return;
  scene.remove(capGroup);
  capGroup.traverse(n=>{ if (n.material) n.material.dispose(); });
  if (capQuad) capQuad.geometry.dispose();
  parts.forEach(p=>{ p.capBack = null; p.capFront = null; });
  capGroup = null; capQuad = null;
}

