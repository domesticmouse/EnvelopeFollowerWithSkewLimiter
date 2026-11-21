#!/usr/bin/env python3
"""Programmatic KiCad 10 PCB generator for the 6 HP Envelope Follower with Skew Limiter.

Reads `envelope_follower.net` (80 components, 48 active nets) and unit-1 schematic
instance UUIDs from `envelope_follower.kicad_sch`, places panel-mounted controls on
`F.Cu` and SMD/power/test-point hardware on `B.Cu`, pre-routes critical IC/decoupling
and GND stitching vias, routes all remaining nets on a 0.25 mm A* grid, pours F.Cu/B.Cu
GND planes, and applies collision-free silkscreen & fabrication notes.

Silkscreen iteration workflows (`silk_layout.json`):
- Edit `silk_layout.json` and run `--silk-only` (~1 s) to restamp silkscreen in place.
- Edit `envelope_follower.kicad_pcb` visually in KiCad, Save, and run `--sync-silk` to
  capture moved/rotated entries back into `silk_layout.json`.
- Inspect coordinates and nearby obstacles with `--show-silk [REF ...]`, verify with
  `--check-silk`, override path with `--silk-layout PATH`, or bypass with `--auto-silk`.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import re
import sys

KICAD_PYTHON = pathlib.Path(
    "/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3"
)

try:
    import pcbnew
except ModuleNotFoundError:
    if KICAD_PYTHON.exists():
        os.execv(str(KICAD_PYTHON), [str(KICAD_PYTHON), *sys.argv])
    raise

ROOT = pathlib.Path(__file__).resolve().parent
LAYOUT_SCRIPTS = ROOT / ".agents/skills/kicad-pcbnew-layout/scripts"
SILK_SCRIPTS = ROOT / ".agents/skills/kicad-silkscreen-markup/scripts"
sys.path.insert(0, str(LAYOUT_SCRIPTS))
sys.path.insert(0, str(SILK_SCRIPTS))

from pcbnew_layout_template import (
    FP_DIR,
    GridRouter,
    _find_child,
    _find_children,
    _merge_collinear_path,
    add_track,
    add_via,
    assign_nets,
    create_base_board,
    extract_keepout_circles,
    extract_pad_geometry,
    parse_netlist,
    parse_sexpr,
    pour_gnd_zones,
)
from silk_annotator import (
    SilkGrid,
    _bbox_tuple,
    _configure_ref_field,
    add_silk_dot,
    add_silk_rect,
    add_silk_seg,
    add_silk_text,
    add_standard_fab_notes,
    box_edge_distance,
    compact_passive_value,
    footprint_bbox,
    inspect_board_silk,
    is_fiducial_ref,
    place_ref_val_pair,
)

# ---------------------------------------------------------------------------
# Board Geometry & File Paths
# ---------------------------------------------------------------------------
BOARD_W = 30.00  # 6 HP Doepfer standard width
BOARD_H = 108.00  # 128.50 - 2 * 10.25 mm Eurorack rail clearance
BOARD_X0 = 100.00
BOARD_Y0 = 40.00
BOARD_X1 = BOARD_X0 + BOARD_W
BOARD_Y1 = BOARD_Y0 + BOARD_H

NET_PATH = ROOT / "envelope_follower.net"
SCH_PATH = ROOT / "envelope_follower.kicad_sch"
PCB_PATH = ROOT / "envelope_follower.kicad_pcb"
SILK_LAYOUT_PATH = ROOT / "silk_layout.json"
CUSTOM_FP_DIR = ROOT / "footprints"

TRACK_WIDTH = 0.25
PWR_TRACK_WIDTH = 0.30
RAW_PWR_WIDTH = 0.40
CLEARANCE = 0.20
ROUTER_CLEARANCE = 0.22
VIA_DIAM = 0.60
VIA_DRILL = 0.30
EDGE_CLEARANCE = 0.40


def _g(lx: float, ly: float) -> tuple[float, float]:
    """Convert board-local (lx, ly) mm coordinates to global KiCad coordinates."""
    return (round(BOARD_X0 + lx, 4), round(BOARD_Y0 + ly, 4))


# ---------------------------------------------------------------------------
# Component Placements: (lx, ly, rot_deg, is_back)
# ---------------------------------------------------------------------------
# F.Cu panel-mounted hardware (11 populated THT parts):
# - Potentiometers Alpha RD901F (rot=0): shaft center at (+7.50, +2.50) from origin.
# - Dailywell 2MS1 toggles (rot=0): bushing at (0, 0), Pin 3 (+2.54) connects to Pin 2
#   when lever is UP.
# - LED 3mm (rot=0): lens center at (+1.27, 0.00) from Pad 1.
# - Thonkiconn WQP-PJ398SM jacks (rot=0): bushing at (0.00, +6.48) from Pad S.
#
# B.Cu non-panel THT hardware (7 populated parts) + 12 DNP test points + 50 SMDs:
# All SMD passives kept horizontal (0° / 180°) for uniform pick-and-place (OR-001).
PLACEMENTS: dict[str, tuple[float, float, float, bool]] = {
    # --- F.Cu Panel Controls (11) ---
    "RV1": (7.50, 8.50, 0.0, False),  # shaft (15.00, 11.00) GAIN
    "RV2": (7.50, 24.00, 0.0, False),  # shaft (15.00, 26.50) ATK
    "RV3": (7.50, 39.50, 0.0, False),  # shaft (15.00, 42.00) REL
    "RV4": (7.50, 55.00, 0.0, False),  # shaft (15.00, 57.50) OFFSET
    "SW1": (7.00, 72.00, 0.0, False),  # bushing (7.00, 72.00) SMOOTH
    "LED1": (13.73, 72.00, 0.0, False),  # lens (15.00, 72.00) OUT R/G
    "SW2": (23.00, 72.00, 0.0, False),  # bushing (23.00, 72.00) FAST/SLOW
    "J1": (8.00, 79.02, 0.0, False),  # bushing (8.00, 85.50) IN
    "J2": (22.00, 79.02, 0.0, False),  # bushing (22.00, 85.50) SLEW IN
    "J3": (8.00, 94.02, 0.0, False),  # bushing (8.00, 100.50) OUT
    "J4": (22.00, 94.02, 0.0, False),  # bushing (22.00, 100.50) INV_OUT
    # --- B.Cu Non-Panel THT Hardware (7) ---
    "J_PWR": (23.25, 18.00, 0.0, True),  # pins 1-2 (-12V) at Y=18.00, 9-10 at Y=7.84
    "C1": (23.55, 27.75, 0.0, True),  # +12V 47uF (+ left, - right)
    "C2": (26.05, 35.75, 180.0, True),  # -12V 47uF (+ GND right, - -12V left)
    "C11": (22.30, 43.25, 0.0, True),  # 470nF FAST hold cap
    "C12": (22.30, 51.00, 0.0, True),  # 2.2uF SLOW hold cap 1/2
    "C13": (22.30, 60.25, 0.0, True),  # 2.2uF SLOW hold cap 2/2
    "C7": (3.20, 14.50, 90.0, True),  # 470nF input AC coupling (1=bot, 2=top)
    # --- B.Cu DNP Test Points (12) ---
    "TP12": (3.20, 2.50, 0.0, True),  # GND2
    "TP2": (16.70, 2.25, 0.0, True),  # +12V
    "TP3": (11.20, 2.25, 0.0, True),  # -12V
    "TP4": (3.20, 20.00, 0.0, True),  # PRE
    "TP9": (3.20, 26.50, 0.0, True),  # HWR
    "TP5": (3.20, 33.00, 0.0, True),  # RECT
    "TP10": (3.20, 39.50, 0.0, True),  # DRV
    "TP6": (3.20, 46.00, 0.0, True),  # ENV
    "TP11": (3.20, 52.50, 0.0, True),  # OFF
    "TP7": (3.20, 59.00, 0.0, True),  # INV
    "TP8": (3.20, 65.00, 0.0, True),  # OUT
    "TP1": (15.00, 105.60, 0.0, True),  # GND
    # --- B.Cu ICs & Decoupling Caps (6) ---
    "U1": (15.00, 83.50, 0.0, True),  # TL074H #1 (1-7 left, 8-14 right)
    "U2": (15.00, 98.50, 180.0, True),  # TL074H #2 (1-7 right, 8-14 left)
    "C3": (11.50, 76.80, 0.0, True),  # U1.4 +12V 100nF (pin 1=+12V left, 2=GND right)
    "C4": (
        18.50,
        76.80,
        180.0,
        True,
    ),  # U1.11 -12V 100nF (pin 1=-12V right, 2=GND left)
    "C5": (18.50, 91.50, 180.0, True),  # U2.4 +12V 100nF (pin 1=+12V right, 2=GND left)
    "C6": (11.50, 91.50, 0.0, True),  # U2.11 -12V 100nF (pin 1=-12V left, 2=GND right)
    # --- B.Cu Power Protection (4) ---
    "D1": (16.00, 10.80, 180.0, True),  # B5819W +12V (1=K right, 2=A left)
    "R1": (16.00, 18.75, 180.0, True),  # 10R +12V (RV1-RV2 inter-lug bay)
    "D2": (16.00, 26.50, 180.0, True),  # B5819W -12V (1=K right, 2=A left)
    "R2": (18.70, 34.00, 180.0, True),  # 10R -12V
    # --- B.Cu Mid-Left Corridor (X=11.00 / 10.40, 13 SMDs) ---
    "R4": (11.00, 7.00, 0.0, True),  # 10k 0.1% GAIN->U1A.+
    "R5": (11.00, 11.00, 0.0, True),  # 1M U1A.+ pull-down
    "R19": (11.00, 23.50, 0.0, True),  # 1k R_atk_min
    "D4": (11.00, 27.50, 0.0, True),  # 1N4148W D_atk (clear of RV2 lugs)
    "D5": (11.00, 40.80, 180.0, True),  # 1N4148W D_rel (clear of RV3 lugs)
    "R20": (11.00, 44.60, 0.0, True),  # 1k R_rel_min
    "C16": (11.00, 49.75, 0.0, True),  # 10uF 1206 -OFFSET filt (between RV3/RV4 lugs)
    "R29": (11.00, 53.30, 0.0, True),  # 5.1k -OFFSET range
    "R28": (11.00, 56.50, 0.0, True),  # 1k -OFFSET filt in
    "R23": (11.00, 60.50, 0.0, True),  # 100k U2B offset sum
    "R21": (10.40, 64.50, 0.0, True),  # 49.9k SMOOTH 1/2
    "R22": (10.40, 68.50, 0.0, True),  # 49.9k SMOOTH 2/2
    "R33": (10.40, 72.50, 0.0, True),  # 2.2k LED sense
    # --- B.Cu Mid-Right Corridor & Pot Mid-Bay (10 SMDs) ---
    "R11": (18.70, 38.00, 0.0, True),  # 10k 0.1% FWR FF 1/2 (1=left, 2=right)
    "R12": (
        18.70,
        42.00,
        180.0,
        True,
    ),  # 10k 0.1% FWR FF 2/2 (2=left->R13.1, 1=right->R11.2)
    "R13": (18.70, 46.00, 0.0, True),  # 10k 0.1% FWR FB 1/2 (1=left->R12.2, 2=right)
    "R14": (18.70, 50.00, 180.0, True),  # 10k 0.1% FWR FB 2/2 (2=left, 1=right->R13.2)
    "R26": (
        18.70,
        54.00,
        180.0,
        True,
    ),  # 1k +OFFSET filt in (2=left->C15.1, 1=right +12V)
    "C15": (15.80, 57.50, 180.0, True),  # 10uF 1206 +OFFSET filt (2=left GND, 1=right)
    "R27": (18.70, 62.50, 180.0, True),  # 5.1k +OFFSET range (2=left->RV4.3, 1=right)
    "R18": (19.30, 66.50, 0.0, True),  # 10k 0.1% U1D feedback
    "R10": (19.40, 71.50, 0.0, True),  # 10k 0.1% FWR HWR->sum
    "C14": (3.20, 72.00, 0.0, True),  # 220nF 0805 SMOOTH shunt (left of SW1)
    # --- B.Cu Lower-Left Column (Left of J1/J3, 8 SMDs) ---
    "R3": (3.55, 75.50, 0.0, True),  # 1M J1 jack bleed
    "D3": (3.55, 79.30, 0.0, True),  # BAT54S SOT-23 HWR
    "R8": (3.55, 83.20, 180.0, True),  # 10k 0.1% HWR in (2=left->D3.2, 1=right->R6.2)
    "R9": (3.55, 86.70, 0.0, True),  # 10k 0.1% HWR fb (1=left->R8.2, 2=right)
    "R6": (3.55, 90.20, 0.0, True),  # 10k 0.1% U1A fb
    "C8": (3.55, 93.70, 0.0, True),  # 33pF U1A comp
    "R7": (3.55, 97.20, 0.0, True),  # 10k 0.1% U1A gain
    "C9": (3.80, 101.20, 0.0, True),  # 10uF 1206 U1A DC block
    # --- B.Cu Lower-Bottom & Lower-Right (9 SMDs) ---
    "R32": (11.20, 105.60, 0.0, True),  # 1k OUT prot (J3.T..TP1)
    "R25": (18.80, 105.60, 180.0, True),  # 1k INV_OUT prot (TP1..J4.T)
    "R15": (26.45, 77.20, 180.0, True),  # 1k SLEW normal prot (2=left->J2.TN, 1=right)
    "R17": (26.45, 85.20, 180.0, True),  # 10k 0.1% SLEW->U1D.+ (2=left->U1.12, 1=right)
    "R16": (26.45, 89.20, 0.0, True),  # 1M SLEW ground ref (1=left->J2.T, 2=right GND)
    "C10": (26.45, 93.20, 0.0, True),  # 2.2nF 0805 U1D comp
    "R24": (26.45, 96.50, 180.0, True),  # 100k U2B fb (2=left->R30.1, 1=right)
    "R30": (26.45, 99.70, 0.0, True),  # 10k 0.1% U2C in
    "R31": (
        26.45,
        102.80,
        180.0,
        True,
    ),  # 10k 0.1% U2C fb (2=left->U2.8, 1=right->R30.2)
}

FIDUCIAL_PLACEMENTS: dict[str, tuple[float, float, float, bool]] = {
    "FID1": (6.80, 2.25, 0.0, True),
    "FID2": (27.50, 72.00, 0.0, True),
    "FID3": (26.45, 105.50, 0.0, True),
}

# Concise human-readable silkscreen values for active/polarized/UI parts
SILK_VALUE_OVERRIDES: dict[str, str] = {
    "U1": "TL074H",
    "U2": "TL074H",
    "D1": "B5819W",
    "D2": "B5819W",
    "D3": "BAT54S",
    "D4": "1N4148W",
    "D5": "1N4148W",
    "C1": "47uF",
    "C2": "47uF",
    "C7": "470nF",
    "C11": "470nF",
    "C12": "2.2uF",
    "C13": "2.2uF",
}


# ---------------------------------------------------------------------------
# Footprint & Schematic Metadata Loaders
# ---------------------------------------------------------------------------
def parse_schematic_unit1_uuids(sch_path: pathlib.Path) -> dict[str, str]:
    """Extract unit-1 symbol UUIDs from KiCad schematic for path-paired cross-validation."""
    tree = parse_sexpr(sch_path.read_text(encoding="utf-8"))
    uuids: dict[str, str] = {}
    for sym in _find_children(tree, "symbol"):
        ref = None
        for prop in _find_children(sym, "property"):
            if len(prop) >= 3 and prop[1] == "Reference":
                ref = prop[2]
                break
        unit_n = _find_child(sym, "unit")
        uuid_n = _find_child(sym, "uuid")
        if ref and not ref.startswith("#") and unit_n and uuid_n and unit_n[1] == "1":
            uuids[ref] = uuid_n[1]
    return uuids


def load_footprint(lib: str, fp_name: str) -> pcbnew.FOOTPRINT:
    """Load a footprint from project `footprints/` first, falling back to KiCad stock libs."""
    for base_dir in (CUSTOM_FP_DIR, FP_DIR):
        lib_path = base_dir / f"{lib}.pretty"
        if lib_path.exists():
            fp = pcbnew.FootprintLoad(str(lib_path), fp_name)
            if fp is not None:
                return fp
    raise RuntimeError(f"Failed to load footprint {lib}:{fp_name}")


def add_board_footprints(
    board: pcbnew.BOARD,
    components: dict[str, dict],
    sch_uuids: dict[str, str],
) -> dict[str, pcbnew.FOOTPRINT]:
    """Place all 80 netlist footprints plus 3 B.Cu assembly fiducials onto the board."""
    if set(PLACEMENTS) != set(components):
        raise ValueError(
            f"Placement mismatch: extra={set(PLACEMENTS) - set(components)}, "
            f"missing={set(components) - set(PLACEMENTS)}"
        )

    footprints: dict[str, pcbnew.FOOTPRINT] = {}
    for ref, (lx, ly, rot, is_back) in PLACEMENTS.items():
        comp = components[ref]
        lib, fp_name = comp["footprint"].split(":", 1)
        fp = load_footprint(lib, fp_name)
        board.Add(fp)

        gx, gy = _g(lx, ly)
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(gx), pcbnew.FromMM(gy)))
        if is_back:
            fp.Flip(fp.GetPosition(), False)
        fp.SetOrientationDegrees(rot)
        fp.SetReference(ref)
        fp.SetValue(comp["value"])
        inst_uuid = sch_uuids.get(ref, comp["tstamp"])
        fp.SetPath(pcbnew.KIID_PATH(f"/{inst_uuid}"))

        for key, val in comp["fields"].items():
            if key.lower() != "dnp":
                fp.SetField(key, val)
        for fld in fp.GetFields():
            fld.SetVisible(False)
        fp.Value().SetVisible(False)
        fp.Reference().SetVisible(False)

        if comp["dnp"]:
            fp.SetDNP(True)
            fp.SetExcludedFromBOM(True)

        footprints[ref] = fp

    for fref, (lx, ly, rot, is_back) in FIDUCIAL_PLACEMENTS.items():
        fp = load_footprint("Fiducial", "Fiducial_1mm_Mask2mm")
        board.Add(fp)
        gx, gy = _g(lx, ly)
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(gx), pcbnew.FromMM(gy)))
        if is_back:
            fp.Flip(fp.GetPosition(), False)
        fp.SetOrientationDegrees(rot)
        fp.SetReference(fref)
        fp.SetValue("Fiducial")
        fp.SetBoardOnly(True)
        fp.SetExcludedFromBOM(True)
        fp.SetExcludedFromPosFiles(True)
        fab_layer = pcbnew.B_Fab if is_back else pcbnew.F_Fab
        for item in (fp.Reference(), fp.Value()):
            item.SetLayer(fab_layer)
            item.SetVisible(False)
        footprints[fref] = fp

    return footprints


# ---------------------------------------------------------------------------
# Pre-Routing Mechanical & Courtyard Verification
# ---------------------------------------------------------------------------
def _layer_bbox(
    fp: pcbnew.FOOTPRINT, layer_id: int
) -> tuple[float, float, float, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for gi in fp.GraphicalItems():
        if hasattr(gi, "GetText") or gi.GetLayer() != layer_id:
            continue
        bb = gi.GetBoundingBox()
        xs.extend((pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight())))
        ys.extend((pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())))
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def _boxes_overlap(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    gap: float = 0.0,
) -> bool:
    return not (
        a[2] + gap <= b[0]
        or b[2] + gap <= a[0]
        or a[3] + gap <= b[1]
        or b[3] + gap <= a[1]
    )


def verify_placements(footprints: dict[str, pcbnew.FOOTPRINT]) -> None:
    """Assert zero courtyard overlaps, zero F/B THT-SMD interferences, and clean edges."""
    errors: list[str] = []
    f_crtyds: list[tuple[str, tuple[float, float, float, float]]] = []
    b_crtyds: list[tuple[str, tuple[float, float, float, float]]] = []
    f_tht_pads: list[tuple[str, tuple[float, float, float, float]]] = []
    b_tht_pads: list[tuple[str, tuple[float, float, float, float]]] = []

    for ref, fp in footprints.items():
        fcb = _layer_bbox(fp, pcbnew.F_CrtYd)
        bcb = _layer_bbox(fp, pcbnew.B_CrtYd)
        if fcb:
            f_crtyds.append((ref, fcb))
        if bcb:
            b_crtyds.append((ref, bcb))

        is_back = fp.IsFlipped()
        for pad in fp.Pads():
            _, _, x0, y0, x1, y1, _ = extract_pad_geometry(pad)
            if (
                x0 < BOARD_X0 + 0.45
                or x1 > BOARD_X1 - 0.45
                or y0 < BOARD_Y0 + 0.45
                or y1 > BOARD_Y1 - 0.45
            ):
                errors.append(
                    f"Pad edge clearance violation on {ref}:{pad.GetNumber()} "
                    f"({x0:.2f},{y0:.2f})..({x1:.2f},{y1:.2f})"
                )
            if pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                pbox = (x0, y0, x1, y1)
                if is_back:
                    b_tht_pads.append((ref, pbox))
                else:
                    f_tht_pads.append((ref, pbox))

    for side_name, lst in (("F.CrtYd", f_crtyds), ("B.CrtYd", b_crtyds)):
        for i in range(len(lst)):
            r1, b1 = lst[i]
            for j in range(i + 1, len(lst)):
                r2, b2 = lst[j]
                if _boxes_overlap(b1, b2):
                    errors.append(f"{side_name} overlap: {r1} {b1} vs {r2} {b2}")

    # B.Cu THT pads must stay clear of F.Cu component bodies/courtyards
    for bref, bpad in b_tht_pads:
        for fref, fbox in f_crtyds:
            if _boxes_overlap(bpad, fbox, gap=0.10):
                errors.append(
                    f"B.Cu THT pad {bref} overlaps F.Cu courtyard {fref}: {bpad} vs {fbox}"
                )

    # B.Cu component courtyards must clear F.Cu THT soldered pads
    for bref, bbox in b_crtyds:
        if any(p[0] == bref for p in b_tht_pads):
            continue
        for fref, fpad in f_tht_pads:
            if _boxes_overlap(bbox, fpad, gap=0.15):
                errors.append(
                    f"B.Cu courtyard {bref} overlaps F.Cu THT pad {fref}: {bbox} vs {fpad}"
                )

    if errors:
        raise RuntimeError(
            "Pre-routing placement check failed:\n  " + "\n  ".join(errors)
        )


# ---------------------------------------------------------------------------
# Strict Grid Router & Helpers
# ---------------------------------------------------------------------------
class StrictGridRouter(GridRouter):
    """GridRouter enforcing full 0.60 mm via clearance and 0.85 mm edge margin (BV-001)."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.edge_via_cells = 4  # 4 * 0.25 = 1.00 mm from board edge

    def can_place_via(self, gx: int, gy: int, net_code: int) -> bool:
        if (
            gx < self.edge_via_cells
            or gx >= self.nx - self.edge_via_cells
            or gy < self.edge_via_cells
            or gy >= self.ny - self.edge_via_cells
        ):
            return False
        idx = gy * self.nx + gx
        if self.via_block[idx] or self.smd_via_block[idx]:
            return False
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx_i, ny_i = gx + dx, gy + dy
                if nx_i < 0 or nx_i >= self.nx or ny_i < 0 or ny_i >= self.ny:
                    return False
                nidx = ny_i * self.nx + nx_i
                for layer in (0, 1):
                    if self.static_block[layer][nidx]:
                        return False
                    own = self.owner[layer][nidx]
                    if own != -1 and own != net_code:
                        return False
                    pnet = self.pad_net[layer][nidx]
                    if pnet != -1 and pnet != net_code:
                        return False
        return True

    def block_via_circle(self, cx: float, cy: float, radius: float) -> None:
        """Mark via_block inside a circle (for THT drills and via-to-via spacing)."""
        gx0 = max(0, math.floor((cx - radius - self.x0) / self.step))
        gx1 = min(self.nx - 1, math.ceil((cx + radius - self.x0) / self.step))
        gy0 = max(0, math.floor((cy - radius - self.y0) / self.step))
        gy1 = min(self.ny - 1, math.ceil((cy + radius - self.y0) / self.step))
        r2 = radius * radius
        for gy in range(gy0, gy1 + 1):
            dy2 = (self.y0 + gy * self.step - cy) ** 2
            row = gy * self.nx
            for gx in range(gx0, gx1 + 1):
                if (self.x0 + gx * self.step - cx) ** 2 + dy2 <= r2:
                    self.via_block[row + gx] = 1


def _grid_snap(router: StrictGridRouter, px: float, py: float) -> tuple[int, int]:
    return router.to_grid(px, py)


def _pad_grid_anchor(
    router: StrictGridRouter,
    fp: pcbnew.FOOTPRINT,
    pad: pcbnew.PAD,
) -> tuple[int, int, float, float, int]:
    """Return (gx, gy, exact_x, exact_y, pref_layer) for connecting a pad cleanly."""
    cx, cy, x0, _y0, x1, _y1, layers = extract_pad_geometry(pad)
    pref_layer = 1 if 1 in layers else 0
    ref = fp.GetReference()

    # For SOIC-14 ICs on B.Cu, escape outward past the pad edge so adjacent pins stay open
    if ref in ("U1", "U2"):
        fp_cx = pcbnew.ToMM(fp.GetPosition().x)
        esc_x = (
            math.floor((x0 - 0.15) / 0.25) * 0.25
            if cx < fp_cx
            else math.ceil((x1 + 0.15) / 0.25) * 0.25
        )
        gx, gy = router.to_grid(esc_x, cy)
        return gx, gy, cx, cy, 1

    gx, gy = router.to_grid(cx, cy)
    return gx, gy, cx, cy, pref_layer


def _emit_stub_to_grid(
    board: pcbnew.BOARD,
    router: StrictGridRouter,
    layer: int,
    px: float,
    py: float,
    gx: int,
    gy: int,
    width: float,
    net_item: pcbnew.NETINFO_ITEM,
    net_code: int,
) -> None:
    """Emit a connecting segment from an off-grid pad center to its grid anchor."""
    ax, ay = router.to_mm(gx, gy)
    if math.hypot(ax - px, ay - py) > 1e-4:
        layer_id = pcbnew.B_Cu if layer == 1 else pcbnew.F_Cu
        add_track(board, layer_id, px, py, ax, ay, width, net_item)
        router.mark_segment(layer, px, py, ax, ay, width, net_code)


def _init_router(
    board: pcbnew.BOARD,
    footprints: dict[str, pcbnew.FOOTPRINT],
    net_items: dict[str, pcbnew.NETINFO_ITEM],
) -> StrictGridRouter:
    """Construct and seed StrictGridRouter with pads, drills, keepouts, and fiducials."""
    router = StrictGridRouter(
        BOARD_X0,
        BOARD_Y0,
        BOARD_X1,
        BOARD_Y1,
        step=0.25,
        edge_clearance=0.42,
        track_width=TRACK_WIDTH,
        clearance=ROUTER_CLEARANCE,
    )

    for lid, cx, cy, r in extract_keepout_circles(footprints):
        router.mark_static_circle(lid, cx, cy, r + 0.25, block_via=True)

    for fref in FIDUCIAL_PLACEMENTS:
        pos = footprints[fref].GetPosition()
        fx, fy = pcbnew.ToMM(pos.x), pcbnew.ToMM(pos.y)
        router.mark_static_circle(1, fx, fy, 1.35, block_via=True)

    for ref, fp in footprints.items():
        if ref in FIDUCIAL_PLACEMENTS:
            continue
        is_fine_ic = ref in ("U1", "U2", "D3")
        pad_margin = 0.28 if is_fine_ic else 0.34

        for pad in fp.Pads():
            nc = pad.GetNetCode()
            cx, cy, x0, y0, x1, y1, layers = extract_pad_geometry(pad)
            if pad.GetAttribute() == pcbnew.PAD_ATTRIB_SMD:
                router.mark_smd_via_block(x0, y0, x1, y1, margin=0.04)
                for lid in layers:
                    router.mark_pad_box(lid, x0, y0, x1, y1, pad_margin, nc)
            else:
                # Through-hole pad (including unconnected lugs/NC pins)
                pad_r = max(x1 - x0, y1 - y0) * 0.5
                drill_r = pcbnew.ToMM(pad.GetDrillSize().x) * 0.5
                router.block_via_circle(cx, cy, max(pad_r, drill_r) + 0.60)
                if nc > 0:
                    gx, gy = router.to_grid(cx, cy)
                    router.tht_pad_grid[(gx, gy)] = nc
                    for lid in layers:
                        router.mark_pad_box(lid, x0, y0, x1, y1, pad_margin, nc)
                else:
                    if pad.GetShape() == pcbnew.PAD_SHAPE_CIRCLE:
                        for lid in layers:
                            router.mark_static_circle(lid, cx, cy, pad_r + 0.45, True)
                    else:
                        margin = 0.44
                        gx0 = max(
                            0, math.floor((x0 - margin - router.x0) / router.step)
                        )
                        gx1 = min(
                            router.nx - 1,
                            math.ceil((x1 + margin - router.x0) / router.step),
                        )
                        gy0 = max(
                            0, math.floor((y0 - margin - router.y0) / router.step)
                        )
                        gy1 = min(
                            router.ny - 1,
                            math.ceil((y1 + margin - router.y0) / router.step),
                        )
                        for lid in layers:
                            for gy_i in range(gy0, gy1 + 1):
                                row = gy_i * router.nx
                                for gx_i in range(gx0, gx1 + 1):
                                    router.static_block[lid][row + gx_i] = 1
                                    router.via_block[row + gx_i] = 1

    return router


def _place_smd_gnd_vias(
    board: pcbnew.BOARD,
    router: StrictGridRouter,
    footprints: dict[str, pcbnew.FOOTPRINT],
    gnd_item: pcbnew.NETINFO_ITEM,
) -> list[tuple[int, int]]:
    """Pre-place a B.Cu stub + tented GND via adjacent to every B.Cu SMD GND pad."""
    gnd_code = gnd_item.GetNetCode()
    placed: list[tuple[int, int]] = []

    # Share one inward central-belly GND via for U1 (pins 5 & 10) and U2 (pins 5 & 10)
    # so IC side escape channels stay completely unobstructed.
    handled_ic_gnd: set[tuple[str, str]] = set()
    for ic_ref in ("U1", "U2"):
        fp = footprints[ic_ref]
        ic_pos = fp.GetPosition()
        vx = pcbnew.ToMM(ic_pos.x)
        vy = pcbnew.ToMM(ic_pos.y)
        gx, gy = router.to_grid(vx, vy)
        ax, ay = router.to_mm(gx, gy)
        if router.can_place_via(gx, gy, gnd_code):
            add_via(board, ax, ay, gnd_item, VIA_DIAM, VIA_DRILL)
            router.mark_via_obstacle(ax, ay, 0.65, gnd_code)
            router.block_via_circle(ax, ay, 0.85)
            placed.append((gx, gy))
            for pin in ("5", "10"):
                pad = fp.FindPadByNumber(pin)
                if pad and pad.GetNetCode() == gnd_code:
                    cx, cy, *_ = extract_pad_geometry(pad)
                    add_track(
                        board, pcbnew.B_Cu, cx, cy, ax, cy, PWR_TRACK_WIDTH, gnd_item
                    )
                    add_track(
                        board, pcbnew.B_Cu, ax, cy, ax, ay, PWR_TRACK_WIDTH, gnd_item
                    )
                    router.mark_segment(1, cx, cy, ax, cy, PWR_TRACK_WIDTH, gnd_code)
                    router.mark_segment(1, ax, cy, ax, ay, PWR_TRACK_WIDTH, gnd_code)
                    handled_ic_gnd.add((ic_ref, pin))

    # Candidate offsets (dx, dy) in mm relative to pad center, sorted closest first
    offsets: list[tuple[float, float]] = []
    for d in (1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5):
        for sx, sy in (
            (d, 0.0),
            (-d, 0.0),
            (0.0, d),
            (0.0, -d),
            (d, 0.75),
            (d, -0.75),
            (-d, 0.75),
            (-d, -0.75),
            (0.75, d),
            (-0.75, d),
            (0.75, -d),
            (-0.75, -d),
        ):
            offsets.append((sx, sy))

    for ref, fp in sorted(footprints.items()):
        if not fp.IsFlipped():
            continue
        for pad in fp.Pads():
            if (
                pad.GetAttribute() != pcbnew.PAD_ATTRIB_SMD
                or pad.GetNetCode() != gnd_code
                or (ref, pad.GetNumber()) in handled_ic_gnd
            ):
                continue
            cx, cy, *_ = extract_pad_geometry(pad)
            found = None
            for dx, dy in offsets:
                vx, vy = cx + dx, cy + dy
                gx, gy = router.to_grid(vx, vy)
                ax, ay = router.to_mm(gx, gy)
                if math.hypot(ax - cx, ay - cy) < 0.75:
                    continue
                if router.can_place_via(gx, gy, gnd_code):
                    found = (gx, gy, ax, ay)
                    break
            if found is None:
                raise RuntimeError(
                    f"Could not place pre-routing GND via near {ref}:{pad.GetNumber()}"
                )
            gx, gy, vx, vy = found
            add_via(board, vx, vy, gnd_item, VIA_DIAM, VIA_DRILL)
            add_track(board, pcbnew.B_Cu, cx, cy, vx, vy, PWR_TRACK_WIDTH, gnd_item)
            router.mark_via_obstacle(vx, vy, 0.65, gnd_code)
            router.block_via_circle(vx, vy, 0.85)
            router.mark_segment(1, cx, cy, vx, vy, PWR_TRACK_WIDTH, gnd_code)
            placed.append((gx, gy))
    return placed


def _pre_route_ic_escapes(
    board: pcbnew.BOARD,
    router: StrictGridRouter,
    footprints: dict[str, pcbnew.FOOTPRINT],
    net_items: dict[str, pcbnew.NETINFO_ITEM],
) -> dict[tuple[str, str], tuple[int, int, int]]:
    """Emit outward IC escape stubs on B.Cu for non-GND U1/U2 pads before general routing."""
    anchors: dict[tuple[str, str], tuple[int, int, int]] = {}
    for ref in ("U1", "U2"):
        fp = footprints[ref]
        for pad in fp.Pads():
            nc = pad.GetNetCode()
            net_name = pad.GetNetname()
            if nc == 0 or net_name == "GND":
                continue
            gx, gy, cx, cy, layer = _pad_grid_anchor(router, fp, pad)
            width = PWR_TRACK_WIDTH if net_name in ("+12V", "-12V") else TRACK_WIDTH
            _emit_stub_to_grid(
                board, router, layer, cx, cy, gx, gy, width, net_items[net_name], nc
            )
            anchors[(ref, pad.GetNumber())] = (layer, gx, gy)
    return anchors


def _route_all_nets(
    board: pcbnew.BOARD,
    router: StrictGridRouter,
    footprints: dict[str, pcbnew.FOOTPRINT],
    net_items: dict[str, pcbnew.NETINFO_ITEM],
    nets: list[dict],
    ic_anchors: dict[tuple[str, str], tuple[int, int, int]],
) -> None:
    """Route every non-GND net in constrained-IC -> power -> Hi-Z -> span order."""
    constrained_nets = {
        "NET_FF_MID",
        "NET_FWR_FB_MID",
        "NET_PREAMP_OUT",
        "NET_U1A_POS",
        "NET_U1A_INV",
        "NET_U1B_INV",
        "NET_U1B_OUT",
        "NET_RECT_HALF",
        "NET_RECT_SUM",
        "NET_RECT_OUT",
        "NET_U1D_POS",
        "NET_U1D_INV",
        "NET_U1D_OUT",
        "NET_U2B_INV",
        "NET_U2C_INV",
        "NET_LED_SENSE",
        "NET_LED_DRV",
    }
    raw_power_nets = {
        "NET_PWR_POS_RAW",
        "NET_PWR_NEG_RAW",
        "NET_POS_PROT",
        "NET_NEG_PROT",
    }
    power_nets = raw_power_nets | {"+12V", "-12V"}
    hiz_nets = {
        "NET_ENV_CAP",
        "NET_SLOW_CAPS",
        "NET_IN_JACK",
        "NET_INV_AMP",
        "NET_ENV_BUF",
        "NET_OUT_AMP",
    }

    def net_sort_key(net_def: dict) -> tuple[int, float, str]:
        name = net_def["name"]
        if name in constrained_nets:
            tier = 0
        elif name in power_nets:
            tier = 1
        elif name in hiz_nets:
            tier = 2
        else:
            tier = 3
        xs: list[float] = []
        ys: list[float] = []
        for ref, pin in net_def["nodes"]:
            pad = footprints[ref].FindPadByNumber(pin)
            pos = pad.GetPosition()
            xs.append(pcbnew.ToMM(pos.x))
            ys.append(pcbnew.ToMM(pos.y))
        span = (max(xs) - min(xs)) + (max(ys) - min(ys)) if xs else 0.0
        return (tier, span, name)

    routable = [n for n in nets if n["name"] != "GND" and len(n["nodes"]) >= 2]
    routable.sort(key=net_sort_key)

    pre_connected: dict[str, list[tuple[str, str, str, str]]] = {}

    for net_def in routable:
        name = net_def["name"]
        ni = net_items[name]
        nc = ni.GetNetCode()
        width = (
            RAW_PWR_WIDTH
            if name in raw_power_nets
            else (PWR_TRACK_WIDTH if name in power_nets else TRACK_WIDTH)
        )

        # Build initial clusters (list of pin-state lists)
        pin_states: dict[tuple[str, str], tuple[int, int, int]] = {}
        for ref, pin in net_def["nodes"]:
            if (ref, pin) in ic_anchors:
                pin_states[(ref, pin)] = ic_anchors[(ref, pin)]
                continue
            fp = footprints[ref]
            pad = fp.FindPadByNumber(pin)
            gx, gy, cx, cy, pref_layer = _pad_grid_anchor(router, fp, pad)
            _emit_stub_to_grid(board, router, pref_layer, cx, cy, gx, gy, width, ni, nc)
            pin_states[(ref, pin)] = (pref_layer, gx, gy)

        # Union-find clusters for pre-routed decoupling pairs
        nodes = list(net_def["nodes"])
        parent_map = {nd: nd for nd in nodes}

        def find(
            nd: tuple[str, str],
            pmap: dict[tuple[str, str], tuple[str, str]] = parent_map,
        ) -> tuple[str, str]:
            while pmap[nd] != nd:
                pmap[nd] = pmap[pmap[nd]]
                nd = pmap[nd]
            return nd

        for r1, p1, r2, p2 in pre_connected.get(name, []):
            if (r1, p1) in parent_map and (r2, p2) in parent_map:
                parent_map[find((r2, p2))] = find((r1, p1))

        clusters: dict[tuple[str, str], list[tuple[int, int, int]]] = {}
        for nd in nodes:
            root = find(nd)
            st = pin_states[nd]
            clusters.setdefault(root, []).append(st)
            # For THT pads, also expose opposite-layer state at same grid cell
            fp = footprints[nd[0]]
            pad = fp.FindPadByNumber(nd[1])
            if pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                clusters[root].append((1 - st[0], st[1], st[2]))

        cluster_list = list(clusters.values())
        tree_states: set[tuple[int, int, int]] = set(cluster_list[0])
        remaining = cluster_list[1:]
        emitted_vias: set[tuple[int, int]] = set()
        branches: list[list[tuple[int, int, int]]] = []
        junctions: set[tuple[int, int, int]] = set(tree_states)

        # Greedily connect closest remaining cluster to the growing tree
        while remaining:
            best_idx = -1
            best_dist = 1e18
            for idx, cl in enumerate(remaining):
                for _, cx, cy in cl:
                    for _, tx, ty in tree_states:
                        d = abs(cx - tx) + abs(cy - ty)
                        if d < best_dist:
                            best_dist = d
                            best_idx = idx
            next_cl = remaining.pop(best_idx)

            path = router.route(next_cl, tree_states, nc, preferred_layer=1)
            if path is None:
                raise RuntimeError(
                    f"Routing failed on net {name} ({len(remaining) + 1} clusters left)"
                )

            branches.append(path)
            junctions.add(path[0])
            junctions.add(path[-1])
            for st in path:
                tree_states.add(st)

            # Immediately mark branch on router so subsequent branches share/avoid cleanly
            for i in range(len(path) - 1):
                l0, x0_i, y0_i = path[i]
                l1, x1_i, y1_i = path[i + 1]
                px0, py0 = router.to_mm(x0_i, y0_i)
                if l0 == l1:
                    px1, py1 = router.to_mm(x1_i, y1_i)
                    router.mark_segment(l0, px0, py0, px1, py1, width, nc)
                else:
                    if router.tht_pad_grid.get((x0_i, y0_i)) != nc:
                        router.mark_via_obstacle(px0, py0, 0.65, nc)
                        router.block_via_circle(px0, py0, 0.85)

        for br in branches:
            merged = _merge_collinear_path(br, junctions)
            for i in range(len(merged) - 1):
                l0, x0_i, y0_i = merged[i]
                l1, x1_i, y1_i = merged[i + 1]
                px0, py0 = router.to_mm(x0_i, y0_i)
                if l0 == l1:
                    px1, py1 = router.to_mm(x1_i, y1_i)
                    layer_id = pcbnew.B_Cu if l0 == 1 else pcbnew.F_Cu
                    add_track(board, layer_id, px0, py0, px1, py1, width, ni)
                else:
                    if (
                        router.tht_pad_grid.get((x0_i, y0_i)) != nc
                        and (x0_i, y0_i) not in emitted_vias
                    ):
                        add_via(board, px0, py0, ni, VIA_DIAM, VIA_DRILL)
                        emitted_vias.add((x0_i, y0_i))


def _sprinkle_gnd_stitching_vias(
    board: pcbnew.BOARD,
    router: StrictGridRouter,
    gnd_item: pcbnew.NETINFO_ITEM,
    existing: list[tuple[int, int]],
) -> list[pcbnew.PCB_VIA]:
    """Add tented GND stitching vias across open board regions (>= 4.0 mm spacing)."""
    gnd_code = gnd_item.GetNetCode()
    vias_mm = [router.to_mm(gx, gy) for gx, gy in existing]
    added_vias: list[pcbnew.PCB_VIA] = []
    for ly in range(4, int(BOARD_H) - 3, 4):
        for lx in range(3, int(BOARD_W) - 2, 4):
            vx, vy = _g(float(lx), float(ly))
            gx, gy = router.to_grid(vx, vy)
            ax, ay = router.to_mm(gx, gy)
            if any(math.hypot(ax - ex, ay - ey) < 4.0 for ex, ey in vias_mm):
                continue
            if router.can_place_via(gx, gy, gnd_code):
                via = add_via(board, ax, ay, gnd_item, VIA_DIAM, VIA_DRILL)
                router.mark_via_obstacle(ax, ay, 0.65, gnd_code)
                router.block_via_circle(ax, ay, 0.85)
                vias_mm.append((ax, ay))
                added_vias.append(via)
    return added_vias


def _prune_disconnected_stitching_vias(
    board: pcbnew.BOARD,
    stitch_vias: list[pcbnew.PCB_VIA],
) -> int:
    """Remove sprinkled stitching vias isolated from either F.Cu or B.Cu filled GND zones."""
    zones_by_layer = {
        z.GetFirstLayer(): z for z in board.Zones() if z.GetNetname() == "GND"
    }
    f_zone = zones_by_layer.get(pcbnew.F_Cu)
    b_zone = zones_by_layer.get(pcbnew.B_Cu)
    if f_zone is None or b_zone is None:
        return len(stitch_vias)

    kept = 0
    removed = 0
    for via in stitch_vias:
        pos = via.GetPosition()
        on_f = f_zone.HitTestFilledArea(pcbnew.F_Cu, pos)
        on_b = b_zone.HitTestFilledArea(pcbnew.B_Cu, pos)
        if on_f and on_b:
            kept += 1
        else:
            board.Remove(via)
            removed += 1
    if removed:
        board.BuildConnectivity()
    return kept


# ---------------------------------------------------------------------------
# Silkscreen & Fabrication Notes (+ silk_layout.json Round-Trip Helpers)
# ---------------------------------------------------------------------------
_SILK_LAYER_TO_NAME = {
    pcbnew.F_SilkS: "F.SilkS",
    pcbnew.B_SilkS: "B.SilkS",
}


def _parse_silk_layer(name: str) -> tuple[int, int, bool]:
    """Return (side_idx, layer_id, mirrored) for a F.SilkS/B.SilkS layer string."""
    if name in ("F.SilkS", "F.Silkscreen"):
        return (0, pcbnew.F_SilkS, False)
    if name in ("B.SilkS", "B.Silkscreen"):
        return (1, pcbnew.B_SilkS, True)
    raise ValueError(f"Unsupported silkscreen layer: {name!r}")


def _ref_sort_key(ref: str) -> tuple[str, int, str]:
    """Natural sort key for component reference designators (R1, R2, ..., R10)."""
    match = re.match(r"^([A-Za-z_]+?)(\d+)$", ref)
    if match:
        return (match.group(1), int(match.group(2)), ref)
    return (ref, -1, ref)


def _norm_angle(deg: float) -> float:
    """Normalize rotation degrees into [0.0, 360.0) without signed -0.0."""
    angle = round(deg % 360.0, 2)
    return 0.0 if angle in (0.0, 360.0) else angle


def _round_mm(nm_val: int, offset_mm: float = 0.0) -> float:
    """Convert KiCad nm coordinate to mm minus board offset, avoiding -0.0."""
    val = round(pcbnew.ToMM(nm_val) - offset_mm, 3)
    return 0.0 if val == 0.0 else val


def _to_local_box(
    box: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    """Convert a global mm (x0, y0, x1, y1) bbox to board-local mm."""
    return (
        round(box[0] - BOARD_X0, 2),
        round(box[1] - BOARD_Y0, 2),
        round(box[2] - BOARD_X0, 2),
        round(box[3] - BOARD_Y0, 2),
    )


def _text_item_to_dict(
    item: pcbnew.PCB_TEXT | pcbnew.PCB_FIELD,
    *,
    include_text: bool,
) -> dict:
    """Serialize a PCB_TEXT or PCB_FIELD item in board-local mm using bbox center."""
    ctr = item.GetBoundingBox().GetCenter()
    out: dict[str, object] = {"layer": _SILK_LAYER_TO_NAME[item.GetLayer()]}
    if include_text:
        out["text"] = item.GetText()
    out["x"] = _round_mm(ctr.x, BOARD_X0)
    out["y"] = _round_mm(ctr.y, BOARD_Y0)
    out["deg"] = _norm_angle(float(item.GetTextAngleDegrees()))
    out["height"] = _round_mm(item.GetTextHeight())
    out["thickness"] = _round_mm(item.GetTextThickness())
    return out


def extract_silk_layout(board: pcbnew.BOARD) -> dict:
    """Extract all silkscreen items from `board` into board-local schema dict."""
    qr_rects: list[dict] = []
    dots: list[dict] = []
    segments: list[dict] = []
    board_texts: list[dict] = []

    for d in board.GetDrawings():
        layer_id = d.GetLayer()
        layer_name = _SILK_LAYER_TO_NAME.get(layer_id)
        if layer_name is None:
            continue
        if isinstance(d, pcbnew.PCB_TEXT):
            if d.IsVisible():
                board_texts.append(_text_item_to_dict(d, include_text=True))
        elif isinstance(d, pcbnew.PCB_SHAPE):
            shape_t = d.GetShape()
            width = _round_mm(d.GetWidth())
            if shape_t == pcbnew.SHAPE_T_RECT:
                s, e = d.GetStart(), d.GetEnd()
                qr_rects.append(
                    {
                        "layer": layer_name,
                        "x0": _round_mm(s.x, BOARD_X0),
                        "y0": _round_mm(s.y, BOARD_Y0),
                        "x1": _round_mm(e.x, BOARD_X0),
                        "y1": _round_mm(e.y, BOARD_Y0),
                        "filled": bool(d.IsSolidFill()),
                        "width": width,
                    }
                )
            elif shape_t == pcbnew.SHAPE_T_CIRCLE:
                c = d.GetCenter()
                dots.append(
                    {
                        "layer": layer_name,
                        "x": _round_mm(c.x, BOARD_X0),
                        "y": _round_mm(c.y, BOARD_Y0),
                        "radius": _round_mm(d.GetRadius()),
                        "filled": bool(d.IsSolidFill()),
                        "width": width,
                    }
                )
            elif shape_t == pcbnew.SHAPE_T_SEGMENT:
                s, e = d.GetStart(), d.GetEnd()
                segments.append(
                    {
                        "layer": layer_name,
                        "x0": _round_mm(s.x, BOARD_X0),
                        "y0": _round_mm(s.y, BOARD_Y0),
                        "x1": _round_mm(e.x, BOARD_X0),
                        "y1": _round_mm(e.y, BOARD_Y0),
                        "width": width,
                    }
                )

    qr_rects.sort(key=lambda r: (r["layer"], r["x0"], r["y0"], r["x1"], r["y1"]))
    dots.sort(key=lambda d: (d["layer"], d["x"], d["y"], d["radius"]))
    segments.sort(key=lambda s: (s["layer"], s["x0"], s["y0"], s["x1"], s["y1"]))
    board_texts.sort(key=lambda t: (t["layer"], t["text"], t["x"], t["y"]))

    footprints_map: dict[str, dict] = {}
    for fp in sorted(
        board.GetFootprints(), key=lambda f: _ref_sort_key(f.GetReference())
    ):
        ref = fp.GetReference()
        if is_fiducial_ref(ref):
            continue
        vf = fp.Value()
        if vf.IsVisible() and vf.GetLayer() in _SILK_LAYER_TO_NAME:
            print(
                f"WARNING: {ref} Value field is visible on silk; keep Value hidden on "
                ".Fab and move its silk text item instead."
            )
        rf = fp.Reference()
        ref_entry = (
            _text_item_to_dict(rf, include_text=False)
            if rf.IsVisible() and rf.GetLayer() in _SILK_LAYER_TO_NAME
            else None
        )
        texts = [
            _text_item_to_dict(gi, include_text=True)
            for gi in fp.GraphicalItems()
            if isinstance(gi, pcbnew.PCB_TEXT)
            and gi.IsVisible()
            and gi.GetLayer() in _SILK_LAYER_TO_NAME
        ]
        texts.sort(key=lambda t: (t["layer"], t["text"], t["x"], t["y"]))
        footprints_map[ref] = {"ref": ref_entry, "texts": texts}

    return {
        "version": 1,
        "coordinate_system": (
            f"board-local mm relative to (BOARD_X0={BOARD_X0}, BOARD_Y0={BOARD_Y0}); "
            "matches KiCad Grid/Aux origin"
        ),
        "qr_rects": qr_rects,
        "dots": dots,
        "segments": segments,
        "board_texts": board_texts,
        "footprints": footprints_map,
    }


def _format_silk_layout_json(layout: dict) -> str:
    """Format silk_layout.json with compact single-line leaf items for crisp diffs."""
    lines: list[str] = [
        "{",
        f'  "version": {json.dumps(layout["version"])},',
        f'  "coordinate_system": {json.dumps(layout["coordinate_system"], ensure_ascii=False)},',
    ]
    for key in ("qr_rects", "dots", "segments", "board_texts"):
        items = layout.get(key, [])
        if not items:
            lines.append(f'  "{key}": [],')
            continue
        lines.append(f'  "{key}": [')
        for idx, item in enumerate(items):
            comma = "," if idx < len(items) - 1 else ""
            lines.append(f"    {json.dumps(item, ensure_ascii=False)}{comma}")
        lines.append("  ],")

    fps = layout.get("footprints", {})
    lines.append('  "footprints": {')
    fp_keys = sorted(fps, key=_ref_sort_key)
    for idx, ref in enumerate(fp_keys):
        entry = fps[ref]
        comma = "," if idx < len(fp_keys) - 1 else ""
        ref_key = json.dumps(ref, ensure_ascii=False)
        if entry == "auto":
            lines.append(f'    {ref_key}: "auto"{comma}')
            continue
        ref_s = json.dumps(entry.get("ref"), ensure_ascii=False)
        texts = entry.get("texts", [])
        if entry.get("ref") is None and len(texts) <= 1:
            texts_s = f"[{json.dumps(texts[0], ensure_ascii=False)}]" if texts else "[]"
            lines.append(f'    {ref_key}: {{"ref": null, "texts": {texts_s}}}{comma}')
        elif not texts:
            lines.append(f'    {ref_key}: {{"ref": {ref_s}, "texts": []}}{comma}')
        else:
            lines.append(f"    {ref_key}: {{")
            lines.append(f'      "ref": {ref_s},')
            lines.append('      "texts": [')
            for tidx, txt in enumerate(texts):
                tcomma = "," if tidx < len(texts) - 1 else ""
                lines.append(f"        {json.dumps(txt, ensure_ascii=False)}{tcomma}")
            lines.append("      ]")
            lines.append(f"    }}{comma}")
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def _load_silk_layout(path: pathlib.Path) -> dict:
    """Load and minimally validate `silk_layout.json`."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("footprints"), dict):
        raise TypeError(f"Invalid silk layout file: {path}")
    return data


def _fmt_pos(item: dict) -> str:
    """Compact position string for diff summaries."""
    return f"({item['x']}, {item['y']}, {item['deg']}°)"


def _summarize_silk_diff(old_layout: dict | None, new_layout: dict) -> list[str]:
    """Return human-readable summary lines describing changes between two layouts."""
    if old_layout is None:
        summary = (
            "Initialized layout: "
            f"{len(new_layout.get('footprints', {}))} footprints, "
            f"{len(new_layout.get('board_texts', []))} board_texts, "
            f"{len(new_layout.get('qr_rects', []))} qr_rects, "
            f"{len(new_layout.get('dots', []))} dots."
        )
        return [summary]

    changes: list[str] = []
    for key in ("qr_rects", "dots", "segments", "board_texts"):
        old_items = old_layout.get(key, [])
        new_items = new_layout.get(key, [])
        if old_items != new_items:
            changes.append(
                f"{key}: updated ({len(old_items)} -> {len(new_items)} items)"
            )

    old_fps = old_layout.get("footprints", {})
    new_fps = new_layout.get("footprints", {})
    for ref in sorted(set(old_fps) | set(new_fps), key=_ref_sort_key):
        if ref not in old_fps:
            changes.append(f"{ref}: added")
            continue
        if ref not in new_fps:
            changes.append(f"{ref}: removed")
            continue
        old_e, new_e = old_fps[ref], new_fps[ref]
        if old_e == new_e:
            continue
        if not isinstance(old_e, dict) or not isinstance(new_e, dict):
            changes.append(f"{ref}: updated ({old_e!r} -> {new_e!r})")
            continue
        parts: list[str] = []
        if old_e.get("ref") != new_e.get("ref"):
            or_d, nr_d = old_e.get("ref"), new_e.get("ref")
            if isinstance(or_d, dict) and isinstance(nr_d, dict):
                parts.append(f"REF {_fmt_pos(or_d)} -> {_fmt_pos(nr_d)}")
            else:
                parts.append(f"REF {or_d} -> {nr_d}")
        if old_e.get("texts") != new_e.get("texts"):
            ot_list, nt_list = old_e.get("texts", []), new_e.get("texts", [])
            if len(ot_list) == len(nt_list) == 1:
                ot, nt = ot_list[0], nt_list[0]
                if ot.get("text") == nt.get("text"):
                    parts.append(f"'{nt['text']}' {_fmt_pos(ot)} -> {_fmt_pos(nt)}")
                else:
                    parts.append(f"text '{ot.get('text')}' -> '{nt.get('text')}'")
            else:
                parts.append(f"texts ({len(ot_list)} -> {len(nt_list)} items)")
        changes.append(f"{ref}: {', '.join(parts) if parts else 'updated'}")
    return changes


def _strip_board_silkscreen(board: pcbnew.BOARD) -> None:
    """Remove generated silkscreen text/shapes cleanly using Delete() (never Remove())."""
    for d in list(board.GetDrawings()):
        if d.GetLayer() in _SILK_LAYER_TO_NAME and isinstance(
            d, (pcbnew.PCB_TEXT, pcbnew.PCB_SHAPE)
        ):
            board.Delete(d)
    for fp in list(board.GetFootprints()):
        for gi in list(fp.GraphicalItems()):
            if isinstance(gi, pcbnew.PCB_TEXT) and gi.GetLayer() in _SILK_LAYER_TO_NAME:
                fp.Delete(gi)


def _strip_board_fab_notes(board: pcbnew.BOARD) -> None:
    """Remove board-level B.Fab text notes cleanly using Delete() (never Remove())."""
    for d in list(board.GetDrawings()):
        if d.GetLayer() == pcbnew.B_Fab and isinstance(d, pcbnew.PCB_TEXT):
            board.Delete(d)


def _place_fixed_board_silk(board: pcbnew.BOARD, grid: SilkGrid, layout: dict) -> None:
    """Draw and reserve board-level silkscreen items defined in `silk_layout.json`."""
    for rect in layout.get("qr_rects", []):
        side, layer_id, _ = _parse_silk_layer(rect["layer"])
        gx0, gy0 = _g(rect["x0"], rect["y0"])
        gx1, gy1 = _g(rect["x1"], rect["y1"])
        add_silk_rect(
            board,
            layer_id,
            gx0,
            gy0,
            gx1,
            gy1,
            filled=bool(rect.get("filled", True)),
            width=float(rect.get("width", 0.15)),
        )
        grid.reserve(
            side,
            min(gx0, gx1) - 0.15,
            min(gy0, gy1) - 0.15,
            max(gx0, gx1) + 0.15,
            max(gy0, gy1) + 0.15,
        )

    for dot in layout.get("dots", []):
        side, layer_id, _ = _parse_silk_layer(dot["layer"])
        gx, gy = _g(dot["x"], dot["y"])
        r = float(dot.get("radius", 0.25))
        shp = pcbnew.PCB_SHAPE(board)
        shp.SetShape(pcbnew.SHAPE_T_CIRCLE)
        shp.SetLayer(layer_id)
        shp.SetCenter(pcbnew.VECTOR2I(pcbnew.FromMM(gx), pcbnew.FromMM(gy)))
        shp.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(gx + r), pcbnew.FromMM(gy)))
        shp.SetWidth(pcbnew.FromMM(float(dot.get("width", 0.15))))
        shp.SetFilled(bool(dot.get("filled", True)))
        board.Add(shp)
        grid.reserve(side, gx - r - 0.25, gy - r - 0.25, gx + r + 0.25, gy + r + 0.25)

    for seg in layout.get("segments", []):
        side, layer_id, _ = _parse_silk_layer(seg["layer"])
        gx0, gy0 = _g(seg["x0"], seg["y0"])
        gx1, gy1 = _g(seg["x1"], seg["y1"])
        add_silk_seg(
            board,
            layer_id,
            gx0,
            gy0,
            gx1,
            gy1,
            width=float(seg.get("width", 0.15)),
        )
        grid.reserve(
            side,
            min(gx0, gx1) - 0.15,
            min(gy0, gy1) - 0.15,
            max(gx0, gx1) + 0.15,
            max(gy0, gy1) + 0.15,
        )

    for item in layout.get("board_texts", []):
        side, layer_id, mirrored = _parse_silk_layer(item["layer"])
        gx, gy = _g(item["x"], item["y"])
        txt = add_silk_text(
            board,
            layer_id,
            item["text"],
            gx,
            gy,
            deg=float(item.get("deg", 0.0)),
            height=float(item.get("height", 0.80)),
            thickness=float(item.get("thickness", 0.15)),
            mirrored=mirrored,
        )
        grid.reserve(side, *_bbox_tuple(txt))


def _place_pinned_footprints(
    footprints: dict[str, pcbnew.FOOTPRINT],
    grid: SilkGrid,
    layout: dict,
) -> set[str]:
    """Place pinned footprint references/texts from `layout` and reserve in `grid`."""
    pinned_refs: set[str] = set()
    for ref, entry in layout.get("footprints", {}).items():
        if entry == "auto":
            continue
        fp = footprints.get(ref)
        if fp is None:
            print(f"WARNING: Skipping unknown ref {ref!r} in silk layout.")
            continue
        pinned_refs.add(ref)
        ref_cfg = entry.get("ref")
        if isinstance(ref_cfg, dict):
            side, layer_id, mirrored = _parse_silk_layer(ref_cfg["layer"])
            gx, gy = _g(ref_cfg["x"], ref_cfg["y"])
            _configure_ref_field(
                fp.Reference(),
                layer_id,
                gx,
                gy,
                float(ref_cfg.get("deg", 0.0)),
                float(ref_cfg.get("height", 0.80)),
                float(ref_cfg.get("thickness", 0.15)),
                mirrored,
            )
            grid.reserve(side, *_bbox_tuple(fp.Reference()))
        for txt_cfg in entry.get("texts", []):
            side, layer_id, mirrored = _parse_silk_layer(txt_cfg["layer"])
            gx, gy = _g(txt_cfg["x"], txt_cfg["y"])
            txt = add_silk_text(
                fp,
                layer_id,
                txt_cfg["text"],
                gx,
                gy,
                deg=float(txt_cfg.get("deg", 0.0)),
                height=float(txt_cfg.get("height", 0.80)),
                thickness=float(txt_cfg.get("thickness", 0.15)),
                mirrored=mirrored,
            )
            grid.reserve(side, *_bbox_tuple(txt))
    return pinned_refs


def _auto_place_component_silk(
    grid: SilkGrid,
    footprints: dict[str, pcbnew.FOOTPRINT],
    components: dict[str, dict],
    pinned_refs: set[str],
) -> int:
    """Auto-place remaining unpinned components around already-reserved items."""
    ordered_refs = sorted(
        (r for r in components if r not in pinned_refs and not is_fiducial_ref(r)),
        key=lambda r: (
            1 if r[0] in ("R", "C") and not r.startswith("RV") else 0,
            PLACEMENTS[r][1],
            PLACEMENTS[r][0],
            r,
        ),
    )

    failed_labels: list[str] = []
    for ref in ordered_refs:
        fp = footprints[ref]
        comp = components[ref]
        silk_prop = comp["fields"].get("Silkscreen", "").strip()
        val_str = SILK_VALUE_OVERRIDES.get(ref) or silk_prop or comp["value"]
        if ref.startswith(("R", "C")) and not ref.startswith("RV"):
            val_str = SILK_VALUE_OVERRIDES.get(
                ref, compact_passive_value(comp["value"])
            )

        is_tht = not any(p.GetAttribute() == pcbnew.PAD_ATTRIB_SMD for p in fp.Pads())
        max_ed = 5.5 if is_tht else 3.5
        res = place_ref_val_pair(
            grid,
            fp,
            val_str,
            gap=0.35,
            step=0.30,
            max_edge_distance=max_ed,
            val_only="auto",
        )
        if res is None:
            failed_labels.append(ref)

    if failed_labels:
        raise RuntimeError(
            "Silkscreen placement failed within local tether bounds for: "
            + ", ".join(failed_labels)
        )
    return len(ordered_refs)


def _apply_silkscreen_and_fab(
    board: pcbnew.BOARD,
    footprints: dict[str, pcbnew.FOOTPRINT],
    components: dict[str, dict],
    *,
    silk_layout: dict | None = None,
    add_fab_notes: bool = True,
) -> tuple[int, int]:
    """Apply QR placeholders, silkscreen labels, polarity graphics, and B.Fab notes."""
    for fp in footprints.values():
        fab_layer = pcbnew.B_Fab if fp.IsFlipped() else pcbnew.F_Fab
        fp.Reference().SetLayer(fab_layer)
        fp.Reference().SetVisible(False)
        fp.Value().SetLayer(fab_layer)
        fp.Value().SetVisible(False)

    grid = SilkGrid(
        board,
        footprints,
        board_bounds=(BOARD_X0, BOARD_Y0, BOARD_X1, BOARD_Y1),
        block_smd_fab=True,
    )

    # Block J_PWR shroud interior on B.SilkS so adjacent labels stay outside the header body
    jp_fab = _layer_bbox(footprints["J_PWR"], pcbnew.B_Fab)
    if jp_fab is not None:
        grid.keepout[1].append(
            (jp_fab[0] - 0.2, jp_fab[1] - 0.2, jp_fab[2] + 0.2, jp_fab[3] + 0.2)
        )

    def try_silk_text(
        side: int,
        layer_id: int,
        text: str,
        lx: float,
        ly: float,
        height: float = 0.80,
        deg: float = 0.0,
        parent: pcbnew.BOARD | pcbnew.FOOTPRINT = board,
    ) -> bool:
        tw, th = grid.measure_text(text, height, 0.15)
        rw, rh = (th, tw) if deg == 90.0 else (tw, th)
        gx, gy = _g(lx, ly)
        box = (gx - rw * 0.5, gy - rh * 0.5, gx + rw * 0.5, gy + rh * 0.5)
        if grid.box_ok(side, *box):
            add_silk_text(
                parent,
                layer_id,
                text,
                gx,
                gy,
                deg,
                height,
                0.15,
                mirrored=(side == 1),
            )
            grid.reserve(side, *box)
            return True
        return False

    if silk_layout is not None:
        _place_fixed_board_silk(board, grid, silk_layout)
        pinned_refs = _place_pinned_footprints(footprints, grid, silk_layout)
    else:
        # 1. Reserve & draw 5.0 x 5.0 mm JLCPCB QR placeholders first
        qr_rects = [
            (0, pcbnew.F_SilkS, 23.80, 1.00, 28.80, 6.00),
            (1, pcbnew.B_SilkS, 12.50, 65.00, 17.50, 70.00),
        ]
        for side, layer_id, lx0, ly0, lx1, ly1 in qr_rects:
            gx0, gy0 = _g(lx0, ly0)
            gx1, gy1 = _g(lx1, ly1)
            add_silk_rect(board, layer_id, gx0, gy0, gx1, gy1, filled=True, width=0.15)
            grid.reserve(side, gx0 - 0.15, gy0 - 0.15, gx1 + 0.15, gy1 + 0.15)

        # Reserve & draw IC Pin-1 dots on B.SilkS before text placement so labels avoid them
        for ic_ref in ("U1", "U2"):
            p1 = footprints[ic_ref].FindPadByNumber("1").GetPosition()
            p1x, p1y = pcbnew.ToMM(p1.x), pcbnew.ToMM(p1.y)
            dx = -1.45 if ic_ref == "U1" else 1.45
            dot_x, dot_y = p1x + dx, p1y
            add_silk_dot(board, pcbnew.B_SilkS, dot_x, dot_y, radius=0.25)
            grid.reserve(1, dot_x - 0.50, dot_y - 0.50, dot_x + 0.50, dot_y + 0.50)

        # Place C1/C2 +/- polarity signs before passive values so C1/C2 labels never displace them
        for lx, ly, sign in ((20.6, 26.8, "+"), (28.9, 35.0, "+"), (20.6, 35.0, "-")):
            try_silk_text(1, pcbnew.B_SilkS, sign, lx, ly)
        pinned_refs = set()

    # 2. Auto-place remaining unpinned component labels
    auto_count = _auto_place_component_silk(grid, footprints, components, pinned_refs)

    if silk_layout is None:
        # 3. Polarity cues & secondary-side cues (checked against SilkGrid so 0 collisions)
        for rv_ref in ("RV1", "RV2", "RV3", "RV4"):
            p1 = footprints[rv_ref].FindPadByNumber("1").GetPosition()
            try_silk_text(
                0,
                pcbnew.F_SilkS,
                "1",
                pcbnew.ToMM(p1.x) - BOARD_X0 - 1.5,
                pcbnew.ToMM(p1.y) - BOARD_Y0,
                parent=footprints[rv_ref],
            )

        led_p1 = footprints["LED1"].FindPadByNumber("1").GetPosition()
        led_p2 = footprints["LED1"].FindPadByNumber("2").GetPosition()
        try_silk_text(
            0,
            pcbnew.F_SilkS,
            "+",
            pcbnew.ToMM(led_p1.x) - BOARD_X0,
            pcbnew.ToMM(led_p1.y) - BOARD_Y0 + 2.2,
            parent=footprints["LED1"],
        )
        try_silk_text(
            0,
            pcbnew.F_SilkS,
            "-",
            pcbnew.ToMM(led_p2.x) - BOARD_X0,
            pcbnew.ToMM(led_p2.y) - BOARD_Y0 + 2.2,
            parent=footprints["LED1"],
        )

        # J_PWR -12V RED stripe marker and polarity callouts on B.SilkS (outside J_PWR outline)
        for text, candidates in (
            (
                "-12V RED",
                (
                    (17.9, 22.0, 0.0),
                    (17.6, 20.8, 90.0),
                    (24.5, 24.0, 0.0),
                    (18.2, 21.0, 0.0),
                ),
            ),
            ("+12V", ((17.5, 7.8, 0.0), (17.5, 9.0, 0.0), (24.5, 1.8, 0.0))),
        ):
            for lx, ly, deg in candidates:
                if try_silk_text(1, pcbnew.B_SilkS, text, lx, ly, deg=deg):
                    break

        # Board title & revision on F.SilkS in open corridor between RV4 and LED1/SWs
        for text, candidates, h in (
            ("ENV FOLLOWER", ((15.0, 66.0), (15.0, 76.2), (15.0, 18.8)), 0.90),
            ("6HP REV 1.0", ((15.0, 68.0), (15.0, 77.6), (15.0, 34.2)), 0.80),
        ):
            for lx, ly in candidates:
                if try_silk_text(0, pcbnew.F_SilkS, text, lx, ly, height=h):
                    break

    if add_fab_notes:
        add_standard_fab_notes(board, BOARD_X0 + 15.0, BOARD_Y1 + 5.0)

    return len(pinned_refs), auto_count


# ---------------------------------------------------------------------------
# CLI Command Handlers
# ---------------------------------------------------------------------------
def _cmd_sync_silk(layout_path: pathlib.Path) -> int:
    """Extract current silkscreen positions from `envelope_follower.kicad_pcb` into JSON."""
    if not PCB_PATH.exists():
        print(f"ERROR: Missing PCB file: {PCB_PATH}")
        return 1
    board = pcbnew.LoadBoard(str(PCB_PATH))
    new_layout = extract_silk_layout(board)
    old_layout = _load_silk_layout(layout_path) if layout_path.exists() else None
    changes = _summarize_silk_diff(old_layout, new_layout)
    layout_path.write_text(_format_silk_layout_json(new_layout), encoding="utf-8")

    print(f"Synced silkscreen from {PCB_PATH.name} -> {layout_path}")
    if changes:
        for line in changes:
            print(f"  - {line}")
    else:
        print("  - No changes.")
    inspect_board_silk(PCB_PATH)
    return 0


def _cmd_silk_only(layout_path: pathlib.Path) -> int:
    """Restamp silkscreen directly onto existing `envelope_follower.kicad_pcb` (~1 s)."""
    if not PCB_PATH.exists():
        print(f"ERROR: Missing PCB file: {PCB_PATH}")
        return 1
    if not layout_path.exists():
        print(f"ERROR: Missing silk layout file: {layout_path}")
        return 1

    components, _ = parse_netlist(NET_PATH, dnp_prefixes=("TP",))
    layout = _load_silk_layout(layout_path)
    board = pcbnew.LoadBoard(str(PCB_PATH))
    footprints = {fp.GetReference(): fp for fp in board.GetFootprints()}

    _strip_board_silkscreen(board)
    _strip_board_fab_notes(board)
    pinned, auto = _apply_silkscreen_and_fab(
        board,
        footprints,
        components,
        silk_layout=layout,
        add_fab_notes=True,
    )
    board.Save(str(PCB_PATH))
    print(
        f"Updated silkscreen in {PCB_PATH.name}: {pinned} pinned, {auto} auto-placed."
    )
    inspect_board_silk(PCB_PATH)
    return 0


def _collect_all_silk_boxes(
    board: pcbnew.BOARD,
) -> list[tuple[str, int, tuple[float, float, float, float]]]:
    """Collect (label_name, side_idx, global_bbox) for all visible F.SilkS/B.SilkS text items."""
    items: list[tuple[str, int, tuple[float, float, float, float]]] = []
    for d in board.GetDrawings():
        layer_id = d.GetLayer()
        if (
            layer_id in _SILK_LAYER_TO_NAME
            and isinstance(d, pcbnew.PCB_TEXT)
            and d.IsVisible()
        ):
            side = 0 if layer_id == pcbnew.F_SilkS else 1
            items.append((f"BOARD:{d.GetText()}", side, _bbox_tuple(d)))

    for fp in board.GetFootprints():
        ref = fp.GetReference()
        rf = fp.Reference()
        if rf.IsVisible() and rf.GetLayer() in _SILK_LAYER_TO_NAME:
            side = 0 if rf.GetLayer() == pcbnew.F_SilkS else 1
            items.append((f"{ref}:REF", side, _bbox_tuple(rf)))
        for gi in fp.GraphicalItems():
            if (
                isinstance(gi, pcbnew.PCB_TEXT)
                and gi.IsVisible()
                and gi.GetLayer() in _SILK_LAYER_TO_NAME
            ):
                side = 0 if gi.GetLayer() == pcbnew.F_SilkS else 1
                items.append((f"{ref}:{gi.GetText()}", side, _bbox_tuple(gi)))
    return items


def _print_all_silk_overview(board: pcbnew.BOARD, layout: dict) -> None:
    """Print compact summary of all board and component silkscreen entries."""
    print(
        f"Silkscreen overview for {PCB_PATH.name} "
        f"(board-local mm relative to ({BOARD_X0}, {BOARD_Y0})):"
    )
    for key in ("qr_rects", "dots", "segments", "board_texts"):
        items = layout.get(key, [])
        if items:
            print(f"  {key} ({len(items)}):")
            for item in items:
                print(f"    {json.dumps(item, ensure_ascii=False)}")

    fps_by_ref = {fp.GetReference(): fp for fp in board.GetFootprints()}
    for side_label, want_flipped in (("F.Cu", False), ("B.Cu", True)):
        group_refs = [
            ref
            for ref in sorted(layout.get("footprints", {}), key=_ref_sort_key)
            if ref in fps_by_ref and fps_by_ref[ref].IsFlipped() == want_flipped
        ]
        print(f"\n  Footprints on {side_label} ({len(group_refs)}):")
        for ref in group_refs:
            fp = fps_by_ref[ref]
            pos = fp.GetPosition()
            px, py = _round_mm(pos.x, BOARD_X0), _round_mm(pos.y, BOARD_Y0)
            entry = layout["footprints"][ref]
            ref_d = entry.get("ref")
            ref_s = (
                f"({ref_d['x']:6.2f},{ref_d['y']:6.2f},{ref_d['deg']:3.0f}°)"
                if ref_d
                else "(hidden)          "
            )
            txt_s = ", ".join(
                f"{t['text']}@({t['x']:.2f},{t['y']:.2f},{t['deg']:.0f}°)"
                for t in entry.get("texts", [])
            )
            print(f"    {ref:<6} part=({px:5.2f},{py:5.2f})  REF={ref_s}  TXT={txt_s}")


def _print_ref_neighborhood(
    board: pcbnew.BOARD,
    fp: pcbnew.FOOTPRINT,
    all_silk: list[tuple[str, int, tuple[float, float, float, float]]],
) -> None:
    """Print detailed silkscreen coordinates and <= 5.0 mm neighbors for `fp`."""
    ref = fp.GetReference()
    pos = fp.GetPosition()
    lx, ly = _round_mm(pos.x, BOARD_X0), _round_mm(pos.y, BOARD_Y0)
    rot = _norm_angle(float(fp.GetOrientationDegrees()))
    side_str = "B.Cu" if fp.IsFlipped() else "F.Cu"
    fp_box = footprint_bbox(fp)
    lbox = _to_local_box(fp_box)
    print(
        f"{ref} ({side_str}) origin=({lx:.2f}, {ly:.2f}) rot={rot:.1f}° "
        f"bbox=({lbox[0]:.2f}..{lbox[2]:.2f}, {lbox[1]:.2f}..{lbox[3]:.2f})"
    )

    label_sides: set[int] = {1 if fp.IsFlipped() else 0}
    rf = fp.Reference()
    if rf.IsVisible() and rf.GetLayer() in _SILK_LAYER_TO_NAME:
        rd = _text_item_to_dict(rf, include_text=False)
        rbox = _to_local_box(_bbox_tuple(rf))
        label_sides.add(0 if rf.GetLayer() == pcbnew.F_SilkS else 1)
        print(
            f"  REF  {rd['layer']:<7} ({rd['x']:.3f}, {rd['y']:.3f}) "
            f"deg={rd['deg']:.1f} h={rd['height']:.2f} "
            f"bbox=({rbox[0]:.2f}..{rbox[2]:.2f}, {rbox[1]:.2f}..{rbox[3]:.2f})"
        )
    else:
        print("  REF  (hidden on .Fab)")

    texts_found = [
        gi
        for gi in fp.GraphicalItems()
        if isinstance(gi, pcbnew.PCB_TEXT)
        and gi.IsVisible()
        and gi.GetLayer() in _SILK_LAYER_TO_NAME
    ]
    for gi in texts_found:
        td = _text_item_to_dict(gi, include_text=True)
        tbox = _to_local_box(_bbox_tuple(gi))
        label_sides.add(0 if gi.GetLayer() == pcbnew.F_SilkS else 1)
        print(
            f"  TEXT {td['layer']:<7} {td['text']!r:<12} ({td['x']:.3f}, {td['y']:.3f}) "
            f"deg={td['deg']:.1f} h={td['height']:.2f} "
            f"bbox=({tbox[0]:.2f}..{tbox[2]:.2f}, {tbox[1]:.2f}..{tbox[3]:.2f})"
        )

    nearby_fps: list[tuple[float, str, str, tuple[float, float, float, float]]] = []
    for other in board.GetFootprints():
        oref = other.GetReference()
        if oref == ref or is_fiducial_ref(oref):
            continue
        obox = footprint_bbox(other)
        dist = box_edge_distance(fp_box, obox)
        if dist <= 5.0:
            oside = "B.Cu" if other.IsFlipped() else "F.Cu"
            nearby_fps.append((dist, oref, oside, _to_local_box(obox)))
    nearby_fps.sort(key=lambda x: (x[0], _ref_sort_key(x[1])))
    if nearby_fps:
        print("  Nearby footprints (<= 5.0 mm):")
        for dist, oref, oside, olbox in nearby_fps:
            print(
                f"    {oref:<6} ({oside}) d={dist:.2f} mm  "
                f"bbox=({olbox[0]:.2f}..{olbox[2]:.2f}, {olbox[1]:.2f}..{olbox[3]:.2f})"
            )

    nearby_labels: list[tuple[float, str, str, tuple[float, float, float, float]]] = []
    for lname, lside, lbox_g in all_silk:
        if lside not in label_sides or lname.startswith(f"{ref}:"):
            continue
        dist = box_edge_distance(fp_box, lbox_g)
        if dist <= 5.0:
            sname = "F.SilkS" if lside == 0 else "B.SilkS"
            nearby_labels.append((dist, lname, sname, _to_local_box(lbox_g)))
    nearby_labels.sort(key=lambda x: (x[0], x[1]))
    if nearby_labels:
        print("  Nearby silkscreen labels (<= 5.0 mm):")
        for dist, lname, sname, llbox in nearby_labels:
            print(
                f"    {lname:<16} ({sname}) d={dist:.2f} mm  "
                f"bbox=({llbox[0]:.2f}..{llbox[2]:.2f}, {llbox[1]:.2f}..{llbox[3]:.2f})"
            )


def _cmd_show_silk(refs: list[str]) -> int:
    """Print board-local silkscreen coordinates and optional component neighborhoods."""
    if not PCB_PATH.exists():
        print(f"ERROR: Missing PCB file: {PCB_PATH}")
        return 1
    board = pcbnew.LoadBoard(str(PCB_PATH))
    if not refs:
        _print_all_silk_overview(board, extract_silk_layout(board))
        return 0

    by_upper = {fp.GetReference().upper(): fp for fp in board.GetFootprints()}
    all_silk = _collect_all_silk_boxes(board)
    rc = 0
    for idx, req in enumerate(refs):
        fp = by_upper.get(req.strip().upper())
        if fp is None:
            print(f"ERROR: Unknown footprint reference {req!r}")
            rc = 1
            continue
        if idx > 0:
            print()
        _print_ref_neighborhood(board, fp, all_silk)
    return rc


def _cmd_check_silk() -> int:
    """Run strict silkscreen inspection and return exit code 0 on pass, 1 on fail."""
    if not PCB_PATH.exists():
        print(f"ERROR: Missing PCB file: {PCB_PATH}")
        return 1
    return 0 if inspect_board_silk(PCB_PATH) else 1


def _build_full_pcb(layout_path: pathlib.Path, *, auto_silk: bool) -> int:
    """Generate `envelope_follower.kicad_pcb` end-to-end."""
    silk_layout: dict | None = None
    if not auto_silk and layout_path.exists():
        silk_layout = _load_silk_layout(layout_path)

    components, nets = parse_netlist(NET_PATH, dnp_prefixes=("TP",))
    sch_uuids = parse_schematic_unit1_uuids(SCH_PATH)

    board = create_base_board(
        PCB_PATH,
        BOARD_X0,
        BOARD_Y0,
        BOARD_X1,
        BOARD_Y1,
        title="ENVELOPE FOLLOWER + SKEW LIMITER",
        revision="Rev 1.0",
        date="2026-11",
        track_width=TRACK_WIDTH,
        clearance=CLEARANCE,
        via_diam=VIA_DIAM,
        via_drill=VIA_DRILL,
        edge_clearance=EDGE_CLEARANCE,
    )
    ds = board.GetDesignSettings()
    ds.SetGridOrigin(pcbnew.VECTOR2I(pcbnew.FromMM(BOARD_X0), pcbnew.FromMM(BOARD_Y0)))
    ds.SetAuxOrigin(pcbnew.VECTOR2I(pcbnew.FromMM(BOARD_X0), pcbnew.FromMM(BOARD_Y0)))

    footprints = add_board_footprints(board, components, sch_uuids)
    verify_placements(footprints)
    net_items, _ = assign_nets(board, footprints, nets)

    router = _init_router(board, footprints, net_items)
    gnd_vias = _place_smd_gnd_vias(board, router, footprints, net_items["GND"])
    ic_anchors = _pre_route_ic_escapes(board, router, footprints, net_items)
    _route_all_nets(board, router, footprints, net_items, nets, ic_anchors)
    stitch_vias = _sprinkle_gnd_stitching_vias(
        board, router, net_items["GND"], gnd_vias
    )

    pour_gnd_zones(
        board,
        net_items["GND"],
        BOARD_X0,
        BOARD_Y0,
        BOARD_X1,
        BOARD_Y1,
        edge_clearance=EDGE_CLEARANCE,
        clearance=CLEARANCE,
    )
    stitch_kept = _prune_disconnected_stitching_vias(board, stitch_vias)
    pinned, auto = _apply_silkscreen_and_fab(
        board,
        footprints,
        components,
        silk_layout=silk_layout,
        add_fab_notes=True,
    )

    board.Save(str(PCB_PATH))
    silk_desc = (
        f"silk={pinned} pinned/{auto} auto"
        if silk_layout is not None
        else f"silk=0 pinned/{auto} auto"
    )
    print(
        f"Generated {PCB_PATH.name}: {len(footprints)} footprints "
        f"({len(components)} netlist + {len(FIDUCIAL_PLACEMENTS)} fiducials), "
        f"{len(nets)} nets, {len(gnd_vias)} SMD GND vias + {stitch_kept} stitching vias "
        f"({silk_desc})."
    )
    return 0


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments for full PCB generation or silkscreen workflows."""
    parser = argparse.ArgumentParser(
        description=(
            "Generate envelope_follower.kicad_pcb and iterate on silk_layout.json."
        )
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--silk-only",
        action="store_true",
        help="Apply --silk-layout onto existing envelope_follower.kicad_pcb (~1 s).",
    )
    mode.add_argument(
        "--sync-silk",
        action="store_true",
        help="Extract silkscreen positions from envelope_follower.kicad_pcb into JSON.",
    )
    mode.add_argument(
        "--check-silk",
        action="store_true",
        help="Run strict silkscreen collision/keepout/tether inspection.",
    )
    mode.add_argument(
        "--show-silk",
        nargs="*",
        metavar="REF",
        default=None,
        help="Show all silkscreen items, or local details/neighbors for REF...",
    )
    mode.add_argument(
        "--auto-silk",
        action="store_true",
        help="Run full PCB generation ignoring silk_layout.json.",
    )
    parser.add_argument(
        "--silk-layout",
        type=pathlib.Path,
        default=SILK_LAYOUT_PATH,
        help=f"Path to silkscreen layout JSON (default: {SILK_LAYOUT_PATH.name}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """CLI entrypoint."""
    args = parse_args(argv)
    if args.sync_silk:
        rc = _cmd_sync_silk(args.silk_layout)
    elif args.silk_only:
        rc = _cmd_silk_only(args.silk_layout)
    elif args.check_silk:
        rc = _cmd_check_silk()
    elif args.show_silk is not None:
        rc = _cmd_show_silk(args.show_silk)
    else:
        rc = _build_full_pcb(args.silk_layout, auto_silk=args.auto_silk)
    if rc != 0:
        sys.exit(rc)


if __name__ == "__main__":
    main()
