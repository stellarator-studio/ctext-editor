import type { Command } from 'prosemirror-state';
import { freshIid } from '../core/ids';
import { schema } from '../core/schema';
import { overlaps, type Candidate, type DictEntry } from '../core/annotate';

/**
 * Tag candidates as <entity> in one transaction (one undo step).
 * Overlapping candidates are skipped after the first one (document order).
 * Adding marks does not move positions, so candidate ranges stay valid.
 */
export function acceptCandidates(cands: Candidate[], entries: Map<string, DictEntry>): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    const done: Candidate[] = [];
    for (const c of [...cands].sort((a, b) => a.start - b.start)) {
      const e = entries.get(c.entryId);
      if (!e || done.some((d) => overlaps(d, c))) continue;
      tr.addMark(c.from, c.to, schema.marks.entity.create({ iid: freshIid(), raw: null, entityid: e.entityid, type: e.type, extra: { ...e.extra } }));
      done.push(c);
    }
    if (!done.length) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
