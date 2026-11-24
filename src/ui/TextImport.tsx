/**
 * Paste form for a cText text: used for a new project and for adding a
 * chapter to a project. Text without scan tags (e.g. OCR output) can be given
 * page and column markers.
 */
import { useState } from 'preact/hooks';
import { toDoc } from '../core/toDoc';
import { buildPageIndex } from '../core/pageIndex';
import { guessTitle } from '../store/projects';
import { hasScanTags, plainToCtext, type PlainOptions } from '../core/plainText';

export function textSummary(text: string) {
  const pages = buildPageIndex(toDoc(text)).filter((p) => p.markerPos !== null).length;
  return `${text.length.toLocaleString()} 字元・${pages} 頁`;
}

export interface TextImportProps {
  titleLabel: string;
  submitLabel: string;
  /** defaults for plain text (e.g. continue the file id and page numbers of the previous chapter) */
  plainDefaults?: { file: string; startPage: number };
  onSubmit: (text: string, title: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function TextImport({ titleLabel, submitLabel, plainDefaults, onSubmit, onCancel }: TextImportProps) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [plain, setPlain] = useState<PlainOptions & { convert: boolean }>({
    convert: true,
    file: plainDefaults?.file ?? '',
    startPage: plainDefaults?.startPage ?? 1,
    linesAreColumns: true,
    blankLineIsPage: true,
  });
  const isPlain = text.trim() !== '' && !hasScanTags(text);
  const finalText = () => (isPlain && plain.convert ? plainToCtext(text, plain) : text);
  const setOpt = (patch: Partial<typeof plain>) => setPlain({ ...plain, ...patch });

  return (
    <div class="text-import">
      <label class="field">
        <span>{titleLabel}</span>
        <input id="newTitle" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
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
        <button class="primary" id="create" disabled={!text.trim() || (isPlain && plain.convert && !plain.file)} onClick={() => onSubmit(finalText(), title.trim() || guessTitle(text))}>
          {submitLabel}
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
        {text.trim() && <span class="muted">{textSummary(finalText())}</span>}
      </div>
    </div>
  );
}
