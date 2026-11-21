#!/usr/bin/env python3
"""Render cropped or full KiCad 3D silkscreen previews with board-local mm rulers."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[4]
VENV_PYTHON = ROOT / ".venv/bin/python"

try:
    from PIL import Image, ImageDraw, ImageFont
except ModuleNotFoundError:
    if VENV_PYTHON.exists():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), *sys.argv])
    raise

KICAD_CLI = pathlib.Path("/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")
BOARD_W = 30.0
BOARD_H = 108.0
DEFAULT_PCB = ROOT / "envelope_follower.kicad_pcb"
DEFAULT_LAYOUT = ROOT / "silk_layout.json"

BG_PCB = (28, 30, 34, 255)
BG_MARGIN = (20, 22, 26)
FRAME_COLOR = (95, 102, 114)
TICK_COLOR = (170, 178, 190)
TEXT_COLOR = (232, 236, 242)
MUTED_TEXT_COLOR = (155, 163, 176)

MARGIN_LEFT = 44
MARGIN_TOP = 32
MARGIN_RIGHT = 16
MARGIN_BOTTOM = 16


def _layer_to_side(layer: str) -> str:
    """Map KiCad silkscreen layer name to kicad-cli render side."""
    return "top" if layer in ("F.SilkS", "F.Silkscreen") else "bottom"


def _collect_targets(
    layout: dict, tokens: list[str]
) -> tuple[list[tuple[float, float, str]], list[str]]:
    """Collect (x, y, layer) points matching footprint refs or board_texts substrings."""
    footprints = layout.get("footprints", {})
    fp_by_upper = {k.upper(): k for k in footprints}
    board_texts = layout.get("board_texts", [])

    points: list[tuple[float, float, str]] = []
    matched_names: list[str] = []
    unmatched: list[str] = []

    for raw in tokens:
        tok = raw.strip()
        if not tok:
            continue
        fp_key = fp_by_upper.get(tok.upper())
        if fp_key is not None:
            entry = footprints[fp_key]
            if entry == "auto":
                unmatched.append(f"{fp_key} (marked 'auto')")
                continue
            added = 0
            ref_d = entry.get("ref")
            if isinstance(ref_d, dict):
                points.append((ref_d["x"], ref_d["y"], ref_d["layer"]))
                added += 1
            for txt_d in entry.get("texts", []):
                points.append((txt_d["x"], txt_d["y"], txt_d["layer"]))
                added += 1
            if added:
                matched_names.append(fp_key)
            else:
                unmatched.append(f"{fp_key} (no visible silk text)")
            continue

        needle = tok.lower()
        hits = [
            item for item in board_texts if needle in str(item.get("text", "")).lower()
        ]
        if hits:
            for item in hits:
                points.append((item["x"], item["y"], item["layer"]))
            matched_names.append(hits[0]["text"])
        else:
            unmatched.append(tok)

    if unmatched or not points:
        detail = ", ".join(unmatched) if unmatched else ", ".join(tokens)
        raise SystemExit(
            f"ERROR: Could not find silkscreen target(s): {detail}\n"
            "Run `python3 generate_kicad_pcb.py --show-silk` to list valid refs."
        )
    return points, matched_names


def _choose_side(
    explicit_side: str | None, points: list[tuple[float, float, str]]
) -> str:
    """Resolve render side from CLI override or matched target layers."""
    if explicit_side is not None:
        return explicit_side
    if not points:
        return "bottom"
    top_count = sum(1 for _, _, layer in points if _layer_to_side(layer) == "top")
    bot_count = len(points) - top_count
    return "top" if top_count >= bot_count else "bottom"


def _render_raw_board(pcb_path: pathlib.Path, side: str) -> Image.Image:
    """Invoke kicad-cli pcb render and return transparent-background RGBA image."""
    if not KICAD_CLI.exists():
        raise SystemExit(f"ERROR: KiCad CLI not found at {KICAD_CLI}")
    if not pcb_path.exists():
        raise SystemExit(f"ERROR: Missing PCB file: {pcb_path}")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        tmp_png = pathlib.Path(tf.name)
    try:
        cmd = [
            str(KICAD_CLI),
            "pcb",
            "render",
            "--side",
            side,
            "--width",
            "1000",
            "--height",
            "3200",
            "--background",
            "transparent",
            "--quality",
            "basic",
            "--output",
            str(tmp_png),
            str(pcb_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0:
            raise SystemExit(
                f"ERROR: kicad-cli pcb render failed ({res.returncode}):\n"
                f"{res.stdout}\n{res.stderr}"
            )
        return Image.open(tmp_png).convert("RGBA")
    finally:
        tmp_png.unlink(missing_ok=True)


def _mm_to_px_x(lx: float, side: str, bx0: int, bx1: int) -> float:
    bw = bx1 - bx0
    if side == "bottom":
        return bx0 + ((BOARD_W - lx) / BOARD_W) * bw
    return bx0 + (lx / BOARD_W) * bw


def _mm_to_px_y(ly: float, by0: int, by1: int) -> float:
    bh = by1 - by0
    return by0 + (ly / BOARD_H) * bh


def _px_x_to_mm(px: float, side: str, bx0: int, bx1: int) -> float:
    bw = max(1, bx1 - bx0)
    frac = (px - bx0) / bw
    if side == "bottom":
        return BOARD_W * (1.0 - frac)
    return BOARD_W * frac


def _px_y_to_mm(py: float, by0: int, by1: int) -> float:
    bh = max(1, by1 - by0)
    return BOARD_H * ((py - by0) / bh)


def _draw_ruler_canvas(
    content: Image.Image,
    *,
    side: str,
    mm_x_left: float,
    mm_x_right: float,
    mm_y_top: float,
    mm_y_bottom: float,
    tick_step: float,
    title: str,
) -> Image.Image:
    """Wrap rendered PCB crop in an outside margin with board-local mm ticks."""
    cw, ch = content.size
    out_w = MARGIN_LEFT + cw + MARGIN_RIGHT
    out_h = MARGIN_TOP + ch + MARGIN_BOTTOM
    canvas = Image.new("RGB", (out_w, out_h), BG_MARGIN)
    canvas.paste(content, (MARGIN_LEFT, MARGIN_TOP))

    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=11)
    title_font = ImageFont.load_default(size=12)

    draw.rectangle(
        (MARGIN_LEFT - 1, MARGIN_TOP - 1, MARGIN_LEFT + cw, MARGIN_TOP + ch),
        outline=FRAME_COLOR,
        width=1,
    )
    draw.text((MARGIN_LEFT, 4), title, fill=TEXT_COLOR, font=title_font)

    # X axis ticks along top margin edge
    span_x = mm_x_right - mm_x_left
    if abs(span_x) > 1e-6:
        for i in range(int(BOARD_W / tick_step) + 1):
            tx_mm = round(i * tick_step, 3)
            frac = (tx_mm - mm_x_left) / span_x
            if frac < 0.0 or frac > 1.0:
                continue
            px = round(MARGIN_LEFT + frac * cw)
            draw.line(
                (px, MARGIN_TOP - 6, px, MARGIN_TOP - 1), fill=TICK_COLOR, width=1
            )
            lbl = f"{int(tx_mm)}" if float(tx_mm).is_integer() else f"{tx_mm:.1f}"
            bbox = font.getbbox(lbl)
            lw = bbox[2] - bbox[0]
            lx_txt = max(MARGIN_LEFT, min(MARGIN_LEFT + cw - lw, px - lw // 2))
            draw.text((lx_txt, 17), lbl, fill=MUTED_TEXT_COLOR, font=font)

    # Y axis ticks along left margin edge
    span_y = mm_y_bottom - mm_y_top
    if abs(span_y) > 1e-6:
        for i in range(int(BOARD_H / tick_step) + 1):
            ty_mm = round(i * tick_step, 3)
            frac = (ty_mm - mm_y_top) / span_y
            if frac < 0.0 or frac > 1.0:
                continue
            py = round(MARGIN_TOP + frac * ch)
            draw.line(
                (MARGIN_LEFT - 6, py, MARGIN_LEFT - 1, py), fill=TICK_COLOR, width=1
            )
            lbl = f"{int(ty_mm)}" if float(ty_mm).is_integer() else f"{ty_mm:.1f}"
            bbox = font.getbbox(lbl)
            lw = bbox[2] - bbox[0]
            lh = bbox[3] - bbox[1]
            ly_txt = max(MARGIN_TOP, min(MARGIN_TOP + ch - lh, py - lh // 2 - 1))
            draw.text(
                (MARGIN_LEFT - 9 - lw, ly_txt), lbl, fill=MUTED_TEXT_COLOR, font=font
            )

    draw.text((6, 4), "mm", fill=MUTED_TEXT_COLOR, font=font)
    return canvas


def _default_output_path(side: str, matched: list[str], full: bool) -> pathlib.Path:
    if matched and not full:
        raw_tag = "_".join(matched[:3])
        safe_tag = re.sub(r"[^A-Za-z0-9._-]+", "_", raw_tag).strip("_") or side
        return pathlib.Path(f"/tmp/silk_preview_{safe_tag}.png")
    return pathlib.Path(f"/tmp/silk_preview_{side}_full.png")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Render KiCad 3D silkscreen preview with board-local mm rulers."
    )
    parser.add_argument(
        "--ref",
        nargs="+",
        metavar="REF",
        default=[],
        help="Footprint ref(s) or board text substring(s) to focus and crop around.",
    )
    parser.add_argument(
        "--side",
        choices=("top", "bottom"),
        default=None,
        help="Board side to render (auto-detected from --ref, default 'bottom').",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Render the full selected board side without cropping around --ref.",
    )
    parser.add_argument(
        "--pad-mm",
        type=float,
        default=10.0,
        help="Padding in mm around target labels when cropping (default: 10.0).",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=None,
        help="Output PNG path (default: /tmp/silk_preview_<target>.png).",
    )
    parser.add_argument(
        "--pcb",
        type=pathlib.Path,
        default=DEFAULT_PCB,
        help=f"Input .kicad_pcb path (default: {DEFAULT_PCB.name}).",
    )
    parser.add_argument(
        "--silk-layout",
        type=pathlib.Path,
        default=DEFAULT_LAYOUT,
        help=f"Silk layout JSON path (default: {DEFAULT_LAYOUT.name}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Render silkscreen preview image and print saved path."""
    args = parse_args(argv)

    points: list[tuple[float, float, str]] = []
    matched: list[str] = []
    if args.ref:
        if not args.silk_layout.exists():
            raise SystemExit(f"ERROR: Missing silk layout JSON: {args.silk_layout}")
        layout = json.loads(args.silk_layout.read_text(encoding="utf-8"))
        points, matched = _collect_targets(layout, args.ref)

    side = _choose_side(args.side, points)
    raw = _render_raw_board(args.pcb, side)

    alpha_bbox = raw.getchannel("A").getbbox()
    if alpha_bbox is None:
        raise SystemExit("ERROR: Rendered image is completely transparent.")
    bx0, by0, bx1, by1 = alpha_bbox

    bg = Image.new("RGBA", raw.size, BG_PCB)
    flat = Image.alpha_composite(bg, raw).convert("RGB")

    is_crop = bool(points) and not args.full
    if is_crop:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        lx0 = max(0.0, min(xs) - args.pad_mm)
        lx1 = min(BOARD_W, max(xs) + args.pad_mm)
        ly0 = max(0.0, min(ys) - args.pad_mm)
        ly1 = min(BOARD_H, max(ys) + args.pad_mm)

        px0, px1 = sorted(
            [
                round(_mm_to_px_x(lx0, side, bx0, bx1)),
                round(_mm_to_px_x(lx1, side, bx0, bx1)),
            ]
        )
        py0, py1 = sorted(
            [
                round(_mm_to_px_y(ly0, by0, by1)),
                round(_mm_to_px_y(ly1, by0, by1)),
            ]
        )
        cx0 = max(0, px0)
        cy0 = max(0, py0)
        cx1 = min(flat.width, px1)
        cy1 = min(flat.height, py1)
        cropped = flat.crop((cx0, cy0, cx1, cy1))

        cw, ch = cropped.size
        scale = 1.0
        if cw < 700:
            scale = 700.0 / max(1, cw)
        max_dim = max(cw * scale, ch * scale)
        if max_dim > 1200.0:
            scale *= 1200.0 / max_dim
        if abs(scale - 1.0) > 1e-3:
            cropped = cropped.resize(
                (max(1, round(cw * scale)), max(1, round(ch * scale))),
                Image.Resampling.LANCZOS,
            )

        tick_step = 2.0
        layer_tag = "F.SilkS" if side == "top" else "B.SilkS"
        title = f"{side.upper()} ({layer_tag}) - {', '.join(matched)}"
    else:
        cx0 = max(0, bx0 - 16)
        cy0 = max(0, by0 - 16)
        cx1 = min(flat.width, bx1 + 16)
        cy1 = min(flat.height, by1 + 16)
        cropped = flat.crop((cx0, cy0, cx1, cy1))
        cw, ch = cropped.size
        if ch > 1800:
            scale = 1800.0 / ch
            cropped = cropped.resize(
                (max(1, round(cw * scale)), 1800),
                Image.Resampling.LANCZOS,
            )
        tick_step = 10.0
        layer_tag = "F.SilkS" if side == "top" else "B.SilkS"
        title = f"{side.upper()} ({layer_tag}) - FULL BOARD"

    mm_x_left = _px_x_to_mm(cx0, side, bx0, bx1)
    mm_x_right = _px_x_to_mm(cx1, side, bx0, bx1)
    mm_y_top = _px_y_to_mm(cy0, by0, by1)
    mm_y_bottom = _px_y_to_mm(cy1, by0, by1)

    annotated = _draw_ruler_canvas(
        cropped,
        side=side,
        mm_x_left=mm_x_left,
        mm_x_right=mm_x_right,
        mm_y_top=mm_y_top,
        mm_y_bottom=mm_y_bottom,
        tick_step=tick_step,
        title=title,
    )

    out_path = args.output or _default_output_path(side, matched, args.full)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    annotated.save(out_path)
    print(
        f"Saved preview: {out_path} ({annotated.width}x{annotated.height} px, "
        f"side={side}, X={mm_x_left:.1f}..{mm_x_right:.1f} mm, "
        f"Y={mm_y_top:.1f}..{mm_y_bottom:.1f} mm)"
    )


if __name__ == "__main__":
    main()
