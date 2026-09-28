// ── Faces: topology and surface type ─────────────────────────
// Built once per geometry: welded triangle neighbours and a face id per triangle. Face
// ids come from the B-rep face index when cascadio wrote one; otherwise from index
// connectivity — OpenCASCADE gives every B-rep face its own vertices, so triangles that
// share vertex indices lie on one face; and for STL and other unindexed meshes from a
// flood fill that stops at a 20° break.
function topology(geo){
  if (geo.userData._topo) return geo.userData._topo;
  const pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
  const nTri = Math.floor((idx ? idx.length : pos.count) / 3);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const diag = geo.boundingBox.getSize(new THREE.Vector3()).length() || 1, q = diag * 1e-7;
  const vert = new Int32Array(nTri*3);
  for (let i = 0; i < nTri*3; i++) vert[i] = idx ? idx[i] : i;
  const weld = new Int32Array(pos.count), rep = [], wmap = new Map();
  for (let v = 0; v < pos.count; v++){
    const k = Math.round(pos.getX(v)/q) + '_' + Math.round(pos.getY(v)/q) + '_' + Math.round(pos.getZ(v)/q);
    let w = wmap.get(k);
    if (w === undefined){ w = rep.length; wmap.set(k, w); rep.push(v); }
    weld[v] = w;
  }
  const tn = new Float32Array(nTri*3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < nTri; t++){
    a.fromBufferAttribute(pos, vert[t*3]); b.fromBufferAttribute(pos, vert[t*3+1]); c.fromBufferAttribute(pos, vert[t*3+2]);
    b.sub(a).cross(c.sub(a));
    const l = b.length();
    if (l > 0){ tn[t*3] = b.x/l; tn[t*3+1] = b.y/l; tn[t*3+2] = b.z/l; }
  }
  // A sliver with two corners on one point (as at a sphere's pole) borders nothing: pairing
  // it would only steal its neighbours' edges.
  const sliver = new Uint8Array(nTri);
  for (let t = 0; t < nTri; t++){
    const wa = weld[vert[t*3]], wb = weld[vert[t*3+1]], wc = weld[vert[t*3+2]];
    sliver[t] = wa === wb || wb === wc || wa === wc ? 1 : 0;
  }
  // pair up half-edges across welded vertices; `shared` marks pairs that share vertex indices too
  const nbr = new Int32Array(nTri*3).fill(-1), shared = new Uint8Array(nTri*3), emap = new Map(), W = rep.length;
  let paired = 0, pairedShared = 0;
  for (let h = 0; h < nTri*3; h++){
    if (sliver[(h/3)|0]) continue;
    const h2 = h - h%3 + (h%3 + 1)%3, va = vert[h], vb = vert[h2], wa = weld[va], wb = weld[vb];
    const key = wa < wb ? wa*W + wb : wb*W + wa, o = emap.get(key);
    if (o === undefined){ emap.set(key, h); continue; }
    if (o < 0) continue;                      // a third triangle on one edge: leave it unpaired
    emap.set(key, -1);
    const o2 = o - o%3 + (o%3 + 1)%3;
    nbr[h] = (o/3)|0; nbr[o] = (h/3)|0; paired++;
    if ((vert[o] === vb && vert[o2] === va) || (vert[o] === va && vert[o2] === vb)){ shared[h] = shared[o] = 1; pairedShared++; }
  }
  const faceId = new Int32Array(nTri), brep = geo.userData.brep;
  let nFace = 0, source;
  const brepMax = brep && brep.tri.length === nTri ? brep.tri.reduce((m, v) => v > m ? v : m, 0) : -1;
  if (brepMax >= 0 && brepMax < Math.max(nTri, brep.faces.length)){
    for (let t = 0; t < nTri; t++) faceId[t] = brep.tri[t];
    nFace = brepMax + 1; source = 'brep';
  } else {
    const byIndex = !!idx && pairedShared > paired * 0.05;
    const cosLim = Math.cos(THREE.MathUtils.degToRad(byIndex ? 80 : 20));
    const degen = t => tn[t*3] === 0 && tn[t*3+1] === 0 && tn[t*3+2] === 0;
    const stack = [];
    faceId.fill(-1);
    for (let s = 0; s < nTri; s++){
      if (faceId[s] >= 0) continue;
      faceId[s] = nFace; stack.push(s);
      while (stack.length){
        const t = stack.pop();
        for (let k = 0; k < 3; k++){
          const h = t*3 + k, u = nbr[h];
          if (u < 0 || faceId[u] >= 0 || (byIndex && !shared[h])) continue;
          if (degen(t) || degen(u)){ if (!byIndex) continue; }
          else if (Math.abs(tn[t*3]*tn[u*3] + tn[t*3+1]*tn[u*3+1] + tn[t*3+2]*tn[u*3+2]) < cosLim) continue;
          faceId[u] = nFace; stack.push(u);
        }
      }
      nFace++;
    }
    if (byIndex){                              // slivers join the face that owns their vertices
      const vface = new Int32Array(pos.count).fill(-1);
      for (let t = 0; t < nTri; t++) if (!sliver[t]) for (let k = 0; k < 3; k++) vface[vert[t*3+k]] = faceId[t];
      for (let t = 0; t < nTri; t++) if (sliver[t])
        for (let k = 0; k < 3; k++) if (vface[vert[t*3+k]] >= 0){ faceId[t] = vface[vert[t*3+k]]; break; }
    }
    source = byIndex ? 'index' : 'angle';
  }
  const fStart = new Int32Array(nFace + 1), fTris = new Int32Array(nTri);
  for (let t = 0; t < nTri; t++) fStart[faceId[t] + 1]++;
  for (let f = 0; f < nFace; f++) fStart[f+1] += fStart[f];
  const fill = fStart.slice(0, nFace);
  for (let t = 0; t < nTri; t++) fTris[fill[faceId[t]]++] = t;
  return geo.userData._topo = {nTri, vert, weld, rep, tn, nbr, sliver, faceId, fStart, fTris, source, diag, info:new Map()};
}
function faceTris(topo, f){ return topo.fTris.subarray(topo.fStart[f], topo.fStart[f+1]); }

// The surface of one face in the geometry's own frame: exact from the B-rep data when
// cascadio supplied it and it agrees with the vertices, otherwise fitted to them.
function faceInfo(geo, f){
  const topo = topology(geo);
  let info = topo.info.get(f);
  if (!info){ info = analyzeFace(geo, topo, f); topo.info.set(f, info); }
  return info;
}
function analyzeFace(geo, topo, f){
  const tris = faceTris(topo, f), pos = geo.attributes.position;
  const nrm = geo.index ? geo.attributes.normal : null;     // unindexed meshes only carry flat normals
  // one entry per distinct vertex position: a vertex of this face and the normals around it
  const byW = new Map(), rim = new Set();
  for (let i = 0; i < tris.length; i++){
    const t = tris[i];
    for (let k = 0; k < 3; k++){
      const v = topo.vert[t*3 + k], w = topo.weld[v], u = topo.nbr[t*3 + k];
      let e = byW.get(w);
      if (!e) byW.set(w, e = {v, n:new THREE.Vector3()});
      e.n.x += topo.tn[t*3]; e.n.y += topo.tn[t*3+1]; e.n.z += topo.tn[t*3+2];
      if (!topo.sliver[t] && (u < 0 || topo.faceId[u] !== f)){ rim.add(w); rim.add(topo.weld[topo.vert[t*3 + (k+1)%3]]); }
    }
  }
  const P = [], N = [];
  byW.forEach(e => {
    P.push(new THREE.Vector3().fromBufferAttribute(pos, e.v));
    N.push(nrm ? new THREE.Vector3().fromBufferAttribute(nrm, e.v).normalize() : e.n.normalize());
  });
  const size = new THREE.Box3().setFromPoints(P).getSize(new THREE.Vector3()).length();
  const def = topo.source === 'brep' ? geo.userData.brep.faces[f] : null;
  let surf = def ? surfFromBrep(def) : null;
  if (surf && !onSurface(surf, P, size, topo.diag)) surf = null;    // data that doesn't fit the mesh is ignored
  const exact = !!surf;
  if (!surf) surf = fitSurface(P, N, !!nrm, byW.size > rim.size, size, topo.diag);
  shapeSurface(surf, P, tris, topo, pos);
  return {tris, surf, exact};
}
