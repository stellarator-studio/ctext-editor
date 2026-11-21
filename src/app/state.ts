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
import { listDictionary, listMappings, saveProject } from '../store/projects';
import type { DictEntry } from '../core/annotate';
import { clickBreak } from '../editor/clickBreak';
import { searchHighlight } from '../editor/search';
import { clearFormat, insertScanBreak, setBlockLevel } from '../editor/commands';
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
export const sideTab = signal<'compare' | 'annotate' | 'issues' | 'files'>('compare');
/** global annotation dictionary, by entry id */
export const dictionary = signal<Map<string, DictEntry>>(new Map());
/** click-to-break mode: clicking in the text inserts a scanbreak (Shift: page split) */
export const breakMode = signal(false);
export const mappings = signal<Map<string, FileMapping>>(new Map());
/** Local scan images chosen from a folder: file id → (image number → object URL). Not persisted. */
export const localImages = signal<Map<string, Map<number, string>>>(new Map());
export const exportOpen = signal(false);
/** find / replace bar: null = closed */
export const findBar = signal<null | { replace: boolean; seed?: string }>(null);

/** Raw-text mode hooks for the find bar, registered by the source view while it is active. */
export interface SourceSearch {
  text(): string;
  select(from: number, to: number): void;
  highlight(ranges: { from: number; to: number }[], current: number): void;
  replace(changes: { from: number; to: number; insert: string }[]): void;
}
export const sourceSearch = signal<SourceSearch | null>(null);
/** Bumped on every raw-text change. */
export const sourceTick = signal(0);

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
    keymap({
      'Mod-Alt-0': setBlockLevel(0),
      'Mod-Alt-1': setBlockLevel(1),
      'Mod-Alt-2': setBlockLevel(2),
      'Mod-\\': clearFormat,
    }),
    keymap(baseKeymap),
    searchHighlight(),
    dropCursor({ color: '#d9822b', width: 3 }),
    clickBreak(() => breakMode.value),
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
export function jumpTo(pos: number, select: 'cursor' | 'node' = 'cursor', focus = true) {
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
  if (focus) view.focus();
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

export async function loadDictionary() {
  dictionary.value = new Map((await listDictionary()).map((e) => [e.id, e]));
}

/** Select a document range in the editor (e.g. an annotation candidate) and scroll to it. */
export function selectRange(from: number, to: number) {
  if (!view) return;
  const doc = view.state.doc;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, Math.max(0, from), Math.min(to, doc.content.size))).scrollIntoView());
  view.focus();
}

// ---------------------------------------------------------------- layout (per-viewer, localStorage)

function stored(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
export const pagesWidth = signal(stored('ct.pagesWidth', 150));
export const sideWidth = signal(stored('ct.sideWidth', 0)); // 0 = default (fraction)
/** width of the vertical text next to the scan in 原典對照; 0 = fit the page */
export const compareTextWidth = signal(stored('ct.compareTextWidth', 0));
export function persistLayout() {
  try {
    localStorage.setItem('ct.pagesWidth', String(pagesWidth.value));
    localStorage.setItem('ct.sideWidth', String(sideWidth.value));
    localStorage.setItem('ct.compareTextWidth', String(compareTextWidth.value));
  } catch {
    /* storage unavailable: layout just isn't remembered */
  }
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
