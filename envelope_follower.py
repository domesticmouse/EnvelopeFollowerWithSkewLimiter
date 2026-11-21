#!/usr/bin/env python3
"""
SKiDL circuit capture for the 6 HP Eurorack Envelope Follower with Skew Limiter.

Implements the finalized architecture from `DesignSpec.md`:
  - 2x TL074HIDR quad op-amps (8 / 8 sections utilized, 0 unused)
  - 50 JLCPCB SMD parts (3 Extended SKUs: TL074HIDR, BAT54S, 10k 0.1%)
  - 18 manual through-hole / panel components (Tayda / Thonkiconn / WIMA)
  - 12 DNP B.Cu test points (Ronghe RH-5001 / LCSC C5199801)
  - 48 active electrical nets across 80 footprints
"""

import builtins
import csv
import os
import pathlib
import re
import time
import xml.etree.ElementTree as ET

# Configure headless/sandbox-safe paths before importing SKiDL.
os.environ.setdefault("XDG_DATA_HOME", "/tmp/xdg_data")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/mpl_config")
if os.path.isdir("/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols"):
    os.environ.setdefault(
        "KICAD10_SYMBOL_DIR",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols",
    )
    os.environ.setdefault(
        "KICAD_SYMBOL_DIR",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols",
    )
if os.path.isdir("/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints"):
    os.environ.setdefault(
        "KICAD10_FOOTPRINT_DIR",
        "/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints",
    )

from skidl import (
    ERC,
    KICAD,
    POWER,
    TEMPLATE,
    Net,
    NetClass,
    Part,
    erc_assert,
    footprint_search_paths,
    generate_netlist,
    subcircuit,
)

footprint_search_paths[KICAD].append(
    str(pathlib.Path(__file__).resolve().parent / "footprints")
)

# ---------------------------------------------------------------------------
# Catalog & Footprint Constants
# ---------------------------------------------------------------------------
FP_SOIC14 = "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm"
FP_SOD123 = "Diode_SMD:D_SOD-123"
FP_SOT23 = "Package_TO_SOT_SMD:SOT-23"
FP_R0603 = "Resistor_SMD:R_0603_1608Metric"
FP_C0603 = "Capacitor_SMD:C_0603_1608Metric"
FP_C0805 = "Capacitor_SMD:C_0805_2012Metric"
FP_C1206 = "Capacitor_SMD:C_1206_3216Metric"
FP_ELEC_TH = "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm"
FP_BOX_45 = "Capacitor_THT:C_Rect_L7.2mm_W4.5mm_P5.00mm_FKS2_FKP2_MKS2_MKP2"
FP_BOX_72 = "Capacitor_THT:C_Rect_L7.2mm_W7.2mm_P5.00mm_FKS2_FKP2_MKS2_MKP2"
FP_POT = "Potentiometer_THT:Potentiometer_Alpha_RD901F-40-00D_Single_Vertical"
FP_TOGGLE = "Eurorack_Custom:SW_Toggle_SPDT_Dailywell_2MS1"
FP_LED3 = "LED_THT:LED_D3.0mm"
FP_JACK = "Connector_Audio:Jack_3.5mm_QingPu_WQP-PJ398SM_Vertical_CircularHoles"
FP_IDC10 = "Connector_IDC:IDC-Header_2x05_P2.54mm_Vertical"
FP_TP = "TestPoint:TestPoint_Keystone_5000-5004_Miniature"

RESISTOR_SPECS = {
    "10R": ("C22859", "0603WAF100JT5E", "UNI-ROYAL", "Basic", "1% 100mW"),
    "1M": ("C22935", "0603WAF1004T5E", "UNI-ROYAL", "Basic", "1% 100mW"),
    "10k 0.1%": (
        "C95204",
        "RT0603BRD0710KL",
        "YAGEO",
        "Extended",
        "Extended SKU 3/3; +/-0.1% +/-25ppm/C thin film",
    ),
    "1k": ("C21190", "0603WAF1001T5E", "UNI-ROYAL", "Basic", "1% 100mW"),
    "49.9k": (
        "C23184",
        "0603WAF4992T5E",
        "UNI-ROYAL",
        "Basic",
        "1% 100mW; split-Renv SMOOTH T-filter",
    ),
    "100k": ("C25803", "0603WAF1003T5E", "UNI-ROYAL", "Basic", "1% 100mW"),
    "5.1k": ("C23186", "0603WAF5101T5E", "UNI-ROYAL", "Basic", "1% 100mW"),
    "2.2k": (
        "C4190",
        "0603WAF2201T5E",
        "UNI-ROYAL",
        "Basic",
        "1% 100mW; 45mW max LED sense",
    ),
}

EXPECTED_NETS = {
    "NET_PWR_POS_RAW",
    "NET_PWR_NEG_RAW",
    "NET_POS_PROT",
    "NET_NEG_PROT",
    "+12V",
    "-12V",
    "GND",
    "NET_IN_JACK",
    "NET_IN_AC",
    "NET_GAIN_WIPER",
    "NET_U1A_POS",
    "NET_U1A_INV",
    "NET_U1A_CG",
    "NET_PREAMP_OUT",
    "NET_FF_MID",
    "NET_U1B_INV",
    "NET_U1B_OUT",
    "NET_RECT_HALF",
    "NET_RECT_SUM",
    "NET_FWR_FB_MID",
    "NET_RECT_OUT",
    "NET_SLEW_NORM",
    "NET_SLEW_JACK",
    "NET_U1D_POS",
    "NET_U1D_INV",
    "NET_U1D_OUT",
    "NET_ATK_DIODE",
    "NET_ATK_MIN",
    "NET_REL_DIODE",
    "NET_REL_MIN",
    "NET_ENV_CAP",
    "NET_SLOW_CAPS",
    "NET_ENV_BUF",
    "NET_SMOOTH_MID",
    "NET_SMOOTH_SW",
    "NET_OFF_POS_FILT",
    "NET_OFF_TOP",
    "NET_OFF_NEG_FILT",
    "NET_OFF_BOT",
    "NET_OFF_WIPER",
    "NET_U2B_INV",
    "NET_INV_AMP",
    "NET_INV_OUT_JACK",
    "NET_U2C_INV",
    "NET_OUT_AMP",
    "NET_OUT_JACK",
    "NET_LED_DRV",
    "NET_LED_SENSE",
}


# ---------------------------------------------------------------------------
# Helpers & Reusable Templates
# ---------------------------------------------------------------------------
def _set_fields(part, **fields):
    """Populate BOM/layout metadata inside `part.fields` for XML & netlist export."""
    for key, val in fields.items():
        if val is not None:
            part.fields[key] = str(val)
    return part


def _make_res(template, ref, value, notes=None):
    """Instantiate an 0603 SMD resistor with verified JLCPCB catalog fields."""
    lcsc, mpn, mfr, jlc_class, base_notes = RESISTOR_SPECS[value]
    part = template(ref=ref, value=value, tag=ref.lower())
    _set_fields(
        part,
        LCSC=lcsc,
        MPN=mpn,
        Manufacturer=mfr,
        JLCPCB_Class=jlc_class,
        Notes=notes or base_notes,
    )
    return part


def _make_part(
    template,
    ref,
    value,
    *,
    lcsc=None,
    mpn=None,
    mfr=None,
    jlc_class=None,
    silkscreen=None,
    notes=None,
    dnp=False,
    exclude_from_bom=False,
):
    """Instantiate a part from a template with deterministic tag, BOM fields, and flags."""
    part = template(ref=ref, value=value, tag=ref.lower())
    _set_fields(
        part,
        LCSC=lcsc,
        MPN=mpn,
        Manufacturer=mfr,
        JLCPCB_Class=jlc_class,
        Silkscreen=silkscreen,
        Notes=notes,
    )
    if dnp:
        part.dnp = True
    if exclude_from_bom:
        part.exclude_from_bom = True
    return part


def _part(ref):
    """Look up a circuit part by exact reference designator."""
    return next(p for p in builtins.default_circuit.parts if p.ref == ref)


def _natural_key(ref):
    """Sort key that orders R2 before R10 while preserving prefix grouping."""
    return [int(tok) if tok.isdigit() else tok for tok in re.split(r"(\d+)", ref)]


# ---------------------------------------------------------------------------
# Hierarchical Circuit Stages
# ---------------------------------------------------------------------------
@subcircuit
def power_supply(u1, u2, vpos, vneg, gnd, templates):
    """Shrouded 10-pin Eurorack power input, Schottky polarity protection & RC filtering."""
    net_pwr_pos_raw = Net("NET_PWR_POS_RAW")
    net_pwr_neg_raw = Net("NET_PWR_NEG_RAW")
    net_pos_prot = Net("NET_POS_PROT")
    net_neg_prot = Net("NET_NEG_PROT")

    j_pwr = _make_part(
        templates["idc10"],
        "J_PWR",
        "EURORACK_PWR",
        mpn="IDC 2x5P 2.54mm Shrouded",
        mfr="Tayda",
        jlc_class="Manual THT",
        silkscreen="PWR",
        notes="1-2=-12V, 3-8=GND, 9-10=+12V",
    )
    d1 = _make_part(
        templates["schottky"],
        "D1",
        "B5819W",
        lcsc="C8598",
        mpn="B5819W SL",
        mfr="CJ",
        jlc_class="Basic",
        notes="1=K, 2=A; compact alt: C191023 (SOD-323)",
    )
    d2 = _make_part(
        templates["schottky"],
        "D2",
        "B5819W",
        lcsc="C8598",
        mpn="B5819W SL",
        mfr="CJ",
        jlc_class="Basic",
        notes="1=K, 2=A; compact alt: C191023 (SOD-323)",
    )
    r1 = _make_res(templates["r0603"], "R1", "10R", "+12V rail RC filter resistor")
    r2 = _make_res(templates["r0603"], "R2", "10R", "-12V rail RC filter resistor")

    c1 = _make_part(
        templates["c_elec"],
        "C1",
        "47uF 35V",
        mpn="A-7257",
        mfr="Tayda",
        jlc_class="Manual THT",
        notes="6.3x11mm P2.5mm radial electrolytic (alt Tayda A-6764 5x11mm)",
    )
    c2 = _make_part(
        templates["c_elec"],
        "C2",
        "47uF 35V",
        mpn="A-7257",
        mfr="Tayda",
        jlc_class="Manual THT",
        notes="6.3x11mm P2.5mm radial electrolytic (alt Tayda A-6764 5x11mm); C2.+ to GND, C2.- to -12V",
    )

    c3, c4, c5, c6 = (
        _make_part(
            templates["c0603"],
            ref,
            "100nF",
            lcsc="C14663",
            mpn="CC0603KRX7R9BB104",
            mfr="YAGEO",
            jlc_class="Basic",
            notes="50V X7R +/-10% local decoupling",
        )
        for ref in ("C3", "C4", "C5", "C6")
    )

    net_pwr_pos_raw += j_pwr[9, 10], d1["A"]
    net_pwr_neg_raw += j_pwr[1, 2], d2["K"]
    net_pos_prot += d1["K"], r1[1]
    net_neg_prot += d2["A"], r2[1]

    vpos += r1[2], c1[1], c3[1], c5[1], u1[4], u2[4]
    vneg += r2[2], c2[2], c4[1], c6[1], u1[11], u2[11]
    gnd += (
        j_pwr[3, 4, 5, 6, 7, 8],
        c1[2],
        c2[1],
        c3[2],
        c4[2],
        c5[2],
        c6[2],
    )
    return net_pwr_pos_raw, net_pwr_neg_raw, net_pos_prot, net_neg_prot


@subcircuit
def input_preamp(u1, gnd, net_preamp_out, templates):
    """AC-coupled 10 Vpp Eurorack input attenuator and x2.00 preamp (U1A)."""
    net_in_jack = Net("NET_IN_JACK")
    net_in_ac = Net("NET_IN_AC")
    net_gain_wiper = Net("NET_GAIN_WIPER")
    net_u1a_pos = Net("NET_U1A_POS")
    net_u1a_inv = Net("NET_U1A_INV")
    net_u1a_cg = Net("NET_U1A_CG")

    j1 = _make_part(
        templates["jack"],
        "J1",
        "IN",
        mpn="WQP-PJ398SM",
        mfr="QingPu",
        jlc_class="Manual THT",
        silkscreen="IN",
        notes="Switched 3.5mm Thonkiconn input normaled to GND",
    )
    rv1 = _make_part(
        templates["pot"],
        "RV1",
        "A100K",
        mpn="RD901F-40-15R1-A100K",
        mfr="Alpha (Tayda A-1855)",
        jlc_class="Manual THT",
        silkscreen="GAIN",
        notes="Audio-taper input attenuator (.1 CCW=GND, .2 wiper, .3 CW=in)",
    )
    c7 = _make_part(
        templates["c_box45"],
        "C7",
        "470nF",
        mpn="WIMA MKS2 470nF 63V",
        mfr="WIMA",
        jlc_class="Manual THT",
        notes="5mm box film AC coupling (fc = 3.72 Hz)",
    )
    c8 = _make_part(
        templates["c0603"],
        "C8",
        "33pF",
        lcsc="C1663",
        mpn="CL10C330JB8NNNC",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V C0G +/-5% U1A feedback stabilization (482 kHz)",
    )
    c9 = _make_part(
        templates["c1206"],
        "C9",
        "10uF",
        lcsc="C13585",
        mpn="CL31A106KBHNNNE",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V X5R 1206 Basic (low DC-bias loss at +/-11.5V); compact 0805 Basic alt: C15850 (25V)",
    )

    r3 = _make_res(templates["r0603"], "R3", "1M", "J1 jack anti-pop bleed")
    r4 = _make_res(templates["r0603"], "R4", "10k 0.1%")
    r5 = _make_res(templates["r0603"], "R5", "1M", "U1A.+ wiper-lift safety")
    r6 = _make_res(templates["r0603"], "R6", "10k 0.1%")
    r7 = _make_res(templates["r0603"], "R7", "10k 0.1%")

    net_in_jack += j1["T"], r3[1], c7[1]
    net_in_ac += c7[2], rv1[3]
    net_gain_wiper += rv1[2], r4[1]
    net_u1a_pos += r4[2], r5[1], u1[3]
    net_u1a_inv += u1[2], r6[1], c8[1], r7[1]
    net_u1a_cg += r7[2], c9[1]
    net_preamp_out += u1[1], r6[2], c8[2]
    gnd += j1["S"], j1["TN"], r3[2], rv1[1], r5[2], c9[2]


@subcircuit
def precision_fwr(u1, gnd, net_preamp_out, net_rect_half, net_rect_out, templates):
    """Precision full-wave rectifier (U1B HWR + U1C unity summing amp, 10k 0.1%)."""
    net_ff_mid = Net("NET_FF_MID")
    net_u1b_inv = Net("NET_U1B_INV")
    net_u1b_out = Net("NET_U1B_OUT")
    net_rect_sum = Net("NET_RECT_SUM")
    net_fwr_fb_mid = Net("NET_FWR_FB_MID")

    d3 = _make_part(
        templates["bat54s"],
        "D3",
        "BAT54S",
        lcsc="C83935",
        mpn="BAT54S",
        mfr="ST(Semtech)",
        jlc_class="Extended",
        notes="Extended SKU 2/3; Pin1=A1, Pin2=K2, Pin3=K1/A2; alt: C181201",
    )
    r8, r9, r10, r11, r12, r13, r14 = (
        _make_res(templates["r0603"], ref, "10k 0.1%")
        for ref in ("R8", "R9", "R10", "R11", "R12", "R13", "R14")
    )

    net_preamp_out += r8[1], r11[1]
    net_ff_mid += r11[2], r12[1]
    net_u1b_inv += r8[2], u1[6], r9[1], d3[2]
    net_u1b_out += u1[7], d3[3]
    net_rect_half += d3[1], r9[2], r10[1]
    net_rect_sum += r10[2], r12[2], u1[9], r13[1]
    net_fwr_fb_mid += r13[2], r14[1]
    net_rect_out += u1[8], r14[2]
    gnd += u1[5], u1[10]


@subcircuit
def slew_input_and_limiter(
    u1, u2, gnd, net_rect_out, net_u1d_out, net_env_cap, net_env_buf, templates
):
    """Normaled SLEW IN jack (J2), active skew driver (U1D), and hold buffer (U2A)."""
    net_slew_norm = Net("NET_SLEW_NORM")
    net_slew_jack = Net("NET_SLEW_JACK")
    net_u1d_pos = Net("NET_U1D_POS")
    net_u1d_inv = Net("NET_U1D_INV")
    net_atk_diode = Net("NET_ATK_DIODE")
    net_atk_min = Net("NET_ATK_MIN")
    net_rel_diode = Net("NET_REL_DIODE")
    net_rel_min = Net("NET_REL_MIN")
    net_slow_caps = Net("NET_SLOW_CAPS")

    j2 = _make_part(
        templates["jack"],
        "J2",
        "SLEW IN",
        mpn="WQP-PJ398SM",
        mfr="QingPu",
        jlc_class="Manual THT",
        silkscreen="SLEW IN",
        notes="Normaled to FWR out; patched = DC-coupled bipolar skew limiter",
    )
    r15 = _make_res(templates["r0603"], "R15", "1k", "SLEW IN normal protection")
    r16 = _make_res(templates["r0603"], "R16", "1M", "J2 SLEW IN ground ref (1M)")
    r17 = _make_res(templates["r0603"], "R17", "10k 0.1%")
    r18 = _make_res(templates["r0603"], "R18", "10k 0.1%")
    r19 = _make_res(templates["r0603"], "R19", "1k", "R_atk_min linear-safe floor (1k)")
    r20 = _make_res(templates["r0603"], "R20", "1k", "R_rel_min linear-safe floor (1k)")

    c10 = _make_part(
        templates["c0805"],
        "C10",
        "2.2nF",
        lcsc="C28260",
        mpn="CL21C222JBFNNNE",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V C0G +/-5% U1D local loop compensation (fz = 7.23 kHz)",
    )
    d4 = _make_part(
        templates["si_diode"],
        "D4",
        "1N4148W",
        lcsc="C81598",
        mpn="1N4148W",
        mfr="ST(Semtech)",
        jlc_class="Basic",
        notes="1=K, 2=A; D_atk low-leakage silicon only (never Schottky)",
    )
    d5 = _make_part(
        templates["si_diode"],
        "D5",
        "1N4148W",
        lcsc="C81598",
        mpn="1N4148W",
        mfr="ST(Semtech)",
        jlc_class="Basic",
        notes="1=K, 2=A; D_rel low-leakage silicon only (never Schottky)",
    )
    rv2 = _make_part(
        templates["pot"],
        "RV2",
        "A1M",
        mpn="RD901F-40-15R1-A1M",
        mfr="Alpha (Tayda A-1672)",
        jlc_class="Manual THT",
        silkscreen="ATK",
        notes="Fail-safe attack rheostat (.1=R19.2, .2+.3=NET_ENV_CAP)",
    )
    rv3 = _make_part(
        templates["pot"],
        "RV3",
        "A1M",
        mpn="RD901F-40-15R1-A1M",
        mfr="Alpha (Tayda A-1672)",
        jlc_class="Manual THT",
        silkscreen="REL",
        notes="Fail-safe release rheostat (.1=R20.2, .2+.3=NET_ENV_CAP)",
    )
    c11 = _make_part(
        templates["c_box45"],
        "C11",
        "470nF",
        mpn="WIMA MKS2 470nF 63V",
        mfr="WIMA",
        jlc_class="Manual THT",
        notes="5mm box film permanent FAST hold cap",
    )
    c12 = _make_part(
        templates["c_box72"],
        "C12",
        "2.2uF",
        mpn="WIMA MKS2 2.2uF 50V",
        mfr="WIMA",
        jlc_class="Manual THT",
        notes="5mm box film SLOW parallel hold cap 1/2",
    )
    c13 = _make_part(
        templates["c_box72"],
        "C13",
        "2.2uF",
        mpn="WIMA MKS2 2.2uF 50V",
        mfr="WIMA",
        jlc_class="Manual THT",
        notes="5mm box film SLOW parallel hold cap 2/2",
    )
    sw2 = _make_part(
        templates["toggle"],
        "SW2",
        "FAST/SLOW",
        mpn="2MS1T1B1M2QES",
        mfr="Dailywell (Tayda A-6087)",
        jlc_class="Manual THT",
        silkscreen="FAST/SLOW",
        notes="SPDT (2=common, 3=SLOW active, 1=NC); lever UP = SLOW (4.87 uF)",
    )

    net_rect_out += r15[1]
    net_slew_norm += r15[2], j2["TN"]
    net_slew_jack += j2["T"], r16[1], r17[1]
    net_u1d_pos += r17[2], u1[12]
    net_u1d_inv += r18[2], c10[1], u1[13]
    net_u1d_out += u1[14], c10[2], d4["A"], d5["K"]
    net_atk_diode += d4["K"], r19[1]
    net_atk_min += r19[2], rv2[1]
    net_rel_diode += d5["A"], r20[1]
    net_rel_min += r20[2], rv3[1]
    net_env_cap += rv2[2], rv2[3], rv3[2], rv3[3], c11[1], sw2[2], u2[3]
    net_slow_caps += sw2[3], c12[1], c13[1]
    net_env_buf += u2[1], u2[2], r18[1]
    gnd += j2["S"], r16[2], c11[2], c12[2], c13[2]
    sw2[1] += builtins.NC
    return net_slow_caps


@subcircuit
def smooth_filter(gnd, net_env_buf, net_u2b_inv, templates):
    """Zero-gain-drop split-R_env SMOOTH T-filter (fc = 29.0 Hz, -11.1 dB @ 100 Hz)."""
    net_smooth_mid = Net("NET_SMOOTH_MID")
    net_smooth_sw = Net("NET_SMOOTH_SW")

    r21 = _make_res(templates["r0603"], "R21", "49.9k")
    r22 = _make_res(templates["r0603"], "R22", "49.9k")
    c14 = _make_part(
        templates["c0805"],
        "C14",
        "220nF",
        lcsc="C5378",
        mpn="CL21B224KBFNNNE",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V X7R +/-10% SMOOTH T-filter shunt cap",
    )
    sw1 = _make_part(
        templates["toggle"],
        "SW1",
        "SMOOTH",
        mpn="2MS1T1B1M2QES",
        mfr="Dailywell (Tayda A-6087)",
        jlc_class="Manual THT",
        silkscreen="SMOOTH",
        notes="SPDT (2=common, 3=SMOOTH active, 1=NC); lever UP = SMOOTH",
    )

    net_env_buf += r21[1]
    net_smooth_mid += r21[2], r22[1], sw1[2]
    net_smooth_sw += sw1[3], c14[1]
    net_u2b_inv += r22[2]
    gnd += c14[2]
    sw1[1] += builtins.NC


@subcircuit
def output_summer_and_offset(
    u2,
    vpos,
    vneg,
    gnd,
    net_u2b_inv,
    net_off_wiper,
    net_inv_amp,
    net_out_amp,
    templates,
):
    """RC-filtered +/-4.98 V OFFSET divider, virtual-ground summer (U2B) & inverter (U2C)."""
    net_off_pos_filt = Net("NET_OFF_POS_FILT")
    net_off_top = Net("NET_OFF_TOP")
    net_off_neg_filt = Net("NET_OFF_NEG_FILT")
    net_off_bot = Net("NET_OFF_BOT")
    net_inv_out_jack = Net("NET_INV_OUT_JACK")
    net_u2c_inv = Net("NET_U2C_INV")
    net_out_jack = Net("NET_OUT_JACK")

    r23 = _make_res(templates["r0603"], "R23", "100k", "U2B offset summing resistor")
    r24 = _make_res(
        templates["r0603"], "R24", "100k", "U2B virtual-ground feedback resistor"
    )
    r25 = _make_res(templates["r0603"], "R25", "1k", "INV_OUT output protection")
    r26 = _make_res(templates["r0603"], "R26", "1k", "+12V OFFSET RC filter input")
    r27 = _make_res(templates["r0603"], "R27", "5.1k", "+OFFSET range resistor")
    r28 = _make_res(templates["r0603"], "R28", "1k", "-12V OFFSET RC filter input")
    r29 = _make_res(templates["r0603"], "R29", "5.1k", "-OFFSET range resistor")
    r30 = _make_res(templates["r0603"], "R30", "10k 0.1%")
    r31 = _make_res(templates["r0603"], "R31", "10k 0.1%")
    r32 = _make_res(templates["r0603"], "R32", "1k", "OUT output protection")

    c15 = _make_part(
        templates["c1206"],
        "C15",
        "10uF",
        lcsc="C13585",
        mpn="CL31A106KBHNNNE",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V X5R 1206 Basic (low DC-bias loss at +/-11.5V); compact 0805 Basic alt: C15850 (25V)",
    )
    c16 = _make_part(
        templates["c1206"],
        "C16",
        "10uF",
        lcsc="C13585",
        mpn="CL31A106KBHNNNE",
        mfr="Samsung",
        jlc_class="Basic",
        notes="50V X5R 1206 Basic (low DC-bias loss at +/-11.5V); compact 0805 Basic alt: C15850 (25V)",
    )
    rv4 = _make_part(
        templates["pot"],
        "RV4",
        "B10K",
        mpn="RD901F-40-15R1-B10K-0CD",
        mfr="Alpha (Tayda A-8401)",
        jlc_class="Manual THT",
        silkscreen="OFFSET",
        notes="Center-detent linear offset divider (.1=-V_off, .2=wiper, .3=+V_off)",
    )
    j3 = _make_part(
        templates["jack"],
        "J3",
        "OUT",
        mpn="WQP-PJ398SM",
        mfr="QingPu",
        jlc_class="Manual THT",
        silkscreen="OUT",
        notes="Non-inverted +(V_env + V_off) output jack",
    )
    j4 = _make_part(
        templates["jack"],
        "J4",
        "INV_OUT",
        mpn="WQP-PJ398SM",
        mfr="QingPu",
        jlc_class="Manual THT",
        silkscreen="INV_OUT",
        notes="Inverted -(V_env + V_off) sidechain output jack",
    )

    vpos += r26[1]
    vneg += r28[1]
    net_off_pos_filt += r26[2], c15[1], r27[1]
    net_off_top += r27[2], rv4[3]
    net_off_neg_filt += r28[2], c16[1], r29[1]
    net_off_bot += r29[2], rv4[1]
    net_off_wiper += rv4[2], r23[1]
    net_u2b_inv += r23[2], r24[1], u2[6]
    net_inv_amp += u2[7], r24[2], r25[1], r30[1]
    net_inv_out_jack += r25[2], j4["T"]
    net_u2c_inv += r30[2], r31[1], u2[9]
    net_out_amp += u2[8], r31[2], r32[1]
    net_out_jack += r32[2], j3["T"]
    gnd += c15[2], c16[2], u2[5], j4["S"], u2[10], j3["S"]
    j3["TN"] += builtins.NC
    j4["TN"] += builtins.NC


@subcircuit
def led_driver(u2, gnd, net_out_amp, templates):
    """Post-offset active V-to-I bi-color LED driver (U2D + Tayda A-1076)."""
    net_led_drv = Net("NET_LED_DRV")
    net_led_sense = Net("NET_LED_SENSE")

    led1 = _make_part(
        templates["led"],
        "LED1",
        "A-1076",
        mpn="A-1076",
        mfr="Tayda",
        jlc_class="Manual THT",
        silkscreen="OUT",
        notes="3mm 2-pin anti-parallel R/G LED; bench-check +V=Green (LED1.1=G anode)",
    )
    r33 = _make_res(templates["r0603"], "R33", "2.2k")

    net_out_amp += u2[12]
    net_led_drv += u2[14], led1[1]
    net_led_sense += u2[13], led1[2], r33[1]
    gnd += r33[2]


@subcircuit
def test_points(tp_nets, templates):
    """12 DNP through-hole B.Cu test points (Ronghe RH-5001 / LCSC C5199801)."""
    for ref, label, net in tp_nets:
        tp = _make_part(
            templates["tp"],
            ref,
            label,
            lcsc="C5199801",
            mpn="RH-5001",
            mfr="Ronghe",
            jlc_class="DNP THT",
            silkscreen=label,
            notes="DNP B.Cu test point (1.0 mm drill / 2.0 mm pad)",
            dnp=True,
            exclude_from_bom=True,
        )
        net += tp[1]


# ---------------------------------------------------------------------------
# Top-Level Circuit Builder & Export Helpers
# ---------------------------------------------------------------------------
def build_circuit():
    """Construct the complete Envelope Follower with Skew Limiter circuit."""
    templates = {
        "opamp": Part(
            "Amplifier_Operational", "TL074", dest=TEMPLATE, footprint=FP_SOIC14
        ),
        "schottky": Part("Device", "D_Schottky", dest=TEMPLATE, footprint=FP_SOD123),
        "bat54s": Part("Diode", "BAT54S", dest=TEMPLATE, footprint=FP_SOT23),
        "si_diode": Part("Diode", "1N4148W", dest=TEMPLATE, footprint=FP_SOD123),
        "r0603": Part("Device", "R", dest=TEMPLATE, footprint=FP_R0603),
        "c0603": Part("Device", "C", dest=TEMPLATE, footprint=FP_C0603),
        "c0805": Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805),
        "c1206": Part("Device", "C", dest=TEMPLATE, footprint=FP_C1206),
        "c_elec": Part("Device", "C_Polarized", dest=TEMPLATE, footprint=FP_ELEC_TH),
        "c_box45": Part("Device", "C", dest=TEMPLATE, footprint=FP_BOX_45),
        "c_box72": Part("Device", "C", dest=TEMPLATE, footprint=FP_BOX_72),
        "pot": Part("Device", "R_Potentiometer", dest=TEMPLATE, footprint=FP_POT),
        "toggle": Part("Switch", "SW_SPDT", dest=TEMPLATE, footprint=FP_TOGGLE),
        "led": Part(
            "Device", "LED_Dual_Bidirectional", dest=TEMPLATE, footprint=FP_LED3
        ),
        "jack": Part(
            "Connector_Audio", "AudioJack2_SwitchT", dest=TEMPLATE, footprint=FP_JACK
        ),
        "idc10": Part(
            "Connector_Generic",
            "Conn_02x05_Odd_Even",
            dest=TEMPLATE,
            footprint=FP_IDC10,
        ),
        "tp": Part("Connector", "TestPoint", dest=TEMPLATE, footprint=FP_TP),
    }

    u1 = _make_part(
        templates["opamp"],
        "U1",
        "TL074HIDR",
        lcsc="C2878713",
        mpn="TL074HIDR",
        mfr="Texas Instruments",
        jlc_class="Extended",
        notes="Extended SKU 1/3; quad CMOS/FET-input op-amp",
    )
    u2 = _make_part(
        templates["opamp"],
        "U2",
        "TL074HIDR",
        lcsc="C2878713",
        mpn="TL074HIDR",
        mfr="Texas Instruments",
        jlc_class="Extended",
        notes="Extended SKU 1/3; quad CMOS/FET-input op-amp",
    )

    gnd = Net("GND")
    vpos = Net("+12V")
    vneg = Net("-12V")
    net_preamp_out = Net("NET_PREAMP_OUT")
    net_rect_half = Net("NET_RECT_HALF")
    net_rect_out = Net("NET_RECT_OUT")
    net_u1d_out = Net("NET_U1D_OUT")
    net_env_cap = Net("NET_ENV_CAP")
    net_env_buf = Net("NET_ENV_BUF")
    net_u2b_inv = Net("NET_U2B_INV")
    net_off_wiper = Net("NET_OFF_WIPER")
    net_inv_amp = Net("NET_INV_AMP")
    net_out_amp = Net("NET_OUT_AMP")

    net_pwr_pos_raw, net_pwr_neg_raw, net_pos_prot, net_neg_prot = power_supply(
        u1, u2, vpos, vneg, gnd, templates, tag="power_supply"
    )
    input_preamp(u1, gnd, net_preamp_out, templates, tag="input_preamp")
    precision_fwr(
        u1,
        gnd,
        net_preamp_out,
        net_rect_half,
        net_rect_out,
        templates,
        tag="precision_fwr",
    )
    net_slow_caps = slew_input_and_limiter(
        u1,
        u2,
        gnd,
        net_rect_out,
        net_u1d_out,
        net_env_cap,
        net_env_buf,
        templates,
        tag="slew_input_and_limiter",
    )
    smooth_filter(gnd, net_env_buf, net_u2b_inv, templates, tag="smooth_filter")
    output_summer_and_offset(
        u2,
        vpos,
        vneg,
        gnd,
        net_u2b_inv,
        net_off_wiper,
        net_inv_amp,
        net_out_amp,
        templates,
        tag="output_summer_and_offset",
    )
    led_driver(u2, gnd, net_out_amp, templates, tag="led_driver")

    tp_specs = [
        ("TP1", "GND", gnd),
        ("TP2", "+12V", vpos),
        ("TP3", "-12V", vneg),
        ("TP4", "PRE", net_preamp_out),
        ("TP5", "RECT", net_rect_out),
        ("TP6", "ENV", net_env_buf),
        ("TP7", "INV", net_inv_amp),
        ("TP8", "OUT", net_out_amp),
        ("TP9", "HWR", net_rect_half),
        ("TP10", "DRV", net_u1d_out),
        ("TP11", "OFF", net_off_wiper),
        ("TP12", "GND2", gnd),
    ]
    test_points(tp_specs, templates, tag="test_points")

    # Mark external power nets as driven for ERC.
    for pwr_net in (vpos, vneg, gnd, net_pwr_pos_raw, net_pwr_neg_raw):
        pwr_net.drive = POWER

    # Assign KiCad NetClasses for PCB routing rules.
    pwr_class = NetClass("Power", priority=1, trace_width=0.30, clearance=0.20)
    hiz_class = NetClass("HighImpedance", priority=2, trace_width=0.25, clearance=0.25)
    for net in (
        net_pwr_pos_raw,
        net_pwr_neg_raw,
        net_pos_prot,
        net_neg_prot,
        vpos,
        vneg,
        gnd,
    ):
        net.netclasses = pwr_class
    for net in (net_env_cap, net_slow_caps):
        net.netclasses = hiz_class

    # Structural & electrical sanity assertions evaluated during ERC.
    erc_assert(
        "len(builtins.default_circuit.parts) == 80",
        "Expected 80 total footprints (68 populated + 12 DNP test points).",
    )
    erc_assert(
        "{n.name for n in builtins.default_circuit.get_nets()} == EXPECTED_NETS",
        "Circuit net set does not match the 48 nets in DesignSpec.md.",
    )
    erc_assert(
        "_part('C2')[1].net.name == 'GND' and _part('C2')[2].net.name == '-12V'",
        "C2 (-12V electrolytic) must have pin 1 (+) on GND and pin 2 (-) on -12V.",
    )
    erc_assert(
        "_part('D3')[1].net.name == 'NET_RECT_HALF' "
        "and _part('D3')[2].net.name == 'NET_U1B_INV' "
        "and _part('D3')[3].net.name == 'NET_U1B_OUT'",
        "D3 (BAT54S) pinout mismatch against DesignSpec.md.",
    )
    erc_assert(
        "all(getattr(_part(f'TP{i}'), 'dnp', False) "
        "and getattr(_part(f'TP{i}'), 'exclude_from_bom', False) for i in range(1, 13))",
        "All test points TP1-TP12 must be marked dnp=True and exclude_from_bom=True.",
    )


def generate_kicad_xml(file_="envelope_follower_bom.xml"):
    """Export well-formed KiCad XML BOM containing all parts, fields, flags, and nets."""
    root = ET.Element("export", version="D")
    design = ET.SubElement(root, "design")
    ET.SubElement(design, "source").text = pathlib.Path(__file__).name
    ET.SubElement(design, "date").text = time.strftime("%m/%d/%Y %I:%M %p")
    ET.SubElement(design, "tool").text = "SKiDL (3.0.0)"

    components_el = ET.SubElement(root, "components")
    for part in sorted(
        builtins.default_circuit.parts, key=lambda p: _natural_key(p.ref)
    ):
        comp_el = ET.SubElement(components_el, "comp", ref=part.ref)
        ET.SubElement(comp_el, "value").text = part.value_to_str()
        ET.SubElement(comp_el, "footprint").text = getattr(part, "footprint", "")

        non_empty_fields = [
            (k, v) for k, v in part.fields.items() if str(v).strip() != ""
        ]
        if non_empty_fields:
            fields_el = ET.SubElement(comp_el, "fields")
            for fld_name, fld_value in non_empty_fields:
                fld_el = ET.SubElement(fields_el, "field", name=str(fld_name))
                fld_el.text = str(fld_value)

        lib_filename = getattr(getattr(part, "lib", ""), "filename", "NO_LIB")
        ET.SubElement(comp_el, "libsource", lib=lib_filename, part=part.name)

        if getattr(part, "dnp", False):
            ET.SubElement(comp_el, "property", name="dnp")
        if getattr(part, "exclude_from_bom", False):
            ET.SubElement(comp_el, "property", name="exclude_from_bom")

    nets_el = ET.SubElement(root, "nets")
    sorted_nets = sorted(builtins.default_circuit.get_nets(), key=lambda n: str(n.name))
    for code, net in enumerate(sorted_nets, 1):
        net_el = ET.SubElement(nets_el, "net", code=str(code), name=net.name)
        sorted_pins = sorted(
            net.pins, key=lambda pin: (_natural_key(pin.part.ref), str(pin.num))
        )
        for pin in sorted_pins:
            ET.SubElement(net_el, "node", ref=pin.part.ref, pin=str(pin.num))

    ET.indent(root, space="  ")
    ET.ElementTree(root).write(file_, encoding="utf-8", xml_declaration=True)


def generate_jlcpcb_bom(file_="jlcpcb_bom.csv", include_tht=False):
    """Export grouped 4-column JLCPCB PCBA BOM CSV (`Comment,Designator,Footprint,LCSC Part #`)."""
    groups = {}
    for part in builtins.default_circuit.parts:
        lcsc = part.fields.get("LCSC", "")
        jlc_class = part.fields.get("JLCPCB_Class", "")
        if (
            not lcsc
            or getattr(part, "dnp", False)
            or getattr(part, "exclude_from_bom", False)
        ):
            continue
        if not include_tht and "THT" in jlc_class:
            continue

        comment = part.value_to_str()
        footprint = getattr(part, "footprint", "").split(":")[-1]
        key = (comment, footprint, lcsc)
        groups.setdefault(key, []).append(part.ref)

    rows = []
    for (comment, footprint, lcsc), refs in groups.items():
        sorted_refs = sorted(refs, key=_natural_key)
        rows.append(
            (
                _natural_key(sorted_refs[0]),
                comment,
                ", ".join(sorted_refs),
                footprint,
                lcsc,
            )
        )
    rows.sort(key=lambda row: row[0])

    with open(file_, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
        for _, comment, designators, footprint, lcsc in rows:
            writer.writerow([comment, designators, footprint, lcsc])


def main():
    """Build circuit, run ERC, and export KiCad netlist, XML BOM, and JLCPCB CSV BOM."""
    build_circuit()
    ERC()
    generate_netlist(file_="envelope_follower.net")
    generate_kicad_xml(file_="envelope_follower_bom.xml")
    generate_jlcpcb_bom(file_="jlcpcb_bom.csv", include_tht=False)


if __name__ == "__main__":
    main()
