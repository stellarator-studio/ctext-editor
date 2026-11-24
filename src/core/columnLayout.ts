/**
 * Layout of a page's original columns for the proofreading view.
 *
 * A double-line note ({{ }}, also {{{ }}}) of n character cells is printed as
 * two small lines: the first ceil(n/2) cells, then the rest. Each note span is
 * laid out on its own, so `{{AB}}{{　}}` gives two note blocks while
 * `{{AB　}}` gives one. Spaces and scanskips inside a note count as cells
 * like any character (`{{A<scanskip y="1"/>BCD}}` → `A□B` / `CD`).
 *
 * A scanbreak inside a note that starts its column (no body text before it)
 * ends the note's first small line, not the column: `{{AB<scanbreak/>CD}}`
 * is one column with `AB` / `CD`. The next scanbreak inside the same note
 * starts a new column, which again begins with the note, and so on.
 */
import type { Line, Seg } from './pageIndex';

export const isSpace = (ch: string) => ch === ' ' || ch === '　';
const cellCount = (s: string) => [...s].length;

type TextSeg = Extract<Seg, { k: 'text' | 'coll' }>;

/** One cell of a note: a character, a blank cell (scanskip), or a seq anchor (no width). */
export type NoteCell = { ch: string; pos: number; seg: TextSeg } | { blank: true; pos: number } | { sid: string; pos: number };

/** Segments of one physical column; `split` = a scanbreak that ends a note's first small line. */
export type ColSeg = Seg | { k: 'split'; from: number };

export type ColumnItem =
  | { k: 'seg'; seg: Seg }
  | {
      k: 'note';
      /** iid of the note span */
      id: number;
      /** number of cells (characters and blanks) */
      cells: number;
      /** the two small lines (the second may be empty) */
      lines: [NoteCell[], NoteCell[]];
      /** the line split comes from a scanbreak in the source, not from halving */
      explicit: boolean;
    };

export interface Column {
  /** indexes of the source lines (Page.lines) shown in this column */
  lines: number[];
  y: number;
  items: ColumnItem[];
}

const noteIdOf = (s: ColSeg) => (s.k === 'text' || s.k === 'coll' || s.k === 'skip' ? s.note : undefined);

/** The note a column starts with (seq anchors and a leading split ignored), if any. */
function leadingNote(segs: ColSeg[]): number | undefined {
  const first = segs.find((s) => s.k !== 'seq');
  return first ? noteIdOf(first) : undefined;
}

/**
 * Group source lines into physical columns (see the module comment).
 * `view` filters the segments shown (e.g. hide punctuation); which lines are
 * merged is decided on the unfiltered segments.
 */
export function layoutPage(lines: Pick<Line, 'y' | 'segs' | 'inNote' | 'breakPos'>[], view: (segs: Seg[]) => Seg[] = (s) => s): Column[] {
  const cols: { lines: number[]; y: number; segs: ColSeg[]; shown: ColSeg[]; split: boolean }[] = [];
  lines.forEach((l, i) => {
    const cur = cols[cols.length - 1];
    if (cur && !cur.split && l.inNote !== undefined && leadingNote(cur.segs) === l.inNote) {
      const last = [...cur.segs].reverse().find((s) => s.k !== 'seq');
      if (last && noteIdOf(last) === l.inNote) {
        cur.lines.push(i);
        const split = { k: 'split' as const, from: l.breakPos ?? 0 };
        cur.segs.push(split, ...l.segs);
        cur.shown.push(split, ...view(l.segs));
        cur.split = true;
        return;
      }
    }
    cols.push({ lines: [i], y: l.y, segs: [...l.segs], shown: [...view(l.segs)], split: false }); // copies: never mutate the page index
  });
  return cols.map((c) => ({ lines: c.lines, y: c.y, items: layoutColumn(c.shown) }));
}

/** Group a column's segments: consecutive segments of the same note span form one note. */
export function layoutColumn(segs: ColSeg[]): ColumnItem[] {
  const out: ColumnItem[] = [];
  let group: ColSeg[] = [];
  let groupId: number | null = null;
  /** seq anchors seen after a note, kept until we know whether the note continues */
  let pendingSeq: Seg[] = [];

  const flush = () => {
    if (groupId === null) return;
    out.push(noteItem(groupId, group));
    group = [];
    groupId = null;
  };

  for (const s of segs) {
    if (s.k === 'split') {
      if (groupId !== null) group.push(...pendingSeq, s);
      else out.push(...pendingSeq.map((p) => ({ k: 'seg' as const, seg: p })));
      pendingSeq = [];
      continue;
    }
    const note = noteIdOf(s);
    if (s.k === 'seq' && groupId !== null) {
      pendingSeq.push(s);
      continue;
    }
    if (note !== undefined && note === groupId) {
      group.push(...pendingSeq, s);
      pendingSeq = [];
      continue;
    }
    flush();
    for (const p of pendingSeq) out.push({ k: 'seg', seg: p });
    pendingSeq = [];
    if (note !== undefined) {
      groupId = note;
      group = [s];
    } else out.push({ k: 'seg', seg: s });
  }
  flush();
  for (const p of pendingSeq) out.push({ k: 'seg', seg: p });
  return out;
}

function noteItem(id: number, segs: ColSeg[]): ColumnItem {
  const flat: (NoteCell | 'split')[] = [];
  for (const s of segs) {
    if (s.k === 'split') flat.push('split');
    else if (s.k === 'seq') flat.push({ sid: s.sid, pos: s.from });
    else if (s.k === 'skip') for (let i = 0; i < s.n; i++) flat.push({ blank: true, pos: s.from });
    else if (s.k === 'text' || s.k === 'coll') {
      let off = 0;
      for (const ch of s.text) {
        // collation atoms are one document position; text advances per UTF-16 unit
        flat.push({ ch, pos: s.k === 'text' ? s.from + off : s.from, seg: s });
        off += ch.length;
      }
    }
  }
  const isCell = (c: NoteCell | 'split') => c !== 'split' && !('sid' in c);
  const cells = flat.filter(isCell).length;
  const lines: [NoteCell[], NoteCell[]] = [[], []];
  const explicit = flat.includes('split');
  if (explicit) {
    let line = 0;
    for (const c of flat) {
      if (c === 'split') line = 1;
      else lines[line].push(c);
    }
  } else {
    const first = Math.ceil(cells / 2);
    let seen = 0;
    for (const c of flat) {
      if (c === 'split') continue;
      // a seq anchor goes with the cell after it
      lines[seen < first ? 0 : 1].push(c);
      if (isCell(c)) seen++;
    }
  }
  return { k: 'note', id, cells, lines, explicit };
}

/** Length of a note in big character cells: its longer small line. */
export function noteLength(it: Extract<ColumnItem, { k: 'note' }>): number {
  const len = (l: NoteCell[]) => l.filter((c) => !('sid' in c)).length;
  return it.explicit ? Math.max(len(it.lines[0]), len(it.lines[1])) : Math.ceil(it.cells / 2);
}

/** Column height in character cells. */
export function columnCells(items: ColumnItem[]): number {
  let n = 0;
  for (const it of items) {
    if (it.k === 'note') n += noteLength(it);
    else if (it.seg.k === 'text' || it.seg.k === 'coll') n += cellCount(it.seg.text);
    else if (it.seg.k === 'skip') n += it.seg.n;
  }
  return n;
}

/** Split text into runs of spaces and non-spaces, with their UTF-16 offsets. */
export function spaceRuns(text: string): { text: string; offset: number; space: boolean }[] {
  const out: { text: string; offset: number; space: boolean }[] = [];
  for (const m of text.matchAll(/[ 　]+|[^ 　]+/g)) out.push({ text: m[0], offset: m.index!, space: isSpace(m[0][0]) });
  return out;
}
