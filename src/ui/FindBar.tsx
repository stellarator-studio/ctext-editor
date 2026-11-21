/**
 * Find / replace bar for both editing modes.
 *
 * - 所見即所得: searches the text (tags hidden). With 跨標記, column / page
 *   breaks and seq anchors inside a term are ignored (英吉⏎利 matches 英吉利);
 *   replacing keeps those markers.
 * - 原始文字: searches the whole cText source, tags included. (The browser's
 *   own Ctrl+F only sees the part of a long text that is on screen.)
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TextSelection } from 'prosemirror-state';
import { editorTick, findBar, getView, mode, sourceSearch, sourceTick } from '../app/state';
import { compile, expandReplacement, findAll, MAX_MATCHES, type SearchQuery } from '../core/search';
import { findInDoc, replaceMatches, searchKey, type DocMatch } from '../editor/search';

type Match = { from: number; to: number; groups: string[] };

/** Index of the first match at or after `pos` (wrapping to 0). */
const nearest = (ms: Match[], pos: number) => Math.max(0, ms.findIndex((m) => m.from >= pos));

export function FindBar() {
  const opts = findBar.value!;
  const [q, setQ] = useState(opts.seed ?? '');
  const [rep, setRep] = useState('');
  const [regex, setRegex] = useState(false);
  const [across, setAcross] = useState(true);
  const [cur, setCur] = useState(0);
  const [showReplace, setShowReplace] = useState(opts.replace);
  const input = useRef<HTMLInputElement>(null);
  const wysiwyg = mode.value === 'wysiwyg';
  const query: SearchQuery = { text: q, regex };

  useEffect(() => {
    if (opts.seed !== undefined) setQ(opts.seed);
    if (opts.replace) setShowReplace(true);
    input.current?.focus();
    input.current?.select();
  }, [opts]);

  // matches in the current mode
  const tick = wysiwyg ? editorTick.value : sourceTick.value;
  const doc = getView()?.state.doc;
  const src = sourceSearch.value;
  const result = useMemo((): Match[] | string => {
    if (!q) return [];
    if (wysiwyg) return doc ? findInDoc(doc, query, across) : [];
    const re = compile(query);
    if (typeof re === 'string') return re;
    return src ? findAll(src.text(), re).map((m) => ({ from: m.start, to: m.end, groups: m.groups })) : [];
  }, [q, regex, across, wysiwyg, wysiwyg ? doc : tick, src]);
  const matches = typeof result === 'string' ? [] : result;
  const error = typeof result === 'string' ? result : '';
  const idx = matches.length ? Math.min(cur, matches.length - 1) : -1;

  // start from the cursor when the query changes
  useEffect(() => {
    const v = getView();
    setCur(wysiwyg && v ? nearest(matches, v.state.selection.from) : 0);
  }, [q, regex, across, wysiwyg]);

  // highlight all matches, the current one stronger
  useEffect(() => {
    if (wysiwyg) {
      const v = getView();
      v?.dispatch(v.state.tr.setMeta(searchKey, { matches, current: idx }).setMeta('addToHistory', false));
    } else src?.highlight(matches, idx);
  }, [matches, idx]);
  // clear highlights when closed
  useEffect(
    () => () => {
      const v = getView();
      v?.dispatch(v.state.tr.setMeta(searchKey, { matches: [], current: -1 }));
      sourceSearch.peek()?.highlight([], -1);
    },
    [],
  );

  const show = (i: number) => {
    const m = matches[i];
    if (!m) return;
    setCur(i);
    if (wysiwyg) {
      const v = getView();
      v?.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).scrollIntoView());
    } else src?.select(m.from, m.to);
  };
  const step = (d: 1 | -1) => matches.length && show((idx + d + matches.length) % matches.length);

  const replaceOne = () => {
    const m = matches[idx];
    if (!m) return;
    if (wysiwyg) {
      const v = getView()!;
      v.dispatch(replaceMatches(v.state.tr, [m as DocMatch], rep, regex).scrollIntoView());
    } else src?.replace([{ from: m.from, to: m.to, insert: expandReplacement(rep, m.groups, regex) }]);
    // the next match now has the same index
  };
  const replaceAll = () => {
    if (!matches.length) return;
    if (wysiwyg) {
      const v = getView()!;
      v.dispatch(replaceMatches(v.state.tr, matches as DocMatch[], rep, regex));
    } else src?.replace(matches.map((m) => ({ from: m.from, to: m.to, insert: expandReplacement(rep, m.groups, regex) })));
  };

  const close = () => {
    findBar.value = null;
    if (wysiwyg) getView()?.focus();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else return;
    e.preventDefault();
  };
  void tick;

  return (
    <div class="findbar" role="search" onKeyDown={keys}>
      <div class="row tight">
        <button class="link" onClick={() => setShowReplace(!showReplace)} aria-expanded={showReplace} title="取代">
          {showReplace ? '▾' : '▸'}
        </button>
        <input ref={input} id="findInput" class="grow" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="搜尋" aria-label="搜尋" />
        <span class="muted small nowrap" id="findCount">
          {error ? '' : q ? `${matches.length ? idx + 1 : 0} / ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}` : ''}
        </span>
        <button onClick={() => step(-1)} disabled={!matches.length} title="上一個 (Shift+Enter)" aria-label="上一個">
          ↑
        </button>
        <button onClick={() => step(1)} disabled={!matches.length} title="下一個 (Enter)" aria-label="下一個">
          ↓
        </button>
        <label class="check small" title="正規表示式；取代時可用 $1、$& 等">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex((e.target as HTMLInputElement).checked)} /> .*
        </label>
        {wysiwyg && (
          <label class="check small" title="忽略字詞中間的換行、頁界、seq 等標記（例如「英吉⏎利」也算「英吉利」）">
            <input type="checkbox" checked={across} onChange={(e) => setAcross((e.target as HTMLInputElement).checked)} /> 跨標記
          </label>
        )}
        <button class="link" onClick={close} aria-label="關閉搜尋" title="關閉 (Esc)">
          ✕
        </button>
      </div>
      {showReplace && (
        <div class="row tight">
          <span class="findbar-indent" />
          <input id="replaceInput" class="grow" value={rep} onInput={(e) => setRep((e.target as HTMLInputElement).value)} placeholder="取代為" aria-label="取代為" />
          <button onClick={replaceOne} disabled={!matches.length}>
            取代
          </button>
          <button onClick={replaceAll} disabled={!matches.length}>
            全部取代
          </button>
        </div>
      )}
      {error && <p class="warn small pad-x">{error}</p>}
    </div>
  );
}

/** Ctrl+F / Ctrl+H open the bar (instead of the browser's find, which misses off-screen text). */
export function useFindShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'f' && k !== 'h') return;
      e.preventDefault();
      e.stopPropagation();
      findBar.value = { replace: k === 'h', seed: selectionSeed() };
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/** Selected text to start searching for (short, single-line selections only). */
export function selectionSeed(): string | undefined {
  let t = '';
  if (mode.value === 'wysiwyg') {
    const v = getView();
    if (v && !v.state.selection.empty) t = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, '', '');
  } else t = getSelection()?.toString() ?? '';
  return t && t.length <= 60 && !t.includes('\n') ? t : undefined;
}
