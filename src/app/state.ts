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
import { deleteChapter, listChapters, listDictionary, listMappings, newChapter, saveChapter, saveProject } from '../store/projects';
import type { DictEntry } from '../core/annotate';
import { clickBreak } from '../editor/clickBreak';
import { searchHighlight } from '../editor/search';
import { layoutHints } from '../editor/layoutHints';
import { clearFormat, insertScanBreak, setBlockLevel } from '../editor/commands';
import type { Chapter, FileMapping, Project } from '../store/db';

// ---------------------------------------------------------------- signals

export const project = signal<Project | null>(null);
/** chapters of the open project, in order */
export const chapters = signal<Chapter[]>([]);
/** the chapter being edited */
export const chapter = signal<Chapter | null>(null);
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
/** chapter the mounted editor shows (it lags behind `chapter` until the editor remounts) */
let viewChapter: string | null = null;
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
    layoutHints(),
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

export function mountEditor(el: HTMLElement, state: EditorState, chapterId: string) {
  view?.destroy();
  viewChapter = chapterId;
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
  viewChapter = null;
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
  if (mode.value === 'source') return sourceTextGetter?.() ?? chapter.value?.text ?? '';
  return view && viewChapter === chapter.value?.id ? serialize(view.state.doc) : (chapter.value?.text ?? '');
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
  const c = chapter.value;
  if (!p) return;
  saveStatus.value = 'saving';
  try {
    if (c) {
      const saved = await saveChapter({ ...c, text: currentText() });
      // the user may have switched chapters while saving
      if (chapter.value?.id === saved.id) chapter.value = saved;
      chapters.value = chapters.value.map((x) => (x.id === saved.id ? saved : x));
    }
    project.value = await saveProject({ ...project.value!, chapters: chapters.value.map((x) => x.id) });
    saveStatus.value = 'saved';
  } catch {
    saveStatus.value = 'error';
  }
}

/** Update project metadata shared by all chapters (title, rejected candidates, …) and save. */
export function updateProject(patch: Partial<Project>) {
  const p = project.value;
  if (!p) return;
  project.value = { ...p, ...patch };
  scheduleSave();
}

/** Update the current chapter (title, proofreading, baseline, …) and save. */
export function updateChapter(patch: Partial<Chapter>) {
  const c = chapter.value;
  if (!c) return;
  const next = { ...c, ...patch };
  chapter.value = next;
  chapters.value = chapters.value.map((x) => (x.id === next.id ? next : x));
  scheduleSave();
}

/** Load a project and its chapters; open `chapterId` or the first chapter. */
export async function loadProject(p: Project | null, chapterId?: string | null) {
  if (!p) {
    batch(() => {
      project.value = null;
      chapters.value = [];
      chapter.value = null;
    });
    return;
  }
  const list = await listChapters(p);
  batch(() => {
    project.value = p;
    chapters.value = list;
    chapter.value = list.find((c) => c.id === chapterId) ?? list[0] ?? null;
  });
}

/**
 * Switch to another chapter of the open project. Pending edits are saved
 * first; raw-text mode is left first so its edits are kept.
 */
export async function switchChapter(id: string) {
  if (chapter.value?.id === id) return;
  if (mode.value === 'source') document.dispatchEvent(new CustomEvent('ct-leave-source'));
  await saveNow();
  const next = chapters.value.find((c) => c.id === id);
  if (next) chapter.value = next;
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

// ---------------------------------------------------------------- chapters

/** Add a chapter at the end of the open project and switch to it. */
export async function addChapter(text: string, title: string) {
  const p = project.value;
  if (!p) return;
  await saveNow();
  const c = await saveChapter(newChapter(p.id, text, title));
  chapters.value = [...chapters.value, c];
  project.value = await saveProject({ ...project.value!, chapters: chapters.value.map((x) => x.id) });
  await switchChapter(c.id);
}

export function renameChapter(id: string, title: string) {
  if (chapter.value?.id === id) return updateChapter({ title });
  const c = chapters.value.find((x) => x.id === id);
  if (!c) return;
  chapters.value = chapters.value.map((x) => (x.id === id ? { ...x, title } : x));
  void saveChapter({ ...c, title });
}

/** Move a chapter up (−1) or down (+1) in the project's order. */
export function moveChapter(id: string, delta: number) {
  const list = [...chapters.value];
  const i = list.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  chapters.value = list;
  updateProject({ chapters: list.map((c) => c.id) });
}

/** Delete a chapter (not the last one). The current chapter moves to a neighbour first. */
export async function removeChapter(id: string) {
  const list = chapters.value;
  const i = list.findIndex((c) => c.id === id);
  if (i < 0 || list.length < 2) return;
  if (chapter.value?.id === id) await switchChapter(list[i + 1]?.id ?? list[i - 1].id);
  chapters.value = chapters.value.filter((c) => c.id !== id);
  await deleteChapter(id);
  project.value = await saveProject({ ...project.value!, chapters: chapters.value.map((c) => c.id) });
}
