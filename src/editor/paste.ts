/**
 * Clean up pasted content (not internal drags, which move content as-is):
 * - drop <seq> anchors (they may only exist once, see seqGuard)
 * - give span marks fresh instance ids, so a pasted copy of a note/entity is
 *   a separate span from the original even when placed right next to it
 */
import { Fragment, Slice, type Mark, type Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

let nextIid = 1_000_000;

function sanitize(fragment: Fragment, remap: Map<number, number>): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((n) => {
    if (n.type.name === 'seq') return;
    const marks = n.marks.map((m: Mark) => {
      if (!('iid' in m.attrs)) return m;
      if (!remap.has(m.attrs.iid)) remap.set(m.attrs.iid, nextIid++);
      return m.type.create({ ...m.attrs, iid: remap.get(m.attrs.iid) });
    });
    const copy = n.isText ? n.type.schema.text(n.text!, marks) : n.isLeaf ? n.mark(marks) : n.copy(sanitize(n.content, remap)).mark(marks);
    nodes.push(copy);
  });
  return Fragment.fromArray(nodes);
}

export function pasteGuard(): Plugin {
  return new Plugin({
    props: {
      transformPasted(slice, view) {
        if (view.dragging) return slice;
        return new Slice(sanitize(slice.content, new Map()), slice.openStart, slice.openEnd);
      },
    },
  });
}
