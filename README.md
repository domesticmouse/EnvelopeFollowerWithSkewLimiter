# EnvelopeFollowerWithSkewLimiter

Building on [domesticmouse/EnvelopeFollower](https://github.com/domesticmouse/EnvelopeFollower) with all the mod cons.

## Repository Structure

| Path | Description |
| --- | --- |
| [`README.md`](README.md) | Project overview and directory index (kept up to date as design files are added). |
| [`EnvelopeFollower.webp`](EnvelopeFollower.webp) | Hand-drawn reference schematic image for the base Eurorack envelope follower circuit, used as the source for circuit extraction. |
| [`EnvelopeFollower.md`](EnvelopeFollower.md) | Extracted Markdown circuit specification (BOM, stage-by-stage analysis, pin-level netlist, and build notes) derived from `EnvelopeFollower.webp`. |
| [`EnvelopeFollowerImprovements.md`](EnvelopeFollowerImprovements.md) | Engineering review of the base circuit documenting electrical issues, quantitative analysis, prioritized fixes, and Eurorack skew-limiter upgrade architectures. |
| [`DesignSpec.md`](DesignSpec.md) | Finalized 6 HP (`2× TL074H`) build specification, JLCPCB SMD / Tayda TH BOM, stage analysis, pin-level netlist, and front-panel layout. |
| [`envelope_follower.py`](envelope_follower.py) | SKiDL Python circuit capture script implementing all 80 footprints, 48 nets, ERC assertions, and BOM/netlist exports. |
| [`envelope_follower.net`](envelope_follower.net) | Exported KiCad 10 netlist (80 components, 48 active nets, `Power`/`HighImpedance` NetClasses, and DNP test-point properties). |
| [`envelope_follower_bom.xml`](envelope_follower_bom.xml) | Well-formed KiCad XML BOM containing component values, footprints, LCSC/MPN/silkscreen fields, and net nodes. |
| [`jlcpcb_bom.csv`](jlcpcb_bom.csv) | Grouped 4-column JLCPCB SMT PCBA BOM (50 SMD components across 17 rows, 3 Extended SKUs). |
| [`envelope_follower_sklib.py`](envelope_follower_sklib.py) | Auto-generated SKiDL backup symbol library for offline/reproducible netlist builds. |
| [`footprints/Eurorack_Custom.pretty/`](footprints/Eurorack_Custom.pretty/) | Project-local KiCad footprint library (`SW_Toggle_SPDT_Dailywell_2MS1.kicad_mod` for Tayda `A-6087` / Dailywell `2MS1` SPDT vertical toggles). |
| [`fp-lib-table`](fp-lib-table) | Project-local KiCad footprint library table registering `Eurorack_Custom`. |
| [`.agents/skills/`](.agents/skills/) | Installed hardware design, layout, BOM, and manufacturing skills for agent workflows. |
| [`skills-lock.json`](skills-lock.json) | Lockfile pinning the installed skills in `.agents/skills/` to their upstream GitHub commits (`aklofas/kicad-happy` and `domesticmouse/skills`). |
| [`LICENSE`](LICENSE) | Apache License 2.0. |

## Reference Circuit

The base envelope follower schematic is stored in [`EnvelopeFollower.webp`](EnvelopeFollower.webp), and its extracted build specification (BOM, stage-by-stage calculations, pin-level netlist, and implementation notes) is documented in [`EnvelopeFollower.md`](EnvelopeFollower.md):

![Base Envelope Follower schematic](EnvelopeFollower.webp)

## Circuit Review & Improvements

An engineering review of the base circuit is recorded in [`EnvelopeFollowerImprovements.md`](EnvelopeFollowerImprovements.md). Key findings and upgrades include:

- **Critical electrical & ergonomic fixes:** Eliminating the `ATK`/`Release` voltage-divider collapse (`-15.7 dB` worst-case attenuation) and `R9` gain shift, removing the uncompensated `D3` peak-detector dead zone, eliminating `OFFSET` pot loading (`+12.1%` gain modulation and non-linear taper), raising input impedance from `9.9 kΩ` to `~100 kΩ` with balanced gain staging, and replacing the pre-biased LED network with an active $V$-to-$I$ driver.
- **Recommended `2× TL074H` active skew-limiter architecture:** Consolidates onto a single op-amp SKU (`8` sections, `0` unused) with a frequency-compensated active precision skew limiter (`U1D` + `U2A`), normaled `SLEW IN` jack, unity-gain inverting summer (`0.00%` offset gain modulation), and optional Eurorack utilities (`SMOOTH` filter, `PRE OUT`, Schmitt-trigger `GATE OUT`).

## Finalized Design Specification

The locked-in 6 HP module architecture is documented in [`DesignSpec.md`](DesignSpec.md):

- **6 HP Eurorack (`2× TL074HIDR`, `0` unused sections, `0` trimmers):** Single-column `4`-knob layout (`GAIN` `A100K`, `ATK` `A1M`, `REL` `A1M`, `OFFSET` `B10K` center-detent), dual sub-mini toggles (`SMOOTH` & `FAST / SLOW`), post-offset `3 mm` 2-pin bi-color LED (`Tayda A-1076`), and a `2 × 2` jack grid (`IN`, normaled `SLEW IN`, `OUT`, `INV_OUT`).
- **JLCPCB PCBA + Tayda TH split:** `50` SMD parts using only `3` JLCPCB Extended SKUs (`TL074HIDR`, `BAT54S`, `10 kΩ ±0.1%`) with all other SMD passives and `1N4148W` / `B5819W` diodes as JLCPCB Basic parts, paired with `18` Tayda/panel through-hole components (`47 µF / 35 V` radial bulk caps, `5 mm` box film timing/coupling caps, Alpha `9 mm` pots, toggles, and Thonkiconn jacks) plus `12` DNP through-hole test points (Ronghe `RH-5001` / LCSC `C5199801`).
- **Tuned for techno & ambient:** Switchless `×2` Eurorack input (`Z_in = 90.9 kΩ`), zero-gain-drop split-resistor `SMOOTH` T-filter (`f_c = 29.0 Hz`, `−11.1 dB` at `100 Hz`), `1 kΩ` linear-safe skew floor, `FAST` (`470 nF`: `0.29–289 ms`) / `SLOW` (`4.87 µF`: `3.0 ms–3.00 s`), and `±4.98 V` RC-filtered `OFFSET` with visual kick-ducking zero-crossing readout.

## Installed Skills

The [`.agents/skills/`](.agents/skills/) directory includes the following hardware workflow skills:

- `skidl` — Python circuit capture (SKiDL) and netlist/BOM export
- `kicad` — KiCad schematic, PCB, Gerber, and DRC/ERC analysis
- `kicad-pcbnew-layout` — Programmatic KiCad 10 PCB placement, routing, and copper pours via `pcbnew`
- `kicad-silkscreen-markup` — Collision-free silkscreen annotation and fabrication notes
- `eurorack-panel` — Mated 3U Eurorack front panel generation from main PCB coordinates
- `bom` — Unified BOM management and fabrication exports
- `datasheets` — Structured component datasheet extraction and caching
- `lcsc` — LCSC/JLCPCB component search and datasheet sync
- `jlcpcb` — JLCPCB fabrication and PCBA preparation

## License

Licensed under the [Apache License 2.0](LICENSE).

## Disclaimer

This is not an officially supported Google product.
