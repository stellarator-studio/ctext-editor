/**
 * Convert half-width punctuation to the full-width forms cText expects.
 * Quotes alternate open/close within each text block (counted over the whole
 * block, even when only part of it is being fixed).
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { Command, Transaction } from 'prosemirror-state';

const SIMPLE: Record<string, string> = { ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？' };
const QUOTES: Record<string, [string, string]> = { '"': ['「', '」'], "'": ['『', '』'] };

/** Replace characters one-for-one, so positions do not shift. Returns the count. */
function fixRange(tr: Transaction, doc: PMNode, from: number, to: number): number {
  let count = 0;
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    const open: Record<string, boolean> = { '"': false, "'": false };
    block.forEach((child, offset) => {
      if (!child.isText) return;
      const base = blockPos + 1 + offset;
      const text = child.text!;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        let rep = SIMPLE[ch];
        if (QUOTES[ch]) {
          rep = QUOTES[ch][open[ch] ? 1 : 0];
          open[ch] = !open[ch];
        }
        const pos = base + i;
        if (rep && pos >= from && pos < to) {
          tr.insertText(rep, pos, pos + 1);
          count++;
        }
      }
    });
    return false;
  });
  return count;
}

/** Fix all half-width punctuation in the document, or only in [from, to). */
export function fixHalfWidth(from?: number, to?: number): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    if (!fixRange(tr, state.doc, from ?? 0, to ?? state.doc.content.size)) return false;
    dispatch?.(tr);
    return true;
  };
}
