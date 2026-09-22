#!/usr/bin/env python3
"""Render repeatable front/left/rear previews of the generated GLB."""

from pathlib import Path
import sys

import numpy as np
import pyvista as pv
import trimesh


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "models" / ("jiko-one-hero-relief" if "--relief-print" in sys.argv else "jiko-one-hero")
SCENE = trimesh.load(OUT / "jiko-one-assembly.glb", force="scene")
pv.OFF_SCREEN = True


def part_color(name: str):
    if name == "body_shell" or "window" in name or "dim" in name:
        return "#050505"
    if name.startswith(("amber", "status", "date", "weekday", "battery")):
        return "#f09035"
    if name.startswith("red"):
        return "#e0523a"
    if name.startswith("green"):
        return "#79bf72"
    if name.startswith("clock"):
        return "#f6ead0"
    if name.startswith(("usb_c_metal", "rear_screw")):
        return "#b8bcc4"
    if name == "screen_glass":
        return "#101317"
    return "#202329"


def render(filename: str, position, focal=(0, 0, 0), up=(0, 1, 0), zoom=1.0):
    plotter = pv.Plotter(off_screen=True, window_size=(1200, 1200))
    plotter.set_background("#151515")
    for name, mesh in SCENE.geometry.items():
        faces = np.hstack((np.full((len(mesh.faces), 1), 3), mesh.faces)).ravel()
        poly = pv.PolyData(mesh.vertices, faces)
        plotter.add_mesh(poly, color=part_color(name), smooth_shading=True, specular=0.35, specular_power=22)
    plotter.add_light(pv.Light(position=(120, 160, 180), focal_point=(0, 0, 0), intensity=1.2))
    plotter.add_light(pv.Light(position=(-120, -40, 100), focal_point=(0, 0, 0), intensity=0.7))
    plotter.camera_position = [position, focal, up]
    plotter.camera.zoom(zoom)
    plotter.show(screenshot=str(OUT / filename), auto_close=True)


def render_structure_check():
    body = trimesh.load_mesh(OUT / "body_shell.stl", file_type="stl")
    faces = np.hstack((np.full((len(body.faces), 1), 3), body.faces)).ravel()
    plotter = pv.Plotter(off_screen=True, window_size=(1200, 1200))
    plotter.set_background("#252525")
    plotter.add_mesh(pv.PolyData(body.vertices, faces), color="#8f8b82", smooth_shading=True, specular=0.05)
    plotter.add_light(pv.Light(position=(-170, -20, 90), focal_point=(-40, -31, 0), intensity=0.55))
    plotter.camera_position = [(-180, -22, 35), (-39, -31, 0), (0, 1, 0)]
    plotter.camera.zoom(2.0)
    plotter.show(screenshot=str(OUT / "preview-left-structure.png"), auto_close=True)


render("preview-front.png", (100, 45, 180), zoom=0.8)
render("preview-left.png", (-180, -15, 35), focal=(0, -16, 0), zoom=1.1)
render("preview-rear.png", (-95, 20, -190), zoom=0.8)
render("preview-right.png", (180, 0, 22), focal=(38, 8, 0), zoom=1.15)
render("preview-bottom.png", (55, -185, 32), focal=(0, -57, 0), up=(0, 0, 1), zoom=1.35)
render_structure_check()
render("preview-top-info.png", (8, 64, 205), focal=(0, 46, 3.7), zoom=1.20)
