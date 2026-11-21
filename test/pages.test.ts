import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { toDoc } from '../src/core/toDoc';
import { serialize } from '../src/core/serialize';
import { buildPageIndex, pageIndexAt } from '../src/core/pageIndex';
import { validate } from '../src/core/validate';
import { structuralChanges, textHunks } from '../src/core/changes';
import { pageGuard } from '../src/editor/pageGuard';
import { seqGuard } from '../src/editor/seqGuard';
import { splitPage } from '../src/editor/pageCommands';
import {
  applyEntity,
  entityAt,
  insertScanBreak,
  mergeWithPrevious,
  removeEntity,
  setNodeAttrs,
  shiftPageNumbers,
  toggleSpanMark,
  updateEntity,
} from '../src/editor/commands';

const SRC =
  '<scanbegin file="1" page="9" />甲乙<scanbreak file="1" y="2" />丙{{丁}}<scanskip file="1" y="3" />戊' +
  '<scanend file="1" page="9" /><scanbegin file="1" page="10" />己<scanbreak file="1" />庚' +
  '<scanend file="1" page="10" /><scanbegin file="1" page="11" />辛<scanend file="1" page="11" />\n';

const state = (src = SRC) => EditorState.create({ doc: toDoc(src), plugins: [seqGuard(), pageGuard()] });
const text = (s: EditorState) => serialize(s.doc);
function posOf(s: EditorState, ch: string): number {
  let found = -1;
  s.doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(ch)) found = pos + n.text!.indexOf(ch);
  });
  if (found < 0) throw new Error(ch);
  return found;
}
function nodePos(s: EditorState, type: string, nth = 0): number {
  const all: number[] = [];
  s.doc.descendants((n, pos) => {
    if (n.type.name === type) all.push(pos);
  });
  return all[nth];
}
function run(s: EditorState, cmd: (st: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean): EditorState {
  let out = s;
  cmd(s, (tr) => (out = s.apply(tr)));
  return out;
}
/** Simulate a drag-and-drop move of the atom at `from` to `to` (positions in the original doc). */
function drop(s: EditorState, from: number, to: number): EditorState {
  const node = s.doc.nodeAt(from)!;
  const tr = s.tr.delete(from, from + 1);
  const at = tr.mapping.map(to);
  tr.insert(at, node).setSelection(NodeSelection.create(tr.doc, at)).setMeta('uiEvent', 'drop');
  return s.apply(tr);
}

describe('page index', () => {
  it('splits pages and columns', () => {
    const pages = buildPageIndex(toDoc(SRC));
    expect(pages.map((p) => p.key)).toEqual(['1:9', '1:10', '1:11']);
    expect(pages[0].lines.map((l) => l.y)).toEqual([0, 2]);
    expect(pages[0].lines[1].segs.map((s) => s.k)).toEqual(['text', 'text', 'skip', 'text']);
    expect(pages[0].lines[1].segs[1]).toMatchObject({ text: '丁', marks: ['note'] });
    expect(pages[0].chars).toBe(5);
  });

  it('locates the page of a position', () => {
    const s = state();
    const pages = buildPageIndex(s.doc);
    expect(pageIndexAt(pages, posOf(s, '甲'))).toBe(0);
    expect(pageIndexAt(pages, posOf(s, '庚'))).toBe(1);
    expect(pageIndexAt(pages, posOf(s, '辛'))).toBe(2);
  });

  it('page hash changes with text, not with seq moves', () => {
    const a = buildPageIndex(toDoc('<scanbegin file="1" page="1" /><seq sid="1" />甲乙<scanend file="1" page="1" />'))[0].hash;
    const b = buildPageIndex(toDoc('<scanbegin file="1" page="1" />甲<seq sid="1" />乙<scanend file="1" page="1" />'))[0].hash;
    const c = buildPageIndex(toDoc('<scanbegin file="1" page="1" />甲丙<scanend file="1" page="1" />'))[0].hash;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('validate', () => {
  it('reports duplicate / backwards / gap / file mismatch / half-width', () => {
    const doc = toDoc(
      '<scanbegin file="1" page="5" />甲,<scanbreak file="2" />乙<scanend file="1" page="5" /><scanbegin file="1" page="5" />丙' +
        '<scanend file="1" page="5" /><scanbegin file="1" page="3" />丁<scanend file="1" page="3" /><scanbegin file="1" page="9" />戊<scanend file="1" page="9" />',
    );
    const msgs = validate(doc, buildPageIndex(doc)).map((d) => `${d.severity}:${d.message}`);
    expect(msgs.some((m) => m.startsWith('warning:半形標點'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('warning:scanbreak 的 file'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('error:頁碼重複'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('error:頁碼倒退'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('info:跳頁'))).toBe(true);
  });
});

describe('dragging scan markers', () => {
  it('a scanbreak can move within its page', () => {
    const s = state();
    const next = drop(s, nodePos(s, 'scanBreak'), posOf(s, '乙'));
    expect(text(next)).toContain('甲<scanbreak file="1" y="2" />乙丙');
  });

  it('a scanbreak dropped into another page takes that page\'s file id', () => {
    const src = SRC.replace('page="11" />辛', 'page="11" />辛').replace(/<scanend file="1" page="10" \/><scanbegin file="1" page="11" \/>/, '<scanend file="1" page="10" /><scanbegin file="7" page="11" />');
    const s = state(src);
    const next = drop(s, nodePos(s, 'scanBreak'), posOf(s, '辛') + 1);
    expect(text(next)).toContain('辛<scanbreak file="7" y="2" />');
  });

  it('a page boundary can move but not past another page boundary', () => {
    const s = state();
    const b = nodePos(s, 'pageBoundary', 0); // 9|10
    const moved = drop(s, b, posOf(s, '戊'));
    expect(text(moved)).toContain('<scanend file="1" page="9" /><scanbegin file="1" page="10" />戊己');
    const rejected = drop(s, b, posOf(s, '辛'));
    expect(rejected).toBe(s);
  });

  it('seq anchors are unaffected by page marker drags', () => {
    const s = state('<scanbegin file="1" page="1" /><seq sid="1" />甲乙<scanend file="1" page="1" /><scanbegin file="1" page="2" />丙<scanend file="1" page="2" />');
    const next = drop(s, nodePos(s, 'pageBoundary'), posOf(s, '乙'));
    expect(text(next)).toBe('<scanbegin file="1" page="1" /><seq sid="1" />甲<scanend file="1" page="1" /><scanbegin file="1" page="2" />乙丙<scanend file="1" page="2" />');
  });
});

describe('page consistency', () => {
  it('split fixes the following <scanend/>; shifting renumbers the rest', () => {
    let s = state();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s, '庚'))));
    s = run(s, splitPage); // 10 | 11(new) before 庚
    expect(text(s)).toContain('己<scanbreak file="1" /><scanend file="1" page="10" /><scanbegin file="1" page="11" />庚<scanend file="1" page="11" /><scanbegin file="1" page="11" />辛');
    const pages = buildPageIndex(s.doc);
    s = run(s, shiftPageNumbers(pages, 3, 1));
    expect(text(s)).toContain('庚<scanend file="1" page="11" /><scanbegin file="1" page="12" />辛<scanend file="1" page="12" />');
  });

  it('merge fixes the following <scanend/>', () => {
    let s = state();
    s = run(s, mergeWithPrevious(buildPageIndex(s.doc), 1));
    expect(text(s)).toBe(
      '<scanbegin file="1" page="9" />甲乙<scanbreak file="1" y="2" />丙{{丁}}<scanskip file="1" y="3" />戊己<scanbreak file="1" />庚' +
        '<scanend file="1" page="9" /><scanbegin file="1" page="11" />辛<scanend file="1" page="11" />\n',
    );
  });

  it('editing y keeps the untouched half of a page boundary verbatim', () => {
    const src = SRC.replace('<scanend file="1" page="9" />', '<scanend   file="1" page="9"/>');
    let s = state(src);
    s = s.apply(setNodeAttrs(s.tr, nodePos(s, 'pageBoundary'), { y: '1' }));
    expect(text(s)).toContain('<scanend   file="1" page="9"/><scanbegin file="1" page="10" y="1" />');
  });
});

describe('marks and atoms', () => {
  const sel = (s: EditorState, a: string, b: string) => s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s, a), posOf(s, b) + 1)));

  it('toggles a note span', () => {
    let s = sel(state(), '甲', '乙');
    s = run(s, toggleSpanMark('note'));
    expect(text(s)).toContain('{{甲乙}}');
    s = run(s, toggleSpanMark('note'));
    expect(text(s)).toContain('page="9" />甲乙<scanbreak');
  });

  it('applies, edits and removes an entity', () => {
    let s = sel(state(), '甲', '乙');
    s = run(s, applyEntity({ entityid: '42', type: 'place' }));
    expect(text(s)).toContain('<entity entityid="42" type="place">甲乙</entity>');
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s, '乙'))));
    expect(entityAt(s)?.mark.attrs.entityid).toBe('42');
    s = run(s, updateEntity({ entityid: '43', type: 'person', extra: { year: '9' } }));
    expect(text(s)).toContain('<entity entityid="43" type="person" year="9">甲乙</entity>');
    s = run(s, removeEntity);
    expect(text(s)).not.toContain('entity');
  });

  it('inserts a scanbreak with the current page file', () => {
    let s = state();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s, '庚'))));
    s = run(s, insertScanBreak);
    expect(text(s)).toContain('<scanbreak file="1" /><scanbreak file="1" />庚');
  });
});

describe('changes', () => {
  it('char hunks', () => {
    const h = textHunks('甲乙丙丁戊', '甲乙X丁戊');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ removed: '丙', added: 'X', before: '甲乙', after: '丁戊' });
  });
  it('structural summary', () => {
    const a = '<scanbegin file="1" page="1" /><seq sid="1" />甲乙<scanend file="1" page="1" />';
    const b = toDoc('<scanbegin file="1" page="1" />甲<seq sid="1" />乙<scanbreak file="1" /><scanend file="1" page="1" /><scanbegin file="1" page="2" /><scanend file="1" page="2" />');
    expect(structuralChanges(a, b)).toMatchObject({ seqMoved: ['1'], pagesAdded: ['p.2'], breaksChanged: [{ key: '1:1', before: 0, after: 1 }] });
  });
});

const SAMPLES = resolve(import.meta.dirname, '../.work/requirement');
describe.runIf(existsSync(resolve(SAMPLES, 'content.txt')))('local samples', () => {
  it('page index matches tag counts; no errors on real data', () => {
    for (const [f, n] of [['content.txt', 101], ['sea.txt', 46]] as const) {
      const doc = toDoc(readFileSync(resolve(SAMPLES, f), 'utf8'));
      const pages = buildPageIndex(doc);
      expect(pages.filter((p) => p.markerPos !== null)).toHaveLength(n);
      expect(validate(doc, pages).filter((d) => d.severity === 'error')).toEqual([]);
      // consistency pass must not touch an unedited real document
      const s = EditorState.create({ doc, plugins: [pageGuard()] });
      const next = s.apply(s.tr.insertText('', 1));
      expect(serialize(next.doc)).toBe(serialize(doc));
    }
  });
});
