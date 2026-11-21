import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { toDoc } from '../src/core/toDoc';
import { serialize } from '../src/core/serialize';
import { buildPageIndex } from '../src/core/pageIndex';
import { entityKey, harvestEntities, mergeEntries, type DictEntry } from '../src/core/annotate';
import { expandReplacement } from '../src/core/search';
import { findInDoc, replaceMatches } from '../src/editor/search';
import { clearFormat, setBlockLevel, setLineY } from '../src/editor/commands';
import { seqGuard } from '../src/editor/seqGuard';
import { fileIdsIn } from '../src/store/projects';

function state(src: string, from?: number, to?: number) {
  const s = EditorState.create({ doc: toDoc(src), plugins: [seqGuard()] });
  return from === undefined ? s : s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to ?? from)));
}
function run(s: EditorState, cmd: Command): string {
  let out = s;
  cmd(s, (tr) => (out = s.apply(tr)));
  return serialize(out.doc);
}
/** document position of the n-th occurrence of `ch` */
function posOf(s: EditorState, ch: string, nth = 0): number {
  let found = -1;
  let k = 0;
  s.doc.descendants((n, p) => {
    if (found >= 0 || !n.isText) return found < 0;
    let i = n.text!.indexOf(ch);
    while (i >= 0) {
      if (k++ === nth) {
        found = p + i;
        return false;
      }
      i = n.text!.indexOf(ch, i + 1);
    }
    return false;
  });
  return found;
}

const entry = (surface: string, entityid: string, variants: string[] = [], id = surface): DictEntry => ({ id, surface, entityid, type: 'place', extra: {}, variants, source: 'manual' });
const make = (e: Omit<DictEntry, 'id' | 'source'>): DictEntry => ({ ...e, id: `new-${e.surface}`, source: 'harvest' });

describe('dictionary: one entry per entity', () => {
  it('harvest groups spellings of the same entity', () => {
    const h = harvestEntities(toDoc('<entity entityid="1" type="place">英吉利</entity>、<entity entityid="1" type="place">英國</entity>、<entity entityid="2" type="place">英</entity>'));
    expect(h).toEqual([
      { surface: '英吉利', entityid: '1', type: 'place', extra: {}, variants: ['英國'] },
      { surface: '英', entityid: '2', type: 'place', extra: {}, variants: [] },
    ]);
  });
  it('entity key ignores attribute order', () => {
    expect(entityKey({ entityid: '1', type: 'date', extra: { a: '1', b: '2' } })).toBe(entityKey({ entityid: '1', type: 'date', extra: { b: '2', a: '1' } }));
  });
  it('merges new spellings into the existing entry and folds duplicates', () => {
    const existing = [entry('英吉利', '1'), entry('英國', '1', [], 'dup'), entry('緬甸', '3')];
    const r = mergeEntries(existing, [{ surface: '英倫', entityid: '1', type: 'place', extra: {}, variants: ['英國'] }, { surface: '暹羅', entityid: '4', type: 'place', extra: {}, variants: [] }], make);
    expect(r.removed).toEqual(['dup']);
    expect(r.added).toBe(1);
    expect(r.termsAdded).toBe(1);
    expect(r.put.find((e) => e.id === '英吉利')).toMatchObject({ surface: '英吉利', variants: ['英國', '英倫'] });
    expect(r.put.find((e) => e.id === 'new-暹羅')).toBeTruthy();
    expect(r.put.some((e) => e.id === '緬甸')).toBe(false); // unchanged entries are not rewritten
  });
  it('nothing to do when everything is known', () => {
    expect(mergeEntries([entry('英吉利', '1', ['英國'])], [{ surface: '英國', entityid: '1', type: 'place', extra: {}, variants: [] }], make).put).toEqual([]);
  });
});

describe('find / replace', () => {
  const SRC = '<scanbegin file="1" page="1" />英吉<scanbreak file="1" />利與英<seq sid="5" />吉利，英吉利<scanend file="1" page="1" />';
  it('finds terms across column breaks and seq anchors', () => {
    const doc = toDoc(SRC);
    expect((findInDoc(doc, { text: '英吉利', regex: false }, true) as unknown[]).length).toBe(3);
    expect((findInDoc(doc, { text: '英吉利', regex: false }, false) as unknown[]).length).toBe(1);
  });
  it('does not match across paragraphs', () => {
    expect(findInDoc(toDoc('英吉\n\n利'), { text: '英吉利', regex: false }, true)).toEqual([]);
  });
  it('replace all keeps markers and seq anchors', () => {
    const s = state(SRC);
    const ms = findInDoc(s.doc, { text: '英吉利', regex: false }, true) as ReturnType<typeof findInDoc> & object[];
    const out = s.apply(replaceMatches(s.tr, ms as never, '英國', false));
    expect(serialize(out.doc)).toBe('<scanbegin file="1" page="1" />英國<scanbreak file="1" />與英國<seq sid="5" />，英國<scanend file="1" page="1" />');
  });
  it('keeps marks of the replaced text', () => {
    const s = state('{{甲乙}}丙');
    const ms = findInDoc(s.doc, { text: '乙', regex: false }, true) as never;
    expect(serialize(s.apply(replaceMatches(s.tr, ms, '丁', false)).doc)).toBe('{{甲丁}}丙');
  });
  it('regex with groups', () => {
    const s = state('卷一 卷二');
    const ms = findInDoc(s.doc, { text: '卷(.)', regex: true }, true) as never;
    expect(serialize(s.apply(replaceMatches(s.tr, ms, '第$1卷', true)).doc)).toBe('第一卷 第二卷');
    expect(expandReplacement('$$1 $& $9', ['ab', 'a'], true)).toBe('$1 ab $9');
    expect(findInDoc(s.doc, { text: '(', regex: true }, true)).toMatch(/正規表示式/);
  });
});

describe('block level (headings)', () => {
  it('turns a paragraph into a heading after its page marker', () => {
    const s = state('<scanbegin file="1" page="1" />卷一\n\n正文', 3);
    expect(run(s, setBlockLevel(1))).toBe('<scanbegin file="1" page="1" />*卷一\n\n正文');
    expect(run(s, setBlockLevel(2))).toBe('<scanbegin file="1" page="1" />**卷一\n\n正文');
  });
  it('back to a paragraph', () => {
    expect(run(state('*卷一\n\n正文', 2), setBlockLevel(0))).toBe('卷一\n\n正文');
  });
  it('a selection inside a paragraph becomes its own block; markers alone are not split off', () => {
    const s0 = state('<scanbegin file="1" page="1" />卷一序文甲乙<scanbreak file="1" />');
    const s = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, posOf(s0, '卷'), posOf(s0, '一') + 1)));
    expect(run(s, setBlockLevel(1))).toBe('<scanbegin file="1" page="1" />*卷一\n\n序文甲乙<scanbreak file="1" />');
    const t = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, posOf(s0, '序'), posOf(s0, '乙') + 1)));
    expect(run(t, setBlockLevel(1))).toBe('<scanbegin file="1" page="1" />卷一\n\n*序文甲乙<scanbreak file="1" />');
  });
});

describe('clear format', () => {
  it('removes spans but keeps entities', () => {
    const s0 = state('{{甲<entity entityid="1" type="place">乙</entity>}}【丙】');
    const s = s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, 1, s0.doc.content.size - 1)));
    expect(run(s, clearFormat)).toBe('甲<entity entityid="1" type="place">乙</entity>丙');
  });
});

describe('column y', () => {
  it('sets the y of a scanbreak or of the page marker', () => {
    const s = state('<scanbegin file="1" page="1" />甲<scanbreak file="1" y="2" />乙<scanend file="1" page="1" />');
    const page = buildPageIndex(s.doc)[0];
    expect(run(s, setLineY(page, 1, 3))).toContain('甲<scanbreak file="1" y="3" />乙');
    expect(run(s, setLineY(page, 1, 0))).toContain('甲<scanbreak file="1" />乙');
    expect(run(s, setLineY(page, 0, 1))).toContain('<scanbegin file="1" page="1" y="1" />甲');
  });
});

describe('project file', () => {
  it('collects file ids used in the text', () => {
    expect([...fileIdsIn('<scanbegin file="1" page="1" />甲<scanbreak file="2" />')]).toEqual(['1', '2']);
  });
});
