# Main Board Ordering Checklist (JLCPCB PCB + Bottom-Side PCBA)

Use this checklist before and during your JLCPCB order for [`../envelope_follower.kicad_pcb`](../envelope_follower.kicad_pcb) (`30.0 × 108.0 mm`, 6 HP Eurorack, 2-layer FR4).

---

## 1. Pre-Order Export & Sanity Checks

- [ ] **Run KiCad DRC cleanly** (confirm `0` errors, `0` warnings, `0` unconnected items, and `0` schematic parity issues):
  ```bash
  kicad-cli pcb drc --severity-all --refill-zones --format json --output /tmp/drc.json envelope_follower.kicad_pcb
  ```
- [ ] **Verify [`../jlcpcb_bom.csv`](../jlcpcb_bom.csv)** matches the finalized `50`-part SMD build:
  - Exactly `17` component rows (`50` SMD components total on `B.Cu`).
  - Exactly `3` JLCPCB Extended SKUs (`C2878713` `TL074HIDR`, `C83935` `BAT54S`, `C95204` `10k 0.1%`).
  - `0` THT parts (`C1`, `C2`, `C7`, `C11`–`C13`, `J_PWR`, `RV1`–`RV4`, `SW1`–`SW2`, `LED1`, `J1`–`J4`) and `0` DNP test points (`TP1`–`TP12`) or fiducials (`FID1`–`FID3`).
- [ ] **Export Gerber and Excellon drill files** (using the board's drill/aux origin `(100.00, 40.00) mm`):
  ```bash
  mkdir -p manufacturing/gerbers
  kicad-cli pcb export gerbers --output manufacturing/gerbers \
    --layers F.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts \
    --subtract-soldermask --use-drill-file-origin --check-zones \
    envelope_follower.kicad_pcb
  kicad-cli pcb export drill --output manufacturing/gerbers \
    --format excellon --drill-origin plot --excellon-units mm --generate-map \
    envelope_follower.kicad_pcb
  (cd manufacturing/gerbers && zip -r ../envelope_follower_gerbers.zip .)
  ```
- [ ] **Export & translate the Bottom-Side CPL (Pick-and-Place) file** with BOM parity filtering:
  ```bash
  kicad-cli pcb export pos --format csv --units mm --side back --smd-only --exclude-dnp \
    --use-drill-file-origin --output manufacturing/raw_cpl.csv envelope_follower.kicad_pcb
  .venv/bin/python .agents/skills/bom/scripts/translate_bom_pnp.py pnp \
    manufacturing/raw_cpl.csv -o manufacturing/jlcpcb_cpl.csv \
    --units mm --bom jlcpcb_bom.csv
  ```
- [ ] **Confirm translator output** reports:
  - `rows_out: 50` and `bom_designators: 50`
  - `filtered_orphans: 0` (zero stray `TP*`, `FID*`, or THT entries)
  - Every row in `manufacturing/jlcpcb_cpl.csv` has `Layer = B`
- [ ] **Inspect Gerbers visually** in KiCad Gerber Viewer / JLCPCB Gerber Viewer before configuring options:
  - Board outline measures `30.0 × 108.0 mm` (`Edge.Cuts`).
  - Solid `5.0 × 5.0 mm` white silkscreen square is present in the **top-right corner of Top Silkscreen (`F.SilkS`)** at board-local `X = 23.8–28.8 mm, Y = 1.0–6.0 mm`.
  - No duplicate `5.0 × 5.0 mm` QR placeholder square exists on `B.SilkS`.
  - `3` exposed copper fiducials (`FID1`, `FID2`, `FID3`) appear on `B.Cu` / `B.Mask` (`1.0 mm` copper pad, `2.0 mm` mask opening).
  - Top/bottom copper zones and silkscreen text render cleanly with no clipped labels.

---

## 2. JLCPCB PCB Fabrication Options

Upload `manufacturing/envelope_follower_gerbers.zip` at JLCPCB and configure:

- [ ] **Base Material:** `FR-4`
- [ ] **Layers:** `2`
- [ ] **Dimensions:** `30.0 mm × 108.0 mm` (verify auto-detected dimensions match)
- [ ] **PCB Qty:** `5` (minimum) or desired build quantity
- [ ] **Delivery Format:** `Single PCB` *(board includes 3 single-board `B.Cu` fiducials; or choose `Panel by JLCPCB` if ordering larger batches)*
- [ ] **PCB Thickness:** `1.6 mm`
- [ ] **Outer Copper Weight:** `1 oz`
- [ ] **PCB Color (Solder Mask):** `Black` (standard glossy Black — note: Matte Black can force Standard PCBA pricing/lead time; verify Economic PCBA remains available before checkout)
- [ ] **Silkscreen Color:** `White`
- [ ] **Surface Finish — LEAD-FREE:** Select **`LeadFree HASL (RoHS)`** or **`ENIG-RoHS`** *(do **NOT** leave on default leaded HASL)*
- [ ] **Via Covering:** **`Tented`** *(critical: a GND stitching via sits at board-local `(27.0, 4.0) mm` underneath the `F.SilkS` QR placeholder square, and all vias near SMDs are tented)*
- [ ] **Mark on PCB / Order Number — REPLACE WITH QR CODE:**
  - Select **`Specify a location` / `Replace with 2D Barcode (QR Code)`** (exact JLCPCB label varies slightly) so JLCPCB replaces the **`5.0 × 5.0 mm` solid silkscreen square on Top Silkscreen (`F.SilkS`, top-right corner)** with the order tracking QR code — or select **`Remove Order Number`** if you do not want a JLCPCB order mark at all.
  - Do **NOT** leave default automatic order-number placement active, or JLCPCB may stamp text over dense `B.SilkS` labels or `F.SilkS` panel markings.
  - Add a **PCB Remark** if prompted:
    > `Please replace the 5x5mm solid silkscreen square on Top Silkscreen (F.SilkS, top-right corner) with the JLCPCB order QR code.`
- [ ] **Flying Probe Test:** `Fully Test`

---

## 3. JLCPCB PCBA (Assembly) Options

- [ ] **Enable `PCB Assembly`:** Toggle **ON**
- [ ] **PCBA Type:** **`Economic`** *(all 50 assembled parts are single-sided SMD; no through-hole assembly)*
- [ ] **Assembly Side:** **`Bottom Side`** *(`B.Cu` only — `0` SMD parts on `F.Cu`)*
- [ ] **PCBA Qty:** Select desired assembled count (e.g., `2` or `5` boards out of the `5` PCBs)
- [ ] **Solder Paste / RoHS Process — LEAD-FREE:** Confirm **`Lead-Free Solder Paste (RoHS / SAC305)`** is selected to match the LeadFree HASL / ENIG PCB finish *(do NOT mix leaded paste if building lead-free)*
- [ ] **Tooling Holes:** `Added by JLCPCB` (standard)
- [ ] **Confirm Parts Placement:** **`Yes`** *(strongly recommended so JLCPCB engineering reviews and confirms rotation/polarity before reflow)*
- [ ] **Bake Components / Special Packaging:** Standard options unless shipping to humid storage

---

## 4. BOM & CPL Upload + Part Matching

- [ ] **Upload BOM:** `jlcpcb_bom.csv` (`17` grouped rows)
- [ ] **Upload CPL:** `manufacturing/jlcpcb_cpl.csv` (`50` placements, all `Layer = B`)
- [ ] **Verify `17 / 17` BOM rows matched (`50 / 50` components)** with zero unmatched or unpopulated rows
- [ ] **Verify stock availability** for all `17` LCSC SKUs before proceeding
- [ ] **Confirm Extended part count = `3` SKUs only** (`$3` feeder fee per SKU = `$9` total feeder fees, subject to JLCPCB promos):
  - [ ] `C2878713` — `TL074HIDR` (SOIC-14, Qty `2`: `U1, U2`)
  - [ ] `C83935` — `BAT54S` (SOT-23, Qty `1`: `D3`) — *check `Pin 1=A1, Pin 2=K2, Pin 3=K1/A2`; backup alt `C181201` if OOS, verify datasheet pinout before substituting!*
  - [ ] `C95204` — `10k 0.1%` `RT0603BRD0710KL` (0603, Qty `14`: `R4, R6–R14, R17–R18, R30–R31`)
- [ ] **Confirm remaining `14` rows (`33` components) are `Basic` parts** (`$0` feeder fee):
  - `C14663` (`100nF`), `C1663` (`33pF`), `C13585` (`10uF`), `C28260` (`2.2nF`), `C5378` (`220nF`), `C8598` (`B5819W`), `C81598` (`1N4148W`), `C22859` (`10R`), `C22935` (`1M`), `C21190` (`1k`), `C23184` (`49.9k`), `C25803` (`100k`), `C23186` (`5.1k`), `C4190` (`2.2k`)
- [ ] **Confirm `D4` & `D5` are silicon `1N4148W` (`C81598`)** — **NEVER substitute a Schottky diode** for `D4`/`D5` (high reverse leakage corrupts `SLOW` envelope hold times)
- [ ] **Complete the Part Alignment Check:** Run through every item in [`02-pcba-part-alignment.md`](02-pcba-part-alignment.md) inside JLCPCB's interactive placement viewer before saving to cart

---

## 5. Checkout & Record Keeping

- [ ] **Review itemized quote** before paying:
  - Bare PCB fabrication (`2L`, `1.6 mm`, Black/White, LeadFree HASL or ENIG, `F.SilkS` QR code replacement)
  - Economic Bottom-Side PCBA setup + SMT joint fee (`50` parts × qty)
  - `3` Extended part feeder fees (`TL074HIDR`, `BAT54S`, `10k 0.1%`)
  - Lead-free solder paste + `Confirm Parts Placement` option
  - Component costs + shipping
- [ ] **Archive manufacturing artifacts** alongside the JLCPCB order number:
  - `manufacturing/envelope_follower_gerbers.zip`
  - `jlcpcb_bom.csv` & `manufacturing/jlcpcb_cpl.csv`
  - Screenshots of the approved JLCPCB 2D/3D Bottom Placement Viewer
- [ ] **Monitor JLCPCB DFM / Placement Confirmation email** after ordering and approve the engineer-verified placement preview once checked against [`02-pcba-part-alignment.md`](02-pcba-part-alignment.md)
