/** Minimal Mermaid runtime interface for lazy dynamic import and testing. */
export interface MermaidRuntime {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

/** Options for hydrateMermaidDiagrams. */
export interface HydrateMermaidOptions {
  root?: ParentNode;
  loadMermaid?: () => Promise<MermaidRuntime>;
}

/** Matte Black FR4 + ENIG Gold Mermaid base theme configuration. */
export const MERMAID_THEME_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  theme: 'base' as const,
  fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
  themeVariables: {
    darkMode: true,
    background: '#090a0d',
    mainBkg: '#1b1d22',
    primaryColor: '#1b1d22',
    primaryTextColor: '#f4f5f7',
    primaryBorderColor: '#d8b154',
    secondaryColor: '#141518',
    secondaryTextColor: '#e8eaef',
    secondaryBorderColor: '#6e7485',
    tertiaryColor: '#1d2028',
    lineColor: '#d8b154',
    textColor: '#e8eaef',
    edgeLabelBackground: '#141518',
    clusterBkg: '#141518',
    clusterBorder: '#6e7485',
    nodeTextColor: '#f4f5f7',
    fontSize: '14px',
  },
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis',
  },
};

let diagramIdSeed = 0;

async function defaultLoadMermaid(): Promise<MermaidRuntime> {
  const mod = await import('mermaid');
  return mod.default as unknown as MermaidRuntime;
}

/**
 * Dynamically import `mermaid` strictly when `.mermaid` blocks exist in the DOM,
 * configure Matte Black + ENIG Gold theme tokens, and render diagrams into accessible SVG cards.
 */
export async function hydrateMermaidDiagrams(
  options?: HydrateMermaidOptions,
): Promise<number> {
  const root = options?.root ?? (typeof document !== 'undefined' ? document : undefined);
  if (!root) {
    return 0;
  }

  const blocks = [...root.querySelectorAll<HTMLElement>('.mermaid:not([data-mermaid-rendered="true"])')];
  if (blocks.length === 0) {
    return 0;
  }

  const loadMermaid = options?.loadMermaid ?? defaultLoadMermaid;
  const mermaid = await loadMermaid();
  mermaid.initialize(MERMAID_THEME_CONFIG);

  const ownerDoc = root.ownerDocument ?? (root as Document);
  let renderedCount = 0;

  for (const block of blocks) {
    const source = (block.textContent ?? '').trim();
    if (!source) {
      block.setAttribute('data-mermaid-rendered', 'true');
      continue;
    }

    const renderId = `env-skew-diagram-${++diagramIdSeed}`;
    try {
      const { svg } = await mermaid.render(renderId, source);
      const container = ownerDoc.createElement('div');
      container.className = 'mermaid mermaid-svg';
      container.setAttribute('data-mermaid-rendered', 'true');
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Circuit signal flow diagram');
      container.innerHTML = svg;
      block.replaceWith(container);
      renderedCount += 1;
    } catch {
      // Leave readable monospace diagram source visible on unexpected syntax failure
      block.setAttribute('data-mermaid-error', 'true');
    }
  }

  return renderedCount;
}
