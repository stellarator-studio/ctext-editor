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
  diagnostics,
} from '../app/state';
import { download, projectToFile } from '../store/projects';
import { openProject } from './App';
import { Toolbar } from './Toolbar';
import { PageList } from './PageList';
import { ComparePanel } from './ComparePanel';
import { IssuesPanel } from './IssuesPanel';
import { FilesPanel } from './FilesPanel';
import { ExportDialog } from './ExportDialog';

const SAVE_LABEL = { saved: '已儲存', dirty: '未儲存…', saving: '儲存中…', error: '⚠ 儲存失敗' } as const;

/** Editor state kept while in source mode, reused if the text is not changed there (keeps undo history). */
let resumeState: EditorState | null = null;

function EditorPane() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mountEditor(ref.current!, resumeState ?? createState(project.value!.text));
    resumeState = null;
    return () => unmountEditor();
  }, []);
  return <div ref={ref} class={`pm-host ${showSeq.value ? '' : 'hide-seq'}`} />;
}

type SourceViewT = typeof import('./SourceView').SourceView;

export function Workspace() {
  const p = project.value!;
  const sourceText = useRef('');
  // CodeMirror is only needed for the raw-text mode: load it on first use.
  const [SourceView, setSourceView] = useState<SourceViewT | null>(null);
  useEffect(() => {
    if (mode.value === 'source' && !SourceView) void import('./SourceView').then((m) => setSourceView(() => m.SourceView));
  }, [mode.value]);

  const toSource = () => {
    const state = getView()!.state;
    sourceText.current = serialize(state.doc);
    resumeState = state;
    mode.value = 'source';
  };
  const toWysiwyg = (text: string) => {
    setSourceTextGetter(null);
    if (text !== sourceText.current) {
      resumeState = null; // re-parse; undo history starts over
      updateProject({ text });
    }
    mode.value = 'wysiwyg';
  };

  const errors = diagnostics.value.filter((d) => d.severity === 'error').length;

  return (
    <div class="workspace">
      <header class="topbar">
        <button class="link" onClick={() => saveNow().then(() => openProject(null))} title="回到專案列表">
          ← 專案
        </button>
        <input class="title-input" value={p.title} onChange={(e) => updateProject({ title: (e.target as HTMLInputElement).value })} aria-label="專案標題" />
        <span class={`save-status ${saveStatus.value}`}>{SAVE_LABEL[saveStatus.value]}</span>
        <span class="grow" />
        <div class="seg" role="group" aria-label="編輯模式">
          <button aria-pressed={mode.value === 'wysiwyg'} onClick={() => mode.value === 'source' && document.dispatchEvent(new CustomEvent('ct-leave-source'))}>
            所見即所得
          </button>
          <button aria-pressed={mode.value === 'source'} onClick={() => mode.value === 'wysiwyg' && toSource()}>
            原始文字
          </button>
        </div>
        <button onClick={() => download(projectToFile({ ...p }), `${p.title}.ctext-project.json`)}>匯出專案檔</button>
        <button class="primary" id="exportBtn" onClick={() => saveNow().then(() => (exportOpen.value = true))}>
          匯出 cText…
        </button>
      </header>

      <div class="main-grid">
        <aside class="pane pane-pages">
          <PageList />
        </aside>
        <section class="pane pane-editor">
          {mode.value === 'wysiwyg' ? (
            <>
              <Toolbar />
              <EditorPane />
            </>
          ) : (
            SourceView ? <SourceView initial={sourceText.current} onLeave={toWysiwyg} /> : <p class="muted pad">載入中…</p>
          )}
        </section>
        <aside class="pane pane-side">
          <nav class="tabs" role="tablist">
            <button role="tab" aria-selected={sideTab.value === 'compare'} onClick={() => (sideTab.value = 'compare')}>
              原典對照
            </button>
            <button role="tab" aria-selected={sideTab.value === 'issues'} onClick={() => (sideTab.value = 'issues')}>
              問題 {diagnostics.value.length > 0 && <span class={`badge ${errors ? 'error' : ''}`}>{diagnostics.value.length}</span>}
            </button>
            <button role="tab" aria-selected={sideTab.value === 'files'} onClick={() => (sideTab.value = 'files')}>
              圖片對照表
            </button>
          </nav>
          {mode.value === 'source' ? (
            <p class="muted pad">原始文字模式下暫停預覽；切回「所見即所得」後更新。</p>
          ) : sideTab.value === 'compare' ? (
            <ComparePanel />
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
