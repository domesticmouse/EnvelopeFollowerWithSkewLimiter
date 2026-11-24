import { openFullscreenLightbox, type ZoomPanViewer } from '../components/zoom-pan-viewer.ts';
import { SCHEMATIC_BLOCKS, SCHEMATIC_IMAGE_PX } from '../data/hardware-schematic.ts';
import { withBase } from './routes.ts';

/** Initialize interactive schematic stage, Night Blueprint toggle, 9-block focus chips, and PCB lightbox triggers on /hardware/. */
export function initHardwarePage(root: ParentNode = document): void {
  const schematicViewer = root.querySelector<ZoomPanViewer>('[data-schematic-viewer]');
  const focusBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-focus-block]')];
  const readoutText = root.querySelector<HTMLElement>('[data-focus-readout-text]');
  const readoutLink = root.querySelector<HTMLAnchorElement>('[data-focus-readout-link]');
  const nightBtn = root.querySelector<HTMLButtonElement>('[data-night-blueprint-toggle]');

  let activeBlockNum: number | null = null;
  let nightEnabled = false;

  const setNightBlueprint = (next: boolean): void => {
    nightEnabled = next;
    nightBtn?.setAttribute('aria-pressed', String(next));
    schematicViewer?.setNightBlueprint(next);
  };

  nightBtn?.addEventListener('click', () => {
    setNightBlueprint(!nightEnabled);
  });

  const selectBlock = (blockNum: number | null): void => {
    activeBlockNum = blockNum;
    for (const btn of focusBtns) {
      const val = btn.getAttribute('data-focus-block');
      const isMatch = blockNum === null ? val === 'full' : Number(val) === blockNum;
      btn.setAttribute('aria-pressed', String(isMatch));
    }

    if (blockNum === null) {
      schematicViewer?.fit();
      if (readoutText) {
        readoutText.textContent =
          'Full Sheet (A3 420 × 297 mm) — 9 circuit stages, 128 symbol instances, 48 nets, 0 ERC errors.';
      }
      if (readoutLink) {
        readoutLink.setAttribute('href', withBase('/specs/design-spec/'));
        readoutLink.textContent = 'Read Final Design Spec →';
      }
      return;
    }

    const block = SCHEMATIC_BLOCKS.find((b) => b.num === blockNum);
    if (!block) return;
    schematicViewer?.focusBlock(block);
    if (readoutText) {
      readoutText.textContent = `${block.title}: ${block.note}`;
    }
    if (readoutLink) {
      readoutLink.setAttribute('href', withBase(block.href));
      readoutLink.textContent = block.linkLabel;
    }
  };

  for (const btn of focusBtns) {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-focus-block');
      selectBlock(raw === 'full' || !raw ? null : Number(raw));
    });
  }

  schematicViewer?.addEventListener('viewer-fullscreen-request', () => {
    openFullscreenLightbox({
      items: [
        {
          src: withBase('/images/schematic.png'),
          alt: 'ENV / SKEW 9-Block A3 KiCad 10 Schematic',
          width: SCHEMATIC_IMAGE_PX.width,
          height: SCHEMATIC_IMAGE_PX.height,
          caption: 'A3 KiCad 10 Schematic (9 Circuit Blocks)',
        },
      ],
      startIndex: 0,
      allowNightBlueprint: true,
      nightBlueprint: nightEnabled,
      onNightBlueprintChange: (enabled) => setNightBlueprint(enabled),
      focusBlocks: SCHEMATIC_BLOCKS,
      activeFocusBlock: activeBlockNum,
    });
  });

  // #pcb Front / Back / Both switcher (< 768px) and fullscreen F.Cu / B.Cu flip lightbox
  const pcbGrid = root.querySelector<HTMLElement>('[data-pcb-grid]');
  const pcbViewBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-pcb-view]')];
  for (const btn of pcbViewBtns) {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-pcb-view') ?? 'both';
      if (pcbGrid) {
        pcbGrid.setAttribute('data-pcb-mobile-view', view);
      }
      for (const sibling of pcbViewBtns) {
        sibling.setAttribute('aria-pressed', String(sibling === btn));
      }
    });
  }

  const pcbPlateBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-pcb-lightbox-index]')];
  const pcbLightboxItems = [
    {
      src: withBase('/images/pcb_front.png'),
      alt: 'ENV / SKEW PCB front 3D render (F.Cu panel controls)',
      width: 744,
      height: 2416,
      caption: 'Main PCB — Front (F.Cu Panel Controls)',
      flipLabel: 'Front (F.Cu)',
    },
    {
      src: withBase('/images/pcb_back.png'),
      alt: 'ENV / SKEW PCB back 3D render (B.Cu 50 SMDs, power, and test points)',
      width: 744,
      height: 2416,
      caption: 'Main PCB — Back (B.Cu 50 SMDs & TP1–TP12)',
      flipLabel: 'Back (B.Cu)',
    },
  ];

  for (const btn of pcbPlateBtns) {
    btn.addEventListener('click', () => {
      const startIndex = Number(btn.getAttribute('data-pcb-lightbox-index')) || 0;
      openFullscreenLightbox({
        items: pcbLightboxItems,
        startIndex,
        mode: 'flip',
        title: 'Main PCB 3D Inspection (Up to 300% Zoom)',
      });
    });
  }
}
