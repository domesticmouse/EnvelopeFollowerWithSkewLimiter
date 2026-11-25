import type { Root } from 'mdast';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';
import { remarkPromoteDoubleDollarMath } from '../src/plugins/remark-double-dollar-math.ts';

interface MathNodeLike {
  type: string;
  value?: string;
  data?: {
    hProperties?: {
      className?: unknown;
    };
  };
}

function collectInlineMathNodes(tree: Root): MathNodeLike[] {
  const nodes: MathNodeLike[] = [];
  visit(tree, 'inlineMath', (node) => {
    nodes.push(node as unknown as MathNodeLike);
  });
  return nodes;
}

describe('remarkPromoteDoubleDollarMath', () => {
  it('handles undefined file and empty source value without throwing or mutating nodes', () => {
    const source = 'Single-line $$x = y + 1$$ expression.';
    const processor = unified().use(remarkParse).use(remarkMath);
    const transform = remarkPromoteDoubleDollarMath();

    const treeUndefined = processor.parse(source);
    expect(() => transform(treeUndefined, undefined)).not.toThrow();
    const nodesUndefined = collectInlineMathNodes(treeUndefined);
    expect(nodesUndefined).toHaveLength(1);
    expect(nodesUndefined[0]?.data?.hProperties?.className).toEqual(['language-math', 'math-inline']);

    const treeEmpty = processor.parse(source);
    expect(() => transform(treeEmpty, { value: '' })).not.toThrow();
    const nodesEmpty = collectInlineMathNodes(treeEmpty);
    expect(nodesEmpty).toHaveLength(1);
    expect(nodesEmpty[0]?.data?.hProperties?.className).toEqual(['language-math', 'math-inline']);
  });

  it('promotes $$...$$ inlineMath nodes to math-display while leaving $...$ inline', () => {
    const source = 'Inline $a + b$ and promoted $$V_{\\text{rect}} = 1.1\\,V_{\\text{pre}}$$ expression.';
    const tree = unified().use(remarkParse).use(remarkMath).parse(source);
    const transform = remarkPromoteDoubleDollarMath();

    transform(tree, { value: source });

    const nodes = collectInlineMathNodes(tree);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.value).toBe('a + b');
    expect(nodes[0]?.data?.hProperties?.className).toEqual(['language-math', 'math-inline']);

    expect(nodes[1]?.value).toBe('V_{\\text{rect}} = 1.1\\,V_{\\text{pre}}');
    expect(nodes[1]?.data?.hProperties?.className).toEqual(['language-math', 'math-display']);
  });
});
