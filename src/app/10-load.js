// ── Load ─────────────────────────────────────────────────────
const gltfLoader = new THREE.GLTFLoader(), stlLoader = new THREE.STLLoader();

// The viewer is air-gapped. tests/check_invariants.py checks every URL written
// in source; a URL that only exists at RUNTIME -- a ?model= query, a buffer or
// image uri inside a dropped .gltf -- is checked here, and every such route goes
// through this one function. Local means data:, blob:, a file: path with no host
// (file://server/share is SMB on Windows), or this page's own origin.
function sameOrigin(url){
  const u = new URL(url, location.href);
  const local = u.protocol === 'data:' || u.protocol === 'blob:' ||
    (u.protocol === 'file:' ? u.host === '' : u.origin === location.origin);
  if (!local) throw new Error('blocked a request to another host: ' + u.href);
  return u.href;
}
// Every three.js loader resolves the URLs it fetches through the default
// loading manager, so this one hook covers every uri a glTF can carry. The throw
// rejects the load, and fail() shows the user which host was refused.
THREE.DefaultLoadingManager.setURLModifier(sameOrigin);

function sniff(buf){
  const head = new Uint8Array(buf, 0, Math.min(128, buf.byteLength));
  const ascii = String.fromCharCode.apply(null, head);
  if (ascii.startsWith('glTF')) return 'glb';
  if (ascii.startsWith('ISO-10303')) return 'step';
  const txt = ascii.replace(/^\s+/, '');
  if (txt.startsWith('{')) return 'gltf';
  if (txt.startsWith('solid')) return 'stl';
  return 'stl-binary';
}
function defaultMat(){ return new THREE.MeshStandardMaterial({color:0x9aa4b0, metalness:.25, roughness:.55}); }

function clearModel(){
  clearSelection(); sectionOff(); disposeCaps();
  if (modelRoot){ scene.remove(modelRoot); disposeTree(modelRoot); modelRoot = null; }
  if (edgeRoot){ scene.remove(edgeRoot); disposeTree(edgeRoot); edgeRoot = null; }
  edgesOn = false; $('btnEdges').classList.remove('active');
  parts = []; bboxCached = null; $('parts').innerHTML = '';
}
function disposeTree(o){
  o.traverse(n=>{
    if (n.geometry) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose());
  });
}
function loadArrayBuffer(buf, name, startedAt){
  const t0 = startedAt || performance.now();
  spin(true, 'reading mesh');
  const kind = sniff(buf);
  unitScale = (kind === 'glb' || kind === 'gltf') ? 1000 : 1;
  const finish = root => { clearModel(); modelRoot = root; scene.add(root); afterLoad(name, buf.byteLength, performance.now()-t0); };
  try {
    if (kind === 'step'){
      fail(new Error('this is a STEP file — start the viewer with stepview.py so it can be converted here'));
    } else if (kind === 'glb' || kind === 'gltf'){
      gltfLoader.parse(buf, '', g => finish(g.scene), err => fail(err));
    } else {
      const geo = stlLoader.parse(buf); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, defaultMat()); mesh.name = name.replace(/\.[^.]+$/, '');
      const g = new THREE.Group(); g.add(mesh); finish(g);
    }
  } catch(err){ fail(err); }
}
function fail(err){
  spin(false);
  const msg = err && err.message ? err.message : String(err);
  const text = (err && err.plain) ? msg : 'Could not open — ' + msg;
  toast(text.length > 200 ? text.slice(0,200)+'…' : text, 5000);
  console.error(err);
}
let spinTimer = null;
function spin(on, label){
  const el = $('spin'); el.classList.toggle('show', !!on);
  clearInterval(spinTimer); if (!on) return;
  const t0 = performance.now();
  const paint = ()=>{ el.textContent = label + ' — ' + ((performance.now()-t0)/1000).toFixed(1) + ' s'; };
  paint(); spinTimer = setInterval(paint, 100);
}

function afterLoad(name, bytes, ms){
  let tris = 0; parts = [];
  modelRoot.updateWorldMatrix(true, true);
  modelRoot.traverse(n=>{
    if (n.isMesh){
      if (!n.material || n.material.type === 'MeshBasicMaterial') n.material = defaultMat();
      else n.material = n.material.clone();          // per-part material: clipping is set per part
      n.material.side = THREE.DoubleSide;
      const t = n.geometry.index ? n.geometry.index.count/3 : n.geometry.attributes.position.count/3;
      tris += t;
      parts.push({mesh:n, name:n.name || (n.parent && n.parent.name) || ('part_'+parts.length),
                  tris:t, visible:true, rowEl:null, edges:null});
    }
  });
  bboxCached = computeBBox();
  if (bboxCached){
    const s = bboxCached.getSize(new THREE.Vector3());
    modelSize = Math.max(s.x, s.y, s.z) || 1;
    bboxCached.getCenter(modelCenter);
    $('stBbox').textContent = [s.x,s.y,s.z].map(v=>L(v)).join(' × ') + ' mm';
  }
  frame(VIEWS.iso);
  buildPartList();

  $('fname').textContent = name;
  $('loadtime').textContent = convertMs
    ? 'tessellated + loaded in ' + (ms/1000).toFixed(1) + ' s'
    : 'loaded in ' + (ms/1000).toFixed(2) + ' s';
  convertMs = 0;
  $('loadtime').classList.remove('empty');
  document.title = name + ' — QuickSTEP';
  $('stParts').textContent = parts.length;
  $('stTris').textContent = Math.round(tris).toLocaleString();
  $('stSize').textContent = bytes > 1e6 ? (bytes/1e6).toFixed(1)+' MB' : Math.round(bytes/1e3)+' kB';
  $('drop').classList.add('hidden');
  spin(false);
  if (parts.length > 1){ $('sidebar').classList.remove('hidden'); $('btnParts').classList.add('active'); }
  // caps get expensive on very large assemblies — start off there
  capsWanted = parts.length <= 400;
  $('btnCaps').classList.toggle('active', capsWanted);
}

