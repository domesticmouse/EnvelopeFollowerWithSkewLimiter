# Eurorack Front-Panel Specification — ENVELOPE FOLLOWER + SKEW LIMITER

## 1. Overview & Metadata

| Field | Value |
| :--- | :--- |
| **Module Name** | `ENVELOPE FOLLOWER + SKEW LIMITER` |
| **Version** | `Rev 1.0` |
| **GitHub / Project URL** | `github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter` |
| **Format** | `6 HP × 3U` (`30.00 × 128.50 mm`, `1.6 mm` FR4) |
| **Source Main PCB** | `envelope_follower.kicad_pcb` (`30.00 × 108.00 mm`) |
| **Target Panel PCB** | `envelope_follower_panel.kicad_pcb` |
| **Front Face Mode** | Blank (`0` `F.SilkS` primitives; ready for custom SVG import) |

## 2. SVG Canvas & Coordinate System

Use a **1:1 millimeter** SVG canvas matching KiCad's panel-local coordinate system (`(0, 0)` at top-left, `+X` right, `+Y` down, `1 SVG user unit = 1.00 mm`):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="30.00mm" height="128.50mm" viewBox="0 0 30.00 128.50">
```

- **KiCad Global Origin Mapping:** SVG `(0.00, 0.00)` maps to KiCad global `(100.00, 29.75) mm` -> bottom-right `(130.00, 158.25) mm`.
- **Main PCB Overhang:** `10.25 mm` vertical rail overhang (top & bottom); `0.00 mm` horizontal overhang.
- **Safe Artwork Bounds (`0.50 mm` edge inset):** `X = 0.50 .. 29.50 mm`, `Y = 0.50 .. 128.00 mm`.
- **Eurorack Rail-Lip & Washer Keepouts:** Top `Y = 0.00 .. 6.50 mm`, Bottom `Y = 122.00 .. 128.50 mm`.

## 3. Mounting Slots (`NPTH` Oval)

| Ref | SVG Center `(X, Y)` mm | KiCad Global `(X, Y)` mm | Slot `W × H` mm | `X` Span mm | `Y` Span mm | Washer Keepout |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **H1** | `(7.50, 3.00)` | `(107.50, 32.75)` | `5.50 × 3.20` | `4.75..10.25` | `1.40..4.60` | `~7.0 mm` M3 washer (`Y ± 3.5 mm`) |
| **H2** | `(7.50, 125.50)` | `(107.50, 155.25)` | `5.50 × 3.20` | `4.75..10.25` | `123.90..127.10` | `~7.0 mm` M3 washer (`Y ± 3.5 mm`) |

## 4. Front-Panel Component Cutouts & Keepouts

| Ref | Kind | Label | Value | SVG Center `(X, Y)` mm | KiCad Global `(X, Y)` mm | Drill Ø mm | Hole Type & Front Mask | Nut / Bezel Keepout Ø mm | Max Knob Ø mm | Notes / Behavior |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- | :---: | :---: | :--- |
| **RV1** | `pot` | `GAIN` | `A100K` | `(15.00, 21.25)` | `(115.00, 51.00)` | `7.20` | PTH GND — Tented (`B.Mask` 9.6 mm) | `11.0` | `<= 14.0` | Audio-taper input attenuator (.1 CCW=GND, .2 wiper, .3 CW=in) |
| **RV2** | `pot` | `ATK` | `A1M` | `(15.00, 36.75)` | `(115.00, 66.50)` | `7.20` | PTH GND — Tented (`B.Mask` 9.6 mm) | `11.0` | `<= 14.0` | Fail-safe attack rheostat (.1=R19.2, .2+.3=NET_ENV_CAP) |
| **RV3** | `pot` | `REL` | `A1M` | `(15.00, 52.25)` | `(115.00, 82.00)` | `7.20` | PTH GND — Tented (`B.Mask` 9.6 mm) | `11.0` | `<= 14.0` | Fail-safe release rheostat (.1=R20.2, .2+.3=NET_ENV_CAP) |
| **RV4** | `pot` | `OFFSET` | `B10K` | `(15.00, 67.75)` | `(115.00, 97.50)` | `7.20` | PTH GND — Tented (`B.Mask` 9.6 mm) | `11.0` | `<= 14.0` | Center-detent linear offset divider (.1=-V_off, .2=wiper, .3=+V_off) |
| **SW1** | `switch_submini` | `SMOOTH` | `SMOOTH` | `(7.00, 82.25)` | `(107.00, 112.00)` | `5.20` | PTH GND — Tented (`B.Mask` 7.2 mm) | `8.2` | — | SPDT (2=common, 3=SMOOTH active, 1=NC); lever UP = SMOOTH |
| **LED1** | `led_3mm` | `OUT` | `A-1076` | `(15.00, 82.25)` | `(115.00, 112.00)` | `3.20` | NPTH — Open `*.Mask` (3.2 mm) | `4.0` | — | 3mm 2-pin anti-parallel R/G LED; bench-check +V=Green (LED1.1=G anode) |
| **SW2** | `switch_submini` | `FAST/SLOW` | `FAST/SLOW` | `(23.00, 82.25)` | `(123.00, 112.00)` | `5.20` | PTH GND — Tented (`B.Mask` 7.2 mm) | `8.2` | — | SPDT (2=common, 3=SLOW active, 1=NC); lever UP = SLOW (4.87 uF) |
| **J1** | `jack` | `IN` | `IN` | `(8.00, 95.75)` | `(108.00, 125.50)` | `6.20` | PTH GND — Tented (`B.Mask` 8.6 mm) | `9.5` | — | Switched 3.5mm Thonkiconn input normaled to GND |
| **J2** | `jack` | `SLEW IN` | `SLEW IN` | `(22.00, 95.75)` | `(122.00, 125.50)` | `6.20` | PTH GND — Tented (`B.Mask` 8.6 mm) | `9.5` | — | Normaled to FWR out; patched = DC-coupled bipolar skew limiter |
| **J3** | `jack` | `OUT` | `OUT` | `(8.00, 110.75)` | `(108.00, 140.50)` | `6.20` | PTH GND — Tented (`B.Mask` 8.6 mm) | `9.5` | — | Non-inverted +(V_env + V_off) output jack |
| **J4** | `jack` | `INV OUT` | `INV_OUT` | `(22.00, 110.75)` | `(122.00, 140.50)` | `6.20` | PTH GND — Tented (`B.Mask` 8.6 mm) | `9.5` | — | Inverted -(V_env + V_off) sidechain output jack |

## 5. Inter-Control Spacing & Open Regions

- **`jack` (`×4`):** X = `8.00`, `22.00` mm; Y = `95.75`, `110.75` mm; H-pitch = `14.00 mm`; V-pitch = `15.00 mm`
- **`led_3mm` (`×1`):** X = `15.00` mm; Y = `82.25` mm; H-pitch = —; V-pitch = —
- **`pot` (`×4`):** X = `15.00` mm; Y = `21.25`, `36.75`, `52.25`, `67.75` mm; H-pitch = —; V-pitch = `15.50 mm` — Max knob Ø `14.0 mm`; Standard Alpha 9mm pot sweep is 300 deg (+/-150 deg around 12 o'clock).
- **`switch_submini` (`×2`):** X = `7.00`, `23.00` mm; Y = `82.25` mm; H-pitch = `16.00 mm`; V-pitch = —

**Row Band Summary (Top to Bottom):**
- Row 1 (`Y = 21.25 mm`): RV1 — left margin `15.00 mm`, right margin `15.00 mm` (next row `+15.50 mm`)
- Row 2 (`Y = 36.75 mm`): RV2 — left margin `15.00 mm`, right margin `15.00 mm` (next row `+15.50 mm`)
- Row 3 (`Y = 52.25 mm`): RV3 — left margin `15.00 mm`, right margin `15.00 mm` (next row `+15.50 mm`)
- Row 4 (`Y = 67.75 mm`): RV4 — left margin `15.00 mm`, right margin `15.00 mm` (next row `+14.50 mm`)
- Row 5 (`Y = 82.25 mm`): SW1, LED1, SW2 — left margin `7.00 mm`, right margin `7.00 mm` (next row `+13.50 mm`)
- Row 6 (`Y = 95.75 mm`): J1, J2 — left margin `8.00 mm`, right margin `8.00 mm` (next row `+15.00 mm`)
- Row 7 (`Y = 110.75 mm`): J3, J4 — left margin `8.00 mm`, right margin `8.00 mm`

## 6. Target Front-Face SVG Layers & Fabrication Rules (`F.SilkS` & `F.Mask`)

Export **two aligned Plain SVGs** sharing the exact `viewBox` canvas above:
1. **`front_silkscreen.svg` → `F.SilkS`**: Labels, dial ticks, polarity markers, borders, and legends.
2. **`front_soldermask.svg` → `F.Mask`**: Solder-mask openings for decorative metallic accents.

### PCB Fabrication & KiCad Rules
- **Exposed Copper vs. Bare FR4 (`F.Mask`):** The panel includes a solid `F.Cu` `GND` pour. Any `F.Mask` opening over the pour exposes **bare copper (ENIG gold or HASL silver)**. Because `F.Cu` pulls back `0.40–0.50 mm` from `Edge.Cuts` and around NPTH holes (`H1`, `H2`, `LED`s), avoid placing `F.Mask` artwork within **`0.60 mm`** of `Edge.Cuts` or within **`drill/2 + 0.50 mm`** of NPTH holes unless bare FR4 is intentional.
- **Zero `F.SilkS` / `F.Mask` Overlap:** Maintain **`>= 0.20 mm`** clearance between `F.SilkS` and `F.Mask` shapes (plus `>= 0.20 mm` outside exposed hole pads/slots) so fab houses do not clip ink and KiCad DRC reports zero `silk_over_copper` errors.
- **Convert Text & Strokes to Paths:** Before saving Plain SVG, convert all fonts and strokes to filled outlines (`Object to Path` and `Stroke to Path`) so KiCad renders exact geometry without font substitution.
- **JLCPCB Minimums:** `F.SilkS` minimum stroke `>= 0.15 mm` (`0.18–0.25 mm` recommended), minimum text height `>= 0.80 mm` (`1.0 mm+` recommended); `F.Mask` minimum opening/bridge `>= 0.20 mm`.
- **Exact Registration in KiCad 10 (`File → Import → Graphics...`):** Include a `0.05 mm` registration rectangle from `(0, 0)` to `(30.00, 128.50)` in both SVGs so KiCad does not shift the bounding box on import. Import at **Scale `1.0`** onto `F.SilkS` / `F.Mask`, anchor at panel origin `(100.00, 29.75)` (or `(0, 0)` with aux origin active), **Ungroup**, and delete the temporary outer registration rectangle.

## 7. Back-Face Silkscreen Layout (`B.SilkS`)

All rear markings are mirrored (`(justify mirror)`) for right-reading inspection from the back and automatically kept clear of `B.Mask` pads, mounting slots, and panel edges:

| Element | Content / Size | Panel-Local `(X, Y)` mm | KiCad Global `(X, Y)` mm | Rot (deg) | Min Clearance mm |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **JLCPCB QR Blank** | `5.00 × 5.00 mm` filled `gr_rect` | `(22.50, 121.00)` | `(122.50, 150.75)` | `0` | `2.73` |
| **Module Name & Version** | `ENVELOPE FOLLOWER / + SKEW LIMITER / 6HP  Rev 1.0` | `(15.00, 10.50)` | `(115.00, 40.25)` | `0` | `2.40` |
| **Project URL** | `github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter` | `(24.61, 39.47)` | `(124.61, 69.22)` | `90` | `3.25` |

## 8. Machine-Readable Geometry (`JSON`)

```json
{
  "metadata": {
    "module_name": "ENVELOPE FOLLOWER + SKEW LIMITER",
    "version": "Rev 1.0",
    "url": "github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter",
    "hp": 6,
    "blank_front": true,
    "source_pcb": "envelope_follower.kicad_pcb",
    "target_panel_pcb": "envelope_follower_panel.kicad_pcb"
  },
  "canvas": {
    "units": "mm",
    "width_mm": 30.0,
    "height_mm": 128.5,
    "viewBox": "0 0 30.00 128.50",
    "origin": "top-left (+X right, +Y down)",
    "kicad_global_origin_mm": [
      100.0,
      29.75
    ],
    "kicad_global_end_mm": [
      130.0,
      158.25
    ],
    "main_pcb_size_mm": [
      30.0,
      108.0
    ],
    "overhang_mm": {
      "x": 0.0,
      "y": 10.25
    },
    "safe_artwork_bounds_mm": {
      "x_min": 0.5,
      "y_min": 0.5,
      "x_max": 29.5,
      "y_max": 128.0
    },
    "rail_keepout_y_mm": {
      "top": [
        0.0,
        6.5
      ],
      "bottom": [
        122.0,
        128.5
      ]
    }
  },
  "mounting_slots": [
    {
      "ref": "H1",
      "local_x": 7.5,
      "local_y": 3.0,
      "global_x": 107.5,
      "global_y": 32.75,
      "width_mm": 5.5,
      "height_mm": 3.2
    },
    {
      "ref": "H2",
      "local_x": 7.5,
      "local_y": 125.5,
      "global_x": 107.5,
      "global_y": 155.25,
      "width_mm": 5.5,
      "height_mm": 3.2
    }
  ],
  "components": [
    {
      "ref": "RV1",
      "kind": "pot",
      "label": "GAIN",
      "value": "A100K",
      "local_x": 15.0,
      "local_y": 21.25,
      "global_x": 115.0,
      "global_y": 51.0,
      "drill_mm": 7.2,
      "pad_mm": 9.6,
      "keepout_mm": 11.0,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 9.6 mm)",
      "mpn": "RD901F-40-15R1-A100K",
      "manufacturer": "Alpha (Tayda A-1855)",
      "notes": "Audio-taper input attenuator (.1 CCW=GND, .2 wiper, .3 CW=in)",
      "max_knob_mm": 14.0
    },
    {
      "ref": "RV2",
      "kind": "pot",
      "label": "ATK",
      "value": "A1M",
      "local_x": 15.0,
      "local_y": 36.75,
      "global_x": 115.0,
      "global_y": 66.5,
      "drill_mm": 7.2,
      "pad_mm": 9.6,
      "keepout_mm": 11.0,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 9.6 mm)",
      "mpn": "RD901F-40-15R1-A1M",
      "manufacturer": "Alpha (Tayda A-1672)",
      "notes": "Fail-safe attack rheostat (.1=R19.2, .2+.3=NET_ENV_CAP)",
      "max_knob_mm": 14.0
    },
    {
      "ref": "RV3",
      "kind": "pot",
      "label": "REL",
      "value": "A1M",
      "local_x": 15.0,
      "local_y": 52.25,
      "global_x": 115.0,
      "global_y": 82.0,
      "drill_mm": 7.2,
      "pad_mm": 9.6,
      "keepout_mm": 11.0,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 9.6 mm)",
      "mpn": "RD901F-40-15R1-A1M",
      "manufacturer": "Alpha (Tayda A-1672)",
      "notes": "Fail-safe release rheostat (.1=R20.2, .2+.3=NET_ENV_CAP)",
      "max_knob_mm": 14.0
    },
    {
      "ref": "RV4",
      "kind": "pot",
      "label": "OFFSET",
      "value": "B10K",
      "local_x": 15.0,
      "local_y": 67.75,
      "global_x": 115.0,
      "global_y": 97.5,
      "drill_mm": 7.2,
      "pad_mm": 9.6,
      "keepout_mm": 11.0,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 9.6 mm)",
      "mpn": "RD901F-40-15R1-B10K-0CD",
      "manufacturer": "Alpha (Tayda A-8401)",
      "notes": "Center-detent linear offset divider (.1=-V_off, .2=wiper, .3=+V_off)",
      "max_knob_mm": 14.0
    },
    {
      "ref": "SW1",
      "kind": "switch_submini",
      "label": "SMOOTH",
      "value": "SMOOTH",
      "local_x": 7.0,
      "local_y": 82.25,
      "global_x": 107.0,
      "global_y": 112.0,
      "drill_mm": 5.2,
      "pad_mm": 7.2,
      "keepout_mm": 8.2,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 7.2 mm)",
      "mpn": "2MS1T1B1M2QES",
      "manufacturer": "Dailywell (Tayda A-6087)",
      "notes": "SPDT (2=common, 3=SMOOTH active, 1=NC); lever UP = SMOOTH",
      "max_knob_mm": null
    },
    {
      "ref": "LED1",
      "kind": "led_3mm",
      "label": "OUT",
      "value": "A-1076",
      "local_x": 15.0,
      "local_y": 82.25,
      "global_x": 115.0,
      "global_y": 112.0,
      "drill_mm": 3.2,
      "pad_mm": 3.2,
      "keepout_mm": 4.0,
      "grounded": false,
      "hole_type": "NPTH",
      "front_mask": "Open `*.Mask` (3.2 mm)",
      "mpn": "A-1076",
      "manufacturer": "Tayda",
      "notes": "3mm 2-pin anti-parallel R/G LED; bench-check +V=Green (LED1.1=G anode)",
      "max_knob_mm": null
    },
    {
      "ref": "SW2",
      "kind": "switch_submini",
      "label": "FAST/SLOW",
      "value": "FAST/SLOW",
      "local_x": 23.0,
      "local_y": 82.25,
      "global_x": 123.0,
      "global_y": 112.0,
      "drill_mm": 5.2,
      "pad_mm": 7.2,
      "keepout_mm": 8.2,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 7.2 mm)",
      "mpn": "2MS1T1B1M2QES",
      "manufacturer": "Dailywell (Tayda A-6087)",
      "notes": "SPDT (2=common, 3=SLOW active, 1=NC); lever UP = SLOW (4.87 uF)",
      "max_knob_mm": null
    },
    {
      "ref": "J1",
      "kind": "jack",
      "label": "IN",
      "value": "IN",
      "local_x": 8.0,
      "local_y": 95.75,
      "global_x": 108.0,
      "global_y": 125.5,
      "drill_mm": 6.2,
      "pad_mm": 8.6,
      "keepout_mm": 9.5,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 8.6 mm)",
      "mpn": "WQP-PJ398SM",
      "manufacturer": "QingPu",
      "notes": "Switched 3.5mm Thonkiconn input normaled to GND",
      "max_knob_mm": null
    },
    {
      "ref": "J2",
      "kind": "jack",
      "label": "SLEW IN",
      "value": "SLEW IN",
      "local_x": 22.0,
      "local_y": 95.75,
      "global_x": 122.0,
      "global_y": 125.5,
      "drill_mm": 6.2,
      "pad_mm": 8.6,
      "keepout_mm": 9.5,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 8.6 mm)",
      "mpn": "WQP-PJ398SM",
      "manufacturer": "QingPu",
      "notes": "Normaled to FWR out; patched = DC-coupled bipolar skew limiter",
      "max_knob_mm": null
    },
    {
      "ref": "J3",
      "kind": "jack",
      "label": "OUT",
      "value": "OUT",
      "local_x": 8.0,
      "local_y": 110.75,
      "global_x": 108.0,
      "global_y": 140.5,
      "drill_mm": 6.2,
      "pad_mm": 8.6,
      "keepout_mm": 9.5,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 8.6 mm)",
      "mpn": "WQP-PJ398SM",
      "manufacturer": "QingPu",
      "notes": "Non-inverted +(V_env + V_off) output jack",
      "max_knob_mm": null
    },
    {
      "ref": "J4",
      "kind": "jack",
      "label": "INV OUT",
      "value": "INV_OUT",
      "local_x": 22.0,
      "local_y": 110.75,
      "global_x": 122.0,
      "global_y": 140.5,
      "drill_mm": 6.2,
      "pad_mm": 8.6,
      "keepout_mm": 9.5,
      "grounded": true,
      "hole_type": "PTH GND",
      "front_mask": "Tented (`B.Mask` 8.6 mm)",
      "mpn": "WQP-PJ398SM",
      "manufacturer": "QingPu",
      "notes": "Inverted -(V_env + V_off) sidechain output jack",
      "max_knob_mm": null
    }
  ],
  "spacing": {
    "groups": {
      "jack": {
        "count": 4,
        "x_positions_mm": [
          8.0,
          22.0
        ],
        "y_positions_mm": [
          95.75,
          110.75
        ],
        "horizontal_pitches_mm": [
          14.0
        ],
        "vertical_pitches_mm": [
          15.0
        ]
      },
      "led_3mm": {
        "count": 1,
        "x_positions_mm": [
          15.0
        ],
        "y_positions_mm": [
          82.25
        ],
        "horizontal_pitches_mm": [],
        "vertical_pitches_mm": []
      },
      "pot": {
        "count": 4,
        "x_positions_mm": [
          15.0
        ],
        "y_positions_mm": [
          21.25,
          36.75,
          52.25,
          67.75
        ],
        "horizontal_pitches_mm": [],
        "vertical_pitches_mm": [
          15.5
        ],
        "shaft_sweep_deg": 300.0,
        "shaft_sweep_note": "Standard Alpha 9mm pot sweep is 300 deg (+/-150 deg around 12 o'clock).",
        "max_knob_diameter_mm": 14.0
      },
      "switch_submini": {
        "count": 2,
        "x_positions_mm": [
          7.0,
          23.0
        ],
        "y_positions_mm": [
          82.25
        ],
        "horizontal_pitches_mm": [
          16.0
        ],
        "vertical_pitches_mm": []
      }
    },
    "rows": [
      {
        "row": 1,
        "local_y_mm": 21.25,
        "refs": [
          "RV1"
        ],
        "x_positions_mm": [
          15.0
        ],
        "left_margin_mm": 15.0,
        "right_margin_mm": 15.0,
        "horizontal_pitches_mm": [],
        "vertical_pitch_to_next_mm": 15.5
      },
      {
        "row": 2,
        "local_y_mm": 36.75,
        "refs": [
          "RV2"
        ],
        "x_positions_mm": [
          15.0
        ],
        "left_margin_mm": 15.0,
        "right_margin_mm": 15.0,
        "horizontal_pitches_mm": [],
        "vertical_pitch_to_next_mm": 15.5
      },
      {
        "row": 3,
        "local_y_mm": 52.25,
        "refs": [
          "RV3"
        ],
        "x_positions_mm": [
          15.0
        ],
        "left_margin_mm": 15.0,
        "right_margin_mm": 15.0,
        "horizontal_pitches_mm": [],
        "vertical_pitch_to_next_mm": 15.5
      },
      {
        "row": 4,
        "local_y_mm": 67.75,
        "refs": [
          "RV4"
        ],
        "x_positions_mm": [
          15.0
        ],
        "left_margin_mm": 15.0,
        "right_margin_mm": 15.0,
        "horizontal_pitches_mm": [],
        "vertical_pitch_to_next_mm": 14.5
      },
      {
        "row": 5,
        "local_y_mm": 82.25,
        "refs": [
          "SW1",
          "LED1",
          "SW2"
        ],
        "x_positions_mm": [
          7.0,
          15.0,
          23.0
        ],
        "left_margin_mm": 7.0,
        "right_margin_mm": 7.0,
        "horizontal_pitches_mm": [
          8.0,
          8.0
        ],
        "vertical_pitch_to_next_mm": 13.5
      },
      {
        "row": 6,
        "local_y_mm": 95.75,
        "refs": [
          "J1",
          "J2"
        ],
        "x_positions_mm": [
          8.0,
          22.0
        ],
        "left_margin_mm": 8.0,
        "right_margin_mm": 8.0,
        "horizontal_pitches_mm": [
          14.0
        ],
        "vertical_pitch_to_next_mm": 15.0
      },
      {
        "row": 7,
        "local_y_mm": 110.75,
        "refs": [
          "J3",
          "J4"
        ],
        "x_positions_mm": [
          8.0,
          22.0
        ],
        "left_margin_mm": 8.0,
        "right_margin_mm": 8.0,
        "horizontal_pitches_mm": [
          14.0
        ],
        "vertical_pitch_to_next_mm": null
      }
    ],
    "side_clearance_from_center_mm": 15.0
  },
  "fabrication_rules": {
    "target_layers": [
      "F.SilkS",
      "F.Mask"
    ],
    "min_silk_stroke_mm": 0.15,
    "min_silk_text_height_mm": 0.8,
    "min_mask_opening_mm": 0.2,
    "min_silk_to_mask_clearance_mm": 0.2,
    "copper_edge_pullback_mm": 0.6,
    "paths_only_svg": true,
    "registration_frame_mm": [
      0.0,
      0.0,
      30.0,
      128.5
    ]
  },
  "back_silkscreen": [
    {
      "kind": "qr_placeholder",
      "size_mm": [
        5.0,
        5.0
      ],
      "local_center": [
        22.5,
        121.0
      ],
      "global_center": [
        122.5,
        150.75
      ],
      "local_bounds_mm": {
        "x0": 20.0,
        "y0": 118.5,
        "x1": 25.0,
        "y1": 123.5
      },
      "clearance_mm": 2.725
    },
    {
      "kind": "title_version",
      "local_center": [
        15.0,
        10.5
      ],
      "global_center": [
        115.0,
        40.25
      ],
      "box_size_mm": [
        16.4,
        5.71
      ],
      "rot_deg": 0.0,
      "clearance_mm": 2.395,
      "entries": [
        {
          "id": "title_version_0",
          "text": "ENVELOPE FOLLOWER",
          "local_x": 15.0,
          "local_y": 8.65,
          "global_x": 115.0,
          "global_y": 38.4,
          "rot": 0.0,
          "font_size_mm": 1.0,
          "thickness_mm": 0.16
        },
        {
          "id": "title_version_1",
          "text": "+ SKEW LIMITER",
          "local_x": 15.0,
          "local_y": 10.5,
          "global_x": 115.0,
          "global_y": 40.25,
          "rot": 0.0,
          "font_size_mm": 1.0,
          "thickness_mm": 0.16
        },
        {
          "id": "title_version_2",
          "text": "6HP  Rev 1.0",
          "local_x": 15.0,
          "local_y": 12.35,
          "global_x": 115.0,
          "global_y": 42.1,
          "rot": 0.0,
          "font_size_mm": 0.9,
          "thickness_mm": 0.16
        }
      ]
    },
    {
      "kind": "url",
      "local_center": [
        24.606,
        39.471
      ],
      "global_center": [
        124.606,
        69.221
      ],
      "box_size_mm": [
        1.8125,
        44.542
      ],
      "rot_deg": 90.0,
      "clearance_mm": 3.2498,
      "entries": [
        {
          "id": "url_0",
          "text": "github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter",
          "local_x": 24.606,
          "local_y": 39.471,
          "global_x": 124.606,
          "global_y": 69.221,
          "rot": 90.0,
          "font_size_mm": 0.85,
          "thickness_mm": 0.15
        }
      ]
    }
  ]
}
```
