/** Operating mode identifier aligned with GLOSSARY.md. */
export type LandingPatchMode = 'envelope-follower' | 'asymmetric-skew-limiter';

/** Declarative bi-color A-1076 LED indicator state for landing preview strips. */
export type LandingLedState = 'green' | 'red' | 'dark';

/** Metadata for one Patch Guide strip rendered on the Landing Showcase (/). */
export interface LandingPatchSummary {
  num: string;
  slug: string;
  title: string;
  mode: LandingPatchMode;
  controls: string;
  summary: string;
  ledState: LandingLedState;
  ledLabel: string;
}

/** Ordered 8 Patch Guides grouped by Envelope Follower Mode (01–05) and Asymmetric Skew Limiter Mode (06–08). */
export const LANDING_PATCHES: readonly LandingPatchSummary[] = [
  {
    num: '01',
    slug: '01-sidechain-ducking',
    title: 'Sidechain Ducking & Pumping',
    mode: 'envelope-follower',
    controls: 'INV OUT · OFFSET (CCW) · SMOOTH · FAST · + / − LED',
    summary:
      'Techno kick-drum pumping by eye: dip the post-offset bi-color LED cleanly from Red to Dark on every beat.',
    ledState: 'red',
    ledLabel: '● RED (−V) → ○ DARK (0 V)',
  },
  {
    num: '02',
    slug: '02-auto-wah-envelope-filter',
    title: 'Auto-Wah & Dynamic Envelope Filter',
    mode: 'envelope-follower',
    controls: 'OUT / INV OUT · ATK · REL · RAW / SMOOTH',
    summary:
      'Upward and reverse dynamic VCF sweeps for funk bass, plucked synths, and resonant acid lines.',
    ledState: 'green',
    ledLabel: '● GREEN (+V Sweep)',
  },
  {
    num: '03',
    slug: '03-compression-expansion-gating',
    title: 'Dynamic Compression, Expansion & Noise Gating',
    mode: 'envelope-follower',
    controls: 'INV OUT (Comp) / OUT (Gate) · OFFSET · ATK · REL',
    summary:
      'Opto-style VCA leveling and threshold noise gating with independent rise and fall timing.',
    ledState: 'red',
    ledLabel: '● RED / ○ DARK Threshold',
  },
  {
    num: '04',
    slug: '04-ducking-and-blooming-fx',
    title: 'Ducking & Blooming Reverb / Delay',
    mode: 'envelope-follower',
    controls: 'INV OUT / OUT · SLOW (4.87 µF) · SMOOTH',
    summary:
      'Keep melodies dry while phrases play, then bloom ambient reverb and delay tails up to 3.00 s.',
    ledState: 'green',
    ledLabel: '● GREEN (3.00 s Swell)',
  },
  {
    num: '05',
    slug: '05-cross-modulation-push-pull',
    title: 'Cross-Modulation & Push-Pull Stereo / Timbral Effects',
    mode: 'envelope-follower',
    controls: 'OUT + INV OUT Simultaneously · OFFSET',
    summary:
      'Complementary stereo panning, dual-voice crossfading, and dynamic FM or wavefolder push-pull.',
    ledState: 'dark',
    ledLabel: '○ DARK (0 V) ↔ ● GREEN / RED',
  },
  {
    num: '06',
    slug: '06-audio-rate-slew-waveshaping',
    title: 'Audio-Rate Slew Waveshaping & Nonlinear LPF',
    mode: 'asymmetric-skew-limiter',
    controls: 'SLEW IN · RAW (mandatory) · FAST · ATK vs REL',
    summary:
      'Patch a VCO into SLEW IN with RAW engaged to sculpt square waves into asymmetric ramps or harmonic fuzz.',
    ledState: 'dark',
    ledLabel: '○ DARK / Blended Audio-Rate',
  },
  {
    num: '07',
    slug: '07-asymmetric-portamento-slides',
    title: 'Asymmetric Portamento & 303-Style Slides',
    mode: 'asymmetric-skew-limiter',
    controls: 'SLEW IN · OFFSET (12 o’clock) · SLOW / FAST',
    summary:
      '1 V/Oct pitch glides with independent upward scoop and downward laser drop rates.',
    ledState: 'green',
    ledLabel: '● GREEN (+Oct) / ● RED (−Oct)',
  },
  {
    num: '08',
    slug: '08-gate-to-ar-envelope-and-slewed-mod',
    title: 'Gate-to-AR Envelope & Slewed Modulation',
    mode: 'asymmetric-skew-limiter',
    controls: 'SLEW IN · ATK · REL · SMOOTH · OUT + INV OUT',
    summary:
      'Convert raw gates into linear AR/ASR envelopes or smooth stepped random and LFO modulation.',
    ledState: 'green',
    ledLabel: '● GREEN (Gate High)',
  },
];

export const ENVELOPE_FOLLOWER_PATCHES = LANDING_PATCHES.filter(
  (patch) => patch.mode === 'envelope-follower',
);

export const SKEW_LIMITER_PATCHES = LANDING_PATCHES.filter(
  (patch) => patch.mode === 'asymmetric-skew-limiter',
);
