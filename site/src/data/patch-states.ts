import type { PanelControlId } from '../lib/panel-svg-shared.ts';

export type PatchMode = 'envelope-follower' | 'asymmetric-skew-limiter';
export type LedState = 'green' | 'bright-green' | 'red' | 'dim-red' | 'dark' | 'amber';
export type JackState = 'active' | 'optional' | 'idle' | 'bypassed';

export interface KnobPreset {
  tick: number; // 0..10 (11 radial ticks, 30° per step)
  range: [number, number];
  positionLabel: string;
  effect: string;
  bypassed?: boolean;
}

export interface SwitchPreset<TState extends string> {
  state: TState;
  label: string;
  effect: string;
  alt?: TState;
  mandatory?: boolean;
}

export interface PatchPreset {
  id: string;
  name: string;
  summary: string;
  knobs: { gain: KnobPreset; atk: KnobPreset; rel: KnobPreset; offset: KnobPreset };
  switches: { sw1: SwitchPreset<'SMOOTH' | 'RAW'>; sw2: SwitchPreset<'SLOW' | 'FAST'> };
  led: {
    idleState: LedState;
    activeState: LedState;
    label: string;
    idleDesc: string;
    activeDesc: string;
  };
  jacks: Record<'in' | 'slewIn' | 'out' | 'invOut', { state: JackState; note: string }>;
}

export interface PatchStateEntry {
  slug: string; // 1:1 with patches/01..08 filenames
  mode: PatchMode;
  tagline: string;
  tags: string[];
  companionModules: string[];
  presets: PatchPreset[];
}

export interface ControlMetadata {
  id: PanelControlId;
  ref: string;
  label: string;
  hardware: string;
  range: string;
  notes: string;
}

export interface LedBadgeDescriptor {
  symbol: string;
  text: string;
  pillColor: 'green' | 'red' | 'dark' | 'amber';
}

export const PATCH_STATES_SCHEMA = 'env-skew-patch-states/v1' as const;

export const PATCH_CONTROL_METADATA: readonly ControlMetadata[] = [
  {
    id: 'rv1',
    ref: 'RV1',
    label: 'GAIN',
    hardware: 'A100K audio taper + ×2.00 preamp',
    range: "0× (7 o'clock) to 2.00× (5 o'clock gold wedge)",
    notes:
      "Active only in Envelope Follower Mode (IN patched, SLEW IN empty). 12 o'clock ≈ 0.3×; ~2:30 ≈ 1.0×; 5 o'clock = 2.0×.",
  },
  {
    id: 'rv2',
    ref: 'RV2',
    label: 'ATK',
    hardware: 'A1M log rheostat (1 kΩ floor)',
    range: '0.29–289 ms (FAST) / 3.0 ms–3.00 s (SLOW)',
    notes:
      "Independent rising slew rate driven inside U1D's active loop — zero divider collapse or diode dead zone.",
  },
  {
    id: 'rv3',
    ref: 'RV3',
    label: 'REL',
    hardware: 'A1M log rheostat (1 kΩ floor)',
    range: '0.18–178 ms (FAST) / 1.84 ms–1.84 s (SLOW)',
    notes: 'Independent falling slew rate. Drives cleanly to 0.00 V with no residual diode tail.',
  },
  {
    id: 'rv4',
    ref: 'RV4',
    label: 'OFFSET',
    hardware: 'B10K linear pot + center detent',
    range: "−4.98 V (7 o'clock) to +4.98 V (5 o'clock)",
    notes:
      'Gold triangle detent = 0.00 V. Virtual-ground summer adds DC bias with 0.00% gain interaction.',
  },
  {
    id: 'sw1',
    ref: 'SW1',
    label: 'SMOOTH / RAW',
    hardware: 'Sub-mini SPDT (UP = SMOOTH, DOWN = RAW)',
    range: '29.0 Hz T-filter vs unfiltered',
    notes:
      'SMOOTH cuts 100 Hz rectifier ripple by −11.1 dB with 0.00% DC amplitude drop. Use RAW for audio-rate slewing.',
  },
  {
    id: 'led1',
    ref: 'LED1',
    label: '+ / − LED',
    hardware: 'A-1076 3 mm anti-parallel R/G LED',
    range: 'Green (+V) · Dark (0 V) · Red (−V)',
    notes:
      'Active U2D monitor tracking OUT polarity directly after OFFSET: Dark marks exact 0.00 V zero-crossing.',
  },
  {
    id: 'sw2',
    ref: 'SW2',
    label: 'SLOW / FAST',
    hardware: 'Sub-mini SPDT (UP = SLOW, DOWN = FAST)',
    range: '4.87 µF (SLOW) vs 470 nF (FAST)',
    notes: 'Multiplies all ATK and REL times by 10.36× (3.00 s max attack / 1.84 s max release).',
  },
  {
    id: 'j1',
    ref: 'J1',
    label: 'IN',
    hardware: '3.5 mm Thonkiconn (90.9 kΩ AC-coupled)',
    range: '3.72 Hz HPF, normaled → SLEW IN',
    notes:
      'Grounded when unpatched. Feeds GAIN + precision full-wave rectifier into normaled SLEW IN switch.',
  },
  {
    id: 'j2',
    ref: 'J2',
    label: 'SLEW IN',
    hardware: '3.5 mm Thonkiconn (1.00 MΩ DC-coupled)',
    range: '1.002× nominal DC gain',
    notes:
      'Patching a cable breaks the internal normal from IN (bypassing IN and GAIN) for Asymmetric Skew Limiter Mode.',
  },
  {
    id: 'j3',
    ref: 'J3',
    label: 'OUT',
    hardware: '3.5 mm Thonkiconn (1 kΩ buffered)',
    range: '+(V_env + V_off)',
    notes: 'Non-inverted envelope or slewed CV output. LED1 glows Green when OUT > 0 V.',
  },
  {
    id: 'j4',
    ref: 'J4',
    label: 'INV OUT',
    hardware: '3.5 mm Thonkiconn (1 kΩ buffered, 0.1% mirror)',
    range: '−(V_env + V_off)',
    notes: 'Exact inverted mirror of OUT. LED1 glows Red when INV OUT rests positive (> 0 V).',
  },
];

export const PATCH_STATES: readonly PatchStateEntry[] = [
  {
    slug: '01-sidechain-ducking',
    mode: 'envelope-follower',
    tagline:
      'Dial in clean, ripple-free bassline pumping by eye in seconds using INV OUT, full-CCW OFFSET, and the + / − zero-crossing LED.',
    tags: ['Sidechain', 'Ducking', 'Pumping', 'INV OUT'],
    companionModules: ['Mult', 'VCA', 'Mixer'],
    presets: [
      {
        id: 'sidechain-main',
        name: 'Classic 4/4 Sidechain Ducking',
        summary:
          'INV OUT rests at +4.98 V (LED steady Red) and dips cleanly to 0.00 V (Dark) on each kick transient.',
        knobs: {
          gain: {
            tick: 0,
            range: [5, 9],
            positionLabel: "7 o'clock (Full CCW) → dial 12–4 o'clock",
            effect: 'Start muted; raise until kicks dip + / − LED cleanly to Dark',
          },
          atk: {
            tick: 0,
            range: [0, 2],
            positionLabel: "7 o'clock (Full CCW)",
            effect: '0.29 ms instant transient clamp (FAST mode)',
          },
          rel: {
            tick: 5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: '~20–80 ms recovery (FAST) — adjust to tempo groove',
          },
          offset: {
            tick: 0,
            range: [0, 0],
            positionLabel: "7 o'clock (Full CCW, −)",
            effect: 'Shifts OUT to −4.98 V so INV OUT rests at +4.98 V',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Engages 29.0 Hz T-filter (−11.1 dB @ 100 Hz kick ripple)',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: 'Selects 470 nF hold cap (0.29–289 ms range)',
          },
        },
        led: {
          idleState: 'red',
          activeState: 'dark',
          label: 'Steady Red (idle) → Dark (peak duck)',
          idleDesc: 'OUT = −4.98 V (INV OUT = +4.98 V, VCA open)',
          activeDesc: 'OUT = 0.00 V (INV OUT = 0.00 V, 100% ducked)',
        },
        jacks: {
          in: { state: 'active', note: 'Kick key audio into IN (normaled → rectifier)' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched to keep IN normal active' },
          out: { state: 'idle', note: 'Unused (optional: sweeps up on kick for parallel hats)' },
          invOut: { state: 'active', note: 'Patch INV OUT → VCA CV In (+4.98 V idle → 0 V hit)' },
        },
      },
    ],
  },
  {
    slug: '02-auto-wah-envelope-filter',
    mode: 'envelope-follower',
    tagline:
      'Turn playing dynamics directly into resonant filter brightness—or swap to INV OUT for reverse downward sweeps.',
    tags: ['Auto-Wah', 'VCF', 'Filter', 'Dynamic'],
    companionModules: ['Mult', 'VCF'],
    presets: [
      {
        id: 'autowah-upward',
        name: 'Upward Auto-Wah (OUT → VCF Cutoff)',
        summary:
          'Zero-baseline sweep from 0.00 V (Dark) up to +4–8 V (Bright Green) on picked or plucked transients.',
        knobs: {
          gain: {
            tick: 8,
            range: [7, 9],
            positionLabel: "2–4 o'clock (65–90%)",
            effect: '~0.6×–1.5× gain so loud notes push OUT toward +4–8 V (Green)',
          },
          atk: {
            tick: 1,
            range: [0.5, 2],
            positionLabel: "7:30–9 o'clock (5–20%)",
            effect: '1–8 ms (FAST) — crisp wah bite without swallowing pick transient',
          },
          rel: {
            tick: 4.5,
            range: [3, 6],
            positionLabel: "10–1 o'clock (30–60%)",
            effect: '10–40 ms (FAST) — smooth vocal close after each note',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V baseline so quiet rests return to VCF panel cutoff',
          },
        },
        switches: {
          sw1: {
            state: 'RAW',
            label: 'DOWN (RAW)',
            alt: 'SMOOTH',
            effect: 'RAW preserves fast percussive snap (flip UP SMOOTH for sub-bass)',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: '470 nF hold cap for responsive note-by-note articulation',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'bright-green',
          label: 'Dark (idle) → Bright Green (notes)',
          idleDesc: 'OUT = 0.00 V baseline at center detent',
          activeDesc: 'OUT = +4 V to +8 V sweeping VCF bright',
        },
        jacks: {
          in: { state: 'active', note: 'Dynamic instrument / synth key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'active', note: 'Patch OUT → VCF Cutoff CV In' },
          invOut: {
            state: 'optional',
            note: 'Optional: attenuated to VCF Resonance CV (−) for anti-scream limiting',
          },
        },
      },
      {
        id: 'autowah-reverse',
        name: 'Reverse Downward Filter (INV OUT → VCF)',
        summary:
          'Every loud hit yanks a bright VCF cutoff down into subby warmth, then blooms bright on decay.',
        knobs: {
          gain: {
            tick: 7.5,
            range: [6, 9],
            positionLabel: "1:30–4 o'clock (60–90%)",
            effect: 'Drives downward sweep depth cleanly without clipping',
          },
          atk: {
            tick: 1,
            range: [0.5, 2],
            positionLabel: "7:30–9 o'clock (5–20%)",
            effect: '1–8 ms rapid downward clamp on transients',
          },
          rel: {
            tick: 4.5,
            range: [3, 6],
            positionLabel: "10–1 o'clock (30–60%)",
            effect: '10–40 ms expressive bloom back to bright resting cutoff',
          },
          offset: {
            tick: 5,
            range: [0, 5],
            positionLabel: "12 o'clock (or 7 o'clock CCW)",
            effect: 'Use 12 o’clock for bipolar VCF CV, or 7 o’clock CCW for unipolar VCFs',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Stops low-note 2f ripple chatter during reverse swells',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: 'Responsive note-by-note tracking',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'bright-green',
          label: 'Dark idle → Bright Green (INV OUT swings negative)',
          idleDesc: '0.00 V baseline (or steady Red if OFFSET is CCW)',
          activeDesc: 'OUT > 0 V (INV OUT pulling VCF cutoff down)',
        },
        jacks: {
          in: { state: 'active', note: 'Dynamic instrument / synth key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'idle', note: 'Unused in single-destination reverse sweep' },
          invOut: { state: 'active', note: 'Patch INV OUT → VCF Cutoff CV In' },
        },
      },
    ],
  },
  {
    slug: '03-compression-expansion-gating',
    mode: 'envelope-follower',
    tagline:
      'Zero-collapse independent ATK/REL plus mirror outputs build an opto-style compressor/limiter or crisp threshold noise gate.',
    tags: ['Compressor', 'Limiter', 'Noise Gate', 'Expander'],
    companionModules: ['Mult', 'VCA'],
    presets: [
      {
        id: 'comp-opto',
        name: 'A. Opto-Style Compressor / Limiter',
        summary:
          'INV OUT holds the VCA open at unity (+4–5 V, steady Red) and pulls gain down on peaks.',
        knobs: {
          gain: {
            tick: 0,
            range: [6, 9],
            positionLabel: "7 o'clock → dial up (1–4 o'clock)",
            effect: 'Acts as Ratio / Drive — higher GAIN = deeper gain reduction',
          },
          atk: {
            tick: 2,
            range: [1.5, 3],
            positionLabel: "8:30–10 o'clock (10–30%)",
            effect: '3–15 ms (FAST) — lets drum transients punch through before clamping',
          },
          rel: {
            tick: 5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: '~20–80 ms (FAST) — smooth sustain leveling & glue',
          },
          offset: {
            tick: 0.5,
            range: [0, 1],
            positionLabel: "7–8 o'clock (CCW, −)",
            effect: 'Biases INV OUT to +4–5 V (steady Red LED = unity VCA gain)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Prevents 100 Hz low-end modulation distortion (ripple buzz)',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: '470 nF range (0.29–289 ms attack / 0.18–178 ms release)',
          },
        },
        led: {
          idleState: 'red',
          activeState: 'dim-red',
          label: 'Steady Red (unity) → Dim Red / Dark (limiting)',
          idleDesc: 'INV OUT = +4.5–5 V (VCA fully open)',
          activeDesc: 'Dips toward 0 V (Dark for brickwall limiting; avoid Green!)',
        },
        jacks: {
          in: { state: 'active', note: 'Detector key signal into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'idle', note: 'Unused in compression configuration' },
          invOut: { state: 'active', note: 'Patch INV OUT → VCA CV In (pulls gain down on peaks)' },
        },
      },
      {
        id: 'gate-threshold',
        name: 'B. Threshold Noise Gate / Upward Expander',
        summary:
          'OFFSET just CCW of noon traps noise below 0 V (Dim Red); intended hits cross into Green to open the VCA.',
        knobs: {
          gain: {
            tick: 8,
            range: [7, 9],
            positionLabel: "2–4 o'clock (65–90%)",
            effect: 'Scales loud hits cleanly to +5 V (Bright Green)',
          },
          atk: {
            tick: 0,
            range: [0, 0],
            positionLabel: "7 o'clock (Full CCW)",
            effect: '0.29 ms instant gate open — never chops off snare or hi-hat clicks',
          },
          rel: {
            tick: 4.5,
            range: [3, 6],
            positionLabel: "10–1 o'clock (30–60%)",
            effect: '~10–40 ms (FAST) or flip UP (SLOW) for 100–600 ms gated tails',
          },
          offset: {
            tick: 4,
            range: [3, 4.5],
            positionLabel: "10–11:30 o'clock (CCW of detent)",
            effect: 'Noise Threshold! Sets idle OUT to −0.5 V to −2.5 V (Dim Red)',
          },
        },
        switches: {
          sw1: {
            state: 'RAW',
            label: 'DOWN (RAW)',
            alt: 'SMOOTH',
            effect: 'RAW for tight percussive gates; SMOOTH to prevent gate chatter',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            alt: 'SLOW',
            effect: 'Snappy rhythmic gating (SLOW for long ambient decay gates)',
          },
        },
        led: {
          idleState: 'dim-red',
          activeState: 'bright-green',
          label: 'Dim Red (noise closed) → Bright Green (gate open)',
          idleDesc: 'OUT = −0.5 V to −2.5 V (below unipolar VCA floor)',
          activeDesc: 'OUT > 0 V (VCA snaps open cleanly)',
        },
        jacks: {
          in: { state: 'active', note: 'Detector key signal into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'active', note: 'Patch OUT → VCA CV In (pushes gain open above threshold)' },
          invOut: { state: 'idle', note: 'Unused in gate / expansion configuration' },
        },
      },
    ],
  },
  {
    slug: '04-ducking-and-blooming-fx',
    mode: 'envelope-follower',
    tagline:
      'Engage SLOW mode (4.87 µF) for multi-second linear reverb blooms or ducking delay throws that stay crystal clear.',
    tags: ['Reverb', 'Delay', 'Ambient', 'SLOW Mode'],
    companionModules: ['Mult', 'VCA', 'Reverb / Delay', 'Mixer'],
    presets: [
      {
        id: 'fx-ducking',
        name: 'A. Ducking Reverb / Delay Send',
        summary:
          'INV OUT ducks the wet FX send/return during busy phrases, then swells open organically into musical rests.',
        knobs: {
          gain: {
            tick: 0,
            range: [6, 8],
            positionLabel: "7 o'clock → dial up (1–3 o'clock)",
            effect: 'Set until active phrases pull + / − LED to Dark (0 V wet)',
          },
          atk: {
            tick: 1,
            range: [0.5, 2],
            positionLabel: "7:30–9 o'clock (5–20%)",
            effect: '3–30 ms (SLOW) — ducks wet wash gently as notes start',
          },
          rel: {
            tick: 5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: '150–450 ms (SLOW) — FX swells organically into musical rests',
          },
          offset: {
            tick: 0,
            range: [0, 0],
            positionLabel: "7 o'clock (Full CCW, −)",
            effect: 'INV OUT rests at +4.98 V (steady Red LED = full FX tail)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Eliminates low-frequency CV ripple on delicate delay/reverb tails',
          },
          sw2: {
            state: 'SLOW',
            label: 'UP (SLOW)',
            effect: '4.87 µF timing cap for lush multi-hundred-ms return swells',
          },
        },
        led: {
          idleState: 'red',
          activeState: 'dark',
          label: 'Steady Red (tails open) → Dark (dry while playing)',
          idleDesc: 'INV OUT = +4.98 V (reverb/delay return open)',
          activeDesc: 'INV OUT dips to 0.00 V during active lead notes',
        },
        jacks: {
          in: { state: 'active', note: 'Dry lead / synth key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'idle', note: 'Optional: cross-duck dry VCA for morphing clouds' },
          invOut: { state: 'active', note: 'Patch INV OUT → FX Send or Wet Return VCA CV' },
        },
      },
      {
        id: 'fx-bloom',
        name: 'B. Multi-Second Ambient Bloom',
        summary:
          '1.0–3.00 s linear attack ignores short staccato plucks and blooms huge shimmer only on held chords.',
        knobs: {
          gain: {
            tick: 8,
            range: [7, 9],
            positionLabel: "2–4 o'clock (65–90%)",
            effect: 'Ensures sustained notes hold OUT near +5 V (Bright Green)',
          },
          atk: {
            tick: 8.5,
            range: [7, 10],
            positionLabel: "2–5 o'clock (65–100%)",
            effect: '1.0 s – 3.00 s linear rise (SLOW) — ignores short staccato plucks!',
          },
          rel: {
            tick: 8,
            range: [6, 10],
            positionLabel: "1–5 o'clock (55–100%)",
            effect: '0.4 s – 1.84 s fall (SLOW) — gradual fading shimmer decay',
          },
          offset: {
            tick: 5,
            range: [4, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V baseline (or slightly CCW for delayed bloom threshold)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Ultra-clean, click-free CV sweep into reverb pitch/feedback',
          },
          sw2: {
            state: 'SLOW',
            label: 'UP (SLOW)',
            effect: 'Essential for 1–3 s ambient swell times (10.36× slower than FAST)',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'bright-green',
          label: 'Dark (dry staccato) → Slow Bright Green (3 s bloom)',
          idleDesc: 'OUT = 0.00 V during silence or quick staccato notes',
          activeDesc: 'OUT climbs linearly up to +5 V over 1–3 seconds',
        },
        jacks: {
          in: { state: 'active', note: 'Pad / chord / lead voice key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'active', note: 'Patch OUT → Reverb Wet Mix, Shimmer, or Feedback CV' },
          invOut: {
            state: 'optional',
            note: 'Optional: attenuate to Dry VCA CV for push-pull wash',
          },
        },
      },
    ],
  },
  {
    slug: '05-cross-modulation-push-pull',
    mode: 'envelope-follower',
    tagline:
      'Drive opposite stereo panning, dual-VCF vowel morphs, or rhythmic FM/wavefolder grit using 0.1%-matched OUT and INV OUT.',
    tags: ['Stereo', 'Crossfade', 'Wavefolder', 'FM', 'Dual Output'],
    companionModules: ['2× VCAs or Panner / Wavefolder / FM VCO', 'Stereo Mixer'],
    presets: [
      {
        id: 'xmod-pushpull',
        name: 'A. Push-Pull Crossfader / Stereo Panner',
        summary:
          "OFFSET at 9:30 o'clock (−2.5 V) centers a 0–5 V envelope into balanced ±2.5 V bipolar push-pull swing.",
        knobs: {
          gain: {
            tick: 7,
            range: [6, 8],
            positionLabel: "1–3 o'clock (55–80%)",
            effect: 'Dial so peak hits swing OUT up by +5.0 V (0 V → +5 V)',
          },
          atk: {
            tick: 1,
            range: [0.5, 2],
            positionLabel: "7:30–9 o'clock (5–20%)",
            effect: '1–8 ms (FAST) — snappy rhythmic movement',
          },
          rel: {
            tick: 4.5,
            range: [3, 6],
            positionLabel: "10–1 o'clock (30–60%)",
            effect: '10–40 ms (FAST) — musical return swing',
          },
          offset: {
            tick: 2.5,
            range: [0, 5],
            positionLabel: "9:30 o'clock (~25%, −2.5 V)",
            effect: 'Centers 0–5 V envelope into ±2.5 V bipolar swing (Red → Green)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Eliminates audio-rate CV chatter across stereo pans and crossfades',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: '470 nF range (SLOW for lush slow timbre shifts)',
          },
        },
        led: {
          idleState: 'dim-red',
          activeState: 'green',
          label: 'Dim Red (−2.5 V) → Green (+2.5 V) bipolar swing',
          idleDesc: 'OUT = −2.5 V, INV OUT = +2.5 V (panned R / Voice B)',
          activeDesc: 'OUT = +2.5 V, INV OUT = −2.5 V (panned L / Voice A)',
        },
        jacks: {
          in: { state: 'active', note: 'Rhythm / percussion key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'active', note: 'Patch OUT → Target A (Pan L / Wavefolder / VCA A)' },
          invOut: { state: 'active', note: 'Patch INV OUT → Target B (Pan R / Clean / VCA B)' },
        },
      },
      {
        id: 'xmod-harmonic',
        name: 'B. Dynamic Harmonic Animator (Wavefolder / FM)',
        summary:
          'Unipolar 0 → +5–8 V sweep injects metallic wavefold or FM clang on hits; try RAW for octave-doubled growl.',
        knobs: {
          gain: {
            tick: 8,
            range: [7, 9],
            positionLabel: "2–4 o'clock (65–90%)",
            effect: 'Scales loud notes toward +5–8 V (Bright Green)',
          },
          atk: {
            tick: 0.5,
            range: [0, 1.5],
            positionLabel: "7–8:30 o'clock (0–15%)",
            effect: '0.3–4 ms (FAST) — instant harmonic bite on hits',
          },
          rel: {
            tick: 5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: '20–80 ms (FAST) — metallic harmonics bloom and recede smoothly',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V idle (clean unmodulated timbre at rest)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            alt: 'RAW',
            effect: 'Clean, smooth timbral tracking (try RAW for gritty FM cross-mod!)',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: 'Crisp note-by-note dynamics',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'bright-green',
          label: 'Dark (clean rest) → Bright Green (harmonic peak)',
          idleDesc: 'OUT = 0.00 V (unmodulated carrier / wavefolder)',
          activeDesc: 'OUT = +5 V to +8 V (maximum fold / FM index)',
        },
        jacks: {
          in: { state: 'active', note: 'Drum loop / beat key into IN' },
          slewIn: { state: 'idle', note: 'Leave SLEW IN unpatched' },
          out: { state: 'active', note: 'Patch OUT → Wavefolder Fold CV or FM VCA CV' },
          invOut: {
            state: 'optional',
            note: 'Optional: complementary duck on clean sub oscillator',
          },
        },
      },
    ],
  },
  {
    slug: '06-audio-rate-slew-waveshaping',
    mode: 'asymmetric-skew-limiter',
    tagline:
      'Bypass the rectifier at audio rates to morph square waves into triangles, asymmetric saws, and amplitude-reactive sub-harmonic fuzz.',
    tags: ['Waveshaper', 'Audio-Rate', 'Nonlinear LPF', 'Sub-Harmonics'],
    companionModules: ['VCO (audio source)', 'Mixer / VCA', 'Optional Wavefolder / Oscilloscope'],
    presets: [
      {
        id: 'audio-slew-main',
        name: 'Audio-Rate Waveshaper & Nonlinear LPF',
        summary:
          'RAW + FAST mandatory! GAIN and IN are disconnected at the SLEW IN jack normaling switch.',
        knobs: {
          gain: {
            tick: 0,
            range: [0, 0],
            bypassed: true,
            positionLabel: 'Bypassed (disconnected)',
            effect: 'Ignored — patching SLEW IN breaks the normal from IN + GAIN',
          },
          atk: {
            tick: 0,
            range: [0, 3],
            positionLabel: "7 o'clock (Full CCW) → 10 o'clock",
            effect: '1 kΩ floor (0.47 ms full 10 Vpp rise in FAST); raise to skew rising edge',
          },
          rel: {
            tick: 0,
            range: [0, 4],
            positionLabel: "7 o'clock (Full CCW) → 11 o'clock",
            effect:
              '1 kΩ floor (0.47 ms full 10 Vpp fall in FAST); raise for downward ramp / sub-harmonics',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect:
              '0.00 V DC offset so output audio stays centered (shift before DC wavefolder!)',
          },
        },
        switches: {
          sw1: {
            state: 'RAW',
            label: 'DOWN (RAW) — Mandatory!',
            mandatory: true,
            effect: 'Bypasses the 29.0 Hz SMOOTH LPF so audio passes cleanly',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            effect: 'Selects 470 nF cap (SLOW drops cutoff 10.36× into sub-audio!)',
          },
        },
        led: {
          idleState: 'amber',
          activeState: 'amber',
          label: 'Blended Amber (high-speed R/G alternation)',
          idleDesc: 'Rapid bipolar ±5 V audio swings blend Red & Green into Amber',
          activeDesc: 'Shifts toward Green or Red if OFFSET or ATK/REL skews waveform duty',
        },
        jacks: {
          in: { state: 'bypassed', note: 'Bypassed (normal broken by SLEW IN)' },
          slewIn: { state: 'active', note: 'Patch VCO square/saw (±5 V, 100–300 Hz) into SLEW IN' },
          out: { state: 'active', note: 'Patch OUT → Mixer / VCA (turn mixer down first!)' },
          invOut: {
            state: 'optional',
            note: 'Optional: inverted phase copy for stereo wide-phase split',
          },
        },
      },
    ],
  },
  {
    slug: '07-asymmetric-portamento-slides',
    mode: 'asymmetric-skew-limiter',
    tagline:
      'Put classic ~70 ms/octave TB-303 acid slides right at noon in SLOW mode, or split ATK and REL for upward scoops and downward drops.',
    tags: ['Portamento', '303 Slide', '1V/Oct', 'Glide'],
    companionModules: ['Sequencer / Keyboard (1V/Oct)', 'VCO'],
    presets: [
      {
        id: 'porta-303',
        name: 'Classic 303 Acid Slides (Symmetrical)',
        summary:
          'SLOW mode puts 70.8 ms/oct upward and 64.6 ms/oct downward glide right at 12 o’clock.',
        knobs: {
          gain: {
            tick: 0,
            range: [0, 0],
            bypassed: true,
            positionLabel: 'Bypassed (disconnected)',
            effect: 'Ignored when SLEW IN is patched',
          },
          atk: {
            tick: 5,
            range: [4, 6],
            positionLabel: "12 o'clock (50%)",
            effect: '~70.8 ms / octave upward glide in SLOW (~6.8 ms/oct in FAST)',
          },
          rel: {
            tick: 5,
            range: [4, 6],
            positionLabel: "12 o'clock (50%)",
            effect: '~64.6 ms / octave downward glide in SLOW (~6.2 ms/oct in FAST)',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V baseline (or turn intentionally to transpose ±5 octaves!)',
          },
        },
        switches: {
          sw1: {
            state: 'RAW',
            label: 'DOWN (RAW)',
            alt: 'SMOOTH',
            effect: 'Crisp linear ramps (UP SMOOTH rounds slide corners into S-curves)',
          },
          sw2: {
            state: 'SLOW',
            label: 'UP (SLOW)',
            effect: '4.87 µF cap puts classic 303 slides across the middle of the knobs',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'green',
          label: 'Tracks pitch polarity (Green > 0 V, Dark 0 V, Red < 0 V)',
          idleDesc: 'Dark at 0 V root note',
          activeDesc: 'Brightens Green as pitch climbs into higher octaves',
        },
        jacks: {
          in: { state: 'bypassed', note: 'Bypassed (normal broken by SLEW IN)' },
          slewIn: { state: 'active', note: 'Patch Sequencer / Keyboard 1V/Oct CV into SLEW IN' },
          out: { state: 'active', note: 'Patch OUT → VCO 1 1V/Oct In (tune VCO inline!)' },
          invOut: {
            state: 'optional',
            note: 'Optional: patch INV OUT → VCO 2 for contrary-motion harmony',
          },
        },
      },
      {
        id: 'porta-scoop',
        name: 'Asymmetric Upward Vocal Scoop',
        summary:
          'Upward accents glide expressively (~70 ms/oct) while downward jumps to root notes snap tight (0.43 ms/oct).',
        knobs: {
          gain: {
            tick: 0,
            range: [0, 0],
            bypassed: true,
            positionLabel: 'Bypassed (disconnected)',
            effect: 'Ignored when SLEW IN is patched',
          },
          atk: {
            tick: 5,
            range: [4, 6],
            positionLabel: "11–1 o'clock (40–60%)",
            effect: '~45–100 ms/oct expressive upward glide into high accents',
          },
          rel: {
            tick: 0,
            range: [0, 0],
            positionLabel: "7 o'clock (Full CCW)",
            effect: '0.43 ms/oct instant downward snap onto bass root notes',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V zero transpose',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: '29.0 Hz T-filter gently rounds slide corners into analog S-curves',
          },
          sw2: {
            state: 'SLOW',
            label: 'UP (SLOW)',
            effect: '4.87 µF range for vocal and bassline portamento',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'green',
          label: 'Tracks pitch polarity (Green +oct / Red −oct)',
          idleDesc: 'Dark at 0 V pitch center',
          activeDesc: 'Smoothly brightens as upward vocal scoop rises',
        },
        jacks: {
          in: { state: 'bypassed', note: 'Bypassed (normal broken by SLEW IN)' },
          slewIn: { state: 'active', note: 'Patch Sequencer / Keyboard 1V/Oct CV into SLEW IN' },
          out: { state: 'active', note: 'Patch OUT → VCO 1 1V/Oct In' },
          invOut: {
            state: 'optional',
            note: 'Optional: VCO 2 mirror harmony or VCF Cutoff tracking',
          },
        },
      },
    ],
  },
  {
    slug: '08-gate-to-ar-envelope-and-slewed-mod',
    mode: 'asymmetric-skew-limiter',
    tagline:
      'Turn any gate, trigger, S&H random voltage, or square LFO into a linear AR/ASR envelope, woody vactrol curve, or morphing saw/triangle LFO.',
    tags: ['AR Envelope', 'ASR', 'S&H Smoother', 'LFO Waveshaper', 'Vactrol'],
    companionModules: ['Gate / Trigger, S&H, or Square LFO', 'VCA / VCF / Wavefolder'],
    presets: [
      {
        id: 'gate-ar',
        name: 'A. Linear-Ramp AR / ASR Envelope',
        summary:
          'Turns +5/+8 V gates or triggers into crisp linear attack/release envelopes stopping at exact 0.00 V.',
        knobs: {
          gain: {
            tick: 0,
            range: [0, 0],
            bypassed: true,
            positionLabel: 'Bypassed (disconnected)',
            effect: 'Ignored when SLEW IN is patched',
          },
          atk: {
            tick: 2,
            range: [0.5, 4],
            positionLabel: "7:30–11 o'clock (5–40%)",
            effect: '1–25 ms (FAST) or 10–300 ms (SLOW) linear rise to gate peak',
          },
          rel: {
            tick: 6,
            range: [4, 8],
            positionLabel: "11–3 o'clock (40–75%)",
            effect: '20–100 ms (FAST) or 200 ms–1.0 s (SLOW) linear decay to 0.00 V',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: '0.00 V rest floor (unipolar 0 V → +5/+8 V gates)',
          },
        },
        switches: {
          sw1: {
            state: 'RAW',
            label: 'DOWN (RAW)',
            alt: 'SMOOTH',
            effect: 'RAW = sharp linear peaks; flip UP (SMOOTH) for woody vactrol/LPG curves',
          },
          sw2: {
            state: 'FAST',
            label: 'DOWN (FAST)',
            alt: 'SLOW',
            effect: 'FAST (0.29–289 ms) or SLOW (3 ms–3.00 s)',
          },
        },
        led: {
          idleState: 'dark',
          activeState: 'green',
          label: 'Dark (0.00 V rest) → Green (envelope active)',
          idleDesc: 'Exact 0.00 V stop (VCA dead silent)',
          activeDesc: 'Follows linear rise, sustain hold, and release back to Dark',
        },
        jacks: {
          in: { state: 'bypassed', note: 'Bypassed (normal broken by SLEW IN)' },
          slewIn: { state: 'active', note: 'Patch Gate or Trigger (+5 V / +8 V) into SLEW IN' },
          out: { state: 'active', note: 'Patch OUT → VCA or VCF CV In' },
          invOut: {
            state: 'optional',
            note: 'Optional: simultaneous inverted duck on companion filter/voice',
          },
        },
      },
      {
        id: 'sh-lfo',
        name: 'B. Stepped Random S&H / LFO Waveshaper',
        summary:
          'Morphs staircase S&H into drifting SLOW tides, or turns a 50% square LFO into triangle, ramp-down, or ramp-up saw LFOs.',
        knobs: {
          gain: {
            tick: 0,
            range: [0, 0],
            bypassed: true,
            positionLabel: 'Bypassed (disconnected)',
            effect: 'Ignored when SLEW IN is patched',
          },
          atk: {
            tick: 5.5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: 'Sets upward ramp slope (slow ATK + fast REL = rising saw LFO!)',
          },
          rel: {
            tick: 5.5,
            range: [4, 7],
            positionLabel: "11–2 o'clock (40–65%)",
            effect: 'Sets downward ramp slope (fast ATK + slow REL = falling saw LFO!)',
          },
          offset: {
            tick: 5,
            range: [5, 5],
            positionLabel: "12 o'clock (Center Detent)",
            effect: 'Centers bipolar ±5 V S&H/LFO (Red ↔ Green LED)',
          },
        },
        switches: {
          sw1: {
            state: 'SMOOTH',
            label: 'UP (SMOOTH)',
            effect: 'Rounds stepped corner artifacts for ultra-silky modulation',
          },
          sw2: {
            state: 'SLOW',
            label: 'UP (SLOW)',
            alt: 'FAST',
            effect: 'SLOW creates multi-second drifting tides (FAST for 0.5–10 Hz LFOs)',
          },
        },
        led: {
          idleState: 'dim-red',
          activeState: 'green',
          label: 'Red ↔ Green bipolar CV tracking',
          idleDesc: 'Glows Red when stepped random or LFO dips negative',
          activeDesc: 'Swings smoothly through Dark into Green on positive steps',
        },
        jacks: {
          in: { state: 'bypassed', note: 'Bypassed (normal broken by SLEW IN)' },
          slewIn: { state: 'active', note: 'Patch S&H or Square LFO into SLEW IN' },
          out: { state: 'active', note: 'Patch OUT → VCF Cutoff, Wavetable, or Reverb Mix CV' },
          invOut: {
            state: 'optional',
            note: 'Optional: inverse modulation curve to second parameter',
          },
        },
      },
    ],
  },
];

const VALID_MODES = new Set<PatchMode>(['envelope-follower', 'asymmetric-skew-limiter']);
const VALID_LEDS = new Set<LedState>([
  'green',
  'bright-green',
  'red',
  'dim-red',
  'dark',
  'amber',
]);
const VALID_JACKS = new Set<JackState>(['active', 'optional', 'idle', 'bypassed']);

/** Look up one PatchStateEntry by its 1:1 filename slug. */
export function getPatchStateBySlug(slug: string): PatchStateEntry | undefined {
  return PATCH_STATES.find((entry) => entry.slug === slug);
}

/** Accessible text + symbol representation for all 6 bi-color LED states (never color-only). */
export function ledBadgeInfo(state: LedState): LedBadgeDescriptor {
  switch (state) {
    case 'bright-green':
      return { symbol: '◉', text: 'BRIGHT GREEN (+V)', pillColor: 'green' };
    case 'green':
      return { symbol: '●', text: 'GREEN (+V)', pillColor: 'green' };
    case 'red':
      return { symbol: '●', text: 'RED (−V)', pillColor: 'red' };
    case 'dim-red':
      return { symbol: '◐', text: 'DIM RED (−V)', pillColor: 'red' };
    case 'amber':
      return { symbol: '◈', text: 'BLENDED AMBER (±V)', pillColor: 'amber' };
    case 'dark':
    default:
      return { symbol: '○', text: 'DARK (0 V)', pillColor: 'dark' };
  }
}

/** Validate patch-state sidecar entries against all bounds and enum invariants. */
export function validatePatchStates(entries: readonly PatchStateEntry[]): string[] {
  const errors: string[] = [];

  for (const entry of entries) {
    if (!VALID_MODES.has(entry.mode)) {
      errors.push(`${entry.slug}: invalid mode "${String(entry.mode)}"`);
    }
    if (!entry.presets.length) {
      errors.push(`${entry.slug}: must define at least one preset`);
    }

    for (const preset of entry.presets) {
      for (const [knobName, knob] of Object.entries(preset.knobs)) {
        if (!Number.isFinite(knob.tick) || knob.tick < 0 || knob.tick > 10) {
          errors.push(`${entry.slug}/${preset.id}: ${knobName}.tick out of [0,10]: ${knob.tick}`);
        }
        if (
          !Array.isArray(knob.range) ||
          knob.range.length !== 2 ||
          knob.range[0] < 0 ||
          knob.range[1] > 10 ||
          knob.range[0] > knob.range[1]
        ) {
          errors.push(
            `${entry.slug}/${preset.id}: ${knobName}.range invalid: ${JSON.stringify(knob.range)}`,
          );
        }
      }

      if (preset.switches.sw1.state !== 'SMOOTH' && preset.switches.sw1.state !== 'RAW') {
        errors.push(`${entry.slug}/${preset.id}: invalid sw1 state`);
      }
      if (preset.switches.sw2.state !== 'SLOW' && preset.switches.sw2.state !== 'FAST') {
        errors.push(`${entry.slug}/${preset.id}: invalid sw2 state`);
      }

      if (!VALID_LEDS.has(preset.led.idleState)) {
        errors.push(`${entry.slug}/${preset.id}: invalid idle LED state ${preset.led.idleState}`);
      }
      if (!VALID_LEDS.has(preset.led.activeState)) {
        errors.push(
          `${entry.slug}/${preset.id}: invalid active LED state ${preset.led.activeState}`,
        );
      }

      for (const [jackName, jack] of Object.entries(preset.jacks)) {
        if (!VALID_JACKS.has(jack.state)) {
          errors.push(
            `${entry.slug}/${preset.id}: invalid jack state for ${jackName}: ${jack.state}`,
          );
        }
      }
    }
  }

  return errors;
}
