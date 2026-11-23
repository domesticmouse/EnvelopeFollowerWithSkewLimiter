// THROWAWAY UI PROTOTYPE (Issue #10): Native Web Component <env-skew-panel>
// Renders real vector layers from /panel_art/front_soldermask.svg and /panel_art/front_silkscreen.svg
// with interactive 11-tick knob pointers, sweet-spot arcs, SPDT toggle bats, bi-color LED, and jacks.

const SVG_NS = "http://www.w3.org/2000/svg";

const CONTROL_COORDS = {
  rv1: { x: 15.0, y: 21.25, kind: "pot", label: "GAIN" },
  rv2: { x: 15.0, y: 36.75, kind: "pot", label: "ATK" },
  rv3: { x: 15.0, y: 52.25, kind: "pot", label: "REL" },
  rv4: { x: 15.0, y: 67.75, kind: "pot", label: "OFFSET" },
  sw1: { x: 7.0, y: 82.25, kind: "switch", label: "SMOOTH / RAW" },
  led1: { x: 15.0, y: 82.25, kind: "led", label: "+ / − LED" },
  sw2: { x: 23.0, y: 82.25, kind: "switch", label: "SLOW / FAST" },
  j1: { x: 8.0, y: 95.75, kind: "jack", label: "IN" },
  j2: { x: 22.0, y: 95.75, kind: "jack", label: "SLEW IN" },
  j3: { x: 8.0, y: 110.75, kind: "jack", label: "OUT" },
  j4: { x: 22.0, y: 110.75, kind: "jack", label: "INV OUT" }
};

let cachedLayersPromise = null;

async function loadFaceplateLayers() {
  if (cachedLayersPromise) return cachedLayersPromise;
  cachedLayersPromise = (async () => {
    try {
      const [maskRes, silkRes] = await Promise.all([
        fetch("/panel_art/front_soldermask.svg"),
        fetch("/panel_art/front_silkscreen.svg")
      ]);
      if (!maskRes.ok || !silkRes.ok) {
        throw new Error("Failed to fetch panel_art SVGs");
      }
      const [maskText, silkText] = await Promise.all([maskRes.text(), silkRes.text()]);
      const parser = new DOMParser();
      const maskDoc = parser.parseFromString(maskText, "image/svg+xml");
      const silkDoc = parser.parseFromString(silkText, "image/svg+xml");

      const goldLayer = maskDoc.getElementById("_01_F_Mask_Gold");
      const whiteLayer = silkDoc.getElementById("_02_F_SilkS_White");

      if (!goldLayer || !whiteLayer) {
        throw new Error("Missing expected panel SVG layer groups");
      }

      const recolorGroup = (group, color) => {
        const clone = group.cloneNode(true);
        clone.querySelectorAll("[fill]").forEach((el) => {
          if (el.getAttribute("fill") !== "none") {
            el.setAttribute("fill", color);
          }
        });
        clone.querySelectorAll("[stroke]").forEach((el) => {
          if (el.getAttribute("stroke") !== "none") {
            el.setAttribute("stroke", color);
          }
        });
        return clone;
      };

      const goldClone = recolorGroup(goldLayer, "#D8B154");
      // Mark the IN -> SLEW IN normaling arrow polygon so we can dim it in Skew Limiter mode
      goldClone.querySelectorAll("polygon").forEach((poly) => {
        const pts = (poly.getAttribute("points") || "").trim();
        if (pts.startsWith("13.45,95.47")) {
          poly.setAttribute("data-normal-arrow", "true");
        }
      });

      const whiteClone = recolorGroup(whiteLayer, "#F4F5F7");
      return { goldClone, whiteClone };
    } catch (err) {
      console.warn("Falling back to simplified faceplate graphics:", err);
      return null;
    }
  })();
  return cachedLayersPromise;
}

function tickToDeg(tick) {
  return -150 + Number(tick || 0) * 30;
}

function polarPoint(cx, cy, r, degFrom12) {
  const rad = ((degFrom12 - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeArc(cx, cy, r, tickStart, tickEnd) {
  const startDeg = tickToDeg(tickStart);
  const endDeg = tickToDeg(tickEnd);
  if (Math.abs(endDeg - startDeg) < 1) return "";
  const p1 = polarPoint(cx, cy, r, startDeg);
  const p2 = polarPoint(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

function ledStyleForState(state) {
  switch (state) {
    case "bright-green":
      return { core: "#4ADE80", rim: "#22C55E", glowOpacity: 0.9, label: "Bright Green (+V)" };
    case "green":
      return { core: "#4ADE80", rim: "#16A34A", glowOpacity: 0.72, label: "Green (+V)" };
    case "red":
      return { core: "#F87171", rim: "#EF4444", glowOpacity: 0.78, label: "Steady Red (−V)" };
    case "dim-red":
      return { core: "#EF4444", rim: "#991B1B", glowOpacity: 0.42, label: "Dim Red (−V)" };
    case "amber":
      return { core: "#FBBF24", rim: "#D97706", glowOpacity: 0.8, label: "Blended Amber (±V)" };
    case "dark":
    default:
      return { core: "#1B1E25", rim: "#363B47", glowOpacity: 0.0, label: "Dark (0.00 V)" };
  }
}

export class EnvSkewPanel extends HTMLElement {
  #root;
  #preset = null;
  #signalState = "idle";
  #activeControl = null;
  #spotlightControls = null;
  #size = "full";
  #svgBuilt = false;
  #layersMounted = false;
  #controlGroups = new Map();
  #normalArrowEl = null;
  #normalBreakEl = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  static get observedAttributes() {
    return ["size", "signal-state", "active-control"];
  }

  connectedCallback() {
    this.#size = this.getAttribute("size") === "mini" ? "mini" : "full";
    this.#signalState = this.getAttribute("signal-state") === "active" ? "active" : "idle";
    this.#activeControl = this.getAttribute("active-control") || null;
    if (!this.#svgBuilt) {
      this.#buildBaseDom();
    }
    this.#renderState();
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (name === "size") {
      this.#size = newVal === "mini" ? "mini" : "full";
      if (this.#svgBuilt) {
        this.#syncInteractivity();
        this.#renderState();
      }
    } else if (name === "signal-state") {
      this.#signalState = newVal === "active" ? "active" : "idle";
      this.#renderState();
    } else if (name === "active-control") {
      this.#activeControl = newVal || null;
      this.#renderState();
    }
  }

  set preset(val) {
    this.#preset = val;
    this.#renderState();
  }

  get preset() {
    return this.#preset;
  }

  set signalState(val) {
    this.#signalState = val === "active" ? "active" : "idle";
    this.#renderState();
  }

  get signalState() {
    return this.#signalState;
  }

  set activeControl(val) {
    this.#activeControl = val || null;
    this.#renderState();
  }

  get activeControl() {
    return this.#activeControl;
  }

  set spotlightControls(val) {
    this.#spotlightControls = Array.isArray(val) && val.length ? val : null;
    this.#renderState();
  }

  get spotlightControls() {
    return this.#spotlightControls;
  }

  #buildBaseDom() {
    this.#svgBuilt = true;
    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        aspect-ratio: 30 / 128.5;
        inline-size: 100%;
        user-select: none;
      }
      svg {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        overflow: visible;
      }
      .knob-rotator {
        transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .ctrl-group {
        transition: opacity 180ms ease;
      }
      .ctrl-group.is-dimmed {
        opacity: 0.28;
      }
      .ctrl-interactive {
        cursor: pointer;
        outline: none;
      }
      .ctrl-hit-ring {
        fill: transparent;
        stroke: transparent;
        stroke-width: 0.55;
        transition: stroke 140ms ease, fill 140ms ease;
      }
      .ctrl-interactive:hover .ctrl-hit-ring,
      .ctrl-interactive:focus-visible .ctrl-hit-ring {
        stroke: #E2BE66;
        fill: rgba(216, 177, 84, 0.12);
      }
      .ctrl-group.is-highlighted .ctrl-hit-ring,
      .ctrl-group.is-spotlighted .ctrl-hit-ring {
        stroke: #E2BE66;
        stroke-width: 0.65;
        fill: rgba(216, 177, 84, 0.16);
      }
      .ctrl-interactive:focus-visible {
        outline: none;
      }
      .ctrl-group.is-mandatory-alert .ctrl-hit-ring {
        stroke: #F87171;
        stroke-width: 0.65;
      }
      @media (prefers-reduced-motion: reduce) {
        .knob-rotator,
        .ctrl-group,
        .ctrl-hit-ring {
          transition: none;
        }
      }
      @media (forced-colors: active) {
        .panel-substrate {
          stroke: CanvasText;
          stroke-width: 0.4;
        }
        .ctrl-interactive:focus-visible .ctrl-hit-ring,
        .ctrl-group.is-highlighted .ctrl-hit-ring,
        .ctrl-group.is-spotlighted .ctrl-hit-ring {
          stroke: Highlight;
        }
      }
    `;

    const svg = svgEl("svg", {
      viewBox: "0 0 30.00 128.50",
      role: this.#size === "mini" ? "presentation" : "group",
      "aria-label": this.#size === "mini" ? null : "ENV / SKEW interactive 6 HP front panel"
    });
    if (this.#size === "mini") {
      svg.setAttribute("aria-hidden", "true");
    }

    const defs = svgEl("defs");
    const ledGlow = svgEl("radialGradient", { id: "led-glow-grad", cx: "50%", cy: "50%", r: "50%" });
    ledGlow.append(
      svgEl("stop", { offset: "0%", "stop-color": "#4ADE80", "stop-opacity": "0.95" }),
      svgEl("stop", { offset: "55%", "stop-color": "#4ADE80", "stop-opacity": "0.4" }),
      svgEl("stop", { offset: "100%", "stop-color": "#4ADE80", "stop-opacity": "0" })
    );

    const knobGrad = svgEl("radialGradient", { id: "knob-cap-grad", cx: "38%", cy: "35%", r: "65%" });
    knobGrad.append(
      svgEl("stop", { offset: "0%", "stop-color": "#2E3340" }),
      svgEl("stop", { offset: "75%", "stop-color": "#191B22" }),
      svgEl("stop", { offset: "100%", "stop-color": "#101115" })
    );

    const nutGrad = svgEl("radialGradient", { id: "jack-nut-grad", cx: "40%", cy: "35%", r: "70%" });
    nutGrad.append(
      svgEl("stop", { offset: "0%", "stop-color": "#585E6E" }),
      svgEl("stop", { offset: "100%", "stop-color": "#252932" })
    );

    defs.append(ledGlow, knobGrad, nutGrad);
    svg.append(defs);

    // Matte Black FR4 substrate
    const bgGroup = svgEl("g", { class: "panel-bg" });
    bgGroup.append(
      svgEl("rect", {
        class: "panel-substrate",
        x: "0",
        y: "0",
        width: "30",
        height: "128.5",
        rx: "0.4",
        fill: "#141518",
        stroke: "#2A2E38",
        "stroke-width": "0.25"
      })
    );

    // NPTH Mounting slots H1 & H2 (5.50 x 3.20 mm)
    for (const cy of [3.0, 125.5]) {
      bgGroup.append(
        svgEl("rect", {
          x: (7.5 - 2.95).toFixed(2),
          y: (cy - 1.8).toFixed(2),
          width: "5.9",
          height: "3.6",
          rx: "1.8",
          fill: "#262A34",
          stroke: "#464C5C",
          "stroke-width": "0.18"
        }),
        svgEl("rect", {
          x: (7.5 - 2.75).toFixed(2),
          y: (cy - 1.6).toFixed(2),
          width: "5.5",
          height: "3.2",
          rx: "1.6",
          fill: "#090A0D"
        })
      );
    }

    const faceplateHost = svgEl("g", { class: "faceplate-layers" });
    const normalBreak = svgEl("g", { class: "normal-break-overlay", opacity: "0" });
    normalBreak.append(
      svgEl("line", { x1: "13.9", y1: "94.6", x2: "16.1", y2: "96.9", stroke: "#F87171", "stroke-width": "0.55", "stroke-linecap": "round" }),
      svgEl("line", { x1: "16.1", y1: "94.6", x2: "13.9", y2: "96.9", stroke: "#F87171", "stroke-width": "0.55", "stroke-linecap": "round" })
    );
    this.#normalBreakEl = normalBreak;

    const controlsLayer = svgEl("g", { class: "controls-layer" });

    // Build each control group once so knob rotations animate smoothly across state changes
    for (const [id, meta] of Object.entries(CONTROL_COORDS)) {
      const g = svgEl("g", { class: "ctrl-group", "data-control": id });
      const ringRadius = meta.kind === "pot" ? 6.55 : meta.kind === "jack" ? 4.45 : meta.kind === "led" ? 3.55 : 3.7;
      g.append(
        svgEl("circle", {
          class: "ctrl-hit-ring",
          cx: meta.x,
          cy: meta.y,
          r: ringRadius
        })
      );

      if (meta.kind === "pot") {
        const arc = svgEl("path", {
          class: "knob-range-arc",
          fill: "none",
          stroke: "#E2BE66",
          "stroke-width": "0.95",
          "stroke-linecap": "round",
          opacity: "0.85"
        });
        const bezel = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "4.75",
          fill: "#0B0C0F",
          stroke: "#3A3F4D",
          "stroke-width": "0.22"
        });
        const cap = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "4.35",
          fill: "url(#knob-cap-grad)",
          stroke: "#484F61",
          "stroke-width": "0.2"
        });
        const rotator = svgEl("g", { class: "knob-rotator", style: `transform-origin: ${meta.x}px ${meta.y}px` });
        rotator.append(
          svgEl("line", {
            class: "knob-pointer",
            x1: meta.x,
            y1: meta.y - 1.1,
            x2: meta.x,
            y2: meta.y - 4.15,
            stroke: "#F4F5F7",
            "stroke-width": "0.95",
            "stroke-linecap": "round"
          }),
          svgEl("circle", {
            cx: meta.x,
            cy: meta.y,
            r: "0.85",
            fill: "#303542"
          })
        );
        const bypassBadge = svgEl("g", { class: "bypass-overlay", opacity: "0" });
        bypassBadge.append(
          svgEl("line", {
            x1: meta.x - 4.0,
            y1: meta.y + 4.0,
            x2: meta.x + 4.0,
            y2: meta.y - 4.0,
            stroke: "#F87171",
            "stroke-width": "0.65",
            "stroke-linecap": "round"
          }),
          svgEl("rect", {
            x: meta.x - 5.2,
            y: meta.y - 1.35,
            width: "10.4",
            height: "2.7",
            rx: "0.5",
            fill: "#2C1416",
            stroke: "#F87171",
            "stroke-width": "0.22"
          }),
          (() => {
            const txt = svgEl("text", {
              x: meta.x,
              y: meta.y + 0.65,
              "text-anchor": "middle",
              "font-family": "IBM Plex Mono, monospace",
              "font-size": "1.85",
              "font-weight": "700",
              fill: "#F87171"
            });
            txt.textContent = "BYPASS";
            return txt;
          })()
        );
        g.append(arc, bezel, cap, rotator, bypassBadge);
      } else if (meta.kind === "switch") {
        const nut = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "2.55",
          fill: "url(#jack-nut-grad)",
          stroke: "#6C7387",
          "stroke-width": "0.25"
        });
        const bore = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "1.2",
          fill: "#0B0C0F"
        });
        const batShadow = svgEl("line", {
          class: "toggle-bat-shadow",
          x1: meta.x,
          y1: meta.y,
          x2: meta.x,
          y2: meta.y - 2.6,
          stroke: "#090A0D",
          "stroke-width": "1.9",
          "stroke-linecap": "round"
        });
        const bat = svgEl("line", {
          class: "toggle-bat",
          x1: meta.x,
          y1: meta.y,
          x2: meta.x,
          y2: meta.y - 2.5,
          stroke: "#E2BE66",
          "stroke-width": "1.3",
          "stroke-linecap": "round"
        });
        const batTip = svgEl("circle", {
          class: "toggle-tip",
          cx: meta.x,
          cy: meta.y - 2.5,
          r: "0.85",
          fill: "#F4F5F7"
        });
        const mandatoryTag = svgEl("g", { class: "mandatory-badge", opacity: "0" });
        mandatoryTag.append(
          svgEl("circle", { cx: meta.x + 2.5, cy: meta.y - 2.5, r: "1.25", fill: "#F87171", stroke: "#141518", "stroke-width": "0.25" }),
          (() => {
            const t = svgEl("text", {
              x: meta.x + 2.5,
              y: meta.y - 1.85,
              "text-anchor": "middle",
              "font-family": "IBM Plex Sans, sans-serif",
              "font-size": "1.9",
              "font-weight": "800",
              fill: "#141518"
            });
            t.textContent = "!";
            return t;
          })()
        );
        g.append(nut, bore, batShadow, bat, batTip, mandatoryTag);
      } else if (meta.kind === "led") {
        const halo = svgEl("circle", {
          class: "led-halo",
          cx: meta.x,
          cy: meta.y,
          r: "4.6",
          fill: "url(#led-glow-grad)",
          opacity: "0"
        });
        const bezel = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "1.95",
          fill: "#101216",
          stroke: "#3E4352",
          "stroke-width": "0.22"
        });
        const dome = svgEl("circle", {
          class: "led-dome",
          cx: meta.x,
          cy: meta.y,
          r: "1.55",
          fill: "#1B1E25",
          stroke: "#363B47",
          "stroke-width": "0.2"
        });
        const glint = svgEl("circle", {
          cx: meta.x - 0.45,
          cy: meta.y - 0.45,
          r: "0.42",
          fill: "#FFFFFF",
          opacity: "0.35"
        });
        g.append(halo, bezel, dome, glint);
      } else if (meta.kind === "jack") {
        const collar = svgEl("circle", {
          class: "jack-collar",
          cx: meta.x,
          cy: meta.y,
          r: "3.9",
          fill: "none",
          stroke: "transparent",
          "stroke-width": "0.7"
        });
        const nut = svgEl("circle", {
          class: "jack-nut",
          cx: meta.x,
          cy: meta.y,
          r: "3.1",
          fill: "url(#jack-nut-grad)",
          stroke: "#666D80",
          "stroke-width": "0.24"
        });
        const washer = svgEl("circle", {
          cx: meta.x,
          cy: meta.y,
          r: "2.35",
          fill: "#1E222B",
          stroke: "#4E5466",
          "stroke-width": "0.18"
        });
        const bore = svgEl("circle", {
          class: "jack-bore",
          cx: meta.x,
          cy: meta.y,
          r: "1.55",
          fill: "#07080A"
        });
        const plug = svgEl("circle", {
          class: "jack-plug",
          cx: meta.x,
          cy: meta.y,
          r: "1.65",
          fill: "#D8B154",
          stroke: "#141518",
          "stroke-width": "0.3",
          opacity: "0"
        });
        g.append(collar, nut, washer, bore, plug);
      }

      // Attach listeners for full interactive panels
      g.addEventListener("pointerenter", () => {
        if (this.#size !== "full") return;
        this.dispatchEvent(new CustomEvent("panel-control-hover", { detail: { controlId: id }, bubbles: true, composed: true }));
      });
      g.addEventListener("pointerleave", () => {
        if (this.#size !== "full") return;
        this.dispatchEvent(new CustomEvent("panel-control-hover", { detail: { controlId: null }, bubbles: true, composed: true }));
      });
      g.addEventListener("click", () => {
        if (this.#size !== "full") return;
        this.dispatchEvent(new CustomEvent("panel-control-select", { detail: { controlId: id }, bubbles: true, composed: true }));
      });
      g.addEventListener("keydown", (e) => {
        if (this.#size !== "full") return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.dispatchEvent(new CustomEvent("panel-control-select", { detail: { controlId: id }, bubbles: true, composed: true }));
        }
      });
      g.addEventListener("focus", () => {
        if (this.#size !== "full") return;
        this.dispatchEvent(new CustomEvent("panel-control-hover", { detail: { controlId: id }, bubbles: true, composed: true }));
      });

      this.#controlGroups.set(id, g);
      controlsLayer.append(g);
    }

    svg.append(bgGroup, faceplateHost, normalBreak, controlsLayer);
    this.#root.append(style, svg);
    this.#syncInteractivity();

    loadFaceplateLayers().then((layers) => {
      if (!layers || this.#layersMounted) return;
      this.#layersMounted = true;
      const gold = layers.goldClone.cloneNode(true);
      const white = layers.whiteClone.cloneNode(true);
      this.#normalArrowEl = gold.querySelector('[data-normal-arrow="true"]');
      faceplateHost.append(gold, white);
      this.#renderState();
    });
  }

  #syncInteractivity() {
    const svg = this.#root.querySelector("svg");
    if (!svg) return;
    if (this.#size === "mini") {
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("role", "presentation");
      svg.removeAttribute("aria-label");
    } else {
      svg.removeAttribute("aria-hidden");
      svg.setAttribute("role", "group");
      svg.setAttribute("aria-label", "ENV / SKEW interactive 6 HP front panel");
    }

    for (const [id, g] of this.#controlGroups.entries()) {
      if (this.#size === "mini") {
        g.classList.remove("ctrl-interactive");
        g.removeAttribute("role");
        g.removeAttribute("tabindex");
        g.removeAttribute("aria-label");
        g.removeAttribute("aria-pressed");
      } else {
        g.classList.add("ctrl-interactive");
        g.setAttribute("role", "button");
        g.setAttribute("tabindex", "0");
      }
    }
  }

  #renderState() {
    if (!this.#svgBuilt) return;
    const p = this.#preset;
    if (!p) return;

    const slewBroken = p.jacks?.slewIn?.state === "active";
    if (this.#normalArrowEl) {
      this.#normalArrowEl.setAttribute("opacity", slewBroken ? "0.22" : "1");
    }
    if (this.#normalBreakEl) {
      this.#normalBreakEl.setAttribute("opacity", slewBroken ? "1" : "0");
    }

    // Potentiometers
    const potMap = { rv1: p.knobs.gain, rv2: p.knobs.atk, rv3: p.knobs.rel, rv4: p.knobs.offset };
    for (const [id, data] of Object.entries(potMap)) {
      const g = this.#controlGroups.get(id);
      if (!g) continue;
      const meta = CONTROL_COORDS[id];
      const deg = tickToDeg(data.tick);
      const rotator = g.querySelector(".knob-rotator");
      const arc = g.querySelector(".knob-range-arc");
      const bypass = g.querySelector(".bypass-overlay");
      const pointer = g.querySelector(".knob-pointer");

      if (rotator) {
        rotator.style.transform = `rotate(${deg}deg)`;
      }
      if (arc) {
        if (!data.bypassed && Array.isArray(data.range) && data.range[1] > data.range[0]) {
          arc.setAttribute("d", describeArc(meta.x, meta.y, 5.65, data.range[0], data.range[1]));
          arc.setAttribute("opacity", "0.9");
        } else {
          arc.setAttribute("d", "");
          arc.setAttribute("opacity", "0");
        }
      }
      if (bypass) {
        bypass.setAttribute("opacity", data.bypassed ? "1" : "0");
      }
      if (pointer) {
        pointer.setAttribute("stroke", data.bypassed ? "#585E6E" : "#F4F5F7");
      }
      g.classList.toggle("is-bypassed", Boolean(data.bypassed));
      if (this.#size === "full") {
        g.setAttribute("aria-label", `${meta.label}: ${data.positionLabel}. ${data.effect}`);
      }
    }

    // Switches
    const swMap = {
      sw1: { ...p.switches.sw1, upValue: "SMOOTH" },
      sw2: { ...p.switches.sw2, upValue: "SLOW" }
    };
    for (const [id, data] of Object.entries(swMap)) {
      const g = this.#controlGroups.get(id);
      if (!g) continue;
      const meta = CONTROL_COORDS[id];
      const isUp = data.state === data.upValue;
      const tipY = isUp ? meta.y - 2.55 : meta.y + 2.55;
      const bat = g.querySelector(".toggle-bat");
      const shadow = g.querySelector(".toggle-bat-shadow");
      const tip = g.querySelector(".toggle-tip");
      const mandatory = g.querySelector(".mandatory-badge");
      if (bat) {
        bat.setAttribute("y2", tipY);
        bat.setAttribute("stroke", data.mandatory ? "#F87171" : "#E2BE66");
      }
      if (shadow) shadow.setAttribute("y2", tipY);
      if (tip) tip.setAttribute("cy", tipY);
      if (mandatory) mandatory.setAttribute("opacity", data.mandatory ? "1" : "0");
      g.classList.toggle("is-mandatory-alert", Boolean(data.mandatory));
      if (this.#size === "full") {
        g.setAttribute("aria-label", `${meta.label} toggle: ${data.label}. ${data.effect}`);
      }
    }

    // Bi-color LED
    const ledG = this.#controlGroups.get("led1");
    if (ledG && p.led) {
      const activeKey = this.#signalState === "active" ? p.led.activeState : p.led.idleState;
      const visual = ledStyleForState(activeKey);
      const dome = ledG.querySelector(".led-dome");
      const halo = ledG.querySelector(".led-halo");
      const grad = this.#root.getElementById("led-glow-grad");
      if (dome) {
        dome.setAttribute("fill", visual.core);
        dome.setAttribute("stroke", visual.rim);
      }
      if (grad) {
        grad.querySelectorAll("stop").forEach((stop, idx) => {
          stop.setAttribute("stop-color", visual.core);
          if (idx === 0) stop.setAttribute("stop-opacity", visual.glowOpacity > 0 ? "0.95" : "0");
          if (idx === 1) stop.setAttribute("stop-opacity", visual.glowOpacity > 0 ? "0.42" : "0");
        });
      }
      if (halo) {
        halo.setAttribute("opacity", String(visual.glowOpacity));
      }
      if (this.#size === "full") {
        const desc = this.#signalState === "active" ? p.led.activeDesc : p.led.idleDesc;
        ledG.setAttribute("aria-label", `+ / − LED (${this.#signalState}): ${visual.label}. ${desc}`);
      }
    }

    // Jacks
    const jackMap = { j1: p.jacks.in, j2: p.jacks.slewIn, j3: p.jacks.out, j4: p.jacks.invOut };
    for (const [id, data] of Object.entries(jackMap)) {
      const g = this.#controlGroups.get(id);
      if (!g) continue;
      const meta = CONTROL_COORDS[id];
      const collar = g.querySelector(".jack-collar");
      const plug = g.querySelector(".jack-plug");
      const nut = g.querySelector(".jack-nut");
      if (data.state === "active") {
        collar.setAttribute("stroke", "#E2BE66");
        collar.removeAttribute("stroke-dasharray");
        plug.setAttribute("opacity", "1");
        nut.setAttribute("opacity", "1");
      } else if (data.state === "optional") {
        collar.setAttribute("stroke", "#D8B154");
        collar.setAttribute("stroke-dasharray", "1.2 0.85");
        plug.setAttribute("opacity", "0.25");
        nut.setAttribute("opacity", "0.95");
      } else if (data.state === "bypassed") {
        collar.setAttribute("stroke", "transparent");
        collar.removeAttribute("stroke-dasharray");
        plug.setAttribute("opacity", "0");
        nut.setAttribute("opacity", "0.35");
      } else {
        collar.setAttribute("stroke", "transparent");
        collar.removeAttribute("stroke-dasharray");
        plug.setAttribute("opacity", "0");
        nut.setAttribute("opacity", "0.9");
      }
      if (this.#size === "full") {
        g.setAttribute("aria-label", `${meta.label} jack (${data.state}): ${data.note}`);
      }
    }

    // Spotlighting & active control selection
    const hasSpotlight = Array.isArray(this.#spotlightControls) && this.#spotlightControls.length > 0;
    for (const [id, g] of this.#controlGroups.entries()) {
      const isHighlighted = this.#activeControl === id;
      const isSpotlighted = hasSpotlight && this.#spotlightControls.includes(id);
      const isBypassed = g.classList.contains("is-bypassed") || p.jacks?.[CONTROL_COORDS[id].key]?.state === "bypassed";
      const isDimmed = (hasSpotlight && !isSpotlighted) || (!hasSpotlight && isBypassed);

      g.classList.toggle("is-highlighted", isHighlighted);
      g.classList.toggle("is-spotlighted", isSpotlighted);
      g.classList.toggle("is-dimmed", isDimmed);
      if (this.#size === "full") {
        g.setAttribute("aria-pressed", String(isHighlighted));
      }
    }
  }
}

if (!customElements.get("env-skew-panel")) {
  customElements.define("env-skew-panel", EnvSkewPanel);
}
