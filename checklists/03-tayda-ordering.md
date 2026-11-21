# Tayda Electronics Ordering Checklist (Through-Hole & Panel Hardware)

Use this checklist to order all **`18` populated through-hole / panel parts** per board plus mechanical accessories. Multiply line-item quantities by your target build count and add spares before checking out.

> **Sourcing Note:** Exact Tayda SKUs verified in [`../DesignSpec.md`](../DesignSpec.md) and [`../envelope_follower.py`](../envelope_follower.py) are listed directly below. For components whose Tayda SKU varies by stock or vendor batch (`C7`/`C11`, `C12`/`C13`, `J1`–`J4`, `J_PWR`, knobs, screws), verify physical footprint dimensions against the listed constraints before adding to cart.

---

## 1. Per-Board Core Through-Hole BOM (`18` Parts / Board)

### Potentiometers (`4` per board)

- [ ] **`RV1` (`GAIN`, Qty `1`/board)** — **Tayda `A-1855`**
  - Alpha `9 mm` vertical PCB-mount potentiometer, **`A100K`** (audio/log taper), `RD901F-40-15R1-A100K`
- [ ] **`RV2`, `RV3` (`ATK`, `REL`, Qty `2`/board)** — **Tayda `A-1672`**
  - Alpha `9 mm` vertical PCB-mount potentiometer, **`A1M`** (audio/log taper), `RD901F-40-15R1-A1M`
- [ ] **`RV4` (`OFFSET`, Qty `1`/board)** — **Tayda `A-8401`**
  - Alpha `9 mm` vertical PCB-mount potentiometer, **`B10K` center-detent** (linear taper), `RD901F-40-15R1-B10K-0CD`

### Switches & LED (`3` per board)

- [ ] **`SW1`, `SW2` (`SMOOTH`, `FAST/SLOW`, Qty `2`/board)** — **Tayda `A-6087`**
  - Sub-miniature vertical PCB-mount **SPDT (`ON-ON`)** toggle switch, `2.54 mm` pin pitch (`Dailywell 2MS1T1B1M2QES`)
- [ ] **`LED1` (`OUT`, Qty `1`/board)** — **Tayda `A-1076`**
  - `3 mm` **2-pin anti-parallel Red/Green** bi-color LED *(do NOT substitute a 3-pin common-cathode/common-anode LED)*

### Through-Hole Capacitors (`6` per board)

- [ ] **`C1`, `C2` (`+12V` & `-12V` bulk rail caps, Qty `2`/board)** — **Tayda `A-7257`** *(alternate: **Tayda `A-6764`**)*
  - **`47 µF / 35 V`** radial electrolytic (`6.3 × 11 mm`, `2.50 mm` lead pitch; `A-6764` `5 × 11 mm` also fits cleanly)
- [ ] **`C7`, `C11` (`IN` AC coupling & `FAST` hold cap, Qty `2`/board)** — *Search Tayda by spec / verify SKU (or WIMA `MKS2` from Mouser/DigiKey/Thonk)*
  - **`470 nF (0.47 µF) / 63 V`** (`50 V+` min) polyester/polypropylene **`5.0 mm` pitch box film** (`WIMA MKS2 470nF 63V` or compact `5 mm` pitch film equivalent)
  - **Physical check:** Lead pitch **`5.0 mm`**, body max **`L 7.2 × W 4.5 mm`**, lead diameter fits `0.8 mm` drill *(do NOT substitute ceramic X7R or polarized electrolytic here)*
- [ ] **`C12`, `C13` (`SLOW` parallel hold caps, Qty `2`/board)** — *Search Tayda by spec / verify SKU (or WIMA `MKS2` from Mouser/DigiKey/Thonk)*
  - **`2.2 µF / 50 V`** (or `63 V`) **`5.0 mm` pitch box film** (`WIMA MKS2 2.2uF 50V` or compact `5 mm` pitch box film equivalent)
  - **Physical check:** Lead pitch **`5.0 mm`**, body max **`L 7.2 × W 7.2 mm`**, lead diameter fits `0.8 mm` drill *(keep low-leakage film dielectric for clean 3-second ambient swells; if Tayda lacks `2.2 µF` in `5.0 mm` pitch, order `WIMA MKS2 2.2uF 50V` from Mouser/DigiKey/Thonk)*

### Jacks & Power Header (`5` per board)

- [ ] **`J1`, `J2`, `J3`, `J4` (`IN`, `SLEW IN`, `OUT`, `INV_OUT`, Qty `4`/board)** — *Tayda or Thonk — verify `WQP-PJ398SM` SKU*
  - `3.5 mm` switched mono Eurorack jack, **QingPu `WQP-PJ398SM`** (Thonkiconn style, vertical PCB mount, `Tip` + `Tip-Normal Switch` + `Sleeve`)
  - **Hardware check:** Confirm mounting nuts (knurled or hex) are included with the jacks or add matching nuts separately
- [ ] **`J_PWR` (`EURORACK_PWR`, Qty `1`/board)** — *Search Tayda by spec / verify SKU*
  - Shrouded **`10-pin` (`2 × 5`) `2.54 mm` pitch vertical IDC box header**
  - **Orientation check:** Confirm **straight/vertical** PCB pins (NOT right-angle) with center keying slot

---

## 2. Mechanical & Panel Accessories (Not on Schematic BOM)

- [ ] **Knobs (Qty `4`/board)** — **CRITICAL DIAMETER & SHAFT CHECK:**
  - Adjacent pot shafts (`RV1`–`RV4`) sit on a **`15.50 mm` vertical center-to-center pitch** (`Y = 11.0, 26.5, 42.0, 57.5 mm`).
  - **Maximum outer skirt diameter MUST be `<= 14.0 mm`** (recommended **`12.0–13.5 mm`**, e.g., slim micro/Rogan-style or small Davies `1900H` clones) so adjacent knobs do not rub or crowd your fingers.
  - Confirm **shaft interface** (`T18` splined/knurled vs `6.35 mm` round/set-screw vs `D-shaft`) on the exact Tayda product pages for `A-1855`, `A-1672`, and `A-8401` before picking knobs!
- [ ] **Eurorack Power Cable (Qty `1`/board, if needed)** — `10-pin` to `16-pin` `2.54 mm` IDC ribbon power cable with red `-12V` stripe
- [ ] **Eurorack Mounting Hardware (Qty `2` sets/board)** — `M3` panel screws (`6–8 mm` length) + nylon washers (to avoid scratching the panel)
- [ ] **6 HP Front Panel (`30.0 × 128.5 mm`)** — Ensure your matching 6 HP faceplate is ordered/fabricated alongside the main PCB

---

## 3. Optional Bring-Up Test Points (Non-Tayda)

- [ ] **Optional `TP1`–`TP12` Test Loops (`12` per board)** — **Ronghe `RH-5001`** (`2.5 mm` black loop, **LCSC `C5199801`**, `1.0 mm` drill)
  - Not stocked as a standard Tayda item; you can omit these (probe the bare `1.0 mm` plated holes directly), solder clipped resistor-lead wire loops at `TP1` (`GND`) and `TP12` (`GND2`) only, or order `C5199801` from LCSC/DigiKey.

---

## 4. Pre-Checkout Sanity Checks

- [ ] **Quantities multiplied** by target number of boards (`×1`, `×2`, `×5`)
- [ ] **Spares added** (`+1–2` extra `LED1 A-1076`, `47 µF` electrolytics, `WQP-PJ398SM` jacks, `A-6087` toggles, and `M3` screws/nuts)
- [ ] **Pot tapers double-checked:** `1× A100K` (`A-1855`), `2× A1M` (`A-1672`), `1× B10K center-detent` (`A-8401`)
- [ ] **Film caps double-checked:** `5.0 mm` lead spacing on both `470 nF` (`C7`, `C11`) and `2.2 µF` (`C12`, `C13`), body widths fit `<= 4.5 mm` / `<= 7.2 mm`
- [ ] **`J_PWR` double-checked:** Vertical shrouded `2×5` (`10-pin`) `2.54 mm` box header (NOT right-angle, NOT unshrouded pin header)
- [ ] **Jack nuts double-checked:** `4×` matching nuts included per board
- [ ] **Knob clearance double-checked:** Outer skirt diameter `<= 14.0 mm` and shaft bore matches `A-1855`/`A-1672`/`A-8401`
