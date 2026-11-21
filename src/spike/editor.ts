import 'prosemirror-view/style/prosemirror.css';
import './style.css';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { toDoc } from '../core/toDoc';
import { serialize } from '../core/serialize';
import { seqGuard, seqsOf, stepOverSeq } from '../editor/seqGuard';
import { splitPage } from '../editor/pageCommands';
import { pasteGuard } from '../editor/paste';
import { deleteAdjacentAtom } from '../editor/atomCommands';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let original = '';
let originalSids: string[] = [];

function makeState(src: string): EditorState {
  return EditorState.create({
    doc: toDoc(src),
    plugins: [
      seqGuard(),
      pasteGuard(),
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        'Mod-Enter': splitPage,
        Backspace: chainCommands(stepOverSeq(-1), deleteAdjacentAtom(-1)),
        Delete: chainCommands(stepOverSeq(1), deleteAdjacentAtom(1)),
      }),
      keymap(baseKeymap),
      dropCursor(),
    ],
  });
}

const view = new EditorView($('editor'), {
  state: makeState(''),
  dispatchTransaction(tr) {
    view.updateState(view.state.apply(tr));
    updateSeqStatus();
  },
});

function updateSeqStatus() {
  const now = seqsOf(view.state.doc).map((s) => s.sid);
  const ok = now.length === originalSids.length && now.every((s, i) => s === originalSids[i]);
  $('seqStatus').textContent = originalSids.length ? `seq：${now.length}/${originalSids.length} ${ok ? '✅ 完整且順序不變' : '❌ 不一致'}` : '';
}

function stats(src: string) {
  const t0 = performance.now();
  const doc = toDoc(src);
  const t1 = performance.now();
  serialize(doc);
  const t2 = performance.now();
  let pages = 0;
  let seqs = 0;
  const entities = new Set<number>();
  doc.descendants((n) => {
    if (n.type.name === 'pageStart' || n.type.name === 'pageBoundary') pages++;
    if (n.type.name === 'seq') seqs++;
    n.marks.forEach((m) => m.type.name === 'entity' && entities.add(m.attrs.iid));
  });
  return `${src.length} 字元・${doc.childCount} 段・${pages} 頁・${seqs} seq・${entities.size} entity｜parse ${(t1 - t0).toFixed(1)} ms，serialize ${(t2 - t1).toFixed(1)} ms`;
}

$('load').addEventListener('click', () => {
  original = $<HTMLTextAreaElement>('input').value;
  view.updateState(makeState(original));
  originalSids = seqsOf(view.state.doc).map((s) => s.sid);
  $('loadStatus').textContent = stats(original);
  updateSeqStatus();
  $('exportStatus').textContent = '';
  $('diff').hidden = true;
});

$<HTMLInputElement>('showSeq').addEventListener('change', (e) => {
  $('editor').classList.toggle('hide-seq', !(e.target as HTMLInputElement).checked);
});
$('split').addEventListener('click', () => {
  splitPage(view.state, view.dispatch);
  view.focus();
});
$('undo').addEventListener('click', () => undo(view.state, view.dispatch));
$('redo').addEventListener('click', () => redo(view.state, view.dispatch));

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

$('export').addEventListener('click', () => {
  const out = serialize(view.state.doc);
  $<HTMLTextAreaElement>('output').value = out;
  const d = firstDiff(original, out);
  const status = $('exportStatus');
  const diff = $('diff');
  if (d < 0) {
    status.textContent = `✅ 與原文逐字相同（${out.length} 字元）`;
    diff.hidden = true;
  } else {
    status.textContent = `與原文不同：第 ${d} 字元起（有編輯時屬正常）`;
    const ctx = (s: string) => s.slice(Math.max(0, d - 40), d) + '⟦' + s.slice(d, d + 60) + '⟧';
    diff.textContent = `原文：${ctx(original)}\n匯出：${ctx(out)}`;
    diff.hidden = false;
  }
});
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('output').value);
    $('exportStatus').textContent += '（已複製）';
  } catch {
    $<HTMLTextAreaElement>('output').select();
  }
});
