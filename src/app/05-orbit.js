// ── Orbit ────────────────────────────────────────────────────
// Left-drag turns the model with no end stop. OrbitControls stopped the camera dead at its poles:
// a drag up or down froze once the view looked straight down or up, however far the mouse went.
// It keeps pan and zoom; turning is done here, the way it turned everywhere else — sideways about
// the vertical like a turntable, up and down about the screen's horizontal — but straight on
// over the top. Past it the model is upside down, and a sideways drag still carries its near side
// with the cursor. One canvas height of drag is one full turn, eased by the controls' damping.
// "The vertical" is the world axis (X, Y or Z) that points most nearly up the screen, picked when a drag or a
// key turn begins and kept until it ends: Y in the standard views, Z once Z is up the screen. Looking nearly
// along Y (the Top view) it stays Y, the turn in the plane of the screen.
const ORBIT_TURN = 2 * Math.PI;                      // radians per canvas height of drag, as OrbitControls
const _Y = new THREE.Vector3(0, 1, 0), _oo = new THREE.Vector3(), _ox = new THREE.Vector3();
const _oq = new THREE.Quaternion(), _oq2 = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
let orbitDrag = null, orbitDX = 0, orbitDY = 0;      // the pointer turning the view; drag (px) not yet applied
let orbitDZ = 0;                                     // turn about the world Z axis (radians) not yet applied
const _ou = new THREE.Vector3(), orbitPivot = new THREE.Vector3(0, 1, 0);   // the axis a sideways turn is about
controls.enableRotate = false;

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && orbitDrag){ orbitDrag = null; return; }    // a second finger: OrbitControls pinches
  const mod = e.ctrlKey || e.metaKey || e.shiftKey;                            // as OrbitControls: a modifier swaps the buttons
  if (orbitDrag || !controls.enabled || !(e.pointerType === 'touch' ? e.isPrimary : e.button === (mod ? 2 : 0))) return;
  orbitDrag = {id:e.pointerId, x:e.clientX, y:e.clientY};
  orbitPickPivot();
});
canvas.addEventListener('pointermove', e => {
  if (!orbitDrag || e.pointerId !== orbitDrag.id) return;
  if (!e.buttons){ orbitDrag = null; return; }                                 // released unseen (focus lost mid-drag)
  orbitDX += e.clientX - orbitDrag.x; orbitDY += e.clientY - orbitDrag.y;
  orbitDrag.x = e.clientX; orbitDrag.y = e.clientY;
});
const orbitEnd = e => { if (orbitDrag && e.pointerId === orbitDrag.id) orbitDrag = null; };
canvas.addEventListener('pointerup', orbitEnd);
canvas.addEventListener('pointercancel', orbitEnd);

// Choose the axis a sideways turn is about: the world axis most nearly up the screen, Y on a tie.
function orbitPickPivot(){
  _oo.subVectors(camera.position, controls.target);
  if (!(_oo.length() > 0) || Math.abs(_oo.y) > 0.95 * _oo.length()){ orbitPivot.copy(_Y); return; }  // along Y: the in-plane turn
  _oo.normalize();
  _ox.crossVectors(camera.up, _oo);                  // the screen's right, as lookAt() builds it
  if (_ox.lengthSq() < 1e-20) _ox.setFromMatrixColumn(camera.matrixWorld, 0);
  _ou.crossVectors(_oo, _ox.normalize());            // the screen's up
  const x = Math.abs(_ou.x), y = Math.abs(_ou.y), z = Math.abs(_ou.z);
  if (z > y + 1e-9 && z >= x) orbitPivot.copy(_Z); else if (x > y + 1e-9) orbitPivot.set(1, 0, 0); else orbitPivot.copy(_Y);
}
// Turn the camera about the target for a drag of dx, dy px (right and down are positive).
function orbitBy(dx, dy){
  _oo.subVectors(camera.position, controls.target);
  const r = _oo.length(), h = canvas.clientHeight || 1;
  if (!(r > 0)) return;
  _oo.divideScalar(r);                               // unit, target to camera
  _ox.crossVectors(camera.up, _oo);                  // the screen's right, as lookAt() builds it
  if (_ox.lengthSq() < 1e-20) _ox.setFromMatrixColumn(camera.matrixWorld, 0);
  _ox.normalize();
  camera.up.crossVectors(_oo, _ox);                  // the screen's up, square to the view: it turns with it
  const flip = camera.up.dot(orbitPivot) < 0 ? -1 : 1;             // upside down, turn the other way: the model follows the cursor
  _oq.setFromAxisAngle(orbitPivot, -flip * ORBIT_TURN * dx / h).multiply(_oq2.setFromAxisAngle(_ox, -ORBIT_TURN * dy / h));
  _oo.applyQuaternion(_oq).multiplyScalar(r);
  camera.up.applyQuaternion(_oq);
  camera.position.copy(controls.target).add(_oo);
  camera.lookAt(controls.target);
}
// Turn the model by a radians about the world Z axis through the target, clockwise seen from the tip of +Z
// for a positive a: the camera goes the other way round, carrying its up with it.
function orbitZBy(a){
  _oo.subVectors(camera.position, controls.target);
  if (!(_oo.length() > 0)) return;
  _oq.setFromAxisAngle(_Z, a);
  _oo.applyQuaternion(_oq);
  camera.up.applyQuaternion(_oq);
  camera.position.copy(controls.target).add(_oo);
  camera.lookAt(controls.target);
}
// Each frame, before the controls update: the damped share of the drag, the tail landing exactly.
function orbitStep(){
  if (!orbitDX && !orbitDY && !orbitDZ) return;
  const f = controls.enableDamping ? controls.dampingFactor : 1;
  let dx = orbitDX * f, dy = orbitDY * f, dz = orbitDZ * f;
  if (Math.abs(orbitDX - dx) < 0.01 && Math.abs(orbitDY - dy) < 0.01 && Math.abs(orbitDZ - dz) < 1e-5){ dx = orbitDX; dy = orbitDY; dz = orbitDZ; }
  orbitDX -= dx; orbitDY -= dy; orbitDZ -= dz;
  if (dx || dy) orbitBy(dx, dy);
  if (dz) orbitZBy(dz);
}
// The arrow keys turn the model as a drag would, ARROW_STEP at a press (held down, they repeat). Left and
// right turn it sideways, up and down tip it; Shift with Left / Right turns it about the world Z axis, the
// one turn a drag does not give (right = clockwise seen from the tip of +Z). Other modifiers are left to the
// browser, and so are the fields.
const ARROW_STEP = 15 * Math.PI / 180;
const ARROW_DRAG = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]};
window.addEventListener('keydown', e => {
  const d = ARROW_DRAG[e.key];
  if (!d || !controls.enabled || e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && d[0] === 0)) return;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  e.preventDefault();                                // the page must not scroll under the view
  if (e.shiftKey){ orbitDZ += d[0] * ARROW_STEP; return; }
  if (!orbitDX && !orbitDY) orbitPickPivot();
  const px = ARROW_STEP / ORBIT_TURN * (canvas.clientHeight || 1);
  orbitDX += d[0] * px; orbitDY += d[1] * px;        // eased in by orbitStep(), like a drag
});
function orbitStop(){ orbitDX = orbitDY = orbitDZ = 0; }       // a view set outright ends any coasting turn
