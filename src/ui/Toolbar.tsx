import { useEffect, useState } from 'preact/hooks';
import { NodeSelection, type Command } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { breakMode, editorTick, findBar, getView, pages, sideTab, showSeq } from '../app/state';
import { pageIndexAt } from '../core/pageIndex';
import { Menu } from './Menu';
import { selectionSeed } from './FindBar';
import { EntryForm, entryForEntity, selectedText } from './AnnotationPanel';
import { termsOf, withTerms, type DictEntry } from '../core/annotate';
import {
  applyEntity,
  blockLevel,
  clearFormat,
  mergeWithPrevious,
  setBlockLevel,
  entityAt,
  insertScanBreak,
  insertScanSkip,
  removeEntity,
  setNodeAttrs,
  toggleSpanMark,
  updateEntity,
  type SpanMark,
} from '../editor/commands';
import { splitPage } from '../editor/pageCommands';

function run(cmd: Command) {
  const v = getView();
  if (!v) return;
  cmd(v.state, v.dispatch);
  v.focus();
}

const OTHER_SPANS: [SpanMark, string, string][] = [
  ['big', '大字', '{ } 註釋本中的正文'],
  ['margin', '邊注', '{{{ }}} 正文以外的註釋'],
  ['inverted', '反白', '【 】'],
  ['circled', '畫圈', '〖 〗'],
];

const LEVELS = [
  ['0', '內文'],
  ['1', '標題 *'],
  ['2', '標題 **'],
] as const;

export function Toolbar() {
  void editorTick.value; // re-render on editor changes
  const v = getView();
  const hasSel = !!v && !v.state.selection.empty;
  const level = v ? blockLevel(v.state) : 0;
  return (
    <div class="toolbar-wrap">
      <div class="toolbar" role="toolbar" aria-label="編輯工具">
        <button onClick={() => run(undo)} title="復原 (Ctrl+Z)">↶</button>
        <button onClick={() => run(redo)} title="重做 (Ctrl+Y)">↷</button>
        <span class="sep" />
        <select
          id="blockLevel"
          aria-label="段落樣式"
          title="設定標題：行首 * / **（Ctrl+Alt+1、2；內文 Ctrl+Alt+0）。選取段落中的一段文字時，會把它獨立成一段。"
          value={String(level)}
          onChange={(e) => run(setBlockLevel(Number((e.target as HTMLSelectElement).value)))}
        >
          {LEVELS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={!hasSel} onClick={() => run(toggleSpanMark('note'))} title="{{ }} 夾注：底本中的註釋，小字（選取文字後套用／取消）">
          夾注
        </button>
        <button disabled={!hasSel} onClick={() => run(clearFormat)} title="清除選取範圍的夾注、大字、邊注、反白、畫圈，變回一般文字（Ctrl+\）。entity 標註保留。">
          清除格式
        </button>
        <Menu label="其他標記" title="大字、邊注、反白、畫圈">
          {OTHER_SPANS.map(([m, label, title]) => (
            <button key={m} disabled={!hasSel} onClick={() => run(toggleSpanMark(m))} title={`${title}（選取文字後套用／取消）`}>
              {label} <span class="muted small">{title.split(' ')[0]}</span>
            </button>
          ))}
        </Menu>
        <span class="sep" />
        <button onClick={() => run(insertScanBreak)} title="插入換行 scanbreak (Shift+Enter)">⏎ 換行</button>
        <button
          onClick={() => {
            const n = Number(prompt('空幾個字格？', '1'));
            if (n > 0) run(insertScanSkip(n));
          }}
          title="插入列內空白 scanskip"
        >
          ␣ 空格
        </button>
        <button
          aria-pressed={breakMode.value}
          onClick={() => {
            breakMode.value = !breakMode.value;
            getView()?.focus();
          }}
          title="點擊斷行模式：在字間點一下插入換行（Shift+點擊＝分頁）。對照圖片逐列斷行用。"
        >
          ✎ 點擊斷行
        </button>
        <Menu label="頁面" title="分頁、合併頁面（頁碼調整在「原典對照」的「頁碼」選單）">
          <button onClick={() => run(splitPage)} title="插入 scanend + scanbegin，新頁頁碼＝本頁＋1">
            ✂ 在游標處分頁 <span class="muted small">Ctrl+Enter</span>
          </button>
          <button onClick={() => run(mergeCurrentPage)} title="刪除本頁開頭的頁界">
            本頁併入上一頁
          </button>
        </Menu>
        <span class="sep" />
        <button onClick={() => (findBar.value = { replace: false, seed: selectionSeed() })} title="搜尋與取代 (Ctrl+F / Ctrl+H)">
          搜尋
        </button>
        <label class="check" title="顯示 seq 句子錨點（翻譯對齊用，可拖曳、不可刪除）">
          <input type="checkbox" checked={showSeq.value} onChange={(e) => (showSeq.value = (e.target as HTMLInputElement).checked)} /> seq
        </label>
      </div>
      <Inspector />
    </div>
  );
}

/** Merge the page under the cursor into the previous one. */
const mergeCurrentPage: Command = (state, dispatch) => {
  const ps = pages.value;
  return mergeWithPrevious(ps, pageIndexAt(ps, state.selection.from))(state, dispatch);
};

// ------------------------------------------------------------------ inspector

type Field = { key: string; label: string; type?: 'number' | 'select'; options?: string[]; readOnly?: boolean };

const FIELDS: Record<string, { title: string; fields: Field[] }> = {
  pageStart: { title: '頁開始 scanbegin', fields: [{ key: 'file', label: 'file' }, { key: 'page', label: '頁碼' }, { key: 'y', label: 'y（首列空格）', type: 'number' }] },
  pageBoundary: {
    title: '頁界 scanend + scanbegin',
    fields: [{ key: 'beginFile', label: '下一頁 file' }, { key: 'beginPage', label: '下一頁頁碼' }, { key: 'y', label: 'y（首列空格）', type: 'number' }],
  },
  pageEnd: { title: '頁結束 scanend', fields: [{ key: 'page', label: '頁碼', readOnly: true }] },
  scanBreak: { title: '換行 scanbreak', fields: [{ key: 'y', label: 'y（下一列空格）', type: 'number' }, { key: 'file', label: 'file' }] },
  scanSkip: { title: '列內空白 scanskip', fields: [{ key: 'y', label: '空格數', type: 'number' }] },
  seq: { title: '句子錨點 seq（不可修改，可拖曳）', fields: [{ key: 'sid', label: 'sid', readOnly: true }] },
  collation: {
    title: '校勘',
    fields: [
      { key: 'kind', label: '類型', type: 'select', options: ['fix', 'del', 'add'] },
      { key: 'orig', label: '底本（ ）' },
      { key: 'corr', label: '改為［ ］' },
      { key: 'note', label: '說明＝ ＝' },
    ],
  },
  missing: { title: '缺字 ●', fields: [{ key: 'desc', label: '結構說明' }] },
  tag: { title: '其他標籤（原樣保留）', fields: [{ key: 'raw', label: '原文', readOnly: true }] },
};

function AtomInspector({ node, pos }: { node: PMNode; pos: number }) {
  const spec = FIELDS[node.type.name];
  if (!spec) return null;
  const set = (key: string, value: string) => {
    const v = getView()!;
    const val = key === 'y' && value.trim() === '' ? null : value;
    const tr = setNodeAttrs(v.state.tr, pos, { [key]: val });
    // setNodeMarkup replaces the atom; keep it selected so the inspector stays open
    if (tr.docChanged) tr.setSelection(NodeSelection.create(tr.doc, pos));
    v.dispatch(tr);
  };
  return (
    <div class="inspector" aria-label="屬性">
      <strong>{spec.title}</strong>
      {spec.fields.map((f) => (
        <label key={f.key} class="ifield">
          <span>{f.label}</span>
          {f.type === 'select' ? (
            <select value={node.attrs[f.key]} onChange={(e) => set(f.key, (e.target as HTMLSelectElement).value)}>
              {f.options!.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              data-field={f.key}
              {...(f.type === 'number' ? { type: 'number' as const, min: 0 } : { type: 'text' as const })}
              readOnly={f.readOnly}
              value={node.attrs[f.key] ?? ''}
              onChange={(e) => set(f.key, (e.target as HTMLInputElement).value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

const ENTITY_TYPES = ['place', 'person', 'date', 'era', 'work', 'office'];

function parseExtra(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)\s*=\s*"?([^\s"]*)"?/g)) out[m[1]] = m[2];
  return out;
}
const formatExtra = (e: Record<string, string>) =>
  Object.entries(e)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

/** Form values for adding `term` to the dictionary: the entity's existing entry gets the term added. */
function dictInitial(term: string, e: Pick<DictEntry, 'entityid' | 'type' | 'extra'>): Partial<DictEntry> {
  const existing = entryForEntity(e);
  return existing ? withTerms(existing, [...termsOf(existing), term]) : { ...e, surface: term, variants: [] };
}

function EntityInspector() {
  void editorTick.value; // signals skip re-render on equal props; subscribe directly
  const v = getView()!;
  const current = entityAt(v.state);
  const hasSel = !v.state.selection.empty;
  const [id, setId] = useState('');
  const [type, setType] = useState('place');
  const [extra, setExtra] = useState('');
  const [adding, setAdding] = useState(false);
  const key = current ? String(current.mark.attrs.iid) : 'new';
  useEffect(() => {
    setId(current?.mark.attrs.entityid ?? '');
    setType(current?.mark.attrs.type ?? 'place');
    setExtra(current ? formatExtra(current.mark.attrs.extra) : '');
  }, [key]);

  if (!current && !hasSel) return <div class="inspector muted">選取文字可套用夾注、entity 等；點選標記（⏎、頁界、seq…）可編輯其屬性或拖曳移動。</div>;
  const apply = () => run(current ? updateEntity({ entityid: id, type, extra: parseExtra(extra) }) : applyEntity({ entityid: id, type, extra: parseExtra(extra) }));
  return (
    <div class="inspector">
      <strong>{current ? `entity（${current.mark.attrs.type}）` : '標註 entity'}</strong>
      <label class="ifield">
        <span>entityid</span>
        <input data-field="entityid" value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} size={8} />
      </label>
      <label class="ifield">
        <span>type</span>
        <input list="entity-types" value={type} onInput={(e) => setType((e.target as HTMLInputElement).value)} size={7} />
        <datalist id="entity-types">
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label class="ifield">
        <span>其他屬性</span>
        <input value={extra} onInput={(e) => setExtra((e.target as HTMLInputElement).value)} placeholder="year=28" size={10} />
      </label>
      <button onClick={apply} disabled={!id.trim() || !type.trim()}>
        {current ? '更新' : '套用'}
      </button>
      {current && <button onClick={() => run(removeEntity)}>移除</button>}
      <button onClick={() => setAdding(true)} disabled={!id.trim()} title="把這個詞與 entity 加入全域字典，供其他地方搜尋候選">
        加入字典
      </button>
      {adding && (
        <div class="popover">
          <EntryForm initial={dictInitial(current ? v.state.doc.textBetween(current.from, current.to, '', '') : selectedText(), { entityid: id.trim(), type: type.trim(), extra: parseExtra(extra) })} onDone={() => {
              setAdding(false);
              sideTab.value = 'annotate';
            }}
          />
        </div>
      )}
    </div>
  );
}

function Inspector() {
  void editorTick.value;
  const v = getView();
  if (!v) return null;
  const sel = v.state.selection;
  if (sel instanceof NodeSelection && sel.node.isInline) return <AtomInspector node={sel.node} pos={sel.from} />;
  return <EntityInspector />;
}
