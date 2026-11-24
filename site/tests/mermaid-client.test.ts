import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  MERMAID_THEME_CONFIG,
  hydrateMermaidDiagrams,
  type MermaidRuntime,
} from '../src/lib/mermaid-client.ts';

describe('lazy client-side Mermaid hydration module', () => {
  it('never loads the mermaid bundle when the document contains zero .mermaid blocks', async () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `<main><h1>No diagrams here</h1><pre><code>{"hp":6}</code></pre></main>`;

    const loadMermaid = vi.fn<() => Promise<MermaidRuntime>>();
    const rendered = await hydrateMermaidDiagrams({ root: doc, loadMermaid });

    expect(rendered).toBe(0);
    expect(loadMermaid).not.toHaveBeenCalled();
    win.close();
  });

  it('lazy-loads mermaid once, configures Matte Black + ENIG Gold theme, renders SVGs, and is idempotent', async () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `
      <figure class="mermaid-card">
        <div class="mermaid-scroll">
          <pre class="mermaid">flowchart LR\n  IN --&gt; OUT</pre>
        </div>
      </figure>
      <figure class="mermaid-card">
        <div class="mermaid-scroll">
          <pre class="mermaid">flowchart LR\n  SLEW --&gt; ENV</pre>
        </div>
      </figure>
    `;

    const initialize = vi.fn();
    const render = vi.fn(async (id: string, source: string) => ({
      svg: `<svg data-id="${id}" data-src-len="${source.length}"><rect /></svg>`,
    }));
    const loadMermaid = vi.fn(async () => ({ initialize, render }));

    const firstCount = await hydrateMermaidDiagrams({ root: doc, loadMermaid });
    expect(firstCount).toBe(2);
    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        themeVariables: expect.objectContaining({
          primaryBorderColor: '#d8b154',
          lineColor: '#d8b154',
          background: '#090a0d',
          primaryTextColor: '#f4f5f7',
        }),
      }),
    );
    expect(MERMAID_THEME_CONFIG.theme).toBe('base');

    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0]?.[1]).toContain('IN --> OUT');
    expect(render.mock.calls[1]?.[1]).toContain('SLEW --> ENV');

    const renderedNodes = doc.querySelectorAll('.mermaid-svg[data-mermaid-rendered="true"] svg');
    expect(renderedNodes).toHaveLength(2);

    // Second pass must be a no-op without reloading mermaid
    const secondCount = await hydrateMermaidDiagrams({ root: doc, loadMermaid });
    expect(secondCount).toBe(0);
    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);

    win.close();
  });
});
