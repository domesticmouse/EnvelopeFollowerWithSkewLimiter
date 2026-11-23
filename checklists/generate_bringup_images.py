#!/opt/homebrew/bin/python3
"""Generate 9 annotated main-PCB screenshots for checklists/05-board-bringup.md.

Renders `envelope_follower.kicad_pcb` once per side at high resolution via
`kicad-cli pcb render`:
  - Bottom (`B.Cu`) with SMDs + 7 B.Cu THT parts (`J_PWR`, `C1`–`C2`, `C7`,
    `C11`–`C13`) enabled and DNP test points (`TP1`–`TP12`) hidden so test-point
    rings and silkscreen labels stay crisp.
  - Top (`F.Cu`) bare board (`show_footprints_* = False`) so front silkscreen
    control outlines (`RV1`–`RV4`, `SW1`–`SW2`, `LED1`, `J1`–`J4`, `J_PWR -12V`)
    remain unobstructed and uniform.

Outputs 9 PNGs under `images/board_bringup/`:
  00_test_point_map.png
  01_initial_controls_front.png
  02_phase1_polarity_check.png
  03_phase1_cold_checks.png
  04_phase2_power_up.png
  05_phase3_bias_offset_led.png
  06_phase4_signal_chain.png
  07_phase5_slew_and_timing.png
  08_troubleshooting_hotspots.png
"""

from __future__ import annotations

import json
import math
import os
import pathlib
import re
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass

import cairo

ROOT = pathlib.Path(__file__).resolve().parent.parent
PCB_PATH = ROOT / "envelope_follower.kicad_pcb"
OUT_DIR = ROOT / "images" / "board_bringup"

KICAD_CLI = pathlib.Path("/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")
KICAD_3D_DIR = "/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels"

# Exact PCB outline origin and dimensions in envelope_follower.kicad_pcb (mm)
BOARD_X0 = 100.0
BOARD_Y0 = 40.0
BOARD_W = 30.0
BOARD_H = 108.0

MASTER_W = 2400
MASTER_H = 7200

# Palette (0..1 RGB) — aligned with generate_pcba_alignment_images.py
BG_CANVAS = (22 / 255, 25 / 255, 31 / 255)
BG_HEADER = (28 / 255, 32 / 255, 40 / 255)
BG_CARD = (30 / 255, 35 / 255, 44 / 255)
BG_VIEWPORT = (24 / 255, 27 / 255, 34 / 255)
BORDER_SUBTLE = (48 / 255, 54 / 255, 66 / 255)
FRAME_LIGHT = (100 / 255, 112 / 255, 130 / 255)
TICK_COLOR = (176 / 255, 184 / 255, 198 / 255)
TEXT_PRIMARY = (238 / 255, 242 / 255, 248 / 255)
TEXT_MUTED = (156 / 255, 166 / 255, 182 / 255)
DARK_HALO = (12 / 255, 14 / 255, 18 / 255)

# Semantic accents (0..1 RGB)
RED_POS = (239 / 255, 68 / 255, 68 / 255)  # +12V / Red DMM probe / Abort / Red LED
BLUE_NEG = (96 / 255, 165 / 255, 250 / 255)  # -12V rail
SLATE_GND = (148 / 255, 163 / 255, 184 / 255)  # GND / Black DMM probe
AMBER_POL = (245 / 255, 158 / 255, 11 / 255)  # Polarity / Pin-1 / Thermal
YELLOW_HL = (250 / 255, 204 / 255, 21 / 255)  # High-contrast polarity highlight
EMERALD_SIG = (52 / 255, 211 / 255, 153 / 255)  # Audio signal / Green LED
CYAN_CTL = (
    56 / 255,
    189 / 255,
    248 / 255,
)  # Envelope / Scope / Controls / GND continuity
PURPLE_HIZ = (192 / 255, 132 / 255, 252 / 255)  # High-Z IPA / Timing caps / Switches
ORANGE_OUT = (249 / 255, 115 / 255, 22 / 255)  # Outputs / Troubleshooting

FONT_SANS = "Helvetica Neue"
FONT_MONO = "Menlo"


@dataclass
class PadInfo:
    num: str
    back_x: float
    front_x: float
    y: float
    min_bx: float
    max_bx: float
    min_y: float
    max_y: float


@dataclass
class FootprintInfo:
    ref: str
    value: str
    layer: str
    back_x: float
    front_x: float
    y: float
    rot: float
    pads: dict[str, list[PadInfo]]

    def pad(self, num: str, idx: int = 0) -> PadInfo:
        return self.pads[num][idx]


def _kicad_to_back(bx: float, by: float) -> tuple[float, float]:
    return BOARD_W - (bx - BOARD_X0), by - BOARD_Y0


def _kicad_to_front(bx: float, by: float) -> tuple[float, float]:
    return bx - BOARD_X0, by - BOARD_Y0


def _transform_local_point(
    fx: float, fy: float, fp_rot_deg: float, lx: float, ly: float
) -> tuple[float, float]:
    a = math.radians(fp_rot_deg)
    bx = fx + lx * math.cos(a) + ly * math.sin(a)
    by = fy - lx * math.sin(a) + ly * math.cos(a)
    return bx, by


def _extract_blocks(text: str, prefix_regex: str) -> list[str]:
    blocks: list[str] = []
    for m in re.finditer(prefix_regex, text):
        start = m.start()
        while text[start] != "(":
            start += 1
        depth = 0
        i = start
        n = len(text)
        while i < n:
            ch = text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    blocks.append(text[start : i + 1])
                    break
            i += 1
    return blocks


def load_pcb_footprints() -> dict[str, FootprintInfo]:
    """Parse exact footprint and pad coordinates from envelope_follower.kicad_pcb."""
    pcb_text = PCB_PATH.read_text(encoding="utf-8")
    fps: dict[str, FootprintInfo] = {}

    for blk in _extract_blocks(pcb_text, r"\n\t\(footprint \""):
        ref_m = re.search(r'\(property "Reference" "([^"]+)"', blk)
        if not ref_m:
            continue
        ref = ref_m.group(1)
        val_m = re.search(r'\(property "Value" "([^"]+)"', blk)
        lay_m = re.search(r'\(layer "([^"]+)"\)', blk)
        at_m = re.search(r"\n\t\t\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)", blk)
        if not at_m:
            continue
        fx = float(at_m.group(1))
        fy = float(at_m.group(2))
        frot = float(at_m.group(3) or 0.0)

        pads: dict[str, list[PadInfo]] = {}
        for pblk in _extract_blocks(blk, r"\n\t\t\(pad \""):
            pm = re.search(r'\(pad "([^"]*)" \S+ \S+', pblk)
            pat = re.search(r"\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)", pblk)
            psz = re.search(r"\(size ([\d.-]+) ([\d.-]+)\)", pblk)
            if not pm or not pat or not psz:
                continue
            pnum = pm.group(1)
            px, py = float(pat.group(1)), float(pat.group(2))
            pad_rot = float(pat.group(3) or frot)
            sx, sy = float(psz.group(1)), float(psz.group(2))

            gx, gy = _transform_local_point(fx, fy, frot, px, py)
            cbx, cy = _kicad_to_back(gx, gy)
            cfx, _ = _kicad_to_front(gx, gy)

            pa = math.radians(pad_rot)
            ca, sa = math.cos(pa), math.sin(pa)
            bxs: list[float] = []
            bys: list[float] = []
            for dx in (-sx / 2.0, sx / 2.0):
                for dy in (-sy / 2.0, sy / 2.0):
                    cx = gx + dx * ca + dy * sa
                    cy_k = gy - dx * sa + dy * ca
                    kbx, kby = _kicad_to_back(cx, cy_k)
                    bxs.append(kbx)
                    bys.append(kby)

            pads.setdefault(pnum, []).append(
                PadInfo(
                    num=pnum,
                    back_x=cbx,
                    front_x=cfx,
                    y=cy,
                    min_bx=min(bxs),
                    max_bx=max(bxs),
                    min_y=min(bys),
                    max_y=max(bys),
                )
            )

        bx, by = _kicad_to_back(fx, fy)
        front_x, _ = _kicad_to_front(fx, fy)
        fps[ref] = FootprintInfo(
            ref=ref,
            value=val_m.group(1) if val_m else "",
            layer=lay_m.group(1) if lay_m else "",
            back_x=bx,
            front_x=front_x,
            y=by,
            rot=frot,
            pads=pads,
        )
    return fps


def _find_alpha_bbox(
    surf: cairo.ImageSurface, alpha_thresh: int = 250
) -> tuple[int, int, int, int]:
    """Return exclusive (x0, y0, x1, y1) bbox of solid substrate pixels.

    Uses alpha >= 250 so soft drop-shadows cast by tall B.Cu THT bodies
    (J_PWR, C7, C1/C2) do not skew the board bounding box.
    """
    w = surf.get_width()
    h = surf.get_height()
    stride = surf.get_stride()
    buf = memoryview(surf.get_data())

    min_x, min_y, max_x, max_y = w, h, -1, -1
    for py in range(h):
        alphas = buf[py * stride : py * stride + w * 4][3::4]
        if any(a >= alpha_thresh for a in alphas):
            min_y = min(min_y, py)
            max_y = max(max_y, py)
            for px, a in enumerate(alphas):
                if a >= alpha_thresh:
                    min_x = min(min_x, px)
                    break
            for px in range(w - 1, -1, -1):
                if alphas[px] >= alpha_thresh:
                    max_x = max(max_x, px)
                    break

    if max_x < 0:
        raise RuntimeError("Rendered master PCB image contains no opaque pixels.")
    return min_x, min_y, max_x + 1, max_y + 1


def render_master_boards() -> tuple[
    cairo.ImageSurface,
    tuple[int, int, int, int],
    cairo.ImageSurface,
    tuple[int, int, int, int],
]:
    """Render high-res assembled Bottom (B.Cu) and bare Top (F.Cu) 3D surfaces."""
    if not KICAD_CLI.exists():
        raise RuntimeError(f"kicad-cli not found at {KICAD_CLI}")

    with tempfile.TemporaryDirectory(prefix="kicad_bringup_") as tmpdir:
        tmp_path = pathlib.Path(tmpdir)
        cfg_dir = tmp_path / "cfg"
        cfg_dir.mkdir()
        boot_png = tmp_path / "boot.png"
        bot_png = tmp_path / "master_bottom.png"
        top_png = tmp_path / "master_top.png"

        env = os.environ.copy()
        env["KICAD_CONFIG_HOME"] = str(cfg_dir)
        env["KICAD10_3DMODEL_DIR"] = KICAD_3D_DIR

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
        res = subprocess.run(
            boot_cmd, env=env, capture_output=True, text=True, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(
                f"Bootstrap kicad-cli failed:\n{res.stdout}\n{res.stderr}"
            )

        viewer_cfg = cfg_dir / "10.0" / "3d_viewer.json"
        if not viewer_cfg.exists():
            raise RuntimeError(f"Missing bootstrapped 3d_viewer.json at {viewer_cfg}")

        # 1) Assembled Bottom (B.Cu): SMDs + THT bodies ON, DNP test-point pins OFF
        cfg = json.loads(viewer_cfg.read_text(encoding="utf-8"))
        render = cfg.setdefault("render", {})
        render["show_footprints_insert"] = True
        render["show_footprints_normal"] = True
        render["show_footprints_dnp"] = False
        render["show_footprints_virtual"] = False
        render["show_footprints_unspecified"] = False
        render["raytrace_shadows"] = True
        render["raytrace_anti_aliasing"] = True
        render["raytrace_post_processing"] = True
        viewer_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

        bot_cmd = [
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
            str(bot_png),
            str(PCB_PATH),
        ]
        res = subprocess.run(
            bot_cmd, env=env, capture_output=True, text=True, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Bottom render failed:\n{res.stdout}\n{res.stderr}")

        # 2) Bare Top (F.Cu): hide 3D models so only silkscreen/pads/copper render cleanly
        render["show_footprints_insert"] = False
        render["show_footprints_normal"] = False
        render["show_footprints_dnp"] = False
        viewer_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

        top_cmd = [
            str(KICAD_CLI),
            "pcb",
            "render",
            "--side",
            "top",
            "--width",
            str(MASTER_W),
            "--height",
            str(MASTER_H),
            "--background",
            "transparent",
            "--quality",
            "user",
            "--output",
            str(top_png),
            str(PCB_PATH),
        ]
        res = subprocess.run(
            top_cmd, env=env, capture_output=True, text=True, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Top render failed:\n{res.stdout}\n{res.stderr}")

        bot_surf = cairo.ImageSurface.create_from_png(str(bot_png))
        bot_bbox = _find_alpha_bbox(bot_surf, alpha_thresh=250)
        bot_aspect = (bot_bbox[3] - bot_bbox[1]) / max(1, bot_bbox[2] - bot_bbox[0])
        if abs(bot_aspect - (BOARD_H / BOARD_W)) > 0.02:
            raise RuntimeError(f"Unexpected bottom aspect ratio {bot_aspect:.4f}")

        top_surf = cairo.ImageSurface.create_from_png(str(top_png))
        top_bbox = _find_alpha_bbox(top_surf, alpha_thresh=250)
        top_aspect = (top_bbox[3] - top_bbox[1]) / max(1, top_bbox[2] - top_bbox[0])
        if abs(top_aspect - (BOARD_H / BOARD_W)) > 0.02:
            raise RuntimeError(f"Unexpected top aspect ratio {top_aspect:.4f}")

        print(
            f"Master Bottom OK: {bot_bbox} [{bot_bbox[2] - bot_bbox[0]}x{bot_bbox[3] - bot_bbox[1]}], "
            f"aspect={bot_aspect:.4f}"
        )
        print(
            f"Master Top    OK: {top_bbox} [{top_bbox[2] - top_bbox[0]}x{top_bbox[3] - top_bbox[1]}], "
            f"aspect={top_aspect:.4f}"
        )
        return bot_surf, bot_bbox, top_surf, top_bbox


# ---------------------------------------------------------------------------
# Cairo Drawing Primitives
# ---------------------------------------------------------------------------


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
        ctx.set_source_rgba(*DARK_HALO, 0.96)
        ctx.set_line_width(3.4)
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
    fill: tuple[float, float, float] = (18 / 255, 22 / 255, 30 / 255),
    text_color: tuple[float, float, float] = TEXT_PRIMARY,
    font_size: float = 10.0,
    pad_x: float = 7.0,
    height: float = 18.0,
    bold: bool = True,
    mono: bool = False,
    align: str = "center",
) -> tuple[float, float, float, float]:
    ctx.save()
    ctx.select_font_face(
        FONT_MONO if mono else FONT_SANS,
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
    ctx.set_source_rgba(fill[0], fill[1], fill[2], 0.94)
    ctx.fill_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(1.3)
    ctx.stroke()

    tx = x0 + pad_x - ext.x_bearing
    ty = cy + ext.height / 2.0 - 0.5
    ctx.move_to(tx, ty)
    ctx.set_source_rgb(*text_color)
    ctx.show_text(text)
    ctx.restore()
    return x0, y0, x0 + w, y0 + height


def _draw_badge(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    label: str,
    accent: tuple[float, float, float],
    *,
    r: float = 10.0,
    font_size: float = 11.0,
) -> None:
    ctx.save()
    ctx.new_path()
    ctx.arc(cx, cy, r + 1.8, 0, 2 * math.pi)
    ctx.set_source_rgba(*DARK_HALO, 0.95)
    ctx.fill()
    ctx.new_path()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.set_source_rgb(*accent)
    ctx.fill()
    ctx.restore()
    _draw_text(
        ctx,
        label,
        cx,
        cy + font_size * 0.35,
        size=font_size,
        color=DARK_HALO,
        bold=True,
        align="center",
    )


def _draw_target_ring(
    ctx: cairo.Context,
    x: float,
    y: float,
    r: float,
    accent: tuple[float, float, float],
    *,
    fill_alpha: float = 0.0,
    width: float = 2.0,
) -> None:
    ctx.save()
    ctx.new_path()
    ctx.arc(x, y, r, 0, 2 * math.pi)
    if fill_alpha > 0.0:
        ctx.set_source_rgba(*accent, fill_alpha)
        ctx.fill_preserve()
    ctx.set_source_rgba(*DARK_HALO, 0.94)
    ctx.set_line_width(width + 2.2)
    ctx.stroke_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(width)
    ctx.stroke()
    ctx.restore()


def _draw_bracket_box(
    ctx: cairo.Context,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    accent: tuple[float, float, float],
    *,
    fill_alpha: float = 0.08,
    dashed: bool = True,
) -> None:
    ctx.save()
    ctx.new_path()
    if fill_alpha > 0.0:
        ctx.rectangle(x0, y0, x1 - x0, y1 - y0)
        ctx.set_source_rgba(*accent, fill_alpha)
        ctx.fill()
    if dashed:
        ctx.set_dash([4.0, 3.5])
        ctx.set_source_rgba(*accent, 0.65)
        ctx.set_line_width(1.1)
        ctx.rectangle(x0, y0, x1 - x0, y1 - y0)
        ctx.stroke()
        ctx.set_dash([])
    arm = max(6.0, min(13.0, 0.32 * (x1 - x0), 0.32 * (y1 - y0)))
    corners = (
        ((x0, y0 + arm), (x0, y0), (x0 + arm, y0)),
        ((x1 - arm, y0), (x1, y0), (x1, y0 + arm)),
        ((x0, y1 - arm), (x0, y1), (x0 + arm, y1)),
        ((x1 - arm, y1), (x1, y1), (x1, y1 - arm)),
    )
    for pa, pb, pc in corners:
        ctx.move_to(*pa)
        ctx.line_to(*pb)
        ctx.line_to(*pc)
        ctx.set_source_rgba(*DARK_HALO, 0.92)
        ctx.set_line_width(3.8)
        ctx.stroke_preserve()
        ctx.set_source_rgb(*accent)
        ctx.set_line_width(2.0)
        ctx.stroke()
    ctx.restore()


def _draw_leader(
    ctx: cairo.Context,
    pts: list[tuple[float, float]],
    accent: tuple[float, float, float],
    *,
    dot_end: bool = True,
    width: float = 1.6,
    alpha: float = 0.95,
) -> None:
    if len(pts) < 2:
        return
    ctx.save()
    ctx.new_path()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.move_to(*pts[0])
    for p in pts[1:]:
        ctx.line_to(*p)
    ctx.set_source_rgba(*DARK_HALO, 0.92)
    ctx.set_line_width(width + 2.0)
    ctx.stroke_preserve()
    ctx.set_source_rgba(*accent, alpha)
    ctx.set_line_width(width)
    ctx.stroke()
    if dot_end:
        ex, ey = pts[-1]
        ctx.new_path()
        ctx.arc(ex, ey, 3.6, 0, 2 * math.pi)
        ctx.set_source_rgba(*DARK_HALO, 0.95)
        ctx.fill()
        ctx.new_path()
        ctx.arc(ex, ey, 2.3, 0, 2 * math.pi)
        ctx.set_source_rgb(*accent)
        ctx.fill()
    ctx.restore()


def _draw_arrow(
    ctx: cairo.Context,
    p0: tuple[float, float],
    p1: tuple[float, float],
    accent: tuple[float, float, float],
    *,
    width: float = 1.8,
    head_len: float = 7.5,
) -> None:
    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]
    ang = math.atan2(dy, dx)
    hx1 = p1[0] - head_len * math.cos(ang - 0.45)
    hy1 = p1[1] - head_len * math.sin(ang - 0.45)
    hx2 = p1[0] - head_len * math.cos(ang + 0.45)
    hy2 = p1[1] - head_len * math.sin(ang + 0.45)

    ctx.save()
    ctx.new_path()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.move_to(*p0)
    ctx.line_to(*p1)
    ctx.set_source_rgba(*DARK_HALO, 0.92)
    ctx.set_line_width(width + 2.0)
    ctx.stroke_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(width)
    ctx.stroke()

    ctx.new_path()
    ctx.move_to(*p1)
    ctx.line_to(hx1, hy1)
    ctx.line_to(hx2, hy2)
    ctx.close_path()
    ctx.set_source_rgba(*DARK_HALO, 0.92)
    ctx.set_line_width(2.0)
    ctx.stroke_preserve()
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


def _draw_viewport_rulers(
    ctx: cairo.Context,
    rect: tuple[float, float, float, float],
    crop_mm: tuple[float, float, float, float],
    tick_step: float,
    *,
    unit_label: bool = True,
) -> Callable[[float, float], tuple[float, float]]:
    vx0, vy0, vw, vh = rect
    cx0, cy0, cx1, cy1 = crop_mm
    cw = cx1 - cx0
    ch = cy1 - cy0

    def mm_to_vp(x_mm: float, y_mm: float) -> tuple[float, float]:
        return vx0 + ((x_mm - cx0) / cw) * vw, vy0 + ((y_mm - cy0) / ch) * vh

    if unit_label:
        _draw_text(
            ctx, "mm", vx0 - 24.0, vy0 - 8.0, size=9.0, color=TEXT_MUTED, mono=True
        )

    # X ticks
    i_start = math.floor(cx0 / tick_step)
    i_end = math.ceil(cx1 / tick_step)
    for i in range(i_start, i_end + 1):
        tx_mm = round(i * tick_step, 3)
        if tx_mm < -0.01 or tx_mm > BOARD_W + 0.01:
            continue
        if tx_mm < cx0 + 0.35 or tx_mm > cx1 - 0.35:
            continue
        px, _ = mm_to_vp(tx_mm, cy0)
        ctx.save()
        ctx.set_source_rgb(*TICK_COLOR)
        ctx.set_line_width(1.0)
        ctx.move_to(px, vy0 - 4.5)
        ctx.line_to(px, vy0)
        ctx.stroke()
        ctx.restore()
        lbl = f"{int(tx_mm)}" if float(tx_mm).is_integer() else f"{tx_mm:.1f}"
        _draw_text(
            ctx,
            lbl,
            max(vx0 + 8, min(vx0 + vw - 8, px)),
            vy0 - 7.5,
            size=9.0,
            color=TEXT_MUTED,
            mono=True,
            align="center",
        )

    # Y ticks
    j_start = math.floor(cy0 / tick_step)
    j_end = math.ceil(cy1 / tick_step)
    for j in range(j_start, j_end + 1):
        ty_mm = round(j * tick_step, 3)
        if ty_mm < -0.01 or ty_mm > BOARD_H + 0.01:
            continue
        if ty_mm < cy0 + 0.35 or ty_mm > cy1 - 0.35:
            continue
        _, py = mm_to_vp(cx0, ty_mm)
        ctx.save()
        ctx.set_source_rgb(*TICK_COLOR)
        ctx.set_line_width(1.0)
        ctx.move_to(vx0 - 4.5, py)
        ctx.line_to(vx0, py)
        ctx.stroke()
        ctx.restore()
        lbl = f"{int(ty_mm)}" if float(ty_mm).is_integer() else f"{ty_mm:.1f}"
        _draw_text(
            ctx,
            lbl,
            vx0 - 7.0,
            max(vy0 + 8, min(vy0 + vh - 2, py + 3.2)),
            size=9.0,
            color=TEXT_MUTED,
            mono=True,
            align="right",
        )

    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.1)
    ctx.rectangle(vx0 - 0.5, vy0 - 0.5, vw + 1.0, vh + 1.0)
    ctx.stroke()
    ctx.restore()
    return mm_to_vp


def _draw_minimap(
    ctx: cairo.Context,
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
    mx0: float,
    my0: float,
    mw: float,
    crops: list[tuple[tuple[float, float, float, float], tuple[float, float, float]]],
    *,
    dots: list[tuple[float, float, tuple[float, float, float]]] | None = None,
) -> None:
    mh = mw * (BOARD_H / BOARD_W)
    _draw_text(
        ctx,
        "BOARD MAP",
        mx0 + mw / 2.0,
        my0 - 20.0,
        size=9.5,
        color=TEXT_MUTED,
        bold=True,
        align="center",
    )
    _draw_text(
        ctx,
        "TOP",
        mx0 + mw / 2.0,
        my0 - 6.0,
        size=8.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "BOT",
        mx0 + mw / 2.0,
        my0 + mh + 13.0,
        size=8.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _paint_master_region(
        ctx, master_surf, bbox, (mx0, my0, mw, mh), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.0)
    ctx.rectangle(mx0 - 0.5, my0 - 0.5, mw + 1.0, mh + 1.0)
    ctx.stroke()

    ctx.rectangle(mx0, my0, mw, mh)
    ctx.clip()
    for (cx0, cy0, cx1, cy1), col in crops:
        rx0 = mx0 + (max(0.0, cx0) / BOARD_W) * mw
        ry0 = my0 + (max(0.0, cy0) / BOARD_H) * mh
        rx1 = mx0 + (min(BOARD_W, cx1) / BOARD_W) * mw
        ry1 = my0 + (min(BOARD_H, cy1) / BOARD_H) * mh
        ctx.rectangle(rx0, ry0, rx1 - rx0, ry1 - ry0)
        ctx.set_source_rgba(*col, 0.16)
        ctx.fill_preserve()
        ctx.set_source_rgb(*col)
        ctx.set_line_width(1.7)
        ctx.stroke()

    if dots:
        for bx, by, col in dots:
            dx = mx0 + (bx / BOARD_W) * mw
            dy = my0 + (by / BOARD_H) * mh
            ctx.new_path()
            ctx.arc(dx, dy, 3.8, 0, 2 * math.pi)
            ctx.set_source_rgba(*DARK_HALO, 0.95)
            ctx.fill()
            ctx.new_path()
            ctx.arc(dx, dy, 2.5, 0, 2 * math.pi)
            ctx.set_source_rgb(*col)
            ctx.fill()
    ctx.restore()


def _draw_header(
    ctx: cairo.Context,
    width: int,
    title: str,
    legend: list[tuple[tuple[float, float, float], str]] | None = None,
    *,
    header_h: float = 64.0,
) -> None:
    ctx.save()
    ctx.new_path()
    ctx.set_source_rgb(*BG_HEADER)
    ctx.rectangle(0, 0, width, header_h)
    ctx.fill()
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.move_to(0, header_h + 0.5)
    ctx.line_to(width, header_h + 0.5)
    ctx.stroke()
    ctx.restore()

    _draw_text(ctx, title, 22, 27, size=15.0, bold=True)
    if legend:
        lx = 22.0
        for col, lbl in legend:
            ctx.save()
            ctx.new_path()
            ctx.arc(lx + 4.5, 47.0, 4.3, 0, 2 * math.pi)
            ctx.set_source_rgb(*col)
            ctx.fill()
            ctx.restore()
            w_txt, _ = _draw_text(
                ctx, lbl, lx + 13.0, 51.0, size=10.8, color=TEXT_MUTED
            )
            lx += w_txt + 24.0


def _draw_card_box(
    ctx: cairo.Context,
    x: float,
    y: float,
    w: float,
    h: float,
    accent: tuple[float, float, float],
    *,
    fill: tuple[float, float, float] = BG_CARD,
    r: float = 8.0,
    line_width: float = 1.3,
) -> None:
    ctx.save()
    _rounded_rect(ctx, x, y, w, h, r)
    ctx.set_source_rgb(*fill)
    ctx.fill_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(line_width)
    ctx.stroke()
    ctx.restore()


def _finish_surface(
    surf: cairo.ImageSurface, ctx: cairo.Context, w: int, h: int, name: str
) -> pathlib.Path:
    ctx.save()
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.rectangle(0.5, 0.5, w - 1.0, h - 1.0)
    ctx.stroke()
    ctx.restore()
    out_path = OUT_DIR / name
    surf.write_to_png(str(out_path))
    print(f"Wrote {out_path.relative_to(ROOT)} ({w}x{h})")
    return out_path


# ---------------------------------------------------------------------------
# Figure 00 — Test Point Map (TP1–TP12)
# ---------------------------------------------------------------------------


def render_00_test_point_map(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 980, 1340
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "B.Cu TEST POINT MAP (TP1–TP12) · 30.0 × 108.0 mm ASSEMBLED MAIN PCB",
        [
            (RED_POS, "+12V Rail"),
            (BLUE_NEG, "-12V Rail"),
            (SLATE_GND, "GND Clips"),
            (EMERALD_SIG, "Input / Rectifier"),
            (CYAN_CTL, "Skew / Envelope"),
            (ORANGE_OUT, "Offset / Outputs"),
        ],
    )

    BX0, BY0, BW, BH = 250.0, 160.0, 300.0, 1080.0
    _paint_master_region(
        ctx, bot_surf, bot_bbox, (BX0, BY0, BW, BH), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.2)
    ctx.rectangle(BX0 - 0.5, BY0 - 0.5, BW + 1.0, BH + 1.0)
    ctx.stroke()
    ctx.restore()

    def to_px(bx: float, y: float) -> tuple[float, float]:
        return BX0 + (bx / BOARD_W) * BW, BY0 + (y / BOARD_H) * BH

    _draw_text(ctx, "back_X = 0", BX0, BY0 - 6, size=10.0, color=TEXT_MUTED, mono=True)
    _draw_text(
        ctx,
        "Y = 0 (TOP)",
        BX0 + BW / 2,
        BY0 - 6,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "back_X = 30",
        BX0 + BW,
        BY0 - 6,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="right",
    )
    _draw_text(
        ctx,
        "Y = 108 mm (BOTTOM)",
        BX0 + BW / 2,
        BY0 + BH + 18,
        size=10.0,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )

    # Top rail test points TP2 (+12V) & TP3 (-12V) cleanly above top edge
    tp2 = fps["TP2"]
    tp3 = fps["TP3"]
    p_tp2 = to_px(tp2.back_x, tp2.y)
    p_tp3 = to_px(tp3.back_x, tp3.y)
    _draw_target_ring(ctx, *p_tp2, 9.5, RED_POS, width=2.2)
    _draw_target_ring(ctx, *p_tp3, 9.5, BLUE_NEG, width=2.2)

    _draw_leader(ctx, [(BX0 + 50, 108), (p_tp2[0] - 8, 108), p_tp2], RED_POS)
    _draw_pill(
        ctx,
        BX0 + 50,
        108,
        "TP2 (+12V) · +11.54 V rail",
        RED_POS,
        align="right",
        font_size=10.5,
        height=22,
    )

    _draw_leader(ctx, [(BX0 + BW - 50, 108), (p_tp3[0] + 8, 108), p_tp3], BLUE_NEG)
    _draw_pill(
        ctx,
        BX0 + BW - 50,
        108,
        "TP3 (-12V) · −11.54 V rail",
        BLUE_NEG,
        align="left",
        font_size=10.5,
        height=22,
    )

    # Left margin muted landmarks for instant physical orientation
    landmarks = [
        (
            "J_PWR (10-pin)",
            "Red stripe -12V @ bottom",
            fps["J_PWR"].back_x - 2.2,
            13.0,
            265,
        ),
        ("C1 / C2 (47 uF)", "Opposite polarities", 5.2, 31.7, 455),
        ("C11–C13 (Box film)", "470 nF + 2× 2.2 µF", 5.2, 51.0, 650),
        ("SW2 / J2 / J4", "Right panel column (B.Cu)", 7.5, 82.0, 960),
        ("U1 / U2 (TL074H)", "Op-amps · Pin 1 opp. 180°", 12.2, 91.0, 1095),
    ]
    for title_l, sub_l, lbx, ly, card_cy in landmarks:
        px, py = to_px(lbx, ly)
        _draw_leader(
            ctx,
            [(205.0, card_cy), (232.0, card_cy), (px, py)],
            FRAME_LIGHT,
            width=1.2,
            alpha=0.8,
        )
        _draw_card_box(
            ctx, 20.0, card_cy - 22.0, 185.0, 44.0, BORDER_SUBTLE, fill=BG_HEADER, r=6.0
        )
        _draw_text(
            ctx, title_l, 30.0, card_cy - 3.0, size=10.5, color=TEXT_PRIMARY, bold=True
        )
        _draw_text(ctx, sub_l, 30.0, card_cy + 13.0, size=9.5, color=TEXT_MUTED)

    # Right column: TP12 + TP4..TP8 + TP1 (10 evenly spaced rich TP cards)
    tp_cards = [
        ("TP12", "GND2", "Upper scope GND clip", "(26.8, 2.5)", SLATE_GND),
        ("TP4", "PRE", "U1A ×2.00 preamp (±10 V max)", "(26.8, 20.0)", EMERALD_SIG),
        (
            "TP9",
            "HWR",
            "U1B / D3 neg. half-wave (0..-5 V)",
            "(26.8, 26.5)",
            EMERALD_SIG,
        ),
        ("TP5", "RECT", "U1C FWR (0..+5 V @ 2f, ≤1% bal)", "(26.8, 33.0)", EMERALD_SIG),
        ("TP10", "DRV", "U1D skew driver (check 0 HF osc)", "(26.8, 39.5)", CYAN_CTL),
        ("TP6", "ENV", "U2A buffered V_env (zero load)", "(26.8, 46.0)", CYAN_CTL),
        ("TP11", "OFF", "RV4 wiper (±4.98 V + center 0 V)", "(26.8, 52.5)", ORANGE_OUT),
        ("TP7", "INV", "U2B -(V_env + V_off) · SMOOTH", "(26.8, 59.0)", ORANGE_OUT),
        ("TP8", "OUT", "U2C +(V_env + V_off) & U2D in", "(26.8, 65.0)", ORANGE_OUT),
        ("TP1", "GND", "Lower scope GND clip", "(15.0, 105.6)", SLATE_GND),
    ]

    card_x = 610.0
    card_w = 348.0
    card_h = 68.0
    y_start = 178.0
    y_end = 1192.0
    step_y = (y_end - y_start) / (len(tp_cards) - 1)

    for idx, (ref, silk, desc, coord_s, col) in enumerate(tp_cards):
        fp = fps[ref]
        tx, ty = to_px(fp.back_x, fp.y)
        _draw_target_ring(ctx, tx, ty, 9.2, col, width=2.1)

        cy = y_start + idx * step_y
        elbow_x = BX0 + BW + 22.0 + (idx % 2) * 14.0
        _draw_leader(ctx, [(card_x, cy), (elbow_x, cy), (tx, ty)], col, width=1.5)

        _draw_card_box(
            ctx, card_x, cy - card_h / 2.0, card_w, card_h, col, r=7.0, line_width=1.2
        )
        _, _, bx1, _ = _draw_pill(
            ctx,
            card_x + 10.0,
            cy - 11.0,
            ref,
            col,
            font_size=10.5,
            pad_x=7.0,
            height=18.0,
            align="left",
        )
        _draw_text(
            ctx, silk, bx1 + 8.0, cy - 7.0, size=11.5, color=col, bold=True, mono=True
        )
        _draw_text(
            ctx,
            f"back={coord_s}",
            card_x + card_w - 10.0,
            cy - 8.0,
            size=9.2,
            color=TEXT_MUTED,
            mono=True,
            align="right",
        )
        _draw_text(ctx, desc, card_x + 12.0, cy + 16.0, size=10.5, color=TEXT_PRIMARY)

    return _finish_surface(surf, ctx, W, H, "00_test_point_map.png")


# ---------------------------------------------------------------------------
# Figure 01 — Initial Bench Control State (Front F.Cu)
# ---------------------------------------------------------------------------


def _draw_knob_icon(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    angle_deg: float,
    accent: tuple[float, float, float],
) -> None:
    """Draw a crisp mini potentiometer pointer icon (-135° CCW, 0° 12 o'clock, +135° CW)."""
    r = 12.0
    ctx.save()
    ctx.new_path()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.set_source_rgb(*BG_HEADER)
    ctx.fill_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(1.5)
    ctx.stroke()

    # Stop ticks at -135 and +135
    for deg in (-135.0, 0.0, 135.0):
        rad = math.radians(deg - 90.0)
        ctx.move_to(cx + (r - 3) * math.cos(rad), cy + (r - 3) * math.sin(rad))
        ctx.line_to(cx + (r + 2) * math.cos(rad), cy + (r + 2) * math.sin(rad))
        ctx.set_source_rgb(*TEXT_MUTED)
        ctx.set_line_width(1.1)
        ctx.stroke()

    prad = math.radians(angle_deg - 90.0)
    ctx.move_to(cx, cy)
    ctx.line_to(cx + (r - 2.0) * math.cos(prad), cy + (r - 2.0) * math.sin(prad))
    ctx.set_source_rgb(*YELLOW_HL)
    ctx.set_line_width(2.3)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()
    ctx.restore()


def _draw_toggle_icon(
    ctx: cairo.Context,
    cx: float,
    cy: float,
    down: bool,
    accent: tuple[float, float, float],
) -> None:
    r = 11.0
    ctx.save()
    ctx.new_path()
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.set_source_rgb(*BG_HEADER)
    ctx.fill_preserve()
    ctx.set_source_rgb(*accent)
    ctx.set_line_width(1.5)
    ctx.stroke()
    dy = 7.0 if down else -7.0
    ctx.move_to(cx, cy)
    ctx.line_to(cx, cy + dy)
    ctx.set_source_rgb(*YELLOW_HL)
    ctx.set_line_width(2.4)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()
    ctx.new_path()
    ctx.arc(cx, cy + dy, 2.4, 0, 2 * math.pi)
    ctx.fill()
    ctx.restore()


def render_01_initial_controls_front(
    fps: dict[str, FootprintInfo],
    top_surf: cairo.ImageSurface,
    top_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 900, 1200
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "INITIAL BENCH CONTROL STATE (F.Cu FRONT VIEW) · ALL JACKS UNPATCHED",
        [
            (CYAN_CTL, "Potentiometers (RV1–RV4)"),
            (PURPLE_HIZ, "Toggles (SW1–SW2)"),
            (EMERALD_SIG, "Bi-Color LED1"),
            (SLATE_GND, "Jacks (Unpatched)"),
            (RED_POS, "Power Key / -12V Bar"),
        ],
    )

    BX0, BY0, BW, BH = 310.0, 108.0, 280.0, 1008.0
    _paint_master_region(
        ctx, top_surf, top_bbox, (BX0, BY0, BW, BH), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.2)
    ctx.rectangle(BX0 - 0.5, BY0 - 0.5, BW + 1.0, BH + 1.0)
    ctx.stroke()
    ctx.restore()

    def to_fpx(fx: float, y: float) -> tuple[float, float]:
        return BX0 + (fx / BOARD_W) * BW, BY0 + (y / BOARD_H) * BH

    _draw_text(ctx, "board_X = 0", BX0, BY0 - 6, size=9.5, color=TEXT_MUTED, mono=True)
    _draw_text(
        ctx,
        "F.Cu FRONT (Y = 0)",
        BX0 + BW / 2,
        BY0 - 6,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "board_X = 30",
        BX0 + BW,
        BY0 - 6,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="right",
    )
    _draw_text(
        ctx,
        "Y = 108 mm (BOTTOM)",
        BX0 + BW / 2,
        BY0 + BH + 18,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )

    # Highlight pots on F.Cu
    for ref, ang, title, sub, card_y in (
        ("RV1", -135.0, "RV1 · GAIN (A100K)", "Full CCW (0%)", 190.0),
        ("RV2", -135.0, "RV2 · ATK (A1M)", "Full CCW (Min attack)", 335.0),
        ("RV3", -135.0, "RV3 · REL (A1M)", "Full CCW (Min release)", 480.0),
        ("RV4", 0.0, "RV4 · OFFSET (B10K)", "Center detent (12 o'clock)", 625.0),
    ):
        fp = fps[ref]
        fx, fy = to_fpx(15.0, fp.y + 2.5)
        _draw_target_ring(ctx, fx, fy, 20.0, CYAN_CTL, fill_alpha=0.10, width=1.8)
        _draw_leader(ctx, [(268.0, card_y), (294.0, card_y), (fx - 20.0, fy)], CYAN_CTL)
        _draw_card_box(ctx, 20.0, card_y - 28.0, 248.0, 56.0, CYAN_CTL, r=7.0)
        _draw_knob_icon(ctx, 44.0, card_y, ang, CYAN_CTL)
        _draw_text(ctx, title, 66.0, card_y - 4.0, size=11.0, bold=True)
        _draw_text(ctx, sub, 66.0, card_y + 14.0, size=10.5, color=YELLOW_HL, bold=True)

    # Left lower: SW1, J1, J3
    sw1 = fps["SW1"]
    p_sw1 = to_fpx(sw1.front_x, sw1.y)
    _draw_bracket_box(
        ctx, p_sw1[0] - 18, p_sw1[1] - 34, p_sw1[0] + 18, p_sw1[1] + 34, PURPLE_HIZ
    )
    _draw_leader(
        ctx, [(268.0, 775.0), (294.0, 775.0), (p_sw1[0] - 18, p_sw1[1])], PURPLE_HIZ
    )
    _draw_card_box(ctx, 20.0, 747.0, 248.0, 56.0, PURPLE_HIZ, r=7.0)
    _draw_toggle_icon(ctx, 44.0, 775.0, True, PURPLE_HIZ)
    _draw_text(ctx, "SW1 · SMOOTH", 66.0, 771.0, size=11.0, bold=True)
    _draw_text(
        ctx, "DOWN (RAW / OFF)", 66.0, 789.0, size=10.5, color=YELLOW_HL, bold=True
    )

    for jref, lbl, cy_card in (
        ("J1", "J1 · IN (Audio / Env)", 900.0),
        ("J3", "J3 · OUT (+Env + Off)", 1040.0),
    ):
        jfp = fps[jref]
        jp = to_fpx(jfp.front_x, jfp.y + 5.7)
        _draw_bracket_box(
            ctx, jp[0] - 28, jp[1] - 42, jp[0] + 28, jp[1] + 42, SLATE_GND
        )
        _draw_leader(
            ctx, [(268.0, cy_card), (294.0, cy_card), (jp[0] - 28, jp[1])], SLATE_GND
        )
        _draw_card_box(ctx, 20.0, cy_card - 26.0, 248.0, 52.0, SLATE_GND, r=7.0)
        _draw_text(ctx, lbl, 34.0, cy_card - 3.0, size=11.0, bold=True)
        _draw_text(
            ctx,
            "UNPATCHED (no cable)",
            34.0,
            cy_card + 15.0,
            size=10.2,
            color=TEXT_MUTED,
        )

    # Right column: J_PWR -12V bar, LED1, SW2, J2, J4
    jpwr_bot = to_fpx(24.5, 19.8)
    _draw_bracket_box(
        ctx,
        jpwr_bot[0] - 32,
        jpwr_bot[1] - 58,
        jpwr_bot[0] + 24,
        jpwr_bot[1] + 6,
        RED_POS,
    )
    _draw_leader(
        ctx,
        [(632.0, 205.0), (608.0, 205.0), (jpwr_bot[0] + 24, jpwr_bot[1] - 10)],
        RED_POS,
    )
    _draw_card_box(ctx, 632.0, 173.0, 248.0, 64.0, RED_POS, r=7.0)
    _draw_text(
        ctx, "J_PWR (-12V Stripe)", 646.0, 195.0, size=11.0, color=RED_POS, bold=True
    )
    _draw_text(
        ctx,
        "F.SilkS white -12V bar @ BOTTOM",
        646.0,
        212.0,
        size=10.0,
        color=TEXT_PRIMARY,
    )
    _draw_text(
        ctx, "Connect red stripe to BOTTOM", 646.0, 227.0, size=9.8, color=TEXT_MUTED
    )

    # LED1 on F.Cu
    led = fps["LED1"]
    led_p1 = led.pad("1")
    lp1 = to_fpx(led_p1.front_x, led_p1.y)
    _draw_target_ring(ctx, lp1[0], lp1[1], 7.0, EMERALD_SIG, width=2.0)
    _draw_leader(
        ctx, [(632.0, 620.0), (606.0, 620.0), (lp1[0] + 5.0, lp1[1] - 4.0)], EMERALD_SIG
    )
    _draw_card_box(ctx, 632.0, 582.0, 248.0, 76.0, EMERALD_SIG, r=7.0)
    _draw_text(
        ctx,
        "LED1 · Bi-Color R/G",
        646.0,
        604.0,
        size=11.0,
        color=EMERALD_SIG,
        bold=True,
    )
    _draw_text(
        ctx, "Starts DARK (RV4 centered)", 646.0, 622.0, size=10.2, color=TEXT_PRIMARY
    )
    _draw_text(
        ctx, "F.Cu Sq. Pad 1 LEFT = +V Green", 646.0, 640.0, size=9.8, color=TEXT_MUTED
    )

    sw2 = fps["SW2"]
    p_sw2 = to_fpx(sw2.front_x, sw2.y)
    _draw_bracket_box(
        ctx, p_sw2[0] - 18, p_sw2[1] - 34, p_sw2[0] + 18, p_sw2[1] + 34, PURPLE_HIZ
    )
    _draw_leader(
        ctx, [(632.0, 775.0), (606.0, 775.0), (p_sw2[0] + 18, p_sw2[1])], PURPLE_HIZ
    )
    _draw_card_box(ctx, 632.0, 747.0, 248.0, 56.0, PURPLE_HIZ, r=7.0)
    _draw_toggle_icon(ctx, 656.0, 775.0, True, PURPLE_HIZ)
    _draw_text(ctx, "SW2 · FAST / SLOW", 678.0, 771.0, size=11.0, bold=True)
    _draw_text(
        ctx, "DOWN (FAST · 470 nF)", 678.0, 789.0, size=10.5, color=YELLOW_HL, bold=True
    )

    for jref, lbl, cy_card in (
        ("J2", "J2 · SLEW IN (Normaled)", 900.0),
        ("J4", "J4 · INV_OUT (Inverted)", 1040.0),
    ):
        jfp = fps[jref]
        jp = to_fpx(jfp.front_x, jfp.y + 5.7)
        _draw_bracket_box(
            ctx, jp[0] - 28, jp[1] - 42, jp[0] + 28, jp[1] + 42, SLATE_GND
        )
        _draw_leader(
            ctx, [(632.0, cy_card), (606.0, cy_card), (jp[0] + 28, jp[1])], SLATE_GND
        )
        _draw_card_box(ctx, 632.0, cy_card - 26.0, 248.0, 52.0, SLATE_GND, r=7.0)
        _draw_text(ctx, lbl, 646.0, cy_card - 3.0, size=11.0, bold=True)
        _draw_text(
            ctx,
            "UNPATCHED (no cable)",
            646.0,
            cy_card + 15.0,
            size=10.2,
            color=TEXT_MUTED,
        )

    return _finish_surface(surf, ctx, W, H, "01_initial_controls_front.png")


# ---------------------------------------------------------------------------
# Figure 02 — Phase 1 Visual Polarity Check (B.Cu Zooms)
# ---------------------------------------------------------------------------


def render_02_phase1_polarity_check(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 960, 600
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 1 — UNPOWERED VISUAL POLARITY CHECK (B.Cu DIRECT VIEW)",
        [
            (AMBER_POL, "Keying / Cathode / Pin-1 Checks"),
            (RED_POS, "+12V Polarity"),
            (BLUE_NEG, "-12V Polarity (C2 Reversed vs C1!)"),
        ],
    )

    # Left Viewport: Power block (J_PWR, D1, D2, C1, C2) -> 22.5 x 36.0 mm => 290 x 464 px
    vp1_rect = (42.0, 104.0, 290.0, 464.0)
    vp1_crop = (-1.0, 4.0, 21.5, 40.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp1_rect, vp1_crop)
    vp1_mm = _draw_viewport_rulers(ctx, vp1_rect, vp1_crop, 5.0)
    _draw_text(
        ctx,
        "POWER BLOCK (J_PWR, D1–D2, C1–C2)",
        42.0,
        78.0,
        size=10.2,
        color=AMBER_POL,
        bold=True,
    )

    # Non-crossing callouts on VP1 ordered cleanly top to bottom
    # D1 cathode LEFT
    d1 = fps["D1"]
    dp1 = d1.pad("1")
    _draw_target_ring(ctx, *vp1_mm(dp1.back_x, dp1.y), 5.5, YELLOW_HL, width=1.8)
    _draw_leader(ctx, [vp1_mm(14.5, 7.2), vp1_mm(dp1.back_x, dp1.y - 0.6)], YELLOW_HL)
    _draw_pill(
        ctx, *vp1_mm(15.2, 7.2), "D1 K <- LEFT", YELLOW_HL, font_size=8.8, height=16.0
    )

    # J_PWR notch faces center (right in B.Cu)
    _draw_leader(ctx, [vp1_mm(12.2, 14.8), vp1_mm(9.6, 13.0)], YELLOW_HL)
    _draw_pill(
        ctx,
        *vp1_mm(15.8, 15.0),
        "NOTCH -> CENTER",
        YELLOW_HL,
        font_size=8.8,
        height=16.5,
    )

    # J_PWR Pins 1-2 (-12V) at bottom
    jp_p1 = fps["J_PWR"].pad("1")
    _draw_target_ring(ctx, *vp1_mm(jp_p1.back_x, jp_p1.y), 7.0, BLUE_NEG, width=1.8)
    _draw_leader(
        ctx,
        [vp1_mm(11.4, 19.6), vp1_mm(8.8, 19.6), vp1_mm(jp_p1.back_x + 0.7, jp_p1.y)],
        BLUE_NEG,
    )
    _draw_pill(
        ctx,
        *vp1_mm(15.6, 19.6),
        "PINS 1–2: -12V BOT",
        BLUE_NEG,
        font_size=8.8,
        height=16.5,
    )

    # D2 cathode LEFT
    d2 = fps["D2"]
    dp2 = d2.pad("1")
    _draw_target_ring(ctx, *vp1_mm(dp2.back_x, dp2.y), 5.5, YELLOW_HL, width=1.8)
    _draw_leader(ctx, [vp1_mm(13.8, 23.8), vp1_mm(dp2.back_x, dp2.y - 0.6)], YELLOW_HL)
    _draw_pill(
        ctx, *vp1_mm(15.8, 23.8), "D2 K <- LEFT", YELLOW_HL, font_size=8.8, height=16.0
    )

    # C1 (+ inner/right) vs C2 (+ outer/left)
    c1_p1 = fps["C1"].pad("1")
    c2_p1 = fps["C2"].pad("1")
    _draw_target_ring(ctx, *vp1_mm(c1_p1.back_x, c1_p1.y), 6.5, RED_POS, width=2.0)
    _draw_leader(
        ctx, [vp1_mm(12.6, 30.6), vp1_mm(c1_p1.back_x + 0.8, c1_p1.y)], RED_POS
    )
    _draw_pill(
        ctx,
        *vp1_mm(15.0, 30.8),
        "C1 + RIGHT (+12V)",
        RED_POS,
        font_size=8.8,
        height=16.5,
    )

    _draw_target_ring(ctx, *vp1_mm(c2_p1.back_x, c2_p1.y), 6.5, BLUE_NEG, width=2.0)
    _draw_leader(
        ctx,
        [vp1_mm(10.6, 38.0), vp1_mm(7.0, 38.0), vp1_mm(c2_p1.back_x, c2_p1.y + 0.6)],
        BLUE_NEG,
    )
    _draw_pill(
        ctx,
        *vp1_mm(13.8, 38.0),
        "C2 + LEFT (GND · REV!)",
        BLUE_NEG,
        font_size=8.6,
        height=16.5,
    )

    # Middle Viewport: IC block (U1, U2) -> 22.0 x 34.0 mm => 300 x 464 px
    vp2_rect = (388.0, 104.0, 300.0, 464.0)
    vp2_crop = (4.0, 74.0, 26.0, 108.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp2_rect, vp2_crop)
    vp2_mm = _draw_viewport_rulers(ctx, vp2_rect, vp2_crop, 5.0)
    _draw_text(
        ctx,
        "QUAD OP-AMPS (U1 & U2 — 180° OPPOSED)",
        388.0,
        78.0,
        size=10.2,
        color=AMBER_POL,
        bold=True,
    )

    u1_p1 = fps["U1"].pad("1")
    u2_p1 = fps["U2"].pad("1")
    _draw_target_ring(ctx, *vp2_mm(u1_p1.back_x, u1_p1.y), 6.5, YELLOW_HL, width=2.0)
    _draw_target_ring(ctx, *vp2_mm(18.93, 87.31), 5.0, AMBER_POL, width=1.6)
    _draw_leader(
        ctx, [vp2_mm(20.0, 90.0), vp2_mm(u1_p1.back_x + 0.4, u1_p1.y + 0.3)], YELLOW_HL
    )
    _draw_pill(
        ctx,
        *vp2_mm(20.2, 90.2),
        "U1 PIN 1 (BOT-RIGHT)",
        YELLOW_HL,
        font_size=9.0,
        height=17.0,
    )

    _draw_target_ring(ctx, *vp2_mm(u2_p1.back_x, u2_p1.y), 6.5, YELLOW_HL, width=2.0)
    _draw_target_ring(ctx, *vp2_mm(11.08, 94.69), 5.0, AMBER_POL, width=1.6)
    _draw_leader(
        ctx, [vp2_mm(10.0, 92.2), vp2_mm(u2_p1.back_x - 0.3, u2_p1.y - 0.3)], YELLOW_HL
    )
    _draw_pill(
        ctx,
        *vp2_mm(9.6, 92.0),
        "U2 PIN 1 (TOP-LEFT)",
        YELLOW_HL,
        font_size=9.0,
        height=17.0,
    )

    # Right Mini-map
    _draw_minimap(
        ctx,
        bot_surf,
        bot_bbox,
        765.0,
        118.0,
        125.0,
        [(vp1_crop, AMBER_POL), (vp2_crop, YELLOW_HL)],
    )

    return _finish_surface(surf, ctx, W, H, "02_phase1_polarity_check.png")


# ---------------------------------------------------------------------------
# Figure 03 — Phase 1 Cold Checks (Ohms, GND Continuity, Schottky Diode)
# ---------------------------------------------------------------------------


def render_03_phase1_cold_checks(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 980, 780
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 1 — DMM RESISTANCE, GND CONTINUITY & DIODE-MODE CHECKS (POWER OFF)",
        [
            (CYAN_CTL, "GND Continuity (< 0.5 Ω)"),
            (RED_POS, "DMM Red (+) / +12V"),
            (SLATE_GND, "DMM Black (−) / COM"),
            (BLUE_NEG, "-12V Rail"),
            (YELLOW_HL, "Schottky Drop (0.18–0.35 V)"),
        ],
    )

    # Left: Full upright B.Cu board for GND & rail resistance targets
    BX0, BY0, BW, BH = 165.0, 102.0, 178.0, 640.8
    _paint_master_region(
        ctx, bot_surf, bot_bbox, (BX0, BY0, BW, BH), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.1)
    ctx.rectangle(BX0 - 0.5, BY0 - 0.5, BW + 1.0, BH + 1.0)
    ctx.stroke()
    ctx.restore()

    def bpx(bx: float, y: float) -> tuple[float, float]:
        return BX0 + (bx / BOARD_W) * BW, BY0 + (y / BOARD_H) * BH

    _draw_text(
        ctx,
        "GND CONTINUITY & RAIL OHMS",
        BX0 + BW / 2,
        78.0,
        size=10.0,
        color=CYAN_CTL,
        bold=True,
        align="center",
    )

    # TP2 / TP3 rail resistance rings
    tp2, tp3 = fps["TP2"], fps["TP3"]
    _draw_target_ring(ctx, *bpx(tp2.back_x, tp2.y), 7.0, RED_POS, width=1.8)
    _draw_target_ring(ctx, *bpx(tp3.back_x, tp3.y), 7.0, BLUE_NEG, width=1.8)
    _draw_leader(ctx, [(145.0, 114.0), (195.0, 114.0), bpx(tp2.back_x, tp2.y)], RED_POS)
    _draw_pill(
        ctx,
        145.0,
        114.0,
        "TP2 (+12V) > 10 kΩ",
        RED_POS,
        align="right",
        font_size=9.2,
        height=17.5,
    )

    # TP12 GND2 & TP3 (-12V)
    tp12 = fps["TP12"]
    _draw_target_ring(ctx, *bpx(tp12.back_x, tp12.y), 7.0, CYAN_CTL, width=1.8)
    _draw_leader(ctx, [(362.0, 114.0), bpx(tp12.back_x, tp12.y)], CYAN_CTL)
    _draw_pill(
        ctx,
        362.0,
        114.0,
        "TP12 (GND2)",
        CYAN_CTL,
        align="left",
        font_size=9.2,
        height=17.5,
    )

    _draw_leader(
        ctx, [(362.0, 144.0), (305.0, 144.0), bpx(tp3.back_x, tp3.y)], BLUE_NEG
    )
    _draw_pill(
        ctx,
        362.0,
        144.0,
        "TP3 (-12V) > 10 kΩ",
        BLUE_NEG,
        align="left",
        font_size=9.0,
        height=17.5,
    )

    # J_PWR Pins 3-8 GND
    jp3 = fps["J_PWR"].pad("3")
    jp8 = fps["J_PWR"].pad("8")
    p_top = bpx(jp8.back_x - 1.2, jp8.y - 1.0)
    p_bot = bpx(jp3.back_x + 1.2, jp3.y + 1.0)
    _draw_bracket_box(
        ctx, p_top[0], p_top[1], p_bot[0], p_bot[1], CYAN_CTL, dashed=False
    )
    _draw_leader(ctx, [(145.0, 182.0), (p_top[0], 182.0)], CYAN_CTL)
    _draw_pill(
        ctx,
        145.0,
        182.0,
        "J_PWR 3–8 (GND)",
        CYAN_CTL,
        align="right",
        font_size=9.2,
        height=17.5,
    )

    # Sleeves of J1-J4 (top square pads)
    for jref in ("J2", "J1", "J4", "J3"):
        sp = fps[jref].pad("S")
        pt = bpx(sp.back_x, sp.y)
        _draw_target_ring(ctx, *pt, 6.5, CYAN_CTL, width=1.8)

    _draw_leader(
        ctx,
        [(145.0, 568.0), bpx(fps["J2"].pad("S").back_x, fps["J2"].pad("S").y)],
        CYAN_CTL,
    )
    _draw_leader(
        ctx,
        [(145.0, 658.0), bpx(fps["J4"].pad("S").back_x, fps["J4"].pad("S").y)],
        CYAN_CTL,
    )
    _draw_pill(
        ctx,
        145.0,
        568.0,
        "J2.S (Sleeve)",
        CYAN_CTL,
        align="right",
        font_size=9.2,
        height=17.5,
    )
    _draw_pill(
        ctx,
        145.0,
        658.0,
        "J4.S (Sleeve)",
        CYAN_CTL,
        align="right",
        font_size=9.2,
        height=17.5,
    )

    _draw_leader(
        ctx,
        [(362.0, 568.0), bpx(fps["J1"].pad("S").back_x, fps["J1"].pad("S").y)],
        CYAN_CTL,
    )
    _draw_leader(
        ctx,
        [(362.0, 658.0), bpx(fps["J3"].pad("S").back_x, fps["J3"].pad("S").y)],
        CYAN_CTL,
    )
    _draw_pill(
        ctx,
        362.0,
        568.0,
        "J1.S (Sleeve)",
        CYAN_CTL,
        align="left",
        font_size=9.2,
        height=17.5,
    )
    _draw_pill(
        ctx,
        362.0,
        658.0,
        "J3.S (Sleeve)",
        CYAN_CTL,
        align="left",
        font_size=9.2,
        height=17.5,
    )

    # TP1 GND
    tp1 = fps["TP1"]
    _draw_target_ring(ctx, *bpx(tp1.back_x, tp1.y), 7.5, CYAN_CTL, width=1.9)
    _draw_leader(ctx, [(145.0, 728.0), bpx(tp1.back_x, tp1.y)], CYAN_CTL)
    _draw_pill(
        ctx,
        145.0,
        728.0,
        "TP1 (GND)",
        CYAN_CTL,
        align="right",
        font_size=9.2,
        height=17.5,
    )

    # Right-Top: Diode check zoomed viewport (back_X = -0.5..22.5, Y = 0..29.0 => 282 x 356 px)
    dv_rect = (460.0, 102.0, 282.0, 356.0)
    dv_crop = (-0.5, 0.0, 22.5, 29.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, dv_rect, dv_crop)
    dv_mm = _draw_viewport_rulers(ctx, dv_rect, dv_crop, 5.0)
    _draw_text(
        ctx,
        "SCHOTTKY DIODE-MODE PROBE POINTS (D1 & D2)",
        460.0,
        76.0,
        size=10.2,
        color=YELLOW_HL,
        bold=True,
    )

    jp9 = fps["J_PWR"].pad("9")
    jp1 = fps["J_PWR"].pad("1")
    p_jp9 = dv_mm(jp9.back_x, jp9.y)
    p_tp2 = dv_mm(tp2.back_x, tp2.y)
    p_tp3 = dv_mm(tp3.back_x, tp3.y)
    p_jp1 = dv_mm(jp1.back_x, jp1.y)

    d1, d2 = fps["D1"], fps["D2"]
    _draw_bracket_box(
        ctx,
        *dv_mm(d1.back_x - 2.3, d1.y - 1.3),
        *dv_mm(d1.back_x + 2.3, d1.y + 1.3),
        YELLOW_HL,
    )
    _draw_bracket_box(
        ctx,
        *dv_mm(d2.back_x - 2.3, d2.y - 1.3),
        *dv_mm(d2.back_x + 2.3, d2.y + 1.3),
        YELLOW_HL,
    )
    _draw_pill(
        ctx,
        *dv_mm(d1.back_x + 3.6, d1.y),
        "D1",
        YELLOW_HL,
        font_size=8.8,
        pad_x=5.0,
        height=15.0,
    )
    _draw_pill(
        ctx,
        *dv_mm(d2.back_x + 3.6, d2.y),
        "D2",
        YELLOW_HL,
        font_size=8.8,
        pad_x=5.0,
        height=15.0,
    )

    # D1 check: Red on J_PWR 9/10, Black on TP2
    _draw_target_ring(ctx, *p_jp9, 7.0, RED_POS, width=2.0)
    _draw_target_ring(ctx, *p_tp2, 7.0, SLATE_GND, width=2.0)
    _draw_pill(
        ctx, *dv_mm(8.8, 7.8), "R+", RED_POS, font_size=9.0, pad_x=5.0, height=15.0
    )
    _draw_pill(
        ctx, *dv_mm(10.6, 2.2), "B−", SLATE_GND, font_size=9.0, pad_x=5.0, height=15.0
    )

    # D2 check: Red on TP3, Black on J_PWR 1/2
    _draw_target_ring(ctx, *p_tp3, 7.0, RED_POS, width=2.0)
    _draw_target_ring(ctx, *p_jp1, 7.0, SLATE_GND, width=2.0)
    _draw_pill(
        ctx, *dv_mm(21.1, 2.2), "R+", RED_POS, font_size=9.0, pad_x=5.0, height=15.0
    )
    _draw_pill(
        ctx, *dv_mm(8.8, 18.0), "B−", SLATE_GND, font_size=9.0, pad_x=5.0, height=15.0
    )

    # Diode mode callouts to right of viewport
    _draw_card_box(ctx, 758.0, 114.0, 204.0, 100.0, RED_POS, r=7.0)
    _draw_text(
        ctx,
        "D1 (+12V Reverse Prot.)",
        770.0,
        136.0,
        size=10.5,
        color=RED_POS,
        bold=True,
    )
    _draw_text(
        ctx, "Red (+) -> J_PWR Pin 9/10", 770.0, 155.0, size=9.8, color=TEXT_PRIMARY
    )
    _draw_text(ctx, "Blk (−) -> TP2 (+12V)", 770.0, 172.0, size=9.8, color=TEXT_PRIMARY)
    _draw_text(
        ctx,
        "Reads ~0.18–0.35 V (OL rev)",
        770.0,
        195.0,
        size=10.0,
        color=YELLOW_HL,
        bold=True,
    )

    _draw_card_box(ctx, 758.0, 232.0, 204.0, 100.0, BLUE_NEG, r=7.0)
    _draw_text(
        ctx,
        "D2 (-12V Reverse Prot.)",
        770.0,
        254.0,
        size=10.5,
        color=BLUE_NEG,
        bold=True,
    )
    _draw_text(ctx, "Red (+) -> TP3 (-12V)", 770.0, 273.0, size=9.8, color=TEXT_PRIMARY)
    _draw_text(
        ctx, "Blk (−) -> J_PWR Pin 1/2", 770.0, 290.0, size=9.8, color=TEXT_PRIMARY
    )
    _draw_text(
        ctx,
        "Reads ~0.18–0.35 V (OL rev)",
        770.0,
        313.0,
        size=10.0,
        color=YELLOW_HL,
        bold=True,
    )

    # Right-Bottom: 5-row DMM Cold Check Summary Card
    _draw_card_box(
        ctx, 460.0, 488.0, 502.0, 256.0, BORDER_SUBTLE, fill=BG_HEADER, r=8.0
    )
    _draw_text(
        ctx,
        "DMM COLD-CHECK BENCH SUMMARY (CAPS SETTLED)",
        476.0,
        512.0,
        size=11.0,
        bold=True,
    )
    rows = [
        ("Ohms", "TP2 (+12V) <-> TP1 (GND)", "> 10 kΩ (no short)", RED_POS),
        ("Ohms", "TP3 (-12V) <-> TP1 (GND)", "> 10 kΩ (no short)", BLUE_NEG),
        ("Ohms", "TP2 (+12V) <-> TP3 (-12V)", "~22 kΩ (OFFSET string)", AMBER_POL),
        ("Cont.", "J_PWR 3–8, TP1, TP12, J1–J4.S", "< 0.5 Ω (solid ground)", CYAN_CTL),
        ("Diode", "D1 & D2 forward / reverse", "0.18–0.35 V fwd / OL rev", YELLOW_HL),
    ]
    ry = 540.0
    for mode, probe, exp, col in rows:
        _draw_pill(
            ctx,
            476.0,
            ry,
            mode,
            col,
            font_size=9.2,
            pad_x=6.0,
            height=18.0,
            align="left",
        )
        _draw_text(ctx, probe, 536.0, ry + 4.0, size=10.2, color=TEXT_PRIMARY)
        _draw_text(
            ctx, exp, 948.0, ry + 4.0, size=10.2, color=col, bold=True, align="right"
        )
        ry += 40.0

    return _finish_surface(surf, ctx, W, H, "03_phase1_cold_checks.png")


# ---------------------------------------------------------------------------
# Figure 04 — Phase 2 First Power-Up (Smoke Test & Supply Rails)
# ---------------------------------------------------------------------------


def render_04_phase2_power_up(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 960, 650
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 2 — FIRST POWER-UP (RIBBON STRIPE, FILTERED RAILS & THERMAL CHECK)",
        [
            (RED_POS, "Red Ribbon Stripe (-12V) / +12V Rail"),
            (BLUE_NEG, "-12V Rail"),
            (CYAN_CTL, "GND COM"),
            (AMBER_POL, "Thermal Finger Check (Must Stay Cool)"),
        ],
    )

    # Left Viewport: Upper B.Cu power stage -> 23.0 x 40.5 mm => 288 x 507 px
    vp1_rect = (42.0, 102.0, 288.0, 507.0)
    vp1_crop = (-1.0, 0.0, 22.0, 40.5)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp1_rect, vp1_crop)
    vp1_mm = _draw_viewport_rulers(ctx, vp1_rect, vp1_crop, 5.0)
    _draw_text(
        ctx,
        "POWER INPUT, RAILS & PASSIVE THERMAL CHECK",
        42.0,
        76.0,
        size=10.0,
        color=RED_POS,
        bold=True,
    )

    # Red stripe ribbon indicator at bottom of J_PWR (Pins 1-2, Y=18.0)
    rs0 = vp1_mm(1.2, 16.5)
    rs1 = vp1_mm(9.5, 19.6)
    ctx.save()
    ctx.new_path()
    ctx.rectangle(rs0[0], rs0[1], rs1[0] - rs0[0], rs1[1] - rs0[1])
    ctx.set_source_rgba(*RED_POS, 0.35)
    ctx.fill_preserve()
    ctx.set_source_rgb(*RED_POS)
    ctx.set_line_width(1.8)
    ctx.stroke()
    ctx.restore()
    _draw_leader(ctx, [vp1_mm(10.8, 21.8), vp1_mm(8.0, 19.6)], RED_POS)
    _draw_pill(
        ctx,
        *vp1_mm(15.2, 22.0),
        "RED STRIPE (-12V BOT)",
        RED_POS,
        font_size=8.8,
        height=16.5,
    )

    # TP2 / TP3 voltage targets
    tp2, tp3 = fps["TP2"], fps["TP3"]
    _draw_target_ring(ctx, *vp1_mm(tp2.back_x, tp2.y), 7.0, RED_POS, width=2.0)
    _draw_target_ring(ctx, *vp1_mm(tp3.back_x, tp3.y), 7.0, BLUE_NEG, width=2.0)
    _draw_pill(
        ctx,
        *vp1_mm(7.2, 5.2),
        "TP2: +11.40..+11.80 V",
        RED_POS,
        font_size=8.6,
        height=16.5,
    )
    _draw_leader(ctx, [vp1_mm(11.4, 4.8), vp1_mm(tp2.back_x, tp2.y)], RED_POS)
    _draw_pill(
        ctx,
        *vp1_mm(15.6, 7.6),
        "TP3: −11.40..−11.80 V",
        BLUE_NEG,
        font_size=8.6,
        height=16.5,
    )
    _draw_leader(ctx, [vp1_mm(18.0, 6.2), vp1_mm(tp3.back_x, tp3.y)], BLUE_NEG)

    # Thermal brackets around D1/R1/C1 and D2/R2/C2
    _draw_bracket_box(ctx, *vp1_mm(11.5, 9.5), *vp1_mm(16.5, 20.5), AMBER_POL)
    _draw_bracket_box(ctx, *vp1_mm(2.0, 24.0), *vp1_mm(16.5, 39.4), AMBER_POL)
    _draw_pill(
        ctx,
        *vp1_mm(13.6, 31.2),
        "D1/D2, R1/R2, C1/C2 COOL",
        AMBER_POL,
        font_size=8.4,
        height=16.0,
    )

    # Middle-Top Viewport: U1, U2, TP1 -> 24.0 x 32.0 mm => 252 x 336 px
    vp2_rect = (400.0, 102.0, 252.0, 336.0)
    vp2_crop = (3.0, 76.0, 27.0, 108.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp2_rect, vp2_crop)
    vp2_mm = _draw_viewport_rulers(ctx, vp2_rect, vp2_crop, 5.0)
    _draw_text(
        ctx,
        "IC THERMAL CHECK & LOWER GND",
        400.0,
        76.0,
        size=10.0,
        color=AMBER_POL,
        bold=True,
    )

    _draw_bracket_box(ctx, *vp2_mm(10.0, 77.5), *vp2_mm(20.0, 89.2), AMBER_POL)
    _draw_bracket_box(ctx, *vp2_mm(10.0, 92.8), *vp2_mm(20.0, 104.2), AMBER_POL)
    _draw_pill(
        ctx, *vp2_mm(20.4, 83.5), "U1 COOL", AMBER_POL, font_size=9.0, height=16.5
    )
    _draw_pill(
        ctx, *vp2_mm(20.4, 98.5), "U2 COOL", AMBER_POL, font_size=9.0, height=16.5
    )

    tp1 = fps["TP1"]
    _draw_target_ring(ctx, *vp2_mm(tp1.back_x, tp1.y), 7.0, CYAN_CTL, width=2.0)
    _draw_pill(
        ctx, *vp2_mm(7.0, 105.6), "TP1 GND COM", CYAN_CTL, font_size=8.6, height=16.0
    )
    _draw_leader(ctx, [vp2_mm(11.6, 105.6), vp2_mm(tp1.back_x, tp1.y)], CYAN_CTL)

    # Middle-Bottom: Guardrails Box
    _draw_card_box(ctx, 400.0, 462.0, 375.0, 152.0, RED_POS, fill=BG_HEADER, r=8.0)
    _draw_text(
        ctx,
        "BENCH PSU GUARDRAILS (CRITICAL)",
        416.0,
        486.0,
        size=11.0,
        color=RED_POS,
        bold=True,
    )
    _draw_text(
        ctx,
        "• Current limit: 40–50 mA per ±12 V rail",
        416.0,
        510.0,
        size=10.2,
        color=TEXT_PRIMARY,
    )
    _draw_text(
        ctx,
        "• Idle draw: ~8–11 mA (+12V) & ~8–11 mA (-12V)",
        416.0,
        532.0,
        size=10.2,
        color=EMERALD_SIG,
        bold=True,
    )
    _draw_text(
        ctx,
        "• ABORT IMMEDIATELY if either rail > 20 mA,",
        416.0,
        558.0,
        size=10.2,
        color=YELLOW_HL,
        bold=True,
    )
    _draw_text(
        ctx,
        "  sags < 11 V, or any IC / diode / cap warms up!",
        416.0,
        578.0,
        size=10.2,
        color=YELLOW_HL,
        bold=True,
    )

    # Far-right Mini-map
    tp12 = fps["TP12"]
    _draw_minimap(
        ctx,
        bot_surf,
        bot_bbox,
        812.0,
        116.0,
        112.0,
        [(vp1_crop, RED_POS), (vp2_crop, AMBER_POL)],
        dots=[(tp12.back_x, tp12.y, CYAN_CTL), (tp1.back_x, tp1.y, CYAN_CTL)],
    )

    return _finish_surface(surf, ctx, W, H, "04_phase2_power_up.png")


# ---------------------------------------------------------------------------
# Figure 05 — Phase 3 Quiescent DC Bias, OFFSET & LED1 Verification
# ---------------------------------------------------------------------------


def render_05_phase3_bias_offset_led(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 960, 650
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 3 — QUIESCENT BIAS, RV4 (OFFSET) SWEEP & LED1 POLARITY (NO INPUT)",
        [
            (CYAN_CTL, "Scope Stability Check (TP10 DRV)"),
            (ORANGE_OUT, "Offset / Output TPs"),
            (EMERALD_SIG, "LED1 Pad 1 (+V Green)"),
            (RED_POS, "LED1 Red State (-V)"),
        ],
    )

    # Left Viewport: Mid B.Cu (back_X = 7..30, Y = 36..76) => 288 x 501 px
    vp1_rect = (42.0, 102.0, 288.0, 501.0)
    vp1_crop = (7.0, 36.0, 30.0, 76.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp1_rect, vp1_crop)
    vp1_mm = _draw_viewport_rulers(ctx, vp1_rect, vp1_crop, 5.0)
    _draw_text(
        ctx,
        "MID-BOARD TPs, RV4 WIPER & LED1",
        42.0,
        76.0,
        size=10.0,
        color=ORANGE_OUT,
        bold=True,
    )

    # Highlight TPs
    for ref, lbl, col in (
        ("TP10", "TP10 DRV: 0 HF OSC", CYAN_CTL),
        ("TP6", "TP6 ENV: 0.00 V", CYAN_CTL),
        ("TP11", "TP11 OFF: ±4.98 V", ORANGE_OUT),
        ("TP7", "TP7 INV: -(Env+Off)", ORANGE_OUT),
        ("TP8", "TP8 OUT: +(Env+Off)", ORANGE_OUT),
    ):
        fp = fps[ref]
        pt = vp1_mm(fp.back_x, fp.y)
        _draw_target_ring(ctx, *pt, 6.8, col, width=2.0)
        _draw_leader(ctx, [vp1_mm(19.0, fp.y), pt], col)
        _draw_pill(ctx, *vp1_mm(14.0, fp.y), lbl, col, font_size=8.6, height=16.5)

    # LED1 bracket in VP1
    led = fps["LED1"]
    _draw_bracket_box(ctx, *vp1_mm(12.2, 70.0), *vp1_mm(17.8, 74.0), EMERALD_SIG)
    _draw_pill(
        ctx,
        *vp1_mm(14.8, 67.6),
        "LED1 (SEE ZOOM ->)",
        EMERALD_SIG,
        font_size=8.6,
        height=16.0,
    )
    _draw_leader(ctx, [vp1_mm(14.8, 68.8), vp1_mm(14.8, 70.2)], EMERALD_SIG)

    # Right-Top Viewport: Ultra-close LED1 B.Cu zoom (back_X = 9.0..21.0, Y = 69.0..75.0 => 390 x 195 px)
    vp2_rect = (392.0, 102.0, 390.0, 195.0)
    vp2_crop = (9.0, 69.0, 21.0, 75.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp2_rect, vp2_crop)
    vp2_mm = _draw_viewport_rulers(ctx, vp2_rect, vp2_crop, 2.0)
    _draw_text(
        ctx,
        "LED1 (A-1076) B.Cu POLARITY ZOOM (SQUARE PAD 1 RIGHT = +V GREEN)",
        392.0,
        76.0,
        size=9.8,
        color=EMERALD_SIG,
        bold=True,
    )

    lp1 = led.pad("1")  # back=(16.27, 72.00) square pad RIGHT in B.Cu
    lp2 = led.pad("2")  # back=(13.73, 72.00) round pad LEFT in B.Cu
    _draw_target_ring(ctx, *vp2_mm(lp1.back_x, lp1.y), 11.0, EMERALD_SIG, width=2.2)
    _draw_target_ring(ctx, *vp2_mm(lp2.back_x, lp2.y), 11.0, SLATE_GND, width=2.0)

    _draw_leader(
        ctx, [vp2_mm(17.8, 70.6), vp2_mm(lp1.back_x + 0.3, lp1.y - 0.3)], EMERALD_SIG
    )
    _draw_pill(
        ctx,
        *vp2_mm(17.8, 70.5),
        "PAD 1 (+) RIGHT · +V GREEN",
        EMERALD_SIG,
        font_size=9.0,
        height=16.5,
    )

    _draw_leader(
        ctx, [vp2_mm(12.0, 73.8), vp2_mm(lp2.back_x - 0.3, lp2.y + 0.3)], SLATE_GND
    )
    _draw_pill(
        ctx,
        *vp2_mm(11.8, 73.9),
        "PAD 2 LEFT (NET_LED_SENSE)",
        SLATE_GND,
        font_size=9.0,
        height=16.5,
    )

    _draw_text(
        ctx,
        "Note: On F.Cu front view, Square Pad 1 (+) is on the LEFT. If CW lights RED, flip LED1 180°!",
        392.0,
        312.0,
        size=9.6,
        color=YELLOW_HL,
        bold=True,
    )

    # Right-Bottom: 3-state OFFSET & LED1 Truth Table
    _draw_card_box(
        ctx, 392.0, 332.0, 390.0, 271.0, BORDER_SUBTLE, fill=BG_HEADER, r=8.0
    )
    _draw_text(
        ctx,
        "RV4 (OFFSET) 3-POINT CHECK · BASELINE TPs",
        408.0,
        356.0,
        size=11.0,
        bold=True,
    )
    _draw_text(
        ctx,
        "Baseline (RV4 Center): TP4 ±10 mV · TP9/5/6 ±15 mV · TP10 ±0.7 V",
        408.0,
        376.0,
        size=9.6,
        color=TEXT_MUTED,
    )

    states = [
        ("RV4 FULL CW", "+4.98 V", "+4.98 V", "−4.98 V", "SOLID GREEN", EMERALD_SIG),
        ("RV4 CENTER", "0.00 V", "0.00 V", "0.00 V", "COMPLETELY DARK", TEXT_MUTED),
        ("RV4 FULL CCW", "−4.98 V", "−4.98 V", "+4.98 V", "SOLID RED", RED_POS),
    ]
    sy = 420.0
    for st_lbl, tp11_v, out_v, inv_v, led_s, led_col in states:
        _draw_card_box(
            ctx,
            408.0,
            sy - 22.0,
            358.0,
            52.0,
            led_col if led_col != TEXT_MUTED else FRAME_LIGHT,
            fill=BG_CARD,
            r=6.0,
        )
        _draw_text(ctx, st_lbl, 420.0, sy - 2.0, size=10.5, bold=True)
        _draw_text(
            ctx,
            f"TP11={tp11_v}  TP8/J3={out_v}  TP7/J4={inv_v}",
            420.0,
            sy + 16.0,
            size=9.4,
            color=TEXT_PRIMARY,
            mono=True,
        )
        # LED indicator dot
        ctx.save()
        ctx.new_path()
        ctx.arc(656.0, sy - 6.0, 5.2, 0, 2 * math.pi)
        if led_col == TEXT_MUTED:
            ctx.set_source_rgb(*BG_CANVAS)
            ctx.fill_preserve()
            ctx.set_source_rgb(*TEXT_MUTED)
            ctx.set_line_width(1.3)
            ctx.stroke()
        else:
            ctx.set_source_rgb(*led_col)
            ctx.fill()
        ctx.restore()
        _draw_text(ctx, led_s, 667.0, sy - 2.0, size=9.6, color=led_col, bold=True)
        sy += 62.0

    # Far-right Mini-map
    j3_t = fps["J3"].pad("T")
    j4_t = fps["J4"].pad("T")
    _draw_minimap(
        ctx,
        bot_surf,
        bot_bbox,
        816.0,
        116.0,
        110.0,
        [(vp1_crop, ORANGE_OUT), (vp2_crop, EMERALD_SIG)],
        dots=[(j3_t.back_x, j3_t.y, ORANGE_OUT), (j4_t.back_x, j4_t.y, ORANGE_OUT)],
    )

    return _finish_surface(surf, ctx, W, H, "05_phase3_bias_offset_led.png")


# ---------------------------------------------------------------------------
# Figure 06 — Phase 4 Audio Signal Chain Walk
# ---------------------------------------------------------------------------


def render_06_phase4_signal_chain(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 980, 725
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 4 — STAGE-BY-STAGE SIGNAL CHAIN WALK (100–200 Hz, 10 Vpp / ±5 V SINE INTO J1)",
        [
            (EMERALD_SIG, "Preamp & Precision Rectifier (TP4–TP5)"),
            (CYAN_CTL, "Skew Limiter & Env Buffer (TP10, TP6)"),
            (ORANGE_OUT, "Offset, SMOOTH & Outputs (TP11, TP7–TP8)"),
            (PURPLE_HIZ, "SW1 SMOOTH / D4–D5"),
        ],
    )

    # Left Viewport: Right-half B.Cu strip (back_X = 6.0..30.0, Y = 16.5..71.5 => 24 x 55 mm => 264 x 605 px)
    vp_rect = (42.0, 102.0, 264.0, 605.0)
    vp_crop = (6.0, 16.5, 30.0, 71.5)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp_rect, vp_crop)
    vp_mm = _draw_viewport_rulers(ctx, vp_rect, vp_crop, 5.0)
    _draw_text(
        ctx,
        "B.Cu SIGNAL COLUMN (TOP -> BOT)",
        42.0,
        76.0,
        size=10.0,
        color=EMERALD_SIG,
        bold=True,
    )

    # Highlight D4 / D5 and SW1 top edge
    d4, d5 = fps["D4"], fps["D5"]
    _draw_bracket_box(
        ctx,
        *vp_mm(d4.back_x - 2.3, d4.y - 1.3),
        *vp_mm(d4.back_x + 2.3, d4.y + 1.3),
        CYAN_CTL,
    )
    _draw_bracket_box(
        ctx,
        *vp_mm(d5.back_x - 2.3, d5.y - 1.3),
        *vp_mm(d5.back_x + 2.3, d5.y + 1.3),
        CYAN_CTL,
    )
    _draw_pill(ctx, *vp_mm(13.2, 27.5), "D4 ATK", CYAN_CTL, font_size=8.5, height=15.5)
    _draw_pill(ctx, *vp_mm(13.2, 40.8), "D5 REL", CYAN_CTL, font_size=8.5, height=15.5)
    _draw_bracket_box(ctx, *vp_mm(21.2, 68.0), *vp_mm(24.8, 70.6), PURPLE_HIZ)
    _draw_leader(ctx, [vp_mm(17.5, 69.3), vp_mm(21.2, 69.3)], PURPLE_HIZ)
    _draw_pill(
        ctx, *vp_mm(14.5, 69.3), "SW1 SMOOTH", PURPLE_HIZ, font_size=8.5, height=15.5
    )

    stages = [
        (
            "TP4",
            "PRE",
            "U1A ×2.00 Preamp",
            "Sweep RV1 CW -> 20.0 Vpp (±10 V, 0 clip); set 10.0 Vpp (±5 V)",
            EMERALD_SIG,
        ),
        (
            "TP9",
            "HWR",
            "U1B / D3 Half-Wave",
            "Clean negative HWR: 0 V to −5.0 V with crisp zero transitions",
            EMERALD_SIG,
        ),
        (
            "TP5",
            "RECT",
            "U1C Full-Wave Rect.",
            "Clean positive FWR: 0 V to +5.0 V @ 2f (adjacent lobes ≤ 1%)",
            EMERALD_SIG,
        ),
        (
            "TP10",
            "DRV",
            "U1D Skew Driver",
            "Clean slew swing while sweeping RV2/RV3 — ZERO HF oscillation",
            CYAN_CTL,
        ),
        (
            "TP6",
            "ENV",
            "U2A Env. Buffer",
            "Tracks +5 V lobes (0 dead-zone); RV2/RV3 indep.; SW2 UP = ~10.4×",
            CYAN_CTL,
        ),
        (
            "TP11",
            "OFF",
            "RV4 Offset Wiper",
            "Sweeps ±4.98 V DC baseline with 0.00% amplitude modulation",
            ORANGE_OUT,
        ),
        (
            "TP7",
            "INV",
            "U2B Summer / SMOOTH",
            "SW1 UP (SMOOTH): 100 Hz ripple −11.1 dB, DC peak drops 0.00%",
            ORANGE_OUT,
        ),
        (
            "TP8",
            "OUT",
            "U2C Unity Inverter",
            "Matches J3 (OUT); exact mirror inverse of TP7 / J4 (INV_OUT)",
            ORANGE_OUT,
        ),
    ]

    card_x = 342.0
    card_w = 468.0
    card_h = 60.0
    y0_card = 114.0
    step_card = 74.0

    for idx, (ref, silk, title, spec, col) in enumerate(stages):
        fp = fps[ref]
        tx, ty = vp_mm(fp.back_x, fp.y)
        _draw_target_ring(ctx, tx, ty, 6.8, col, width=2.0)

        cy = y0_card + idx * step_card
        _draw_leader(ctx, [(card_x, cy), (tx + 12.0, cy), (tx, ty)], col, width=1.5)
        _draw_card_box(
            ctx, card_x, cy - card_h / 2.0, card_w, card_h, col, r=7.0, line_width=1.2
        )
        _, _, bx1, _ = _draw_pill(
            ctx,
            card_x + 10.0,
            cy - 10.0,
            f"{idx + 1}. {ref} ({silk})",
            col,
            font_size=9.8,
            pad_x=7.0,
            height=18.0,
            align="left",
        )
        _draw_text(ctx, title, bx1 + 8.0, cy - 6.0, size=11.0, bold=True)
        _draw_text(ctx, spec, card_x + 12.0, cy + 16.0, size=9.8, color=TEXT_PRIMARY)

    # Far-right Mini-map + Scope setup box
    j1_t = fps["J1"].pad("T")
    tp1, tp12 = fps["TP1"], fps["TP12"]
    _draw_minimap(
        ctx,
        bot_surf,
        bot_bbox,
        838.0,
        116.0,
        112.0,
        [(vp_crop, EMERALD_SIG)],
        dots=[
            (j1_t.back_x, j1_t.y, EMERALD_SIG),
            (tp1.back_x, tp1.y, CYAN_CTL),
            (tp12.back_x, tp12.y, CYAN_CTL),
        ],
    )
    _draw_card_box(
        ctx, 824.0, 544.0, 140.0, 152.0, BORDER_SUBTLE, fill=BG_HEADER, r=7.0
    )
    _draw_text(ctx, "SCOPE SETUP", 834.0, 566.0, size=10.0, color=CYAN_CTL, bold=True)
    _draw_text(ctx, "• 10× probes", 834.0, 588.0, size=9.4, color=TEXT_PRIMARY)
    _draw_text(ctx, "• GND -> TP1/TP12", 834.0, 606.0, size=9.4, color=CYAN_CTL)
    _draw_text(ctx, "• Sig -> J1 (IN)", 834.0, 624.0, size=9.4, color=EMERALD_SIG)
    _draw_text(ctx, "  100–200 Hz, ±5 V", 834.0, 641.0, size=9.2, color=TEXT_MUTED)
    _draw_text(ctx, "• Outputs:", 834.0, 662.0, size=9.4, color=TEXT_PRIMARY)
    _draw_text(ctx, "  J3=TP8, J4=TP7", 834.0, 679.0, size=9.2, color=ORANGE_OUT)

    return _finish_surface(surf, ctx, W, H, "06_phase4_signal_chain.png")


# ---------------------------------------------------------------------------
# Figure 07 — Phase 5 SLEW IN Normaling & Bipolar Timing Bank
# ---------------------------------------------------------------------------


def render_07_phase5_slew_and_timing(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 960, 630
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "PHASE 5 — SLEW IN (J2) NORMALING & HIGH-Z TIMING CAPACITOR BANK",
        [
            (
                PURPLE_HIZ,
                "High-Z NET_ENV_CAP / NET_SLOW_CAPS (Clean w/ 99% IPA if SLOW droops)",
            ),
            (EMERALD_SIG, "J2 Normaling & Slew Input Path"),
            (CYAN_CTL, "TP6 (ENV) Timing Probe"),
        ],
    )

    # Left Viewport: Timing cap bank + SW2 + TP6 -> 30 x 39 mm => 300 x 390 px
    vp1_rect = (42.0, 102.0, 300.0, 390.0)
    vp1_crop = (0.0, 38.0, 30.0, 77.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp1_rect, vp1_crop)
    vp1_mm = _draw_viewport_rulers(ctx, vp1_rect, vp1_crop, 5.0)
    _draw_text(
        ctx,
        "TIMING CAPS & SW2 (NET_ENV_CAP / SLOW)",
        42.0,
        76.0,
        size=9.8,
        color=PURPLE_HIZ,
        bold=True,
    )

    # High-Z brackets around C11-C13 and SW2
    _draw_bracket_box(ctx, *vp1_mm(1.2, 39.2), *vp1_mm(9.5, 64.5), PURPLE_HIZ)
    _draw_pill(
        ctx,
        *vp1_mm(15.6, 48.0),
        "C11 (470n) + C12/C13 (2.2µ)",
        PURPLE_HIZ,
        font_size=8.6,
        height=16.5,
    )
    _draw_leader(ctx, [vp1_mm(9.6, 51.0), vp1_mm(7.8, 51.0)], PURPLE_HIZ)

    _draw_bracket_box(ctx, *vp1_mm(5.0, 68.0), *vp1_mm(9.2, 76.0), PURPLE_HIZ)
    _draw_pill(
        ctx,
        *vp1_mm(15.0, 66.8),
        "SW2 (99% IPA ZONE)",
        PURPLE_HIZ,
        font_size=8.5,
        height=16.0,
    )
    _draw_leader(ctx, [vp1_mm(10.8, 68.0), vp1_mm(8.8, 70.5)], PURPLE_HIZ)

    tp6 = fps["TP6"]
    _draw_target_ring(ctx, *vp1_mm(tp6.back_x, tp6.y), 6.8, CYAN_CTL, width=2.0)
    _draw_pill(
        ctx, *vp1_mm(20.6, 44.2), "TP6 (ENV)", CYAN_CTL, font_size=8.8, height=16.0
    )
    _draw_leader(ctx, [vp1_mm(23.5, 45.2), vp1_mm(tp6.back_x, tp6.y)], CYAN_CTL)

    # Middle Viewport: J2 Normaling Path -> 24 x 26 mm => 360 x 390 px
    vp2_rect = (398.0, 102.0, 360.0, 390.0)
    vp2_crop = (-1.0, 74.0, 23.0, 100.0)
    _paint_master_region(ctx, bot_surf, bot_bbox, vp2_rect, vp2_crop)
    vp2_mm = _draw_viewport_rulers(ctx, vp2_rect, vp2_crop, 5.0)
    _draw_text(
        ctx,
        "J2 (SLEW IN) NORMALING & U2.3 HIGH-Z NODE",
        398.0,
        76.0,
        size=9.8,
        color=EMERALD_SIG,
        bold=True,
    )

    r15 = fps["R15"]
    r17 = fps["R17"]
    j2_tn = fps["J2"].pad("TN")
    j2_t = fps["J2"].pad("T")
    u1_p12 = fps["U1"].pad("12")
    u2_p3 = fps["U2"].pad("3")

    _draw_target_ring(ctx, *vp2_mm(r15.back_x, r15.y), 5.8, EMERALD_SIG, width=1.8)
    _draw_target_ring(ctx, *vp2_mm(j2_tn.back_x, j2_tn.y), 6.5, EMERALD_SIG, width=2.0)
    _draw_target_ring(ctx, *vp2_mm(j2_t.back_x, j2_t.y), 6.5, CYAN_CTL, width=2.0)
    _draw_target_ring(ctx, *vp2_mm(r17.back_x, r17.y), 5.8, CYAN_CTL, width=1.8)
    _draw_target_ring(ctx, *vp2_mm(u1_p12.back_x, u1_p12.y), 5.5, CYAN_CTL, width=2.0)
    _draw_target_ring(ctx, *vp2_mm(u2_p3.back_x, u2_p3.y), 6.0, PURPLE_HIZ, width=2.0)

    # Arrows showing normaling signal path: R15 -> J2.TN -> J2.T -> R17 -> U1.12
    _draw_arrow(
        ctx,
        vp2_mm(r15.back_x, r15.y + 0.6),
        vp2_mm(j2_tn.back_x - 0.5, j2_tn.y - 0.5),
        EMERALD_SIG,
    )
    _draw_arrow(
        ctx,
        vp2_mm(j2_tn.back_x, j2_tn.y + 1.0),
        vp2_mm(j2_t.back_x, j2_t.y - 1.0),
        EMERALD_SIG,
    )
    _draw_arrow(
        ctx,
        vp2_mm(j2_t.back_x - 0.5, j2_t.y - 0.5),
        vp2_mm(r17.back_x + 0.5, r17.y + 0.5),
        CYAN_CTL,
    )
    _draw_arrow(
        ctx,
        vp2_mm(r17.back_x + 1.4, r17.y),
        vp2_mm(u1_p12.back_x - 0.6, u1_p12.y),
        CYAN_CTL,
    )

    _draw_pill(
        ctx, *vp2_mm(7.2, 76.2), "R15 (1k)", EMERALD_SIG, font_size=8.6, height=15.5
    )
    _draw_leader(ctx, [vp2_mm(5.4, 76.5), vp2_mm(r15.back_x + 0.7, r15.y)], EMERALD_SIG)

    _draw_pill(
        ctx,
        *vp2_mm(13.8, 80.2),
        "J2.TN (BREAKS ON PATCH)",
        EMERALD_SIG,
        font_size=8.6,
        height=16.5,
    )
    _draw_leader(
        ctx, [vp2_mm(9.6, 80.8), vp2_mm(j2_tn.back_x + 0.6, j2_tn.y)], EMERALD_SIG
    )

    _draw_pill(
        ctx, *vp2_mm(5.0, 93.4), "J2.T (SLEW IN)", CYAN_CTL, font_size=8.8, height=16.5
    )
    _draw_leader(ctx, [vp2_mm(6.5, 92.4), vp2_mm(j2_t.back_x, j2_t.y + 0.5)], CYAN_CTL)

    _draw_pill(
        ctx, *vp2_mm(8.0, 86.9), "R17 -> U1.12", CYAN_CTL, font_size=8.5, height=15.5
    )
    _draw_pill(
        ctx,
        *vp2_mm(6.0, 97.4),
        "U2.3 HIGH-Z (IPA)",
        PURPLE_HIZ,
        font_size=8.6,
        height=16.5,
    )
    _draw_leader(
        ctx, [vp2_mm(9.5, 97.4), vp2_mm(u2_p3.back_x - 0.5, u2_p3.y)], PURPLE_HIZ
    )

    # Bottom timing reference bar (x = 42..758, y = 512..608)
    _draw_card_box(ctx, 42.0, 512.0, 716.0, 96.0, BORDER_SUBTLE, fill=BG_HEADER, r=8.0)
    _draw_text(
        ctx,
        "0 -> +5 V GATE SPOT-CHECK TIMING (SW2 × RV2/RV3 · BIPOLAR ±5 V SLEW SYMMETRIC)",
        58.0,
        535.0,
        size=10.5,
        bold=True,
    )
    timings = [
        ("FAST + CCW", "~0.29 ms rise / ~0.18 ms fall", CYAN_CTL),
        ("FAST + CW", "~289 ms rise / ~178 ms fall", CYAN_CTL),
        ("SLOW + CCW", "~3.0 ms rise / ~1.8 ms fall", PURPLE_HIZ),
        ("SLOW + CW", "~3.0 s rise / ~1.84 s fall (clean hold)", PURPLE_HIZ),
    ]
    for idx, (mode_s, t_s, col) in enumerate(timings):
        cx = 58.0 + (idx % 2) * 355.0
        cy = 563.0 if idx < 2 else 591.0
        _draw_pill(
            ctx,
            cx,
            cy - 4.0,
            mode_s,
            col,
            font_size=9.0,
            pad_x=6.0,
            height=17.0,
            align="left",
        )
        _draw_text(ctx, t_s, cx + 92.0, cy, size=10.0, color=TEXT_PRIMARY)

    # Far-right Mini-map
    _draw_minimap(
        ctx,
        bot_surf,
        bot_bbox,
        802.0,
        116.0,
        118.0,
        [(vp1_crop, PURPLE_HIZ), (vp2_crop, EMERALD_SIG)],
    )

    return _finish_surface(surf, ctx, W, H, "07_phase5_slew_and_timing.png")


# ---------------------------------------------------------------------------
# Figure 08 — Troubleshooting Quick Reference Hotspots (1–6)
# ---------------------------------------------------------------------------


def render_08_troubleshooting_hotspots(
    fps: dict[str, FootprintInfo],
    bot_surf: cairo.ImageSurface,
    bot_bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    W, H = 980, 1240
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    _draw_header(
        ctx,
        W,
        "TROUBLESHOOTING QUICK REFERENCE — B.Cu FAULT HOTSPOTS (1–6)",
        [
            (RED_POS, "1 Power / Polarity"),
            (ORANGE_OUT, "2 LED1 Swapped"),
            (AMBER_POL, "3 D3 / TP5 Rectifier"),
            (PURPLE_HIZ, "4 Skew / High-Z Droop"),
            (BLUE_NEG, "5 SW1/SW2 Inverted"),
            (CYAN_CTL, "6 J2 Normal Path"),
        ],
    )

    BX0, BY0, BW, BH = 340.0, 96.0, 300.0, 1080.0
    _paint_master_region(
        ctx, bot_surf, bot_bbox, (BX0, BY0, BW, BH), (0.0, 0.0, BOARD_W, BOARD_H)
    )
    ctx.save()
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.2)
    ctx.rectangle(BX0 - 0.5, BY0 - 0.5, BW + 1.0, BH + 1.0)
    ctx.stroke()
    ctx.restore()

    def to_px(bx: float, y: float) -> tuple[float, float]:
        return BX0 + (bx / BOARD_W) * BW, BY0 + (y / BOARD_H) * BH

    _draw_text(ctx, "back_X = 0", BX0, BY0 - 6, size=9.5, color=TEXT_MUTED, mono=True)
    _draw_text(
        ctx,
        "B.Cu DIRECT VIEW (Y = 0)",
        BX0 + BW / 2,
        BY0 - 6,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )
    _draw_text(
        ctx,
        "back_X = 30",
        BX0 + BW,
        BY0 - 6,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="right",
    )
    _draw_text(
        ctx,
        "Y = 108 mm (BOTTOM)",
        BX0 + BW / 2,
        BY0 + BH + 18,
        size=9.5,
        color=TEXT_MUTED,
        mono=True,
        align="center",
    )

    # Fault Zone Highlights on Board (badges kept clear of pads)
    # 1: Dead rail / high current (J_PWR, D1, D2, C2, TP2/TP3)
    _draw_bracket_box(ctx, *to_px(1.5, 1.0), *to_px(20.5, 39.2), RED_POS)
    _draw_badge(ctx, *to_px(10.5, 22.0), "1", RED_POS)

    # 2: LED1 reversed
    _draw_bracket_box(ctx, *to_px(12.2, 70.0), *to_px(17.8, 74.0), ORANGE_OUT)
    _draw_badge(ctx, *to_px(15.0, 68.2), "2", ORANGE_OUT)

    # 3: Half-wave / asymmetric TP5 (D3 + TP9/TP5)
    _draw_bracket_box(ctx, *to_px(24.5, 76.5), *to_px(29.0, 82.2), AMBER_POL)
    _draw_target_ring(
        ctx, *to_px(fps["TP9"].back_x, fps["TP9"].y), 7.5, AMBER_POL, width=2.0
    )
    _draw_target_ring(
        ctx, *to_px(fps["TP5"].back_x, fps["TP5"].y), 7.5, AMBER_POL, width=2.0
    )
    _draw_badge(ctx, *to_px(23.0, 79.3), "3", AMBER_POL)

    # 4: Dead-zone or SLOW droop (D4/D5 + C11-C13 + U2.3)
    _draw_bracket_box(ctx, *to_px(1.5, 39.8), *to_px(9.2, 64.2), PURPLE_HIZ)
    _draw_bracket_box(ctx, *to_px(16.6, 25.8), *to_px(21.4, 42.4), PURPLE_HIZ)
    _draw_target_ring(
        ctx,
        *to_px(fps["U2"].pad("3").back_x, fps["U2"].pad("3").y),
        6.5,
        PURPLE_HIZ,
        width=2.0,
    )
    _draw_badge(ctx, *to_px(5.4, 52.0), "4", PURPLE_HIZ)
    _draw_badge(ctx, *to_px(21.5, 34.0), "4", PURPLE_HIZ, r=8.5, font_size=9.5)

    # 5: SW1 / SW2 inverted
    _draw_bracket_box(ctx, *to_px(5.0, 68.0), *to_px(9.0, 76.0), BLUE_NEG)
    _draw_bracket_box(ctx, *to_px(21.0, 68.0), *to_px(25.0, 76.0), BLUE_NEG)
    _draw_badge(ctx, *to_px(23.0, 76.8), "5", BLUE_NEG)

    # 6: No audio when J2 unpatched (J2.TN -> J2.T -> R15 -> R17 -> U1.12)
    _draw_bracket_box(ctx, *to_px(2.0, 75.8), *to_px(13.5, 91.8), CYAN_CTL)
    _draw_badge(ctx, *to_px(5.2, 81.2), "6", CYAN_CTL)

    # Helper to draw margin diagnostic cards
    def draw_diag_card(
        side: str,
        cy: float,
        num: str,
        title: str,
        line1: str,
        line2: str,
        col: tuple[float, float, float],
        leader_pts: list[tuple[float, float]],
    ) -> None:
        cw, ch = 290.0, 102.0
        cx0 = 20.0 if side == "left" else 670.0
        _draw_leader(ctx, leader_pts, col, dot_end=True, width=1.6)
        _draw_card_box(ctx, cx0, cy - ch / 2.0, cw, ch, col, r=8.0)
        _draw_badge(ctx, cx0 + 22.0, cy - 26.0, num, col, r=10.5, font_size=11.0)
        _draw_text(ctx, title, cx0 + 40.0, cy - 22.0, size=10.8, color=col, bold=True)
        _draw_text(ctx, line1, cx0 + 14.0, cy + 8.0, size=9.8, color=TEXT_PRIMARY)
        _draw_text(ctx, line2, cx0 + 14.0, cy + 28.0, size=9.6, color=TEXT_MUTED)

    # Left margin cards (1, 4, 6) — ordered top to bottom
    draw_diag_card(
        "left",
        286.0,
        "1",
        "Dead Rail / High Current",
        "Power OFF! Check D1/D2 cathode LEFT,",
        "C2 + OUTER/LEFT, and J_PWR notch right",
        RED_POS,
        [(310.0, 286.0), to_px(1.5, 19.0)],
    )
    draw_diag_card(
        "left",
        616.0,
        "4",
        "~0.6 V Gap or SLOW Droop",
        "D4 K-RIGHT / D5 K-LEFT (1N4148W only);",
        "Clean C11–C13, SW2, U2.3 w/ 99% IPA",
        PURPLE_HIZ,
        [(310.0, 616.0), to_px(1.5, 52.0)],
    )
    draw_diag_card(
        "left",
        917.0,
        "6",
        "No Env. Audio (J2 Unpatched)",
        "J2.TN switch open/bent or cold joint:",
        "Probe TP5 -> J2.TN -> J2.T -> R17 -> U1.12",
        CYAN_CTL,
        [(310.0, 917.0), to_px(2.0, 82.1)],
    )

    # Right side: small non-crossing TP9/TP5 pill for #3, then ordered cards 2, 5, 3!
    p_tp9 = to_px(fps["TP9"].back_x, fps["TP9"].y)
    p_tp5 = to_px(fps["TP5"].back_x, fps["TP5"].y)
    _draw_leader(ctx, [(670.0, 393.0), (648.0, 393.0), p_tp9], AMBER_POL, width=1.4)
    _draw_leader(ctx, [(670.0, 393.0), (648.0, 393.0), p_tp5], AMBER_POL, width=1.4)
    _draw_pill(
        ctx,
        670.0,
        393.0,
        "3 · Check TP9 (HWR) / TP5 (RECT)",
        AMBER_POL,
        font_size=9.4,
        height=20.0,
        align="left",
    )

    draw_diag_card(
        "right",
        612.0,
        "2",
        "LED1 RED When OFFSET CW",
        "LED1 inserted backward — desolder &",
        "flip 180° (Pad 1 +V Green RIGHT on B.Cu)",
        ORANGE_OUT,
        [(670.0, 612.0), (545.0, 756.0), to_px(15.0, 70.0)],
    )
    draw_diag_card(
        "right",
        796.0,
        "5",
        "SW1 / SW2 Inverted (UP=ON)",
        "Switch rotated or wrong pins soldered:",
        "Pin 2 (ctr) <-> Pin 3 (bot) when lever UP",
        BLUE_NEG,
        [(670.0, 796.0), to_px(25.0, 72.0)],
    )
    draw_diag_card(
        "right",
        936.0,
        "3",
        "Half-Wave / Skewed TP5",
        "Check D3 (BAT54S): 2 pins RIGHT / 1 LEFT",
        "and confirm negative HWR wave at TP9",
        AMBER_POL,
        [(670.0, 936.0), to_px(29.0, 79.3)],
    )

    return _finish_surface(surf, ctx, W, H, "08_troubleshooting_hotspots.png")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fps = load_pcb_footprints()
    print(f"Loaded {len(fps)} footprints from {PCB_PATH.name}.")

    bot_surf, bot_bbox, top_surf, top_bbox = render_master_boards()

    render_00_test_point_map(fps, bot_surf, bot_bbox)
    render_01_initial_controls_front(fps, top_surf, top_bbox)
    render_02_phase1_polarity_check(fps, bot_surf, bot_bbox)
    render_03_phase1_cold_checks(fps, bot_surf, bot_bbox)
    render_04_phase2_power_up(fps, bot_surf, bot_bbox)
    render_05_phase3_bias_offset_led(fps, bot_surf, bot_bbox)
    render_06_phase4_signal_chain(fps, bot_surf, bot_bbox)
    render_07_phase5_slew_and_timing(fps, bot_surf, bot_bbox)
    render_08_troubleshooting_hotspots(fps, bot_surf, bot_bbox)


if __name__ == "__main__":
    main()
