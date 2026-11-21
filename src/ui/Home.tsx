import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../store/db';
import { persistent } from '../store/db';
import { deleteProject, downloadProject, guessTitle, importProjectFile, listProjects, newProject, saveProject } from '../store/projects';
import { toDoc } from '../core/toDoc';
import { buildPageIndex } from '../core/pageIndex';
import { openProject } from './App';
import { loadDictionary, loadMappings } from '../app/state';
import { hasScanTags, plainToCtext, type PlainOptions } from '../core/plainText';

function summary(text: string) {
  const pages = buildPageIndex(toDoc(text)).filter((p) => p.markerPos !== null).length;
  return `${text.length.toLocaleString()} 字元・${pages} 頁`;
}

export function Home() {
  const [list, setList] = useState<Project[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [plain, setPlain] = useState<PlainOptions & { convert: boolean }>({ convert: true, file: '', startPage: 1, linesAreColumns: true, blankLineIsPage: true });
  const isPlain = text.trim() !== '' && !hasScanTags(text);
  const finalText = () => (isPlain && plain.convert ? plainToCtext(text, plain) : text);
  const setOpt = (patch: Partial<typeof plain>) => setPlain({ ...plain, ...patch });

  const refresh = async () => setList(await listProjects());
  useEffect(() => void refresh(), []);

  const create = async () => {
    if (!text.trim()) return;
    const t = finalText();
    const p = await saveProject(newProject(t, title.trim() || guessTitle(text)));
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
        <label class="field">
          <span>標題（可留空，自動取第一個標題）</span>
          <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>從 cText 編輯框複製的文字</span>
          <textarea id="newText" rows={8} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="<scanbegin file=… page=… />…" />
        </label>
        {isPlain && (
          <fieldset class="plain-opts">
            <legend>這段文字沒有 scan 標籤（例如 OCR 文字）</legend>
            <label class="check">
              <input type="checkbox" id="plainConvert" checked={plain.convert} onChange={(e) => setOpt({ convert: (e.target as HTMLInputElement).checked })} />
              加上頁與換行標記，之後可用「點擊斷行」對照圖片調整
            </label>
            {plain.convert && (
              <div class="row tight">
                <label class="ifield">
                  <span>file id</span>
                  <input id="plainFile" value={plain.file} onInput={(e) => setOpt({ file: (e.target as HTMLInputElement).value.trim() })} size={9} placeholder="cText 掃描檔號" />
                </label>
                <label class="ifield">
                  <span>起始頁</span>
                  <input type="number" min={0} value={plain.startPage} onInput={(e) => setOpt({ startPage: Number((e.target as HTMLInputElement).value) || 1 })} style={{ width: '5em' }} />
                </label>
                <label class="check small">
                  <input type="checkbox" checked={plain.linesAreColumns} onChange={(e) => setOpt({ linesAreColumns: (e.target as HTMLInputElement).checked })} /> 每行＝原書一列
                </label>
                <label class="check small">
                  <input type="checkbox" checked={plain.blankLineIsPage} onChange={(e) => setOpt({ blankLineIsPage: (e.target as HTMLInputElement).checked })} /> 空行＝換頁
                </label>
              </div>
            )}
          </fieldset>
        )}
        <div class="row">
          <button class="primary" id="create" disabled={!text.trim() || (isPlain && plain.convert && !plain.file)} onClick={create}>
            建立並開啟
          </button>
          {text.trim() && <span class="muted">{summary(finalText())}</span>}
        </div>
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
            {list.map((p) => (
              <li key={p.id}>
                <a href={`#p=${encodeURIComponent(p.id)}`} class="project-title">
                  {p.title}
                </a>
                <span class="muted">
                  {summary(p.text)}・已校對 {Object.values(p.proofread).filter((s) => s.done).length} 頁・{new Date(p.updatedAt).toLocaleString()}
                </span>
                <span class="row tight">
                  <button onClick={() => downloadProject(p)} title="專案檔包含文字、校對狀態、用到的圖片對照與字典">匯出</button>
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
