# Front Panel Ordering Checklist (JLCPCB Bare PCB — Matte Black + ENIG)

Use this checklist before and during your JLCPCB bare-PCB order for [`../envelope_follower_panel.kicad_pcb`](../envelope_follower_panel.kicad_pcb) (`30.0 × 128.5 mm`, 6 HP × 3U Eurorack front panel, 2-layer FR4).

---

## 1. Pre-Order Export & Sanity Checks

- [x] **Run KiCad DRC cleanly** (`0` errors, `0` non-library violations, `0` unconnected items; `13` `lib_footprint_issues` warnings are expected for the embedded `Eurorack_Panel` cutout footprints):
  ```bash
  kicad-cli pcb drc --severity-all --refill-zones --format json --output /tmp/panel_drc.json envelope_follower_panel.kicad_pcb
  ```
- [x] **Verify front artwork & clearance rules** via [`../panel_art/generate_panel_art.py`](../panel_art/generate_panel_art.py) (`40 px/mm` audit: `0` `F.SilkS`/`F.Mask` overlap, `>= 0.60 mm` separation, `0` edge/nut/washer/NPTH violations) and [`../panel_art/import_svgs_to_kicad.py`](../panel_art/import_svgs_to_kicad.py) (`104` `F.SilkS` polygons, `33` `F.Mask` polygons, `5` preserved `B.SilkS` markings).
- [x] **Export Gerber and separated PTH/NPTH Excellon drill files** (using panel drill/aux origin `(100.00, 29.75) mm` and routed NPTH oval slots):
  ```bash
  mkdir -p manufacturing/panel_gerbers
  kicad-cli pcb export gerbers --output manufacturing/panel_gerbers/ \
    --layers F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts \
    --subtract-soldermask --use-drill-file-origin --check-zones \
    envelope_follower_panel.kicad_pcb
  kicad-cli pcb export drill --output manufacturing/panel_gerbers/ \
    --format excellon --drill-origin plot --excellon-units mm \
    --excellon-separate-th --excellon-oval-format route \
    --generate-map --map-format gerberx2 \
    envelope_follower_panel.kicad_pcb
  (cd manufacturing/panel_gerbers && zip -r ../envelope_follower_panel_gerbers.zip .)
  ```
- [x] **Confirm drill & Gerber completeness** (`complete: true`, `0` analyzer findings):
  - `envelope_follower_panel-PTH.drl`: `10` grounded plated holes (`4× 7.2 mm` pots, `2× 5.2 mm` sub-mini toggles, `4× 6.2 mm` jacks).
  - `envelope_follower_panel-NPTH.drl`: `2` routed `5.50 × 3.20 mm` M3 oval mounting slots (`H1`, `H2`) + `1× 3.2 mm` `LED1` NPTH hole.
- [ ] **Inspect Gerbers visually** in KiCad Gerber Viewer / JLCPCB Gerber Viewer before checkout:
  - Board outline measures `30.0 × 128.5 mm` (`Edge.Cuts`) with `2` routed M3 oval slots (`H1` top, `H2` bottom).
  - Front Silkscreen (`F.SilkS`, `104` polygons): `GAIN`, `ATK`, `REL`, `OFFSET`, `300°` dial ticks, `−`/`+`, `SMOOTH`/`RAW`, `+ / −`, `SLOW`/`FAST`, `IN`, `SLEW IN`, inverted knockout `OUT` / `INV OUT` pills (`O` inner islands intact), and `DM // R1.0` render cleanly with zero clipped edges.
  - Front Solder Mask (`F.Mask`, `33` ENIG gold openings over `F.Cu` pour): top-right angular envelope + `6` kick bars (last `3` equal height), chamfered `ENV / SKEW` knockout slab, segmented side rails, right-flank motifs (`GAIN` bars, `ATK`, `REL`, `OFFSET` `[+]`/`[−]` mirrored chamfers), `GAIN` `+150°` wedge, `OFFSET` `12 o'clock` chevron, octagonal `LED1` bezel, patchbay bus bar, `J1 → J2` arrow, chamfered Output Bay frame, and bottom-right badge — with tented mask over all `10` PTH cutouts.
  - Back Solder Mask & Silkscreen (`B.Mask` / `B.SilkS`): `10` annular grounding rings (`B.Mask`), mirrored title/version + vertical GitHub URL, and `5.0 × 5.0 mm` solid white square at bottom-left (`B.SilkS`) clear of all pads and holes.

---

## 2. JLCPCB Bare Panel Fabrication Options

Upload [`../manufacturing/envelope_follower_panel_gerbers.zip`](../manufacturing/envelope_follower_panel_gerbers.zip) to the **same JLCPCB cart** as the main PCB and configure:

- [ ] **Base Material:** `FR-4`
- [ ] **Layers:** `2`
- [ ] **Dimensions:** `30.0 mm × 128.5 mm` *(verify auto-detected dimensions and routed M3 oval slots in preview)*
- [ ] **PCB Qty:** `5` (minimum) or matching main-board qty
- [ ] **Delivery Format:** `Single PCB`
- [ ] **PCB Thickness:** `1.6 mm`
- [ ] **Outer Copper Weight:** `1 oz`
- [ ] **PCB Color (Solder Mask):** **`Matte Black`** *(bare PCB order has no Economic PCBA restriction — Matte Black pairs best with the brutalist ENIG artwork)*
- [ ] **Silkscreen Color:** **`White`**
- [ ] **Surface Finish — ENIG:** Select **`ENIG-RoHS`** *(required so all `33` `F.Mask` openings gleam in flat, tarnish-free gold over `F.Cu`)*
- [ ] **Via Covering:** `Tented` *(standard; board has no vias)*
- [ ] **Mark on PCB / Order Number — BOTTOM SILKSCREEN ONLY:**
  - Select **`Specify a location` / `Replace with 2D Barcode (QR Code)`** on **Bottom Silkscreen (`B.SilkS`, bottom-left `5×5 mm` square)** — OR select **`Remove Order Number`** so JLCPCB never prints an order string onto the front face.
  - Add a **PCB Remark** if prompted:
    > `Eurorack front panel: Matte Black + ENIG gold F.Mask artwork. Please place/replace the order QR ONLY at the 5x5mm square on Bottom Silkscreen (B.SilkS) — DO NOT stamp any order number on Front Silkscreen (F.SilkS).`
- [ ] **PCB Assembly:** **OFF** *(bare panel PCB only)*
- [ ] **Flying Probe Test:** `Fully Test`

---

## 3. Checkout & Combined Shipping

- [ ] **Combine in one JLCPCB cart** with [`../manufacturing/envelope_follower_gerbers.zip`](../manufacturing/envelope_follower_gerbers.zip) ([`01-main-board-ordering.md`](01-main-board-ordering.md)) to share shipping.
- [ ] **Review itemized bare-panel quote** before paying (`30.0 × 128.5 mm` exceeds the `100 × 100 mm` discount tier, plus `Matte Black` and `ENIG-RoHS` finish surcharges).
- [ ] **Archive [`../manufacturing/envelope_follower_panel_gerbers.zip`](../manufacturing/envelope_follower_panel_gerbers.zip)** alongside the JLCPCB order number.
