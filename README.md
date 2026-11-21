# EnvelopeFollowerWithSkewLimiter

Building on [domesticmouse/EnvelopeFollower](https://github.com/domesticmouse/EnvelopeFollower) with all the mod cons.

## Repository Structure

| Path | Description |
| --- | --- |
| [`README.md`](README.md) | Project overview and directory index (kept up to date as design files are added). |
| [`EnvelopeFollower.webp`](EnvelopeFollower.webp) | Hand-drawn reference schematic image for the base Eurorack envelope follower circuit, used as the source for circuit extraction. |
| [`.agents/skills/`](.agents/skills/) | Installed hardware design, layout, BOM, and manufacturing skills for agent workflows. |
| [`skills-lock.json`](skills-lock.json) | Lockfile pinning the installed skills in `.agents/skills/` to their upstream GitHub commits (`aklofas/kicad-happy` and `domesticmouse/skills`). |
| [`LICENSE`](LICENSE) | Apache License 2.0. |

## Reference Circuit

The base envelope follower schematic is stored in [`EnvelopeFollower.webp`](EnvelopeFollower.webp):

![Base Envelope Follower schematic](EnvelopeFollower.webp)

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
