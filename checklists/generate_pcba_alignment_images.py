#!/opt/homebrew/bin/python3
"""Generate SMD-only 3D Bottom (B.Cu) placement screenshots for JLCPCB PCBA review.

Renders `envelope_follower.kicad_pcb` once at high resolution via `kicad-cli pcb render`
with SMD 3D models enabled and THT/DNP 3D bodies hidden (matching JLCPCB's PCBA 3D
placement viewer), then produces:
  - `images/pcba_alignment/board_overview.png` (full upright board with all 50 SMD labels)
  - `images/pcba_alignment/<REF>.png` (zoomed, rulered, mini-mapped card for each SMD)
"""

from __future__ import annotations

import csv
import json
import math
import os
import pathlib
import re
import subprocess
import tempfile
from dataclasses import dataclass

import cairo

ROOT = pathlib.Path(__file__).resolve().parent.parent
PCB_PATH = ROOT / "envelope_follower.kicad_pcb"
CPL_PATH = ROOT / "manufacturing" / "jlcpcb_cpl.csv"
BOM_PATH = ROOT / "jlcpcb_bom.csv"
OUT_DIR = ROOT / "images" / "pcba_alignment"

KICAD_CLI = pathlib.Path("/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")
KICAD_3D_DIR = "/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels"

# Exact PCB outline origin and dimensions in envelope_follower.kicad_pcb (mm)
BOARD_X0 = 100.0
BOARD_Y0 = 40.0
BOARD_W = 30.0
BOARD_H = 108.0

MASTER_W = 2400
MASTER_H = 7200

# Card geometry (px)
CARD_W = 620
CARD_H = 412
HEADER_H = 38
VX0 = 44
VY0 = 62
VW = 440
VH = 330

# Mini-map geometry (px)
MX0 = 513
MW = 86
MH = 310  # 86 * 3.6 = 309.6
MY0 = 68

# Overview geometry (px)
OV_W = 920
OV_H = 1480
OV_BW = 376
OV_BH = 1354  # 376 * 3.6 = 1353.6
OV_BX0 = (OV_W - OV_BW) // 2
OV_BY0 = 84

# Palette (0..1 RGB)
BG_CANVAS = (22 / 255, 25 / 255, 31 / 255)
BG_HEADER = (28 / 255, 32 / 255, 40 / 255)
BG_VIEWPORT = (24 / 255, 27 / 255, 34 / 255)
BORDER_SUBTLE = (48 / 255, 54 / 255, 66 / 255)
FRAME_LIGHT = (100 / 255, 112 / 255, 130 / 255)
TICK_COLOR = (176 / 255, 184 / 255, 198 / 255)
TEXT_PRIMARY = (238 / 255, 242 / 255, 248 / 255)
TEXT_MUTED = (156 / 255, 166 / 255, 182 / 255)
DARK_HALO = (12 / 255, 14 / 255, 18 / 255)

ACCENT_CRIT = (245 / 255, 158 / 255, 11 / 255)   # Amber (U*, D*)
BRACKET_CRIT = (250 / 255, 204 / 255, 21 / 255)  # Bright yellow
ACCENT_CAP = (56 / 255, 189 / 255, 248 / 255)    # Sky blue (C*)
ACCENT_RES = (52 / 255, 211 / 255, 153 / 255)    # Emerald (R*)
BRACKET_PASSIVE = (34 / 255, 211 / 255, 238 / 255)  # Cyan
EXT_ORANGE = (249 / 255, 115 / 255, 22 / 255)    # Extended SKU badge

FONT_SANS = "Helvetica Neue"
FONT_MONO = "Menlo"


@dataclass
class SMDPart:
    ref: str
    value: str
    footprint: str
    short_pkg: str
    lcsc: str
    jlcpcb_class: str
    back_x: float
    y: float
    rot: float
    pad_min_bx: float
    pad_min_y: float
    pad_max_bx: float
    pad_max_y: float
    p1_bx: float
    p1_y: float


def _short_package(footprint: str) -> str:
    if footprint.startswith("SOIC-14"):
        return "SOIC-14"
    if footprint == "SOT-23":
        return "SOT-23"
    if footprint == "D_SOD-123":
        return "SOD-123"
    for metric in ("0603", "0805", "1206"):
        if metric in footprint:
            return metric
    return footprint


def _part_accent(ref: str) -> tuple[float, float, float]:
    if ref[0] in ("U", "D"):
        return ACCENT_CRIT
    if ref[0] == "C":
        return ACCENT_CAP
    return ACCENT_RES


def _sort_key(part: SMDPart) -> tuple[int, str, int]:
    sec = {"U": 0, "D": 1, "C": 2, "R": 3}.get(part.ref[0], 9)
    num = int(re.sub(r"\D", "", part.ref) or "0")
    return (sec, part.ref[0], num)


def _kicad_to_back(bx: float, by: float) -> tuple[float, float]:
    return BOARD_W - (bx - BOARD_X0), by - BOARD_Y0


def _transform_local_point(
    fx: float, fy: float, fp_rot_deg: float, lx: float, ly: float
) -> tuple[float, float]:
    """Rotate local KiCad footprint coords (CCW in Y-down PCB frame) into board coords."""
    a = math.radians(fp_rot_deg)
    bx = fx + lx * math.cos(a) + ly * math.sin(a)
    by = fy - lx * math.sin(a) + ly * math.cos(a)
    return bx, by


def _extract_footprint_blocks(pcb_text: str) -> list[str]:
    blocks: list[str] = []
    for m in re.finditer(r"\n\t\(footprint \"([^\"]+)\"", pcb_text):
        start = m.start() + 2
        depth = 0
        i = start
        n = len(pcb_text)
        while i < n:
            ch = pcb_text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    blocks.append(pcb_text[start : i + 1])
                    break
            i += 1
    return blocks


def load_smd_parts() -> list[SMDPart]:
    """Load and cross-check all 50 SMD parts from CPL, BOM, and KiCad PCB."""
    cpl_rows: dict[str, dict[str, str]] = {}
    with CPL_PATH.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cpl_rows[row["Designator"].strip()] = row

    bom_by_ref: dict[str, dict[str, str]] = {}
    with BOM_PATH.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for ref in row["Designator"].split(","):
                ref_clean = ref.strip()
                if ref_clean:
                    bom_by_ref[ref_clean] = row

    pcb_text = PCB_PATH.read_text(encoding="utf-8")
    parts: list[SMDPart] = []

    for blk in _extract_footprint_blocks(pcb_text):
        ref_m = re.search(r'\(property "Reference" "([^"]+)"', blk)
        if not ref_m:
            continue
        ref = ref_m.group(1)
        if ref not in cpl_rows:
            continue

        at_m = re.search(r"\n\t\t\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)", blk)
        if not at_m:
            raise RuntimeError(f"Missing (at ...) for footprint {ref}")
        fx = float(at_m.group(1))
        fy = float(at_m.group(2))
        fp_rot = float(at_m.group(3) or 0.0)

        cls_m = re.search(r'\(property "JLCPCB_Class" "([^"]+)"', blk)
        jlcpcb_class = cls_m.group(1) if cls_m else "Basic"

        pad_matches = list(
            re.finditer(
                r'\(pad "([^"]+)" smd [a-z]+(?: \([^)]+\))*\s*'
                r"\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)\s*"
                r"\(size ([\d.-]+) ([\d.-]+)\)",
                blk,
            )
        )
        if not pad_matches:
            raise RuntimeError(f"No SMD pads found for {ref}")

        pad_bxs: list[float] = []
        pad_bys: list[float] = []
        p1_coords: tuple[float, float] | None = None

        for pm in pad_matches:
            pnum = pm.group(1)
            px = float(pm.group(2))
            py = float(pm.group(3))
            pad_rot = float(pm.group(4) or fp_rot)
            sx = float(pm.group(5))
            sy = float(pm.group(6))

            pc_x, pc_y = _transform_local_point(fx, fy, fp_rot, px, py)
            if pnum == "1" or p1_coords is None:
                if pnum == "1":
                    p1_coords = _kicad_to_back(pc_x, pc_y)
                elif p1_coords is None:
                    p1_coords = _kicad_to_back(pc_x, pc_y)

            pa = math.radians(pad_rot)
            ca, sa = math.cos(pa), math.sin(pa)
            for dx in (-sx / 2.0, sx / 2.0):
                for dy in (-sy / 2.0, sy / 2.0):
                    cx = pc_x + dx * ca + dy * sa
                    cy = pc_y - dx * sa + dy * ca
                    cbx, cby = _kicad_to_back(cx, cy)
                    pad_bxs.append(cbx)
                    pad_bys.append(cby)

        back_x, y = _kicad_to_back(fx, fy)
        cpl_row = cpl_rows[ref]
        cpl_bx = BOARD_W - float(cpl_row["Mid X"].replace("mm", ""))
        cpl_y = -float(cpl_row["Mid Y"].replace("mm", ""))
        if math.hypot(back_x - cpl_bx, y - cpl_y) > 0.02:
            raise RuntimeError(
                f"Coordinate mismatch for {ref}: PCB=({back_x:.3f},{y:.3f}) "
                f"vs CPL=({cpl_bx:.3f},{cpl_y:.3f})"
            )

        bom = bom_by_ref[ref]
        parts.append(
            SMDPart(
                ref=ref,
                value=bom["Comment"].strip(),
                footprint=bom["Footprint"].strip(),
                short_pkg=_short_package(bom["Footprint"].strip()),
                lcsc=bom["LCSC Part #"].strip(),
                jlcpcb_class=jlcpcb_class,
                back_x=back_x,
                y=y,
                rot=fp_rot,
                pad_min_bx=min(pad_bxs),
                pad_min_y=min(pad_bys),
                pad_max_bx=max(pad_bxs),
                pad_max_y=max(pad_bys),
                p1_bx=p1_coords[0],
                p1_y=p1_coords[1],
            )
        )

    if len(parts) != len(cpl_rows):
        missing = sorted(set(cpl_rows) - {p.ref for p in parts})
        raise RuntimeError(f"Expected {len(cpl_rows)} SMD parts, missing: {missing}")

    return sorted(parts, key=_sort_key)


def _find_alpha_bbox(surf: cairo.ImageSurface) -> tuple[int, int, int, int]:
    """Return exclusive (x0, y0, x1, y1) bounding box of non-transparent pixels."""
    w = surf.get_width()
    h = surf.get_height()
    stride = surf.get_stride()
    buf = memoryview(surf.get_data())

    min_x, min_y, max_x, max_y = w, h, -1, -1
    for py in range(h):
        alphas = buf[py * stride : py * stride + w * 4][3::4]
        if any(alphas):
            if py < min_y:
                min_y = py
            if py > max_y:
                max_y = py
            for px, a in enumerate(alphas):
                if a > 0:
                    if px < min_x:
                        min_x = px
                    break
            for px in range(w - 1, -1, -1):
                if alphas[px] > 0:
                    if px > max_x:
                        max_x = px
                    break

    if max_x < 0:
        raise RuntimeError("Rendered master PCB image is completely transparent.")
    return min_x, min_y, max_x + 1, max_y + 1


def render_master_smd_board() -> tuple[cairo.ImageSurface, tuple[int, int, int, int]]:
    """Render high-res SMD-only Bottom 3D board via kicad-cli and return surface + bbox."""
    if not KICAD_CLI.exists():
        raise RuntimeError(f"kicad-cli not found at {KICAD_CLI}")

    with tempfile.TemporaryDirectory(prefix="kicad_pcba_cfg_") as tmpdir:
        tmp_path = pathlib.Path(tmpdir)
        cfg_dir = tmp_path / "cfg"
        cfg_dir.mkdir()
        boot_png = tmp_path / "boot.png"
        master_png = tmp_path / "master_bottom.png"

        env = os.environ.copy()
        env["KICAD_CONFIG_HOME"] = str(cfg_dir)
        env["KICAD10_3DMODEL_DIR"] = KICAD_3D_DIR

        # Bootstrap default 10.0/3d_viewer.json
        boot_cmd = [
            str(KICAD_CLI),
            "pcb",
            "render",
            "--side",
            "bottom",
            "--width",
            "100",
            "--height",
            "360",
            "--quality",
            "basic",
            "--output",
            str(boot_png),
            str(PCB_PATH),
        ]
        res = subprocess.run(boot_cmd, env=env, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Bootstrap kicad-cli failed:\n{res.stdout}\n{res.stderr}")

        viewer_cfg = cfg_dir / "10.0" / "3d_viewer.json"
        if not viewer_cfg.exists():
            raise RuntimeError(f"Expected 3D viewer config missing at {viewer_cfg}")

        cfg = json.loads(viewer_cfg.read_text(encoding="utf-8"))
        render = cfg.setdefault("render", {})
        # In KiCad 10, `insert` controls SMD 3D models and `normal` controls THT models.
        render["show_footprints_insert"] = True
        render["show_footprints_normal"] = False
        render["show_footprints_dnp"] = False
        render["show_footprints_virtual"] = False
        render["show_footprints_unspecified"] = False
        render["raytrace_shadows"] = True
        render["raytrace_anti_aliasing"] = True
        render["raytrace_post_processing"] = True
        viewer_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

        master_cmd = [
            str(KICAD_CLI),
            "pcb",
            "render",
            "--side",
            "bottom",
            "--width",
            str(MASTER_W),
            "--height",
            str(MASTER_H),
            "--background",
            "transparent",
            "--quality",
            "user",
            "--output",
            str(master_png),
            str(PCB_PATH),
        ]
        res = subprocess.run(master_cmd, env=env, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Master kicad-cli render failed:\n{res.stdout}\n{res.stderr}")

        surf = cairo.ImageSurface.create_from_png(str(master_png))
        bbox = _find_alpha_bbox(surf)
        bx0, by0, bx1, by1 = bbox
        aspect = (by1 - by0) / max(1, bx1 - bx0)
        if abs(aspect - (BOARD_H / BOARD_W)) > 0.02:
            raise RuntimeError(
                f"Unexpected master PCB aspect ratio {aspect:.4f} (expected 3.6000)"
            )
        print(
            f"Master render OK: {surf.get_width()}x{surf.get_height()} px, "
            f"board bbox=({bx0},{by0})..({bx1},{by1}) [{bx1-bx0}x{by1-by0}], aspect={aspect:.4f}"
        )
        return surf, bbox


def _rounded_rect(
    ctx: cairo.Context, x: float, y: float, w: float, h: float, r: float
) -> None:
    r = min(r, w / 2.0, h / 2.0)
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    ctx.close_path()


def _draw_text(
    ctx: cairo.Context,
    text: str,
    x: float,
    y: float,
    *,
    size: float = 11.0,
    color: tuple[float, float, float] = TEXT_PRIMARY,
    bold: bool = False,
    mono: bool = False,
    align: str = "left",
    halo: bool = False,
) -> tuple[float, float]:
    ctx.save()
    ctx.select_font_face(
        FONT_MONO if mono else FONT_SANS,
        cairo.FONT_SLANT_NORMAL,
        cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL,
    )
    ctx.set_font_size(size)
    ext = ctx.text_extents(text)
    if align == "center":
        tx = x - (ext.x_bearing + ext.width / 2.0)
    elif align == "right":
        tx = x - (ext.x_bearing + ext.width)
    else:
        tx = x - ext.x_bearing
    ctx.move_to(tx, y)
    if halo:
        ctx.text_path(text)
        ctx.set_source_rgba(*DARK_HALO, 0.95)
        ctx.set_line_width(3.2)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke_preserve()
        ctx.set_source_rgb(*color)
        ctx.fill()
    else:
        ctx.set_source_rgb(*color)
        ctx.show_text(text)
    ctx.restore()
    return ext.width, ext.height


def _draw_pill(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    text: str,
    accent: tuple[float, float, float],
    *,
    fill: tuple[float, float, float] = (18, 22, 30),
    font_size: float = 9.5,
    pad_x: float = 6.0,
    height: float = 17.0,
    bold: bool = True,
    align: str = "center",
) -> tuple[float, float, float, float]:
    ctx.save()
    ctx.select_font_face(
        FONT_SANS,
        cairo.FONT_SLANT_NORMAL,
        cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL,
    )
    ctx.set_font_size(font_size)
    ext = ctx.text_extents(text)
    w = ext.width + 2.0 * pad_x
    if align == "left":
        x0 = cx
    elif align == "right":
        x0 = cx - w
    else:
        x0 = cx - w / 2.0
    y0 = cy - height / 2.0

    _rounded_rect(ctx, x0, y0, w, height, height / 2.0)
    ctx.set_source_rgba(fill[0] / 255, fill[1] / 255, fill[2] / 255, 0.94)
    ctx.fill_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(1.2)
    ctx.stroke()

    tx = x0 + pad_x - ext.x_bearing
    ty = cy + ext.height / 2.0 - 0.5
    ctx.move_to(tx, ty)
    ctx.set_source_rgb(*TEXT_PRIMARY)
    ctx.show_text(text)
    ctx.restore()
    return x0, y0, x0 + w, y0 + height


def _draw_pointer(
    ctx: cairo.Context,
    p0: tuple[float, float],
    p1: tuple[float, float],
    accent: tuple[float, float, float],
) -> None:
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.move_to(*p0)
    ctx.line_to(*p1)
    ctx.set_source_rgba(*DARK_HALO, 0.92)
    ctx.set_line_width(3.4)
    ctx.stroke_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(1.5)
    ctx.stroke()

    ctx.arc(p1[0], p1[1], 3.3, 0, 2 * math.pi)
    ctx.set_source_rgba(*DARK_HALO, 0.95)
    ctx.fill()
    ctx.arc(p1[0], p1[1], 2.1, 0, 2 * math.pi)
    ctx.set_source_rgb(*accent)
    ctx.fill()
    ctx.restore()


def _paint_master_region(
    ctx: cairo.Context,
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
    dst_rect: tuple[float, float, float, float],
    crop_mm: tuple[float, float, float, float],
) -> None:
    """Paint exact board-mm region from master_surf into dst_rect (x, y, w, h)."""
    bx0, by0, bx1, by1 = bbox
    dx, dy, dw, dh = dst_rect
    cx0, cy0, cx1, cy1 = crop_mm
    cw = cx1 - cx0
    ch = cy1 - cy0

    mx0 = bx0 + (cx0 / BOARD_W) * (bx1 - bx0)
    my0 = by0 + (cy0 / BOARD_H) * (by1 - by0)
    sx = dw / ((cw / BOARD_W) * (bx1 - bx0))
    sy = dh / ((ch / BOARD_H) * (by1 - by0))

    ctx.save()
    ctx.rectangle(dx, dy, dw, dh)
    ctx.clip()
    ctx.set_source_rgb(*BG_VIEWPORT)
    ctx.paint()
    ctx.translate(dx, dy)
    ctx.scale(sx, sy)
    ctx.translate(-mx0, -my0)
    ctx.set_source_surface(master_surf, 0, 0)
    src = ctx.get_source()
    src.set_filter(cairo.FILTER_BEST)
    src.set_extend(cairo.EXTEND_NONE)
    ctx.paint()
    ctx.restore()


def _deconflict_y(
    targets: list[float], min_gap: float, y_min: float, y_max: float
) -> list[float]:
    """Spread vertically ordered label centers to enforce min_gap without crossing."""
    n = len(targets)
    if n == 0:
        return []
    ys = [max(y_min, min(y_max, y)) for y in targets]
    for _ in range(12):
        # Forward push
        for i in range(1, n):
            if ys[i] < ys[i - 1] + min_gap:
                ys[i] = ys[i - 1] + min_gap
        # Backward push from bottom clamp
        ys[-1] = min(ys[-1], y_max)
        for i in range(n - 2, -1, -1):
            if ys[i] > ys[i + 1] - min_gap:
                ys[i] = ys[i + 1] - min_gap
        ys[0] = max(ys[0], y_min)
        # Gentle relaxation back toward target
        for i in range(n):
            lo = y_min if i == 0 else ys[i - 1] + min_gap
            hi = y_max if i == n - 1 else ys[i + 1] - min_gap
            ys[i] = max(lo, min(hi, 0.5 * ys[i] + 0.5 * targets[i]))
    return ys


def render_overview(
    parts: list[SMDPart],
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render full upright Bottom (B.Cu) 50-SMD labeled placement map."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, OV_W, OV_H)
    ctx = cairo.Context(surf)

    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    # Header band
    ctx.set_source_rgb(*BG_HEADER)
    ctx.rectangle(0, 0, OV_W, 64)
    ctx.fill()
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.move_to(0, 64.5)
    ctx.line_to(OV_W, 64.5)
    ctx.stroke()

    _draw_text(
        ctx,
        "BOTTOM (B.Cu) — 50 SMD PCBA PLACEMENT MAP · 30.0 × 108.0 mm UPRIGHT",
        24,
        28,
        size=15.0,
        bold=True,
    )
    # Legend
    lx = 24.0
    for color, label in (
        (ACCENT_CRIT, "Section A: Polarized / ICs (7)"),
        (ACCENT_CAP, "Section B: Ceramic Caps (10)"),
        (ACCENT_RES, "Section C: Resistors (33)"),
        (EXT_ORANGE, "* Extended SKU"),
    ):
        ctx.arc(lx + 5, 48, 4.5, 0, 2 * math.pi)
        ctx.set_source_rgb(*color)
        ctx.fill()
        w_txt, _ = _draw_text(ctx, label, lx + 14, 52, size=11.0, color=TEXT_MUTED)
        lx += w_txt + 30.0

    # Board render
    _paint_master_region(
        ctx,
        master_surf,
        bbox,
        (OV_BX0, OV_BY0, OV_BW, OV_BH),
        (0.0, 0.0, BOARD_W, BOARD_H),
    )
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.2)
    ctx.rectangle(OV_BX0 - 0.5, OV_BY0 - 0.5, OV_BW + 1.0, OV_BH + 1.0)
    ctx.stroke()

    _draw_text(ctx, "back_X = 0", OV_BX0, OV_BY0 - 6, size=10.0, color=TEXT_MUTED, mono=True)
    _draw_text(
        ctx,
        "back_X = 30 mm",
        OV_BX0 + OV_BW,
        OV_BY0 - 6,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="right",
    )
    _draw_text(
        ctx,
        "Y = 0 (TOP)",
        OV_BX0 + OV_BW / 2,
        OV_BY0 - 6,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "Y = 108 mm (BOTTOM)",
        OV_BX0 + OV_BW / 2,
        OV_BY0 + OV_BH + 16,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )

    # Split symmetrically: 25 left (back_x < 15 plus U1, U2), 25 right (back_x > 15)
    left_parts = sorted(
        [p for p in parts if p.back_x < 15.0 or p.ref in ("U1", "U2")],
        key=lambda p: (p.y, p.back_x),
    )
    right_parts = sorted(
        [p for p in parts if p.back_x > 15.0 and p.ref not in ("U1", "U2")],
        key=lambda p: (p.y, -p.back_x),
    )

    def _to_ov(bx: float, y: float) -> tuple[float, float]:
        return OV_BX0 + (bx / BOARD_W) * OV_BW, OV_BY0 + (y / BOARD_H) * OV_BH

    def _short_val(p: SMDPart) -> str:
        if p.value == "TL074HIDR":
            return "TL074H"
        return p.value

    for side, group in (("left", left_parts), ("right", right_parts)):
        target_ys = [_to_ov(p.back_x, p.y)[1] for p in group]
        pill_ys = _deconflict_y(
            target_ys, min_gap=25.0, y_min=OV_BY0 + 14.0, y_max=OV_BY0 + OV_BH - 14.0
        )
        pill_edge_x = OV_BX0 - 44.0 if side == "left" else OV_BX0 + OV_BW + 44.0

        for idx, (part, py) in enumerate(zip(group, pill_ys)):
            cx, cy = _to_ov(part.back_x, part.y)
            accent = _part_accent(part.ref)
            # Stagger elbow x slightly by row parity so nearby vertical lines separate cleanly
            elbow_offset = 16.0 + (idx % 3) * 7.0
            elbow_x = OV_BX0 - elbow_offset if side == "left" else OV_BX0 + OV_BW + elbow_offset

            # Leader line: pill -> elbow -> component center
            ctx.save()
            ctx.move_to(pill_edge_x, py)
            ctx.line_to(elbow_x, py)
            ctx.line_to(cx, cy)
            ctx.set_source_rgba(*DARK_HALO, 0.85)
            ctx.set_line_width(3.0)
            ctx.stroke_preserve()
            ctx.set_source_rgba(*accent, 0.88)
            ctx.set_line_width(1.3)
            ctx.stroke()

            # Marker dot on component center
            ctx.arc(cx, cy, 3.6, 0, 2 * math.pi)
            ctx.set_source_rgba(*DARK_HALO, 0.95)
            ctx.fill()
            ctx.arc(cx, cy, 2.3, 0, 2 * math.pi)
            ctx.set_source_rgb(*accent)
            ctx.fill()
            ctx.restore()

            ext_star = " *" if part.jlcpcb_class == "Extended" else ""
            label = f"{part.ref} · {_short_val(part)}{ext_star}"
            _draw_pill(
                ctx,
                pill_edge_x,
                py,
                label,
                EXT_ORANGE if part.jlcpcb_class == "Extended" and part.ref[0] == "R" else accent,
                font_size=10.5,
                pad_x=8.0,
                height=20.0,
                align="right" if side == "left" else "left",
            )

    out_path = OUT_DIR / "board_overview.png"
    surf.write_to_png(str(out_path))
    return out_path


def _draw_section_a_callouts(
    ctx: cairo.Context,
    part: SMDPart,
    mm_to_vp: callable,
    pad_box_mm: tuple[float, float, float, float],
) -> None:
    """Add crisp non-obscuring polarity / Pin-1 / lead callouts for Section A parts."""
    bx0_p, by0_p, bx1_p, by1_p = pad_box_mm

    if part.ref == "U1":
        pill_x, pill_y = mm_to_vp(20.9, 89.9)
        target = mm_to_vp(18.65, 87.31)
        _draw_pointer(ctx, (pill_x - 10, pill_y), target, BRACKET_CRIT)
        _draw_pill(
            ctx, pill_x, pill_y, "PIN 1 (BOTTOM-RIGHT)", BRACKET_CRIT, font_size=9.5, height=18.0
        )
    elif part.ref == "U2":
        pill_x, pill_y = mm_to_vp(7.7, 92.2)
        target = mm_to_vp(11.35, 94.69)
        _draw_pointer(ctx, (pill_x + 16, pill_y), target, BRACKET_CRIT)
        _draw_pill(
            ctx, pill_x, pill_y, "PIN 1 (TOP-LEFT)", BRACKET_CRIT, font_size=9.5, height=18.0
        )
    elif part.ref == "D3":
        # 1 pin on left (Pin 3), 2 pins on right (Pin 2 top-right, Pin 1 bottom-right)
        p1_x, p1_y = mm_to_vp(21.2, 77.6)
        _draw_pointer(ctx, (p1_x + 28, p1_y), mm_to_vp(25.30, 79.30), BRACKET_CRIT)
        _draw_pill(
            ctx, p1_x, p1_y, "1 PIN LEFT (Pin 3)", BRACKET_CRIT, font_size=9.2, height=17.0
        )

        p2_x, p2_y = mm_to_vp(20.8, 81.6)
        _draw_pointer(ctx, (p2_x + 32, p2_y), mm_to_vp(27.45, 80.25), BRACKET_CRIT)
        _draw_pill(
            ctx, p2_x, p2_y, "2 PINS RIGHT (Pin 1 BR)", BRACKET_CRIT, font_size=9.2, height=17.0
        )
    elif part.ref in ("D1", "D2", "D5"):
        # Cathode band faces LEFT
        pill_x, pill_y = mm_to_vp(part.back_x - 2.7, part.y - 3.0)
        target = mm_to_vp(part.p1_bx, part.y - 0.55)
        _draw_pointer(ctx, (pill_x + 16, pill_y), target, BRACKET_CRIT)
        _draw_pill(
            ctx, pill_x, pill_y, "CATHODE (LEFT)", BRACKET_CRIT, font_size=9.5, height=18.0
        )
        lx, ly = mm_to_vp(bx0_p - 0.35, part.y + 0.35)
        rx, ry = mm_to_vp(bx1_p + 0.35, part.y + 0.35)
        _draw_text(ctx, "K", lx, ly, size=11.0, color=BRACKET_CRIT, bold=True, align="right", halo=True)
        _draw_text(ctx, "A", rx, ry, size=11.0, color=TEXT_PRIMARY, bold=True, align="left", halo=True)
    elif part.ref == "D4":
        # Cathode band faces RIGHT
        pill_x, pill_y = mm_to_vp(part.back_x + 2.7, part.y - 3.0)
        target = mm_to_vp(part.p1_bx, part.y - 0.55)
        _draw_pointer(ctx, (pill_x - 16, pill_y), target, BRACKET_CRIT)
        _draw_pill(
            ctx, pill_x, pill_y, "CATHODE (RIGHT)", BRACKET_CRIT, font_size=9.5, height=18.0
        )
        lx, ly = mm_to_vp(bx0_p - 0.35, part.y + 0.35)
        rx, ry = mm_to_vp(bx1_p + 0.35, part.y + 0.35)
        _draw_text(ctx, "A", lx, ly, size=11.0, color=TEXT_PRIMARY, bold=True, align="right", halo=True)
        _draw_text(ctx, "K", rx, ry, size=11.0, color=BRACKET_CRIT, bold=True, align="left", halo=True)


def render_part_card(
    part: SMDPart,
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render an individual 620x412 annotated placement verification card."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, CARD_W, CARD_H)
    ctx = cairo.Context(surf)
    accent = _part_accent(part.ref)
    bracket_col = BRACKET_CRIT if part.ref[0] in ("U", "D") else BRACKET_PASSIVE

    # Card background & outer border
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    # Header bar
    ctx.set_source_rgb(*BG_HEADER)
    ctx.rectangle(0, 0, CARD_W, HEADER_H)
    ctx.fill()
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.move_to(0, HEADER_H + 0.5)
    ctx.line_to(CARD_W, HEADER_H + 0.5)
    ctx.stroke()

    # Left header: ref pill + value + package + LCSC + optional EXT pill
    bx0, _, bx1, _ = _draw_pill(
        ctx,
        12.0,
        HEADER_H / 2.0,
        part.ref,
        accent,
        fill=(34, 39, 50),
        font_size=12.0,
        pad_x=9.0,
        height=22.0,
        align="left",
    )
    cur_x = bx1 + 10.0
    w_val, _ = _draw_text(ctx, part.value, cur_x, 24.0, size=13.5, bold=True)
    cur_x += w_val + 8.0
    meta_txt = f"{part.short_pkg} · {part.lcsc}"
    w_meta, _ = _draw_text(ctx, meta_txt, cur_x, 23.5, size=11.0, color=TEXT_MUTED)
    cur_x += w_meta + 8.0
    if part.jlcpcb_class == "Extended":
        _draw_pill(
            ctx,
            cur_x,
            HEADER_H / 2.0,
            "EXT",
            EXT_ORANGE,
            fill=(56, 30, 16),
            font_size=9.0,
            pad_x=6.0,
            height=17.0,
            align="left",
        )

    # Right header: coordinates + KiCad rotation
    coord_txt = f"back=({part.back_x:.2f}, {part.y:.2f}) | Rot {int(round(part.rot))}°"
    _draw_text(
        ctx,
        coord_txt,
        CARD_W - 12.0,
        23.5,
        size=10.5,
        color=TEXT_PRIMARY,
        mono=True,
        align="right",
    )

    # Compute 4:3 crop window (mm)
    if part.ref in ("U1", "U2"):
        crop_w, crop_h, tick_step = 21.0, 15.75, 5.0
        pad_margin = 0.90
    else:
        crop_w, crop_h, tick_step = 14.0, 10.5, 2.0
        pad_margin = 0.65

    cx0 = max(-1.0, min((BOARD_W + 1.0) - crop_w, part.back_x - crop_w / 2.0))
    cy0 = max(-1.0, min((BOARD_H + 1.0) - crop_h, part.y - crop_h / 2.0))
    cx1 = cx0 + crop_w
    cy1 = cy0 + crop_h

    def mm_to_vp(bx: float, y: float) -> tuple[float, float]:
        return (
            VX0 + ((bx - cx0) / crop_w) * VW,
            VY0 + ((y - cy0) / crop_h) * VH,
        )

    # Paint zoomed 3D board crop
    _paint_master_region(ctx, master_surf, bbox, (VX0, VY0, VW, VH), (cx0, cy0, cx1, cy1))

    # Subtle ruler ticks & labels
    _draw_text(ctx, "mm", 8.0, 54.0, size=9.5, color=TEXT_MUTED, mono=True)
    num_x = int(math.ceil(BOARD_W / tick_step)) + 1
    for i in range(num_x):
        tx_mm = round(i * tick_step, 3)
        if tx_mm < cx0 - 1e-6 or tx_mm > cx1 + 1e-6:
            continue
        px, _ = mm_to_vp(tx_mm, cy0)
        ctx.save()
        ctx.set_source_rgb(*TICK_COLOR)
        ctx.set_line_width(1.0)
        ctx.move_to(px, VY0 - 5.0)
        ctx.line_to(px, VY0)
        ctx.stroke()
        ctx.restore()
        lbl = f"{int(tx_mm)}" if float(tx_mm).is_integer() else f"{tx_mm:.1f}"
        _draw_text(
            ctx,
            lbl,
            max(VX0 + 8, min(VX0 + VW - 8, px)),
            VY0 - 8.0,
            size=9.5,
            color=TEXT_MUTED,
            mono=True,
            align="center",
        )

    num_y = int(math.ceil(BOARD_H / tick_step)) + 1
    for i in range(num_y):
        ty_mm = round(i * tick_step, 3)
        if ty_mm < cy0 - 1e-6 or ty_mm > cy1 + 1e-6:
            continue
        _, py = mm_to_vp(cx0, ty_mm)
        ctx.save()
        ctx.set_source_rgb(*TICK_COLOR)
        ctx.set_line_width(1.0)
        ctx.move_to(VX0 - 5.0, py)
        ctx.line_to(VX0, py)
        ctx.stroke()
        ctx.restore()
        lbl = f"{int(ty_mm)}" if float(ty_mm).is_integer() else f"{ty_mm:.1f}"
        _draw_text(
            ctx,
            lbl,
            VX0 - 8.0,
            max(VY0 + 9, min(VY0 + VH - 2, py + 3.5)),
            size=9.5,
            color=TEXT_MUTED,
            mono=True,
            align="right",
        )

    # Non-obscuring target bracket around component pad envelope + margin
    bx0_p = part.pad_min_bx - pad_margin
    by0_p = part.pad_min_y - pad_margin
    bx1_p = part.pad_max_bx + pad_margin
    by1_p = part.pad_max_y + pad_margin
    rx0, ry0 = mm_to_vp(bx0_p, by0_p)
    rx1, ry1 = mm_to_vp(bx1_p, by1_p)

    ctx.save()
    ctx.rectangle(VX0, VY0, VW, VH)
    ctx.clip()

    # Thin dashed perimeter
    ctx.set_dash([4.0, 4.0])
    ctx.set_source_rgba(*bracket_col, 0.55)
    ctx.set_line_width(1.0)
    ctx.rectangle(rx0, ry0, rx1 - rx0, ry1 - ry0)
    ctx.stroke()
    ctx.set_dash([])

    # Crisp L-shaped corner brackets with dark halo
    arm = min(14.0, 0.28 * (rx1 - rx0), 0.28 * (ry1 - ry0))
    arm = max(7.0, arm)
    corners = (
        ((rx0, ry0 + arm), (rx0, ry0), (rx0 + arm, ry0)),
        ((rx1 - arm, ry0), (rx1, ry0), (rx1, ry0 + arm)),
        ((rx0, ry1 - arm), (rx0, ry1), (rx0 + arm, ry1)),
        ((rx1 - arm, ry1), (rx1, ry1), (rx1, ry1 - arm)),
    )
    for p_a, p_b, p_c in corners:
        ctx.move_to(*p_a)
        ctx.line_to(*p_b)
        ctx.line_to(*p_c)
        ctx.set_source_rgba(*DARK_HALO, 0.90)
        ctx.set_line_width(4.0)
        ctx.stroke_preserve()
        ctx.set_source_rgb(*bracket_col)
        ctx.set_line_width(2.2)
        ctx.stroke()

    if part.ref[0] in ("U", "D"):
        _draw_section_a_callouts(ctx, part, mm_to_vp, (bx0_p, by0_p, bx1_p, by1_p))

    ctx.restore()

    # Viewport frame
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.0)
    ctx.rectangle(VX0 - 0.5, VY0 - 0.5, VW + 1.0, VH + 1.0)
    ctx.stroke()

    # Bottom caption under viewport
    caption = (
        f"Direct Bottom (B.Cu) 3D view · {crop_w:.1f} × {crop_h:.2f} mm crop · "
        f"Ticks: {int(tick_step)} mm"
    )
    _draw_text(ctx, caption, VX0, VY0 + VH + 14.0, size=9.5, color=TEXT_MUTED)

    # Right-hand Full-Board Mini-Map
    _draw_text(
        ctx,
        "BOARD MAP",
        MX0 + MW / 2.0,
        52.0,
        size=9.5,
        color=TEXT_MUTED,
        bold=True,
        align="center",
    )
    _draw_text(
        ctx,
        "TOP",
        MX0 + MW / 2.0,
        63.0,
        size=8.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "BOT",
        MX0 + MW / 2.0,
        MY0 + MH + 12.0,
        size=8.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )

    _paint_master_region(
        ctx, master_surf, bbox, (MX0, MY0, MW, MH), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.0)
    ctx.rectangle(MX0 - 0.5, MY0 - 0.5, MW + 1.0, MH + 1.0)
    ctx.stroke()

    # Highlight crop window & component dot on mini-map
    mx_box0 = MX0 + (max(0.0, cx0) / BOARD_W) * MW
    my_box0 = MY0 + (max(0.0, cy0) / BOARD_H) * MH
    mx_box1 = MX0 + (min(BOARD_W, cx1) / BOARD_W) * MW
    my_box1 = MY0 + (min(BOARD_H, cy1) / BOARD_H) * MH

    ctx.save()
    ctx.rectangle(MX0, MY0, MW, MH)
    ctx.clip()
    ctx.rectangle(mx_box0, my_box0, mx_box1 - mx_box0, my_box1 - my_box0)
    ctx.set_source_rgba(*bracket_col, 0.18)
    ctx.fill_preserve()
    ctx.set_source_rgb(*bracket_col)
    ctx.set_line_width(1.8)
    ctx.stroke()

    dot_x = MX0 + (part.back_x / BOARD_W) * MW
    dot_y = MY0 + (part.y / BOARD_H) * MH
    ctx.arc(dot_x, dot_y, 3.2, 0, 2 * math.pi)
    ctx.set_source_rgba(*DARK_HALO, 0.95)
    ctx.fill()
    ctx.arc(dot_x, dot_y, 2.0, 0, 2 * math.pi)
    ctx.set_source_rgb(*bracket_col)
    ctx.fill()
    ctx.restore()

    # Outer card border
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.rectangle(0.5, 0.5, CARD_W - 1.0, CARD_H - 1.0)
    ctx.stroke()

    out_path = OUT_DIR / f"{part.ref}.png"
    surf.write_to_png(str(out_path))
    return out_path


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    parts = load_smd_parts()
    print(f"Loaded {len(parts)} SMD parts from PCB/CPL/BOM.")

    master_surf, bbox = render_master_smd_board()
    overview_path = render_overview(parts, master_surf, bbox)
    print(f"Wrote {overview_path.relative_to(ROOT)}")

    for part in parts:
        render_part_card(part, master_surf, bbox)
    print(f"Wrote {len(parts)} part cards to {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
