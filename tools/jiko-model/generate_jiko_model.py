#!/usr/bin/env python3
"""Generate the current Jiko One website model as printable CAD/STL/GLB.

The current Three.js implementation is the primary source. Dimensions are in
millimetres; X is left/right, Y is bottom/top, and Z is back/front.
"""

from __future__ import annotations

import json
import math
import shutil
import gc
import hashlib
import os
import sys
from pathlib import Path

import cadquery as cq


ROOT = Path(__file__).resolve().parents[2]
RELIEF_PRINT = "--relief-print" in sys.argv
OUT = ROOT / "models" / ("jiko-one-hero-relief" if RELIEF_PRINT else "jiko-one-hero")
OUT.mkdir(parents=True, exist_ok=True)

SCALE = 44.0
BODY_W = 1.82 * SCALE
BODY_H = 2.73 * SCALE
BODY_D = 0.15 * SCALE
BODY_RADIUS = 0.15 * SCALE
BODY_EXP_X = 4.2
BODY_EXP_Y = 3.8
GLASS_EXP = 3.5
DETAIL_RADIUS = 0.014 * SCALE
DETAIL_EXP = 3.2
SHOWCASE_SOURCE = ROOT / "apps" / "web" / "src" / "ui" / "ShowcaseStage.tsx"
THERMAL_PATHS_SHA1 = "bd836fdb25fc99c414809de5b0f25241ff3e11c8"
REAR_GROOVE_WIDTH = 0.35
REAR_GROOVE_DEPTH = 0.32
SCREEN_GLASS_DEPTH = 0.50 if RELIEF_PRINT else 0.28
SCREEN_GLASS_OVERLAP = 0.08 if RELIEF_PRINT else 0.04
SCREEN_Z = BODY_D / 2 - SCREEN_GLASS_OVERLAP + SCREEN_GLASS_DEPTH / 2
SCREEN_TOP_Z = SCREEN_Z + SCREEN_GLASS_DEPTH / 2
RELIEF_OVERLAP = 0.08 if RELIEF_PRINT else 0.0
RELIEF_Z = SCREEN_TOP_Z - RELIEF_OVERLAP
TEXT_RELIEF = 0.65 if RELIEF_PRINT else 0.28
STATUS_RELIEF = 0.75 if RELIEF_PRINT else 0.32
BATTERY_RELIEF = 0.60 if RELIEF_PRINT else 0.25
BATTERY_CELL_RELIEF = 0.70 if RELIEF_PRINT else 0.28
WINDOW_DEPTH = 0.40 if RELIEF_PRINT else 0.18
LIT_SPRITE_RELIEF = 0.80 if RELIEF_PRINT else 0.42
DIM_SPRITE_RELIEF = 0.40 if RELIEF_PRINT else 0.16
WEEKDAY_PRINT_DOT_DIAMETER = 0.70 if RELIEF_PRINT else 0.0
DATE_PRINT_DOT_DIAMETER = 0.64 if RELIEF_PRINT else 0.0

GLYPHS = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ":": ["00", "11", "11", "00", "11", "11", "00"],
    " ": ["00", "00", "00", "00", "00", "00", "00"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
}

SPRITES = {
    "king": ["...111...", "..11111..", "...1.1...", ".1111111.", "1.11111.1", "..11111..", "...111...", "..1.1.1..", ".1.....1."],
    "tree": ["....1....", "...111...", "..11111..", ".1111111.", "...111...", "..11111..", "....1....", "....1....", "...111..."],
    "oracle": ["....1....", "..11111..", ".11...11.", "11.222.11", "1112.2111", "11.222.11", ".11...11.", "..11111..", "....1...."],
}


def superellipse_points(width: float, height: float, radius: float, ex: float, ey: float, steps: int = 28):
    r = min(radius, width / 2, height / 2)
    points = [(r - width / 2, -height / 2), (width / 2 - r, -height / 2)]

    def arc(cx: float, cy: float, start: float, end: float, skip_last: bool = False):
        for index in range(1, steps if skip_last else steps + 1):
            angle = start + (index / steps) * (end - start)
            c, s = math.cos(angle), math.sin(angle)
            points.append((cx + r * math.copysign(abs(c) ** (2 / ex), c), cy + r * math.copysign(abs(s) ** (2 / ey), s)))

    arc(width / 2 - r, -height / 2 + r, -math.pi / 2, 0)
    points.append((width / 2, height / 2 - r))
    arc(width / 2 - r, height / 2 - r, 0, math.pi / 2)
    points.append((r - width / 2, height / 2))
    arc(r - width / 2, height / 2 - r, math.pi / 2, math.pi)
    points.append((-width / 2, -height / 2 + r))
    arc(r - width / 2, -height / 2 + r, math.pi, math.pi * 1.5, True)
    return points


def polygon_prism(points, depth: float, z: float = 0):
    wire = cq.Workplane("XY").polyline(points).close().val()
    face = cq.Face.makeFromWires(wire)
    solid = cq.Solid.extrudeLinear(face, cq.Vector(0, 0, depth))
    return cq.Workplane(obj=solid).translate((0, 0, z - depth / 2))


def profile_prism(points, depth: float, plane: str = "XY"):
    """Extrude one explicit closed profile on the requested coordinate plane."""
    return cq.Workplane(plane).polyline(points).close().extrude(depth)


def squircle_prism(width: float, height: float, radius: float, depth: float, plane: str, ex: float, ey: float):
    return profile_prism(superellipse_points(width, height, radius, ex, ey, 24), depth, plane)


def box(x: float, y: float, z: float, dx: float, dy: float, dz: float):
    return cq.Workplane("XY").box(dx, dy, dz).translate((x, y, z))


def cylinder(radius: float, height: float, start, direction):
    return cq.Workplane(obj=cq.Solid.makeCylinder(radius, height, cq.Vector(*start), cq.Vector(*direction)))


def cone(r1: float, r2: float, height: float, start, direction):
    return cq.Workplane(obj=cq.Solid.makeCone(r1, r2, height, cq.Vector(*start), cq.Vector(*direction)))


def capsule_prism(width: float, height: float, depth: float, plane: str = "XY", offset=(0, 0, 0)):
    radius = min(width, height) / 2
    if width >= height:
        profile = cq.Workplane(plane).center(offset[0], offset[1]).rect(width - height, height).extrude(depth)
        left = cq.Workplane(plane).center(offset[0] - width / 2 + radius, offset[1]).circle(radius).extrude(depth)
        right = cq.Workplane(plane).center(offset[0] + width / 2 - radius, offset[1]).circle(radius).extrude(depth)
        solid = profile.union(left).union(right)
    else:
        profile = cq.Workplane(plane).center(offset[0], offset[1]).rect(width, height - width).extrude(depth)
        bottom = cq.Workplane(plane).center(offset[0], offset[1] - height / 2 + radius).circle(radius).extrude(depth)
        top = cq.Workplane(plane).center(offset[0], offset[1] + height / 2 - radius).circle(radius).extrude(depth)
        solid = profile.union(bottom).union(top)
    return solid.translate((0, 0, offset[2]))


def make_thermal_vent_cut():
    """Use the exact six inline Three.js THERMAL_* paths as the cutter."""
    import re
    from svg.path import parse_path

    source = SHOWCASE_SOURCE.read_text()
    shou = re.search(r'const THERMAL_SHOU\s*=\s*"([^"]+)";', source, re.S)
    wan = re.search(r'const THERMAL_WAN\s*=\s*"([^"]+)";', source, re.S)
    huo = re.search(r'const THERMAL_HUO:[^=]+=\s*\[(.*?)\];', source, re.S)
    if not shou or not wan or not huo:
        raise ValueError("ShowcaseStage.tsx thermal path declarations were not found")
    paths = [shou.group(1), wan.group(1), *re.findall(r'"([^"]+)"', huo.group(1))]
    paths_hash = hashlib.sha1("\n".join(paths).encode()).hexdigest()
    if len(paths) != 6 or paths_hash != THERMAL_PATHS_SHA1:
        raise ValueError(f"Unexpected Three.js thermal path revision: {paths_hash}")

    # Reproduce ctx.setTransform(CS/14820, 0, 0, -(CS/15320), 0, CS), then
    # map that canvas onto the physical left-face PlaneGeometry.
    target_y = 8.29
    target_z = 5.35
    scale_y = target_y / 15320.0
    scale_z = target_z / 14820.0
    thermal_cut = None
    for path_data in paths:
        runtime_path = parse_path(path_data)
        samples = max(48, len(runtime_path) * 3)
        points = []
        for index in range(samples):
            point = runtime_path.point(index / samples)
            # Keep the prior vertical 180-degree orientation, then flip the
            # complete asset left-to-right around its Y-Z center.
            local_y = (15320.0 - point.imag - 7660.0) * scale_y
            local_z = (point.real - 7410.0) * scale_z
            points.append((-local_y, local_z))
        solid = cq.Workplane("YZ").polyline(points).close().extrude(4.0)
        thermal_cut = solid if thermal_cut is None else thermal_cut.union(solid)
    assert thermal_cut is not None
    return thermal_cut.translate((-BODY_W / 2 - 2.0, -BODY_H * 0.26, 0))


def make_body():
    body = polygon_prism(superellipse_points(BODY_W, BODY_H, BODY_RADIUS, BODY_EXP_X, BODY_EXP_Y, 36), BODY_D)

    # Real Type-C opening with a shallow outer recess and a smaller through mouth.
    # XZ extrusion runs toward -Y, so these translations place both cuts from
    # the bottom surface inward (+Y): 0.80 mm recess and 3.0 mm mouth depth.
    recess_cut = squircle_prism(13.64, 4.75, DETAIL_RADIUS * 1.6, 0.80, "XZ", DETAIL_EXP, DETAIL_EXP).translate((0, -BODY_H / 2 + 0.80, 0))
    mouth_cut = capsule_prism(8.34, 2.56, 3.0, "XZ", (0, 0, 0)).translate((0, -BODY_H / 2 + 3.0, 0))
    body = body.cut(mouth_cut).cut(recess_cut)
    body = body.cut(make_thermal_vent_cut())

    mic_x = -(BODY_W / 2 - 2 * BODY_RADIUS)
    body = body.cut(cylinder(0.70, 9.0, (mic_x, BODY_H / 2 + 1.0, 0), (0, -1, 0)))
    body = body.cut(cone(1.06, 0.70, 0.72, (mic_x, BODY_H / 2 + 0.35, 0), (0, -1, 0)))

    # Rear service panel remains coplanar with the outer rear face. Only this
    # narrow rounded-rectangle ring is cut inward as a groove.
    panel_points = superellipse_points(BODY_W * 0.88, BODY_H * 0.88, BODY_RADIUS * 0.62, BODY_EXP_X, BODY_EXP_Y, 28)
    cutter_epsilon = 0.02
    cutter_depth = REAR_GROOVE_DEPTH + cutter_epsilon
    cutter_z = -BODY_D / 2 + REAR_GROOVE_DEPTH / 2 - cutter_epsilon / 2
    outer = polygon_prism(panel_points, cutter_depth, cutter_z)
    inner_points = superellipse_points(
        BODY_W * 0.88 - REAR_GROOVE_WIDTH * 2,
        BODY_H * 0.88 - REAR_GROOVE_WIDTH * 2,
        BODY_RADIUS * 0.62 - REAR_GROOVE_WIDTH,
        BODY_EXP_X,
        BODY_EXP_Y,
        28,
    )
    inner = polygon_prism(inner_points, cutter_depth + 0.04, cutter_z)
    groove = outer.cut(inner)
    body = body.cut(groove)
    return body


def make_screen_glass():
    width = BODY_W * 0.99
    height = width / (2 / 3)
    return polygon_prism(superellipse_points(width, height, BODY_RADIUS * 0.92, GLASS_EXP, GLASS_EXP, 30), SCREEN_GLASS_DEPTH, SCREEN_Z)


def led_disc(x: float, y: float, radius: float, height: float, z: float):
    return cylinder(radius, height, (x, y, z), (0, 0, 1))


def screen_xy(canvas_x: float, canvas_y: float):
    """Map current 320×480 screen texture coordinates onto the physical glass."""
    return ((canvas_x / 320.0 - 0.5) * BODY_W * 0.99, (0.5 - canvas_y / 480.0) * (BODY_W * 0.99 / (2 / 3)))


def dot_text_parts(
    text: str,
    x: float,
    y: float,
    dot: float,
    gap: float,
    tracking: float,
    prefix: str,
    minimum_print_diameter: float = 0.0,
):
    parts = {}
    cursor = x
    for char_index, char in enumerate(text):
        glyph = GLYPHS.get(char, GLYPHS[" "])
        width = len(glyph[0])
        for row, line in enumerate(glyph):
            for column, value in enumerate(line):
                if value != "1":
                    continue
                px = cursor + column * (dot + gap)
                py = y - row * (dot + gap)
                radius = max(dot * 0.42, minimum_print_diameter / 2)
                parts[f"{prefix}_{char_index:02d}_{row}_{column}"] = led_disc(px, py, radius, TEXT_RELIEF, RELIEF_Z)
        cursor += width * dot + max(0, width - 1) * gap + tracking
    return parts


def make_top_strip():
    parts = {}
    for index, y in enumerate((49.0, 46.4, 43.8), start=1):
        parts[f"status_dot_{index}"] = led_disc(-30.8, y, 0.55, STATUS_RELIEF, RELIEF_Z)
    parts.update(dot_text_parts("11:33", -24.0, 50.5, 1.0, 0.20, 1.0, "clock"))
    parts.update(dot_text_parts("TUE", 22.0, 51.0, 0.45, 0.05, 0.55, "weekday", WEEKDAY_PRINT_DOT_DIAMETER))
    parts.update(dot_text_parts("JUL 21", 18.4, 45.1, 0.40, 0.04, 0.42, "date", DATE_PRINT_DOT_DIAMETER))
    # Battery outline and three physical charge cells.
    z = RELIEF_Z + BATTERY_RELIEF / 2
    parts["battery_top"] = box(28.2, 40.9, z, 4.6, 0.34, BATTERY_RELIEF)
    parts["battery_bottom"] = box(28.2, 38.3, z, 4.6, 0.34, BATTERY_RELIEF)
    parts["battery_left"] = box(25.9, 39.6, z, 0.34, 2.9, BATTERY_RELIEF)
    parts["battery_right"] = box(30.5, 39.6, z, 0.34, 2.9, BATTERY_RELIEF)
    parts["battery_terminal"] = box(31.0, 39.6, z, 0.55, 1.0, BATTERY_RELIEF)
    for index, x in enumerate((27.0, 28.2, 29.4), start=1):
        cell_z = RELIEF_Z + BATTERY_CELL_RELIEF / 2
        parts[f"battery_cell_{index}"] = box(x, 39.6, cell_z, 0.7, 1.3, BATTERY_CELL_RELIEF)
    return parts


def make_sprite_windows():
    parts = {}
    window_canvas_y = (113, 231, 349)
    tones = ("amber", "red", "green")
    window_size = BODY_W * 0.99 * (108 / 320)
    for name, canvas_y, tone in zip(("king", "tree", "oracle"), window_canvas_y, tones):
        cx, cy = screen_xy(160, canvas_y + 54)
        frame_z = SCREEN_TOP_Z - RELIEF_OVERLAP + WINDOW_DEPTH / 2
        frame = polygon_prism(superellipse_points(window_size, window_size, 0.75, 3.2, 3.2, 10), WINDOW_DEPTH, frame_z)
        parts[f"{tone}_{name}_window"] = frame
        frame.objects = [obj.translate((0, cy, 0)) for obj in frame.objects]
        rows = SPRITES[name]
        step = BODY_W * 0.99 * (10 / 320)
        radius = BODY_W * 0.99 * (4 / 320) * 0.88
        start = -step * 4
        for row, line in enumerate(rows):
            for column, value in enumerate(line):
                x = start + column * step
                y = cy + step * 4 - row * step
                dot_radius = radius if value != "." else radius * 0.74
                height = LIT_SPRITE_RELIEF if value != "." else DIM_SPRITE_RELIEF
                parts[f"{tone}_{name}_{row}_{column}_{'lit' if value != '.' else 'dim'}"] = led_disc(x, y, dot_radius, height, RELIEF_Z)
    return parts


def make_usb_parts():
    """Physical depth stack matching the colored layers in buildUsbCPort()."""
    bottom = -BODY_H / 2

    # Matte recess floor around the connector, 0.55 mm below the bottom face.
    recess_outer = squircle_prism(13.64, 4.75, DETAIL_RADIUS * 1.6, 0.16, "XZ", DETAIL_EXP, DETAIL_EXP).translate((0, bottom + 0.72, 0))
    recess_hole = squircle_prism(10.12, 3.43, DETAIL_RADIUS * 1.2, 0.30, "XZ", DETAIL_EXP, DETAIL_EXP).translate((0, bottom + 0.79, 0))
    recess_layer = recess_outer.cut(recess_hole)

    # Metallic shield is a real ring, not a filled block over the opening.
    shield_outer = squircle_prism(10.12, 3.43, DETAIL_RADIUS * 1.2, 0.22, "XZ", DETAIL_EXP, DETAIL_EXP).translate((0, bottom + 1.00, 0))
    shield_hole = capsule_prism(8.34, 2.56, 0.40, "XZ").translate((0, bottom + 1.09, 0))
    shield = shield_outer.cut(shield_hole)

    # Dark back wall sits 2.8 mm inside the mouth. The tongue grows from it
    # toward the opening, so it is supported rather than floating.
    back_wall = capsule_prism(8.34, 2.56, 0.18, "XZ").translate((0, bottom + 2.98, 0))
    tongue = capsule_prism(5.28, 0.66, 2.0, "XZ").translate((0, bottom + 2.90, -0.38))
    return {
        "usb_c_recess_layer": recess_layer,
        "usb_c_metal_shield": shield,
        "usb_c_inner_back_wall": back_wall,
        "usb_c_tongue": tongue,
    }


def make_screws():
    parts = {}
    positions = [(-BODY_W * 0.39, BODY_H * 0.395), (BODY_W * 0.39, -BODY_H * 0.395)]
    for index, (x, y) in enumerate(positions, start=1):
        head = cylinder(1.14, 0.46, (x, y, -BODY_D / 2 + 0.08), (0, 0, -1))
        # A single horizontal minus recess, matching the Three.js PlaneGeometry.
        slot = box(x, y, -BODY_D / 2 - 0.24, 1.55, 0.34, 0.36)
        parts[f"rear_screw_{index}"] = head.cut(slot)
        parts[f"rear_screw_minus_{index}"] = box(x, y, -BODY_D / 2 - 0.405, 1.45, 0.26, 0.05)
    return parts


def make_side_button():
    y = 0.18 * SCALE
    # Preserve the Three.js long rounded rectangle: 5.28 mm wide, 55.26 mm
    # high, 7.04 mm deep, with a real 1.98 mm corner radius.
    button = cq.Workplane("YZ").center(y, BODY_D * 0.10).rect(BODY_H * 0.46, 5.28).extrude(7.04)
    # Translate the complete button left until it directly overlaps the body
    # by 0.10 mm. No connector line or intermediate mounting neck is generated.
    button = button.edges("|X").fillet(1.98).translate((BODY_W / 2 - 0.10, 0, 0))
    return {"side_button": button}


def clean_output():
    for path in OUT.iterdir():
        if path.name not in {"README.md", "STRUCTURE-CHECK.md"}:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()


def export_parts(parts):
    invalid = [name for name, shape in parts.items() if not shape.val().isValid()]
    if invalid:
        raise ValueError(f"Refusing to export invalid CAD solids: {invalid}")
    for name, shape in parts.items():
        cq.exporters.export(shape, str(OUT / f"{name}.stl"), cq.exporters.ExportTypes.STL, tolerance=0.03, angularTolerance=0.15)
    # The translated side button directly overlaps and fuses into the body.
    structural = parts["body_shell"].union(parts["side_button"])
    print_parts = {
        "structural_chassis": structural,
        **{name: shape for name, shape in parts.items() if name not in {"body_shell", "side_button"}},
    }
    cq.exporters.export(structural, str(OUT / "jiko-one-structural-chassis.stl"), cq.exporters.ExportTypes.STL, tolerance=0.03, angularTolerance=0.15)
    compound = cq.Compound.makeCompound([shape.val() for shape in print_parts.values()])
    assembly = cq.Workplane(obj=compound)
    cq.exporters.export(assembly, str(OUT / "jiko-one-print-assembly.step"))
    cq.exporters.export(assembly, str(OUT / "jiko-one-hero.stl"), cq.exporters.ExportTypes.STL, tolerance=0.03, angularTolerance=0.15)

    # The visual rear screw heads and their minus-slot inserts project 0.43 mm
    # beyond the rear shell. If the hero STL is placed rear-side-down, a slicer
    # therefore rests it on those tiny features and leaves the broad shell
    # first layer suspended. Export a separate, flat-back print file that keeps
    # the complete chassis and front detail but omits only those rear-only
    # visual parts, giving the rear shell one continuous bed-contact plane.
    back_flat_parts = [
        structural,
        *[
            shape
            for name, shape in parts.items()
            if name not in {"body_shell", "side_button"}
            and not name.startswith("rear_screw")
        ],
    ]
    back_flat = cq.Workplane(obj=cq.Compound.makeCompound([shape.val() for shape in back_flat_parts]))
    cq.exporters.export(back_flat, str(OUT / "jiko-one-hero-back-flat.stl"), cq.exporters.ExportTypes.STL, tolerance=0.03, angularTolerance=0.15)
    # The fused print STEP is the canonical CAD assembly. GLB preserves the
    # original visual part layering, so a duplicate visual STEP is unnecessary.
    shutil.copyfile(OUT / "jiko-one-print-assembly.step", OUT / "jiko-one-assembly.step")
    shutil.copyfile(OUT / "jiko-one-hero.stl", OUT / "jiko-one-assembly.stl")
    print(f"Validated {len(parts)} CAD solids before export")


def color_for(name: str):
    if name == "body_shell" or "window" in name or "dim" in name:
        return (4, 4, 5, 255)
    if name.startswith("amber") or name.startswith("status") or name.startswith("date") or name.startswith("weekday") or name.startswith("battery"):
        return (240, 144, 53, 255)
    if name.startswith("red"):
        return (224, 82, 58, 255)
    if name.startswith("green"):
        return (121, 191, 114, 255)
    if name.startswith("clock"):
        return (246, 234, 208, 255)
    if name.startswith("usb_c_metal") or name.startswith("rear_screw"):
        return (184, 188, 196, 255)
    if name.startswith("usb_c_recess") or name.startswith("usb_c_inner"):
        return (5, 7, 9, 255)
    return (20, 22, 25, 255)


def export_glb(part_names):
    import trimesh

    scene = trimesh.Scene()
    for name in part_names:
        mesh = trimesh.load_mesh(OUT / f"{name}.stl", file_type="stl")
        mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=color_for(name))
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    scene.export(OUT / "jiko-one-assembly.glb", file_type="glb")


def main():
    clean_output()
    parts = {"body_shell": make_body(), "screen_glass": make_screen_glass()}
    parts.update(make_top_strip())
    parts.update(make_sprite_windows())
    parts.update(make_usb_parts())
    parts.update(make_screws())
    parts.update(make_side_button())
    part_names = sorted(parts)
    export_parts(parts)

    metadata = {
        "model": "Jiko One enhanced-relief print" if RELIEF_PRINT else "Jiko One current website hero print",
        "print_profile": "enhanced-screen-relief" if RELIEF_PRINT else "standard",
        "units": "mm",
        "primary_reference": "apps/web/src/ui/ShowcaseStage.tsx and showcaseScreenTexture.ts",
        "overall_body_mm": [round(BODY_W, 2), round(BODY_H, 2), round(BODY_D, 2)],
        "features": {
            "left_edge": "six inline THERMAL_* paths extracted from ShowcaseStage.tsx, transformed like the runtime canvas, vertically rotated 180 degrees and then flipped left-to-right as one asset before boolean cutting",
            "rear": "center panel remains coplanar; only a 0.35 mm-wide rounded-rectangle ring is cut inward 0.32 mm",
            "button": "existing 7.04 x 55.26 x 5.28 mm rail translated 2.586 mm left to overlap and fuse directly into the body",
            "usb_c": "0.80 mm inset recess, metal shield ring, 2.8 mm-deep back wall and a supported tongue",
            "screen": "three status dots, 11:33, TUE, JUL 21, battery and three complete 9x9 raised sprites",
        },
        "physical_relief_mm": {
            "screen_glass": SCREEN_GLASS_DEPTH,
            "screen_glass_body_overlap": SCREEN_GLASS_OVERLAP,
            "screen_relief_overlap": RELIEF_OVERLAP,
            "top_text": TEXT_RELIEF,
            "weekday_dot_diameter": WEEKDAY_PRINT_DOT_DIAMETER or 0.378,
            "date_dot_diameter": DATE_PRINT_DOT_DIAMETER or 0.336,
            "status_dot": STATUS_RELIEF,
            "battery": BATTERY_RELIEF,
            "battery_cell": BATTERY_CELL_RELIEF,
            "window_base": WINDOW_DEPTH,
            "lit_sprite_dot": LIT_SPRITE_RELIEF,
            "dim_sprite_dot": DIM_SPRITE_RELIEF,
            "rear_groove_depth": REAR_GROOVE_DEPTH,
            "rear_groove_width": REAR_GROOVE_WIDTH,
            "thermal_runtime_path_cut_depth": 2.0,
            "thermal_runtime_path_rotation_degrees": 180,
            "thermal_runtime_path_horizontal_flip": True,
            "usb_c_recess_depth": 0.8,
            "usb_c_back_wall_depth": 2.8,
            "button_body_overlap_mm": 0.10,
        },
        "source_receipts": {
            "thermal_runtime_source": str(SHOWCASE_SOURCE.relative_to(ROOT)),
            "thermal_path_set_sha1": THERMAL_PATHS_SHA1,
            "thermal_path_count": 6,
            "thermal_path_names": ["THERMAL_SHOU", "THERMAL_WAN", "THERMAL_HUO[0..3]"],
        },
        "parts": part_names,
        "outputs": ["jiko-one-hero.stl", "jiko-one-hero-back-flat.stl", "jiko-one-structural-chassis.stl", "jiko-one-print-assembly.step", "jiko-one-assembly.step", "jiko-one-assembly.glb"],
    }
    (OUT / "model-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    # OCC retains substantial native memory after STEP export. Replace this
    # process so GLB packaging starts with a clean address space.
    del parts
    gc.collect()
    next_args = [sys.executable, str(Path(__file__).resolve()), "--package-glb"]
    if RELIEF_PRINT:
        next_args.append("--relief-print")
    os.execv(sys.executable, next_args)


def package_glb():
    metadata = json.loads((OUT / "model-metadata.json").read_text())
    export_glb(metadata["parts"])
    print(f"Generated {len(metadata['parts'])} named solids and GLB in {OUT}")


if __name__ == "__main__":
    package_glb() if "--package-glb" in sys.argv else main()
