const {launch, openModel} = require('./lib.js');
(async () => {
  const browser = await launch();
  const t0 = Date.now();
  const {pg, errors} = await openModel(browser, 'big_brep.glb', 'big.step');
  console.log('load (incl. page) ms', Date.now() - t0);
  const r = await pg.evaluate(() => {
    const T = f => { const t = performance.now(); const v = f(); return [performance.now() - t, v]; };
    const plate = __qs.parts.find(p => p.name === 'bigplate'), geo = plate.mesh.geometry;
    const out = {parts: __qs.parts.length, plateTris: geo.index.count / 3, totalTris: __qs.parts.reduce((s, p) => s + p.tris, 0)};
    const [tTopo, topo] = T(() => __qs.topology(geo));
    out.topoMs = tTopo; out.faces = topo.fStart.length - 1; out.source = topo.source;
    // biggest two planar faces (top / bottom)
    const sizes = []; for (let f = 0; f < topo.fStart.length - 1; f++) sizes.push([topo.fStart[f+1] - topo.fStart[f], f]);
    sizes.sort((a, b) => b[0] - a[0]);
    const [tA, A] = T(() => __qs.faceEntity(plate, sizes[0][1], null));
    const [tB, B] = T(() => __qs.faceEntity(plate, sizes[1][1], null));
    out.faceMs = [tA, tB]; out.faceTris = [A.count, B.count]; out.types = [A.geom.type, B.geom.type];
    const [tMd, md] = T(() => __qs.minDistance(A, B));
    out.minDistMs = tMd; out.minDist = md.d * 1000;
    const [tRel, rel] = T(() => __qs.relate(A, B, md));
    out.relate = rel.rows.map(r => r.join(' ')).join(' | ');
    // a hole cylinder vs a far hole cylinder
    const cyl = []; for (let f = 0; f < topo.fStart.length - 1 && cyl.length < 400; f++){ const i = __qs.faceInfo(geo, f); if (i.surf.type === 'cylinder') cyl.push(f); }
    const C1 = __qs.faceEntity(plate, cyl[0], null), C2 = __qs.faceEntity(plate, cyl[cyl.length - 1], null);
    const [tMd2, md2] = T(() => __qs.minDistance(C1, C2));
    out.holes = cyl.length; out.holeRel = __qs.relate(C1, C2, md2).rows.slice(0, 3).map(r => r.join(' ')).join(' | '); out.holeMdMs = tMd2;
    // explode all 401 parts
    const [tEx] = T(() => __qs.setExplode(0.5)); const [tEx2] = T(() => __qs.setExplode(1)); __qs.setExplode(0);
    out.explodeMs = [tEx, tEx2];
    // topology for every bolt (shared by instances? each is its own geometry here)
    const [tAll] = T(() => __qs.parts.forEach(p => __qs.topology(p.mesh.geometry)));
    out.allTopoMs = tAll;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('errors', errors.filter(e => !/Failed to load resource/.test(e)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
