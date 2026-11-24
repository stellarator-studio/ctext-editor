/**
 * Visual hints in the editor for things that are invisible in formatted text
 * but change the cText output:
 *
 * - spaces (full- and half-width) are underlined, so padding inside notes
 *   such as `{{ABCD　　　}}` can be seen and counted;
 * - a heading shows its `*` / `**` at the exact place it is written in the
 *   source, so `*<seq/>…` and `<seq/>*…` look different.
 */
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

function starsWidget(level: number, prefix: number) {
  return () => {
    const el = document.createElement('span');
    el.className = 'ct-stars';
    el.textContent = '*'.repeat(level);
    el.title = prefix ? `標題記號 ${'*'.repeat(level)}：排在前面 ${prefix} 個標記之後` : `標題記號 ${'*'.repeat(level)}（行首）`;
    return el;
  };
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((block, offset) => {
    const start = offset + 1;
    if (block.type.name === 'heading') {
      const prefix = Math.min(block.attrs.prefix, block.childCount);
      let pos = start;
      for (let i = 0; i < prefix; i++) pos += block.child(i).nodeSize;
      decos.push(Decoration.widget(pos, starsWidget(block.attrs.level, prefix), { side: -1, key: `stars${block.attrs.level}:${prefix}`, ignoreSelection: true }));
    }
    block.descendants((node, p) => {
      if (!node.isText) return false;
      for (const m of node.text!.matchAll(/[ 　]/g)) {
        const at = start + p + m.index!;
        decos.push(Decoration.inline(at, at + 1, { class: m[0] === ' ' ? 'ct-space half' : 'ct-space', title: m[0] === ' ' ? '半形空格' : '全形空格' }));
      }
      return false;
    });
  });
  return DecorationSet.create(doc, decos);
}

export function layoutHints() {
  return new Plugin<DecorationSet>({
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
