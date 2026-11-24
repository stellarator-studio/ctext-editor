import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorState } from 'prosemirror-state';
import { serialize } from '../core/serialize';
import {
  createState,
  exportOpen,
  getView,
  mode,
  mountEditor,
  project,
  saveNow,
  saveStatus,
  setSourceTextGetter,
  showSeq,
  sideTab,
  unmountEditor,
  updateProject,
  updateChapter,
  chapter,
  diagnostics,
  pagesWidth,
  sideWidth,
  breakMode,
  findBar,
} from '../app/state';
import { AnnotationPanel } from './AnnotationPanel';
import { downloadProject } from '../store/projects';
import { openProject } from './App';
import { Toolbar } from './Toolbar';
import { PageList } from './PageList';
import { ComparePanel } from './ComparePanel';
import { IssuesPanel } from './IssuesPanel';
import { FilesPanel } from './FilesPanel';
import { ExportDialog } from './ExportDialog';
import { FindBar, useFindShortcut } from './FindBar';
import { Splitter } from './Splitter';
import { ChapterControls, ChapterList } from './ChapterList';

const SAVE_LABEL = { saved: '已儲存', dirty: '未儲存…', saving: '儲存中…', error: '⚠ 儲存失敗' } as const;

/**
 * Editor state per chapter, kept while the project is open so switching
 * chapters or to raw-text mode and back keeps the undo history. Dropped when
 * the text is changed in raw-text mode (it is parsed again).
 */
const editorStates = new Map<string, EditorState>();

function EditorPane({ chapterId }: { chapterId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mountEditor(ref.current!, editorStates.get(chapterId) ?? createState(chapter.value!.text), chapterId);
    return () => {
      const v = getView();
      if (v) editorStates.set(chapterId, v.state);
      unmountEditor();
    };
  }, [chapterId]);
  return <div ref={ref} class={`pm-host ${showSeq.value ? '' : 'hide-seq'} ${breakMode.value ? 'break-mode' : ''}`} />;
}

type SourceViewT = typeof import('./SourceView').SourceView;

export function Workspace() {
  const p = project.value!;
  const ch = chapter.value;
  useFindShortcut();
  useEffect(() => () => editorStates.clear(), []);
  // keep the open chapter in the URL so a reload returns to it
  useEffect(() => {
    if (ch) history.replaceState(null, '', `#p=${encodeURIComponent(p.id)}&c=${encodeURIComponent(ch.id)}`);
  }, [ch?.id]);
  const sourceText = useRef('');
  // CodeMirror is only needed for the raw-text mode: load it on first use.
  const [SourceView, setSourceView] = useState<SourceViewT | null>(null);
  useEffect(() => {
    if (mode.value === 'source' && !SourceView) void import('./SourceView').then((m) => setSourceView(() => m.SourceView));
  }, [mode.value]);

  const toSource = () => {
    sourceText.current = serialize(getView()!.state.doc);
    mode.value = 'source';
  };
  const toWysiwyg = (text: string) => {
    setSourceTextGetter(null);
    if (text !== sourceText.current) {
      editorStates.delete(chapter.value!.id); // re-parse; undo history starts over
      updateChapter({ text });
    }
    mode.value = 'wysiwyg';
  };

  const errors = diagnostics.value.filter((d) => d.severity === 'error').length;

  const grid = useRef<HTMLDivElement>(null);
  const dragSide = (dx: number) => {
    const total = grid.current?.clientWidth ?? window.innerWidth;
    const current = sideWidth.value || grid.current?.querySelector<HTMLElement>('.pane-side')?.offsetWidth || total * 0.45;
    sideWidth.value = Math.round(Math.min(Math.max(current - dx, 260), total - pagesWidth.value - 320));
  };
  const dragPages = (dx: number) => (pagesWidth.value = Math.round(Math.min(Math.max(pagesWidth.value + dx, 90), 320)));
  const columns = `${pagesWidth.value}px 6px minmax(300px, 1.1fr) 6px ${sideWidth.value ? `${sideWidth.value}px` : 'minmax(0, 1fr)'}`;

  return (
    <div class="workspace">
      <header class="topbar">
        <button class="link" onClick={() => saveNow().then(() => openProject(null))} title="回到專案列表">
          ← 專案
        </button>
        <input class="title-input" value={p.title} onChange={(e) => updateProject({ title: (e.target as HTMLInputElement).value })} aria-label="專案標題" />
        <ChapterControls />
        <span class={`save-status ${saveStatus.value}`}>{SAVE_LABEL[saveStatus.value]}</span>
        <span class="grow" />
        <div class="seg" role="group" aria-label="顯示模式">
          <button aria-pressed={mode.value === 'wysiwyg'} onClick={() => mode.value === 'source' && document.dispatchEvent(new CustomEvent('ct-leave-source'))}>
            編輯模式
          </button>
          <button aria-pressed={mode.value === 'source'} onClick={() => mode.value === 'wysiwyg' && toSource()}>
            原始文字
          </button>
        </div>
        <button onClick={() => saveNow().then(() => downloadProject(project.value!))} title="所有章節的文字與校對狀態、用到的圖片對照與字典">
          匯出專案檔
        </button>
        <button class="primary" id="exportBtn" onClick={() => saveNow().then(() => (exportOpen.value = true))} title="匯出目前章節，貼回 cText 的編輯框">
          匯出 cText…
        </button>
      </header>

      <div class="main-grid" ref={grid} style={{ gridTemplateColumns: columns }}>
        <aside class="pane pane-pages">
          <ChapterList />
          <PageList />
        </aside>
        <Splitter label="頁面清單寬度" onDrag={dragPages} onReset={() => (pagesWidth.value = 150)} />
        <section class="pane pane-editor">
          {mode.value === 'wysiwyg' && <Toolbar />}
          {findBar.value && <FindBar key={mode.value} />}
          {mode.value === 'wysiwyg' ? (
            ch ? <EditorPane key={ch.id} chapterId={ch.id} /> : <p class="muted pad">這個專案沒有章節。</p>
          ) : SourceView ? (
            <SourceView key={ch?.id} initial={sourceText.current} onLeave={toWysiwyg} />
          ) : (
            <p class="muted pad">載入中…</p>
          )}
        </section>
        <Splitter label="主文與對照分隔線" onDrag={dragSide} onReset={() => (sideWidth.value = 0)} />
        <aside class="pane pane-side">
          <nav class="tabs" role="tablist">
            <button role="tab" aria-selected={sideTab.value === 'compare'} onClick={() => (sideTab.value = 'compare')}>
              原典對照
            </button>
            <button role="tab" aria-selected={sideTab.value === 'annotate'} onClick={() => (sideTab.value = 'annotate')}>
              標註
            </button>
            <button role="tab" aria-selected={sideTab.value === 'issues'} onClick={() => (sideTab.value = 'issues')}>
              問題 {diagnostics.value.length > 0 && <span class={`badge ${errors ? 'error' : ''}`}>{diagnostics.value.length}</span>}
            </button>
            <button role="tab" aria-selected={sideTab.value === 'files'} onClick={() => (sideTab.value = 'files')}>
              圖片對照表
            </button>
          </nav>
          {mode.value === 'source' ? (
            <p class="muted pad">原始文字模式下暫停預覽；切回編輯模式後更新。</p>
          ) : sideTab.value === 'compare' ? (
            <ComparePanel />
          ) : sideTab.value === 'annotate' ? (
            <AnnotationPanel />
          ) : sideTab.value === 'issues' ? (
            <IssuesPanel />
          ) : (
            <FilesPanel />
          )}
        </aside>
      </div>
      {exportOpen.value && <ExportDialog />}
    </div>
  );
}
