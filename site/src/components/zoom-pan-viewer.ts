import { computeFocusTransform, type SchematicBlock } from '../data/hardware-schematic.ts';
import {
  clampPan,
  clampScale,
  computeFitScale,
  zoomAroundPoint,
} from '../lib/zoom-pan-math.ts';

export interface LightboxItem {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  flipLabel?: string;
}

export interface LightboxOptions {
  items: readonly LightboxItem[];
  startIndex?: number;
  mode?: 'gallery' | 'flip';
  title?: string;
  allowNightBlueprint?: boolean;
  nightBlueprint?: boolean;
  onNightBlueprintChange?: (enabled: boolean) => void;
  focusBlocks?: readonly SchematicBlock[];
  activeFocusBlock?: number | null;
}

const VIEWER_STYLES = `
:host {
  display: flex;
  flex-direction: column;
  border: 1px solid #6e7485;
  background: #090a0d;
  color: #e8eaef;
  min-inline-size: 0;
}
:host([mode="modal"]) {
  border: 0;
  flex: 1 1 auto;
  min-block-size: 0;
}
.viewer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.7rem;
  background: #1b1d22;
  border-block-end: 1px solid #2b2f3b;
}
.viewer-btn {
  min-block-size: 34px;
  min-inline-size: 34px;
  padding: 0.25rem 0.6rem;
  background: #1d2028;
  color: #f4f5f7;
  border: 1px solid #6e7485;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.viewer-btn:hover {
  border-color: #d8b154;
  color: #e2be66;
}
.viewer-btn:focus-visible {
  outline: 2px solid #e2be66;
  outline-offset: 2px;
}
.viewer-zoom-readout {
  min-inline-size: 3.8rem;
  text-align: center;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: #d8b154;
}
.viewer-hint {
  margin-inline-start: auto;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  color: #a6acb8;
}
.viewer-stage {
  position: relative;
  overflow: hidden;
  inline-size: 100%;
  block-size: clamp(320px, 58vh, 640px);
  background: #090a0d;
  cursor: grab;
  touch-action: pan-y pinch-zoom;
  outline: none;
}
:host([mode="modal"]) .viewer-stage {
  flex: 1 1 auto;
  block-size: auto;
  min-block-size: 320px;
  touch-action: none;
}
.viewer-stage.is-dragging {
  cursor: grabbing;
}
.viewer-stage:focus-visible {
  box-shadow: inset 0 0 0 2px #e2be66;
}
.viewer-img {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  max-inline-size: none;
  max-block-size: none;
  transform-origin: 0 0;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}
.viewer-img[data-night-blueprint="true"] {
  filter: invert(0.92) hue-rotate(180deg);
}
@media (max-width: 640px) {
  .viewer-hint {
    display: none;
  }
}
@media (forced-colors: active) {
  :host,
  .viewer-btn {
    border-color: CanvasText;
  }
}
@media print {
  .viewer-toolbar {
    display: none !important;
  }
  .viewer-stage {
    block-size: auto !important;
    overflow: visible !important;
    background: #ffffff !important;
  }
  .viewer-img {
    position: static !important;
    transform: none !important;
    max-inline-size: 100% !important;
    block-size: auto !important;
  }
  .viewer-img[data-night-blueprint="true"] {
    filter: none !important;
  }
}
`;

export class ZoomPanViewer extends HTMLElement {
  #root: ShadowRoot;
  #built = false;
  #stageEl: HTMLElement | null = null;
  #imgEl: HTMLImageElement | null = null;
  #readoutEl: HTMLElement | null = null;
  #fullscreenBtn: HTMLButtonElement | null = null;

  #scale = 1;
  #tx = 0;
  #ty = 0;
  #naturalW = 1600;
  #naturalH = 1200;
  #nightBlueprint = false;
  #mode: 'inline' | 'modal' = 'inline';

  #activePointers = new Map<number, { x: number; y: number }>();
  #dragStart: { x: number; y: number; tx: number; ty: number } | null = null;
  #pinchStart: { dist: number; scale: number; midX: number; midY: number } | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes(): string[] {
    return ['src', 'alt', 'width', 'height', 'mode', 'night-blueprint'];
  }

  connectedCallback(): void {
    this.#mode = this.getAttribute('mode') === 'modal' ? 'modal' : 'inline';
    this.#nightBlueprint = this.getAttribute('night-blueprint') === 'true';
    this.#syncDimensionsFromAttrs();
    if (!this.#built) {
      this.#buildDom();
    }
    this.#syncImageAttrs();
    this.fit();
  }

  attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
    if (name === 'mode') {
      this.#mode = newVal === 'modal' ? 'modal' : 'inline';
      if (this.#fullscreenBtn) {
        this.#fullscreenBtn.hidden = this.#mode === 'modal';
      }
      return;
    }
    if (name === 'night-blueprint') {
      this.#nightBlueprint = newVal === 'true';
      this.#syncNightBlueprintAttr();
      return;
    }
    if (name === 'width' || name === 'height') {
      this.#syncDimensionsFromAttrs();
    }
    if (this.#built) {
      this.#syncImageAttrs();
      if (name === 'src') {
        this.fit();
      }
    }
  }

  get nightBlueprint(): boolean {
    return this.#nightBlueprint;
  }

  setNightBlueprint(enabled: boolean): void {
    this.#nightBlueprint = enabled;
    if (enabled) {
      this.setAttribute('night-blueprint', 'true');
    } else {
      this.removeAttribute('night-blueprint');
    }
    this.#syncNightBlueprintAttr();
  }

  getScale(): number {
    return this.#scale;
  }

  getPan(): { tx: number; ty: number } {
    return { tx: this.#tx, ty: this.#ty };
  }

  #getViewportSize(): { width: number; height: number } {
    const w = this.#stageEl?.clientWidth || 800;
    const h = this.#stageEl?.clientHeight || 540;
    return { width: w, height: h };
  }

  #getMinScale(): number {
    const vp = this.#getViewportSize();
    return computeFitScale(vp.width, vp.height, this.#naturalW, this.#naturalH);
  }

  setScale(nextScale: number, anchorX?: number, anchorY?: number): void {
    const vp = this.#getViewportSize();
    const minScale = this.#getMinScale();
    const clampedScale = clampScale(nextScale, minScale, 3);
    const ox = anchorX ?? vp.width / 2;
    const oy = anchorY ?? vp.height / 2;

    const zoomed = zoomAroundPoint(this.#scale, clampedScale, this.#tx, this.#ty, ox, oy);
    const clamped = clampPan(
      zoomed.tx,
      zoomed.ty,
      clampedScale,
      vp.width,
      vp.height,
      this.#naturalW,
      this.#naturalH,
    );

    this.#scale = clampedScale;
    this.#tx = clamped.tx;
    this.#ty = clamped.ty;
    this.#applyTransform();
  }

  zoomIn(): void {
    this.setScale(this.#scale * 1.25);
  }

  zoomOut(): void {
    this.setScale(this.#scale / 1.25);
  }

  fit(): void {
    const vp = this.#getViewportSize();
    const minScale = computeFitScale(vp.width, vp.height, this.#naturalW, this.#naturalH);
    const clamped = clampPan(0, 0, minScale, vp.width, vp.height, this.#naturalW, this.#naturalH);
    this.#scale = minScale;
    this.#tx = clamped.tx;
    this.#ty = clamped.ty;
    this.#applyTransform();
  }

  zoom100(): void {
    const vp = this.#getViewportSize();
    const clampedScale = clampScale(1, this.#getMinScale(), 3);
    const rawTx = (vp.width - this.#naturalW * clampedScale) / 2;
    const rawTy = (vp.height - this.#naturalH * clampedScale) / 2;
    const clamped = clampPan(
      rawTx,
      rawTy,
      clampedScale,
      vp.width,
      vp.height,
      this.#naturalW,
      this.#naturalH,
    );
    this.#scale = clampedScale;
    this.#tx = clamped.tx;
    this.#ty = clamped.ty;
    this.#applyTransform();
  }

  focusBlock(block: SchematicBlock): void {
    const vp = this.#getViewportSize();
    const next = computeFocusTransform(block, vp.width, vp.height, this.#naturalW, this.#naturalH, 3);
    this.#scale = next.scale;
    this.#tx = next.tx;
    this.#ty = next.ty;
    this.#applyTransform();
  }

  panBy(dx: number, dy: number): void {
    const vp = this.#getViewportSize();
    const clamped = clampPan(
      this.#tx + dx,
      this.#ty + dy,
      this.#scale,
      vp.width,
      vp.height,
      this.#naturalW,
      this.#naturalH,
    );
    this.#tx = clamped.tx;
    this.#ty = clamped.ty;
    this.#applyTransform();
  }

  openFullscreen(): void {
    this.dispatchEvent(
      new CustomEvent('viewer-fullscreen-request', {
        bubbles: true,
        composed: true,
        detail: {
          src: this.getAttribute('src') ?? '',
          alt: this.getAttribute('alt') ?? '',
          width: this.#naturalW,
          height: this.#naturalH,
          nightBlueprint: this.#nightBlueprint,
        },
      }),
    );
  }

  #syncDimensionsFromAttrs(): void {
    const w = Number(this.getAttribute('width'));
    const h = Number(this.getAttribute('height'));
    if (Number.isFinite(w) && w > 0) this.#naturalW = w;
    if (Number.isFinite(h) && h > 0) this.#naturalH = h;
  }

  #syncNightBlueprintAttr(): void {
    if (!this.#imgEl) return;
    if (this.#nightBlueprint) {
      this.#imgEl.setAttribute('data-night-blueprint', 'true');
    } else {
      this.#imgEl.removeAttribute('data-night-blueprint');
    }
  }

  #syncImageAttrs(): void {
    if (!this.#imgEl) return;
    const src = this.getAttribute('src') ?? '';
    const alt = this.getAttribute('alt') ?? '';
    this.#imgEl.setAttribute('src', src);
    this.#imgEl.setAttribute('alt', alt);
    this.#imgEl.setAttribute('width', String(this.#naturalW));
    this.#imgEl.setAttribute('height', String(this.#naturalH));
    this.#syncNightBlueprintAttr();
  }

  #applyTransform(): void {
    if (this.#imgEl) {
      this.#imgEl.style.transform = `translate3d(${this.#tx.toFixed(2)}px, ${this.#ty.toFixed(2)}px, 0) scale(${this.#scale.toFixed(4)})`;
    }
    if (this.#readoutEl) {
      this.#readoutEl.textContent = `${Math.round(this.#scale * 100)}%`;
    }
    if (this.#stageEl) {
      this.#stageEl.style.touchAction =
        this.#mode === 'modal' || this.#scale > this.#getMinScale() + 0.02 ? 'none' : 'pan-y pinch-zoom';
    }
  }

  #buildDom(): void {
    this.#built = true;
    const style = document.createElement('style');
    style.textContent = VIEWER_STYLES;

    const toolbar = document.createElement('div');
    toolbar.className = 'viewer-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Zoom and pan controls');

    const makeBtn = (label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'viewer-btn';
      btn.textContent = label;
      btn.setAttribute('aria-label', ariaLabel);
      btn.addEventListener('click', onClick);
      return btn;
    };

    const zoomOutBtn = makeBtn('−', 'Zoom out', () => this.zoomOut());
    const readout = document.createElement('span');
    readout.className = 'viewer-zoom-readout';
    readout.setAttribute('aria-live', 'polite');
    readout.textContent = '100%';
    this.#readoutEl = readout;

    const zoomInBtn = makeBtn('+', 'Zoom in', () => this.zoomIn());
    const fitBtn = makeBtn('Fit', 'Fit image to stage', () => this.fit());
    const full100Btn = makeBtn('100%', 'Zoom to 100%', () => this.zoom100());
    const fullscreenBtn = makeBtn('Fullscreen', 'Open fullscreen inspector', () =>
      this.openFullscreen(),
    );
    fullscreenBtn.hidden = this.#mode === 'modal';
    this.#fullscreenBtn = fullscreenBtn;

    const hint = document.createElement('span');
    hint.className = 'viewer-hint';
    hint.textContent =
      this.#mode === 'modal'
        ? 'Wheel to zoom · Drag to pan · Esc to close'
        : 'Ctrl/⌘ + wheel to zoom · Drag when zoomed';

    toolbar.append(zoomOutBtn, readout, zoomInBtn, fitBtn, full100Btn, fullscreenBtn, hint);

    const stage = document.createElement('div');
    stage.className = 'viewer-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', 'Zoomable image stage (use +, -, 0, and arrow keys)');
    this.#stageEl = stage;

    const img = document.createElement('img');
    img.className = 'viewer-img';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        this.#naturalW = img.naturalWidth;
        this.#naturalH = img.naturalHeight;
        this.fit();
      }
    });
    this.#imgEl = img;
    stage.append(img);

    stage.addEventListener(
      'wheel',
      (event) => {
        const shouldZoom = this.#mode === 'modal' || event.ctrlKey || event.metaKey;
        if (!shouldZoom) {
          // Scroll-safe inline mode: let plain wheel scroll the document normally
          return;
        }
        event.preventDefault();
        const rect = stage.getBoundingClientRect();
        const ox = event.clientX - rect.left;
        const oy = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.setScale(this.#scale * factor, ox, oy);
      },
      { passive: false },
    );

    stage.addEventListener('pointerdown', (event) => {
      this.#activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (typeof stage.setPointerCapture === 'function') {
        try {
          stage.setPointerCapture(event.pointerId);
        } catch {
          // Ignore synthetic events in tests
        }
      }

      if (this.#activePointers.size === 2) {
        const pts = [...this.#activePointers.values()];
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const rect = stage.getBoundingClientRect();
        this.#pinchStart = {
          dist: Math.max(1, dist),
          scale: this.#scale,
          midX: (p0.x + p1.x) / 2 - rect.left,
          midY: (p0.y + p1.y) / 2 - rect.top,
        };
        this.#dragStart = null;
        return;
      }

      if (this.#activePointers.size === 1) {
        this.#dragStart = {
          x: event.clientX,
          y: event.clientY,
          tx: this.#tx,
          ty: this.#ty,
        };
        stage.classList.add('is-dragging');
      }
    });

    stage.addEventListener('pointermove', (event) => {
      if (!this.#activePointers.has(event.pointerId)) return;
      this.#activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.#activePointers.size === 2 && this.#pinchStart) {
        const pts = [...this.#activePointers.values()];
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const factor = dist / this.#pinchStart.dist;
        this.setScale(this.#pinchStart.scale * factor, this.#pinchStart.midX, this.#pinchStart.midY);
        return;
      }

      if (this.#dragStart) {
        const dx = event.clientX - this.#dragStart.x;
        const dy = event.clientY - this.#dragStart.y;
        const vp = this.#getViewportSize();
        const clamped = clampPan(
          this.#dragStart.tx + dx,
          this.#dragStart.ty + dy,
          this.#scale,
          vp.width,
          vp.height,
          this.#naturalW,
          this.#naturalH,
        );
        this.#tx = clamped.tx;
        this.#ty = clamped.ty;
        this.#applyTransform();
      }
    });

    const releasePointer = (event: PointerEvent) => {
      this.#activePointers.delete(event.pointerId);
      if (this.#activePointers.size < 2) {
        this.#pinchStart = null;
      }
      if (this.#activePointers.size === 0) {
        this.#dragStart = null;
        stage.classList.remove('is-dragging');
      }
    };
    stage.addEventListener('pointerup', releasePointer);
    stage.addEventListener('pointercancel', releasePointer);

    stage.addEventListener('keydown', (event) => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.zoomIn();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        this.zoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        this.fit();
      } else if (event.key === '1') {
        event.preventDefault();
        this.zoom100();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.panBy(60, 0);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.panBy(-60, 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.panBy(0, 60);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.panBy(0, -60);
      }
    });

    this.#root.append(style, toolbar, stage);
  }
}

if (!customElements.get('zoom-pan-viewer')) {
  customElements.define('zoom-pan-viewer', ZoomPanViewer);
}

/* ============================================================================
 * SHARED FULLSCREEN LIGHTBOX <dialog closedby="any">
 * ============================================================================ */

let activeDialog: HTMLDialogElement | null = null;
let keydownCleanup: (() => void) | null = null;

function isOutsideDialogRect(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

function showModalSafe(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  } else {
    dialog.setAttribute('open', '');
  }
  if (!dialog.open) {
    dialog.setAttribute('open', '');
  }
}

export function closeFullscreenLightbox(): void {
  if (keydownCleanup) {
    keydownCleanup();
    keydownCleanup = null;
  }
  if (activeDialog) {
    if (activeDialog.open && typeof activeDialog.close === 'function') {
      try {
        activeDialog.close();
      } catch {
        activeDialog.removeAttribute('open');
      }
    } else {
      activeDialog.removeAttribute('open');
    }
    activeDialog.returnValue = '';
  }
}

export function openFullscreenLightbox(
  options: LightboxOptions,
): { dialog: HTMLDialogElement; viewer: ZoomPanViewer } {
  const doc = document;
  if (!options.items.length) {
    throw new Error('openFullscreenLightbox requires at least one item');
  }

  let dialog = doc.getElementById('env-skew-lightbox-dialog') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = doc.createElement('dialog');
    dialog.id = 'env-skew-lightbox-dialog';
    dialog.className = 'lightbox-dialog';
    dialog.setAttribute('closedby', 'any');
    dialog.setAttribute('aria-labelledby', 'lightbox-dialog-title');

    // Safari fallback for closedby="any"
    if (!(typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = dialog!.open && isOutsideDialogRect(e, dialog!);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (dialog!.open && pressedOutside && isOutsideDialogRect(e, dialog!)) {
          pressedOutside = false;
          closeFullscreenLightbox();
          return;
        }
        pressedOutside = false;
      });
    }

    dialog.addEventListener('close', () => {
      dialog!.returnValue = '';
      if (keydownCleanup) {
        keydownCleanup();
        keydownCleanup = null;
      }
    });

    doc.body.append(dialog);
  }
  activeDialog = dialog;

  let currentIdx = Math.max(0, Math.min(options.items.length - 1, options.startIndex ?? 0));
  let nightEnabled = Boolean(options.nightBlueprint);

  const isFlipMode = options.mode === 'flip' && options.items.length === 2;
  const isGallery = options.items.length > 1;

  dialog.innerHTML = `
    <div class="lightbox-shell">
      <header class="lightbox-header">
        <div class="lightbox-title-group">
          <h1 id="lightbox-dialog-title" class="lightbox-title"></h1>
          <span class="lightbox-counter mono" data-lightbox-counter></span>
        </div>
        <div class="lightbox-controls">
          ${
            isFlipMode
              ? `<div class="lightbox-flip-group" role="group" aria-label="Board side">
                  ${options.items
                    .map(
                      (item, idx) =>
                        `<button type="button" class="lightbox-btn" data-flip-index="${idx}" aria-pressed="${idx === currentIdx}">${item.flipLabel ?? item.caption ?? `Side ${idx + 1}`}</button>`,
                    )
                    .join('')}
                </div>`
              : ''
          }
          ${
            options.allowNightBlueprint
              ? `<button type="button" class="lightbox-btn" data-lightbox-night aria-pressed="${nightEnabled}">Night Blueprint</button>`
              : ''
          }
          ${
            isGallery
              ? `<button type="button" class="lightbox-btn" data-lightbox-prev aria-label="Previous image">← Prev</button>
                 <button type="button" class="lightbox-btn" data-lightbox-next aria-label="Next image">Next →</button>`
              : ''
          }
          <form method="dialog">
            <button type="submit" class="lightbox-btn lightbox-close" autofocus aria-label="Close fullscreen viewer">Close</button>
          </form>
        </div>
      </header>
      <div class="lightbox-body">
        <zoom-pan-viewer mode="modal"></zoom-pan-viewer>
      </div>
    </div>
  `;

  const titleEl = dialog.querySelector<HTMLElement>('#lightbox-dialog-title')!;
  const counterEl = dialog.querySelector<HTMLElement>('[data-lightbox-counter]')!;
  const viewer = dialog.querySelector<ZoomPanViewer>('zoom-pan-viewer')!;
  const prevBtn = dialog.querySelector<HTMLButtonElement>('[data-lightbox-prev]');
  const nextBtn = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]');
  const flipBtns = [...dialog.querySelectorAll<HTMLButtonElement>('[data-flip-index]')];
  const nightBtn = dialog.querySelector<HTMLButtonElement>('[data-lightbox-night]');

  const syncItem = (): void => {
    const item = options.items[currentIdx] ?? options.items[0]!;
    titleEl.textContent = item.caption ?? options.title ?? item.alt;
    counterEl.textContent = options.items.length > 1 ? `${currentIdx + 1} / ${options.items.length}` : '';
    viewer.setAttribute('src', item.src);
    viewer.setAttribute('alt', item.alt);
    if (item.width) viewer.setAttribute('width', String(item.width));
    if (item.height) viewer.setAttribute('height', String(item.height));
    viewer.setNightBlueprint(nightEnabled);

    for (const btn of flipBtns) {
      const idx = Number(btn.getAttribute('data-flip-index'));
      btn.setAttribute('aria-pressed', String(idx === currentIdx));
    }
  };

  const step = (delta: number): void => {
    currentIdx = (currentIdx + delta + options.items.length) % options.items.length;
    syncItem();
  };

  prevBtn?.addEventListener('click', () => step(-1));
  nextBtn?.addEventListener('click', () => step(1));

  for (const btn of flipBtns) {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-flip-index'));
      if (!Number.isNaN(idx)) {
        currentIdx = idx;
        syncItem();
      }
    });
  }

  nightBtn?.addEventListener('click', () => {
    nightEnabled = !nightEnabled;
    nightBtn.setAttribute('aria-pressed', String(nightEnabled));
    viewer.setNightBlueprint(nightEnabled);
    options.onNightBlueprintChange?.(nightEnabled);
  });

  if (keydownCleanup) {
    keydownCleanup();
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!dialog!.open) return;
    if (isGallery && event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (isGallery && event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };
  dialog.addEventListener('keydown', onKeyDown);
  keydownCleanup = () => dialog!.removeEventListener('keydown', onKeyDown);

  syncItem();
  if (!dialog.open) {
    showModalSafe(dialog);
  }
  viewer.fit();

  if (options.focusBlocks?.length && options.activeFocusBlock != null) {
    const match = options.focusBlocks.find((b) => b.num === options.activeFocusBlock);
    if (match) {
      viewer.focusBlock(match);
    }
  }

  return { dialog, viewer };
}
