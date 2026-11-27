#!/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3
"""Import 1:1 mm F.SilkS and F.Mask Plain SVGs into a KiCad 10 Eurorack panel PCB."""

from __future__ import annotations

import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pcbnew

BEZIER_TOL_MM = 0.002
BEZIER_MAX_DEPTH = 10

_PATH_TOKEN_RE = re.compile(
    r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)"
)


def build_stackup_block(
    silk_color: str = "White",
    mask_color: str = "Black",
    copper_finish: str = "ENIG",
) -> str:
    """Return a KiCad 10 2-layer 1.6 mm FR4 stackup block for (setup ...)."""
    return f"""\t\t(stackup
\t\t\t(layer "F.SilkS"
\t\t\t\t(type "Top Silk Screen")
\t\t\t\t(color "{silk_color}")
\t\t\t)
\t\t\t(layer "F.Paste"
\t\t\t\t(type "Top Solder Paste")
\t\t\t)
\t\t\t(layer "F.Mask"
\t\t\t\t(type "Top Solder Mask")
\t\t\t\t(color "{mask_color}")
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
\t\t\t\t(color "{mask_color}")
\t\t\t\t(thickness 0.01)
\t\t\t)
\t\t\t(layer "B.Paste"
\t\t\t\t(type "Bottom Solder Paste")
\t\t\t)
\t\t\t(layer "B.SilkS"
\t\t\t\t(type "Bottom Silk Screen")
\t\t\t\t(color "{silk_color}")
\t\t\t)
\t\t\t(copper_finish "{copper_finish}")
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
                    prev_cmd = "M"
                    first = False
                else:
                    cur_pts.append((cx, cy))
                    prev_cmd = "L"
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


def _rect_pts(
    x: float, y: float, w: float, h: float, rx: float = 0.0, ry: float = 0.0
) -> list[tuple[float, float]]:
    rx = min(max(0.0, rx), w * 0.5)
    ry = min(max(0.0, ry), h * 0.5)
    if rx == 0.0 and ry == 0.0:
        return _clean_subpath([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    if rx == 0.0:
        rx = ry
    if ry == 0.0:
        ry = rx
    pts: list[tuple[float, float]] = []
    corners = [
        (x + w - rx, y + ry, -math.pi * 0.5, 0.0),
        (x + w - rx, y + h - ry, 0.0, math.pi * 0.5),
        (x + rx, y + h - ry, math.pi * 0.5, math.pi),
        (x + rx, y + ry, math.pi, math.pi * 1.5),
    ]
    steps = 8
    for cx, cy, a0, a1 in corners:
        for k in range(steps + 1):
            a = a0 + (a1 - a0) * (k / steps)
            pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return _clean_subpath(pts)


def _ellipse_pts(
    cx: float, cy: float, rx: float, ry: float
) -> list[tuple[float, float]]:
    steps = max(24, math.ceil(2.0 * math.pi * max(rx, ry) / 0.1))
    pts = [
        (
            cx + rx * math.cos(2.0 * math.pi * k / steps),
            cy + ry * math.sin(2.0 * math.pi * k / steps),
        )
        for k in range(steps)
    ]
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
            pts = _rect_pts(
                float(elem.attrib.get("x", "0")),
                float(elem.attrib.get("y", "0")),
                float(elem.attrib["width"]),
                float(elem.attrib["height"]),
                float(elem.attrib.get("rx", "0")),
                float(elem.attrib.get("ry", "0")),
            )
            if pts:
                subpaths = [pts]
        elif tag == "polygon":
            pts = _parse_points_attr(elem.attrib["points"])
            if pts:
                subpaths = [pts]
        elif tag == "circle":
            r = float(elem.attrib["r"])
            pts = _ellipse_pts(
                float(elem.attrib.get("cx", "0")),
                float(elem.attrib.get("cy", "0")),
                r,
                r,
            )
            if pts:
                subpaths = [pts]
        elif tag == "ellipse":
            pts = _ellipse_pts(
                float(elem.attrib.get("cx", "0")),
                float(elem.attrib.get("cy", "0")),
                float(elem.attrib["rx"]),
                float(elem.attrib["ry"]),
            )
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


def _ensure_stackup(
    pcb_path: Path,
    silk_color: str = "White",
    mask_color: str = "Black",
    copper_finish: str = "ENIG",
) -> bool:
    """Insert 2-layer stackup into (setup ...) if absent."""
    text = pcb_path.read_text(encoding="utf-8")
    if "(stackup" in text:
        return False
    marker = "\t\t(pad_to_mask_clearance"
    if marker not in text:
        raise RuntimeError(f"Could not locate {marker!r} in {pcb_path}")
    block = build_stackup_block(silk_color, mask_color, copper_finish)
    pcb_path.write_text(text.replace(marker, block + marker, 1), encoding="utf-8")
    return True


def import_panel_svgs(
    pcb_path: Path,
    silks_svg: Path,
    mask_svg: Path,
    expected_origin: tuple[float, float] | None = None,
    ensure_stackup: bool = True,
    silk_color: str = "White",
    mask_color: str = "Black",
    copper_finish: str = "ENIG",
) -> dict[str, int]:
    """Import F.SilkS and F.Mask SVGs into a KiCad panel PCB idempotently."""
    stackup_added = (
        _ensure_stackup(pcb_path, silk_color, mask_color, copper_finish)
        if ensure_stackup
        else False
    )
    board = pcbnew.LoadBoard(str(pcb_path))

    aux = board.GetDesignSettings().GetAuxOrigin()
    ox_mm = pcbnew.ToMM(aux.x)
    oy_mm = pcbnew.ToMM(aux.y)
    if expected_origin is not None and (
        abs(ox_mm - expected_origin[0]) > 1e-3 or abs(oy_mm - expected_origin[1]) > 1e-3
    ):
        raise RuntimeError(
            f"Unexpected aux origin ({ox_mm}, {oy_mm}) mm; expected {expected_origin}"
        )

    removed = {pcbnew.F_SilkS: 0, pcbnew.F_Mask: 0}
    for drawing in list(board.GetDrawings()):
        layer = drawing.GetLayer()
        if layer in removed:
            board.Delete(drawing)
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

    pcbnew.ZONE_FILLER(board).Fill(board.Zones())

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
        description="Import front_silkscreen.svg and front_soldermask.svg into a KiCad 10 panel PCB."
    )
    parser.add_argument("--pcb", type=Path, required=True)
    parser.add_argument("--silks-svg", type=Path, required=True)
    parser.add_argument("--mask-svg", type=Path, required=True)
    parser.add_argument(
        "--expected-origin",
        default=None,
        help="Optional X,Y mm aux-origin sanity check (e.g. 100.0,29.75)",
    )
    parser.add_argument(
        "--no-stackup",
        action="store_true",
        help="Skip inserting the Matte Black + White + ENIG stackup block",
    )
    parser.add_argument("--silk-color", default="White")
    parser.add_argument("--mask-color", default="Black")
    parser.add_argument("--finish", default="ENIG")
    args = parser.parse_args()

    expected_origin: tuple[float, float] | None = None
    if args.expected_origin:
        parts = [float(v.strip()) for v in args.expected_origin.split(",")]
        if len(parts) != 2:
            parser.error("--expected-origin must be X,Y in mm")
        expected_origin = (parts[0], parts[1])

    stats = import_panel_svgs(
        args.pcb,
        args.silks_svg,
        args.mask_svg,
        expected_origin=expected_origin,
        ensure_stackup=not args.no_stackup,
        silk_color=args.silk_color,
        mask_color=args.mask_color,
        copper_finish=args.finish,
    )
    print("KiCad SVG import complete:", stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
