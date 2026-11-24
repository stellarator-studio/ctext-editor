/**
 * ProseMirror schema for cText documents.
 *
 * Layout structure (pages, columns, blanks) is modelled as inline atoms and
 * semantic structure (notes, entities, …) as marks, so the two overlapping
 * hierarchies never conflict. Atoms keep their source in `raw`; a null `raw`
 * means "regenerate from attrs" (set by commands that change attrs).
 *
 * This module has no DOM dependency (toDOM specs are plain arrays).
 */
import { Schema, type DOMOutputSpec, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';

const raw = { raw: { default: null as string | null } };

/**
 * Every node/mark writes its type and attrs into the DOM (data-ct / data-attrs)
 * so copy-paste and drag-and-drop through HTML restore the exact node.
 */
const dataAttrs = (kind: string, attrs: Record<string, unknown>) => ({ 'data-ct': kind, 'data-attrs': JSON.stringify(attrs) });
const parseData = (kind: string, tag = 'span') => [
  { tag: `${tag}[data-ct="${kind}"]`, getAttrs: (dom: HTMLElement) => JSON.parse(dom.getAttribute('data-attrs') ?? '{}') },
];

function atom(name: string, cls: string, label: (n: PMNode) => string, attrs: NodeSpec['attrs'], extra: Partial<NodeSpec> = {}): NodeSpec {
  return {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { ...raw, ...attrs },
    toDOM: (n): DOMOutputSpec => [
      'span',
      { class: `ct-atom ${cls}`, contenteditable: 'false', title: n.attrs.raw ?? '', ...dataAttrs(name, n.attrs) },
      label(n),
    ],
    parseDOM: parseData(name),
    ...extra,
  };
}

function spanMark(name: string, cls: string): MarkSpec {
  return {
    attrs: { iid: { default: 0 } },
    excludes: '',
    toDOM: (m) => ['span', { class: cls, ...dataAttrs(name, m.attrs) }, 0],
    parseDOM: parseData(name),
  };
}

const sup = (y: string | null) => (y ? String(y).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]) : '');

export const schema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
      /** Trailing newlines at end of file, kept out of the block structure. */
      attrs: { trailing: { default: '' } },
    },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      /**
       * level = number of '*'. prefix = number of leading inline nodes that
       * precede the '*' marker in the source. Only page markers belong there
       * (`<scanbegin/>*<seq/>…`); see leadingPageMarkers.
       */
      attrs: { level: { default: 1 }, prefix: { default: 0 } },
      toDOM: (n) => [`h${Math.min(n.attrs.level + 1, 6)}`, dataAttrs('heading', n.attrs), 0],
      parseDOM: [{ tag: '[data-ct="heading"]', getAttrs: (dom) => JSON.parse(dom.getAttribute('data-attrs') ?? '{}') }],
    },
    text: { group: 'inline' },

    /** <scanbegin …/> with no <scanend/> right before it (start of the text). */
    pageStart: atom('pageStart', 'ct-page', (n) => `▼ p.${n.attrs.page}`, { file: { default: '' }, page: { default: '' }, y: { default: null } }, { draggable: true }),
    /** <scanend …/> with no <scanbegin/> right after it (end of the text). */
    pageEnd: atom('pageEnd', 'ct-page', (n) => `▲ p.${n.attrs.page}`, { file: { default: '' }, page: { default: '' } }, { draggable: true }),
    /** <scanend …/><scanbegin …/> — one node so pages can be split/merged by insert/delete. */
    pageBoundary: atom(
      'pageBoundary', 'ct-page',
      (n) => `p.${n.attrs.endPage} │ p.${n.attrs.beginPage}${sup(n.attrs.y)}`,
      {
        rawEnd: { default: null },
        rawBegin: { default: null },
        endFile: { default: '' },
        endPage: { default: '' },
        beginFile: { default: '' },
        beginPage: { default: '' },
        y: { default: null },
      },
      { draggable: true },
    ),
    scanBreak: atom('scanBreak', 'ct-break', (n) => `⏎${sup(n.attrs.y)}`, { file: { default: '' }, y: { default: null } }, { draggable: true }),
    scanSkip: atom('scanSkip', 'ct-skip', (n) => `␣${n.attrs.y ?? ''}`, { file: { default: '' }, y: { default: null } }, { draggable: true }),
    /** <seq sid/> — protected: may move (between neighbours) but never be deleted or renumbered. */
    seq: atom('seq', 'ct-seq', (n) => `${n.attrs.sid}`, { sid: { default: '' } }, { draggable: true }),
    /** wiki '|' */
    lineBreak: atom('lineBreak', 'ct-bar', () => '|', {}),
    /** stray single '\n' (paragraphs are separated by '\n\n') */
    newline: atom('newline', 'ct-nl', () => '↵', {}),
    collation: atom(
      'collation', 'ct-coll',
      (n) => (n.attrs.kind === 'add' ? `［${n.attrs.corr}］` : n.attrs.kind === 'del' ? `（${n.attrs.orig}）` : `（${n.attrs.orig}）［${n.attrs.corr}］`),
      { kind: { default: 'fix' }, orig: { default: '' }, corr: { default: '' }, note: { default: '' } },
    ),
    missing: atom('missing', 'ct-missing', () => '●', { desc: { default: '' } }),
    /** Any other tag (<picture/>, <character/>, unknown or unpaired tags): kept verbatim. */
    tag: atom('tag', 'ct-tag', (n) => `<${n.attrs.name}>`, { name: { default: '' } }),
  },
  // Order = nesting rank (outer first). Serialization opens tags in this order.
  marks: {
    big: spanMark('big', 'ct-big'),
    note: spanMark('note', 'ct-note'),
    margin: spanMark('margin', 'ct-margin'),
    inverted: spanMark('inverted', 'ct-inverted'),
    circled: spanMark('circled', 'ct-circled'),
    entity: {
      attrs: {
        iid: { default: 0 },
        raw: { default: null as string | null },
        rawClose: { default: '</entity>' },
        entityid: { default: '' },
        type: { default: '' },
        extra: { default: {} as Record<string, string> },
      },
      excludes: '',
      toDOM: (m) => ['span', { class: `ct-entity ct-entity-${m.attrs.type}`, title: `${m.attrs.type} #${m.attrs.entityid}`, ...dataAttrs('entity', m.attrs) }, 0],
      parseDOM: parseData('entity'),
    },
  },
});

/** Inline node types that carry layout/anchor information rather than text. */
export const MILESTONES = new Set(['pageStart', 'pageEnd', 'pageBoundary', 'scanBreak', 'scanSkip', 'seq', 'tag']);

const PAGE_MARKERS = new Set(['pageStart', 'pageBoundary', 'pageEnd']);
/**
 * Number of page markers at the start of a block. A heading's `*` goes right
 * after them and before anything else, `<seq/>` and `<scanbreak/>` included
 * (`<scanbegin/>*<seq/>標題`, `**<scanbreak/><seq/>標題`).
 */
export function leadingPageMarkers(block: PMNode): number {
  let i = 0;
  while (i < block.childCount && PAGE_MARKERS.has(block.child(i).type.name)) i++;
  return i;
}
