// THROWAWAY UI PROTOTYPE (Issue #10): Structured ENV / SKEW Patch Guide metadata & prose for all 8 guides.
// In production, prose lives exclusively in patches/*.md and only the compact sidecar returned by
// buildProductionSidecarPreview() lives in site/src/data/patch-states.ts (zero prose duplication).

export const CONTROL_METADATA = [
  {
    id: "rv1",
    key: "gain",
    ref: "RV1",
    label: "GAIN",
    hardware: "A100K audio taper + ×2.00 preamp",
    range: "0× (7 o'clock) to 2.00× (5 o'clock gold wedge)",
    notes: "Active only in Envelope Follower Mode (IN patched, SLEW IN empty). 12 o'clock ≈ 0.3×; ~2:30 ≈ 1.0×; 5 o'clock = 2.0×."
  },
  {
    id: "rv2",
    key: "atk",
    ref: "RV2",
    label: "ATK",
    hardware: "A1M log rheostat (1 kΩ floor)",
    range: "0.29–289 ms (FAST) / 3.0 ms–3.00 s (SLOW)",
    notes: "Independent rising slew rate driven inside U1D's active loop — zero divider collapse or diode dead zone."
  },
  {
    id: "rv3",
    key: "rel",
    ref: "RV3",
    label: "REL",
    hardware: "A1M log rheostat (1 kΩ floor)",
    range: "0.18–178 ms (FAST) / 1.84 ms–1.84 s (SLOW)",
    notes: "Independent falling slew rate. Drives cleanly to 0.00 V with no residual diode tail."
  },
  {
    id: "rv4",
    key: "offset",
    ref: "RV4",
    label: "OFFSET",
    hardware: "B10K linear pot + center detent",
    range: "−4.98 V (7 o'clock) to +4.98 V (5 o'clock)",
    notes: "Gold triangle detent = 0.00 V. Virtual-ground summer adds DC bias with 0.00% gain interaction."
  },
  {
    id: "sw1",
    key: "sw1",
    ref: "SW1",
    label: "SMOOTH / RAW",
    hardware: "Sub-mini SPDT (UP = SMOOTH, DOWN = RAW)",
    range: "29.0 Hz T-filter vs unfiltered",
    notes: "SMOOTH cuts 100 Hz rectifier ripple by −11.1 dB with 0.00% DC amplitude drop. Use RAW for audio-rate slewing."
  },
  {
    id: "led1",
    key: "led",
    ref: "LED1",
    label: "+ / − LED",
    hardware: "A-1076 3 mm anti-parallel R/G LED",
    range: "Green (+V) · Dark (0 V) · Red (−V)",
    notes: "Active U2D monitor tracking OUT polarity directly after OFFSET: Dark marks exact 0.00 V zero-crossing."
  },
  {
    id: "sw2",
    key: "sw2",
    ref: "SW2",
    label: "SLOW / FAST",
    hardware: "Sub-mini SPDT (UP = SLOW, DOWN = FAST)",
    range: "4.87 µF (SLOW) vs 470 nF (FAST)",
    notes: "Multiplies all ATK and REL times by 10.36× (3.00 s max attack / 1.84 s max release)."
  },
  {
    id: "j1",
    key: "in",
    ref: "J1",
    label: "IN",
    hardware: "3.5 mm Thonkiconn (90.9 kΩ AC-coupled)",
    range: "3.72 Hz HPF, normaled → SLEW IN",
    notes: "Grounded when unpatched. Feeds GAIN + precision full-wave rectifier into normaled SLEW IN switch."
  },
  {
    id: "j2",
    key: "slewIn",
    ref: "J2",
    label: "SLEW IN",
    hardware: "3.5 mm Thonkiconn (1.00 MΩ DC-coupled)",
    range: "1.002× nominal DC gain",
    notes: "Patching a cable breaks the internal normal from IN (bypassing IN and GAIN) for Asymmetric Skew Limiter Mode."
  },
  {
    id: "j3",
    key: "out",
    ref: "J3",
    label: "OUT",
    hardware: "3.5 mm Thonkiconn (1 kΩ buffered)",
    range: "+(V_env + V_off)",
    notes: "Non-inverted envelope or slewed CV output. LED1 glows Green when OUT > 0 V."
  },
  {
    id: "j4",
    key: "invOut",
    ref: "J4",
    label: "INV OUT",
    hardware: "3.5 mm Thonkiconn (1 kΩ buffered, 0.1% mirror)",
    range: "−(V_env + V_off)",
    notes: "Exact inverted mirror of OUT. LED1 glows Red when INV OUT rests positive (> 0 V)."
  }
];

export const TIMING_TABLE = [
  { pos: "7 o'clock (0%, CCW)", res: "1 kΩ", fastRise: "0.29 ms", fastFall: "0.18 ms", slowRise: "2.99 ms", slowFall: "1.84 ms", glide: "0.47 ms / 0.43 ms" },
  { pos: "9:30 o'clock (25%)", res: "~41 kΩ", fastRise: "11.8 ms", fastFall: "7.28 ms", slowRise: "123 ms", slowFall: "75.4 ms", glide: "19.2 ms / 17.5 ms" },
  { pos: "12 o'clock (50%)", res: "~151 kΩ", fastRise: "43.6 ms", fastFall: "26.8 ms", slowRise: "452 ms", slowFall: "278 ms", glide: "70.8 ms / 64.6 ms" },
  { pos: "5 o'clock (100%, CW)", res: "1.001 MΩ", fastRise: "289 ms", fastFall: "178 ms", slowRise: "3.00 s", slowFall: "1.84 s", glide: "469 ms / 428 ms" }
];

export const SOURCE_FILTERS = [
  { id: "all", label: "All Sources" },
  { id: "kick", label: "Kick / Rhythm" },
  { id: "melodic", label: "Melodic / Synth / Bass" },
  { id: "fx", label: "Reverb / Delay / Stereo" },
  { id: "pitch", label: "1V/Oct Pitch" },
  { id: "gate", label: "Gates / S&H / LFO" }
];

export const PATCH_GUIDES = [
  {
    id: "01",
    slug: "01-sidechain-ducking",
    title: "01 — Sidechain Ducking & Pumping",
    shortTitle: "Sidechain Ducking & Pumping",
    mode: "envelope-follower",
    modeLabel: "Envelope Follower Mode",
    modeSummary: "IN patched · SLEW IN unpatched",
    sources: ["kick"],
    tags: ["Sidechain", "Ducking", "Pumping", "INV OUT"],
    companionModules: ["Mult", "VCA", "Mixer"],
    primaryControls: "INV OUT, OFFSET (CCW), SMOOTH, FAST, + / − LED",
    bestFor: "Techno kick ducking, pumping bass/pads, ghost-kick groove",
    tagline: "Dial in clean, ripple-free bassline pumping by eye in seconds using INV OUT, full-CCW OFFSET, and the + / − zero-crossing LED.",
    whatYouNeed: [
      "Kick drum / trigger audio source (10 Vpp Eurorack level ideal)",
      "Passive or buffered mult (to split the kick to both ENV / SKEW and your mixer)",
      "Bassline, pad, or submix bus to be ducked",
      "Linear or exponential VCA (unipolar 0 V to +5 V CV input; avoid offset-biased VCAs unless turned fully down)",
      "Output mixer"
    ],
    mermaid: `flowchart LR
    KICK["Kick Drum"] --> MULT["Mult"]
    MULT -->|"Audio"| MIX["Main Mixer"]
    MULT -->|"Sidechain Key"| IN["ENV/SKEW: IN"]
    BASS["Bass / Pad Bus"] --> VCA_IN["VCA Audio In"]
    INV["ENV/SKEW: INV OUT"] -->|"Ducking CV (+5V idle -> 0V hit)"| VCA_CV["VCA CV In"]
    VCA_IN --> VCA_OUT["VCA Out"]
    VCA_OUT --> MIX`,
    presets: [
      {
        id: "sidechain-main",
        name: "Classic 4/4 Sidechain Ducking",
        summary: "INV OUT rests at +4.98 V (LED steady Red) and dips cleanly to 0.00 V (Dark) on each kick transient.",
        knobs: {
          gain: { tick: 0, range: [5, 9], positionLabel: "7 o'clock (Full CCW) → dial 12–4 o'clock", effect: "Start muted; raise until kicks dip + / − LED cleanly to Dark" },
          atk: { tick: 0, range: [0, 2], positionLabel: "7 o'clock (Full CCW)", effect: "0.29 ms instant transient clamp (FAST mode)" },
          rel: { tick: 5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "~20–80 ms recovery (FAST) — adjust to tempo groove" },
          offset: { tick: 0, range: [0, 0], positionLabel: "7 o'clock (Full CCW, −)", effect: "Shifts OUT to −4.98 V so INV OUT rests at +4.98 V" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Engages 29.0 Hz T-filter (−11.1 dB @ 100 Hz kick ripple)" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "Selects 470 nF hold cap (0.29–289 ms range)" }
        },
        led: {
          idleState: "red",
          activeState: "dark",
          label: "Steady Red (idle) → Dark (peak duck)",
          idleDesc: "OUT = −4.98 V (INV OUT = +4.98 V, VCA open)",
          activeDesc: "OUT = 0.00 V (INV OUT = 0.00 V, 100% ducked)"
        },
        jacks: {
          in: { state: "active", note: "Kick key audio into IN (normaled → rectifier)" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched to keep IN normal active" },
          out: { state: "idle", note: "Unused (optional: sweeps up on kick for parallel hats)" },
          invOut: { state: "active", note: "Patch INV OUT → VCA CV In (+4.98 V idle → 0 V hit)" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Confirm Envelope Follower Mode & patch VCA",
        text: "Confirm SLEW IN is empty, patch kick mult into IN, and patch INV OUT into your VCA CV input with the VCA's manual bias knob at zero.",
        spotlightControls: ["j1", "j2", "j4"]
      },
      {
        title: "Set OFFSET full CCW for +4.98 V resting CV",
        text: "Turn OFFSET to 7 o'clock (−) and verify the + / − LED glows steady Red with no kick playing (INV OUT sits at +4.98 V, holding bass/pads open).",
        spotlightControls: ["rv4", "led1"]
      },
      {
        title: "Flip toggles to SMOOTH + FAST",
        text: "Flip the left toggle UP (SMOOTH) to strip 100 Hz kick ripple with 0.00% DC loss, and right toggle DOWN (FAST) for 470 nF timing.",
        spotlightControls: ["sw1", "sw2"]
      },
      {
        title: "Raise GAIN until kicks dip LED to Dark",
        text: "Start your kick pattern and turn GAIN clockwise (sweet spot 12–4 o'clock). Stop the instant each kick dips the Red LED cleanly to Dark (0.00 V) without flashing Green.",
        spotlightControls: ["rv1", "led1"]
      },
      {
        title: "Shape the groove with REL & fine-tune ATK",
        text: "Sweep REL across 11–2 o'clock (~20–80 ms) for warehouse breathing; leave ATK at 7 o'clock (0.29 ms) or nudge to 8–9 o'clock to let initial bass attack poke through.",
        spotlightControls: ["rv3", "rv2"]
      }
    ],
    howItWorks: [
      "The + / − LED monitors OUT directly after OFFSET: Dark (0.00 V) means INV OUT is at exact 0.00 V (VCA fully closed). Driving GAIN into Green swings INV OUT negative, which can re-open a 4-quadrant VCA out of phase.",
      "Flipping SMOOTH UP switches C14 (220 nF) into the split-resistor T-filter, cutting 100 Hz full-wave kick ripple by −11.1 dB with 0.00% DC amplitude drop.",
      "U2B's virtual-ground summer keeps OFFSET completely independent of envelope depth (0.00% gain modulation)."
    ],
    variations: [
      "Soft-Knee Partial Ducking: Back GAIN down so the Red LED merely dims instead of hitting Dark (INV OUT dips +5 V → +2 V).",
      "Silent Ghost-Kick Rhythm: Feed a muted offbeat click into IN only for breakdown pumping.",
      "Half-Bar Ambient Suction: Flip SW2 UP (SLOW) for dramatic multi-hundred-millisecond recovery swells.",
      "Simultaneous Duck + Swell: Send INV OUT to duck bass while OUT opens noise hats or a high-shelf boost on every kick."
    ],
    troubleshooting: [
      { symptom: "Bass buzzes or double-triggers on loud kicks", cause: "GAIN too high; LED flashing Green (INV OUT going negative into bipolar VCA)", fix: "Back GAIN CCW until + / − LED just reaches Dark at peak" },
      { symptom: "Audible flutter / grit on sustained bass", cause: "Left toggle is DOWN (RAW)", fix: "Flip left toggle UP (SMOOTH) to attenuate 100 Hz ripple" },
      { symptom: "Ducked audio never reaches full volume between beats", cause: "REL too long or OFFSET not far enough CCW", fix: "Shorten REL (or switch SLOW → FAST) and turn OFFSET full CCW" },
      { symptom: "Very weak ducking even with GAIN high", cause: "Input is quiet line-level (< 1 Vpp) or OFFSET is CW (> 0 V)", fix: "Boost kick before IN or verify OFFSET is at 7 o'clock (steady Red)" }
    ]
  },
  {
    id: "02",
    slug: "02-auto-wah-envelope-filter",
    title: "02 — Auto-Wah & Dynamic Envelope Filter",
    shortTitle: "Auto-Wah & Envelope Filter",
    mode: "envelope-follower",
    modeLabel: "Envelope Follower Mode",
    modeSummary: "IN patched · SLEW IN unpatched",
    sources: ["melodic"],
    tags: ["Auto-Wah", "VCF", "Filter", "Dynamic"],
    companionModules: ["Mult", "VCF"],
    primaryControls: "OUT or INV OUT, ATK, REL, RAW / SMOOTH",
    bestFor: "Funk bass/guitar auto-wah, acid sweeps, upward/downward filter modulation",
    tagline: "Turn playing dynamics directly into resonant filter brightness—or swap to INV OUT for reverse downward sweeps.",
    whatYouNeed: [
      "Dynamic audio source (plucked synth, bass, drum loop, acid line; guitar/bass needs external preamp to reach ~5–10 Vpp)",
      "Passive or buffered mult",
      "Voltage-controlled filter (VCF) with LP or BP output and Cutoff CV attenuverter",
      "Output mixer"
    ],
    mermaid: `flowchart LR
    SRC["Audio Source"] --> MULT["Mult"]
    MULT -->|"Dry Signal"| VCF_IN["VCF Audio In"]
    MULT -->|"Envelope Key"| IN["ENV/SKEW: IN"]
    OUT["ENV/SKEW: OUT (or INV OUT)"] -->|"Cutoff CV"| VCF_CV["VCF Cutoff CV In"]
    VCF_IN --> VCF_OUT["VCF LP / BP Out"]
    VCF_OUT --> MIX["Main Mixer"]`,
    presets: [
      {
        id: "autowah-upward",
        name: "Upward Auto-Wah (OUT → VCF Cutoff)",
        summary: "Zero-baseline sweep from 0.00 V (Dark) up to +4–8 V (Bright Green) on picked or plucked transients.",
        knobs: {
          gain: { tick: 8, range: [7, 9], positionLabel: "2–4 o'clock (65–90%)", effect: "~0.6×–1.5× gain so loud notes push OUT toward +4–8 V (Green)" },
          atk: { tick: 1, range: [0.5, 2], positionLabel: "7:30–9 o'clock (5–20%)", effect: "1–8 ms (FAST) — crisp wah bite without swallowing pick transient" },
          rel: { tick: 4.5, range: [3, 6], positionLabel: "10–1 o'clock (30–60%)", effect: "10–40 ms (FAST) — smooth vocal close after each note" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V baseline so quiet rests return to VCF panel cutoff" }
        },
        switches: {
          sw1: { state: "RAW", label: "DOWN (RAW)", alt: "SMOOTH", effect: "RAW preserves fast percussive snap (flip UP SMOOTH for sub-bass)" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "470 nF hold cap for responsive note-by-note articulation" }
        },
        led: {
          idleState: "dark",
          activeState: "bright-green",
          label: "Dark (idle) → Bright Green (notes)",
          idleDesc: "OUT = 0.00 V baseline at center detent",
          activeDesc: "OUT = +4 V to +8 V sweeping VCF bright"
        },
        jacks: {
          in: { state: "active", note: "Dynamic instrument / synth key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "active", note: "Patch OUT → VCF Cutoff CV In" },
          invOut: { state: "optional", note: "Optional: attenuated to VCF Resonance CV (−) for anti-scream limiting" }
        }
      },
      {
        id: "autowah-reverse",
        name: "Reverse Downward Filter (INV OUT → VCF)",
        summary: "Every loud hit yanks a bright VCF cutoff down into subby warmth, then blooms bright on decay.",
        knobs: {
          gain: { tick: 7.5, range: [6, 9], positionLabel: "1:30–4 o'clock (60–90%)", effect: "Drives downward sweep depth cleanly without clipping" },
          atk: { tick: 1, range: [0.5, 2], positionLabel: "7:30–9 o'clock (5–20%)", effect: "1–8 ms rapid downward clamp on transients" },
          rel: { tick: 4.5, range: [3, 6], positionLabel: "10–1 o'clock (30–60%)", effect: "10–40 ms expressive bloom back to bright resting cutoff" },
          offset: { tick: 5, range: [0, 5], positionLabel: "12 o'clock (or 7 o'clock CCW)", effect: "Use 12 o'clock for bipolar VCF CV, or 7 o'clock CCW for unipolar VCFs" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Stops low-note 2f ripple chatter during reverse swells" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "Responsive note-by-note tracking" }
        },
        led: {
          idleState: "dark",
          activeState: "bright-green",
          label: "Dark idle → Bright Green (INV OUT swings negative)",
          idleDesc: "0.00 V baseline (or steady Red if OFFSET is CCW)",
          activeDesc: "OUT > 0 V (INV OUT pulling VCF cutoff down)"
        },
        jacks: {
          in: { state: "active", note: "Dynamic instrument / synth key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "idle", note: "Unused in single-destination reverse sweep" },
          invOut: { state: "active", note: "Patch INV OUT → VCF Cutoff CV In" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Prepare VCF & patch OUT",
        text: "Set VCF to LP or BP, raise Resonance to 50–75% just shy of self-oscillation, set Cutoff low, and patch OUT → VCF Cutoff CV with OFFSET at 12 o'clock center detent.",
        spotlightControls: ["j1", "j3", "rv4"]
      },
      {
        title: "Dial GAIN to pulse bright Green on peaks",
        text: "Play your source and turn GAIN up (typically 2–4 o'clock) until loudest notes flash bright Green (+5 V to +8 V), then fine-tune sweep width with the VCF CV attenuator.",
        spotlightControls: ["rv1", "led1"]
      },
      {
        title: "Sculpt the vowel with ATK and REL",
        text: "Keep ATK at 7–8 o'clock (0.3–3 ms) for snappy pluck, or raise ATK to 10–12 o'clock (15–44 ms) for slow vocal 'oooo-waaaah' swells without losing peak height.",
        spotlightControls: ["rv2", "rv3"]
      },
      {
        title: "Toggle RAW vs SMOOTH for bass ripple",
        text: "Keep SW1 DOWN (RAW) for crisp leads/drums, or flip SW1 UP (SMOOTH) on 40–100 Hz sub-bass to cut 100 Hz ripple by −11.1 dB with 0.00% peak cutoff loss.",
        spotlightControls: ["sw1"]
      }
    ],
    howItWorks: [
      "Zero 0.65 V diode dead zone: U1D wraps D4/D5 inside its feedback loop so quiet guitar/synth sustain tails track smoothly all the way down to 0.00 V without abruptly snapping shut.",
      "Line-level instruments (~0.2–1.5 Vpp) need an external guitar preamp before IN for full 5 V Eurorack sweeps.",
      "Turning OFFSET slightly CCW (10–11 o'clock) pushes idle OUT negative so only hard accents cross 0 V into Green to open unipolar VCFs."
    ],
    variations: [
      "Reverse Auto-Wah (INV OUT): Patch INV OUT to a bright VCF cutoff so hits pull darker before blooming back up.",
      "Resonance Anti-Scream Limiter: Patch OUT → Cutoff CV (+) and attenuated INV OUT → Resonance CV (−) to prevent harsh resonant screams on loud notes.",
      "Slow Liquid Morph: Flip SW2 UP (SLOW) with ATK 11 o'clock, REL 1 o'clock to turn drum loops into slow-motion filter tides."
    ],
    troubleshooting: [
      { symptom: "Filter buzzes / chatters on low bass notes", cause: "2f rectifier ripple modulating fast VCF cutoff", fix: "Flip left toggle UP (SMOOTH) or nudge REL slightly CW" },
      { symptom: "Filter hits ceiling on every note", cause: "GAIN + ×2 preamp saturating VCF CV input", fix: "Back GAIN down (1–3 o'clock) or reduce VCF CV attenuator" },
      { symptom: "Weak sweep from electric guitar / bass", cause: "Passive instrument ~0.3–1 Vpp needs external boost", fix: "Insert a Eurorack instrument preamp before mult feeding IN" },
      { symptom: "Quiet notes never open the filter", cause: "OFFSET turned CCW (− Red) pushing baseline negative", fix: "Return OFFSET to 12 o'clock center detent (Dark idle)" }
    ]
  },
  {
    id: "03",
    slug: "03-compression-expansion-gating",
    title: "03 — Dynamic Compression, Expansion & Noise Gating",
    shortTitle: "Compression & Noise Gating",
    mode: "envelope-follower",
    modeLabel: "Envelope Follower Mode",
    modeSummary: "IN patched · SLEW IN unpatched",
    sources: ["kick", "melodic"],
    tags: ["Compressor", "Limiter", "Noise Gate", "Expander"],
    companionModules: ["Mult", "VCA"],
    primaryControls: "INV OUT (comp) or OUT (gate), OFFSET, ATK, REL",
    bestFor: "Opto-style limiting, threshold noise gating, independent transient shaping",
    tagline: "Zero-collapse independent ATK/REL plus mirror outputs build an opto-style compressor/limiter or crisp threshold noise gate.",
    whatYouNeed: [
      "Audio source (drum bus, synth voice, bass, noisy external loop)",
      "Passive or buffered mult",
      "Linear or exponential VCA (unipolar 0 V to +5 V CV input recommended)",
      "Output mixer"
    ],
    mermaid: `flowchart LR
    SRC["Audio Source"] --> MULT["Mult"]
    MULT -->|"Signal Path"| VCA_IN["VCA Audio In"]
    MULT -->|"Detector Key"| IN["ENV/SKEW: IN"]
    INV["ENV/SKEW: INV OUT (Compression)"] -->|"Pulls Gain Down"| VCA_CV["VCA CV In"]
    OUT["ENV/SKEW: OUT (Gate / Expansion)"] -.->|"Pushes Gain Up"| VCA_CV
    VCA_IN --> VCA_OUT["VCA Out"]
    VCA_OUT --> MIX["Main Mixer"]`,
    presets: [
      {
        id: "comp-opto",
        name: "A. Opto-Style Compressor / Limiter",
        summary: "INV OUT holds the VCA open at unity (+4–5 V, steady Red) and pulls gain down on peaks.",
        knobs: {
          gain: { tick: 0, range: [6, 9], positionLabel: "7 o'clock → dial up (1–4 o'clock)", effect: "Acts as Ratio / Drive — higher GAIN = deeper gain reduction" },
          atk: { tick: 2, range: [1.5, 3], positionLabel: "8:30–10 o'clock (10–30%)", effect: "3–15 ms (FAST) — lets drum transients punch through before clamping" },
          rel: { tick: 5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "~20–80 ms (FAST) — smooth sustain leveling & glue" },
          offset: { tick: 0.5, range: [0, 1], positionLabel: "7–8 o'clock (CCW, −)", effect: "Biases INV OUT to +4–5 V (steady Red LED = unity VCA gain)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Prevents 100 Hz low-end modulation distortion (ripple buzz)" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "470 nF range (0.29–289 ms attack / 0.18–178 ms release)" }
        },
        led: {
          idleState: "red",
          activeState: "dim-red",
          label: "Steady Red (unity) → Dim Red / Dark (limiting)",
          idleDesc: "INV OUT = +4.5–5 V (VCA fully open)",
          activeDesc: "Dips toward 0 V (Dark for brickwall limiting; avoid Green!)"
        },
        jacks: {
          in: { state: "active", note: "Detector key signal into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "idle", note: "Unused in compression configuration" },
          invOut: { state: "active", note: "Patch INV OUT → VCA CV In (pulls gain down on peaks)" }
        }
      },
      {
        id: "gate-threshold",
        name: "B. Threshold Noise Gate / Upward Expander",
        summary: "OFFSET just CCW of noon traps noise below 0 V (Dim Red); intended hits cross into Green to open the VCA.",
        knobs: {
          gain: { tick: 8, range: [7, 9], positionLabel: "2–4 o'clock (65–90%)", effect: "Scales loud hits cleanly to +5 V (Bright Green)" },
          atk: { tick: 0, range: [0, 0], positionLabel: "7 o'clock (Full CCW)", effect: "0.29 ms instant gate open — never chops off snare or hi-hat clicks" },
          rel: { tick: 4.5, range: [3, 6], positionLabel: "10–1 o'clock (30–60%)", effect: "~10–40 ms (FAST) or flip UP (SLOW) for 100–600 ms gated tails" },
          offset: { tick: 4, range: [3, 4.5], positionLabel: "10–11:30 o'clock (CCW of detent)", effect: "Noise Threshold! Sets idle OUT to −0.5 V to −2.5 V (Dim Red)" }
        },
        switches: {
          sw1: { state: "RAW", label: "DOWN (RAW)", alt: "SMOOTH", effect: "RAW for tight percussive gates; SMOOTH to prevent gate chatter" },
          sw2: { state: "FAST", label: "DOWN (FAST)", alt: "SLOW", effect: "Snappy rhythmic gating (SLOW for long ambient decay gates)" }
        },
        led: {
          idleState: "dim-red",
          activeState: "bright-green",
          label: "Dim Red (noise closed) → Bright Green (gate open)",
          idleDesc: "OUT = −0.5 V to −2.5 V (below unipolar VCA floor)",
          activeDesc: "OUT > 0 V (VCA snaps open cleanly)"
        },
        jacks: {
          in: { state: "active", note: "Detector key signal into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "active", note: "Patch OUT → VCA CV In (pushes gain open above threshold)" },
          invOut: { state: "idle", note: "Unused in gate / expansion configuration" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Choose INV OUT (Compressor) or OUT (Noise Gate)",
        text: "For Compression, patch INV OUT → VCA CV and set OFFSET near 7 o'clock (steady Red = open). For Noise Gating, patch OUT → VCA CV and start with OFFSET at 12 o'clock.",
        spotlightControls: ["j1", "j3", "j4", "rv4"]
      },
      {
        title: "Set Threshold / Resting Level via OFFSET",
        text: "In Gate mode, nudge OFFSET to 10–11:30 o'clock (dim Red LED, −0.5 V to −2.5 V) so hiss stays completely silent below 0 V.",
        spotlightControls: ["rv4", "led1"]
      },
      {
        title: "Drive GAIN & watch + / − LED calibration",
        text: "Compressor: turn GAIN up until peaks dim Red (2:1–4:1) or touch Dark (brickwall) without flashing Green. Gate: raise GAIN until hits push cleanly into Bright Green.",
        spotlightControls: ["rv1", "led1"]
      },
      {
        title: "Shape transients with independent ATK / REL",
        text: "Set ATK to 9–10 o'clock (3–15 ms) in Compressor mode to let drum cracks poke through with zero level collapse; use 7 o'clock (0.29 ms) for click-free Gating.",
        spotlightControls: ["rv2", "rv3", "sw1"]
      }
    ],
    howItWorks: [
      "Zero voltage-divider collapse: U1D drives D4 and D5 in opposite directions inside an active feedback loop, so raising ATK lets drum transients through without losing peak compression depth.",
      "Linear decay to exact 0.00 V: Because U1D drives toward −10.89 V, gate release snaps off cleanly at zero instead of dragging a sluggish exponential tail."
    ],
    variations: [
      "Transient Shaper (De-Sharpener): Compressor patch with ATK at 7 o'clock (0.29 ms) and very fast REL (7:30–8:30 o'clock) ducks only the initial 1–5 ms spike.",
      "Parallel 'New York' Crush Bus: Blend a heavily limited INV OUT VCA channel underneath your dry drum mix.",
      "Gated Reverb (SLOW Mode): Key dry snare into IN, run reverb wet into VCA controlled by OUT with SW2 UP (SLOW) and OFFSET at 11 o'clock."
    ],
    troubleshooting: [
      { symptom: "Compressor distorts or buzzes on bass", cause: "SW1 DOWN (RAW) or GAIN flashing Green", fix: "Flip SW1 UP (SMOOTH); keep + / − LED strictly Red → Dark (no Green flash)" },
      { symptom: "Noise gate chatters open/closed on tails", cause: "Threshold right on noise floor with fast RAW release", fix: "Flip SW1 UP (SMOOTH), lengthen REL, or nudge OFFSET slightly CCW" },
      { symptom: "Gate softens drum transients", cause: "ATK set too high", fix: "Turn ATK full CCW (7 o'clock, 0.29 ms)" },
      { symptom: "VCA won't pass audio in Compression mode", cause: "Using OUT instead of INV OUT, or OFFSET is CW", fix: "Connect INV OUT and set OFFSET to 7 o'clock (−, steady Red LED)" }
    ]
  },
  {
    id: "04",
    slug: "04-ducking-and-blooming-fx",
    title: "04 — Ducking & Blooming Reverb / Delay (Ambient Swells)",
    shortTitle: "Ducking & Blooming FX",
    mode: "envelope-follower",
    modeLabel: "Envelope Follower Mode",
    modeSummary: "IN patched · SLEW IN unpatched",
    sources: ["fx", "melodic"],
    tags: ["Reverb", "Delay", "Ambient", "SLOW Mode"],
    companionModules: ["Mult", "VCA", "Reverb / Delay", "Mixer"],
    primaryControls: "INV OUT (duck) or OUT (bloom), SLOW (4.87 µF), SMOOTH",
    bestFor: "Keeping leads dry while phrases play; multi-second ambient reverb swells",
    tagline: "Engage SLOW mode (4.87 µF) for multi-second linear reverb blooms or ducking delay throws that stay crystal clear.",
    whatYouNeed: [
      "Lead synth, vocal, arpeggio, or pad source",
      "Passive or buffered mult",
      "Stereo or mono Reverb / Delay (CV-controllable Wet/Mix/Feedback or a VCA on send/return)",
      "VCA (if FX unit lacks Wet/Send CV input)",
      "Output mixer"
    ],
    mermaid: `flowchart LR
    SRC["Lead / Synth Voice"] --> MULT["Mult"]
    MULT -->|"Dry Signal"| MIX["Main Mixer"]
    MULT -->|"FX Send"| VCA_IN["VCA Audio In"]
    MULT -->|"Envelope Key"| IN["ENV/SKEW: IN"]
    INV["ENV/SKEW: INV OUT (Ducking FX)"] -->|"Ducks Wet Return / Send"| VCA_CV["VCA CV In"]
    OUT["ENV/SKEW: OUT (Blooming FX)"] -.->|"Swells Reverb / Feedback"| FX_CV["FX Mix / Feedback CV"]
    VCA_IN --> VCA_OUT["VCA Out"] --> FX["Reverb / Delay (100% Wet)"] --> MIX`,
    presets: [
      {
        id: "fx-ducking",
        name: "A. Ducking Reverb / Delay Send",
        summary: "INV OUT ducks the wet FX send/return during busy phrases, then swells open organically into musical rests.",
        knobs: {
          gain: { tick: 0, range: [6, 8], positionLabel: "7 o'clock → dial up (1–3 o'clock)", effect: "Set until active phrases pull + / − LED to Dark (0 V wet)" },
          atk: { tick: 1, range: [0.5, 2], positionLabel: "7:30–9 o'clock (5–20%)", effect: "3–30 ms (SLOW) — ducks wet wash gently as notes start" },
          rel: { tick: 5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "150–450 ms (SLOW) — FX swells organically into musical rests" },
          offset: { tick: 0, range: [0, 0], positionLabel: "7 o'clock (Full CCW, −)", effect: "INV OUT rests at +4.98 V (steady Red LED = full FX tail)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Eliminates low-frequency CV ripple on delicate delay/reverb tails" },
          sw2: { state: "SLOW", label: "UP (SLOW)", effect: "4.87 µF timing cap for lush multi-hundred-ms return swells" }
        },
        led: {
          idleState: "red",
          activeState: "dark",
          label: "Steady Red (tails open) → Dark (dry while playing)",
          idleDesc: "INV OUT = +4.98 V (reverb/delay return open)",
          activeDesc: "INV OUT dips to 0.00 V during active lead notes"
        },
        jacks: {
          in: { state: "active", note: "Dry lead / synth key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "idle", note: "Optional: cross-duck dry VCA for morphing clouds" },
          invOut: { state: "active", note: "Patch INV OUT → FX Send or Wet Return VCA CV" }
        }
      },
      {
        id: "fx-bloom",
        name: "B. Multi-Second Ambient Bloom",
        summary: "1.0–3.00 s linear attack ignores short staccato plucks and blooms huge shimmer only on held chords.",
        knobs: {
          gain: { tick: 8, range: [7, 9], positionLabel: "2–4 o'clock (65–90%)", effect: "Ensures sustained notes hold OUT near +5 V (Bright Green)" },
          atk: { tick: 8.5, range: [7, 10], positionLabel: "2–5 o'clock (65–100%)", effect: "1.0 s – 3.00 s linear rise (SLOW) — ignores short staccato plucks!" },
          rel: { tick: 8, range: [6, 10], positionLabel: "1–5 o'clock (55–100%)", effect: "0.4 s – 1.84 s fall (SLOW) — gradual fading shimmer decay" },
          offset: { tick: 5, range: [4, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V baseline (or slightly CCW for delayed bloom threshold)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Ultra-clean, click-free CV sweep into reverb pitch/feedback" },
          sw2: { state: "SLOW", label: "UP (SLOW)", effect: "Essential for 1–3 s ambient swell times (10.36× slower than FAST)" }
        },
        led: {
          idleState: "dark",
          activeState: "bright-green",
          label: "Dark (dry staccato) → Slow Bright Green (3 s bloom)",
          idleDesc: "OUT = 0.00 V during silence or quick staccato notes",
          activeDesc: "OUT climbs linearly up to +5 V over 1–3 seconds"
        },
        jacks: {
          in: { state: "active", note: "Pad / chord / lead voice key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "active", note: "Patch OUT → Reverb Wet Mix, Shimmer, or Feedback CV" },
          invOut: { state: "optional", note: "Optional: attenuate to Dry VCA CV for push-pull wash" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Choose Ducking (INV OUT) or Ambient Bloom (OUT)",
        text: "For Ducking FX, patch INV OUT to a VCA on your FX Send (selective throws) or Wet Return (vacuum swell) with OFFSET at 7 o'clock. For Ambient Bloom, patch OUT → FX Mix/Feedback CV with OFFSET at 12 o'clock.",
        spotlightControls: ["j1", "j3", "j4", "rv4"]
      },
      {
        title: "Flip both toggles UP (SMOOTH + SLOW)",
        text: "Engage SW1 UP (SMOOTH) for silky click-free reverb CV and SW2 UP (SLOW) for the 4.87 µF capacitor (10.36× slower range, up to 3.00 s rise / 1.84 s fall).",
        spotlightControls: ["sw1", "sw2"]
      },
      {
        title: "Calibrate GAIN with + / − LED",
        text: "In Ducking mode, raise GAIN until active notes pull the Red LED to Dark (0 V). In Bloom mode, raise GAIN (2–4 o'clock) so held chords brighten into Green.",
        spotlightControls: ["rv1", "led1"]
      },
      {
        title: "Dial SLOW timing for musical phrasing",
        text: "For Ducking, tune REL around 11–2 o'clock (150–450 ms). For Bloom, push ATK to 2–5 o'clock (1.0–3.00 s) so short notes stay dry while long chords blossom.",
        spotlightControls: ["rv2", "rv3"]
      }
    ],
    howItWorks: [
      "Low-leakage hold stability: 1N4148W silicon diodes + WIMA MKS2 film caps + U2A FET input (~1–10 pA bias) hold 3.00 s blooms steady without capacitor droop.",
      "Active linear ramps climb smoothly toward +10.89 V instead of rushing the first 63% and stalling like passive RC integrators."
    ],
    variations: [
      "Auto-Disappearing Dry Morph: Patch OUT to open wet reverb VCA while INV OUT ducks your dry mixer VCA.",
      "Self-Oscillating Delay Ceiling: Tune GAIN + Feedback CV attenuator so Bright Green hits 98% infinite wash without runaway overload.",
      "Snappy Delay Throws: Flip SW2 DOWN (FAST) with ATK 7 o'clock, REL 11 o'clock on a Send VCA to catch only phrase endings."
    ],
    troubleshooting: [
      { symptom: "Delay feedback runs away uncontrollably on OUT", cause: "OUT peak (+5–10 V) exceeds safe feedback ceiling", fix: "Lower delay Feedback CV attenuator, reduce GAIN, or turn OFFSET slightly CCW" },
      { symptom: "Bloom barely triggers on quiet plucks", cause: "ATK at 3.00 s drains before transient finishes", fix: "Back ATK toward 12–2 o'clock (0.45–1.2 s) or raise GAIN" },
      { symptom: "Reverb return doesn't reach full volume between notes", cause: "REL too slow (1.84 s) for tempo", fix: "Turn REL toward 9:30–12 o'clock or flip SW2 DOWN (FAST)" },
      { symptom: "Audible clicks on reverb pitch/shimmer CV", cause: "Left toggle DOWN (RAW)", fix: "Flip left toggle UP (SMOOTH)" }
    ]
  },
  {
    id: "05",
    slug: "05-cross-modulation-push-pull",
    title: "05 — Cross-Modulation & Push-Pull Stereo / Timbral Effects",
    shortTitle: "Cross-Mod & Push-Pull Stereo",
    mode: "envelope-follower",
    modeLabel: "Envelope Follower Mode",
    modeSummary: "IN patched · SLEW IN unpatched",
    sources: ["kick", "fx", "melodic"],
    tags: ["Stereo", "Crossfade", "Wavefolder", "FM", "Dual Output"],
    companionModules: ["2× VCAs or Panner / Wavefolder / FM VCO", "Stereo Mixer"],
    primaryControls: "OUT + INV OUT simultaneously, OFFSET",
    bestFor: "Complementary stereo panning, push-pull voice crossfading, dynamic FM/folds",
    tagline: "Drive opposite stereo panning, dual-VCF vowel morphs, or rhythmic FM/wavefolder grit using 0.1%-matched OUT and INV OUT.",
    whatYouNeed: [
      "Modulating audio source (percussion loop, snare/hat groove, bassline, or vocal preamp)",
      "Target synth voice(s) or stereo stage (2× VCAs, Wavefolder, FM VCO, or dual VCFs)",
      "Stereo or mono Mixer"
    ],
    mermaid: `flowchart LR
    KEY["Rhythm / Percussion Key"] --> IN["ENV/SKEW: IN"]
    OUT["ENV/SKEW: OUT"] -->|"Positive Swing"| VCA_A["Target A (e.g. Wavefolder / Pan L)"]
    INV["ENV/SKEW: INV OUT"] -->|"Exact Inverted Swing"| VCA_B["Target B (e.g. Clean Voice / Pan R)"]
    VCA_A --> MIX["Stereo Mixer L / Main"]
    VCA_B --> MIX_R["Stereo Mixer R / Main"]`,
    presets: [
      {
        id: "xmod-pushpull",
        name: "A. Push-Pull Crossfader / Stereo Panner",
        summary: "OFFSET at 9:30 o'clock (−2.5 V) centers a 0–5 V envelope into balanced ±2.5 V bipolar push-pull swing.",
        knobs: {
          gain: { tick: 7, range: [6, 8], positionLabel: "1–3 o'clock (55–80%)", effect: "Dial so peak hits swing OUT up by +5.0 V (0 V → +5 V)" },
          atk: { tick: 1, range: [0.5, 2], positionLabel: "7:30–9 o'clock (5–20%)", effect: "1–8 ms (FAST) — snappy rhythmic movement" },
          rel: { tick: 4.5, range: [3, 6], positionLabel: "10–1 o'clock (30–60%)", effect: "10–40 ms (FAST) — musical return swing" },
          offset: { tick: 2.5, range: [0, 5], positionLabel: "9:30 o'clock (~25%, −2.5 V)", effect: "Centers 0–5 V envelope into ±2.5 V bipolar swing (Red → Green)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Eliminates audio-rate CV chatter across stereo pans and crossfades" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "470 nF range (SLOW for lush slow timbre shifts)" }
        },
        led: {
          idleState: "dim-red",
          activeState: "green",
          label: "Dim Red (−2.5 V) → Green (+2.5 V) bipolar swing",
          idleDesc: "OUT = −2.5 V, INV OUT = +2.5 V (panned R / Voice B)",
          activeDesc: "OUT = +2.5 V, INV OUT = −2.5 V (panned L / Voice A)"
        },
        jacks: {
          in: { state: "active", note: "Rhythm / percussion key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "active", note: "Patch OUT → Target A (Pan L / Wavefolder / VCA A)" },
          invOut: { state: "active", note: "Patch INV OUT → Target B (Pan R / Clean / VCA B)" }
        }
      },
      {
        id: "xmod-harmonic",
        name: "B. Dynamic Harmonic Animator (Wavefolder / FM)",
        summary: "Unipolar 0 → +5–8 V sweep injects metallic wavefold or FM clang on hits; try RAW for octave-doubled growl.",
        knobs: {
          gain: { tick: 8, range: [7, 9], positionLabel: "2–4 o'clock (65–90%)", effect: "Scales loud notes toward +5–8 V (Bright Green)" },
          atk: { tick: 0.5, range: [0, 1.5], positionLabel: "7–8:30 o'clock (0–15%)", effect: "0.3–4 ms (FAST) — instant harmonic bite on hits" },
          rel: { tick: 5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "20–80 ms (FAST) — metallic harmonics bloom and recede smoothly" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V idle (clean unmodulated timbre at rest)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", alt: "RAW", effect: "Clean, smooth timbral tracking (try RAW for gritty FM cross-mod!)" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "Crisp note-by-note dynamics" }
        },
        led: {
          idleState: "dark",
          activeState: "bright-green",
          label: "Dark (clean rest) → Bright Green (harmonic peak)",
          idleDesc: "OUT = 0.00 V (unmodulated carrier / wavefolder)",
          activeDesc: "OUT = +5 V to +8 V (maximum fold / FM index)"
        },
        jacks: {
          in: { state: "active", note: "Drum loop / beat key into IN" },
          slewIn: { state: "idle", note: "Leave SLEW IN unpatched" },
          out: { state: "active", note: "Patch OUT → Wavefolder Fold CV or FM VCA CV" },
          invOut: { state: "optional", note: "Optional: complementary duck on clean sub oscillator" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Patch both OUT and INV OUT simultaneously",
        text: "Patch IN from your rhythm key, OUT to Target A (Wavefolder / Pan L / VCA A), and INV OUT to Target B (Clean Voice / Pan R / VCA B).",
        spotlightControls: ["j1", "j3", "j4"]
      },
      {
        title: "Center bipolar swing with OFFSET",
        text: "For bipolar Stereo Panners, set OFFSET to ~9:30 o'clock (−2.5 V, dim Red). For two unipolar 0–5 V VCAs, set OFFSET to 12 o'clock and give VCA B a +50% manual bias.",
        spotlightControls: ["rv4", "led1"]
      },
      {
        title: "Tune GAIN for symmetrical Red ↔ Green swing",
        text: "Turn GAIN up (1–3 o'clock) until hits push the + / − LED evenly from Red (−2.5 V) through Dark (0 V) to Green (+2.5 V).",
        spotlightControls: ["rv1", "led1"]
      },
      {
        title: "Select SMOOTH polish or RAW FM growl",
        text: "Keep SW1 UP (SMOOTH) for silky crossfades, or flip SW1 DOWN (RAW) with fast REL (7–8 o'clock) to inject intentional 2f octave-doubled grit into FM/wavefolders.",
        spotlightControls: ["sw1", "rv2", "rv3"]
      }
    ],
    howItWorks: [
      "0.1% thin-film mirror accuracy (R30/R31): U2C inverts U2B at an exact 1.000× ratio across ±10 V so stereo panning and dual-filter crossfades stay tightly centered.",
      "Intentional RAW mode grit lets 2f rectifier ripple pass into audio-rate modulation targets for harmonic growl."
    ],
    variations: [
      "Mid-Side / Stereo Width Expander: OUT opens stereo Sides while INV OUT (biased) gently pulls back Center.",
      "Complementary Dual-Filter Vowel Morph: Split a sawtooth into a Low-Pass VCF (OUT) and biased High-Pass VCF (INV OUT).",
      "Dynamic Vibrato Depth: Route a 5 Hz sine LFO through a VCA opened by OUT (ATK 11–1 o'clock in SLOW mode) so held notes bloom into vibrato."
    ],
    troubleshooting: [
      { symptom: "One side of crossfade never opens", cause: "Unipolar VCA ignoring negative voltage below 0 V", fix: "Bias INV OUT VCA's manual level knob to +50% and set OFFSET at 12 o'clock" },
      { symptom: "Stereo image drifts off-center when idle", cause: "OFFSET not tuned to target center point", fix: "Return OFFSET to 12 o'clock center detent or trim to match panner" },
      { symptom: "Harsh metallic buzz during modulation", cause: "2f rectifier ripple leaking through RAW mode", fix: "Flip left toggle UP (SMOOTH) or lengthen REL slightly" },
      { symptom: "Dynamic shifts feel sluggish", cause: "Right toggle left UP (SLOW)", fix: "Flip right toggle DOWN (FAST)" }
    ]
  },
  {
    id: "06",
    slug: "06-audio-rate-slew-waveshaping",
    title: "06 — Audio-Rate Slew Waveshaping & Nonlinear LPF",
    shortTitle: "Audio-Rate Slew Waveshaping",
    mode: "asymmetric-skew-limiter",
    modeLabel: "Asymmetric Skew Limiter Mode",
    modeSummary: "SLEW IN patched · IN & GAIN bypassed",
    sources: ["melodic"],
    tags: ["Waveshaper", "Audio-Rate", "Nonlinear LPF", "Sub-Harmonics"],
    companionModules: ["VCO (audio source)", "Mixer / VCA", "Optional Wavefolder / Oscilloscope"],
    primaryControls: "SLEW IN, RAW (mandatory), FAST, ATK vs REL",
    bestFor: "Turning squares into triangles/ramps, asymmetric harmonic fuzz, nonlinear LPF",
    tagline: "Bypass the rectifier at audio rates to morph square waves into triangles, asymmetric saws, and amplitude-reactive sub-harmonic fuzz.",
    whatYouNeed: [
      "Audio-rate VCO (10 Vpp / ±5 V square, pulse, saw, or triangle output)",
      "Mixer or VCA (to monitor OUT)",
      "(Optional) Wavefolder or Oscilloscope to see and push asymmetric waveshaping"
    ],
    mermaid: `flowchart LR
    VCO["VCO (Square / Saw / Pulse)"] -->|"Audio Rate (10 Vpp)"| SLEW["ENV/SKEW: SLEW IN"]
    OUT["ENV/SKEW: OUT (or INV OUT)"] -->|"Slewed Audio"| MIX["Mixer / VCA"]`,
    presets: [
      {
        id: "audio-slew-main",
        name: "Audio-Rate Waveshaper & Nonlinear LPF",
        summary: "RAW + FAST mandatory! GAIN and IN are disconnected at the SLEW IN jack normaling switch.",
        knobs: {
          gain: { tick: 0, range: [0, 0], bypassed: true, positionLabel: "Bypassed (disconnected)", effect: "Ignored — patching SLEW IN breaks the normal from IN + GAIN" },
          atk: { tick: 0, range: [0, 3], positionLabel: "7 o'clock (Full CCW) → 10 o'clock", effect: "1 kΩ floor (0.47 ms full 10 Vpp rise in FAST); raise to skew rising edge" },
          rel: { tick: 0, range: [0, 4], positionLabel: "7 o'clock (Full CCW) → 11 o'clock", effect: "1 kΩ floor (0.47 ms full 10 Vpp fall in FAST); raise for downward ramp / sub-harmonics" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V DC offset so output audio stays centered (shift before DC wavefolder!)" }
        },
        switches: {
          sw1: { state: "RAW", label: "DOWN (RAW) — Mandatory!", mandatory: true, effect: "Bypasses the 29.0 Hz SMOOTH LPF so audio passes cleanly" },
          sw2: { state: "FAST", label: "DOWN (FAST)", effect: "Selects 470 nF cap (SLOW drops cutoff 10.36× into sub-audio!)" }
        },
        led: {
          idleState: "amber",
          activeState: "amber",
          label: "Blended Amber (high-speed R/G alternation)",
          idleDesc: "Rapid bipolar ±5 V audio swings blend Red & Green into Amber",
          activeDesc: "Shifts toward Green or Red if OFFSET or ATK/REL skews waveform duty"
        },
        jacks: {
          in: { state: "bypassed", note: "Bypassed (normal broken by SLEW IN)" },
          slewIn: { state: "active", note: "Patch VCO square/saw (±5 V, 100–300 Hz) into SLEW IN" },
          out: { state: "active", note: "Patch OUT → Mixer / VCA (turn mixer down first!)" },
          invOut: { state: "optional", note: "Optional: inverted phase copy for stereo wide-phase split" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Patch VCO into SLEW IN & verify bypassed IN/GAIN",
        text: "Turn your mixer channel down first (10 Vpp waves are loud). Patch a 100–300 Hz VCO square wave into SLEW IN and OUT → Mixer; IN and GAIN are bypassed.",
        spotlightControls: ["j2", "j3", "j1", "rv1"]
      },
      {
        title: "Verify BOTH toggles are DOWN (RAW + FAST) & OFFSET centered",
        text: "Left toggle MUST be DOWN (RAW) or audio above 29 Hz is cut; right toggle MUST be DOWN (FAST) for 470 nF; keep OFFSET at 12 o'clock center detent.",
        spotlightControls: ["sw1", "sw2", "rv4"]
      },
      {
        title: "Explore Symmetrical Nonlinear LPF (ATK = REL)",
        text: "Sweep ATK and REL together from 7 o'clock to 9 o'clock: square edges round into trapezoids, pure triangles, and warm level-dependent low-pass tones with zero ringing.",
        spotlightControls: ["rv2", "rv3"]
      },
      {
        title: "Bend into Asymmetric Sawtooth & Sub-Harmonics (ATK ≠ REL)",
        text: "Hold REL at 7 o'clock and raise ATK (7–10 o'clock) for nasal ramp/saw hybrids; or push just REL past 10–12 o'clock on 400–800 Hz notes for octave-down sub-harmonic fuzz!",
        spotlightControls: ["rv2", "rv3", "led1"]
      }
    ],
    howItWorks: [
      "Unlike a linear 1-pole VCF, a slew limiter enforces a fixed volts-per-second ceiling: loud signals hit the wall and morph into triangles while quiet signals retain high harmonics.",
      "C10 (2.2 nF C0G) local lead-lag compensation stabilizes U1D at 7.23 kHz (~90° phase margin), preventing ultrasonic squeal across the entire 1 kΩ–1 MΩ sweep."
    ],
    variations: [
      "Pre-Wavefolder Asymmetric Bias: Turn OFFSET away from center (Red or Green) while skewing ATK ≠ REL before a DC-coupled wavefolder for shifting formant timbres.",
      "Dual-Phase Wide Stereo Split: Pan OUT left and INV OUT right with subtle stereo chorus on one side.",
      "Sub-Audio Rumble Extractor (SMOOTH Abuse): Flip SW1 UP (SMOOTH) on PWM waves to extract sub-29 Hz duty-cycle CV shifts."
    ],
    troubleshooting: [
      { symptom: "Output is almost silent / muffled sub-rumble", cause: "SW1 UP (SMOOTH) or SW2 UP (SLOW)", fix: "Flip BOTH toggles DOWN (RAW + FAST)" },
      { symptom: "Turning GAIN does nothing", cause: "Normal behavior! SLEW IN bypasses IN and GAIN", fix: "Adjust level at your VCO or mixer instead" },
      { symptom: "Speaker cone jumps when muting/unmuting", cause: "OFFSET knocked off center (sending DC)", fix: "Return OFFSET to 12 o'clock center detent" },
      { symptom: "High-pitched square already sounds soft at 7 o'clock", cause: "0.47 ms / 10 Vpp slews > 1 kHz waves", fix: "Use lower-octave bass notes (40–400 Hz) or lower-amplitude VCO signals" }
    ]
  },
  {
    id: "07",
    slug: "07-asymmetric-portamento-slides",
    title: "07 — Asymmetric Portamento & 303-Style Slides",
    shortTitle: "Asymmetric Portamento & 303 Slides",
    mode: "asymmetric-skew-limiter",
    modeLabel: "Asymmetric Skew Limiter Mode",
    modeSummary: "SLEW IN patched · IN & GAIN bypassed",
    sources: ["pitch"],
    tags: ["Portamento", "303 Slide", "1V/Oct", "Glide"],
    companionModules: ["Sequencer / Keyboard (1V/Oct)", "VCO"],
    primaryControls: "SLEW IN, OFFSET (12 o'clock), SLOW / FAST, ATK vs REL",
    bestFor: "Classic TB-303 slides, upward-only vocal scoops, downward laser glides",
    tagline: "Put classic ~70 ms/octave TB-303 acid slides right at noon in SLOW mode, or split ATK and REL for upward scoops and downward drops.",
    whatYouNeed: [
      "Quantized pitch CV source (Eurorack sequencer, keyboard, or quantizer outputting 1 V/Oct)",
      "Analog or digital VCO (1 V/Oct pitch input)",
      "Output mixer (plus VCA/VCF for your main synth voice)"
    ],
    mermaid: `flowchart LR
    SEQ["Sequencer / Keyboard (1V/Oct)"] -->|"Pitch CV"| SLEW["ENV/SKEW: SLEW IN"]
    OUT["ENV/SKEW: OUT"] -->|"Slewed Pitch CV"| VCO1["VCO 1 (1V/Oct In)"]
    INV["ENV/SKEW: INV OUT (Optional)"] -.->|"Contrary-Motion CV"| VCO2["VCO 2 (1V/Oct In)"]
    VCO1 --> MIX["Voice / Mixer"]
    VCO2 -.-> MIX`,
    presets: [
      {
        id: "porta-303",
        name: "Classic 303 Acid Slides (Symmetrical)",
        summary: "SLOW mode puts 70.8 ms/oct upward and 64.6 ms/oct downward glide right at 12 o'clock.",
        knobs: {
          gain: { tick: 0, range: [0, 0], bypassed: true, positionLabel: "Bypassed (disconnected)", effect: "Ignored when SLEW IN is patched" },
          atk: { tick: 5, range: [4, 6], positionLabel: "12 o'clock (50%)", effect: "~70.8 ms / octave upward glide in SLOW (~6.8 ms/oct in FAST)" },
          rel: { tick: 5, range: [4, 6], positionLabel: "12 o'clock (50%)", effect: "~64.6 ms / octave downward glide in SLOW (~6.2 ms/oct in FAST)" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V baseline (or turn intentionally to transpose ±5 octaves!)" }
        },
        switches: {
          sw1: { state: "RAW", label: "DOWN (RAW)", alt: "SMOOTH", effect: "Crisp linear ramps (UP SMOOTH rounds slide corners into S-curves)" },
          sw2: { state: "SLOW", label: "UP (SLOW)", effect: "4.87 µF cap puts classic 303 slides across the middle of the knobs" }
        },
        led: {
          idleState: "dark",
          activeState: "green",
          label: "Tracks pitch polarity (Green > 0 V, Dark 0 V, Red < 0 V)",
          idleDesc: "Dark at 0 V root note",
          activeDesc: "Brightens Green as pitch climbs into higher octaves"
        },
        jacks: {
          in: { state: "bypassed", note: "Bypassed (normal broken by SLEW IN)" },
          slewIn: { state: "active", note: "Patch Sequencer / Keyboard 1V/Oct CV into SLEW IN" },
          out: { state: "active", note: "Patch OUT → VCO 1 1V/Oct In (tune VCO inline!)" },
          invOut: { state: "optional", note: "Optional: patch INV OUT → VCO 2 for contrary-motion harmony" }
        }
      },
      {
        id: "porta-scoop",
        name: "Asymmetric Upward Vocal Scoop",
        summary: "Upward accents glide expressively (~70 ms/oct) while downward jumps to root notes snap tight (0.43 ms/oct).",
        knobs: {
          gain: { tick: 0, range: [0, 0], bypassed: true, positionLabel: "Bypassed (disconnected)", effect: "Ignored when SLEW IN is patched" },
          atk: { tick: 5, range: [4, 6], positionLabel: "11–1 o'clock (40–60%)", effect: "~45–100 ms/oct expressive upward glide into high accents" },
          rel: { tick: 0, range: [0, 0], positionLabel: "7 o'clock (Full CCW)", effect: "0.43 ms/oct instant downward snap onto bass root notes" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V zero transpose" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "29.0 Hz T-filter gently rounds slide corners into analog S-curves" },
          sw2: { state: "SLOW", label: "UP (SLOW)", effect: "4.87 µF range for vocal and bassline portamento" }
        },
        led: {
          idleState: "dark",
          activeState: "green",
          label: "Tracks pitch polarity (Green +oct / Red −oct)",
          idleDesc: "Dark at 0 V pitch center",
          activeDesc: "Smoothly brightens as upward vocal scoop rises"
        },
        jacks: {
          in: { state: "bypassed", note: "Bypassed (normal broken by SLEW IN)" },
          slewIn: { state: "active", note: "Patch Sequencer / Keyboard 1V/Oct CV into SLEW IN" },
          out: { state: "active", note: "Patch OUT → VCO 1 1V/Oct In" },
          invOut: { state: "optional", note: "Optional: VCO 2 mirror harmony or VCF Cutoff tracking" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Patch 1V/Oct CV inline & center OFFSET",
        text: "Patch Sequencer 1V/Oct into SLEW IN and OUT → VCO 1V/Oct. Snap OFFSET strictly into its 12 o'clock center detent, SW1 DOWN (RAW), and SW2 UP (SLOW).",
        spotlightControls: ["j2", "j3", "rv4", "sw1", "sw2"]
      },
      {
        title: "Tune your VCO with ENV / SKEW patched inline",
        text: "Start with ATK and REL at 7 o'clock (0.47 ms/oct, effectively instant) and tune VCO base pitch inline to compensate for nominal 1.002× gain (+2.4 cents/oct) and ±120 mV detent tolerance.",
        spotlightControls: ["rv2", "rv3"]
      },
      {
        title: "Dial 303 Acid Slides (ATK = REL around 11–1 o'clock)",
        text: "Set ATK and REL together near 12 o'clock (~70 ms/octave in SLOW mode) so two-octave jumps glide ~135 ms while tight semitones squelch in ~6 ms.",
        spotlightControls: ["rv2", "rv3", "led1"]
      },
      {
        title: "Split ATK ≠ REL for Asymmetric Portamento",
        text: "Keep REL at 7 o'clock + ATK at noon for upward vocal scoops, or swap (ATK 7 o'clock + REL 12–3 o'clock) for downward acid laser drops. Flip SW1 UP (SMOOTH) for rounded S-curves.",
        spotlightControls: ["rv2", "rv3", "sw1"]
      }
    ],
    howItWorks: [
      "Engineering calibration note: Nominal DC path gain from SLEW IN to OUT is 1.002× (+0.2% ≈ +2.4 cents/octave) plus 1% resistor tolerances and ±120 mV OFFSET detent variance — always tune your VCO with ENV / SKEW patched inline.",
      "Because OFFSET has 16.7 Hz filtering and ±4.98 V linear span, turning OFFSET live transposes the entire melody smoothly across ±5 octaves."
    ],
    variations: [
      "Contrary-Motion Twin VCO Harmony: Patch OUT → VCO 1 and INV OUT → VCO 2 tuned to the same root; climbing melodies make VCO 2 descend in exact mirror harmony.",
      "Rounded 'S-Curve' Analog Glide: Flip SW1 UP (SMOOTH) to round linear launch and landing corners with 0.00% pitch shift.",
      "Stepped-to-Gliding Filter Tracking: Split OUT to VCF Cutoff so higher slurred notes open the filter in lockstep."
    ],
    troubleshooting: [
      { symptom: "VCO plays semitones sharp or flat", cause: "OFFSET knocked off 12 o'clock detent (±120 mV ≈ 1.4 semitones max)", fix: "Snap OFFSET back into 12 o'clock center detent and re-zero VCO coarse tune" },
      { symptom: "Melody glides too slowly and never hits pitch", cause: "ATK/REL past 2 o'clock in SLOW mode", fix: "Lower ATK/REL toward 9:30–12 o'clock or flip SW2 DOWN (FAST)" },
      { symptom: "High notes slightly out of tune over 5 octaves", cause: "VCO tuned before patching inline or 1.002× tolerance", fix: "Tune VCO with ENV / SKEW patched inline" },
      { symptom: "Slides feel abrupt at note changes", cause: "RAW with small FAST times", fix: "Flip SW2 UP (SLOW) and optionally SW1 UP (SMOOTH)" }
    ]
  },
  {
    id: "08",
    slug: "08-gate-to-ar-envelope-and-slewed-mod",
    title: "08 — Gate-to-AR Envelope & Slewed Modulation",
    shortTitle: "Gate-to-AR & Slewed Mod",
    mode: "asymmetric-skew-limiter",
    modeLabel: "Asymmetric Skew Limiter Mode",
    modeSummary: "SLEW IN patched · IN & GAIN bypassed",
    sources: ["gate"],
    tags: ["AR Envelope", "ASR", "S&H Smoother", "LFO Waveshaper", "Vactrol"],
    companionModules: ["Gate / Trigger, S&H, or Square LFO", "VCA / VCF / Wavefolder"],
    primaryControls: "SLEW IN, ATK, REL, SMOOTH (vactrol curve), OUT + INV OUT",
    bestFor: "Crisp linear AR/ASR envelopes, smoothing stepped random CV, LFO waveshaping",
    tagline: "Turn any gate, trigger, S&H random voltage, or square LFO into a linear AR/ASR envelope, woody vactrol curve, or morphing saw/triangle LFO.",
    whatYouNeed: [
      "Gate / Trigger generator, Sample & Hold (stepped random), or Square LFO",
      "Target VCA, VCF, Wavefolder, or FM VCO",
      "Audio source + Mixer (to hear the shaped modulation)"
    ],
    mermaid: `flowchart LR
    MOD["Gate / Trigger / S&H / Square LFO"] -->|"CV In"| SLEW["ENV/SKEW: SLEW IN"]
    OUT["ENV/SKEW: OUT"] -->|"AR Envelope / Slewed Mod"| VCA["VCA or VCF CV In"]
    INV["ENV/SKEW: INV OUT (Optional)"] -.->|"Inverted Duck / Anti-Sweep"| VCF2["VCF 2 / Ducking VCA"]`,
    presets: [
      {
        id: "gate-ar",
        name: "A. Linear-Ramp AR / ASR Envelope",
        summary: "Turns +5/+8 V gates or triggers into crisp linear attack/release envelopes stopping at exact 0.00 V.",
        knobs: {
          gain: { tick: 0, range: [0, 0], bypassed: true, positionLabel: "Bypassed (disconnected)", effect: "Ignored when SLEW IN is patched" },
          atk: { tick: 2, range: [0.5, 4], positionLabel: "7:30–11 o'clock (5–40%)", effect: "1–25 ms (FAST) or 10–300 ms (SLOW) linear rise to gate peak" },
          rel: { tick: 6, range: [4, 8], positionLabel: "11–3 o'clock (40–75%)", effect: "20–100 ms (FAST) or 200 ms–1.0 s (SLOW) linear decay to 0.00 V" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "0.00 V rest floor (unipolar 0 V → +5/+8 V gates)" }
        },
        switches: {
          sw1: { state: "RAW", label: "DOWN (RAW)", alt: "SMOOTH", effect: "RAW = sharp linear peaks; flip UP (SMOOTH) for woody vactrol/LPG curves" },
          sw2: { state: "FAST", label: "DOWN (FAST)", alt: "SLOW", effect: "FAST (0.29–289 ms) or SLOW (3 ms–3.00 s)" }
        },
        led: {
          idleState: "dark",
          activeState: "green",
          label: "Dark (0.00 V rest) → Green (envelope active)",
          idleDesc: "Exact 0.00 V stop (VCA dead silent)",
          activeDesc: "Follows linear rise, sustain hold, and release back to Dark"
        },
        jacks: {
          in: { state: "bypassed", note: "Bypassed (normal broken by SLEW IN)" },
          slewIn: { state: "active", note: "Patch Gate or Trigger (+5 V / +8 V) into SLEW IN" },
          out: { state: "active", note: "Patch OUT → VCA or VCF CV In" },
          invOut: { state: "optional", note: "Optional: simultaneous inverted duck on companion filter/voice" }
        }
      },
      {
        id: "sh-lfo",
        name: "B. Stepped Random S&H / LFO Waveshaper",
        summary: "Morphs staircase S&H into drifting SLOW tides, or turns a 50% square LFO into triangle, ramp-down, or ramp-up saw LFOs.",
        knobs: {
          gain: { tick: 0, range: [0, 0], bypassed: true, positionLabel: "Bypassed (disconnected)", effect: "Ignored when SLEW IN is patched" },
          atk: { tick: 5.5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "Sets upward ramp slope (slow ATK + fast REL = rising saw LFO!)" },
          rel: { tick: 5.5, range: [4, 7], positionLabel: "11–2 o'clock (40–65%)", effect: "Sets downward ramp slope (fast ATK + slow REL = falling saw LFO!)" },
          offset: { tick: 5, range: [5, 5], positionLabel: "12 o'clock (Center Detent)", effect: "Centers bipolar ±5 V S&H/LFO (Red ↔ Green LED)" }
        },
        switches: {
          sw1: { state: "SMOOTH", label: "UP (SMOOTH)", effect: "Rounds stepped corner artifacts for ultra-silky modulation" },
          sw2: { state: "SLOW", label: "UP (SLOW)", alt: "FAST", effect: "SLOW creates multi-second drifting tides (FAST for 0.5–10 Hz LFOs)" }
        },
        led: {
          idleState: "dim-red",
          activeState: "green",
          label: "Red ↔ Green bipolar CV tracking",
          idleDesc: "Glows Red when stepped random or LFO dips negative",
          activeDesc: "Swings smoothly through Dark into Green on positive steps"
        },
        jacks: {
          in: { state: "bypassed", note: "Bypassed (normal broken by SLEW IN)" },
          slewIn: { state: "active", note: "Patch S&H or Square LFO into SLEW IN" },
          out: { state: "active", note: "Patch OUT → VCF Cutoff, Wavetable, or Reverb Mix CV" },
          invOut: { state: "optional", note: "Optional: inverse modulation curve to second parameter" }
        }
      }
    ],
    dialInSteps: [
      {
        title: "Patch Gate/S&H/LFO into SLEW IN & center OFFSET",
        text: "Patch your gate, trigger, S&H, or square LFO into SLEW IN and OUT → VCA/VCF CV. Keep OFFSET at 12 o'clock center detent (0.00 V) for clean VCA shutoff.",
        spotlightControls: ["j2", "j3", "rv4"]
      },
      {
        title: "Match ATK to Gate vs Trigger length",
        text: "For sustaining ASR envelopes, keep ATK shorter than your gate; for short 1–10 ms triggers, set SW2 DOWN (FAST) and ATK near 7–8 o'clock (0.29 ms hits +5 V!).",
        spotlightControls: ["rv2", "sw2", "led1"]
      },
      {
        title: "Flip SMOOTH UP for Vactrol / LPG softness",
        text: "Flip SW1 UP (SMOOTH) to engage the 29.0 Hz T-filter (τ = 5.49 ms): peak envelope corners round organically with 0.00% peak voltage loss.",
        spotlightControls: ["sw1"]
      },
      {
        title: "Skew ATK vs REL to morph S&H & Square LFOs",
        text: "Match ATK = REL to turn square LFOs into triangles; use fast ATK + slow REL for ramp-down saws (or 'ping-and-drift' S&H), or slow ATK + fast REL for reverse rising saws.",
        spotlightControls: ["rv2", "rv3"]
      }
    ],
    howItWorks: [
      "No premature diode stall or residual bleed: U1D actively drives C11–C13 toward ±10.89 V inside its loop, stopping envelopes cleanly at exact 0.00 V.",
      "Turning OFFSET to 9:30 o'clock (−2.5 V) converts any unipolar 0–5 V gate into a symmetrical ±2.5 V bipolar envelope."
    ],
    variations: [
      "Simultaneous Open + Duck: Trigger SLEW IN once to open a lead VCA (OUT) while darkening a pad VCF (INV OUT).",
      "Rhythmic Decay Bursts: Feed fast Euclid gates into SLOW mode with ATK 7 o'clock, REL 2–4 o'clock so bursts pump upward step-by-step like a bouncing delay.",
      "Sub-Audio Gate Elongation: Stretch short 10 ms triggers into 50–150 ms gates feeding a downstream comparator."
    ],
    troubleshooting: [
      { symptom: "Short trigger (1–2 ms) produces tiny peak", cause: "ATK too high or SW2 in SLOW (2.99 ms min)", fix: "Flip SW2 DOWN (FAST) and set ATK = 7 o'clock" },
      { symptom: "Stepped random S&H barely moves", cause: "ATK and REL too slow for clock rate in SLOW", fix: "Turn ATK/REL down (8–11 o'clock) or flip SW2 DOWN (FAST)" },
      { symptom: "VCA leaks slightly when gate is off", cause: "OFFSET slightly CW (or +120 mV detent variance)", fix: "Seat OFFSET in center detent (or nudge tiny fraction CCW to dim Red)" },
      { symptom: "LFO turns into tiny wobble", cause: "ATK/REL too slow for LFO period", fix: "Flip SW2 DOWN (FAST) and tune knobs within one LFO cycle" }
    ]
  }
];

export function getPatchBySlug(slug) {
  return PATCH_GUIDES.find((p) => p.slug === slug || p.id === slug) || null;
}

/**
 * Generates the exact zero-duplication sidecar metadata schema intended for
 * production site/src/data/patch-states.ts (no prose duplication from patches/01..08.md).
 */
export function buildProductionSidecarPreview(patchOrHub) {
  const serializePatch = (p) => ({
    slug: p.slug,
    mode: p.mode,
    tagline: p.tagline,
    tags: p.tags,
    sources: p.sources,
    companionModules: p.companionModules,
    presets: p.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      knobs: {
        gain: {
          tick: preset.knobs.gain.tick,
          range: preset.knobs.gain.range,
          ...(preset.knobs.gain.bypassed ? { bypassed: true } : {})
        },
        atk: { tick: preset.knobs.atk.tick, range: preset.knobs.atk.range },
        rel: { tick: preset.knobs.rel.tick, range: preset.knobs.rel.range },
        offset: { tick: preset.knobs.offset.tick, range: preset.knobs.offset.range }
      },
      switches: {
        sw1: {
          state: preset.switches.sw1.state,
          ...(preset.switches.sw1.alt ? { alt: preset.switches.sw1.alt } : {}),
          ...(preset.switches.sw1.mandatory ? { mandatory: true } : {})
        },
        sw2: {
          state: preset.switches.sw2.state,
          ...(preset.switches.sw2.alt ? { alt: preset.switches.sw2.alt } : {})
        }
      },
      led: {
        idle: preset.led.idleState,
        active: preset.led.activeState
      },
      jacks: {
        in: preset.jacks.in.state,
        slewIn: preset.jacks.slewIn.state,
        out: preset.jacks.out.state,
        invOut: preset.jacks.invOut.state
      }
    })),
    stepSpotlights: p.dialInSteps.map((step, index) => ({
      step: index + 1,
      controls: step.spotlightControls
    }))
  });

  if (!patchOrHub) {
    return {
      schema: "env-skew-patch-states/v1",
      sourceOfTruthNote: "Hardware panel states keyed by patch slug. All guide prose stays solely in patches/01..08.md.",
      patches: PATCH_GUIDES.map(serializePatch)
    };
  }

  return {
    schema: "env-skew-patch-states/v1",
    sourceOfTruthNote: "Single-patch sidecar entry — zero duplicated Markdown prose.",
    ...serializePatch(patchOrHub)
  };
}
