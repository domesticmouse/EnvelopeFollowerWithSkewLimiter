#!/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3
"""Import 1:1 mm F.SilkS and F.Mask Plain SVGs into envelope_follower_panel.kicad_pcb."""

from __future__ import annotations

import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pcbnew

DEFAULT_PCB = Path("envelope_follower_panel.kicad_pcb")
DEFAULT_SILKS_SVG = Path("panel_art/front_silkscreen.svg")
DEFAULT_MASK_SVG = Path("panel_art/front_soldermask.svg")

EXPECTED_AUX_ORIGIN_MM = (100.0, 29.75)
BEZIER_TOL_MM = 0.002
BEZIER_MAX_DEPTH = 10

_PATH_TOKEN_RE = re.compile(
    r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)"
)

STACKUP_BLOCK = """\t\t(stackup
\t\t\t(layer "F.SilkS"
\t\t\t\t(type "Top Silk Screen")
\t\t\t\t(color "White")
\t\t\t)
\t\t\t(layer "F.Paste"
\t\t\t\t(type "Top Solder Paste")
\t\t\t)
\t\t\t(layer "F.Mask"
\t\t\t\t(type "Top Solder Mask")
\t\t\t\t(color "Black")
\t\t\t\t(thickness 0.01)
\t\t\t)
\t\t\t(layer "F.Cu"
\t\t\t\t(type "copper")
\t\t\t\t(thickness 0.035)
\t\t\t)
\t\t\t(layer "dielectric 1"
\t\t\t\t(type "core")
\t\t\t\t(thickness 1.51)
\t\t\t\t(material "FR4")
\t\t\t\t(epsilon_r 4.5)
\t\t\t\t(loss_tangent 0.02)
\t\t\t)
\t\t\t(layer "B.Cu"
\t\t\t\t(type "copper")
\t\t\t\t(thickness 0.035)
\t\t\t)
\t\t\t(layer "B.Mask"
\t\t\t\t(type "Bottom Solder Mask")
\t\t\t\t(color "Black")
\t\t\t\t(thickness 0.01)
\t\t\t)
\t\t\t(layer "B.Paste"
\t\t\t\t(type "Bottom Solder Paste")
\t\t\t)
\t\t\t(layer "B.SilkS"
\t\t\t\t(type "Bottom Silk Screen")
\t\t\t\t(color "White")
\t\t\t)
\t\t\t(copper_finish "ENIG")
\t\t\t(dielectric_constraints no)
\t\t)\n"""


def _point_line_distance(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx = bx - ax
    dy = by - ay
    seg_len = math.hypot(dx, dy)
    if seg_len < 1e-9:
        return math.hypot(px - ax, py - ay)
    return abs(dx * (ay - py) - (ax - px) * dy) / seg_len


def _flatten_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    tol: float = BEZIER_TOL_MM,
    depth: int = 0,
) -> list[tuple[float, float]]:
    d1 = _point_line_distance(p1[0], p1[1], p0[0], p0[1], p3[0], p3[1])
    d2 = _point_line_distance(p2[0], p2[1], p0[0], p0[1], p3[0], p3[1])
    if (d1 <= tol and d2 <= tol) or depth >= BEZIER_MAX_DEPTH:
        return [p3]

    # De Casteljau split at t = 0.5
    m01 = ((p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5)
    m12 = ((p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5)
    m23 = ((p2[0] + p3[0]) * 0.5, (p2[1] + p3[1]) * 0.5)
    m012 = ((m01[0] + m12[0]) * 0.5, (m01[1] + m12[1]) * 0.5)
    m123 = ((m12[0] + m23[0]) * 0.5, (m12[1] + m23[1]) * 0.5)
    mid = ((m012[0] + m123[0]) * 0.5, (m012[1] + m123[1]) * 0.5)

    left = _flatten_cubic(p0, m01, m012, mid, tol, depth + 1)
    right = _flatten_cubic(mid, m123, m23, p3, tol, depth + 1)
    return left + right


def _flatten_quad(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    tol: float = BEZIER_TOL_MM,
) -> list[tuple[float, float]]:
    c1 = (p0[0] + (2.0 / 3.0) * (p1[0] - p0[0]), p0[1] + (2.0 / 3.0) * (p1[1] - p0[1]))
    c2 = (p2[0] + (2.0 / 3.0) * (p1[0] - p2[0]), p2[1] + (2.0 / 3.0) * (p1[1] - p2[1]))
    return _flatten_cubic(p0, c1, c2, p2, tol)


def _clean_subpath(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not pts:
        return []
    cleaned: list[tuple[float, float]] = [pts[0]]
    for x, y in pts[1:]:
        if math.hypot(x - cleaned[-1][0], y - cleaned[-1][1]) >= 1e-5:
            cleaned.append((x, y))
    if (
        len(cleaned) >= 2
        and math.hypot(cleaned[-1][0] - cleaned[0][0], cleaned[-1][1] - cleaned[0][1])
        < 1e-5
    ):
        cleaned.pop()
    return cleaned if len(cleaned) >= 3 else []


def _parse_path_d(d: str) -> list[list[tuple[float, float]]]:
    """Parse an SVG path d-string into closed polygon subpaths (in mm)."""
    tokens = _PATH_TOKEN_RE.findall(d)
    subpaths: list[list[tuple[float, float]]] = []
    cur_pts: list[tuple[float, float]] = []

    i = 0
    cmd = ""
    prev_cmd = ""
    cx = 0.0
    cy = 0.0
    sx = 0.0
    sy = 0.0
    last_ctrl: tuple[float, float] | None = None

    def next_num() -> float:
        nonlocal i
        val = float(tokens[i][1])
        i += 1
        return val

    def has_num() -> bool:
        return i < len(tokens) and tokens[i][1] != ""

    def finish_subpath() -> None:
        nonlocal cur_pts
        cleaned = _clean_subpath(cur_pts)
        if cleaned:
            subpaths.append(cleaned)
        cur_pts = []

    while i < len(tokens):
        if tokens[i][0]:
            cmd = tokens[i][0]
            i += 1
            if cmd in ("Z", "z"):
                finish_subpath()
                cx, cy = sx, sy
                prev_cmd = cmd
                last_ctrl = None
                continue
        if not cmd:
            raise ValueError(f"Malformed SVG path near {tokens[i]}")

        upper = cmd.upper()
        rel = cmd.islower()

        if upper == "M":
            first = True
            while has_num():
                x = next_num()
                y = next_num()
                if rel:
                    cx += x
                    cy += y
                else:
                    cx, cy = x, y
                if first:
                    finish_subpath()
                    sx, sy = cx, cy
                    cur_pts = [(cx, cy)]
                    first = False
                else:
                    cur_pts.append((cx, cy))
                prev_cmd = "L" if not first else "M"
            last_ctrl = None
        elif upper == "L":
            while has_num():
                x = next_num()
                y = next_num()
                cx, cy = (cx + x, cy + y) if rel else (x, y)
                cur_pts.append((cx, cy))
                prev_cmd = cmd
            last_ctrl = None
        elif upper == "H":
            while has_num():
                x = next_num()
                cx = cx + x if rel else x
                cur_pts.append((cx, cy))
                prev_cmd = cmd
            last_ctrl = None
        elif upper == "V":
            while has_num():
                y = next_num()
                cy = cy + y if rel else y
                cur_pts.append((cx, cy))
                prev_cmd = cmd
            last_ctrl = None
        elif upper == "C":
            while has_num():
                x1, y1, x2, y2, x3, y3 = (next_num() for _ in range(6))
                if rel:
                    p1 = (cx + x1, cy + y1)
                    p2 = (cx + x2, cy + y2)
                    p3 = (cx + x3, cy + y3)
                else:
                    p1 = (x1, y1)
                    p2 = (x2, y2)
                    p3 = (x3, y3)
                cur_pts.extend(_flatten_cubic((cx, cy), p1, p2, p3))
                cx, cy = p3
                last_ctrl = p2
                prev_cmd = cmd
        elif upper == "S":
            while has_num():
                x2, y2, x3, y3 = (next_num() for _ in range(4))
                if prev_cmd.upper() in ("C", "S") and last_ctrl is not None:
                    p1 = (2.0 * cx - last_ctrl[0], 2.0 * cy - last_ctrl[1])
                else:
                    p1 = (cx, cy)
                p2 = (cx + x2, cy + y2) if rel else (x2, y2)
                p3 = (cx + x3, cy + y3) if rel else (x3, y3)
                cur_pts.extend(_flatten_cubic((cx, cy), p1, p2, p3))
                cx, cy = p3
                last_ctrl = p2
                prev_cmd = cmd
        elif upper == "Q":
            while has_num():
                x1, y1, x2, y2 = (next_num() for _ in range(4))
                p1 = (cx + x1, cy + y1) if rel else (x1, y1)
                p2 = (cx + x2, cy + y2) if rel else (x2, y2)
                cur_pts.extend(_flatten_quad((cx, cy), p1, p2))
                cx, cy = p2
                last_ctrl = p1
                prev_cmd = cmd
        elif upper == "T":
            while has_num():
                x2, y2 = next_num(), next_num()
                if prev_cmd.upper() in ("Q", "T") and last_ctrl is not None:
                    p1 = (2.0 * cx - last_ctrl[0], 2.0 * cy - last_ctrl[1])
                else:
                    p1 = (cx, cy)
                p2 = (cx + x2, cy + y2) if rel else (x2, y2)
                cur_pts.extend(_flatten_quad((cx, cy), p1, p2))
                cx, cy = p2
                last_ctrl = p1
                prev_cmd = cmd
        else:
            raise ValueError(f"Unsupported SVG path command: {cmd}")

    finish_subpath()
    return subpaths


def _parse_points_attr(points_str: str) -> list[tuple[float, float]]:
    nums = [
        float(v)
        for v in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", points_str)
    ]
    if len(nums) % 2 != 0:
        raise ValueError(f"Odd coordinate count in points attribute: {points_str}")
    pts = [(nums[k], nums[k + 1]) for k in range(0, len(nums), 2)]
    return _clean_subpath(pts)


def _subpath_polyset(
    pts: list[tuple[float, float]], ox_mm: float, oy_mm: float
) -> pcbnew.SHAPE_POLY_SET:
    ps = pcbnew.SHAPE_POLY_SET()
    ps.NewOutline()
    for x, y in pts:
        ps.Append(pcbnew.FromMM(x + ox_mm), pcbnew.FromMM(y + oy_mm))
    return ps


def _extract_svg_polysets(
    svg_path: Path, ox_mm: float, oy_mm: float
) -> list[pcbnew.SHAPE_POLY_SET]:
    """Parse SVG primitives into fractured SHAPE_POLY_SET objects in board coordinates."""
    root = ET.parse(svg_path).getroot()
    polysets: list[pcbnew.SHAPE_POLY_SET] = []

    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if elem.attrib.get("id") == "registration_frame":
            continue

        subpaths: list[list[tuple[float, float]]] = []
        if tag == "rect":
            x = float(elem.attrib.get("x", "0"))
            y = float(elem.attrib.get("y", "0"))
            w = float(elem.attrib["width"])
            h = float(elem.attrib["height"])
            pts = _clean_subpath([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
            if pts:
                subpaths = [pts]
        elif tag == "polygon":
            pts = _parse_points_attr(elem.attrib["points"])
            if pts:
                subpaths = [pts]
        elif tag == "path" and "d" in elem.attrib:
            subpaths = _parse_path_d(elem.attrib["d"])
        else:
            continue

        if not subpaths:
            continue

        combined = _subpath_polyset(subpaths[0], ox_mm, oy_mm)
        for sp in subpaths[1:]:
            combined.BooleanXor(_subpath_polyset(sp, ox_mm, oy_mm))

        combined.Fracture()
        if combined.OutlineCount() > 0:
            polysets.append(combined)

    return polysets


def _ensure_stackup(pcb_path: Path) -> bool:
    """Insert Matte Black + White Silkscreen + ENIG stackup into setup if absent."""
    text = pcb_path.read_text(encoding="utf-8")
    if "(stackup" in text:
        return False
    marker = "\t\t(pad_to_mask_clearance"
    if marker not in text:
        raise RuntimeError(f"Could not locate {marker!r} in {pcb_path}")
    pcb_path.write_text(
        text.replace(marker, STACKUP_BLOCK + marker, 1), encoding="utf-8"
    )
    return True


def import_panel_svgs(
    pcb_path: Path = DEFAULT_PCB,
    silks_svg: Path = DEFAULT_SILKS_SVG,
    mask_svg: Path = DEFAULT_MASK_SVG,
) -> dict[str, int]:
    """Import F.SilkS and F.Mask SVGs into the KiCad panel PCB idempotently."""
    stackup_added = _ensure_stackup(pcb_path)
    board = pcbnew.LoadBoard(str(pcb_path))

    aux = board.GetDesignSettings().GetAuxOrigin()
    ox_mm = pcbnew.ToMM(aux.x)
    oy_mm = pcbnew.ToMM(aux.y)
    if (
        abs(ox_mm - EXPECTED_AUX_ORIGIN_MM[0]) > 1e-3
        or abs(oy_mm - EXPECTED_AUX_ORIGIN_MM[1]) > 1e-3
    ):
        raise RuntimeError(
            f"Unexpected aux origin ({ox_mm}, {oy_mm}) mm; expected {EXPECTED_AUX_ORIGIN_MM}"
        )

    # Idempotently clear existing board-level F.SilkS and F.Mask drawings only
    removed = {pcbnew.F_SilkS: 0, pcbnew.F_Mask: 0}
    for drawing in list(board.GetDrawings()):
        layer = drawing.GetLayer()
        if layer in removed:
            board.Remove(drawing)
            removed[layer] += 1

    added = {"F.SilkS": 0, "F.Mask": 0}
    for label, layer_id, svg_path in (
        ("F.SilkS", pcbnew.F_SilkS, silks_svg),
        ("F.Mask", pcbnew.F_Mask, mask_svg),
    ):
        polysets = _extract_svg_polysets(svg_path, ox_mm, oy_mm)
        for ps in polysets:
            for idx in range(ps.OutlineCount()):
                single_ps = pcbnew.SHAPE_POLY_SET()
                single_ps.AddOutline(ps.Outline(idx))
                shape = pcbnew.PCB_SHAPE()
                shape.SetShape(pcbnew.SHAPE_T_POLY)
                shape.SetLayer(layer_id)
                shape.SetFilled(True)
                shape.SetWidth(0)
                shape.SetPolyShape(single_ps)
                board.Add(shape)
                added[label] += 1

    # Refill GND shield zones cleanly
    pcbnew.ZONE_FILLER(board).Fill(board.Zones())

    # Count preserved rear silkscreen drawings
    b_silks_count = sum(
        1 for d in board.GetDrawings() if d.GetLayer() == pcbnew.B_SilkS
    )

    pcbnew.SaveBoard(str(pcb_path), board)
    return {
        "stackup_added": int(stackup_added),
        "removed_f_silks": removed[pcbnew.F_SilkS],
        "removed_f_mask": removed[pcbnew.F_Mask],
        "added_f_silks": added["F.SilkS"],
        "added_f_mask": added["F.Mask"],
        "preserved_b_silks": b_silks_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import front_silkscreen.svg and front_soldermask.svg into KiCad panel PCB."
    )
    parser.add_argument("--pcb", type=Path, default=DEFAULT_PCB)
    parser.add_argument("--silks-svg", type=Path, default=DEFAULT_SILKS_SVG)
    parser.add_argument("--mask-svg", type=Path, default=DEFAULT_MASK_SVG)
    args = parser.parse_args()

    stats = import_panel_svgs(args.pcb, args.silks_svg, args.mask_svg)
    print("KiCad SVG import complete:", stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
