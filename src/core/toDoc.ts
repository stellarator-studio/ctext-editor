/**
 * cText text → ProseMirror document.
 *
 * Pass 1 (resolve): pair span openers/closers with a stack; unmatched ones
 * degrade to plain text / verbatim tags so nothing is lost.
 * Pass 2 (build): split into blocks on '\n\n', attach marks, detect headings.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { lex, type Attrs, type Token } from './lexer';
import { MILESTONES, schema } from './schema';

type SpanType = 'big' | 'note' | 'margin' | 'inverted' | 'circled' | 'entity';

type Item =
  | { k: 'text'; text: string }
  | { k: 'nl'; n: number }
  | { k: 'atom'; type: string; attrs: Record<string, unknown> }
  | { k: 'open'; id: number; type: SpanType; raw: string; attrs: Record<string, unknown> }
  | { k: 'close'; id: number; raw: string };

const BRACE_TYPES: SpanType[] = ['big', 'note', 'margin']; // width 1, 2, 3
const BRACKETS: Record<string, { type: SpanType; open: boolean }> = {
  '【': { type: 'inverted', open: true },
  '】': { type: 'inverted', open: false },
  '〖': { type: 'circled', open: true },
  '〗': { type: 'circled', open: false },
};

function tagAtom(tok: Extract<Token, { t: 'tag' }>): Item {
  const a = tok.attrs;
  if (tok.self) {
    switch (tok.name) {
      case 'scanbegin':
        return { k: 'atom', type: 'pageStart', attrs: { raw: tok.raw, file: a.file ?? '', page: a.page ?? '', y: a.y ?? null } };
      case 'scanend':
        return { k: 'atom', type: 'pageEnd', attrs: { raw: tok.raw, file: a.file ?? '', page: a.page ?? '' } };
      case 'scanbreak':
        return { k: 'atom', type: 'scanBreak', attrs: { raw: tok.raw, file: a.file ?? '', y: a.y ?? null } };
      case 'scanskip':
        return { k: 'atom', type: 'scanSkip', attrs: { raw: tok.raw, file: a.file ?? '', y: a.y ?? null } };
      case 'seq':
        return { k: 'atom', type: 'seq', attrs: { raw: tok.raw, sid: a.sid ?? '' } };
    }
  }
  return { k: 'atom', type: 'tag', attrs: { raw: tok.raw, name: (tok.close ? '/' : '') + tok.name } };
}

function entityAttrs(a: Attrs) {
  const { entityid = '', type = '', ...extra } = a;
  return { entityid, type, extra };
}

/** Pass 1. */
function resolve(tokens: Token[]): Item[] {
  const items: Item[] = [];
  const stack: { id: number; type: SpanType; idx: number }[] = [];
  let nextId = 1;

  const open = (type: SpanType, raw: string, attrs: Record<string, unknown> = {}) => {
    const id = nextId++;
    stack.push({ id, type, idx: items.length });
    items.push({ k: 'open', id, type, raw, attrs });
  };
  /** Close the innermost open span matching `pred`; false if none. */
  const close = (pred: (t: SpanType) => boolean, raw: string): boolean => {
    for (let s = stack.length - 1; s >= 0; s--) {
      if (pred(stack[s].type)) {
        const [e] = stack.splice(s, 1);
        const opener = items[e.idx] as Extract<Item, { k: 'open' }>;
        if (e.idx === items.length - 1) {
          // Empty span: no content to carry a mark, keep it verbatim instead.
          items[e.idx] = opener.type === 'entity' ? { k: 'atom', type: 'tag', attrs: { raw: opener.raw, name: 'entity' } } : { k: 'text', text: opener.raw };
          items.push(opener.type === 'entity' ? { k: 'atom', type: 'tag', attrs: { raw, name: '/entity' } } : { k: 'text', text: raw });
        } else {
          items.push({ k: 'close', id: e.id, raw });
        }
        return true;
      }
    }
    return false;
  };

  for (const tok of tokens) {
    switch (tok.t) {
      case 'text':
        items.push({ k: 'text', text: tok.raw });
        break;
      case 'nl':
        items.push({ k: 'nl', n: tok.raw.length });
        break;
      case 'bar':
        items.push({ k: 'atom', type: 'lineBreak', attrs: { raw: tok.raw } });
        break;
      case 'missing':
        items.push({ k: 'atom', type: 'missing', attrs: { raw: tok.raw, desc: tok.desc } });
        break;
      case 'collation':
        items.push({ k: 'atom', type: 'collation', attrs: { raw: tok.raw, kind: tok.kind, orig: tok.orig, corr: tok.corr, note: tok.note } });
        break;
      case 'braceOpen': {
        let n = tok.raw.length;
        while (n > 0) {
          const w = Math.min(n, 3);
          open(BRACE_TYPES[w - 1], '{'.repeat(w));
          n -= w;
        }
        break;
      }
      case 'braceClose': {
        let n = tok.raw.length;
        while (n > 0) {
          const top = [...stack].reverse().find((e) => BRACE_TYPES.includes(e.type));
          const w = top ? BRACE_TYPES.indexOf(top.type) + 1 : 0;
          if (!top || w > n) break;
          close((t) => t === top.type, '}'.repeat(w));
          n -= w;
        }
        if (n > 0) items.push({ k: 'text', text: '}'.repeat(n) });
        break;
      }
      case 'bracket': {
        const b = BRACKETS[tok.raw];
        if (b.open) open(b.type, tok.raw);
        else if (!close((t) => t === b.type, tok.raw)) items.push({ k: 'text', text: tok.raw });
        break;
      }
      case 'tag':
        if (tok.name === 'entity' && !tok.self) {
          if (!tok.close) open('entity', tok.raw, entityAttrs(tok.attrs));
          else if (!close((t) => t === 'entity', tok.raw)) items.push(tagAtom(tok));
          break;
        }
        items.push(tagAtom(tok));
        break;
    }
  }

  // Unclosed openers degrade to verbatim content.
  for (const e of stack) {
    const o = items[e.idx] as Extract<Item, { k: 'open' }>;
    items[e.idx] = o.type === 'entity' ? { k: 'atom', type: 'tag', attrs: { raw: o.raw, name: 'entity' } } : { k: 'text', text: o.raw };
  }

  // Merge <scanend/><scanbegin/> into a single pageBoundary.
  const merged: Item[] = [];
  for (const it of items) {
    const prev = merged[merged.length - 1];
    if (it.k === 'atom' && it.type === 'pageStart' && prev?.k === 'atom' && prev.type === 'pageEnd') {
      merged[merged.length - 1] = {
        k: 'atom',
        type: 'pageBoundary',
        attrs: {
          rawEnd: prev.attrs.raw,
          rawBegin: it.attrs.raw,
          endFile: prev.attrs.file,
          endPage: prev.attrs.page,
          beginFile: it.attrs.file,
          beginPage: it.attrs.page,
          y: it.attrs.y,
        },
      };
    } else merged.push(it);
  }
  return merged;
}

function markFor(o: Extract<Item, { k: 'open' }>): Mark {
  if (o.type === 'entity') return schema.marks.entity.create({ iid: o.id, raw: o.raw, ...o.attrs });
  return schema.marks[o.type].create({ iid: o.id });
}

/** Turn a paragraph whose first text (after milestones only) starts with '*' into a heading. */
function makeBlock(inlines: PMNode[]): PMNode {
  let i = 0;
  while (i < inlines.length && !inlines[i].isText && MILESTONES.has(inlines[i].type.name)) i++;
  const first = inlines[i];
  if (first?.isText) {
    const stars = /^\*+/.exec(first.text!)?.[0].length ?? 0;
    if (stars > 0) {
      const rest = first.text!.slice(stars);
      const content = [...inlines.slice(0, i), ...(rest ? [schema.text(rest, first.marks)] : []), ...inlines.slice(i + 1)];
      return schema.nodes.heading.create({ level: stars, prefix: i }, content);
    }
  }
  return schema.nodes.paragraph.create(null, inlines);
}

export function toDoc(src: string): PMNode {
  const trailing = /\n*$/.exec(src)![0];
  const body = src.slice(0, src.length - trailing.length);
  const items = resolve(lex(body));

  const blocks: PMNode[] = [];
  let inlines: PMNode[] = [];
  let marks: readonly Mark[] = [];
  const active = new Map<number, Mark>();
  const recompute = () => {
    marks = [...active.values()].reduce<readonly Mark[]>((set, m) => m.addToSet(set), []);
  };

  for (const it of items) {
    switch (it.k) {
      case 'text':
        if (it.text) inlines.push(schema.text(it.text, marks));
        break;
      case 'atom':
        inlines.push(schema.nodes[it.type].create(it.attrs, null, marks));
        break;
      case 'open':
        active.set(it.id, markFor(it));
        recompute();
        break;
      case 'close': {
        const m = active.get(it.id)!;
        if (m.type.name === 'entity' && it.raw !== '</entity>') {
          // Unusual close-tag spelling: rewrite the mark so it is preserved.
          const m2 = schema.marks.entity.create({ ...m.attrs, rawClose: it.raw });
          inlines = inlines.map((n) => (n.marks.includes(m) ? n.mark(m.removeFromSet(m2.addToSet(n.marks))) : n));
        }
        active.delete(it.id);
        recompute();
        break;
      }
      case 'nl': {
        for (let b = 0; b < Math.floor(it.n / 2); b++) {
          blocks.push(makeBlock(inlines));
          inlines = [];
        }
        if (it.n % 2) inlines.push(schema.nodes.newline.create({ raw: '\n' }, null, marks));
        break;
      }
    }
  }
  blocks.push(makeBlock(inlines));
  return schema.nodes.doc.create({ trailing }, blocks);
}
