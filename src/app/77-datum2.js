// ── Plane through two parallel axes ──────────────────────────
// Plane panel → Mode: Two axes. Axis Pick… and Axis 2 Pick…: click a cylinder, a cone, a circular edge or a
// straight edge each, as for the plane through one axis (76-datum.js shares its state, its drawing, Look, Keep
// and Clear). The plane is the one that holds both axes, so they must be parallel -- within DATUM_PAR when
// both come from the STEP B-rep, within DATUM_SKEW_MESH when either is fitted to the mesh -- and not the same
// line. Its direction in the plane is the two axes' mean, its sheet centred midway between them, and it
// follows the part the first axis was picked on.
const DATUM_PAR = 1e-4;              // sin 0.006°: B-rep axes nearer parallel than this are parallel

function setDatumMode(m){
  if (m === datumMode) return;
  if (datumPickMode && datumPickMode !== 'axis') datumPickCancel();   // Axis 2 / Face… belong to one mode
  datumMode = m;
  datumChanged();
}

// The plane through two axes {o, d, exact} (o a point on each, d unit), or {why} saying why there is none:
// 'skew' (not parallel, `deg` apart) or 'same' (one line). `d` of the plane is the axes' mean direction,
// `o` the point midway between them, `dist` how far apart they are.
function twoAxisFit(p, q){
  const exact = !!(p.exact && q.exact);
  const d2 = p.d.dot(q.d) < 0 ? q.d.clone().negate() : q.d.clone();
  const s = new THREE.Vector3().crossVectors(p.d, d2).length();
  const deg = THREE.MathUtils.radToDeg(Math.asin(Math.min(1, s)));
  if (s > (exact ? DATUM_PAR : DATUM_SKEW_MESH)) return {why:'skew', deg};
  const a = p.d.clone().add(d2).normalize();
  const v = new THREE.Vector3().subVectors(q.o, p.o);
  v.addScaledVector(a, -v.dot(a));                   // across from one axis to the other, square to both
  const dist = v.length();
  if (dist < 1e-6 * Math.max(modelSize, 1e-9)) return {why:'same', deg};
  return {n:new THREE.Vector3().crossVectors(a, v).normalize(), a, o:p.o.clone().addScaledVector(v, 0.5),
          dist, deg, exact};
}
function twoAxisPlane(){             // the Two axes plane the panel describes, or null
  if (!datumAxis || !datumAxis2) return null;
  const f = twoAxisFit(datumAxis, datumAxis2);
  return f.why ? null : Object.assign(f, {part:datumAxis.part, two:true, ref:'two axes', angle:0});
}

// The rows and the hint for the mode chosen (datumSync calls it); true in Two axes mode, where the rest of
// datumSync -- the reference and angle rows -- does not apply.
function twoAxisSync(){
  const two = datumMode === 'two', b = datumAxis2;
  $('btnDatumModeAngle').classList.toggle('active', !two);
  $('btnDatumModeTwo').classList.toggle('active', two);
  $('btnDatumModeAngle').setAttribute('aria-pressed', two ? 'false' : 'true');
  $('btnDatumModeTwo').setAttribute('aria-pressed', two ? 'true' : 'false');
  $('datumRowFrom').hidden = $('datumRowAngle').hidden = two;
  $('datumRowAxis2').hidden = !two;
  $('datumTitle').textContent = two ? 'Plane through two axes' : 'Plane through axis';
  if (!two) return false;
  $('datumAxis2Name').textContent = b ? axisName(b) + ', + along ' + dirText(b.d) : 'none';
  $('datumAxis2Name').classList.toggle('none', !b);
  $('btnDatumAxis2').classList.toggle('active', datumPickMode === 'axis2');
  const a = datumAxis, f = a && b ? twoAxisFit(a, b) : null;
  $('datumHint').textContent =
      datumPickMode === 'axis' || datumPickMode === 'axis2'
      ? 'Click a cylinder, a cone, a circular edge or a straight edge: the plane passes through its axis.'
    : !a || !b ? 'Pick two parallel axes — two holes, two shafts, a hole and an edge: the plane passes through both.'
    : f.why === 'skew' ? 'The axes are ' + f.deg.toFixed(2) + '° apart, not parallel, so no one plane holds both: pick another.'
    : f.why === 'same' ? 'The two axes are one line, so any plane through it holds both: pick one beside it, or use Axis + angle.'
    : 'Through both axes, ' + L(f.dist) + MM() + ' apart' + (f.exact ? '' : ' (mesh)') +
      (f.deg >= 0.005 ? '; they are ' + f.deg.toFixed(2) + '° off parallel, so it runs along their mean direction.' : '.') +
      (a.part !== b.part ? ' It follows the first axis\'s part when the assembly is exploded.' : '');
  return true;
}
