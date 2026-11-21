/**
 * Annotation candidates (design §4.4): find occurrences of dictionary terms
 * that are not yet tagged as <entity>, for the user to accept or reject.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { project, docRange, SEP, type Projection } from './projection';

export interface DictEntry {
  id: string;
  /** search string, e.g. 緬甸 */
  surface: string;
  entityid: string;
  type: string;
  extra: Record<string, string>;
  /** other spellings that refer to the same entity */
  variants: string[];
  source: 'harvest' | 'manual' | 'import';
  note?: string;
}

export interface Candidate {
  entryId: string;
  /** the matched string (surface or a variant) */
  term: string;
  from: number;
  to: number;
  /** projection offsets */
  start: number;
  end: number;
  before: string;
  after: string;
  /** stable id for remembering rejections: term + surrounding text */
  fingerprint: string;
}

// ---------------------------------------------------------------- Aho–Corasick

interface ACNode {
  next: Map<string, number>;
  fail: number;
  /** pattern indexes ending here (including via fail links) */
  out: number[];
}

export class AhoCorasick {
  private nodes: ACNode[] = [{ next: new Map(), fail: 0, out: [] }];
  constructor(readonly patterns: string[]) {
    patterns.forEach((p, i) => {
      if (!p) return;
      let s = 0;
      for (const ch of p) {
        let n = this.nodes[s].next.get(ch);
        if (n === undefined) {
          n = this.nodes.length;
          this.nodes.push({ next: new Map(), fail: 0, out: [] });
          this.nodes[s].next.set(ch, n);
        }
        s = n;
      }
      this.nodes[s].out.push(i);
    });
    const queue: number[] = [];
    for (const n of this.nodes[0].next.values()) queue.push(n);
    while (queue.length) {
      const s = queue.shift()!;
      for (const [ch, t] of this.nodes[s].next) {
        let f = this.nodes[s].fail;
        while (f && !this.nodes[f].next.has(ch)) f = this.nodes[f].fail;
        const g = this.nodes[f].next.get(ch);
        this.nodes[t].fail = g !== undefined && g !== t ? g : 0;
        this.nodes[t].out.push(...this.nodes[this.nodes[t].fail].out);
        queue.push(t);
      }
    }
  }

  /** All matches as [start, end, patternIndex] in UTF-16 offsets. */
  search(text: string): [number, number, number][] {
    const out: [number, number, number][] = [];
    let s = 0;
    let i = 0;
    for (const ch of text) {
      while (s && !this.nodes[s].next.has(ch)) s = this.nodes[s].fail;
      s = this.nodes[s].next.get(ch) ?? 0;
      i += ch.length;
      for (const p of this.nodes[s].out) out.push([i - this.patterns[p].length, i, p]);
    }
    return out;
  }
}

// ---------------------------------------------------------------- candidates

/** Characters of the projection already inside an <entity>. */
function taggedMask(doc: PMNode, pr: Projection): Uint8Array {
  const mask = new Uint8Array(pr.text.length);
  const tagged = new Set<number>();
  doc.descendants((n, p) => {
    if (n.isText && n.marks.some((m) => m.type.name === 'entity')) for (let i = 0; i < n.text!.length; i++) tagged.add(p + i);
    return true;
  });
  for (let i = 0; i < pr.pos.length; i++) if (tagged.has(pr.pos[i])) mask[i] = 1;
  return mask;
}

const CONTEXT = 8;
const clean = (s: string) => s.replaceAll(SEP, '¦');

export function fingerprint(term: string, before: string, after: string): string {
  return `${before.slice(-4)}[${term}]${after.slice(0, 4)}`;
}

export function findCandidates(doc: PMNode, entries: DictEntry[]): Candidate[] {
  const pr = project(doc);
  const patterns: string[] = [];
  const owner: number[] = [];
  entries.forEach((e, i) => {
    for (const t of new Set([e.surface, ...e.variants].map((s) => s.trim()).filter(Boolean))) {
      patterns.push(t);
      owner.push(i);
    }
  });
  if (!patterns.length) return [];
  const mask = taggedMask(doc, pr);
  const out: Candidate[] = [];
  for (const [start, end, p] of new AhoCorasick(patterns).search(pr.text)) {
    let touched = false;
    for (let i = start; i < end; i++) if (mask[i]) touched = true;
    if (touched) continue; // already (partly) annotated
    const before = clean(pr.text.slice(Math.max(0, start - CONTEXT), start));
    const after = clean(pr.text.slice(end, end + CONTEXT));
    const term = patterns[p];
    out.push({
      entryId: entries[owner[p]].id,
      term,
      ...docRange(pr, start, end),
      start,
      end,
      before,
      after,
      fingerprint: fingerprint(term, before, after),
    });
  }
  // document order; at the same start, longer match first
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Candidates whose ranges overlap. */
export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Existing <entity> spans in the document, for building a dictionary. */
export function harvestEntities(doc: PMNode): Omit<DictEntry, 'id' | 'source'>[] {
  const spans = new Map<number, { text: string; entityid: string; type: string; extra: Record<string, string> }>();
  doc.descendants((n) => {
    if (!n.isText) return true;
    for (const m of n.marks) {
      if (m.type.name !== 'entity') continue;
      const s = spans.get(m.attrs.iid) ?? { text: '', entityid: m.attrs.entityid, type: m.attrs.type, extra: m.attrs.extra };
      s.text += n.text;
      spans.set(m.attrs.iid, s);
    }
    return true;
  });
  const seen = new Map<string, Omit<DictEntry, 'id' | 'source'>>();
  for (const s of spans.values()) {
    const key = `${s.text}|${s.entityid}|${s.type}|${JSON.stringify(s.extra)}`;
    if (!seen.has(key) && s.text.trim()) seen.set(key, { surface: s.text, entityid: s.entityid, type: s.type, extra: { ...s.extra }, variants: [] });
  }
  return [...seen.values()];
}
