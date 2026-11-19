// ── Normal to a face, and the standard-view shortcuts ───────
// Normal to (Ctrl+8, as in SolidWorks) turns the view to look square at a face: the face selected in
// Face mode when it is flat, or else the next face clicked. The camera goes out along the face's normal on the side it was
// seen from, so the face is looked at from the outside; asked again while already square to it, it
// looks from the other side. A flat face uses its plane's normal (exact from the B-rep when the file
// carries it); a curved face the normal of the triangle under the click, and says so. Up is the world
// axis the standard views use: Y, or for a face looking up or down, as Top and Bottom do.
// Ctrl+1 … Ctrl+6 are Front, Rear, Top, Bottom, Left, Right; Ctrl+7 is Iso.
let normalPickMode = false;
const NORMAL_SAME = 0.9999;          // cos 0.8°: the view is already square to this face
const _nd = new THREE.Vector3(), _nu = new THREE.Vector3(), _nv = new THREE.Vector3();
const _nmx = new THREE.Matrix3();
$('btnNormal').addEventListener('click', normalTo);

function normalTo(){
  if (!modelRoot){ toast('Load a model first'); return; }
  if (normalPickMode){ normalPickCancel(); return; }
  if (selectedFace && selectedFace.geom.type === 'plane') return lookAtFace(selectedFace, null);
  if (axisPickMode) movePickCancel();
  if (explodePickMode) explodePickCancel();
  normalPickMode = true;
  $('btnNormal').classList.add('active');
  moveCursor();
  toast('Click a face to look square at it (Esc cancels)', 4000);
}
function normalPickCancel(){
  normalPickMode = false;
  $('btnNormal').classList.remove('active');
  moveCursor();
}
// The click after Normal to… (pick() in 30-select.js sends it here; the ray is already set).
function pickNormal(){
  const hit = raycaster.intersectObjects(parts.filter(p => p.visible).map(p => p.mesh), false)
                       .find(h => notClipped(h.point, h.object));
  if (!hit){ toast('No face there — click a face of the model'); return; }
  normalPickCancel();
  const part = parts.find(p => p.mesh === hit.object);
  const topo = topology(part.mesh.geometry);
  lookAtFace(faceEntity(part, topo.faceId[hit.faceIndex], hit.point.clone().sub(part.offset)), hit);
}
// The direction from a face to the camera that looks square at it, or null; `hit` is the raycast
// (drawn position) when there is one. Sets `faceNormalExact`: false when it is a triangle's normal.
let faceNormalExact = true;
function faceViewDir(ent, hit){
  if (ent.geom.type === 'plane'){ _nd.copy(ent.geom.n); faceNormalExact = true; }
  else if (hit && hit.face){
    _nd.copy(hit.face.normal).applyMatrix3(_nmx.getNormalMatrix(hit.object.matrixWorld)); faceNormalExact = false;
  } else return null;
  if (!(_nd.lengthSq() > 0)) return null;
  _nd.normalize();
  const at = hit ? hit.point : _nv.copy(ent.hit).add(ent.part.offset);
  if (_nu.subVectors(camera.position, at).dot(_nd) < 0) _nd.negate();      // the side it is seen from
  if (_nu.subVectors(camera.position, controls.target).normalize().dot(_nd) > NORMAL_SAME) _nd.negate();
  return _nd;
}
// Up for a view along d: world Y kept square to d; looking up or down, as Bottom and Top.
function viewUp(d, out){
  if (Math.abs(d.y) > 0.99) return out.set(0, 0, d.y > 0 ? -1 : 1);
  return out.set(0, 1, 0).addScaledVector(d, -d.y).normalize();
}
function lookAtFace(ent, hit){
  const d = faceViewDir(ent, hit);
  if (!d){ toast('That face has no single normal to look along'); return; }
  frame(d.clone(), viewUp(d, new THREE.Vector3()));
  toast(faceNormalExact ? 'Normal to the face' : 'Curved face — square to it at the point clicked');
}

// Ctrl (⌘ on a Mac) + 1 … 8, by key position so it works on any keyboard layout. Ctrl+1 … 8 switch
// tabs in most browsers; a page may take them, and this one does while the focus is not in a field.
const VIEW_KEYS = {1:'front', 2:'rear', 3:'top', 4:'bottom', 5:'left', 6:'right', 7:'iso'};
function viewKey(e){
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  const t = e.target && e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return false;
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code || '');
  if (!m) return false;
  e.preventDefault();
  if (m[1] === '8') normalTo(); else setView(VIEW_KEYS[m[1]]);
  return true;
}
window.addEventListener('keydown', viewKey);
