# ENV / SKEW — 6 HP Eurorack Envelope Follower & Asymmetric Skew Limiter

An open-source **6 HP × 3U Eurorack** audio-driven **Envelope Follower** and normal-switched **Asymmetric Skew Limiter**, designed in Python ([`SKiDL`](envelope_follower.py) + `pcbnew` + `vectorcraft-cli`) for one-cart **JLCPCB PCB + Economic Bottom-Side PCBA** and **Tayda Electronics** through-hole completion.

<p align="center">
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/"><strong>Open Live Documentation Site →</strong></a> ·
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/patches/">Patch Guides Workbench</a> ·
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/build/">Interactive Build Checklists (211 steps)</a> ·
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/">Hardware Showcase</a> ·
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/origin/">Origin Story</a> ·
  <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/downloads/">Fab Downloads</a>
</p>

| 6 HP Front Panel (Matte Black + ENIG) | Main PCB Top (`F.Cu` Controls) | Main PCB Bottom (`B.Cu` 50 SMDs) |
| :---: | :---: | :---: |
| <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#panel"><img src="images/panel_front.png" alt="ENV / SKEW 6 HP front panel render (ENIG gold artwork)" width="220"></a> | <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#pcb"><img src="images/pcb_front.png" alt="Main PCB front render (F.Cu)" width="205"></a> | <a href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#pcb"><img src="images/pcb_back.png" alt="Main PCB back render (B.Cu)" width="205"></a> |

---

## Key Architecture & Hardware Highlights

- **Two modules in 6 HP (`30.0 × 128.5 mm` panel · `30.0 × 108.0 mm` PCB):** Patch audio into `IN` (`J1`) for **Envelope Follower Mode** (`×2.00` switchless preamp, zero-drop `BAT54S` full-wave rectifier, `SMOOTH` split-resistor passive T-filter), or patch CV/audio into `SLEW IN` (`J2`) to break the internal normal for **Asymmetric Skew Limiter Mode**.
- **Single-SKU silicon, zero trimmers:** Uses **`2× TL074HIDR`** (`8/8` op-amp sections utilized) and `14× 10 kΩ ±0.1%` thin-film resistors for `1.000×` rectifier symmetry and `0.00%` offset amplitude cross-talk across `±4.98 V` `OFFSET` (`RV4` center-detent).
- **Tuned for techno & ambient:** `FAST` (`470 nF`: `0.29–289 ms`) and `SLOW` (`4.87 µF`: `3.0 ms–3.00 s`) ranges, active post-offset *V*-to-*I* bi-color LED driver (`LED1`, Tayda `A-1076`: Green `+V` / Dark `0 V` / Red `−V`), and mirrored `OUT` (`J3`) + `INV OUT` (`J4`) outputs.
- **Friendly DIY/PCBA split:** `50` Bottom-side SMDs (`3` JLCPCB Extended SKUs + `14` Basic rows), `18` manual through-hole parts (`14` BOM rows in [`bom/ibom.html`](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/bom/ibom.html)), and `12` optional DNP test points (`TP1`–`TP12`).
- **A3 Schematic & Inspection:** Explore the [interactive 9-block schematic viewer](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#schematic) or open [`envelope_follower.pdf`](envelope_follower.pdf) directly for printable bench reference.

---

## Live Documentation Site & Repository Layout

Visit **[domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/)** for client-side `⌘K` search, interactive 6 HP patch presets, zoomable A3 schematic blocks, front-panel keepout layers, and offline-capable browser build checklists:

| Category | Repository Sources | Documentation Portal |
| :--- | :--- | :--- |
| **Patch Guides (01–08)** | [`patches/`](patches/) · [`patches/README.md`](patches/README.md) | [Studio Rack Workbench (`/patches/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/patches/) |
| **Build Checklists (211 steps)** | [`checklists/`](checklists/) · [`checklists/README.md`](checklists/README.md) | [Interactive Bench Checklists (`/build/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/build/) |
| **Interactive Assembly BOM** | [`bom/ibom.html`](bom/ibom.html) | [Launch Standalone iBOM (`/bom/ibom.html`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/bom/ibom.html) |
| **Manufacturing Packs** | [`manufacturing/`](manufacturing/) · [`jlcpcb_bom.csv`](jlcpcb_bom.csv) | [Fabrication & Source Downloads (`/downloads/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/downloads/) |
| **Baseline & Critique Specs** | [`EnvelopeFollower.md`](EnvelopeFollower.md) · [`EnvelopeFollowerImprovements.md`](EnvelopeFollowerImprovements.md) | [Base Circuit & Review (`/specs/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/specs/) |
| **Production & Panel Specs** | [`DesignSpec.md`](DesignSpec.md) · [`panel_svg_spec.md`](panel_svg_spec.md) | [Final Design & Panel Specs (`/specs/design-spec/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/specs/design-spec/) |
| **Circuit & Schematic CAD** | [`envelope_follower.py`](envelope_follower.py) · [`generate_schematic.py`](generate_schematic.py) · [`envelope_follower.kicad_sch`](envelope_follower.kicad_sch) · [`envelope_follower.pdf`](envelope_follower.pdf) | [9-Block A3 Schematic (`/hardware/#schematic`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#schematic) |
| **Main PCB CAD & Renders** | [`generate_kicad_pcb.py`](generate_kicad_pcb.py) · [`silk_layout.json`](silk_layout.json) · [`envelope_follower.kicad_pcb`](envelope_follower.kicad_pcb) · [`images/`](images/) | [F.Cu / B.Cu PCB Plates (`/hardware/#pcb`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#pcb) |
| **Front Panel CAD & Artwork** | [`envelope_follower_panel.kicad_pcb`](envelope_follower_panel.kicad_pcb) · [`panel_art/`](panel_art/) | [4-Layer Panel Inspector (`/hardware/#panel`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/hardware/#panel) |
| **Static Site & CI/CD** | [`site/`](site/) · [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) | [Origin Story & Lineage (`/origin/`)](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/origin/) |
| **Agent Tooling & Docs** | [`AGENTS.md`](AGENTS.md) · [`GLOSSARY.md`](GLOSSARY.md) · [`docs/agents/`](docs/agents/) · [`.agents/skills/`](.agents/skills/) | — |

---

<details>
<summary><strong>Maintainer CLI: Regenerating Schematic, PCB, Panel, Renders, Checklists, iBOM & Docs Site</strong></summary>

### 1. SKiDL Netlist & KiCad 10 A3 Schematic
```bash
.venv/bin/python envelope_follower.py
.venv/bin/python generate_schematic.py
kicad-cli sch export pdf --output envelope_follower.pdf envelope_follower.kicad_sch
sips -s format png -Z 2400 envelope_follower.pdf --out images/schematic.png
```

### 2. Main PCB Layout, Silkscreen Sync & High-Res Renders
```bash
python3 generate_kicad_pcb.py
python3 generate_kicad_pcb.py --silk-only
python3 generate_kicad_pcb.py --sync-silk
python3 generate_kicad_pcb.py --show-silk [REF ...]
python3 generate_kicad_pcb.py --check-silk   # strict silkscreen collision/keepout/tether inspection
kicad-cli pcb render --side top --width 900 --height 2400 --background transparent --quality high --output images/pcb_front.png envelope_follower.kicad_pcb
kicad-cli pcb render --side bottom --width 900 --height 2400 --background transparent --quality high --output images/pcb_back.png envelope_follower.kicad_pcb
```

### 3. 6 HP Front Panel, ENIG/Silkscreen Import & Panel Renders
```bash
python3 .agents/skills/eurorack-panel/scripts/generate_eurorack_panel.py \
    --main-pcb envelope_follower.kicad_pcb \
    --output envelope_follower_panel.kicad_pcb \
    --blank-front \
    --title "ENVELOPE FOLLOWER + SKEW LIMITER" \
    --version "Rev 1.0" \
    --url "github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter" \
    --spec-md panel_svg_spec.md \
    --drc
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 panel_art/import_svgs_to_kicad.py
kicad-cli pcb render --side top --width 900 --height 2400 --background transparent --quality high --output images/panel_front.png envelope_follower_panel.kicad_pcb
kicad-cli pcb render --side bottom --width 900 --height 2400 --background transparent --quality high --output images/panel_back.png envelope_follower_panel.kicad_pcb
```

### 4. Checklist 3D Alignment, Hand-Assembly & Bringup Screenshots
```bash
python3 checklists/generate_pcba_alignment_images.py
python3 checklists/generate_hand_assembly_images.py
python3 checklists/generate_bringup_images.py
```

### 5. Interactive Hand-Assembly BOM (`bom/ibom.html`)
To re-create [`bom/ibom.html`](bom/ibom.html) after modifying [`envelope_follower.kicad_pcb`](envelope_follower.kicad_pcb):
1. Open [`envelope_follower.kicad_pcb`](envelope_follower.kicad_pcb) in KiCad PCB Editor (`pcbnew`) and launch the [InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom) plugin (`v2.11.1`).
2. **General** tab: keep the output directory `bom` and filename format `ibom` (writes `bom/ibom.html`).
3. **Fields** tab:
   - **Extra fields:** show `Value`, `Footprint`, `MPN`, and `Manufacturer` (omit `LCSC` and `Notes`).
   - **Board variant field:** select `JLCPCB_Class`.
   - **Variants whitelist:** select `Manual THT` only (leave `Basic`, `Extended`, `DNP THT`, and `<empty>` unselected).
4. Click **Generate BOM** and verify the output lists `14` BOM rows / `18` components (`11` Front, `7` Back).

### 6. GitHub Pages Documentation Site (`site/`)
```bash
cd site
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

</details>

---

## Attribution, License & Disclaimer

- **Origin:** Built on **HAGIWO/ハギヲ** (`@solder_state`)’s open-source DIY [No. 43: $4 Envelope Follower](https://note.com/solder_state/n/n110e9ba066b3?hl=en) and the baseline circuit extraction in [domesticmouse/EnvelopeFollower](https://github.com/domesticmouse/EnvelopeFollower). Read the full engineering lineage on the [Origin Story](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/origin/) page.
- **License:** Licensed under the [Apache License 2.0](LICENSE).
- **Disclaimer:** This is not an officially supported Google product.
