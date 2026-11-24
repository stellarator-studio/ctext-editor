import { useEffect, useState } from 'preact/hooks';
import type { Chapter, Project } from '../store/db';
import { persistent } from '../store/db';
import { createProject, deleteProject, downloadProject, importProjectFile, listChapters, listProjects } from '../store/projects';
import { openProject } from './App';
import { loadDictionary, loadMappings } from '../app/state';
import { TextImport, textSummary } from './TextImport';

type Row = { p: Project; chapters: Chapter[] };

function rowSummary({ chapters }: Row) {
  const done = chapters.reduce((n, c) => n + Object.values(c.proofread).filter((s) => s.done).length, 0);
  const text = chapters.length === 1 ? textSummary(chapters[0].text) : `${chapters.length} 章・${textSummary(chapters.map((c) => c.text).join('\n'))}`;
  return `${text}・已校對 ${done} 頁`;
}

export function Home() {
  const [list, setList] = useState<Row[]>([]);
  const [error, setError] = useState('');

  const refresh = async () => setList(await Promise.all((await listProjects()).map(async (p) => ({ p, chapters: await listChapters(p) }))));
  useEffect(() => void refresh(), []);

  const create = async (text: string, title: string) => {
    const p = await createProject(text, title);
    openProject(p.id);
  };

  const importFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const r = await importProjectFile(await f.text());
      await Promise.all([loadMappings(), loadDictionary()]);
      const parts = [
        r.mappingsAdded ? `${r.mappingsAdded} 個圖片對照` : '',
        r.entriesAdded ? `${r.entriesAdded} 個字典詞條` : '',
        r.termsAdded ? `${r.termsAdded} 個詞彙併入既有詞條` : '',
      ].filter(Boolean);
      const kept = r.mappingsKept.length ? `\nfile ${r.mappingsKept.join('、')} 的圖片對照與這個瀏覽器中的不同，保留了原本的設定。` : '';
      if (parts.length || kept) alert(`已匯入專案${parts.length ? `，並加入${parts.join('、')}` : ''}。${kept}`);
      await refresh();
      openProject(r.project.id);
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  return (
    <main class="home">
      <header class="home-head">
        <h1>cText Editor</h1>
        <p class="muted">輔助 cText 電子化整理：貼上 cText 編輯框中的文字 → 對照原典逐頁校對 → 匯出貼回 cText。資料只存在這個瀏覽器中。</p>
        {!persistent && <p class="warn">此瀏覽器無法使用 IndexedDB（可能是私密視窗），關閉分頁後資料會遺失。請記得匯出專案檔。</p>}
      </header>

      <section class="card">
        <h2>新專案</h2>
        <p class="muted small">一部作品可以分成多個章節（各自對應 cText 的一個編輯框）。先貼上第一章，其他章節之後在專案中「＋ 加入章節」。</p>
        <TextImport titleLabel="標題（可留空，自動取第一個標題）" submitLabel="建立並開啟" onSubmit={create} />
      </section>

      <section class="card">
        <div class="row spread">
          <h2>我的專案</h2>
          <label class="button">
            匯入專案檔…
            <input type="file" accept=".json,application/json" hidden onChange={importFile} />
          </label>
        </div>
        {error && <p class="warn">{error}</p>}
        {list.length === 0 ? (
          <p class="muted">尚無專案。</p>
        ) : (
          <ul class="project-list">
            {list.map(({ p, chapters }) => (
              <li key={p.id}>
                <a href={`#p=${encodeURIComponent(p.id)}`} class="project-title">
                  {p.title}
                </a>
                <span class="muted">
                  {rowSummary({ p, chapters })}・{new Date(p.updatedAt).toLocaleString()}
                </span>
                <span class="row tight">
                  <button onClick={() => downloadProject(p)} title="專案檔包含所有章節的文字與校對狀態、用到的圖片對照與字典">匯出</button>
                  <button
                    class="danger"
                    onClick={async () => {
                      if (!confirm(`刪除「${p.title}」？此動作無法復原（建議先匯出專案檔）。`)) return;
                      await deleteProject(p.id);
                      await refresh();
                    }}
                  >
                    刪除
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
