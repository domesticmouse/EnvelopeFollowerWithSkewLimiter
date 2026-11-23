#!/opt/homebrew/bin/python3
"""Generate annotated hand-assembly placement screenshots from envelope_follower.kicad_pcb.

Renders `envelope_follower.kicad_pcb` once per side (`--side bottom` and `--side top`)
at high resolution via `kicad-cli pcb render` with SMD 3D models enabled (`insert`) and
THT/DNP 3D bodies hidden (`normal` / `dnp`), matching the bare-pad & silkscreen view a
builder sees when hand-assembling after JLCPCB PCBA, then produces:
  - `images/hand_assembly/test_points_overview.png` (12 optional B.Cu test points)
  - `images/hand_assembly/back_overview.png` (7 required B.Cu THT parts)
  - `images/hand_assembly/front_overview.png` (11 required F.Cu panel controls)
  - `images/hand_assembly/<REF>.png` (18 zoomed, rulered, mini-mapped part cards)
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
OUT_DIR = ROOT / "images" / "hand_assembly"

KICAD_CLI = pathlib.Path("/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")
KICAD_3D_DIR = "/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels"

# Exact PCB outline origin and dimensions in envelope_follower.kicad_pcb (mm)
BOARD_X0 = 100.0
BOARD_Y0 = 40.0
BOARD_W = 30.0
BOARD_H = 108.0

MASTER_W = 2400
MASTER_H = 7200

# Card geometry (px) — matches checklists/generate_pcba_alignment_images.py
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

ACCENT_CRIT = (245 / 255, 158 / 255, 11 / 255)  # Amber (keyed/polarized/switched)
BRACKET_CRIT = (250 / 255, 204 / 255, 21 / 255)  # Bright yellow
ACCENT_CAP = (56 / 255, 189 / 255, 248 / 255)  # Sky blue (film caps / jacks / TP sig)
BRACKET_PASSIVE = (34 / 255, 211 / 255, 238 / 255)  # Cyan
ACCENT_POT = (52 / 255, 211 / 255, 153 / 255)  # Emerald (pots / GND TPs)
EXT_ORANGE = (249 / 255, 115 / 255, 22 / 255)  # Feature/warning badge

FONT_SANS = "Helvetica Neue"
FONT_MONO = "Menlo"


@dataclass
class HandPart:
    ref: str
    layer: str  # "F.Cu" or "B.Cu"
    jlcpcb_class: str  # "Manual THT" or "DNP THT"
    value: str
    mpn: str
    manufacturer: str
    center_x: float
    center_y: float
    bbox_min_x: float
    bbox_min_y: float
    bbox_max_x: float
    bbox_max_y: float
    pads: dict[str, tuple[float, float, str]]  # pad_num -> (vx, vy, shape)


@dataclass(frozen=True)
class PartSpec:
    title: str
    meta: str
    badge: str | None
    category: str  # "crit" | "cap" | "pot"
    crop_w: float
    crop_h: float
    tick_step: float
    margin: float
    ov_label: str


PART_SPECS: dict[str, PartSpec] = {
    # Back-side (B.Cu) THT parts (7)
    "C7": PartSpec(
        "470 nF / 63 V",
        "5 mm Box Film",
        None,
        "cap",
        22.0,
        16.5,
        5.0,
        0.30,
        "C7 · 470nF Film",
    ),
    "C11": PartSpec(
        "470 nF / 63 V",
        "5 mm Box Film",
        None,
        "cap",
        22.0,
        16.5,
        5.0,
        0.30,
        "C11 · 470nF Film",
    ),
    "C12": PartSpec(
        "2.2 µF / 50 V",
        "5 mm Box Film",
        None,
        "cap",
        22.0,
        16.5,
        5.0,
        0.30,
        "C12 · 2.2µF Film",
    ),
    "C13": PartSpec(
        "2.2 µF / 50 V",
        "5 mm Box Film",
        None,
        "cap",
        22.0,
        16.5,
        5.0,
        0.30,
        "C13 · 2.2µF Film",
    ),
    "J_PWR": PartSpec(
        "2×5 IDC Power",
        "Shrouded",
        "KEYED",
        "crit",
        36.0,
        27.0,
        5.0,
        0.35,
        "J_PWR · 2×5 IDC (Key Inward)",
    ),
    "C1": PartSpec(
        "47 µF / 35 V",
        "+12V · A-7257",
        "POL",
        "crit",
        24.0,
        18.0,
        5.0,
        0.30,
        "C1 · 47µF (+ Right)",
    ),
    "C2": PartSpec(
        "47 µF / 35 V",
        "-12V · A-7257",
        "REVERSED",
        "crit",
        24.0,
        18.0,
        5.0,
        0.30,
        "C2 · 47µF (+ Left! Rev)",
    ),
    # Front-side (F.Cu) panel controls (11)
    "RV1": PartSpec(
        "GAIN · A100K",
        "Alpha · A-1855",
        None,
        "pot",
        32.0,
        24.0,
        5.0,
        0.25,
        "RV1 · GAIN A100K (A-1855)",
    ),
    "RV2": PartSpec(
        "ATK · A1M",
        "Alpha · A-1672",
        None,
        "pot",
        32.0,
        24.0,
        5.0,
        0.25,
        "RV2 · ATK A1M (A-1672)",
    ),
    "RV3": PartSpec(
        "REL · A1M",
        "Alpha · A-1672",
        None,
        "pot",
        32.0,
        24.0,
        5.0,
        0.25,
        "RV3 · REL A1M (A-1672)",
    ),
    "RV4": PartSpec(
        "OFFSET · B10K",
        "Alpha · A-8401",
        "DETENT",
        "pot",
        32.0,
        24.0,
        5.0,
        0.25,
        "RV4 · OFFSET B10K Detent",
    ),
    "SW1": PartSpec(
        "SMOOTH",
        "2MS1 · A-6087",
        None,
        "crit",
        24.0,
        18.0,
        5.0,
        0.30,
        "SW1 · SMOOTH (A-6087)",
    ),
    "SW2": PartSpec(
        "FAST / SLOW",
        "2MS1 · A-6087",
        None,
        "crit",
        24.0,
        18.0,
        5.0,
        0.30,
        "SW2 · FAST/SLOW (A-6087)",
    ),
    "LED1": PartSpec(
        "3 mm R/G LED",
        "A-1076",
        "POL",
        "crit",
        24.0,
        18.0,
        5.0,
        0.25,
        "LED1 · R/G LED (A-1076)",
    ),
    "J1": PartSpec(
        "IN", "WQP-PJ398SM", None, "cap", 32.0, 24.0, 5.0, 0.30, "J1 · IN (PJ398SM)"
    ),
    "J2": PartSpec(
        "SLEW IN",
        "WQP-PJ398SM",
        None,
        "cap",
        32.0,
        24.0,
        5.0,
        0.30,
        "J2 · SLEW IN (PJ398SM)",
    ),
    "J3": PartSpec(
        "OUT", "WQP-PJ398SM", None, "cap", 32.0, 24.0, 5.0, 0.30, "J3 · OUT (PJ398SM)"
    ),
    "J4": PartSpec(
        "INV_OUT",
        "WQP-PJ398SM",
        None,
        "cap",
        32.0,
        24.0,
        5.0,
        0.30,
        "J4 · INV_OUT (PJ398SM)",
    ),
}


def _category_colors(
    cat: str,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    if cat == "crit":
        return ACCENT_CRIT, BRACKET_CRIT
    if cat == "pot":
        return ACCENT_POT, ACCENT_POT
    return ACCENT_CAP, BRACKET_PASSIVE


def _iter_subblocks(text: str, kind: str):
    """Yield top-level matching S-expression blocks `(kind ...)` within `text`."""
    for m in re.finditer(rf"\({re.escape(kind)}\b", text):
        start = m.start()
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
                    yield text[start : i + 1]
                    break
            i += 1


def _transform_local_point(
    fx: float, fy: float, fp_rot_deg: float, lx: float, ly: float
) -> tuple[float, float]:
    """Rotate local KiCad footprint coords (CCW in Y-down PCB frame) into board coords."""
    a = math.radians(fp_rot_deg)
    bx = fx + lx * math.cos(a) + ly * math.sin(a)
    by = fy - lx * math.sin(a) + ly * math.cos(a)
    return bx, by


def _kicad_to_view(kx: float, ky: float, side: str) -> tuple[float, float]:
    if side == "B.Cu":
        return BOARD_W - (kx - BOARD_X0), ky - BOARD_Y0
    return kx - BOARD_X0, ky - BOARD_Y0


def load_hand_assembly_parts() -> tuple[dict[str, HandPart], dict[str, HandPart]]:
    """Parse all 18 Manual THT and 12 DNP THT footprints from envelope_follower.kicad_pcb."""
    pcb_text = PCB_PATH.read_text(encoding="utf-8")
    manual_parts: dict[str, HandPart] = {}
    tp_parts: dict[str, HandPart] = {}

    for blk in _iter_subblocks(pcb_text, "footprint"):
        props = dict(re.findall(r'\(property "([^"]+)" "([^"]*)"', blk))
        cls = props.get("JLCPCB_Class", "")
        if cls not in ("Manual THT", "DNP THT"):
            continue
        ref = props["Reference"]
        layer_m = re.search(r'\(layer "([^"]+)"\)', blk)
        if not layer_m:
            raise RuntimeError(f"Missing (layer ...) for {ref}")
        layer = layer_m.group(1)

        at_m = re.search(r"\n\t\t\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)", blk)
        if not at_m:
            raise RuntimeError(f"Missing (at ...) for {ref}")
        fx = float(at_m.group(1))
        fy = float(at_m.group(2))
        fp_rot = float(at_m.group(3) or 0.0)

        xs: list[float] = []
        ys: list[float] = []
        pads: dict[str, tuple[float, float, str]] = {}

        for pblk in _iter_subblocks(blk, "pad"):
            hm = re.search(r'\(pad "([^"]*)" (?:thru_hole|np_thru_hole) ([a-z]+)', pblk)
            am = re.search(r"\(at ([\d.-]+) ([\d.-]+)(?: ([\d.-]+))?\)", pblk)
            sm = re.search(r"\(size ([\d.-]+) ([\d.-]+)\)", pblk)
            if not hm or not am or not sm:
                continue
            pnum, pshape = hm.group(1), hm.group(2)
            px, py = float(am.group(1)), float(am.group(2))
            prot = float(am.group(3) or fp_rot)
            sx, sy = float(sm.group(1)), float(sm.group(2))
            pcx, pcy = _transform_local_point(fx, fy, fp_rot, px, py)
            pvx, pvy = _kicad_to_view(pcx, pcy, layer)
            if pnum and pnum not in pads:
                pads[pnum] = (pvx, pvy, pshape)

            pa = math.radians(prot)
            ca, sa = math.cos(pa), math.sin(pa)
            for dx in (-sx / 2.0, sx / 2.0):
                for dy in (-sy / 2.0, sy / 2.0):
                    cx = pcx + dx * ca + dy * sa
                    cy = pcy - dx * sa + dy * ca
                    vx, vy = _kicad_to_view(cx, cy, layer)
                    xs.append(vx)
                    ys.append(vy)

        side_prefix = layer[0]
        ok_layers = {
            f"{side_prefix}.SilkS",
            f"{side_prefix}.Fab",
            f"{side_prefix}.CrtYd",
        }
        for gkind in ("fp_line", "fp_rect"):
            for gblk in _iter_subblocks(blk, gkind):
                lm = re.search(r'\(layer "([^"]+)"\)', gblk)
                if not lm or lm.group(1) not in ok_layers:
                    continue
                sm = re.search(r"\(start ([\d.-]+) ([\d.-]+)\)", gblk)
                em = re.search(r"\(end ([\d.-]+) ([\d.-]+)\)", gblk)
                if sm and em:
                    for lx, ly in (
                        (float(sm.group(1)), float(sm.group(2))),
                        (float(em.group(1)), float(em.group(2))),
                    ):
                        vx, vy = _kicad_to_view(
                            *_transform_local_point(fx, fy, fp_rot, lx, ly), layer
                        )
                        xs.append(vx)
                        ys.append(vy)

        for gblk in _iter_subblocks(blk, "fp_circle"):
            lm = re.search(r'\(layer "([^"]+)"\)', gblk)
            if not lm or lm.group(1) not in ok_layers:
                continue
            cm = re.search(r"\(center ([\d.-]+) ([\d.-]+)\)", gblk)
            em = re.search(r"\(end ([\d.-]+) ([\d.-]+)\)", gblk)
            if cm and em:
                cx, cy = float(cm.group(1)), float(cm.group(2))
                r = math.hypot(float(em.group(1)) - cx, float(em.group(2)) - cy)
                for lx, ly in ((cx - r, cy - r), (cx + r, cy + r)):
                    vx, vy = _kicad_to_view(
                        *_transform_local_point(fx, fy, fp_rot, lx, ly), layer
                    )
                    xs.append(vx)
                    ys.append(vy)

        if not xs or not ys:
            raise RuntimeError(f"Empty geometry bounding box for {ref}")

        bmin_x, bmax_x = min(xs), max(xs)
        bmin_y, bmax_y = min(ys), max(ys)

        # Physical mechanical centers for pots (shaft) & jacks (bushing)
        if ref.startswith("RV"):
            cx, cy = _kicad_to_view(
                *_transform_local_point(fx, fy, fp_rot, 7.5, 2.5), layer
            )
        elif ref in ("J1", "J2", "J3", "J4"):
            cx, cy = _kicad_to_view(
                *_transform_local_point(fx, fy, fp_rot, 0.0, 6.48), layer
            )
        else:
            cx = 0.5 * (bmin_x + bmax_x)
            cy = 0.5 * (bmin_y + bmax_y)

        part = HandPart(
            ref=ref,
            layer=layer,
            jlcpcb_class=cls,
            value=props.get("Value", ""),
            mpn=props.get("MPN", ""),
            manufacturer=props.get("Manufacturer", ""),
            center_x=cx,
            center_y=cy,
            bbox_min_x=bmin_x,
            bbox_min_y=bmin_y,
            bbox_max_x=bmax_x,
            bbox_max_y=bmax_y,
            pads=pads,
        )
        if cls == "Manual THT":
            manual_parts[ref] = part
        else:
            tp_parts[ref] = part

    if len(manual_parts) != 18:
        raise RuntimeError(
            f"Expected 18 Manual THT parts, found {len(manual_parts)}: {sorted(manual_parts)}"
        )
    if len(tp_parts) != 12:
        raise RuntimeError(
            f"Expected 12 DNP THT test points, found {len(tp_parts)}: {sorted(tp_parts)}"
        )

    return manual_parts, tp_parts


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
            min_y = min(min_y, py)
            max_y = max(max_y, py)
            for px, a in enumerate(alphas):
                if a > 0:
                    min_x = min(min_x, px)
                    break
            for px in range(w - 1, -1, -1):
                if alphas[px] > 0:
                    max_x = max(max_x, px)
                    break

    if max_x < 0:
        raise RuntimeError("Rendered master PCB image is completely transparent.")
    return min_x, min_y, max_x + 1, max_y + 1


def render_master_boards() -> dict[
    str, tuple[cairo.ImageSurface, tuple[int, int, int, int]]
]:
    """Render high-res Bottom (B.Cu) & Top (F.Cu) boards with SMDs visible & THT hidden."""
    if not KICAD_CLI.exists():
        raise RuntimeError(f"kicad-cli not found at {KICAD_CLI}")

    renders: dict[str, tuple[cairo.ImageSurface, tuple[int, int, int, int]]] = {}
    with tempfile.TemporaryDirectory(prefix="kicad_hand_cfg_") as tmpdir:
        tmp_path = pathlib.Path(tmpdir)
        cfg_dir = tmp_path / "cfg"
        cfg_dir.mkdir()
        boot_png = tmp_path / "boot.png"

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
            raise RuntimeError(f"Expected 3D viewer config missing at {viewer_cfg}")

        cfg = json.loads(viewer_cfg.read_text(encoding="utf-8"))
        render = cfg.setdefault("render", {})
        # Keep JLCPCB SMD 3D models (`insert`) visible while hiding unpopulated THT (`normal`) & DNP bodies
        render["show_footprints_insert"] = True
        render["show_footprints_normal"] = False
        render["show_footprints_dnp"] = False
        render["show_footprints_virtual"] = False
        render["show_footprints_unspecified"] = False
        render["raytrace_shadows"] = True
        render["raytrace_anti_aliasing"] = True
        render["raytrace_post_processing"] = True
        viewer_cfg.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

        for side_flag, layer_key in (("bottom", "B.Cu"), ("top", "F.Cu")):
            master_png = tmp_path / f"master_{side_flag}.png"
            cmd = [
                str(KICAD_CLI),
                "pcb",
                "render",
                "--side",
                side_flag,
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
            res = subprocess.run(
                cmd, env=env, capture_output=True, text=True, check=False
            )
            if res.returncode != 0:
                raise RuntimeError(
                    f"Master kicad-cli ({side_flag}) failed:\n{res.stdout}\n{res.stderr}"
                )

            surf = cairo.ImageSurface.create_from_png(str(master_png))
            bbox = _find_alpha_bbox(surf)
            bx0, by0, bx1, by1 = bbox
            aspect = (by1 - by0) / max(1, bx1 - bx0)
            if abs(aspect - (BOARD_H / BOARD_W)) > 0.02:
                raise RuntimeError(
                    f"Unexpected {side_flag} PCB aspect ratio {aspect:.4f} (expected 3.6000)"
                )
            print(
                f"Master {side_flag} render OK: {surf.get_width()}x{surf.get_height()} px, "
                f"bbox=({bx0},{by0})..({bx1},{by1}) [{bx1 - bx0}x{by1 - by0}], aspect={aspect:.4f}"
            )
            renders[layer_key] = (surf, bbox)

    return renders


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


def _measure_text(
    ctx: cairo.Context,
    text: str,
    *,
    size: float,
    bold: bool = False,
    mono: bool = False,
) -> float:
    ctx.save()
    ctx.select_font_face(
        FONT_MONO if mono else FONT_SANS,
        cairo.FONT_SLANT_NORMAL,
        cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL,
    )
    ctx.set_font_size(size)
    ext = ctx.text_extents(text)
    ctx.restore()
    return ext.width


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
    for _ in range(14):
        for i in range(1, n):
            ys[i] = max(ys[i], ys[i - 1] + min_gap)
        ys[-1] = min(ys[-1], y_max)
        for i in range(n - 2, -1, -1):
            ys[i] = min(ys[i], ys[i + 1] - min_gap)
        ys[0] = max(ys[0], y_min)
        for i in range(n):
            lo = y_min if i == 0 else ys[i - 1] + min_gap
            hi = y_max if i == n - 1 else ys[i + 1] - min_gap
            ys[i] = max(lo, min(hi, 0.5 * ys[i] + 0.5 * targets[i]))
    return ys


def _draw_overview_frame(
    ctx: cairo.Context,
    title: str,
    legend: list[tuple[tuple[float, float, float], str]],
    x_left_label: str,
    x_right_label: str,
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> None:
    ctx.set_source_rgb(*BG_CANVAS)
    ctx.paint()

    ctx.set_source_rgb(*BG_HEADER)
    ctx.rectangle(0, 0, OV_W, 64)
    ctx.fill()
    ctx.set_source_rgb(*BORDER_SUBTLE)
    ctx.set_line_width(1.0)
    ctx.move_to(0, 64.5)
    ctx.line_to(OV_W, 64.5)
    ctx.stroke()

    _draw_text(ctx, title, 24, 28, size=14.5, bold=True)

    lx = 24.0
    for color, label in legend:
        ctx.arc(lx + 5, 48, 4.5, 0, 2 * math.pi)
        ctx.set_source_rgb(*color)
        ctx.fill()
        w_txt, _ = _draw_text(ctx, label, lx + 14, 52, size=11.0, color=TEXT_MUTED)
        lx += w_txt + 28.0

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

    _draw_text(
        ctx, x_left_label, OV_BX0, OV_BY0 - 6, size=10.0, color=TEXT_MUTED, mono=True
    )
    _draw_text(
        ctx,
        x_right_label,
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


def _to_ov(vx: float, vy: float) -> tuple[float, float]:
    return OV_BX0 + (vx / BOARD_W) * OV_BW, OV_BY0 + (vy / BOARD_H) * OV_BH


def _draw_ov_leader_and_pill(
    ctx: cairo.Context,
    side: str,
    pill_y: float,
    target_px: tuple[float, float],
    elbow_offset: float,
    pill_text: str,
    accent: tuple[float, float, float],
    *,
    waypoints: list[tuple[float, float]] | None = None,
) -> None:
    pill_edge_x = OV_BX0 - 38.0 if side == "left" else OV_BX0 + OV_BW + 38.0
    elbow_x = OV_BX0 - elbow_offset if side == "left" else OV_BX0 + OV_BW + elbow_offset
    cx, cy = target_px

    ctx.save()
    ctx.move_to(pill_edge_x, pill_y)
    ctx.line_to(elbow_x, pill_y)
    if waypoints:
        for wx, wy in waypoints:
            ctx.line_to(wx, wy)
    ctx.line_to(cx, cy)
    ctx.set_source_rgba(*DARK_HALO, 0.85)
    ctx.set_line_width(3.2)
    ctx.stroke_preserve()
    ctx.set_source_rgba(*accent, 0.90)
    ctx.set_line_width(1.4)
    ctx.stroke()

    ctx.arc(cx, cy, 4.0, 0, 2 * math.pi)
    ctx.set_source_rgba(*DARK_HALO, 0.95)
    ctx.fill()
    ctx.arc(cx, cy, 2.5, 0, 2 * math.pi)
    ctx.set_source_rgb(*accent)
    ctx.fill()
    ctx.restore()

    _draw_pill(
        ctx,
        pill_edge_x,
        pill_y,
        pill_text,
        accent,
        font_size=10.5,
        pad_x=8.5,
        height=21.0,
        align="right" if side == "left" else "left",
    )


def _draw_ov_bbox_highlight(
    ctx: cairo.Context,
    part: HandPart,
    accent: tuple[float, float, float],
) -> None:
    x0, y0 = _to_ov(part.bbox_min_x, part.bbox_min_y)
    x1, y1 = _to_ov(part.bbox_max_x, part.bbox_max_y)
    ctx.save()
    ctx.set_dash([3.5, 3.0])
    ctx.set_source_rgba(*DARK_HALO, 0.75)
    ctx.set_line_width(2.4)
    ctx.rectangle(x0, y0, x1 - x0, y1 - y0)
    ctx.stroke_preserve()
    ctx.set_source_rgba(*accent, 0.78)
    ctx.set_line_width(1.2)
    ctx.stroke()
    ctx.restore()


def render_test_points_overview(
    tp_parts: dict[str, HandPart],
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render full upright B.Cu overview labeling all 12 optional DNP test points."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, OV_W, OV_H)
    ctx = cairo.Context(surf)

    _draw_overview_frame(
        ctx,
        "BOTTOM (B.Cu) — 12 OPTIONAL TEST POINTS (TP1–TP12) · 30.0 × 108.0 mm UPRIGHT",
        [
            (ACCENT_POT, "Ground Clips (TP1, TP12 — Recommended)"),
            (ACCENT_CRIT, "Power Rails (TP2, TP3)"),
            (ACCENT_CAP, "Signal Probes (TP4–TP11)"),
        ],
        "back_X = 0",
        "back_X = 30 mm",
        master_surf,
        bbox,
    )

    def _tp_accent(ref: str) -> tuple[float, float, float]:
        if ref in ("TP1", "TP12"):
            return ACCENT_POT
        if ref in ("TP2", "TP3"):
            return ACCENT_CRIT
        return ACCENT_CAP

    # Route TP3 (-12V), TP2 (+12V), TP1 (GND) on left; TP12 + TP4..TP8 column on right
    left_specs = [
        ("TP3", "TP3 · -12V (-11.54V)", 24.0),
        ("TP2", "TP2 · +12V (+11.54V)", 16.0),
        ("TP1", "TP1 · GND (Ground Clip)", 18.0),
    ]
    left_parts = [tp_parts[ref] for ref, _, _ in left_specs]
    # Place TP3 pill above TP2 and route along top margin (y=0.65 mm) so lines never cross +12V
    left_target_ys = [
        _to_ov(18.8, 0.65)[1],
        _to_ov(13.3, 2.75)[1],
        _to_ov(tp_parts["TP1"].center_x, tp_parts["TP1"].center_y)[1],
    ]
    left_ys = _deconflict_y(
        left_target_ys, min_gap=26.0, y_min=OV_BY0 + 9.0, y_max=OV_BY0 + OV_BH - 16.0
    )

    for (ref, lbl, elbow), part, py in zip(left_specs, left_parts, left_ys):
        accent = _tp_accent(ref)
        _draw_ov_bbox_highlight(ctx, part, accent)
        tx, ty = _to_ov(part.center_x, part.center_y)
        wps = None
        if ref == "TP3":
            # Route cleanly along top edge above TP2 before dropping straight to TP3 pad
            wps = [(_to_ov(18.8, 0.65)[0], py)]
        _draw_ov_leader_and_pill(
            ctx, "left", py, (tx, ty), elbow, lbl, accent, waypoints=wps
        )

    right_order = [
        ("TP12", "TP12 · GND2 (Ground Clip)"),
        ("TP4", "TP4 · PRE (Preamp ×2)"),
        ("TP9", "TP9 · HWR (Half-Wave)"),
        ("TP5", "TP5 · RECT (Full-Wave)"),
        ("TP10", "TP10 · DRV (Skew Drv)"),
        ("TP6", "TP6 · ENV (Envelope)"),
        ("TP11", "TP11 · OFF (Offset)"),
        ("TP7", "TP7 · INV (-Out)"),
        ("TP8", "TP8 · OUT (+Out)"),
    ]
    right_parts = [tp_parts[ref] for ref, _ in right_order]
    right_ys = _deconflict_y(
        [_to_ov(p.center_x, p.center_y)[1] for p in right_parts],
        min_gap=28.0,
        y_min=OV_BY0 + 16.0,
        y_max=OV_BY0 + OV_BH - 16.0,
    )
    for idx, ((ref, lbl), part, py) in enumerate(
        zip(right_order, right_parts, right_ys)
    ):
        accent = _tp_accent(ref)
        _draw_ov_bbox_highlight(ctx, part, accent)
        _draw_ov_leader_and_pill(
            ctx,
            "right",
            py,
            _to_ov(part.center_x, part.center_y),
            16.0 + (idx % 3) * 6.0,
            lbl,
            accent,
        )

    out_path = OUT_DIR / "test_points_overview.png"
    surf.write_to_png(str(out_path))
    return out_path


def render_back_overview(
    manual_parts: dict[str, HandPart],
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render full upright B.Cu overview labeling all 7 required back-side THT parts."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, OV_W, OV_H)
    ctx = cairo.Context(surf)

    _draw_overview_frame(
        ctx,
        "BOTTOM (B.Cu) — 7 BACK-SIDE THT PARTS (DO BEFORE F.Cu) · 30.0 × 108.0 mm UPRIGHT",
        [
            (ACCENT_CRIT, "Keyed / Polarized (J_PWR, C1, C2)"),
            (ACCENT_CAP, "Non-Polarized 5 mm Box Film (C7, C11–C13)"),
        ],
        "back_X = 0",
        "back_X = 30 mm",
        master_surf,
        bbox,
    )

    left_refs = ["J_PWR", "C1", "C2", "C11", "C12", "C13"]
    left_parts = [manual_parts[r] for r in left_refs]
    left_ys = _deconflict_y(
        [_to_ov(p.center_x, p.center_y)[1] for p in left_parts],
        min_gap=32.0,
        y_min=OV_BY0 + 22.0,
        y_max=OV_BY0 + OV_BH - 22.0,
    )
    for idx, (part, py) in enumerate(zip(left_parts, left_ys)):
        spec = PART_SPECS[part.ref]
        accent, _ = _category_colors(spec.category)
        _draw_ov_bbox_highlight(ctx, part, accent)
        _draw_ov_leader_and_pill(
            ctx,
            "left",
            py,
            _to_ov(part.center_x, part.center_y),
            16.0 + (idx % 2) * 7.0,
            spec.ov_label,
            accent,
        )

    c7 = manual_parts["C7"]
    c7_spec = PART_SPECS["C7"]
    c7_accent, _ = _category_colors(c7_spec.category)
    _draw_ov_bbox_highlight(ctx, c7, c7_accent)
    _draw_ov_leader_and_pill(
        ctx,
        "right",
        _to_ov(c7.center_x, c7.center_y)[1],
        _to_ov(c7.center_x, c7.center_y),
        18.0,
        c7_spec.ov_label,
        c7_accent,
    )

    out_path = OUT_DIR / "back_overview.png"
    surf.write_to_png(str(out_path))
    return out_path


def render_front_overview(
    manual_parts: dict[str, HandPart],
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render full upright F.Cu overview labeling all 11 front-side panel controls."""
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, OV_W, OV_H)
    ctx = cairo.Context(surf)

    _draw_overview_frame(
        ctx,
        "FRONT (F.Cu) — 11 PANEL CONTROLS (DRY-FIT PANEL FIRST) · 30.0 × 108.0 mm UPRIGHT",
        [
            (ACCENT_POT, "Potentiometers (RV1–RV4)"),
            (ACCENT_CRIT, "Switches & Bi-Color LED (SW1–SW2, LED1)"),
            (ACCENT_CAP, "3.5 mm Jacks (J1–J4)"),
        ],
        "front_X = 0",
        "front_X = 30 mm",
        master_surf,
        bbox,
    )

    left_refs = ["RV1", "RV2", "RV3", "RV4", "SW1", "J1", "J3"]
    left_parts = [manual_parts[r] for r in left_refs]
    left_ys = _deconflict_y(
        [_to_ov(p.center_x, p.center_y)[1] for p in left_parts],
        min_gap=32.0,
        y_min=OV_BY0 + 22.0,
        y_max=OV_BY0 + OV_BH - 22.0,
    )
    for idx, (part, py) in enumerate(zip(left_parts, left_ys)):
        spec = PART_SPECS[part.ref]
        accent, _ = _category_colors(spec.category)
        _draw_ov_bbox_highlight(ctx, part, accent)
        _draw_ov_leader_and_pill(
            ctx,
            "left",
            py,
            _to_ov(part.center_x, part.center_y),
            16.0 + (idx % 2) * 7.0,
            spec.ov_label,
            accent,
        )

    # Right column: LED1 routed cleanly above SW2 through the gap at y=65.5 mm
    led1 = manual_parts["LED1"]
    led1_spec = PART_SPECS["LED1"]
    led1_accent, _ = _category_colors(led1_spec.category)
    _draw_ov_bbox_highlight(ctx, led1, led1_accent)

    sw2 = manual_parts["SW2"]
    j2 = manual_parts["J2"]
    j4 = manual_parts["J4"]
    right_specs = [
        ("LED1", _to_ov(15.0, 65.5)[1], [_to_ov(15.0, 65.5)]),
        ("SW2", _to_ov(sw2.center_x, sw2.center_y)[1], None),
        ("J2", _to_ov(j2.center_x, j2.center_y)[1], None),
        ("J4", _to_ov(j4.center_x, j4.center_y)[1], None),
    ]
    right_ys = _deconflict_y(
        [y for _, y, _ in right_specs],
        min_gap=32.0,
        y_min=OV_BY0 + 22.0,
        y_max=OV_BY0 + OV_BH - 22.0,
    )
    for idx, ((ref, _, wps), py) in enumerate(zip(right_specs, right_ys)):
        part = manual_parts[ref]
        spec = PART_SPECS[ref]
        accent, _ = _category_colors(spec.category)
        if ref != "LED1":
            _draw_ov_bbox_highlight(ctx, part, accent)
        _draw_ov_leader_and_pill(
            ctx,
            "right",
            py,
            _to_ov(part.center_x, part.center_y),
            18.0 + (idx % 2) * 6.0,
            spec.ov_label,
            accent,
            waypoints=wps,
        )

    out_path = OUT_DIR / "front_overview.png"
    surf.write_to_png(str(out_path))
    return out_path


def _draw_card_callouts(
    ctx: cairo.Context,
    part: HandPart,
    mm_to_vp: Callable[[float, float], tuple[float, float]],
) -> None:
    """Draw non-obscuring polarity / keying / pinout callouts anchored to true pads."""
    ref = part.ref

    if ref == "J_PWR":
        # Open right half around back_x = 20.5
        p_top = mm_to_vp(20.5, 7.60)
        _draw_pointer(
            ctx, (p_top[0] - 58, p_top[1]), mm_to_vp(7.60, 7.84), BRACKET_CRIT
        )
        _draw_pill(
            ctx,
            *p_top,
            "PINS 9–10 (+12V) TOP",
            BRACKET_CRIT,
            font_size=9.3,
            height=18.0,
        )

        p_mid = mm_to_vp(20.5, 13.10)
        _draw_pointer(
            ctx, (p_mid[0] - 64, p_mid[1]), mm_to_vp(9.40, 12.92), BRACKET_CRIT
        )
        _draw_pill(
            ctx,
            *p_mid,
            "KEYING NOTCH (INWARD)",
            BRACKET_CRIT,
            font_size=9.3,
            height=18.0,
        )

        p_bot = mm_to_vp(20.5, 19.60)
        _draw_pointer(
            ctx, (p_bot[0] - 64, p_bot[1]), mm_to_vp(7.45, 18.45), BRACKET_CRIT
        )
        _draw_pill(
            ctx,
            *p_bot,
            "PIN 1–2 (-12V) BOT SQ",
            BRACKET_CRIT,
            font_size=9.3,
            height=18.0,
        )

    elif ref == "C1":
        # Pad 1 (+, sq) at back=(6.45, 27.75); Pad 2 (-, round) at back=(3.95, 27.75)
        p_neg = mm_to_vp(16.0, 22.8)
        _draw_pointer(
            ctx, (p_neg[0] - 56, p_neg[1]), mm_to_vp(3.95, 26.60), TEXT_PRIMARY
        )
        _draw_pill(
            ctx, *p_neg, "– STRIPE (LEFT / GND)", TEXT_MUTED, font_size=9.3, height=18.0
        )

        p_pos = mm_to_vp(16.5, 31.8)
        _draw_pointer(
            ctx, (p_pos[0] - 68, p_pos[1]), mm_to_vp(6.45, 28.45), BRACKET_CRIT
        )
        _draw_pill(
            ctx,
            *p_pos,
            "+ LONG LEAD (RIGHT SQ / +12V)",
            BRACKET_CRIT,
            font_size=9.3,
            height=18.0,
        )

    elif ref == "C2":
        # Reversed relative to C1: Pad 1 (+, sq) at back=(3.95, 35.75); Pad 2 (-, round) at back=(6.45, 35.75)
        p_pos = mm_to_vp(16.0, 31.0)
        _draw_pointer(
            ctx, (p_pos[0] - 64, p_pos[1]), mm_to_vp(3.95, 34.70), BRACKET_CRIT
        )
        _draw_pill(
            ctx,
            *p_pos,
            "+ LONG LEAD (LEFT SQ / GND)",
            BRACKET_CRIT,
            font_size=9.3,
            height=18.0,
        )

        p_neg = mm_to_vp(16.5, 40.5)
        _draw_pointer(ctx, (p_neg[0] - 58, p_neg[1]), mm_to_vp(6.45, 36.45), EXT_ORANGE)
        _draw_pill(
            ctx,
            *p_neg,
            "– STRIPE (RIGHT / -12V)",
            EXT_ORANGE,
            font_size=9.3,
            height=18.0,
        )

    elif ref in ("C7", "C11", "C12", "C13"):
        pill_coords = {
            "C7": ((17.2, 14.5), 34, (24.3, 12.6)),
            "C11": ((16.2, 42.8), -36, (9.05, 43.25)),
            "C12": ((16.5, 47.0), -36, (9.05, 50.4)),
            "C13": ((15.6, 66.2), -36, (9.05, 61.2)),
        }
        px_mm, ptr_dx, tgt_mm = pill_coords[ref]
        pill_pos = mm_to_vp(*px_mm)
        _draw_pointer(
            ctx, (pill_pos[0] + ptr_dx, pill_pos[1]), mm_to_vp(*tgt_mm), BRACKET_PASSIVE
        )
        _draw_pill(
            ctx, *pill_pos, "NON-POLARIZED", BRACKET_PASSIVE, font_size=9.2, height=18.0
        )

    elif ref.startswith("RV"):
        if ref == "RV1":
            pill_pos = mm_to_vp(24.2, 3.5)
            _draw_pointer(
                ctx,
                (pill_pos[0] - 46, pill_pos[1]),
                mm_to_vp(16.4, part.center_y - 4.8),
                ACCENT_POT,
            )
            _draw_pill(
                ctx,
                *pill_pos,
                "BRACKET TABS (×2)",
                ACCENT_POT,
                font_size=9.2,
                height=17.5,
            )
        else:
            pill_y = part.center_y + 1.4 if ref == "RV2" else part.center_y - 4.8
            pill_pos = mm_to_vp(24.6, pill_y)
            _draw_pointer(
                ctx,
                (pill_pos[0] - 46, pill_pos[1]),
                mm_to_vp(16.4, part.center_y - 4.8),
                ACCENT_POT,
            )
            _draw_pill(
                ctx,
                *pill_pos,
                "BRACKET TABS (×2)",
                ACCENT_POT,
                font_size=9.2,
                height=17.5,
            )

            if ref == "RV4":
                det_pos = mm_to_vp(24.6, part.center_y + 2.2)
                _draw_pointer(
                    ctx,
                    (det_pos[0] - 44, det_pos[1]),
                    mm_to_vp(15.0, part.center_y),
                    EXT_ORANGE,
                )
                _draw_pill(
                    ctx,
                    *det_pos,
                    "CENTER DETENT",
                    EXT_ORANGE,
                    font_size=9.2,
                    height=17.5,
                )

    elif ref == "LED1":
        # LED1 Pad 1 sq at front=(13.73, 72.00), Pad 2 round at (16.27, 72.00)
        p1 = mm_to_vp(8.6, 65.0)
        _draw_pointer(ctx, (p1[0] + 44, p1[1]), mm_to_vp(13.73, 71.10), BRACKET_CRIT)
        _draw_pill(
            ctx, *p1, "PAD 1 SQ (+V = GREEN)", BRACKET_CRIT, font_size=9.2, height=17.5
        )

        p2 = mm_to_vp(21.4, 65.0)
        _draw_pointer(ctx, (p2[0] - 40, p2[1]), mm_to_vp(16.27, 71.10), TEXT_MUTED)
        _draw_pill(ctx, *p2, "PAD 2 ROUND", TEXT_MUTED, font_size=9.2, height=17.5)

    elif ref in ("J1", "J2", "J3", "J4"):
        s_x, s_y, _ = part.pads["S"]
        tn_x, tn_y, _ = part.pads["TN"]
        t_x, t_y, _ = part.pads["T"]
        is_left_col = part.center_x < 15.0
        # Place pills centered in the 12 mm corridor between J1/J3 and J2/J4 so neighbor pads stay clear
        pill_x_mm = 15.0
        edge_dx = -44 if is_left_col else 44
        target_x_offset = 1.15 if is_left_col else -1.15

        ps = mm_to_vp(pill_x_mm, s_y)
        _draw_pointer(
            ctx,
            (ps[0] + edge_dx, ps[1]),
            mm_to_vp(s_x + target_x_offset, s_y),
            BRACKET_PASSIVE,
        )
        _draw_pill(
            ctx, *ps, "SLEEVE (S, TOP SQ)", BRACKET_PASSIVE, font_size=9.0, height=17.5
        )

        ptn = mm_to_vp(pill_x_mm, tn_y + 1.0)
        _draw_pointer(
            ctx,
            (ptn[0] + edge_dx, ptn[1]),
            mm_to_vp(tn_x + target_x_offset, tn_y),
            TEXT_MUTED,
        )
        _draw_pill(ctx, *ptn, "NORM SW (TN)", TEXT_MUTED, font_size=9.0, height=17.5)

        # Keep J3/J4 TIP pill above TP1 (GND) at (15.0, 105.6)
        tip_pill_y = t_y - 3.2 if ref in ("J3", "J4") else t_y
        pt = mm_to_vp(pill_x_mm, tip_pill_y)
        _draw_pointer(
            ctx,
            (pt[0] + edge_dx, pt[1]),
            mm_to_vp(t_x + target_x_offset, t_y),
            BRACKET_PASSIVE,
        )
        _draw_pill(
            ctx, *pt, "TIP (T, BOTTOM)", BRACKET_PASSIVE, font_size=9.0, height=17.5
        )


def _draw_sw_callouts(
    ctx: cairo.Context,
    part: HandPart,
    mm_to_vp: Callable[[float, float], tuple[float, float]],
) -> None:
    """Dedicated crisp callout placement for SW1 and SW2 avoiding LED1 silkscreen."""
    if part.ref == "SW1":
        # SW1 at (7.0, 72.0): LED1 silkscreen sits around x=11.5..18.5, y=66..76.
        p1 = mm_to_vp(14.0, 64.5)
        _draw_pointer(ctx, (p1[0] - 48, p1[1]), mm_to_vp(8.0, 69.46), BRACKET_CRIT)
        _draw_pill(
            ctx, *p1, "PIN 1 (NC, TOP SQ)", BRACKET_CRIT, font_size=9.2, height=17.5
        )

        p2 = mm_to_vp(12.6, 77.6)
        _draw_pointer(ctx, (p2[0] - 30, p2[1]), mm_to_vp(8.0, 72.00), TEXT_MUTED)
        _draw_pill(ctx, *p2, "PIN 2 (COM)", TEXT_MUTED, font_size=9.2, height=17.5)

        p3 = mm_to_vp(13.5, 80.2)
        _draw_pointer(ctx, (p3[0] - 48, p3[1]), mm_to_vp(8.0, 74.54), ACCENT_POT)
        _draw_pill(
            ctx, *p3, "PIN 3 (UP = SMOOTH)", ACCENT_POT, font_size=9.2, height=17.5
        )
    elif part.ref == "SW2":
        # SW2 at (23.0, 72.0): open left side above/below LED1 silkscreen
        p1 = mm_to_vp(15.5, 64.5)
        _draw_pointer(ctx, (p1[0] + 48, p1[1]), mm_to_vp(22.0, 69.46), BRACKET_CRIT)
        _draw_pill(
            ctx, *p1, "PIN 1 (NC, TOP SQ)", BRACKET_CRIT, font_size=9.2, height=17.5
        )

        p2 = mm_to_vp(13.5, 77.6)
        _draw_pointer(ctx, (p2[0] + 32, p2[1]), mm_to_vp(22.0, 72.00), TEXT_MUTED)
        _draw_pill(ctx, *p2, "PIN 2 (COM)", TEXT_MUTED, font_size=9.2, height=17.5)

        p3 = mm_to_vp(15.0, 80.2)
        _draw_pointer(ctx, (p3[0] + 46, p3[1]), mm_to_vp(22.0, 74.54), ACCENT_POT)
        _draw_pill(
            ctx, *p3, "PIN 3 (UP = SLOW)", ACCENT_POT, font_size=9.2, height=17.5
        )


def render_part_card(
    part: HandPart,
    master_surf: cairo.ImageSurface,
    bbox: tuple[int, int, int, int],
) -> pathlib.Path:
    """Render an individual 620x412 annotated hand-assembly placement card."""
    spec = PART_SPECS[part.ref]
    accent, bracket_col = _category_colors(spec.category)

    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, CARD_W, CARD_H)
    ctx = cairo.Context(surf)

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

    # Right header first so we can verify zero collision with left header
    view_tag = "back" if part.layer == "B.Cu" else "front"
    coord_txt = f"{part.layer} · {view_tag}=({part.center_x:.1f}, {part.center_y:.1f})"
    right_w = _measure_text(ctx, coord_txt, size=10.5, mono=True)
    right_start_x = CARD_W - 12.0 - right_w
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

    _, _, bx1, _ = _draw_pill(
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
    cur_x = bx1 + 9.0
    w_val, _ = _draw_text(ctx, spec.title, cur_x, 24.0, size=13.0, bold=True)
    cur_x += w_val + 8.0
    w_meta, _ = _draw_text(ctx, spec.meta, cur_x, 23.5, size=11.0, color=TEXT_MUTED)
    cur_x += w_meta + 8.0
    if spec.badge:
        _, _, bx_end, _ = _draw_pill(
            ctx,
            cur_x,
            HEADER_H / 2.0,
            spec.badge,
            EXT_ORANGE,
            fill=(56, 30, 16),
            font_size=8.8,
            pad_x=6.0,
            height=17.0,
            align="left",
        )
        cur_x = bx_end

    if cur_x > right_start_x - 8.0:
        raise RuntimeError(
            f"Header text collision on {part.ref}: left ends at {cur_x:.1f} vs right start {right_start_x:.1f}"
        )

    # Compute 4:3 crop window (mm) with safe centering when crop_w > BOARD_W + 2.0
    crop_w, crop_h, tick_step = spec.crop_w, spec.crop_h, spec.tick_step
    if crop_w >= BOARD_W + 2.0:
        cx0 = (BOARD_W - crop_w) / 2.0
    else:
        cx0 = max(-1.0, min((BOARD_W + 1.0) - crop_w, part.center_x - crop_w / 2.0))
    cy0 = max(-1.0, min((BOARD_H + 1.0) - crop_h, part.center_y - crop_h / 2.0))
    cx1 = cx0 + crop_w
    cy1 = cy0 + crop_h

    def mm_to_vp(vx: float, vy: float) -> tuple[float, float]:
        return (
            VX0 + ((vx - cx0) / crop_w) * VW,
            VY0 + ((vy - cy0) / crop_h) * VH,
        )

    # Paint zoomed 3D board crop
    _paint_master_region(
        ctx, master_surf, bbox, (VX0, VY0, VW, VH), (cx0, cy0, cx1, cy1)
    )

    # Ruler ticks & labels (clamped to board boundaries 0..BOARD_W, 0..BOARD_H)
    _draw_text(ctx, "mm", 8.0, 54.0, size=9.5, color=TEXT_MUTED, mono=True)
    num_x = math.ceil(BOARD_W / tick_step) + 1
    for i in range(num_x):
        tx_mm = round(i * tick_step, 3)
        if tx_mm < -1e-6 or tx_mm > BOARD_W + 1e-6:
            continue
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

    num_y = math.ceil(BOARD_H / tick_step) + 1
    for i in range(num_y):
        ty_mm = round(i * tick_step, 3)
        if ty_mm < -1e-6 or ty_mm > BOARD_H + 1e-6:
            continue
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

    # Non-obscuring target bracket around footprint bounding box + margin
    bx0_p = part.bbox_min_x - spec.margin
    by0_p = part.bbox_min_y - spec.margin
    bx1_p = part.bbox_max_x + spec.margin
    by1_p = part.bbox_max_y + spec.margin
    rx0, ry0 = mm_to_vp(bx0_p, by0_p)
    rx1, ry1 = mm_to_vp(bx1_p, by1_p)

    ctx.save()
    ctx.rectangle(VX0, VY0, VW, VH)
    ctx.clip()

    ctx.set_dash([4.0, 4.0])
    ctx.set_source_rgba(*bracket_col, 0.55)
    ctx.set_line_width(1.0)
    ctx.rectangle(rx0, ry0, rx1 - rx0, ry1 - ry0)
    ctx.stroke()
    ctx.set_dash([])

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

    if part.ref in ("SW1", "SW2"):
        _draw_sw_callouts(ctx, part, mm_to_vp)
    else:
        _draw_card_callouts(ctx, part, mm_to_vp)

    ctx.restore()

    # Viewport border
    ctx.set_source_rgb(*FRAME_LIGHT)
    ctx.set_line_width(1.0)
    ctx.rectangle(VX0 - 0.5, VY0 - 0.5, VW + 1.0, VH + 1.0)
    ctx.stroke()

    # Bottom caption
    if part.layer == "B.Cu":
        caption = f"Direct Bottom (B.Cu) view · Insert on B.Cu, solder & trim flush on F.Cu · Ticks: {int(tick_step)} mm"
    else:
        caption = f"Direct Front (F.Cu) view · Insert on F.Cu, dry-fit panel, solder on B.Cu · Ticks: {int(tick_step)} mm"
    _draw_text(ctx, caption, VX0, VY0 + VH + 14.0, size=9.3, color=TEXT_MUTED)

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

    # Highlight footprint box and center dot on mini-map
    fp_mx0 = MX0 + (part.bbox_min_x / BOARD_W) * MW
    fp_my0 = MY0 + (part.bbox_min_y / BOARD_H) * MH
    fp_mx1 = MX0 + (part.bbox_max_x / BOARD_W) * MW
    fp_my1 = MY0 + (part.bbox_max_y / BOARD_H) * MH
    ctx.rectangle(fp_mx0, fp_my0, fp_mx1 - fp_mx0, fp_my1 - fp_my0)
    ctx.set_source_rgba(*bracket_col, 0.85)
    ctx.set_line_width(1.2)
    ctx.stroke()

    dot_x = MX0 + (part.center_x / BOARD_W) * MW
    dot_y = MY0 + (part.center_y / BOARD_H) * MH
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
    manual_parts, tp_parts = load_hand_assembly_parts()
    print(
        f"Loaded {len(manual_parts)} Manual THT parts and {len(tp_parts)} DNP test points."
    )

    renders = render_master_boards()
    bot_surf, bot_bbox = renders["B.Cu"]
    top_surf, top_bbox = renders["F.Cu"]

    tp_ov = render_test_points_overview(tp_parts, bot_surf, bot_bbox)
    print(f"Wrote {tp_ov.relative_to(ROOT)}")

    back_ov = render_back_overview(manual_parts, bot_surf, bot_bbox)
    print(f"Wrote {back_ov.relative_to(ROOT)}")

    front_ov = render_front_overview(manual_parts, top_surf, top_bbox)
    print(f"Wrote {front_ov.relative_to(ROOT)}")

    for part in manual_parts.values():
        surf, bbox = renders[part.layer]
        render_part_card(part, surf, bbox)
    print(f"Wrote {len(manual_parts)} part cards to {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
