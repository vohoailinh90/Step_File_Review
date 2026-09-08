"""Write a minimal but valid STEP file holding one 10 mm cube.

Used by the Windows build workflow to prove the packaged executable really
converts STEP geometry, rather than only starting up:

    python tests/make_cube_step.py cube.step
"""
import sys

L = []
def e(text):
    L.append(text)
    return len(L)          # entity id == index

def pt(x, y, z):
    return e(f"CARTESIAN_POINT('',({x:.6f},{y:.6f},{z:.6f}))")

def d(x, y, z):
    return e(f"DIRECTION('',({x:.6f},{y:.6f},{z:.6f}))")

S = 10.0
corners = {}
for i, (x, y, z) in enumerate([(0,0,0),(S,0,0),(S,S,0),(0,S,0),(0,0,S),(S,0,S),(S,S,S),(0,S,S)]):
    corners[i] = pt(x, y, z)
verts = {i: e(f"VERTEX_POINT('',#{p})") for i, p in corners.items()}
coord = [(0,0,0),(S,0,0),(S,S,0),(0,S,0),(0,0,S),(S,0,S),(S,S,S),(0,S,S)]

edges = {}
def edge(a, b):
    key = (a, b)
    if key in edges:
        return edges[key], True
    if (b, a) in edges:
        return edges[(b, a)], False
    pa, pb = coord[a], coord[b]
    vec = [pb[i] - pa[i] for i in range(3)]
    length = sum(v * v for v in vec) ** 0.5
    dr = d(*[v / length for v in vec])
    v = e(f"VECTOR('',#{dr},{length:.6f})")
    p0 = pt(*pa)
    line = e(f"LINE('',#{p0},#{v})")
    ec = e(f"EDGE_CURVE('',#{verts[a]},#{verts[b]},#{line},.T.)")
    edges[key] = ec
    return ec, True

def face(loop_pts, origin, normal, xdir):
    oriented = []
    for i in range(len(loop_pts)):
        a, b = loop_pts[i], loop_pts[(i + 1) % len(loop_pts)]
        ec, same = edge(a, b)
        oriented.append(e(f"ORIENTED_EDGE('',*,*,#{ec},{'.T.' if same else '.F.'})"))
    loop = e("EDGE_LOOP('',(%s))" % ",".join(f"#{o}" for o in oriented))
    bound = e(f"FACE_OUTER_BOUND('',#{loop},.T.)")
    o = pt(*origin)
    n = d(*normal)
    x = d(*xdir)
    ax = e(f"AXIS2_PLACEMENT_3D('',#{o},#{n},#{x})")
    pl = e(f"PLANE('',#{ax})")
    return e(f"ADVANCED_FACE('',(#{bound}),#{pl},.T.)")

faces = [
    face([0,3,2,1], (0,0,0), (0,0,-1), (1,0,0)),      # bottom
    face([4,5,6,7], (0,0,S), (0,0,1),  (1,0,0)),      # top
    face([0,1,5,4], (0,0,0), (0,-1,0), (1,0,0)),      # front
    face([1,2,6,5], (S,0,0), (1,0,0),  (0,1,0)),      # right
    face([2,3,7,6], (0,S,0), (0,1,0),  (-1,0,0)),     # back
    face([3,0,4,7], (0,0,0), (-1,0,0), (0,-1,0)),     # left
]
shell = e("CLOSED_SHELL('',(%s))" % ",".join(f"#{f}" for f in faces))
brep = e(f"MANIFOLD_SOLID_BREP('Cube',#{shell})")

o = pt(0, 0, 0); z = d(0, 0, 1); x = d(1, 0, 0)
axis = e(f"AXIS2_PLACEMENT_3D('',#{o},#{z},#{x})")
mm = e("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )")
rad = e("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )")
sr = e("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )")
unc = e(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#{mm},'distance_accuracy_value','')")
ctx = e(f"( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{unc}))"
        f" GLOBAL_UNIT_ASSIGNED_CONTEXT((#{mm},#{rad},#{sr})) REPRESENTATION_CONTEXT('','') )")
absr = e(f"ADVANCED_BREP_SHAPE_REPRESENTATION('',(#{axis},#{brep}),#{ctx})")

appctx = e("APPLICATION_CONTEXT('automotive design')")
e(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{appctx})")
prodctx = e(f"PRODUCT_CONTEXT('',#{appctx},'mechanical')")
pdctx = e(f"PRODUCT_DEFINITION_CONTEXT('part definition',#{appctx},'design')")
prod = e(f"PRODUCT('Cube','Cube','',(#{prodctx}))")
e(f"PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#{prod}))")
pdf = e(f"PRODUCT_DEFINITION_FORMATION('','',#{prod})")
pd = e(f"PRODUCT_DEFINITION('design','',#{pdf},#{pdctx})")
pds = e(f"PRODUCT_DEFINITION_SHAPE('','',#{pd})")
e(f"SHAPE_DEFINITION_REPRESENTATION(#{pds},#{absr})")

body = "\n".join(f"#{i+1} = {t};" for i, t in enumerate(L))
out = f"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('QuickSTEP build test'),'2;1');
FILE_NAME('cube.step','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN {{ 1 0 10303 214 1 1 1 1 }}'));
ENDSEC;
DATA;
{body}
ENDSEC;
END-ISO-10303-21;
"""
target = sys.argv[1] if len(sys.argv) > 1 else "cube.step"
open(target, "w").write(out)
print(f"wrote {target}  ({len(out)} bytes)")
