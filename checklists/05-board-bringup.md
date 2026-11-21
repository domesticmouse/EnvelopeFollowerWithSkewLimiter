# Board Bringup & Verification Checklist

Use this checklist to safely power up, verify, and test your assembled **6 HP Envelope Follower with Skew Limiter** before installing it into a Eurorack case.

---

## Test Point Reference (`12` `B.Cu` Test Points)

| RefDes | Silkscreen Label | Net | Board Location (`board X, Y` mm) | Expected Idle / Function |
| :--- | :--- | :--- | :--- | :--- |
| **`TP1`** | `GND` | `GND` | `(15.00, 105.60)` bottom-center | Lower scope ground clip |
| **`TP2`** | `+12V` | `+12V` | `(16.70, 2.25)` top edge (`J_PWR` side) | Filtered `+11.54 V` rail (post-`D1`/`R1`) |
| **`TP3`** | `-12V` | `-12V` | `(11.20, 2.25)` top edge (center-left) | Filtered `-11.54 V` rail (post-`D2`/`R2`) |
| **`TP4`** | `PRE` | `NET_PREAMP_OUT` | `(3.20, 20.00)` edge column | `U1A.1` `×2.00` preamp (`±10.0 V` headroom) |
| **`TP9`** | `HWR` | `NET_RECT_HALF` | `(3.20, 26.50)` edge column | `U1B` / `D3.1` half-wave rectifier check |
| **`TP5`** | `RECT` | `NET_RECT_OUT` | `(3.20, 33.00)` edge column | `U1C.8` FWR (`1.000× |V_pre|`) |
| **`TP10`** | `DRV` | `NET_U1D_OUT` | `(3.20, 39.50)` edge column | `U1D.14` skew driver swing & stability |
| **`TP6`** | `ENV` | `NET_ENV_BUF` | `(3.20, 46.00)` edge column | `U2A.1` buffered `V_env` (zero cap loading) |
| **`TP11`** | `OFF` | `NET_OFF_WIPER` | `(3.20, 52.50)` edge column | `RV4.2` `±4.98 V` offset & center detent |
| **`TP7`** | `INV` | `NET_INV_AMP` | `(3.20, 59.00)` edge column | `U2B.7` `-(V_env + V_off)` (`SMOOTH` check) |
| **`TP8`** | `OUT` | `NET_OUT_AMP` | `(3.20, 65.00)` edge column | `U2C.8` `+(V_env + V_off)` & `U2D` input |
| **`TP12`** | `GND2` | `GND` | `(3.20, 2.50)` top corner | Upper scope ground clip |

---

## Bench Equipment & Initial Control State

- [ ] **Bench PSU ready:** Dual tracking `±12 V` bench supply with **current limit set to `40–50 mA` per rail** *(or a current-limited Eurorack test supply — do NOT power up first time on an unlimited 2 A case supply)*
- [ ] **Instruments ready:** True-RMS DMM, 2-channel oscilloscope (`10×` probes), function/Eurorack signal generator (`10 Vpp` / `±5 V` sine + `0–5 V` / `±5 V` square/gate LFO), `3.5 mm` patch cables
- [ ] **Set initial panel controls (all jacks UNPATCHED):**
  - `RV1 (GAIN)`: **Full CCW** (`0%`)
  - `RV2 (ATK)`: **Full CCW** (min attack)
  - `RV3 (REL)`: **Full CCW** (min release)
  - `RV4 (OFFSET)`: **Center detent** (`12 o'clock`)
  - `SW1 (SMOOTH)`: **DOWN** (`OFF`)
  - `SW2 (FAST/SLOW)`: **DOWN** (`FAST`)

---

## Phase 1 — Unpowered Cold Checks (Power OFF)

- [ ] **Final visual polarity check:**
  - `J_PWR` keying notch faces board center; `-12V` Pins `1–2` at bottom (`-12V` bar on `F.SilkS`).
  - `C1` `+` at inner/right square pad (`+12V`); `C2` `+` at outer/left square pad (`GND`).
  - `D1` & `D2` cathode bands face **left**; `U1` Pin 1 bottom-right; `U2` Pin 1 top-left (`B.Cu` direct view).
- [ ] **Power-rail resistance check (DMM Ohms, after caps settle):**
  - `TP2 (+12V)` to `TP1 (GND)`: **`> 10 kΩ`** (no dead short).
  - `TP3 (-12V)` to `TP1 (GND)`: **`> 10 kΩ`** (no dead short).
  - `TP2 (+12V)` to `TP3 (-12V)`: **`~22 kΩ`** steady state (via `R26+R27+RV4+R29+R28` `OFFSET` string; not `0 Ω`).
- [ ] **Ground continuity check:** Verify `< 0.5 Ω` between `J_PWR` Pins `3–8`, `TP1 (GND)`, `TP12 (GND2)`, and the sleeves of `J1`–`J4`.
- [ ] **Schottky reverse-polarity diode check (DMM Diode mode):**
  - Red probe on `J_PWR` Pin `9/10` (`+12V in`), Black probe on `TP2 (+12V)`: reads **`~0.18–0.35 V`** (`OL` when probes reversed).
  - Red probe on `TP3 (-12V)`, Black probe on `J_PWR` Pin `1/2` (`-12V in`): reads **`~0.18–0.35 V`** (`OL` when probes reversed).

---

## Phase 2 — First Power-Up (Smoke Test & Supply Rails)

- [ ] **Connect `10-pin` power ribbon cable** — confirm **RED STRIPE (`-12V`) is at the BOTTOM** of `J_PWR` (`Pins 1–2`, matching `F.SilkS` `-12V` bar and `B.SilkS` Pin-1 triangle).
- [ ] **Enable `±12 V` bench supply (`40–50 mA` current limit):**
  - **Idle draw check:** `+12V` reads **`~8–11 mA`** and `-12V` reads **`~8–11 mA`** *(expected ~8.5 mA typ with `LED1` dark)*.
  - **ABORT IMMEDIATELY** if either rail exceeds `20 mA`, hits current limit, or drops below `11 V`!
- [ ] **Thermal finger check (10–15 seconds):** Confirm `U1`, `U2`, `D1`, `D2`, `R1`, `R2`, `C1`, and `C2` remain completely cool at room temperature.
- [ ] **Verify internal filtered power rails (DMM DC Volts vs `TP1`/`TP12` GND):**
  - `TP2 (+12V)`: **`+11.40 V` to `+11.80 V`** *(~`+11.6–11.7 V` idle; `~+11.54 V` at peak load)*
  - `TP3 (-12V)`: **`-11.40 V` to `-11.80 V`** *(~`-11.6–11.7 V` idle; `~-11.54 V` at peak load)*

---

## Phase 3 — Quiescent DC Bias, `OFFSET` & `LED1` Verification (No Input)

- [ ] **Center-detent baseline check (`RV4` at center detent, `RV1` CCW, no cables patched):**
  - `TP4 (PRE)`: `0.00 V ± 10 mV`
  - `TP9 (HWR)`: `0.00 V ± 15 mV`
  - `TP5 (RECT)`: `0.00 V ± 15 mV`
  - `TP6 (ENV)`: `0.00 V ± 15 mV`
  - `TP10 (DRV)`: steady within `±0.7 V` on oscilloscope — **confirm ZERO high-frequency oscillation** (`10 kHz–5 MHz`)
  - `TP11 (OFF)`: `0.00 V ± 120 mV` (pot center-detent tolerance)
  - `TP7 (INV)`, `TP8 (OUT)`, `J3 (OUT)`, `J4 (INV_OUT)`: `0.00 V ± 150 mV`
  - **`LED1`:** Completely **DARK** (off)
- [ ] **Full CW `RV4 (OFFSET)` check:**
  - `TP11 (OFF)` = **`+4.75 V` to `+5.15 V`** *(nominal `+4.98 V`)*
  - `TP8 (OUT)` and `J3 (OUT)` = **`+4.75 V` to `+5.15 V`** *(positive!)*
  - `TP7 (INV)` and `J4 (INV_OUT)` = **`-4.75 V` to `-5.15 V`** *(inverted!)*
  - **`LED1`:** Glows solid **GREEN** *(if Red, `LED1` leads are swapped — desolder and flip `LED1` before proceeding)*
- [ ] **Full CCW `RV4 (OFFSET)` check:**
  - `TP11 (OFF)` = **`-4.75 V` to `-5.15 V`** *(nominal `-4.98 V`)*
  - `TP8 (OUT)` and `J3 (OUT)` = **`-4.75 V` to `-5.15 V`**
  - `TP7 (INV)` and `J4 (INV_OUT)` = **`+4.75 V` to `+5.15 V`**
  - **`LED1`:** Glows solid **RED**
- [ ] **Return `RV4 (OFFSET)` to center detent** (`LED1` returns to dark).

---

## Phase 4 — Audio Signal Path Verification (`100–200 Hz`, `10 Vpp` / `±5 V` Sine into `J1 IN`)

Patch a **`100 Hz` or `200 Hz`, `10 Vpp` (`±5 V`) sine wave** into **`J1 (IN)`**; clip scope ground to `TP1`/`TP12`:

- [ ] **Preamp (`TP4 PRE`):**
  - Sweep `RV1 (GAIN)` from CCW to full CW: amplitude scales smoothly from `0 Vpp` to **`20.0 Vpp` (`±10.0 V`)** with **zero clipping** (`×2.00` gain).
  - Dial `RV1 (GAIN)` back to **`10.0 Vpp` (`±5.0 V`)** at `TP4` for the remaining checks below.
- [ ] **Half-Wave Rectifier (`TP9 HWR`):**
  - Scope shows a clean negative half-wave rectified waveform (`0 V` to `-5.0 V`) with crisp zero transitions.
- [ ] **Full-Wave Rectifier (`TP5 RECT`):**
  - Scope shows a clean **positive full-wave rectified waveform (`0 V` to `+5.0 V` at `2f`)** with adjacent lobes equal in peak height within `~1%` (`10 kΩ ±0.1%` balance).
- [ ] **Envelope Skew Limiter (`TP6 ENV` & `TP10 DRV`):**
  - With `RV2 (ATK)` & `RV3 (REL)` CCW (`FAST` mode): `TP6 (ENV)` closely tracks the `+5.0 V` rectified lobes with **no `0.65 V` diode dead-zone gap**.
  - Turn **`RV3 (REL)`** up toward noon/CW: envelope decay lengthens smoothly while rise stays snappy.
  - Turn **`RV2 (ATK)`** up while `RV3` is CCW: rise time slows down **independently** with **zero divider voltage collapse** when approaching a steady envelope.
  - Check **`TP10 (DRV)`** on scope while varying `RV2`/`RV3`: clean slew transitions, **zero HF oscillation**. Return `RV2` & `RV3` CCW.
- [ ] **`FAST / SLOW` Toggle (`SW2`):**
  - Flip **`SW2` UP (`SLOW`)**: envelope smoothing visibly jumps by `~10.4×` (`470 nF` → `4.87 µF`). Flip `SW2` back DOWN (`FAST`).
- [ ] **`SMOOTH` Toggle (`SW1`):**
  - Set `RV2` CCW and `RV3` around `9–10 o'clock` so `2f` ripple is visible on `TP7`/`TP8`.
  - Flip **`SW1` UP (`SMOOTH`)**: `100–200 Hz` ripple drops sharply (`-11.1 dB @ 100 Hz`) while **DC peak level changes `0.00%`**. Flip `SW1` back DOWN.
- [ ] **Outputs & `OFFSET` Isolation (`J3 OUT`, `J4 INV_OUT`, `TP7`, `TP8`):**
  - `J3 (OUT)` matches `TP8` and `J4 (INV_OUT)` is the exact inverse mirror (`V_OUT = -V_INV_OUT`).
  - Sweep `RV4 (OFFSET)` across full travel while watching `J3 (OUT)` peak-to-peak height: the DC baseline shifts `±4.98 V` with **`0.00%` amplitude modulation**! Return `RV4` to center detent.

---

## Phase 5 — `SLEW IN` (`J2`) Normaling & Bipolar Timing Verification

- [ ] **Patch a `0 → +5 V` (and/or `±5 V`) square/gate LFO (`~0.5–5 Hz`) into `J2 (SLEW IN)`:**
  - Leave the `100 Hz` sine patched into `J1 (IN)` and verify `J1` audio disappears from `TP6` / `J3` (**normal switch broken cleanly**).
- [ ] **Verify bipolar DC-coupled slewing (`±5 V` square input):**
  - `TP6 (ENV)` and `J3 (OUT)` slew symmetrically from `-5 V` to `+5 V` and back; `J4 (INV_OUT)` outputs the exact inverted ramp (`LED1` alternates Red ↔ Green cleanly).
- [ ] **Spot-check `0 → +5 V` rise / `+5 → 0 V` fall times (`0 → +5 V` gate input):**
  - `SW2` DOWN (`FAST`), `RV2`/`RV3` CCW: crisp step (`~0.29 ms` rise / `~0.18 ms` fall).
  - `SW2` DOWN (`FAST`), `RV2`/`RV3` CW: `~289 ms` rise / `~178 ms` fall.
  - `SW2` UP (`SLOW`), `RV2`/`RV3` CCW: `~3.0 ms` rise / `~1.8 ms` fall.
  - `SW2` UP (`SLOW`), `RV2`/`RV3` CW: **`~3.0 s` rise / `~1.84 s` fall** *(confirm `C12`/`C13` hold voltage cleanly without fast droop — if droop is excessive, re-clean `NET_ENV_CAP` / `NET_SLOW_CAPS` flux!)*.
- [ ] **Unpatch `J2 (SLEW IN)`:** Confirm `J1` envelope follower resumes immediately (normal contact re-closes).

---

## Phase 6 — Musical Workflow Check & Final Sign-Off

- [ ] **Techno kick-ducking test:**
  - Set `RV4 (OFFSET)` full **CCW** (`-5 V`, `LED1` steady **RED**, `INV_OUT = +5 V`), `SW1 (SMOOTH)` **UP**, `SW2` **DOWN (`FAST`)**, `RV2` near **CCW**, `RV3` around **`10–11 o'clock`**.
  - Feed a kick drum into `J1 (IN)` and bring up `RV1 (GAIN)` until each kick dips `LED1` cleanly down to **dark (`0 V`)** without flashing Green (`INV_OUT` ducks from `+5 V` to `0 V`).
- [ ] **Ambient swell test:**
  - Set `RV4` center, `SW2` **UP (`SLOW`)**, `RV2` & `RV3` past noon → verify smooth multi-second Green swells on `OUT`.
- [ ] **Peak supply current check:** Confirm total rail draw stays within **`~13–18 mA` (`+12V`)** and **`~9–13 mA` (`-12V`)** at full signal + `LED1` load.
- [ ] **Install knobs:** Set `RV4 (OFFSET)` to center detent with its pointer straight **UP (`12 o'clock`)**, align `RV1`–`RV3` pointers identically at CCW/CW stops, tighten set screws/push-fit knobs, verify `<= 14 mm` skirt clearance, and mount module in case.

---

## Troubleshooting Quick Reference

| Symptom | Most Likely Cause | Where to Check |
| :--- | :--- | :--- |
| Dead rail (`0 V` at `TP2` or `TP3`) or excessive current on power-up | `D1`/`D2` reversed, `C2` installed backward, or `J_PWR` rotated | Power OFF immediately; inspect `D1`/`D2` cathode bands (both face LEFT in `B.Cu` view), `C2` (`+` to `GND`), `J_PWR` notch |
| `LED1` lights **RED** when `OFFSET` is CW (`+5 V` at `J3`) | `LED1` inserted backward | Desolder `LED1` and rotate `180°` (`+V = Green` anode in Pad 1 left square pad) |
| Half-wave or asymmetric lobes at `TP5 (RECT)` | `D3 (BAT54S)` rotated or wrong pinout | Verify `D3` has 2 pins right / 1 pin left in `B.Cu` view and `TP9` shows clean negative half-waves |
| Large `~0.6 V` dead-zone or slow bleed droop in `SLOW` mode | `D4`/`D5` reversed, Schottky substituted for `1N4148W`, or flux on `NET_ENV_CAP` | Check `D4` cathode RIGHT / `D5` cathode LEFT; confirm `1N4148W` silicon; clean `RV2`, `RV3`, `C11`–`C13`, `SW2`, `U2.3` with `99%` IPA |
| `SW1` or `SW2` works opposite to lever UP = ON | Switch rotated or wrong pins soldered | Confirm Pin 2 (center) connects to Pin 3 (bottom pad) when toggle lever is UP |
| No audio in Envelope Follower mode when `J2` is unpatched | `J2` tip-normal switch (`TN`) open/bent or `R15`/`R17` cold joint | Probe `TP5 (RECT)` then `J2.TN` → `J2.T` → `U1.12` |
