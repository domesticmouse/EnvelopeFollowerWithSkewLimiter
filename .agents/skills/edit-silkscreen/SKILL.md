---
name: edit-silkscreen
description: >-
  Move, rotate, edit, sync, and visually preview individual silkscreen entries
  on envelope_follower.kicad_pcb using silk_layout.json and generate_kicad_pcb.py.
  Use whenever the user asks to move, nudge, rotate, hide/show, add, or inspect
  specific silkscreen labels (e.g. C1, R12, U1, board text), sync manual KiCad GUI
  silkscreen edits back to the generator, or iterate through silkscreen placement
  one by one.
---

# Edit Silkscreen Runbook

Use this skill to move, rotate, restyle, or sync silkscreen entries on `envelope_follower.kicad_pcb` one by one without cascading shifts to other components.

## Source of Truth & Coordinate System

- `silk_layout.json` pins all 80 footprints, board texts, QR rects, dots, and segments in **board-local mm** (`30.0 × 108.0 mm`, origin `(100.0, 40.0)` matching KiCad's Grid/Aux origin). Editing one entry never shifts any neighbor.
- Set any footprint to `"auto"` (e.g. `"C1": "auto"`) to let it auto-place around all pinned items.
- **Visual movement directions** (verified against the preview mm ruler):
  - `F.SilkS` (`top` view): right = `+x`, left = `-x`, down = `+y`, up = `-y`.
  - `B.SilkS` (`bottom` view): **left = `+x`, right = `-x`**, down = `+y`, up = `-y` (rear side is viewed horizontally mirrored).

## Workflow A — Move Labels in Chat (`silk_layout.json` → `--silk-only` → Preview)

1. **Inspect the target neighborhood** (avoids reading the 2,000-line generator):
   ```bash
   python3 generate_kicad_pcb.py --show-silk <REF>
   ```
2. **Edit only the target entry in `silk_layout.json`**:
   - Keep `deg` at `0.0` or `90.0` (`B.SilkS` mirroring is handled automatically).
   - Keep `Value` hidden on `.Fab` (edit `texts` items, never unhide `fp.Value()`).
   - Stay within `3.5 mm` SMD / `6.0 mm` THT tether bounds and `≤ 1.2 mm` gap between `<REF>` and its `<VAL>` text, clear of mask-expanded pad keepouts (`+0.30 mm`), **both** SMD and THT `.Fab` package bodies (`block_tht_fab=True`), board-level silk shapes (e.g., `U1`/`U2` Pin-1 `dots`), and `5 × 5 mm` `qr_rects` via/track copper keepouts.
3. **Restamp silkscreen fast (~1 s)** (preserves copper, zones, vias, and `B.Fab` notes):
   ```bash
   python3 generate_kicad_pcb.py --silk-only
   ```
   `--silk-only` still saves mid-edit if a temporary overlap occurs while shuffling adjacent parts, and prints `inspect_board_silk` status immediately.
4. **Render and inspect a zoomed preview image** (save into your conversation's `<Artifact Directory Path>` or `/tmp/`, never inside the repo):
   ```bash
   python3 .agents/skills/edit-silkscreen/scripts/render_silk_preview.py \
     --ref <REF> \
     --output <Artifact Directory Path>/silk_preview_<REF>.png
   ```
   - Inspect the PNG with `read_file` to verify legibility, clearance, and position against the mm ruler.
   - Present it inline with `![<REF> silkscreen preview](/abs/path/to/silk_preview_<REF>.png)`.
   - Remind the user to run **File → Revert** in KiCad if `envelope_follower.kicad_pcb` is open in the GUI.

See [render_silk_preview.py](./scripts/render_silk_preview.py) for options (`--ref`, `--side top|bottom`, `--pad-mm`, `--full`, `--output`).

## Workflow B — Sync Manual KiCad GUI Edits (`--sync-silk` → Preview)

> **CRITICAL:** If the user moved labels in KiCad PCB Editor, ALWAYS run `--sync-silk` **before** running `--silk-only` or full `generate_kicad_pcb.py`, or unsynced GUI edits will be lost!

1. Sync saved KiCad positions into `silk_layout.json`:
   ```bash
   python3 generate_kicad_pcb.py --sync-silk
   ```
2. Report the printed per-ref diff and `inspect_board_silk` status, then render and inspect a preview for the moved ref(s) (or `--side top|bottom --full`) with [render_silk_preview.py](./scripts/render_silk_preview.py).

## End-of-Batch Final Verification

After finishing a set of moves, run full rebuild parity + strict silk/DRC checks + full-side previews:

```bash
python3 generate_kicad_pcb.py
python3 generate_kicad_pcb.py --check-silk
/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli pcb drc \
  --refill-zones --severity-all envelope_follower.kicad_pcb
python3 .agents/skills/edit-silkscreen/scripts/render_silk_preview.py \
  --side top --full --output <Artifact Directory Path>/silk_preview_top_full.png
python3 .agents/skills/edit-silkscreen/scripts/render_silk_preview.py \
  --side bottom --full --output <Artifact Directory Path>/silk_preview_bottom_full.png
```

Inspect both full-board PNGs via `read_file` and confirm `RESULT: PASS`, `0` DRC violations, and `0` unconnected items.
