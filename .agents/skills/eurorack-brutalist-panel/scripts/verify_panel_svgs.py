#!/usr/bin/env python3
"""Normalize VectorCraft panel SVGs to 1:1 mm Plain SVGs and audit clearances."""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from vc_panel_lib import (
    AUDIT_PX_PER_MM,
    COLOR_MASK_FAB_GOLD,
    COLOR_SILK_FAB,
    PT_TO_MM,
    load_panel_spec,
)

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
    svg_ns = "http://www.w3.org/2000/svg"
    ET.register_namespace("", svg_ns)

    tree = ET.parse(raw_svg)
    root = tree.getroot()

    root.attrib["width"] = f"{width_mm:.2f}mm"
    root.attrib["height"] = f"{height_mm:.2f}mm"
    root.attrib["viewBox"] = f"0 0 {width_mm:.2f} {height_mm:.2f}"
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
        elem.attrib.pop("stroke", None)
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


def run_clearance_audit(spec: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    """Run pixel-exact clearance checks across F.SilkS and F.Mask at 40 px/mm."""
    canvas = spec["canvas"]
    rules = spec.get("fabrication_rules", {})
    width_mm = float(canvas["width_mm"])
    height_mm = float(canvas["height_mm"])
    min_silk_mask_mm = float(rules.get("min_silk_to_mask_clearance_mm", 0.20))
    edge_pullback_mm = float(rules.get("copper_edge_pullback_mm", 0.60))

    silks_raw = _load_mask_bitmap(
        out_dir / "_audit_silks.png",
        round(width_mm * AUDIT_PX_PER_MM),
        round(height_mm * AUDIT_PX_PER_MM),
    )
    mask_raw = _load_mask_bitmap(
        out_dir / "_audit_mask.png",
        round(width_mm * AUDIT_PX_PER_MM),
        round(height_mm * AUDIT_PX_PER_MM),
    )

    h_px, w_px = silks_raw.shape
    xs_mm = (np.arange(w_px, dtype=np.float32) + 0.5) / AUDIT_PX_PER_MM
    ys_mm = (np.arange(h_px, dtype=np.float32) + 0.5) / AUDIT_PX_PER_MM
    yy, xx = np.meshgrid(ys_mm, xs_mm, indexing="ij")

    errors: list[str] = []
    metrics: dict[str, Any] = {}

    direct_overlap = int(np.count_nonzero(silks_raw & mask_raw))
    min_gap_mm: float | None = None
    for rad_px in range(1, 25):
        dilated = _dilate_disk(mask_raw, rad_px)
        hits = int(np.count_nonzero(silks_raw & dilated))
        if hits > 0:
            min_gap_mm = round((rad_px - 1) / AUDIT_PX_PER_MM, 3)
            break
    if min_gap_mm is None:
        min_gap_mm = 0.60
    metrics["silk_to_mask_overlap_px"] = direct_overlap
    metrics["silk_to_mask_min_gap_mm"] = min_gap_mm
    if direct_overlap > 0 or min_gap_mm < min_silk_mask_mm:
        errors.append(
            f"F.SilkS to F.Mask clearance too small: {min_gap_mm} mm (direct overlap {direct_overlap} px)"
        )

    edge_mask_zone = (
        (xx < edge_pullback_mm)
        | (xx > width_mm - edge_pullback_mm)
        | (yy < edge_pullback_mm)
        | (yy > height_mm - edge_pullback_mm)
    )
    edge_silk_zone = (
        (xx < 0.50) | (xx > width_mm - 0.50) | (yy < 0.50) | (yy > height_mm - 0.50)
    )
    mask_edge_hits = int(np.count_nonzero(mask_raw & edge_mask_zone))
    silk_edge_hits = int(np.count_nonzero(silks_raw & edge_silk_zone))
    metrics["mask_edge_pullback_violations_px"] = mask_edge_hits
    metrics["silk_edge_inset_violations_px"] = silk_edge_hits
    if mask_edge_hits:
        errors.append(
            f"F.Mask violates {edge_pullback_mm:.2f} mm edge pullback ({mask_edge_hits} px)"
        )
    if silk_edge_hits:
        errors.append(f"F.SilkS violates 0.50 mm edge inset ({silk_edge_hits} px)")

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

    for comp in spec["components"]:
        ref = comp["ref"]
        cx = float(comp["local_x"])
        cy = float(comp["local_y"])
        drill = float(comp["drill_mm"])
        keepout = float(comp["keepout_mm"])
        kind = str(comp.get("kind", ""))
        dist2 = (xx - cx) ** 2 + (yy - cy) ** 2

        if not comp.get("grounded", True) or kind.startswith("led"):
            npth_r = drill / 2.0 + 0.50
            npth_zone = dist2 <= npth_r**2
            bezel_zone = dist2 <= (keepout / 2.0) ** 2
            m_hits = int(np.count_nonzero(mask_raw & npth_zone))
            s_hits = int(np.count_nonzero(silks_raw & bezel_zone))
            metrics[f"{ref}_npth_mask_hits_px"] = m_hits
            metrics[f"{ref}_bezel_silk_hits_px"] = s_hits
            if m_hits:
                errors.append(
                    f"{ref} F.Mask inside {npth_r:.2f} mm NPTH pullback ({m_hits} px)"
                )
            if s_hits:
                errors.append(
                    f"{ref} F.SilkS inside {keepout / 2.0:.2f} mm bezel keepout ({s_hits} px)"
                )
        else:
            drill_zone = dist2 <= (drill / 2.0 + 0.25) ** 2
            m_hits = int(np.count_nonzero(mask_raw & drill_zone))
            s_hits = int(np.count_nonzero(silks_raw & drill_zone))
            if m_hits or s_hits:
                errors.append(
                    f"{ref} hole keepout overlap: mask={m_hits} px, silk={s_hits} px"
                )

            if kind in ("switch_submini", "switch", "jack"):
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
        description="Normalize VectorCraft panel SVGs to 1:1 mm Plain SVGs and run clearance audit."
    )
    parser.add_argument("--spec", type=Path, default=Path("panel_svg_spec.md"))
    parser.add_argument("--dir", type=Path, default=Path("panel_art"))
    parser.add_argument("--silks-color", default=COLOR_SILK_FAB)
    parser.add_argument("--mask-color", default=COLOR_MASK_FAB_GOLD)
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Skip SVG normalization and run only the bitmap clearance audit",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep intermediate raw SVGs, audit bitmaps, and build_steps.json",
    )
    args = parser.parse_args()

    spec = load_panel_spec(args.spec)
    w_mm = float(spec["canvas"]["width_mm"])
    h_mm = float(spec["canvas"]["height_mm"])

    report: dict[str, Any] = {}
    if not args.audit_only:
        report["front_silkscreen"] = normalize_svg_to_mm(
            args.dir / "front_silkscreen.raw.svg",
            args.dir / "front_silkscreen.svg",
            args.silks_color,
            w_mm,
            h_mm,
        )
        report["front_soldermask"] = normalize_svg_to_mm(
            args.dir / "front_soldermask.raw.svg",
            args.dir / "front_soldermask.svg",
            args.mask_color,
            w_mm,
            h_mm,
        )

    report["clearance_audit"] = run_clearance_audit(spec, args.dir)

    if not args.keep_temp and not args.audit_only:
        for tmp_name in (
            "front_silkscreen.raw.svg",
            "front_soldermask.raw.svg",
            "_audit_silks.png",
            "_audit_mask.png",
            "build_steps.json",
        ):
            tmp_path = args.dir / tmp_name
            if tmp_path.exists():
                tmp_path.unlink()

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
