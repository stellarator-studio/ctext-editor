/**
 * Find / replace in the structured editor.
 *
 * Matching runs on the text projection. With `acrossMarkers`, layout markers
 * (scanbreak, page boundaries, seq, …) are transparent, so 英吉⏎利 matches
 * 英吉利. Replacing only rewrites the text characters of a match: markers
 * inside it stay where they are, and seq anchors are never touched.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { project, TRANSPARENT } from '../core/projection';
import { compile, expandReplacement, findAll, type SearchQuery } from '../core/search';

export interface DocMatch {
  from: number;
  to: number;
  /** contiguous runs of text characters [from, to) in document positions */
  runs: [number, number][];
  groups: string[];
}

const NONE: ReadonlySet<string> = new Set();

export function findInDoc(doc: PMNode, q: SearchQuery, acrossMarkers: boolean): DocMatch[] | string {
  const re = compile(q);
  if (typeof re === 'string') return re;
  const pr = project(doc, acrossMarkers ? TRANSPARENT : NONE);
  return findAll(pr.text, re).map((m) => {
    const runs: [number, number][] = [];
    for (let i = m.start; i < m.end; i++) {
      const p = pr.pos[i];
      const last = runs[runs.length - 1];
      if (last && last[1] === p) last[1] = p + 1;
      else runs.push([p, p + 1]);
    }
    return { from: runs[0][0], to: runs[runs.length - 1][1], runs, groups: m.groups };
  });
}

/** Replace matches (any order) in one transaction. */
export function replaceMatches(tr: Transaction, matches: DocMatch[], rep: string, regex: boolean): Transaction {
  for (const m of [...matches].sort((a, b) => b.from - a.from)) {
    const text = expandReplacement(rep, m.groups, regex);
    for (let i = m.runs.length - 1; i > 0; i--) tr.delete(m.runs[i][0], m.runs[i][1]);
    const [from, to] = m.runs[0];
    if (text) tr.insertText(text, from, to);
    else tr.delete(from, to);
  }
  return tr;
}

export function replaceCommand(matches: DocMatch[], rep: string, regex: boolean): Command {
  return (state, dispatch) => {
    if (!matches.length) return false;
    dispatch?.(replaceMatches(state.tr, matches, rep, regex).scrollIntoView());
    return true;
  };
}

// ---------------------------------------------------------------- highlighting

export const searchKey = new PluginKey<DecorationSet>('search');

/** Set the highlighted matches with `tr.setMeta(searchKey, { matches, current })`. */
export function searchHighlight(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: searchKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(searchKey) as { matches: DocMatch[]; current: number } | undefined;
        if (!meta) return set.map(tr.mapping, tr.doc);
        const decos = meta.matches.flatMap((m, i) =>
          m.runs.map(([f, t]) => Decoration.inline(f, t, { class: i === meta.current ? 'ct-find ct-find-cur' : 'ct-find' })),
        );
        return DecorationSet.create(tr.doc, decos);
      },
    },
    props: { decorations: (s) => searchKey.getState(s) },
  });
}
