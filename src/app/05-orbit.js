// ── Orbit ────────────────────────────────────────────────────
// Left-drag turns the model with no end stop. OrbitControls stopped the camera dead at its poles:
// a drag up or down froze once the view looked straight down or up, however far the mouse went.
// It keeps pan and zoom; turning is done here, the way it turned everywhere else — sideways about
// the vertical (Y) like a turntable, up and down about the screen's horizontal — but straight on
// over the top. Past it the model is upside down, and a sideways drag still carries its near side
// with the cursor. One canvas height of drag is one full turn, eased by the controls' damping.
const ORBIT_TURN = 2 * Math.PI;                      // radians per canvas height of drag, as OrbitControls
const _Y = new THREE.Vector3(0, 1, 0), _oo = new THREE.Vector3(), _ox = new THREE.Vector3();
const _oq = new THREE.Quaternion(), _oq2 = new THREE.Quaternion();
let orbitDrag = null, orbitDX = 0, orbitDY = 0;      // the pointer turning the view; drag (px) not yet applied
controls.enableRotate = false;

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' && orbitDrag){ orbitDrag = null; return; }    // a second finger: OrbitControls pinches
  const mod = e.ctrlKey || e.metaKey || e.shiftKey;                            // as OrbitControls: a modifier swaps the buttons
  if (orbitDrag || !controls.enabled || !(e.pointerType === 'touch' ? e.isPrimary : e.button === (mod ? 2 : 0))) return;
  orbitDrag = {id:e.pointerId, x:e.clientX, y:e.clientY};
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
  const flip = camera.up.y < 0 ? -1 : 1;             // upside down, turn the other way: the model follows the cursor
  _oq.setFromAxisAngle(_Y, -flip * ORBIT_TURN * dx / h).multiply(_oq2.setFromAxisAngle(_ox, -ORBIT_TURN * dy / h));
  _oo.applyQuaternion(_oq).multiplyScalar(r);
  camera.up.applyQuaternion(_oq);
  camera.position.copy(controls.target).add(_oo);
  camera.lookAt(controls.target);
}
// Each frame, before the controls update: the damped share of the drag, the tail landing exactly.
function orbitStep(){
  if (!orbitDX && !orbitDY) return;
  const f = controls.enableDamping ? controls.dampingFactor : 1;
  let dx = orbitDX * f, dy = orbitDY * f;
  if (Math.abs(orbitDX - dx) < 0.01 && Math.abs(orbitDY - dy) < 0.01){ dx = orbitDX; dy = orbitDY; }
  orbitDX -= dx; orbitDY -= dy;
  orbitBy(dx, dy);
}
function orbitStop(){ orbitDX = orbitDY = 0; }       // a view set outright ends any coasting turn
