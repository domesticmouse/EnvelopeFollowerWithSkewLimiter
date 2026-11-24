import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

interface InlineMathNode {
  type: string;
  value?: string;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/**
 * Promote single-line `$$...$$` expressions inside paragraphs or list items
 * from `math-inline` to `math-display` so `rehype-katex` renders them in display mode.
 */
export const remarkPromoteDoubleDollarMath: Plugin<[], Root> = () => {
  return (tree, file) => {
    const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');
    if (!source) {
      return;
    }

    visit(tree, 'inlineMath', (rawNode) => {
      const node = rawNode as unknown as InlineMathNode;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start == null || end == null || end - start < 4) {
        return;
      }

      const rawSlice = source.slice(start, end);
      if (rawSlice.startsWith('$$') && rawSlice.endsWith('$$')) {
        node.data ??= {};
        node.data.hProperties ??= {};
        node.data.hProperties.className = ['language-math', 'math-display'];
      }
    });
  };
};
