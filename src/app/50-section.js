// ── Section planes ───────────────────────────────────────────
// sectionPlane is the cut in assembled coordinates. Each part is clipped by its own copy, moved
// with the part when the assembly is exploded, so every part keeps the cut it had assembled.
const sectionPlane = new THREE.Plane(new THREE.Vector3(1,0,0), 0);
let sectionActive = false, sectionNormalBase = new THREE.Vector3(1,0,0),
    sectionPoint = new THREE.Vector3(), sectionFlip = 1, sectionOffset = 0,
    sectionKind = null, capsWanted = true, capGroup = null,
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
  sectionPoint.copy(pickedCircle.rest);          // assembled; each part's cut moves with the part
  $('secAngle').disabled = false;
  document.querySelectorAll('[data-sec]').forEach(x => x.classList.remove('active'));
  sectionOffset = 0; $('secOffset').value = 0; $('secOffsetVal').textContent = '0.00';
  $('secHint').innerHTML = 'Plane runs through the axis of the Ø' + L(pickedCircle.radius*2) + MM() +
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
  parts.forEach(p=>{
    p.mesh.material.clippingPlanes = [p.clip]; p.mesh.material.needsUpdate = true;
    if (p.edges){ p.edges.material.clippingPlanes = [p.clip]; p.edges.material.needsUpdate = true; }
  });
  if (capsWanted && !capGroup) buildCaps();
  updatePlane();
}
function sectionOff(){
  sectionActive = false;
  sectionKind = null;
  parts.forEach(p=>{
    if (p.mesh.material){ p.mesh.material.clippingPlanes = null; p.mesh.material.needsUpdate = true; }
    if (p.edges){ p.edges.material.clippingPlanes = null; p.edges.material.needsUpdate = true; }
  });
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
  syncClips();
}
const _zAxis = new THREE.Vector3(0, 0, 1), _cc = new THREE.Vector3();
function syncClips(){                 // each part's cut and cap: the section plane, moved with the part
  parts.forEach(p=>{
    p.clip.copy(sectionPlane);
    p.clip.constant -= p.clip.normal.dot(p.offset);
    if (!p.capQuad) return;
    p.clip.projectPoint(_cc.copy(p.restCenter).add(p.offset), p.capQuad.position);
    p.capQuad.quaternion.setFromUnitVectors(_zAxis, p.clip.normal);
  });
}
// Caps, part by part: count the part's clipped faces into the stencil (back faces up, front
// faces down), so it is non-zero where the view looks into the part through its cut; fill the
// cut there with a quad in the part's plane. The quad writes 0 wherever it lands, so it also
// hands a clean stencil to the next part — no full-screen clear per part.
function buildCaps(){
  if (!parts.length) return;
  capGroup = new THREE.Group();
  const mkStencil = (side, op, plane) => new THREE.MeshBasicMaterial({
    depthWrite:false, depthTest:false, colorWrite:false, side, clippingPlanes:[plane],
    stencilWrite:true, stencilFunc:THREE.AlwaysStencilFunc,
    stencilFail:op, stencilZFail:op, stencilZPass:op});
  const capMat = new THREE.MeshStandardMaterial({
    color:0x6f7885, metalness:.1, roughness:.85, side:THREE.DoubleSide,
    stencilWrite:true, stencilRef:0, stencilFunc:THREE.NotEqualStencilFunc,
    stencilFail:THREE.ReplaceStencilOp, stencilZFail:THREE.ReplaceStencilOp, stencilZPass:THREE.ReplaceStencilOp});
  const quad = new THREE.PlaneGeometry(1, 1), box = new THREE.Box3(), size = new THREE.Vector3();
  parts.forEach((p, i)=>{
    const b = new THREE.Mesh(p.mesh.geometry, mkStencil(THREE.BackSide,  THREE.IncrementWrapStencilOp, p.clip));
    const f = new THREE.Mesh(p.mesh.geometry, mkStencil(THREE.FrontSide, THREE.DecrementWrapStencilOp, p.clip));
    [b,f].forEach(m=>{
      m.matrixAutoUpdate = false;
      m.matrix.copy(p.mesh.matrixWorld);
      m.matrixWorldNeedsUpdate = true;
      m.renderOrder = 1 + 2*i;
      m.visible = p.visible;
      capGroup.add(m);
    });
    // wide enough for the part's cut wherever the plane crosses it: its bounding-box diagonal
    const c = new THREE.Mesh(quad, capMat);
    c.scale.setScalar(box.copy(p.mesh.geometry.boundingBox).applyMatrix4(p.restMatrix).getSize(size).length() * 1.05 + modelSize * 1e-3);
    c.renderOrder = 2 + 2*i;
    c.visible = p.visible;
    capGroup.add(c);
    p.capBack = b; p.capFront = f; p.capQuad = c;
  });
  scene.add(capGroup);
  syncClips();
}
function disposeCaps(){
  if (!capGroup) return;
  scene.remove(capGroup);
  new Set(capGroup.children.map(n => n.material)).forEach(m => m.dispose());   // the part geometry stays
  if (parts.length && parts[0].capQuad) parts[0].capQuad.geometry.dispose();
  parts.forEach(p=>{ p.capBack = null; p.capFront = null; p.capQuad = null; });
  capGroup = null;
}

