// ── Plane through an axis, turned by an angle ────────────────
// Toolbar Plane or D. Axis Pick…: click a cylinder, a cone, a circular edge or a straight edge; its axis is
// the pivot, its + end the world direction it mostly points along. From: Front, Top or Left (the reference
// planes of 75-planes.js), or Face… (a flat face of a part). Angle: the plane's turn about the axis, +
// counter-clockwise seen from the axis's + end. At 0 it is the plane through the axis that lies closest to
// the reference -- parallel to it when the axis is -- and no angle is defined when the axis is square to the
// reference. The plane is drawn at once, a sheet in the scene like the reference planes (not picked in the
// model, not measured, not cut); Look turns the view square to it (Normal to), Keep leaves it there, named
// P1, P2 …. Normal to can click any drawn plane. A plane follows the part its axis was picked on.
// Mode: Axis + angle (above) or Two axes -- the plane holding two parallel axes (77-datum2.js).
let datumPickMode = null;            // 'axis' | 'axis2' | 'face' while the next click is for it
let datumMode = 'angle';             // 'angle': one axis turned from a reference | 'two': through two parallel axes
let datumAxis2 = null;               // the second axis, as datumAxis, in Two axes mode
let datumAxis = null;                // {o, d, part, geom, exact}: a point on the axis (assembled), unit direction
let datumRef = null;                 // {name, n, exact}: the reference plane's name and unit normal (assembled)
let datumAngle = 0, datumSeq = 0;
const datumKept = [], datumNodes = [];
const DATUM_COLOR = 0x7e22ce;
const DATUM_HALF = 0.75;             // a sheet reaches this many model sizes either side of its axis point
const DATUM_SKEW = 0.01;             // sin 0.6°: nearer square than this, the reference gives no angle to start from
const DATUM_SKEW_MESH = 0.05;        // sin 2.9°: a pick fitted to the mesh is that uncertain, so its 0° is not trusted nearer square

$('btnDatum').addEventListener('click', () => datumPanel(!$('datumpanel').classList.contains('show')));
$('btnDatumAxis').addEventListener('click', () => datumPick('axis'));
$('btnDatumFace').addEventListener('click', () => datumPick('face'));
$('btnDatumAxis2').addEventListener('click', () => datumPick('axis2'));
$('btnDatumModeAngle').addEventListener('click', () => setDatumMode('angle'));
$('btnDatumModeTwo').addEventListener('click', () => setDatumMode('two'));
document.querySelectorAll('[data-dref]').forEach(b => b.addEventListener('click', () => {
  const pl = PLANES.find(q => q.label === b.dataset.dref);
  datumRef = {name:pl.label, n:new THREE.Vector3().setComponent(pl.n, 1), exact:true};
  datumPickMode = null; moveCursor(); datumChanged();
}));
$('datumSlider').addEventListener('input', e => setDatumAngle(e.target.value));
$('datumAngle').addEventListener('change', e => setDatumAngle(e.target.value));
$('btnDatumLook').addEventListener('click', datumLook);
$('btnDatumKeep').addEventListener('click', datumKeep);
$('btnDatumClear').addEventListener('click', datumClear);

function datumPanel(on){
  $('datumpanel').classList.toggle('show', on);
  $('btnDatum').classList.toggle('active', on);
  $('btnDatum').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (!on && datumPickMode) datumPickCancel();
  datumSync();
}
function datumPick(kind){
  if (!modelRoot){ toast('Load a model first'); return; }
  const again = datumPickMode === kind;
  endPickModes();
  if (!again){
    datumPickMode = kind;
    if (!edgesOn) toggleEdges();     // an edge is easier to aim at when it is drawn
  }
  moveCursor(); datumSync();
}
function datumPickCancel(){ datumPickMode = null; moveCursor(); datumSync(); }
function setDatumAngle(text){
  const v = parseFloat(String(text).replace(',', '.'));
  if (Number.isFinite(v) && Math.abs(v) <= 3600) datumAngle = Math.abs(v) > 180 ? v - 360 * Math.round(v / 360) : v;   // the slider's range
  datumChanged();
}

// The normal of the plane through an axis (unit a) turned deg about it from a reference plane (unit normal
// r): r with its part along a taken out is the normal of the plane through the axis closest to the
// reference (n0), and the turn is right-handed about a. Null when a is square to r, within `skew` (a sine).
function datumNormal(a, r, deg, skew = DATUM_SKEW){
  const n0 = r.clone().addScaledVector(a, -r.dot(a));
  if (n0.lengthSq() < skew * skew) return null;
  n0.normalize();
  const t = THREE.MathUtils.degToRad(deg), w = new THREE.Vector3().crossVectors(a, n0);
  return n0.multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t)).normalize();
}
function datumPlane(){               // the plane the panel describes, or null
  if (datumMode === 'two') return twoAxisPlane();
  if (!datumAxis || !datumRef) return null;
  const exact = !!(datumAxis.exact && datumRef.exact);
  const n = datumNormal(datumAxis.d, datumRef.n, datumAngle, exact ? DATUM_SKEW : DATUM_SKEW_MESH);
  return n && {n, a:datumAxis.d, o:datumAxis.o, part:datumAxis.part, ref:datumRef.name, angle:datumAngle, exact,
               tilt:datumTilt(datumAxis.d, datumRef.n)};
}
const datumTilt = (a, r) => THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.abs(a.dot(r)))));   // axis off the reference plane
// What the plane is, for its label and the toast. An axis that crosses the reference is not in it, so the
// angle is not the one between the two planes: it says what it is the angle of.
const datumDesc = d => d.two ? 'through two axes' + (d.assembled ? ' as assembled' : '') + (d.exact ? '' : ' (mesh)') : +d.angle.toFixed(2) + '°' + (d.tilt > 0.5
  ? ' about the axis from the plane nearest ' + d.ref + ' (axis ' + d.tilt.toFixed(1) + '° off it)' : ' from ' + d.ref) +
  (d.exact ? '' : ' (mesh)');
const datumSame = (p, q) => p.part === q.part && p.n.dot(q.n) > 1 - 1e-12 && p.o.distanceTo(q.o) < 1e-12 &&
                            p.a.dot(q.a) > 1 - 1e-12;

// The click after Axis Pick… or Face… (pick() in 30-select.js sends it here): a face or edge, as Measure picks.
function pickDatum(e){
  const ent = entityAt(e);
  if (datumPickMode === 'axis' || datumPickMode === 'axis2'){
    const ax = ent && ent.geom.type !== 'plane' && axisFrom(ent);
    if (!ax){ toast('No axis there — click a cylinder, a cone, a circular edge or a straight edge'); return; }
    const i = [0, 1, 2].reduce((m, k) => Math.abs(ax.d.getComponent(k)) > Math.abs(ax.d.getComponent(m)) + 1e-9 ? k : m, 0);
    if (ax.d.getComponent(i) < 0) ax.d.negate();       // + is the world direction it mostly points along
    const v = {o:footOnLine(modelCenter, ax.p, ax.d), d:ax.d, part:ax.part, geom:ax.geom, exact:ax.exact};
    if (datumPickMode === 'axis2') datumAxis2 = v; else datumAxis = v;
  } else {
    if (!ent || ent.geom.type !== 'plane'){ toast('That is not a flat face — click a flat face'); return; }
    datumRef = {name:'face', n:ent.geom.n.clone().normalize(), exact:!!ent.exact};
  }
  datumPickMode = null; moveCursor(); datumChanged();
}

function datumChanged(){ datumDraw(); datumSync(); }
// Every kept plane, and the one being set up unless it is the one just kept: a sheet each, in a group that
// follows its part.
function datumDraw(){
  datumNodes.splice(0).forEach(g => { scene.remove(g); followers.delete(g); disposeNode(g); });
  const cur = datumPlane();
  datumKept.concat(cur && !datumKept.some(k => datumSame(k, cur)) ? [Object.assign(cur, {name:'Plane'})] : [])
    .forEach(d => datumNodes.push(datumNode(d)));
}
function datumNode(d){
  const g = new THREE.Group(), s = DATUM_HALF * modelSize, w = new THREE.Vector3().crossVectors(d.a, d.n).normalize();
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => d.o.clone().addScaledVector(d.a, i * s).addScaledVector(w, j * s));
  const text = d.name + '  ' + datumDesc(d);
  const [sheet, line] = planeSheet(c, DATUM_COLOR, d.name, d.n, text);
  sheet.userData.up = d.a;           // Normal to stands the axis upright on the screen
  g.add(sheet, line);
  const tag = planeLabel({name:d.name, label:text, color:DATUM_COLOR});
  if (tag){ tag.position.copy(c[2]).lerp(c[0], 0.08); g.add(tag); }
  g.name = 'datum plane ' + d.name;
  scene.add(g);
  follow(g, d.part, null);
  return g;
}
function datumLook(){
  const d = datumPlane();
  if (d) lookAtPlane({n:d.n, point:d.o.clone().add(d.part.offset), up:d.a, title:'the plane ' + (d.two ? '' : 'through the axis, ') + datumDesc(d)});
}
function datumKeep(){
  const d = datumPlane();
  if (!d) return;
  datumKept.push(Object.assign(d, {name:'P' + ++datumSeq}));
  datumChanged();
  toast('Kept as ' + d.name);
}
function datumClear(){
  datumKept.length = 0; datumAxis = null; datumAxis2 = null; datumRef = null;
  datumChanged();
}
function datumReset(){               // a new model: its parts are gone, and so are the planes through their axes
  datumKept.length = 0; datumAxis = null; datumAxis2 = null; datumRef = null; datumAngle = 0; datumSeq = 0; datumPickMode = null;
  $('datumSlider').value = 0; $('datumAngle').value = 0;
  datumDraw(); datumSync();
}
const dirText = d => { const i = [0, 1, 2].find(k => Math.abs(d.getComponent(k)) > 0.99999);
  return i === undefined ? '(' + d.toArray().map(x => x.toFixed(2)).join(', ') + ')' : '+' + 'XYZ'[i]; };
function datumSync(){                // the panel, after anything that changes the axis, the reference or the angle
  const pl = datumPlane(), a = datumAxis, r = datumRef;
  $('datumAxisName').textContent = a ? axisName(a) + ', + along ' + dirText(a.d) : 'none';   // named when shown: follows the units
  $('datumAxisName').classList.toggle('none', !a);
  $('btnDatumAxis').classList.toggle('active', datumPickMode === 'axis');
  $('btnDatumFace').classList.toggle('active', datumPickMode === 'face' || (!!r && r.name === 'face'));
  document.querySelectorAll('[data-dref]').forEach(b => b.classList.toggle('active', !!r && r.name === b.dataset.dref));
  $('datumSlider').value = datumAngle; $('datumAngle').value = datumAngle;
  $('btnDatumLook').disabled = $('btnDatumKeep').disabled = !pl;
  $('btnDatumClear').disabled = !datumKept.length && !a && !r && !datumAxis2;
  if (twoAxisSync()) return;         // Two axes mode has its own rows and hint
  const tilt = a && r ? datumTilt(a.d, r.n) : 0;
  $('datumHint').textContent =
      datumPickMode === 'axis' ? 'Click a cylinder, a cone, a circular edge or a straight edge: its axis is the pivot.'
    : datumPickMode === 'face' ? 'Click a flat face to measure the angle from.'
    : !a ? 'Pick the axis the plane passes through.'
    : !r ? 'Choose what the angle is measured from: Front, Top, Left or a flat face.'
    : !pl ? 'The axis is square to that reference, so there is no angle to measure from: choose another reference.'
    : 'Angle from ' + r.name + (r.exact ? '' : ' (mesh)') + ', turned about the axis: + is counter-clockwise seen from its + end.' +
      (tilt > 0.5 ? ' The axis crosses the reference at ' + tilt.toFixed(1) + '°: 0° is the plane through it that lies closest to the reference.' : '');
}

// The nearest visible plane sheet under the ray (setRay already called): a reference plane that is shown,
// or a plane made here. {n, point, distance, title, up}: what a click on it looks square at.
function planeHit(){
  const sheets = [];
  if (planesOn && planeRoot) planeRoot.children.forEach(o => { if (o.isMesh) sheets.push(o); });
  datumNodes.forEach(g => g.children.forEach(o => { if (o.isMesh) sheets.push(o); }));
  const h = sheets.length ? raycaster.intersectObjects(sheets, false)[0] : null;
  const u = h && h.object.userData;
  return h ? {n:u.normal, point:h.point, distance:h.distance, title:u.title, up:u.up || null} : null;
}
