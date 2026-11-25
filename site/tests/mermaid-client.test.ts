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

  it('lazy-loads mermaid once, configures Matte Black + ENIG Gold theme, renders SVGs with labels, and is idempotent', async () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `
      <figure class="mermaid-card">
        <div class="mermaid-scroll">
          <pre class="mermaid" data-mermaid-label="Circuit signal flow diagram">flowchart LR\n  IN --&gt; OUT</pre>
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
      }),
    );
    expect(MERMAID_THEME_CONFIG.theme).toBe('base');

    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[0]?.[1]).toContain('IN --> OUT');
    expect(render.mock.calls[1]?.[1]).toContain('SLEW --> ENV');

    const renderedCards = [
      ...doc.querySelectorAll<HTMLElement>('.mermaid-svg[data-mermaid-rendered="true"]'),
    ];
    expect(renderedCards).toHaveLength(2);
    expect(renderedCards[0]?.getAttribute('role')).toBe('img');
    expect(renderedCards[0]?.getAttribute('aria-label')).toBe('Circuit signal flow diagram');
    expect(renderedCards[1]?.getAttribute('role')).toBe('img');
    expect(renderedCards[1]?.getAttribute('aria-label')).toBe('Diagram');
    expect(doc.querySelectorAll('.mermaid-svg[data-mermaid-rendered="true"] svg')).toHaveLength(2);

    // Second pass must be a no-op without reloading mermaid
    const secondCount = await hydrateMermaidDiagrams({ root: doc, loadMermaid });
    expect(secondCount).toBe(0);
    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);

    win.close();
  });

  it('preserves Mermaid source with an accessible status notice on render failure and never retries failed blocks', async () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = `
      <figure class="mermaid-card">
        <div class="mermaid-scroll">
          <pre class="mermaid">graph TD\n  BAD --&gt;&gt; SYNTAX</pre>
        </div>
      </figure>
    `;

    const initialize = vi.fn();
    const render = vi.fn(async () => {
      throw new Error('Syntax error in text');
    });
    const loadMermaid = vi.fn(async () => ({ initialize, render }));

    const firstCount = await hydrateMermaidDiagrams({ root: doc, loadMermaid });
    expect(firstCount).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);

    const pre = doc.querySelector<HTMLElement>('pre.mermaid');
    expect(pre).not.toBeNull();
    expect(pre?.getAttribute('data-mermaid-error')).toBe('true');
    expect(pre?.textContent).toContain('BAD -->> SYNTAX');

    const notices = doc.querySelectorAll('p.mermaid-error-note[role="status"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toBe('Diagram preview unavailable; showing Mermaid source.');
    expect(pre?.previousElementSibling).toBe(notices[0]);

    // Second pass must skip the errored block and never reload mermaid or duplicate the notice
    const secondCount = await hydrateMermaidDiagrams({ root: doc, loadMermaid });
    expect(secondCount).toBe(0);
    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(doc.querySelectorAll('p.mermaid-error-note')).toHaveLength(1);

    win.close();
  });
});
