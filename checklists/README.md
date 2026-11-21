# Build & Manufacturing Checklists

Step-by-step checklists for ordering, verifying, assembling, and bringing up the **6 HP Envelope Follower with Skew Limiter** main PCB.

## Workflow Order

| Step | Checklist | Scope |
| :---: | :--- | :--- |
| **1** | [`01-main-board-ordering.md`](01-main-board-ordering.md) | Gerber/BOM/CPL export, JLCPCB PCB fabrication specs (lead-free, QR replacement, tented vias), and Bottom-Side Economic PCBA ordering |
| **2** | [`02-pcba-part-alignment.md`](02-pcba-part-alignment.md) | Per-component placement & orientation verification for all **50 `B.Cu` SMD parts** in the JLCPCB placement viewer before checkout |
| **3** | [`03-tayda-ordering.md`](03-tayda-ordering.md) | Shopping checklist for all **18 through-hole / panel parts** (`RV1`–`RV4`, `SW1`–`SW2`, `LED1`, `J1`–`J4`, `J_PWR`, `C1`–`C2`, `C7`, `C11`–`C13`) plus knobs (`<= 14.0 mm` OD), power cable, mounting hardware, spares, and optional test loops |
| **4** | [`04-hand-assembly.md`](04-hand-assembly.md) | Post-PCBA inspection, optional `TP1`–`TP12` test loops, `B.Cu` THT parts (`J_PWR`, `C1`/`C2`, film caps), `LED1` polarity bench check, `F.Cu` front-panel dry-fit & soldering, and flux cleanup |
| **5** | [`05-board-bringup.md`](05-board-bringup.md) | Unpowered cold checks, current-limited first power-up, all **12 test points** (`TP1`–`TP12`), stage-by-stage signal verification, `SLEW IN` / `SMOOTH` / `FAST-SLOW` / `OFFSET` / `LED1` tests, and troubleshooting |

## Source References

- Design specification & netlist: [`../DesignSpec.md`](../DesignSpec.md)
- Schematic PDF: [`../envelope_follower.pdf`](../envelope_follower.pdf)
- KiCad 10 PCB: [`../envelope_follower.kicad_pcb`](../envelope_follower.kicad_pcb)
- Grouped JLCPCB SMD BOM: [`../jlcpcb_bom.csv`](../jlcpcb_bom.csv)
- Single-source SKiDL capture: [`../envelope_follower.py`](../envelope_follower.py)
