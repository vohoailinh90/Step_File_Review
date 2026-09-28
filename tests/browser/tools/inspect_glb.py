import json, struct, sys
import numpy as np
path = sys.argv[1]
b = open(path, 'rb').read()
magic, ver, length = struct.unpack_from('<4sII', b, 0)
jlen, jtype = struct.unpack_from('<I4s', b, 12)
js = json.loads(b[20:20+jlen])
bin_off = 20 + jlen
blen, btype = struct.unpack_from('<I4s', b, bin_off)
binchunk = b[bin_off+8: bin_off+8+blen]
print('extensionsUsed', js.get('extensionsUsed'), 'required', js.get('extensionsRequired'))
print('asset', js.get('asset'))
print('nodes', len(js['nodes']), 'meshes', len(js['meshes']))
for i, n in enumerate(js['nodes']):
    print(' node', i, {k: v for k, v in n.items() if k != 'extras'})
CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC3': 3, 'VEC2': 2}
def acc(i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    arr = np.frombuffer(binchunk, dtype=CT[a['componentType']], count=n, offset=off)
    return arr.reshape(a['count'], NC[a['type']]) if NC[a['type']] > 1 else arr
for mi, m in enumerate(js['meshes']):
    for pi, p in enumerate(m['primitives']):
        ext = p.get('extensions', {})
        print('mesh', mi, m.get('name'), 'prim', pi, 'attrs', p['attributes'], 'mode', p.get('mode'), 'ext', list(ext))
        pos = acc(p['attributes']['POSITION'])
        idx = acc(p['indices']).reshape(-1, 3)
        print('   verts', len(pos), 'tris', len(idx), 'bbox', pos.min(0), pos.max(0))
        if 'TM_brep_faces' in ext:
            e = ext['TM_brep_faces']
            fi = acc(e['faceIndices'])
            print('   faceIndices accessor', js['accessors'][e['faceIndices']]['componentType'], 'count', len(fi), 'unique', len(np.unique(fi)), 'nfaces', len(e.get('faces', [])))
            # index-connectivity check: are vertices shared across faces?
            vface = {}
            shared = 0
            for t, f in zip(idx, fi):
                for v in t:
                    if v in vface and vface[v] != f: shared += 1
                    vface.setdefault(v, f)
            print('   vertex indices shared between different faces:', shared)
            for f in e.get('faces', [])[:40]:
                print('     ', json.dumps(f) if f is None else {k: (np.round(v, 6).tolist() if isinstance(v, list) else v) for k, v in f.items()})
