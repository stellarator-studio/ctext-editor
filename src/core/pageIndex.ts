/**
 * Derive the physical page/column structure from a document.
 *
 * Pages start at pageStart / pageBoundary; columns (lines) start at the page
 * start and after each scanBreak. Block (paragraph) boundaries do not affect
 * the physical layout. Positions are ProseMirror document positions.
 */
import type { Node as PMNode } from 'prosemirror-model';

export type Seg =
  /** `note`: iid of the {{ }} / {{{ }}} span the text belongs to, so adjacent notes stay apart */
  | { k: 'text'; text: string; from: number; marks: string[]; entity?: string; note?: number }
  /** blank character cells (scanskip y=n); `note` if the scanskip sits inside a note */
  | { k: 'skip'; n: number; from: number; note?: number }
  | { k: 'seq'; sid: string; from: number }
  /** collation: shows the base-text (底本) reading */
  | { k: 'coll'; text: string; from: number; marks: string[]; note?: number };

export interface Line {
  /** leading blank cells */
  y: number;
  /** position of the scanBreak that starts this line (null for the first line) */
  breakPos: number | null;
  /** iid of the note the starting scanBreak sits in (`{{AB<scanbreak/>CD}}`) */
  inNote?: number;
  from: number;
  segs: Seg[];
}

export interface Page {
  idx: number;
  /** `${file}:${page}`; '' file/page for content outside any page */
  key: string;
  file: string;
  page: string;
  /** position of the marker that starts the page (null for content before any page) */
  markerPos: number | null;
  markerType: 'pageStart' | 'pageBoundary' | null;
  /** position of a pageEnd marker that closes the page, if any */
  endPos: number | null;
  from: number;
  to: number;
  lines: Line[];
  /** hash of the page's text + layout (excluding seq anchors) — for proofreading staleness */
  hash: string;
  /** number of text characters (code points) */
  chars: number;
}

const toInt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** iid of the note-like span ({{ }} or {{{ }}}) on a node, if any. */
function noteOf(node: PMNode): { note?: number } {
  const m = node.marks.find((x) => x.type.name === 'note' || x.type.name === 'margin');
  return m ? { note: m.attrs.iid as number } : {};
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function buildPageIndex(doc: PMNode): Page[] {
  const pages: Page[] = [];
  let cur: Page | null = null;
  let canon = '';
  let lastSig = '';
  /** append text with its mark signature, independent of how text nodes are split */
  const canonText = (sig: string, text: string) => {
    if (sig !== lastSig) canon += `[${sig}]`;
    lastSig = sig;
    canon += text;
  };

  const finish = (to: number) => {
    if (!cur) return;
    cur.to = to;
    cur.hash = fnv1a(canon);
    pages.push(cur);
    cur = null;
    canon = '';
  };
  const start = (file: string, page: string, y: number, markerPos: number | null, markerType: Page['markerType'], from: number) => {
    cur = {
      idx: pages.length,
      key: `${file}:${page}`,
      file,
      page,
      markerPos,
      markerType,
      endPos: null,
      from,
      to: from,
      lines: [{ y, breakPos: null, from, segs: [] }],
      hash: '',
      chars: 0,
    };
  };
  const ensure = (pos: number): Page => {
    if (!cur) start('', '', 0, null, null, pos);
    return cur!;
  };
  const line = (p: Page) => p.lines[p.lines.length - 1];

  doc.descendants((node, pos) => {
    if (node.isBlock) return true;
    const a = node.attrs;
    switch (node.type.name) {
      case 'pageStart':
        finish(pos);
        start(a.file, a.page, toInt(a.y), pos, 'pageStart', pos + node.nodeSize);
        canon += `B${a.y ?? ''}|`; lastSig = '\0';
        break;
      case 'pageBoundary':
        if (cur) (cur as Page).endPos = pos;
        finish(pos);
        start(a.beginFile, a.beginPage, toInt(a.y), pos, 'pageBoundary', pos + node.nodeSize);
        canon += `B${a.y ?? ''}|`; lastSig = '\0';
        break;
      case 'pageEnd': {
        const p = ensure(pos);
        p.endPos = pos;
        finish(pos);
        break;
      }
      case 'scanBreak': {
        const p = ensure(pos);
        const n = noteOf(node).note;
        p.lines.push({ y: toInt(a.y), breakPos: pos, from: pos + node.nodeSize, segs: [], ...(n !== undefined ? { inNote: n } : {}) });
        canon += `\n${a.y ?? ''}|`; lastSig = '\0';
        break;
      }
      case 'scanSkip':
        line(ensure(pos)).segs.push({ k: 'skip', n: toInt(a.y) || 1, from: pos, ...noteOf(node) });
        canon += `_${a.y ?? ''}`; lastSig = '\0';
        break;
      case 'seq':
        line(ensure(pos)).segs.push({ k: 'seq', sid: a.sid, from: pos });
        break;
      case 'collation': {
        const text = a.kind === 'add' ? '' : a.orig;
        if (text) line(ensure(pos)).segs.push({ k: 'coll', text, from: pos, marks: node.marks.map((m) => m.type.name), ...noteOf(node) });
        canon += `(${a.orig}|${a.corr}|${a.note})`; lastSig = '\0';
        break;
      }
      case 'missing':
        line(ensure(pos)).segs.push({ k: 'text', text: '●', from: pos, marks: node.marks.map((m) => m.type.name), ...noteOf(node) });
        canon += `●${a.desc}`; lastSig = '\0';
        break;
      case 'text': {
        const p = ensure(pos);
        const ent = node.marks.find((m) => m.type.name === 'entity');
        line(p).segs.push({
          k: 'text',
          text: node.text!,
          from: pos,
          marks: node.marks.map((m) => m.type.name),
          ...(ent ? { entity: ent.attrs.type as string } : {}),
          ...noteOf(node),
        });
        p.chars += [...node.text!].length;
        canonText(node.marks.map((m) => m.type.name).join(','), node.text!);
        break;
      }
      default:
        // lineBreak, newline, tag: no physical layout
        break;
    }
    return false;
  });
  finish(doc.content.size);
  // Drop an empty trailing pseudo-page (e.g. blank lines after the last <scanend/>).
  const last = pages[pages.length - 1];
  if (last && last.markerPos === null && last.chars === 0 && pages.length > 1) pages.pop();
  return pages;
}

/** Index of the page containing `pos` (binary search on page.from). */
export function pageIndexAt(pages: Page[], pos: number): number {
  let lo = 0;
  let hi = pages.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = pages[mid].markerPos ?? pages[mid].from;
    if (start <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
