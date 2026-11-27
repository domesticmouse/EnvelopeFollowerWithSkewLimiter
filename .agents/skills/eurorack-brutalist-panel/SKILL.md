---
name: eurorack-brutalist-panel
description: >-
  Design, generate, audit, and KiCad-integrate Matte Black + ENIG Gold + White
  Silkscreen (Dark Techno / Brutalist) 3U Eurorack front panels from
  panel_svg_spec.md. Use when creating custom VectorCraft F.SilkS and F.Mask
  faceplate artwork, running 40 px/mm clearance verification, importing panel
  SVGs into a blank KiCad 10 .kicad_pcb, or exporting JLCPCB bare-panel Gerbers.
---

# Eurorack Brutalist Front Panel (`eurorack-brutalist-panel`)

End-to-end workflow for turning a mechanical `panel_svg_spec.md` into fabrication-ready **Matte Black + ENIG Gold (`F.Mask`) + White Silkscreen (`F.SilkS`)** Eurorack panel SVGs via `vectorcraft-cli`, integrating them into a mated KiCad 10 `.kicad_pcb`, and packaging JLCPCB bare-panel Gerbers.

Consult [Design System Reference](./references/design-system.md) for palette hex codes, verified font ratios, brutalist symmetry conventions, and fabrication clearance limits.

---

## Phase 1 — Brief & Geometry Budget

1. Read `panel_svg_spec.md` (if missing, generate it first with the `eurorack-panel` skill's `--blank-front --spec-md panel_svg_spec.md`).
2. Verify hardware switch polarities, LED function, and max knob diameter (`<= 14.0 mm`) against the module schematic/spec before placing any label.
3. Ask the user (one question at a time) to lock in any unspecified creative choices:
   - Short front-face module title (e.g., `ENV / SKEW`) and bottom-right maker/rev tag (e.g., `DM // R1.0`)
   - Top-right hero emblem motif reflecting the circuit's core behavior
   - Target deliverable scope (VectorCraft SVGs + previews first vs. full KiCad import + DRC + Gerbers)

## Phase 2 — Author & Audit VectorCraft Artwork

1. Author a project-local `panel_art/generate_panel_art.py` importing [`vc_panel_lib.py`](./scripts/vc_panel_lib.py):
   - Initialize the document and standard 5 layers (`00_Board_Mockup`, `01_F_Mask_Gold`, `02_F_SilkS_White`, `03_Registration_Frame`, `04_Hardware_Keepouts`) via `init_panel_document`.
   - Call `populate_mockup_layer`, `populate_registration_layer`, and `populate_keepout_layer`.
   - Populate `01_F_Mask_Gold` and `02_F_SilkS_White` following [Design System Reference](./references/design-system.md), ending with `append_standard_exports`.
2. Emit batch steps (sandboxed) and execute `vectorcraft-cli run` (`BypassSandbox: true` when `/Users/brett/.local/bin/vectorcraft-cli` sits outside workspace):
   ```bash
   .venv/bin/python panel_art/generate_panel_art.py --emit-commands panel_art/build_steps.json
   /Users/brett/.local/bin/vectorcraft-cli run --commands panel_art/build_steps.json > panel_art/_vc_run.log
   ```
   Confirm `0` warnings across all executed steps, then delete `panel_art/_vc_run.log`.
3. Normalize SVGs to `1:1 mm` Plain SVGs and run the `40 px/mm` morphological clearance audit via [`verify_panel_svgs.py`](./scripts/verify_panel_svgs.py):
   ```bash
   .venv/bin/python .agents/skills/eurorack-brutalist-panel/scripts/verify_panel_svgs.py \
     --spec panel_svg_spec.md --dir panel_art
   ```
   Confirm `text_nodes == 0`, `stroked_nodes == 0`, exact `[0.0, 0.0, width_mm, height_mm]` registration bbox, `silk_to_mask_overlap_px == 0`, `silk_to_mask_min_gap_mm >= 0.20`, and `0` edge/washer/NPTH/nut violations.
4. Run `vectorcraft-cli info` on `panel_art/front_silkscreen.svg` and `panel_art/front_soldermask.svg` (`0` warnings, `0` live fonts), then visually inspect **both** `panel_art/preview_clean.png` and `panel_art/preview_keepouts.png` via `read_file`. Iterate until typography centering, motif balance, and keepouts are spotless.

## Phase 3 — Import SVGs into KiCad 10 Panel PCB

1. Import both verified `1:1 mm` SVGs onto `F.SilkS` and `F.Mask`, apply the Matte Black + White + ENIG 2-layer stackup, and refill `GND` shield zones using [`import_svgs_to_kicad.py`](./scripts/import_svgs_to_kicad.py):
   ```bash
   /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
     .agents/skills/eurorack-brutalist-panel/scripts/import_svgs_to_kicad.py \
     --pcb <panel>.kicad_pcb \
     --silks-svg panel_art/front_silkscreen.svg \
     --mask-svg panel_art/front_soldermask.svg
   ```
2. Run KiCad DRC and confirm `0` errors, `0` non-library violations (`lib_footprint_issues` on embedded `Eurorack_Panel` cutouts are expected), and `0` unconnected items:
   ```bash
   kicad-cli pcb drc --severity-all --refill-zones --format json --output /tmp/panel_drc.json <panel>.kicad_pcb
   ```
3. Render high-quality top and bottom 3D raytraced previews into workspace-local `images/` and inspect both via `read_file` to verify glyph counters (`O`, `R`, `A`, `D`, `0`), ENIG gold tone, and drill registration:
   ```bash
   kicad-cli pcb render --side top --width 900 --height 2400 --background transparent --quality high --output images/panel_front.png <panel>.kicad_pcb
   kicad-cli pcb render --side bottom --width 900 --height 2400 --background transparent --quality high --output images/panel_back.png <panel>.kicad_pcb
   ```

## Phase 4 — Export JLCPCB Bare-Panel Upload Gerbers

1. Export Gerbers and separated PTH/NPTH Excellon drills (with routed oval M3 slots and `--drill-origin plot` matching the panel aux origin):
   ```bash
   mkdir -p manufacturing/panel_gerbers
   kicad-cli pcb export gerbers --output manufacturing/panel_gerbers/ \
     --layers F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts \
     --subtract-soldermask --use-drill-file-origin --check-zones <panel>.kicad_pcb
   kicad-cli pcb export drill --output manufacturing/panel_gerbers/ \
     --format excellon --drill-origin plot --excellon-units mm \
     --excellon-separate-th --excellon-oval-format route \
     --generate-map --map-format gerberx2 <panel>.kicad_pcb
   (cd manufacturing/panel_gerbers && zip -r ../envelope_follower_panel_gerbers.zip .)
   ```
2. Verify `complete: true`, `has_pth_drill: true`, `has_npth_drill: true`, and `0` findings with `.venv/bin/python .agents/skills/kicad/scripts/analyze_gerbers.py manufacturing/panel_gerbers/ --full`, plus inspect `-NPTH.drl` for routed oval slot toolpaths (`G00`/`M15`/`G01`/`M16`).
3. Configure JLCPCB bare-panel order options as **`Matte Black`** solder mask, **`White`** silkscreen, **`ENIG-RoHS`** surface finish, `1.6 mm` FR-4, `PCB Assembly: OFF`, and **`Replace with 2D Barcode (QR Code)` on `B.SilkS` only** (explicit remark keeping `F.SilkS` free of order numbers).

---

## Non-Obvious Gotchas

- **Points vs. Millimeters:** `vectorcraft-cli` expects every coordinate, font size, and stroke weight in **points** (`mm * 72 / 25.4`), even when `file.new` uses `units: "Millimeters"`. Always construct via `vc_panel_lib.pt()` and normalize back with `verify_panel_svgs.py`.
- **Fast Batch Execution:** Omit `text.fontList` from batch scripts; enumerating system fonts adds minutes of latency.
- **One `PCB_SHAPE` per Fractured Outline:** KiCad `gr_poly` holds a single contour. [`import_svgs_to_kicad.py`](./scripts/import_svgs_to_kicad.py) combines compound subpaths with `SHAPE_POLY_SET.BooleanXor`, fractures with `Fracture()`, and emits one `PCB_SHAPE` per outline so knocked-out letter islands stay intact.
- **Keep `B.SilkS` Intact:** `import_svgs_to_kicad.py` clears only board-level `F.SilkS` and `F.Mask` drawings so rear QR squares, module titles, and URLs remain untouched across re-imports.
