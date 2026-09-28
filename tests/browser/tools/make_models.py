"""Rebuild the test models in tests/browser/models.

The committed models are what the tests expect; run this only to change them.
Needs build123d and cascadio (python -m pip install build123d cascadio).

    python tools/make_models.py          # asm, asm2, plate.stl, the sheets
    python tools/make_models.py --big    # also big.step / big_brep.glb for t6 and t7 (~5 MB, not committed)
    python tools/make_models.py --out DIR

Dimensions are in millimetres; the tests check against them.
"""
import argparse
import copy
import math
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))          # the repo root, for stepview
import stepview                                   # noqa: E402

TOL = stepview.QUALITY["normal"]                  # what the viewer converts with by default


def glb(step: Path, out: Path, brep: bool = True):
    import cascadio
    out.unlink(missing_ok=True)
    if brep:
        stepview._step_to_glb(cascadio, step, out, TOL)
    else:
        cascadio.step_to_glb(str(step), str(out), tol_linear=TOL[0], tol_angular=TOL[1])
    print("wrote", out.name)


def plate_body(B):
    """Plate 100 x 60 x 10: Ø10 hole at (-30, 0), Ø16 at (20, 0) with a 1 mm chamfer on top,
    R5 vertical corner fillets."""
    plate = B.Box(100, 60, 10)
    plate = B.fillet(plate.edges().filter_by(B.Axis.Z), radius=5)
    plate -= B.Pos(-30, 0, 0) * B.Cylinder(5, 10)
    plate -= B.Pos(20, 0, 0) * B.Cylinder(8, 10)
    top_rim = [e for e in plate.edges().filter_by(B.GeomType.CIRCLE).filter_by_position(B.Axis.Z, 4.9, 5.1)
               if abs(e.radius - 8) < 1e-6]
    return B.chamfer(top_rim, length=1)


def make_asm(B, out: Path):
    """Plate, a stepped shaft standing over the Ø10 hole and a U-bracket rotated 30°."""
    plate = plate_body(B)
    plate.label = "plate"
    # Stepped shaft: Ø20 x 30 then Ø12 x 25, R2 fillet at the shoulder, Ø12 ball end
    s1 = B.Cylinder(10, 30, align=(B.Align.CENTER, B.Align.CENTER, B.Align.MIN))
    s2 = B.Pos(0, 0, 30) * B.Cylinder(6, 25, align=(B.Align.CENTER, B.Align.CENTER, B.Align.MIN))
    shaft = s1 + s2
    shoulder = [e for e in shaft.edges().filter_by(B.GeomType.CIRCLE).filter_by_position(B.Axis.Z, 29.9, 30.1)
                if abs(e.radius - 6) < 1e-6]
    shaft = B.fillet(shoulder, radius=2)
    shaft += B.Pos(0, 0, 55) * B.Sphere(6)
    shaft.label = "shaft"
    shaft = B.Pos(-30, 0, 5) * shaft
    # U-channel, 20 mm between its inner walls
    bracket = B.Box(40, 30, 30) - B.Pos(0, 0, 5) * B.Box(40, 20, 30)
    bracket.label = "bracket"
    bracket = B.Pos(20, 0, 25) * B.Rot(0, 0, 30) * bracket
    B.export_step(B.Compound(label="asm", children=[plate, shaft, bracket]), str(out))
    print("wrote", out.name)


def make_asm2(B, out: Path):
    """Two copies of one bolt (instanced) and a lofted body with B-spline side faces."""
    bolt = B.Cylinder(3, 20) + B.Pos(0, 0, 10) * B.Cylinder(5, 4, align=(B.Align.CENTER, B.Align.CENTER, B.Align.MIN))
    bolt.label = "bolt"
    b1 = copy.copy(bolt); b1.label = "bolt_a"; b1.move(B.Location((0, 0, 0)))
    b2 = copy.copy(bolt); b2.label = "bolt_b"; b2.move(B.Location((40, 0, 0)))
    loft_body = B.loft([B.Circle(10), B.Pos(0, 0, 20) * B.Rectangle(12, 8), B.Pos(0, 0, 35) * B.Circle(4)])
    loft_body = B.Solid(loft_body.wrapped) if hasattr(loft_body, "wrapped") else loft_body
    lb = B.Pos(0, 40, 0) * loft_body
    lb.label = "loft"
    B.export_step(B.Compound(label="asm2", children=[b1, b2, lb]), str(out))
    print("wrote", out.name)


def make_big(B, out: Path):
    """401 parts: a 420 x 420 plate with 400 Ø8 holes and a Ø7.8 bolt in each (0.1 mm radial clearance)."""
    N = 20
    plate = B.Box(420, 420, 12)
    holes = [B.Pos(-200 + 21*i + 0.5, -200 + 21*j + 0.5, 0) * B.Cylinder(4, 12) for i in range(N) for j in range(N)]
    plate = plate - B.Compound(children=holes)
    plate.label = "bigplate"
    bolt = B.Cylinder(3.9, 30) + B.Pos(0, 0, 15) * B.Cylinder(6.5, 5, align=(B.Align.CENTER, B.Align.CENTER, B.Align.MIN))
    bolt = B.fillet(bolt.edges().filter_by(B.GeomType.CIRCLE).filter_by_position(B.Axis.Z, 19.9, 20.1), radius=1.0)
    parts = [plate]
    for i in range(N):
        for j in range(N):
            b = copy.copy(bolt); b.label = f"bolt_{i}_{j}"
            b.move(B.Location((-200 + 21*i + 0.5, -200 + 21*j + 0.5, -9)))
            parts.append(b)
    B.export_step(B.Compound(label="big", children=parts), str(out))
    print("wrote", out.name)


def write_stl(path: Path, tris):
    """Binary STL, millimetres."""
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(tris)))
        for a, b, c in tris:
            f.write(struct.pack("<3f", 0, 0, 1))
            for v in (a, b, c):
                f.write(struct.pack("<3f", *v))
            f.write(b"\0\0")
    print("wrote", path.name)


def make_sheets(out: Path):
    """Open sheets: a 40 x 20 mm rectangle meshed 4 x 2, the same as two bare triangles,
    and an R10 disc with 32 rim segments."""
    def grid(nx, ny, w=40.0, h=20.0):
        P = lambda i, j: (i * w / nx, j * h / ny, 0.0)
        t = []
        for i in range(nx):
            for j in range(ny):
                t += [(P(i, j), P(i+1, j), P(i+1, j+1)), (P(i, j), P(i+1, j+1), P(i, j+1))]
        return t
    write_stl(out / "sheet_rect.stl", grid(4, 2))
    write_stl(out / "sheet_bare.stl", grid(1, 1))
    n, r, c = 32, 10.0, (0.0, 0.0, 0.0)
    rim = [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), 0.0) for k in range(n)]
    write_stl(out / "sheet_disc.stl", [(c, rim[k], rim[(k + 1) % n]) for k in range(n)])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--big", action="store_true", help="also build the 401-part model for t6 / t7")
    ap.add_argument("--out", default=str(HERE.parent / "models"), help="output folder (default: models)")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    import build123d as B

    make_asm(B, out / "asm.step")
    glb(out / "asm.step", out / "asm_brep.glb")
    glb(out / "asm.step", out / "asm_plain.glb", brep=False)
    make_asm2(B, out / "asm2.step")
    glb(out / "asm2.step", out / "asm2_brep.glb")
    B.export_stl(plate_body(B), str(out / "plate.stl"), tolerance=0.01, angular_tolerance=0.2)
    print("wrote plate.stl")
    make_sheets(out)
    if a.big:
        make_big(B, out / "big.step")
        glb(out / "big.step", out / "big_brep.glb")


if __name__ == "__main__":
    main()
