/**
 * Application state (signals) and the single ProseMirror editor instance.
 *
 * Data flow: the ProseMirror document is the source of truth while editing.
 * Every doc change recomputes the page index (cheap, synchronous) and, after a
 * short debounce, lint results and an autosave of the serialized text.
 */
import { batch, signal } from '@preact/signals';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import type { Node as PMNode } from 'prosemirror-model';
import { toDoc } from '../core/toDoc';
import { serialize } from '../core/serialize';
import { buildPageIndex, pageIndexAt, type Page } from '../core/pageIndex';
import { validate, type Diagnostic } from '../core/validate';
import { seqGuard, stepOverSeq } from '../editor/seqGuard';
import { pasteGuard } from '../editor/paste';
import { pageGuard } from '../editor/pageGuard';
import { deleteAdjacentAtom } from '../editor/atomCommands';
import { splitPage } from '../editor/pageCommands';
import { insertScanBreak } from '../editor/commands';
import { listMappings, saveProject } from '../store/projects';
import type { FileMapping, Project } from '../store/db';

// ---------------------------------------------------------------- signals

export const project = signal<Project | null>(null);
export const pages = signal<Page[]>([]);
export const diagnostics = signal<Diagnostic[]>([]);
export const currentPage = signal(0);
/** Editor selection position, for highlighting the current column in the page view. */
export const cursorPos = signal(0);
/** Bumped on every editor state change so components can re-read the state. */
export const editorTick = signal(0);
export const mode = signal<'wysiwyg' | 'source'>('wysiwyg');
export const saveStatus = signal<'saved' | 'dirty' | 'saving' | 'error'>('saved');
export const showSeq = signal(true);
export const sideTab = signal<'compare' | 'issues' | 'files'>('compare');
export const mappings = signal<Map<string, FileMapping>>(new Map());
/** Local scan images chosen from a folder: file id → (image number → object URL). Not persisted. */
export const localImages = signal<Map<string, Map<number, string>>>(new Map());
export const exportOpen = signal(false);

// ---------------------------------------------------------------- editor

let view: EditorView | null = null;
export const getView = () => view;

function plugins() {
  return [
    seqGuard(),
    pageGuard(),
    pasteGuard(),
    history(),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
      'Mod-Enter': splitPage,
      'Shift-Enter': insertScanBreak,
      Backspace: chainCommands(stepOverSeq(-1), deleteAdjacentAtom(-1)),
      Delete: chainCommands(stepOverSeq(1), deleteAdjacentAtom(1)),
    }),
    keymap(baseKeymap),
    dropCursor({ color: '#d9822b', width: 3 }),
  ];
}

export function createState(text: string): EditorState {
  return EditorState.create({ doc: toDoc(text), plugins: plugins() });
}

let lintTimer: ReturnType<typeof setTimeout> | undefined;
function refreshDerived(doc: PMNode) {
  const ps = buildPageIndex(doc);
  pages.value = ps;
  clearTimeout(lintTimer);
  lintTimer = setTimeout(() => (diagnostics.value = validate(doc, ps)), 250);
}

function syncSelection(state: EditorState) {
  batch(() => {
    cursorPos.value = state.selection.from;
    currentPage.value = pageIndexAt(pages.value, state.selection.from);
    editorTick.value++;
  });
}

export function mountEditor(el: HTMLElement, state: EditorState) {
  view?.destroy();
  view = new EditorView(el, {
    state,
    dispatchTransaction(tr: Transaction) {
      const v = view!;
      const prevDoc = v.state.doc;
      const next = v.state.apply(tr); // includes transactions appended by plugins
      v.updateState(next);
      if (next.doc !== prevDoc) {
        refreshDerived(next.doc);
        scheduleSave();
      }
      syncSelection(next);
    },
  });
  refreshDerived(state.doc);
  syncSelection(state);
  if (import.meta.env.DEV) (window as unknown as { __ctView: EditorView }).__ctView = view;
}

export function unmountEditor() {
  view?.destroy();
  view = null;
}

/** Move the editor cursor to `pos` and scroll it into view. */
export function jumpTo(pos: number, select: 'cursor' | 'node' = 'cursor') {
  if (!view) return;
  const doc = view.state.doc;
  const p = Math.max(0, Math.min(pos, doc.content.size));
  let sel;
  try {
    sel = select === 'node' && doc.nodeAt(p)?.isInline ? NodeSelection.create(doc, p) : TextSelection.near(doc.resolve(p));
  } catch {
    sel = TextSelection.near(doc.resolve(p));
  }
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  view.focus();
}

export function currentText(): string {
  if (mode.value === 'source') return sourceTextGetter?.() ?? project.value?.text ?? '';
  return view ? serialize(view.state.doc) : (project.value?.text ?? '');
}

/** Set by the source view while it is active. */
let sourceTextGetter: (() => string) | null = null;
export function setSourceTextGetter(fn: (() => string) | null) {
  sourceTextGetter = fn;
}

// ---------------------------------------------------------------- saving

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSave() {
  saveStatus.value = 'dirty';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  const p = project.value;
  if (!p) return;
  saveStatus.value = 'saving';
  try {
    project.value = await saveProject({ ...p, text: currentText() });
    saveStatus.value = 'saved';
  } catch {
    saveStatus.value = 'error';
  }
}

/** Update project metadata (title, proofreading, …) and save. */
export function updateProject(patch: Partial<Project>) {
  const p = project.value;
  if (!p) return;
  project.value = { ...p, ...patch };
  scheduleSave();
}

export async function loadMappings() {
  mappings.value = new Map((await listMappings()).map((m) => [m.fileId, m]));
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveStatus.value === 'dirty') void saveNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (saveStatus.value === 'dirty' || saveStatus.value === 'saving') {
      void saveNow();
      e.preventDefault();
    }
  });
}
