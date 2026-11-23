# ENV / SKEW

A 6 HP Eurorack envelope follower and active asymmetric skew limiter module, its fabrication documentation, and its companion GitHub Pages site.

## Hardware & Modes

**ENV / SKEW**:
The canonical short panel name for the 6 HP Eurorack Envelope Follower & Asymmetric Skew Limiter module.
_Avoid_: EnvFollower, EFSL, SkewFollower

**Envelope Follower Mode**:
The module operating mode when audio is patched into `IN` and `SLEW IN` is unpatched, routing the preamplified, full-wave rectified signal into the active skew limiter.
_Avoid_: Audio mode, normal mode, default mode

**Asymmetric Skew Limiter Mode**:
The module operating mode when a cable is patched into `SLEW IN`, breaking the internal normal from `IN` and routing DC-coupled bipolar CV or audio directly into the active skew limiter with independent rise (`ATK`) and fall (`REL`) rates.
_Avoid_: Slew mode, portamento mode, CV mode

## Site Content Archetypes

**Curated Page**:
A site-authored overview or narrative page (such as the landing showcase, hardware showcase, origin story, or downloads hub) designed for human orientation rather than raw specification dumps.
_Avoid_: Landing doc, summary doc, custom page

**Patch Guide**:
A single-source Eurorack patch walkthrough documenting a musical technique on `ENV / SKEW`, paired on the site with a front-panel state visual.
_Avoid_: Recipe, preset, tutorial

**Build Checklist**:
An ordered step-by-step ordering, inspection, assembly, or bringup checklist for fabricating and testing a physical module.
_Avoid_: Build doc, assembly guide, SOP

**Reference Spec**:
A complete engineering, circuit-review, or mechanical specification rendered in full on the site for deep technical inspection.
_Avoid_: Raw doc, long spec, whitepaper

**Static Passthrough**:
An unmodified fabrication archive, schematic PDF, interactive BOM, or media artifact hosted verbatim alongside the site.
_Avoid_: Asset copy, raw file, binary blob
