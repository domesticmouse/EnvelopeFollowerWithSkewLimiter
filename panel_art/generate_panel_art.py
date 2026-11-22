#!/usr/bin/env python3
"""Generate and verify Dark Techno / Brutalist 6HP Eurorack front panel art via vectorcraft-cli."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

MM_TO_PT = 72.0 / 25.4
PT_TO_MM = 25.4 / 72.0

SPEC_PATH = Path("panel_svg_spec.md")
OUT_DIR = Path("panel_art")

# Visual palette
COLOR_FR4_BG = "#141518"
COLOR_FR4_RIM = "#2a2d34"
COLOR_DRILL_FILL = "#07080a"
COLOR_DRILL_RIM = "#383c46"
COLOR_MASK_GOLD = "#D8B154"
COLOR_MASK_FAB_GOLD = "#C89B3C"
COLOR_SILK_PREVIEW = "#F4F5F7"
COLOR_SILK_FAB = "#000000"
COLOR_BLACK = "#000000"

# Audit bitmap resolution (40 px/mm = 1016 ppi)
AUDIT_PPI = 1016.0
AUDIT_PX_PER_MM = AUDIT_PPI / 25.4  # exactly 40.0 px/mm


def pt(mm: float) -> float:
    """Convert millimeters to typographic points."""
    return round(mm * MM_TO_PT, 6)


def load_panel_spec(spec_path: Path = SPEC_PATH) -> dict[str, Any]:
    """Extract the machine-readable JSON geometry block from panel_svg_spec.md."""
    text = spec_path.read_text(encoding="utf-8")
    match = re.search(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    if not match:
        raise RuntimeError(f"Could not locate JSON geometry block in {spec_path}")
    return json.loads(match.group(1))


class StepBuilder:
    """Builds vectorcraft-cli --commands steps while tracking 0-based step indices."""

    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []

    def add(self, command: str, params: dict[str, Any] | None = None) -> int:
        idx = len(self.steps)
        step: dict[str, Any] = {"command": command}
        if params is not None:
            step["params"] = params
        self.steps.append(step)
        return idx

    def new_layer(self, name: str, color: str | None = None) -> str:
        params: dict[str, Any] = {"name": name, "top": True}
        if color:
            params["color"] = color
        idx = self.add("layer.new", params)
        return f"${idx}.id"

    def set_current_layer(self, layer_ref: str) -> None:
        self.add("layer.setCurrent", {"id": layer_ref})

    def set_layer_visible(self, layer_ref: str, visible: bool) -> None:
        self.add("layer.setProps", {"id": layer_ref, "visible": visible})

    def rect_fill(
        self,
        x_mm: float,
        y_mm: float,
        w_mm: float,
        h_mm: float,
        color: str,
        radius_mm: float = 0.0,
        rotation_deg: float = 0.0,
    ) -> str:
        params: dict[str, Any] = {
            "x": pt(x_mm),
            "y": pt(y_mm),
            "width": pt(w_mm),
            "height": pt(h_mm),
        }
        if radius_mm > 0.0:
            params["radius"] = pt(radius_mm)
        if rotation_deg != 0.0:
            params["rotation"] = rotation_deg
        idx = self.add("shape.rectangle", params)
        self.add("paint.setFill", {"color": color})
        self.add("paint.setStroke", {"none": True})
        return f"${idx}.id"

    def rect_stroke_outlined(
        self,
        x_mm: float,
        y_mm: float,
        w_mm: float,
        h_mm: float,
        stroke_mm: float,
        color: str,
        align: str = "center",
        join: str = "miter",
        radius_mm: float = 0.0,
    ) -> str:
        params: dict[str, Any] = {
            "x": pt(x_mm),
            "y": pt(y_mm),
            "width": pt(w_mm),
            "height": pt(h_mm),
        }
        if radius_mm > 0.0:
            params["radius"] = pt(radius_mm)
        self.add("shape.rectangle", params)
        self.add("paint.setFill", {"none": True})
        self.add("paint.setStroke", {"color": color})
        self.add(
            "stroke.set",
            {"weight": pt(stroke_mm), "align": align, "join": join},
        )
        out_idx = self.add("object.path.outlineStroke")
        return f"${out_idx}.ids[0]"

    def circle_fill(self, cx_mm: float, cy_mm: float, d_mm: float, color: str) -> str:
        r_mm = d_mm / 2.0
        idx = self.add(
            "shape.ellipse",
            {
                "x": pt(cx_mm - r_mm),
                "y": pt(cy_mm - r_mm),
                "width": pt(d_mm),
                "height": pt(d_mm),
            },
        )
        self.add("paint.setFill", {"color": color})
        self.add("paint.setStroke", {"none": True})
        return f"${idx}.id"

    def circle_stroke_keepout(
        self,
        cx_mm: float,
        cy_mm: float,
        d_mm: float,
        color: str,
        stroke_mm: float = 0.14,
        dash_mm: tuple[float, float] | None = (0.45, 0.35),
        opacity: int = 85,
    ) -> str:
        r_mm = d_mm / 2.0
        idx = self.add(
            "shape.ellipse",
            {
                "x": pt(cx_mm - r_mm),
                "y": pt(cy_mm - r_mm),
                "width": pt(d_mm),
                "height": pt(d_mm),
            },
        )
        self.add("paint.setFill", {"none": True})
        self.add("paint.setStroke", {"color": color})
        stroke_params: dict[str, Any] = {"weight": pt(stroke_mm)}
        if dash_mm is not None:
            stroke_params["dash"] = [pt(dash_mm[0]), pt(dash_mm[1])]
        self.add("stroke.set", stroke_params)
        self.add("transparency.set", {"opacity": opacity})
        return f"${idx}.id"

    def rect_stroke_keepout(
        self,
        x_mm: float,
        y_mm: float,
        w_mm: float,
        h_mm: float,
        color: str,
        stroke_mm: float = 0.14,
        dash_mm: tuple[float, float] | None = (0.50, 0.35),
        radius_mm: float = 0.0,
        opacity: int = 80,
    ) -> str:
        params: dict[str, Any] = {
            "x": pt(x_mm),
            "y": pt(y_mm),
            "width": pt(w_mm),
            "height": pt(h_mm),
        }
        if radius_mm > 0.0:
            params["radius"] = pt(radius_mm)
        idx = self.add("shape.rectangle", params)
        self.add("paint.setFill", {"none": True})
        self.add("paint.setStroke", {"color": color})
        stroke_params: dict[str, Any] = {"weight": pt(stroke_mm)}
        if dash_mm is not None:
            stroke_params["dash"] = [pt(dash_mm[0]), pt(dash_mm[1])]
        self.add("stroke.set", stroke_params)
        self.add("transparency.set", {"opacity": opacity})
        return f"${idx}.id"

    def polygon_fill(self, points_mm: list[tuple[float, float]], color: str) -> str:
        anchors = [{"x": pt(x), "y": pt(y)} for x, y in points_mm]
        idx = self.add("path.create", {"anchors": anchors, "closed": True})
        self.add("paint.setFill", {"color": color})
        self.add("paint.setStroke", {"none": True})
        return f"${idx}.id"

    def polygon_stroke_outlined(
        self,
        points_mm: list[tuple[float, float]],
        stroke_mm: float,
        color: str,
        closed: bool = True,
        align: str = "center",
        join: str = "miter",
        cap: str = "butt",
    ) -> str:
        anchors = [{"x": pt(x), "y": pt(y)} for x, y in points_mm]
        self.add("path.create", {"anchors": anchors, "closed": closed})
        self.add("paint.setFill", {"none": True})
        self.add("paint.setStroke", {"color": color})
        self.add(
            "stroke.set",
            {
                "weight": pt(stroke_mm),
                "align": align,
                "join": join,
                "cap": cap,
            },
        )
        out_idx = self.add("object.path.outlineStroke")
        return f"${out_idx}.ids[0]"

    def line_stroke_outlined(
        self,
        x1_mm: float,
        y1_mm: float,
        x2_mm: float,
        y2_mm: float,
        stroke_mm: float,
        color: str,
        cap: str = "butt",
    ) -> str:
        self.add(
            "shape.line",
            {
                "x1": pt(x1_mm),
                "y1": pt(y1_mm),
                "x2": pt(x2_mm),
                "y2": pt(y2_mm),
            },
        )
        self.add("paint.setFill", {"none": True})
        self.add("paint.setStroke", {"color": color})
        self.add("stroke.set", {"weight": pt(stroke_mm), "cap": cap})
        out_idx = self.add("object.path.outlineStroke")
        return f"${out_idx}.ids[0]"

    def text_outlined(
        self,
        x_mm: float,
        y_baseline_mm: float,
        text: str,
        font: str,
        style: str,
        size_mm: float,
        color: str,
        justify: str = "center",
        tracking: int | None = None,
    ) -> str:
        idx = self.add(
            "text.create",
            {
                "x": pt(x_mm),
                "y": pt(y_baseline_mm),
                "text": text,
                "font": font,
                "style": style,
                "size": pt(size_mm),
                "color": color,
                "justify": justify,
            },
        )
        if tracking is not None:
            self.add("text.setStyle", {"id": f"${idx}.id", "tracking": tracking})
        out_idx = self.add("type.createOutlines")
        return f"${out_idx}.ids[0]"

    def minus_front(self, back_id: str, front_id: str) -> str:
        idx = self.add(
            "object.pathfinder.minusFront",
            {"ids": [back_id, front_id]},
        )
        return f"${idx}.ids[0]"


def chamfer_rect_points(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    tl: float = 0.0,
    tr: float = 0.0,
    br: float = 0.0,
    bl: float = 0.0,
) -> list[tuple[float, float]]:
    """Return clockwise polygon vertices for a chamfered rectangle."""
    pts: list[tuple[float, float]] = []
    if tl > 0:
        pts.extend([(x0, y0 + tl), (x0 + tl, y0)])
    else:
        pts.append((x0, y0))
    if tr > 0:
        pts.extend([(x1 - tr, y0), (x1, y0 + tr)])
    else:
        pts.append((x1, y0))
    if br > 0:
        pts.extend([(x1, y1 - br), (x1 - br, y1)])
    else:
        pts.append((x1, y1))
    if bl > 0:
        pts.extend([(x0 + bl, y1), (x0, y1 - bl)])
    else:
        pts.append((x0, y1))
    return pts


def regular_polygon_points(
    cx: float, cy: float, radius: float, sides: int, rot_deg: float = 0.0
) -> list[tuple[float, float]]:
    """Return vertices for a regular polygon centered at (cx, cy)."""
    pts: list[tuple[float, float]] = []
    for k in range(sides):
        ang = math.radians(rot_deg + k * (360.0 / sides))
        pts.append((cx + radius * math.cos(ang), cy + radius * math.sin(ang)))
    return pts


def build_commands(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Construct the full VectorCraft command sequence from panel_svg_spec.md."""
    canvas = spec["canvas"]
    width_mm = float(canvas["width_mm"])
    height_mm = float(canvas["height_mm"])

    comps = {c["ref"]: c for c in spec["components"]}
    slots = {s["ref"]: s for s in spec["mounting_slots"]}

    sb = StepBuilder()

    # Initialize exact 30.00 x 128.50 mm document
    sb.add(
        "file.new",
        {
            "title": "ENV / SKEW — 6HP Front Panel",
            "width": f"{width_mm} mm",
            "height": f"{height_mm} mm",
            "units": "Millimeters",
            "alignNewObjectsToPixelGrid": False,
            "colorMode": "rgb",
            "rasterEffectsPpi": 300,
        },
    )

    # Create explicit layers bottom-to-top so every layer ID is captured cleanly
    lyr_mockup = sb.new_layer("00_Board_Mockup", "#3f444e")
    lyr_mask = sb.new_layer("01_F_Mask_Gold", "#d8b154")
    lyr_silks = sb.new_layer("02_F_SilkS_White", "#ffffff")
    lyr_reg = sb.new_layer("03_Registration_Frame", "#00ff88")
    lyr_keepout = sb.new_layer("04_Hardware_Keepouts", "#00d4ff")

    # =========================================================================
    # LAYER 00: BOARD MOCKUP (visual only)
    # =========================================================================
    sb.set_current_layer(lyr_mockup)
    sb.rect_fill(0.0, 0.0, width_mm, height_mm, COLOR_FR4_BG)
    sb.rect_stroke_outlined(
        0.0,
        0.0,
        width_mm,
        height_mm,
        0.18,
        COLOR_FR4_RIM,
        align="inside",
    )

    # Mounting slots H1 & H2
    for ref in ("H1", "H2"):
        s = slots[ref]
        sw, sh = float(s["width_mm"]), float(s["height_mm"])
        sx, sy = float(s["local_x"]) - sw / 2.0, float(s["local_y"]) - sh / 2.0
        sb.rect_fill(sx, sy, sw, sh, COLOR_DRILL_FILL, radius_mm=sh / 2.0)
        sb.rect_stroke_outlined(
            sx,
            sy,
            sw,
            sh,
            0.14,
            COLOR_DRILL_RIM,
            align="outside",
            radius_mm=sh / 2.0,
        )

    # Component drills
    for ref, comp in comps.items():
        cx = float(comp["local_x"])
        cy = float(comp["local_y"])
        drill = float(comp["drill_mm"])
        sb.circle_fill(cx, cy, drill, COLOR_DRILL_FILL)
        rim_col = "#2f5a3f" if ref == "LED1" else COLOR_DRILL_RIM
        sb.circle_stroke_keepout(
            cx, cy, drill + 0.16, rim_col, stroke_mm=0.14, dash_mm=None, opacity=95
        )
        if ref == "LED1":
            sb.circle_fill(cx, cy, 2.2, "#1c3322")

    # =========================================================================
    # LAYER 01: F.MASK ENIG GOLD
    # =========================================================================
    sb.set_current_layer(lyr_mask)

    # 1. Top-right hero angular envelope + 6 decaying kick-drum bars underneath
    # Completely clear of H1 washer (X <= 12.15) and top/right pullback (0.80 mm)
    sb.polygon_fill(
        [
            (13.90, 4.90),
            (15.20, 4.90),
            (16.85, 1.35),
            (18.45, 1.35),
            (24.15, 3.55),
            (28.50, 3.55),
            (28.50, 4.35),
            (23.85, 4.35),
            (18.15, 2.15),
            (17.45, 2.15),
            (15.80, 5.70),
            (13.90, 5.70),
        ],
        COLOR_MASK_GOLD,
    )
    under_bars = [
        (17.65, 3.01, 2.69),
        (19.56, 3.75, 1.95),
        (21.47, 4.48, 1.22),
        (23.38, 4.85, 0.85),
        (25.29, 4.85, 0.85),
        (27.20, 4.85, 0.85),
    ]
    for bx, by, bh in under_bars:
        sb.rect_fill(bx, by, 1.30, bh, COLOR_MASK_GOLD)

    # 2. Chamfered Gold Title Slab with knocked-out "ENV / SKEW"
    # Bounds: X = 1.20..28.80 (27.60 mm), Y = 6.80..11.40 (4.60 mm)
    title_slab_id = sb.polygon_fill(
        chamfer_rect_points(1.20, 6.80, 28.80, 11.40, tr=1.10, bl=1.10),
        COLOR_MASK_GOLD,
    )
    # DIN Condensed Bold size 4.55 mm -> cap height ~ 3.21 mm -> baseline 10.64 centers caps in 6.80..11.40
    title_txt_id = sb.text_outlined(
        x_mm=15.00,
        y_baseline_mm=10.64,
        text="ENV / SKEW",
        font="DIN Condensed",
        style="Bold",
        size_mm=4.55,
        color=COLOR_BLACK,
        justify="center",
        tracking=65,
    )
    sb.minus_front(title_slab_id, title_txt_id)

    # 3. Architectural segmented side edge rails flanking the pot column (Y = 13.4..73.6)
    rail_segments = [
        (13.60, 28.40),
        (29.10, 43.90),
        (44.60, 59.40),
        (60.10, 73.60),
    ]
    for y0, y1 in rail_segments:
        sb.rect_fill(0.85, y0, 0.42, y1 - y0, COLOR_MASK_GOLD)
        sb.rect_fill(28.73, y0, 0.42, y1 - y0, COLOR_MASK_GOLD)

    # 4. Right-flank sculptural motifs beside RV1..RV4 (X = 23.90..28.00)
    # RV1 GAIN (Y = 16.80..25.70): 4 progressive brutalist gain bars
    bar_heights = [2.40, 4.40, 6.60, 8.90]
    bar_w = 0.68
    bar_gap = 0.44
    for idx_b, bh in enumerate(bar_heights):
        bx = 23.90 + idx_b * (bar_w + bar_gap)
        by = 25.70 - bh
        sb.polygon_fill(
            chamfer_rect_points(bx, by, bx + bar_w, 25.70, tr=0.25),
            COLOR_MASK_GOLD,
        )

    # RV2 ATK (Y = 32.35..41.15): Crisp rising slew step waveform (_/‾)
    sb.polygon_fill(
        [
            (23.90, 40.35),
            (24.75, 40.35),
            (26.65, 32.35),
            (28.00, 32.35),
            (28.00, 33.25),
            (27.25, 33.25),
            (25.35, 41.15),
            (23.90, 41.15),
        ],
        COLOR_MASK_GOLD,
    )

    # RV3 REL (Y = 47.85..56.65): Crisp falling slew step waveform (‾\_)
    sb.polygon_fill(
        [
            (23.90, 47.85),
            (25.35, 47.85),
            (27.25, 55.75),
            (28.00, 55.75),
            (28.00, 56.65),
            (26.65, 56.65),
            (24.75, 48.75),
            (23.90, 48.75),
        ],
        COLOR_MASK_GOLD,
    )

    # RV4 OFFSET (Y = 63.35..69.95): Zero-datum bar + chamfered [+] and [-] blocks
    # Ends at Y = 69.95 so white '+' below at Y = 72.10 has >= 1.40 mm clearance
    sb.rect_fill(23.90, 66.43, 4.10, 0.44, COLOR_MASK_GOLD)
    pos_block = sb.polygon_fill(
        chamfer_rect_points(24.55, 63.35, 27.45, 65.75, tl=0.35, br=0.35),
        COLOR_MASK_GOLD,
    )
    pos_h = sb.rect_fill(25.25, 64.32, 1.50, 0.46, COLOR_BLACK)
    pos_block = sb.minus_front(pos_block, pos_h)
    pos_v = sb.rect_fill(25.77, 63.80, 0.46, 1.50, COLOR_BLACK)
    sb.minus_front(pos_block, pos_v)

    neg_block = sb.polygon_fill(
        chamfer_rect_points(24.55, 67.55, 27.45, 69.95, tr=0.35, bl=0.35),
        COLOR_MASK_GOLD,
    )
    neg_slot = sb.rect_fill(25.25, 68.52, 1.50, 0.46, COLOR_BLACK)
    sb.minus_front(neg_block, neg_slot)

    # 5. Functional Pot Gold Accents
    # RV1 GAIN: bold gold max-drive wedge tick at +150 deg
    rv1_y = float(comps["RV1"]["local_y"])
    ang_150 = math.radians(150.0)
    ux_150, uy_150 = math.sin(ang_150), -math.cos(ang_150)
    px_150, py_150 = -uy_150, ux_150
    r_in, r_out = 6.45, 8.20
    w_in, w_out = 0.20, 0.44
    sb.polygon_fill(
        [
            (
                15.0 + ux_150 * r_in - px_150 * w_in,
                rv1_y + uy_150 * r_in - py_150 * w_in,
            ),
            (
                15.0 + ux_150 * r_out - px_150 * w_out,
                rv1_y + uy_150 * r_out - py_150 * w_out,
            ),
            (
                15.0 + ux_150 * r_out + px_150 * w_out,
                rv1_y + uy_150 * r_out + py_150 * w_out,
            ),
            (
                15.0 + ux_150 * r_in + px_150 * w_in,
                rv1_y + uy_150 * r_in + py_150 * w_in,
            ),
        ],
        COLOR_MASK_GOLD,
    )

    # RV4 OFFSET: gold center-detent inverted chevron/triangle at 12 o'clock (Y = 60.05..61.20)
    sb.polygon_fill(
        [(14.30, 60.05), (15.70, 60.05), (15.00, 61.20)],
        COLOR_MASK_GOLD,
    )

    # 6. Octagonal ENIG Gold Bezel around LED1 (15.00, 82.25)
    # R_mid = 2.82 mm, stroke = 0.52 mm -> inner apothem 2.345 mm (> 2.10 mm), outer 3.08 mm
    led_x = float(comps["LED1"]["local_x"])
    led_y = float(comps["LED1"]["local_y"])
    sb.polygon_stroke_outlined(
        regular_polygon_points(led_x, led_y, 2.82, 8, rot_deg=22.5),
        stroke_mm=0.52,
        color=COLOR_MASK_GOLD,
        closed=True,
        align="center",
        join="miter",
    )

    # 7. Patchbay Gold Bus Bar (Y = 89.65..90.20)
    sb.rect_fill(1.20, 89.65, 27.60, 0.55, COLOR_MASK_GOLD)

    # 8. Normaling Arrow between J1 (8.00, 95.75) and J2 (22.00, 95.75)
    # Jack nut keepout is 9.5 mm (X = 12.75 and 17.25). Arrow spans X = 13.45..16.55 (>= 0.70 mm clear).
    j1_y = float(comps["J1"]["local_y"])
    sb.polygon_fill(
        [
            (13.45, j1_y - 0.28),
            (15.45, j1_y - 0.28),
            (15.45, j1_y - 0.90),
            (16.55, j1_y),
            (15.45, j1_y + 0.90),
            (15.45, j1_y + 0.28),
            (13.45, j1_y + 0.28),
        ],
        COLOR_MASK_GOLD,
    )

    # 9. Chamfered Gold Output Bay Frame enclosing J3 & J4 (X = 1.15..28.85, Y = 104.25..120.25)
    sb.polygon_stroke_outlined(
        chamfer_rect_points(
            1.15, 104.25, 28.85, 120.25, tl=1.20, tr=1.20, br=1.20, bl=1.20
        ),
        stroke_mm=0.50,
        color=COLOR_MASK_GOLD,
        closed=True,
        align="inside",
        join="miter",
    )
    # Center vertical spine between J3 & J4 nuts
    sb.rect_fill(14.75, 106.30, 0.50, 8.90, COLOR_MASK_GOLD)

    # 10. Bottom-right registration badge next to DM // R1.0 (clear of H2 washer X <= 12.15)
    sb.polygon_fill(
        chamfer_rect_points(16.40, 124.70, 18.00, 126.30, tr=0.45, bl=0.45),
        COLOR_MASK_GOLD,
    )

    # =========================================================================
    # LAYER 02: F.SILKS WHITE
    # =========================================================================
    sb.set_current_layer(lyr_silks)

    # 1. Sub-header hairline rule (Y = 12.15)
    sb.line_stroke_outlined(1.60, 12.15, 28.40, 12.15, 0.24, COLOR_SILK_PREVIEW)

    # 2. Upper-left pot labels + 300 deg radial dial ticks
    pot_refs = ["RV1", "RV2", "RV3", "RV4"]
    tick_angles = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]
    major_angles = {-150, -90, 0, 90, 150}

    for ref in pot_refs:
        comp = comps[ref]
        px = float(comp["local_x"])
        py = float(comp["local_y"])
        label = str(comp["label"])

        # Upper-left horizontal label (DIN Alternate Bold, 1.90 mm -> ~1.37 mm cap height)
        sb.text_outlined(
            x_mm=1.90,
            y_baseline_mm=py - 5.20,
            text=label,
            font="DIN Alternate",
            style="Bold",
            size_mm=1.90,
            color=COLOR_SILK_PREVIEW,
            justify="left",
            tracking=35,
        )

        # Radial dial ticks
        for deg in tick_angles:
            if ref == "RV4" and deg == 0:
                continue  # Replaced by gold center-detent triangle
            if ref == "RV1" and deg == 150:
                continue  # Replaced by gold max-drive wedge

            is_major = deg in major_angles
            r0 = 6.40 if is_major else 6.50
            # Keep 0 deg outer radius <= 7.60 mm so RV2..RV4 top ticks stay >= 0.90 mm clear of knob above
            r1 = 7.60 if deg == 0 else (8.00 if is_major else 7.60)
            w = 0.28 if is_major else 0.20

            rad = math.radians(deg)
            ux, uy = math.sin(rad), -math.cos(rad)
            sb.line_stroke_outlined(
                px + ux * r0,
                py + uy * r0,
                px + ux * r1,
                py + uy * r1,
                stroke_mm=w,
                color=COLOR_SILK_PREVIEW,
                cap="butt",
            )

    # Geometric polarity marks '-' and '+' for RV4 (OFFSET)
    sb.rect_fill(
        4.65, 71.93, 1.50, 0.34, COLOR_SILK_PREVIEW
    )  # '-' centered at (5.40, 72.10)
    sb.rect_fill(23.85, 71.93, 1.50, 0.34, COLOR_SILK_PREVIEW)  # '+' horizontal
    sb.rect_fill(24.43, 71.35, 0.34, 1.50, COLOR_SILK_PREVIEW)  # '+' vertical

    # 3. Framing wings above Mode row (Y = 74.75, clear of RV4 knob X = 8..22 and side rails)
    sb.line_stroke_outlined(1.85, 74.75, 8.10, 74.75, 0.22, COLOR_SILK_PREVIEW)
    sb.line_stroke_outlined(21.90, 74.75, 28.15, 74.75, 0.22, COLOR_SILK_PREVIEW)

    # 4. Mode & Monitor row labels (SW1, LED1, SW2 at Y = 82.25)
    sw1_x = float(comps["SW1"]["local_x"])
    sw2_x = float(comps["SW2"]["local_x"])
    # Above switches (baseline 77.35 -> cap top ~76.08, 0.80 mm above 8.2 mm nut)
    sb.text_outlined(
        x_mm=sw1_x,
        y_baseline_mm=77.35,
        text="SMOOTH",
        font="DIN Condensed",
        style="Bold",
        size_mm=1.80,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=35,
    )
    sb.text_outlined(
        x_mm=sw2_x,
        y_baseline_mm=77.35,
        text="SLOW",
        font="DIN Condensed",
        style="Bold",
        size_mm=1.80,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=40,
    )
    # Below switches & LED (baseline 88.45 -> 0.88 mm below nuts, 1.20 mm above Gold Bus Bar)
    sb.text_outlined(
        x_mm=sw1_x,
        y_baseline_mm=88.45,
        text="RAW",
        font="DIN Alternate",
        style="Bold",
        size_mm=1.72,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=35,
    )
    sb.text_outlined(
        x_mm=led_x,
        y_baseline_mm=88.45,
        text="+ / −",
        font="DIN Alternate",
        style="Bold",
        size_mm=1.88,
        color=COLOR_SILK_PREVIEW,
        justify="center",
    )
    sb.text_outlined(
        x_mm=sw2_x,
        y_baseline_mm=88.45,
        text="FAST",
        font="DIN Alternate",
        style="Bold",
        size_mm=1.72,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=35,
    )

    # 5. Patchbay Input Labels (Row 6: J1 IN, J2 SLEW IN)
    j1_x = float(comps["J1"]["local_x"])
    j2_x = float(comps["J2"]["local_x"])
    sb.text_outlined(
        x_mm=j1_x,
        y_baseline_mm=103.05,
        text="IN",
        font="DIN Alternate",
        style="Bold",
        size_mm=1.90,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=40,
    )
    sb.text_outlined(
        x_mm=j2_x,
        y_baseline_mm=103.05,
        text="SLEW IN",
        font="DIN Condensed",
        style="Bold",
        size_mm=1.95,
        color=COLOR_SILK_PREVIEW,
        justify="center",
        tracking=40,
    )

    # 6. Patchbay Output Inverted Knockout Badges (Row 7: J3 OUT, J4 INV OUT)
    j3_x = float(comps["J3"]["local_x"])
    j4_x = float(comps["J4"]["local_x"])

    pill_left = sb.polygon_fill(
        chamfer_rect_points(2.30, 116.30, 13.70, 119.10, tr=0.45, bl=0.45),
        COLOR_SILK_PREVIEW,
    )
    txt_out = sb.text_outlined(
        x_mm=j3_x,
        y_baseline_mm=118.32,
        text="OUT",
        font="DIN Alternate",
        style="Bold",
        size_mm=1.96,
        color=COLOR_BLACK,
        justify="center",
        tracking=45,
    )
    sb.minus_front(pill_left, txt_out)

    pill_right = sb.polygon_fill(
        chamfer_rect_points(16.30, 116.30, 27.70, 119.10, tl=0.45, br=0.45),
        COLOR_SILK_PREVIEW,
    )
    txt_inv = sb.text_outlined(
        x_mm=j4_x,
        y_baseline_mm=118.32,
        text="INV OUT",
        font="DIN Condensed",
        style="Bold",
        size_mm=2.00,
        color=COLOR_BLACK,
        justify="center",
        tracking=45,
    )
    sb.minus_front(pill_right, txt_inv)

    # 7. Bottom-right Maker / Revision mark: "DM // R1.0"
    sb.text_outlined(
        x_mm=28.40,
        y_baseline_mm=126.08,
        text="DM // R1.0",
        font="Menlo",
        style="Bold",
        size_mm=1.52,
        color=COLOR_SILK_PREVIEW,
        justify="right",
    )

    # =========================================================================
    # LAYER 03: REGISTRATION FRAME (for fab SVGs only)
    # =========================================================================
    sb.set_current_layer(lyr_reg)
    sb.rect_stroke_outlined(
        0.0,
        0.0,
        width_mm,
        height_mm,
        0.05,
        COLOR_SILK_PREVIEW,
        align="inside",
        join="miter",
    )

    # =========================================================================
    # LAYER 04: HARDWARE KEEPOUTS (for preview_keepouts.png only)
    # =========================================================================
    sb.set_current_layer(lyr_keepout)

    # Rail bands (magenta)
    rail_top = spec["canvas"]["rail_keepout_y_mm"]["top"]
    rail_bot = spec["canvas"]["rail_keepout_y_mm"]["bottom"]
    sb.rect_stroke_keepout(
        0.0,
        float(rail_top[0]),
        width_mm,
        float(rail_top[1]) - float(rail_top[0]),
        "#ff33aa",
        stroke_mm=0.14,
        dash_mm=(0.7, 0.4),
        opacity=80,
    )
    sb.rect_stroke_keepout(
        0.0,
        float(rail_bot[0]),
        width_mm,
        float(rail_bot[1]) - float(rail_bot[0]),
        "#ff33aa",
        stroke_mm=0.14,
        dash_mm=(0.7, 0.4),
        opacity=80,
    )

    # M3 washer sweep capsule at H1 & H2 (7.0 mm washer across 5.5 mm slot)
    for ref in ("H1", "H2"):
        s = slots[ref]
        hx = float(s["local_x"])
        hy = float(s["local_y"])
        # Screw center moves along slot X = hx +/- 1.15 mm; 7.0 mm washer sweeps W = 9.30 mm, H = 7.00 mm
        sb.rect_stroke_keepout(
            hx - 4.65,
            hy - 3.50,
            9.30,
            7.00,
            "#ff33aa",
            stroke_mm=0.15,
            dash_mm=(0.45, 0.30),
            radius_mm=3.50,
            opacity=90,
        )

    # Copper F.Cu edge pullback (0.60 mm) & LED1 NPTH pullback (R = 2.10 mm -> D = 4.20 mm)
    sb.rect_stroke_keepout(
        0.60,
        0.60,
        width_mm - 1.20,
        height_mm - 1.20,
        "#44ff66",
        stroke_mm=0.13,
        dash_mm=(0.60, 0.40),
        opacity=75,
    )
    sb.circle_stroke_keepout(
        led_x, led_y, 4.20, "#44ff66", stroke_mm=0.14, dash_mm=(0.35, 0.25), opacity=85
    )

    # Component nut/bezel & max-knob circles
    for comp in spec["components"]:
        cx = float(comp["local_x"])
        cy = float(comp["local_y"])
        keepout = float(comp["keepout_mm"])
        sb.circle_stroke_keepout(
            cx, cy, keepout, "#ffaa00", stroke_mm=0.14, dash_mm=(0.45, 0.30), opacity=85
        )
        if comp["max_knob_mm"]:
            sb.circle_stroke_keepout(
                cx,
                cy,
                float(comp["max_knob_mm"]),
                "#00d4ff",
                stroke_mm=0.15,
                dash_mm=(0.60, 0.35),
                opacity=85,
            )

    # =========================================================================
    # EXPORTS (toggling layer visibility cleanly)
    # =========================================================================
    # 1. Clean preview + native VectorCraft source (00, 01, 02 visible; 03, 04 hidden)
    sb.set_layer_visible(lyr_reg, False)
    sb.set_layer_visible(lyr_keepout, False)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "envelope_follower_panel.vectorcraft"),
            "format": "vectorcraft",
            "pdfCompatible": True,
        },
    )
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "preview_clean.png"),
            "format": "png",
            "ppi": 600,
            "background": "transparent",
        },
    )

    # 2. Keepout overlay preview (04 visible)
    sb.set_layer_visible(lyr_keepout, True)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "preview_keepouts.png"),
            "format": "png",
            "ppi": 600,
            "background": "transparent",
        },
    )

    # 3. F.SilkS raw SVG (ONLY 02 + 03 visible)
    sb.set_layer_visible(lyr_mockup, False)
    sb.set_layer_visible(lyr_mask, False)
    sb.set_layer_visible(lyr_keepout, False)
    sb.set_layer_visible(lyr_silks, True)
    sb.set_layer_visible(lyr_reg, True)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "front_silkscreen.raw.svg"),
            "format": "svg",
            "decimals": 5,
            "outlineText": True,
            "hiddenLayers": False,
        },
    )

    # 4. F.Mask raw SVG (ONLY 01 + 03 visible)
    sb.set_layer_visible(lyr_silks, False)
    sb.set_layer_visible(lyr_mask, True)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "front_soldermask.raw.svg"),
            "format": "svg",
            "decimals": 5,
            "outlineText": True,
            "hiddenLayers": False,
        },
    )

    # 5. Exact 40 px/mm audit bitmaps (no registration frame, black background)
    sb.set_layer_visible(lyr_reg, False)
    sb.set_layer_visible(lyr_mask, False)
    sb.set_layer_visible(lyr_silks, True)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "_audit_silks.png"),
            "format": "png",
            "ppi": AUDIT_PPI,
            "background": "black",
            "antiAlias": "none",
        },
    )

    sb.set_layer_visible(lyr_silks, False)
    sb.set_layer_visible(lyr_mask, True)
    sb.add(
        "document.export",
        {
            "path": str(OUT_DIR / "_audit_mask.png"),
            "format": "png",
            "ppi": AUDIT_PPI,
            "background": "black",
            "antiAlias": "none",
        },
    )

    return sb.steps


# =============================================================================
# SVG NORMALIZATION TO 1:1 MILLIMETER PLAIN SVG
# =============================================================================

_PATH_TOKEN_RE = re.compile(
    r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)"
)


def _fmt_mm(val: float) -> str:
    txt = f"{val:.4f}".rstrip("0").rstrip(".")
    return "0" if txt in ("", "-0") else txt


def _scale_path_d(d: str, scale: float) -> tuple[str, list[tuple[float, float]]]:
    """Scale every coordinate in an SVG path d-string from pt to mm."""
    tokens = _PATH_TOKEN_RE.findall(d)
    out: list[str] = []
    pts_seen: list[tuple[float, float]] = []

    i = 0
    cmd = ""
    cx = 0.0
    cy = 0.0
    sx = 0.0
    sy = 0.0

    def next_num() -> float:
        nonlocal i
        val = float(tokens[i][1])
        i += 1
        return val

    def has_num() -> bool:
        return i < len(tokens) and tokens[i][1] != ""

    while i < len(tokens):
        if tokens[i][0]:
            cmd = tokens[i][0]
            i += 1
            if cmd in ("Z", "z"):
                out.append(cmd)
                cx, cy = sx, sy
                continue
        if not cmd:
            raise ValueError(f"Malformed SVG path data near token {tokens[i]}")

        upper = cmd.upper()
        rel = cmd.islower()

        if upper in ("M", "L", "T"):
            first = True
            while has_num():
                x = next_num() * scale
                y = next_num() * scale
                if rel:
                    cx += x
                    cy += y
                else:
                    cx, cy = x, y
                if upper == "M" and first:
                    sx, sy = cx, cy
                    op = "m" if rel else "M"
                    first = False
                elif upper == "M":
                    op = "l" if rel else "L"
                else:
                    op = cmd
                pts_seen.append((cx, cy))
                out.append(f"{op}{_fmt_mm(x)} {_fmt_mm(y)}")
        elif upper == "H":
            while has_num():
                x = next_num() * scale
                cx = cx + x if rel else x
                pts_seen.append((cx, cy))
                out.append(f"{cmd}{_fmt_mm(x)}")
        elif upper == "V":
            while has_num():
                y = next_num() * scale
                cy = cy + y if rel else y
                pts_seen.append((cx, cy))
                out.append(f"{cmd}{_fmt_mm(y)}")
        elif upper == "C":
            while has_num():
                vals = [next_num() * scale for _ in range(6)]
                if rel:
                    pts_seen.extend(
                        [
                            (cx + vals[0], cy + vals[1]),
                            (cx + vals[2], cy + vals[3]),
                            (cx + vals[4], cy + vals[5]),
                        ]
                    )
                    cx += vals[4]
                    cy += vals[5]
                else:
                    pts_seen.extend(
                        [(vals[0], vals[1]), (vals[2], vals[3]), (vals[4], vals[5])]
                    )
                    cx, cy = vals[4], vals[5]
                out.append(f"{cmd}" + " ".join(_fmt_mm(v) for v in vals))
        elif upper in ("S", "Q"):
            while has_num():
                vals = [next_num() * scale for _ in range(4)]
                if rel:
                    pts_seen.extend(
                        [(cx + vals[0], cy + vals[1]), (cx + vals[2], cy + vals[3])]
                    )
                    cx += vals[2]
                    cy += vals[3]
                else:
                    pts_seen.extend([(vals[0], vals[1]), (vals[2], vals[3])])
                    cx, cy = vals[2], vals[3]
                out.append(f"{cmd}" + " ".join(_fmt_mm(v) for v in vals))
        elif upper == "A":
            while has_num():
                rx = next_num() * scale
                ry = next_num() * scale
                xrot = next_num()
                large = int(next_num())
                sweep = int(next_num())
                x = next_num() * scale
                y = next_num() * scale
                if rel:
                    cx += x
                    cy += y
                else:
                    cx, cy = x, y
                pts_seen.append((cx, cy))
                out.append(
                    f"{cmd}{_fmt_mm(rx)} {_fmt_mm(ry)} {_fmt_mm(xrot)} {large} {sweep} {_fmt_mm(x)} {_fmt_mm(y)}"
                )
        else:
            raise ValueError(f"Unsupported SVG path command {cmd}")

    return " ".join(out), pts_seen


def _scale_points_attr(
    points_str: str, scale: float
) -> tuple[str, list[tuple[float, float]]]:
    nums = [
        float(v)
        for v in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", points_str)
    ]
    if len(nums) % 2 != 0:
        raise ValueError(f"Odd coordinate count in points attribute: {points_str}")
    pts: list[tuple[float, float]] = []
    formatted: list[str] = []
    for k in range(0, len(nums), 2):
        x = nums[k] * scale
        y = nums[k + 1] * scale
        pts.append((x, y))
        formatted.append(f"{_fmt_mm(x)},{_fmt_mm(y)}")
    return " ".join(formatted), pts


def normalize_svg_to_mm(
    raw_svg: Path,
    out_svg: Path,
    fill_hex: str,
    width_mm: float,
    height_mm: float,
) -> dict[str, Any]:
    """Convert VectorCraft pt-viewBox SVG to a 1:1 mm Plain SVG and validate paths-only."""
    SVG_NS = "http://www.w3.org/2000/svg"
    ET.register_namespace("", SVG_NS)

    tree = ET.parse(raw_svg)
    root = tree.getroot()

    # Check root dimensions
    root.attrib["width"] = f"{width_mm:.2f}mm"
    root.attrib["height"] = f"{height_mm:.2f}mm"
    root.attrib["viewBox"] = f"0 0 {width_mm:.2f} {height_mm:.2f}"
    # Remove xlink namespace if unused
    for k in list(root.attrib):
        if "xlink" in k:
            del root.attrib[k]

    text_count = 0
    stroked_count = 0
    element_count = 0
    reg_frame_bbox: tuple[float, float, float, float] | None = None

    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag in ("text", "tspan", "textPath"):
            text_count += 1
        if "transform" in elem.attrib:
            raise RuntimeError(
                f"Unexpected transform attribute on <{tag}> in {raw_svg}: {elem.attrib['transform']}"
            )

        stroke_val = elem.attrib.get("stroke", "none")
        if stroke_val not in ("none", ""):
            stroked_count += 1
        if "stroke" in elem.attrib:
            del elem.attrib["stroke"]
        for k in (
            "stroke-width",
            "stroke-miterlimit",
            "stroke-linecap",
            "stroke-linejoin",
        ):
            elem.attrib.pop(k, None)

        if tag == "path" and "d" in elem.attrib:
            element_count += 1
            scaled_d, pts = _scale_path_d(elem.attrib["d"], PT_TO_MM)
            elem.attrib["d"] = scaled_d
            elem.attrib["fill"] = fill_hex
            if pts:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                bbox = (min(xs), min(ys), max(xs), max(ys))
                if (
                    abs(bbox[0] - 0.0) < 0.01
                    and abs(bbox[1] - 0.0) < 0.01
                    and abs(bbox[2] - width_mm) < 0.01
                    and abs(bbox[3] - height_mm) < 0.01
                ):
                    elem.attrib["id"] = "registration_frame"
                    reg_frame_bbox = bbox
        elif tag in ("polygon", "polyline") and "points" in elem.attrib:
            element_count += 1
            scaled_pts, _ = _scale_points_attr(elem.attrib["points"], PT_TO_MM)
            elem.attrib["points"] = scaled_pts
            elem.attrib["fill"] = fill_hex
        elif tag == "rect":
            element_count += 1
            for attr in ("x", "y", "width", "height", "rx", "ry"):
                if attr in elem.attrib:
                    elem.attrib[attr] = _fmt_mm(float(elem.attrib[attr]) * PT_TO_MM)
            elem.attrib["fill"] = fill_hex
        elif tag == "circle":
            element_count += 1
            for attr in ("cx", "cy", "r"):
                if attr in elem.attrib:
                    elem.attrib[attr] = _fmt_mm(float(elem.attrib[attr]) * PT_TO_MM)
            elem.attrib["fill"] = fill_hex
        elif tag == "ellipse":
            element_count += 1
            for attr in ("cx", "cy", "rx", "ry"):
                if attr in elem.attrib:
                    elem.attrib[attr] = _fmt_mm(float(elem.attrib[attr]) * PT_TO_MM)
            elem.attrib["fill"] = fill_hex

    if text_count > 0:
        raise RuntimeError(f"{raw_svg} still contains {text_count} live text nodes!")
    if stroked_count > 0:
        raise RuntimeError(
            f"{raw_svg} still contains {stroked_count} stroked elements!"
        )
    if reg_frame_bbox is None:
        raise RuntimeError(
            f"{raw_svg} is missing the 0..{width_mm} x 0..{height_mm} mm registration frame!"
        )

    # Remove <title> if present for clean Plain SVG
    for child in list(root):
        if child.tag.split("}")[-1] == "title":
            root.remove(child)

    ET.indent(tree, space="  ")
    tree.write(out_svg, encoding="utf-8", xml_declaration=True)
    return {
        "out_svg": str(out_svg),
        "elements": element_count,
        "text_nodes": text_count,
        "stroked_nodes": stroked_count,
        "registration_bbox_mm": [round(v, 5) for v in reg_frame_bbox],
    }


# =============================================================================
# MORPHOLOGICAL CLEARANCE AUDIT (40 px/mm = 0.025 mm/pixel)
# =============================================================================


def _load_mask_bitmap(path: Path, expected_w: int, expected_h: int) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if img.size != (expected_w, expected_h):
        raise RuntimeError(
            f"Expected audit bitmap {expected_w}x{expected_h}, got {img.size} for {path}"
        )
    arr = np.asarray(img)
    return arr.max(axis=2) > 40


def _dilate_disk(mask: np.ndarray, radius_px: int) -> np.ndarray:
    """Fast binary dilation by circular disk using integer-offset OR shifts."""
    h, w = mask.shape
    out = np.zeros_like(mask)
    r2 = radius_px * radius_px
    for dy in range(-radius_px, radius_px + 1):
        y0_src = max(0, -dy)
        y1_src = min(h, h - dy)
        y0_dst = max(0, dy)
        y1_dst = min(h, h + dy)
        for dx in range(-radius_px, radius_px + 1):
            if dx * dx + dy * dy > r2:
                continue
            x0_src = max(0, -dx)
            x1_src = min(w, w - dx)
            x0_dst = max(0, dx)
            x1_dst = min(w, w + dx)
            out[y0_dst:y1_dst, x0_dst:x1_dst] |= mask[y0_src:y1_src, x0_src:x1_src]
    return out


def _capsule_mask(
    yy: np.ndarray,
    xx: np.ndarray,
    x0: float,
    x1: float,
    y0: float,
    radius_mm: float,
) -> np.ndarray:
    clamped_x = np.clip(xx, x0, x1)
    return (xx - clamped_x) ** 2 + (yy - y0) ** 2 <= radius_mm**2


def run_clearance_audit(spec: dict[str, Any]) -> dict[str, Any]:
    """Run pixel-exact clearance checks across F.SilkS and F.Mask at 40 px/mm."""
    canvas = spec["canvas"]
    width_mm = float(canvas["width_mm"])
    height_mm = float(canvas["height_mm"])

    silks_raw = _load_mask_bitmap(
        OUT_DIR / "_audit_silks.png",
        round(width_mm * AUDIT_PX_PER_MM),
        round(height_mm * AUDIT_PX_PER_MM),
    )
    mask_raw = _load_mask_bitmap(
        OUT_DIR / "_audit_mask.png",
        round(width_mm * AUDIT_PX_PER_MM),
        round(height_mm * AUDIT_PX_PER_MM),
    )

    h_px, w_px = silks_raw.shape
    xs_mm = (np.arange(w_px, dtype=np.float32) + 0.5) / AUDIT_PX_PER_MM
    ys_mm = (np.arange(h_px, dtype=np.float32) + 0.5) / AUDIT_PX_PER_MM
    yy, xx = np.meshgrid(ys_mm, xs_mm, indexing="ij")

    errors: list[str] = []
    metrics: dict[str, Any] = {}

    # 1. Measure minimum F.SilkS <-> F.Mask clearance (require >= 0.20 mm, check exact gap)
    direct_overlap = int(np.count_nonzero(silks_raw & mask_raw))
    min_gap_mm: float | None = None
    for rad_px in range(1, 25):  # up to 0.60 mm
        dilated = _dilate_disk(mask_raw, rad_px)
        hits = int(np.count_nonzero(silks_raw & dilated))
        if hits > 0:
            min_gap_mm = round((rad_px - 1) / AUDIT_PX_PER_MM, 3)
            break
    if min_gap_mm is None:
        min_gap_mm = 0.60
    metrics["silk_to_mask_overlap_px"] = direct_overlap
    metrics["silk_to_mask_min_gap_mm"] = min_gap_mm
    if direct_overlap > 0 or min_gap_mm < 0.20:
        errors.append(
            f"F.SilkS to F.Mask clearance too small: {min_gap_mm} mm (direct overlap {direct_overlap} px)"
        )

    # 2. Edge.Cuts clearance: F.Mask >= 0.60 mm, F.SilkS >= 0.50 mm
    edge_mask_zone = (
        (xx < 0.60) | (xx > width_mm - 0.60) | (yy < 0.60) | (yy > height_mm - 0.60)
    )
    edge_silk_zone = (
        (xx < 0.50) | (xx > width_mm - 0.50) | (yy < 0.50) | (yy > height_mm - 0.50)
    )
    mask_edge_hits = int(np.count_nonzero(mask_raw & edge_mask_zone))
    silk_edge_hits = int(np.count_nonzero(silks_raw & edge_silk_zone))
    metrics["mask_edge_pullback_violations_px"] = mask_edge_hits
    metrics["silk_edge_inset_violations_px"] = silk_edge_hits
    if mask_edge_hits:
        errors.append(f"F.Mask violates 0.60 mm edge pullback ({mask_edge_hits} px)")
    if silk_edge_hits:
        errors.append(f"F.SilkS violates 0.50 mm edge inset ({silk_edge_hits} px)")

    # 3. NPTH mounting slot & M3 washer clearance
    for s in spec["mounting_slots"]:
        ref = s["ref"]
        hx = float(s["local_x"])
        hy = float(s["local_y"])
        sw = float(s["width_mm"])
        sh = float(s["height_mm"])
        x0 = hx - (sw - sh) / 2.0
        x1 = hx + (sw - sh) / 2.0
        washer_zone = _capsule_mask(yy, xx, x0, x1, hy, 3.50)
        m_hits = int(np.count_nonzero(mask_raw & washer_zone))
        s_hits = int(np.count_nonzero(silks_raw & washer_zone))
        metrics[f"{ref}_washer_mask_hits_px"] = m_hits
        metrics[f"{ref}_washer_silk_hits_px"] = s_hits
        if m_hits or s_hits:
            errors.append(
                f"{ref} M3 washer overlap: mask={m_hits} px, silk={s_hits} px"
            )

    # 4. Component drill / NPTH pullback / nut keepout checks
    for comp in spec["components"]:
        ref = comp["ref"]
        cx = float(comp["local_x"])
        cy = float(comp["local_y"])
        drill = float(comp["drill_mm"])
        keepout = float(comp["keepout_mm"])
        dist2 = (xx - cx) ** 2 + (yy - cy) ** 2

        if comp["kind"] == "led_3mm":
            # NPTH pullback: R >= drill/2 + 0.50 = 2.10 mm for F.Mask; bezel R = 2.00 mm for F.SilkS
            npth_zone = dist2 <= (drill / 2.0 + 0.50) ** 2
            bezel_zone = dist2 <= (keepout / 2.0) ** 2
            m_hits = int(np.count_nonzero(mask_raw & npth_zone))
            s_hits = int(np.count_nonzero(silks_raw & bezel_zone))
            metrics["LED1_npth_mask_hits_px"] = m_hits
            metrics["LED1_bezel_silk_hits_px"] = s_hits
            if m_hits:
                errors.append(f"LED1 F.Mask inside 2.10 mm NPTH pullback ({m_hits} px)")
            if s_hits:
                errors.append(
                    f"LED1 F.SilkS inside 2.00 mm bezel keepout ({s_hits} px)"
                )
        else:
            # Drill + 0.25 mm clearance for all components
            drill_zone = dist2 <= (drill / 2.0 + 0.25) ** 2
            m_hits = int(np.count_nonzero(mask_raw & drill_zone))
            s_hits = int(np.count_nonzero(silks_raw & drill_zone))
            if m_hits or s_hits:
                errors.append(
                    f"{ref} hole keepout overlap: mask={m_hits} px, silk={s_hits} px"
                )

            # Switches and jacks must keep artwork strictly outside nut keepouts (8.2 mm / 9.5 mm)
            if comp["kind"] in ("switch_submini", "jack"):
                nut_zone = dist2 <= (keepout / 2.0) ** 2
                nm_hits = int(np.count_nonzero(mask_raw & nut_zone))
                ns_hits = int(np.count_nonzero(silks_raw & nut_zone))
                metrics[f"{ref}_nut_mask_hits_px"] = nm_hits
                metrics[f"{ref}_nut_silk_hits_px"] = ns_hits
                if nm_hits or ns_hits:
                    errors.append(
                        f"{ref} nut keepout ({keepout} mm) overlap: mask={nm_hits} px, silk={ns_hits} px"
                    )

    if errors:
        raise RuntimeError("Clearance audit FAILED:\n  - " + "\n  - ".join(errors))
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build and verify 6HP Eurorack panel SVGs."
    )
    parser.add_argument(
        "--emit-commands",
        type=Path,
        help="Write VectorCraft batch steps JSON to PATH",
    )
    parser.add_argument(
        "--postprocess-verify",
        action="store_true",
        help="Convert exported SVGs to 1:1 mm Plain SVGs and run clearance audit",
    )
    args = parser.parse_args()

    if not args.emit_commands and not args.postprocess_verify:
        parser.error("Pass --emit-commands PATH or --postprocess-verify")

    spec = load_panel_spec()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.emit_commands:
        steps = build_commands(spec)
        args.emit_commands.write_text(json.dumps(steps, indent=2), encoding="utf-8")
        print(f"Wrote {len(steps)} VectorCraft steps to {args.emit_commands}")

    if args.postprocess_verify:
        w_mm = float(spec["canvas"]["width_mm"])
        h_mm = float(spec["canvas"]["height_mm"])

        silks_info = normalize_svg_to_mm(
            OUT_DIR / "front_silkscreen.raw.svg",
            OUT_DIR / "front_silkscreen.svg",
            COLOR_SILK_FAB,
            w_mm,
            h_mm,
        )
        mask_info = normalize_svg_to_mm(
            OUT_DIR / "front_soldermask.raw.svg",
            OUT_DIR / "front_soldermask.svg",
            COLOR_MASK_FAB_GOLD,
            w_mm,
            h_mm,
        )
        metrics = run_clearance_audit(spec)

        # Clean up temporary raw/audit artifacts once verification succeeds
        for tmp_name in (
            "front_silkscreen.raw.svg",
            "front_soldermask.raw.svg",
            "_audit_silks.png",
            "_audit_mask.png",
            "build_steps.json",
        ):
            tmp_path = OUT_DIR / tmp_name
            if tmp_path.exists():
                tmp_path.unlink()

        report = {
            "front_silkscreen": silks_info,
            "front_soldermask": mask_info,
            "clearance_audit": metrics,
        }
        print(json.dumps(report, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
