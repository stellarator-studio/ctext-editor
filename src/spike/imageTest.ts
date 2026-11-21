import './style.css';
import { expandTemplate, inferTemplates } from '../core/imageTemplate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const val = (id: string) => $<HTMLInputElement>(id).value.trim();

function log(msg: string) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('log').prepend(li);
}

function infer() {
  const cands = inferTemplates(val('exUrl'), Number(val('exPage')));
  if (!cands.length) {
    log('推算失敗：網址中找不到該頁碼，請手動填寫樣板');
    return;
  }
  $<HTMLInputElement>('template').value = cands[cands.length - 1];
  log(`推算樣板：${cands.join('  或  ')}`);
}

document.querySelectorAll<HTMLButtonElement>('button[data-url]').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLInputElement>('exUrl').value = b.dataset.url!;
    $<HTMLInputElement>('exPage').value = b.dataset.page!;
    $<HTMLInputElement>('page').value = b.dataset.page!;
    infer();
  }),
);
$('infer').addEventListener('click', infer);

$('loadImg').addEventListener('click', () => {
  const tpl = val('template');
  const page = Number(val('page'));
  if (!tpl || !Number.isFinite(page)) {
    log('請先填寫樣板與頁碼');
    return;
  }
  const url = expandTemplate(tpl, page, Number(val('offset')) || 0);
  const policy = $<HTMLSelectElement>('referrer').value;
  $('resolved').textContent = url;
  const img = new Image();
  if (policy) img.referrerPolicy = policy;
  img.alt = `p.${page}`;
  const t0 = performance.now();
  $('imgStatus').textContent = '載入中…';
  img.onload = () => {
    const msg = `✅ 成功 ${img.naturalWidth}×${img.naturalHeight}，${Math.round(performance.now() - t0)} ms（referrer: ${policy || '預設'}）`;
    $('imgStatus').textContent = msg;
    log(`${msg}  ${url}`);
  };
  img.onerror = () => {
    const msg = `❌ 失敗（referrer: ${policy || '預設'}）——可能被擋 hotlink、需登入或網址錯誤`;
    $('imgStatus').textContent = msg;
    log(`${msg}  ${url}`);
  };
  img.src = url;
  $('imgBox').replaceChildren(img);
});
