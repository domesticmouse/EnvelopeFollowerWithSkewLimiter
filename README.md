# EnvelopeFollowerWithSkewLimiter

Building on [domesticmouse/EnvelopeFollower](https://github.com/domesticmouse/EnvelopeFollower) with all the mod cons.

## Repository Structure

| Path | Description |
| --- | --- |
| [`README.md`](README.md) | Project overview and directory index (kept up to date as design files are added). |
| [`EnvelopeFollower.webp`](EnvelopeFollower.webp) | Hand-drawn reference schematic image for the base Eurorack envelope follower circuit, used as the source for circuit extraction. |
| [`EnvelopeFollower.md`](EnvelopeFollower.md) | Extracted Markdown circuit specification (BOM, stage-by-stage analysis, pin-level netlist, and build notes) derived from `EnvelopeFollower.webp`. |
| [`EnvelopeFollowerImprovements.md`](EnvelopeFollowerImprovements.md) | Engineering review of the base circuit documenting electrical issues, quantitative analysis, prioritized fixes, and Eurorack skew-limiter upgrade architectures. |
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
