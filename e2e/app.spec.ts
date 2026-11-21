import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SRC =
  '<scanbegin file="1" page="2" />*<seq sid="10" />標題{{小注}}<scanbreak file="1" />\n\n' +
  '<seq sid="20" />甲乙丙<seq sid="30" />丁戊己<scanbreak file="1" y="2" /><seq sid="40" />庚辛壬' +
  '<scanend file="1" page="2" /><scanbegin file="1" page="3" />子丑寅<scanbreak file="1" />卯辰巳<scanend file="1" page="3" />\n';

// 1×1 PNG, served for any request to the image host so tests never hit cText.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (route) =>
    route.request().url().includes('library.ctext.org') ? route.fulfill({ body: PNG, contentType: 'image/png' }) : route.abort(),
  );
});

async function create(page: Page, text = SRC) {
  await page.goto('/');
  await page.locator('#newText').fill(text);
  await page.click('#create');
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function exportText(page: Page): Promise<string> {
  await page.click('#exportBtn');
  const t = await page.locator('#exportText').inputValue();
  // Close with the button: Chromium may ignore Escape for a modal opened without user activation.
  await page.click('dialog.export [aria-label="關閉"]');
  await expect(page.locator('dialog.export')).toHaveCount(0);
  await page.locator('.ProseMirror').focus();
  return t;
}
/** Select from the first occurrence of `a` to the end of the first `b` after it. */
async function selectText(page: Page, a: string, b: string, collapse?: 'start' | 'end') {
  await page.evaluate(
    ([a, b, collapse]) => {
      const root = document.querySelector('.ProseMirror')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let start: [Node, number] | null = null;
      let end: [Node, number] | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent!;
        if (!start && t.includes(a)) start = [n, t.indexOf(a)];
        if (start && t.includes(b)) end = [n, t.indexOf(b) + b.length];
        if (end) break;
      }
      const r = document.createRange();
      r.setStart(...start!);
      r.setEnd(...end!);
      if (collapse) r.collapse(collapse === 'start');
      (root as HTMLElement).focus();
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    [a, b, collapse ?? ''] as const,
  );
}
async function charPoint(page: Page, ch: string) {
  return page.evaluate((ch) => {
    const root = document.querySelector('.ProseMirror')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(ch);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + 1, y: b.top + b.height / 2 };
      }
    }
    throw new Error('char not found ' + ch);
  }, ch);
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
async function atomCenter(page: Page, selector: string, nth = 0) {
  const b = (await page.locator(`.ProseMirror ${selector}`).nth(nth).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// ------------------------------------------------------------ round-trip & persistence

test('new project → export unchanged is byte-identical', async ({ page }) => {
  await create(page);
  await page.click('#exportBtn');
  await expect(page.locator('#exportStatus')).toContainText('逐字相同');
  expect(await page.locator('#exportText').inputValue()).toBe(SRC);
});

const SAMPLES = resolve(import.meta.dirname, '../.work/requirement');
for (const f of ['content.txt', 'sea.txt']) {
  test(`real sample ${f} round-trips`, async ({ page }) => {
    test.skip(!existsSync(resolve(SAMPLES, f)), 'local sample not present');
    const s = readFileSync(resolve(SAMPLES, f), 'utf8');
    await create(page, s);
    expect(await exportText(page)).toBe(s);
  });
}

test('edits are autosaved and survive a reload', async ({ page }) => {
  await create(page);
  await selectText(page, '甲', '甲', 'end');
  await page.keyboard.insertText('乂');
  await expect(page.locator('.save-status')).toHaveText('已儲存');
  await page.reload();
  await expect(page.locator('.ProseMirror')).toContainText('甲乂乙');
  await page.click('text=← 專案');
  await expect(page.locator('.project-list')).toContainText('標題');
});

// ------------------------------------------------------------ seq protection

test('deleting / cutting a range keeps seq; paste does not duplicate', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await create(page);
  await selectText(page, '乙', '戊');
  await page.keyboard.press('Control+x');
  expect(await exportText(page)).toContain('甲<seq sid="30" />己');
  await selectText(page, '甲', '甲', 'end');
  await page.keyboard.press('Control+v');
  const out = await exportText(page);
  expect(out.match(/<seq sid="30" \/>/g)).toHaveLength(1);
  expect(out).toContain('乙丙丁戊');
});

test('IME composition over a selection containing seq', async ({ page }) => {
  await create(page);
  await selectText(page, '乙', '戊');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ㄓ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'ㄓㄨ', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '注' });
  const out = await exportText(page);
  expect(out).toContain('甲<seq sid="30" />注己');
  expect(out).not.toContain('ㄓ');
});

test('drag seq within neighbours; past a neighbour is rejected', async ({ page }) => {
  await create(page);
  await drag(page, await atomCenter(page, '.ct-seq', 2), await charPoint(page, '丙')); // sid 30
  expect(await exportText(page)).toContain('甲乙<seq sid="30" />丙丁');
  await drag(page, await atomCenter(page, '.ct-seq', 1), await charPoint(page, '辛')); // sid 20 past 30, 40
  expect(await exportText(page)).toContain('<seq sid="20" />甲乙<seq sid="30" />');
});

// ------------------------------------------------------------ scan markers

test('drag a scanbreak within the page', async ({ page }) => {
  await create(page);
  await drag(page, await atomCenter(page, '.ct-break', 1), await charPoint(page, '己')); // y=2 break before 庚
  expect(await exportText(page)).toContain('丁戊<scanbreak file="1" y="2" />己<seq sid="40" />庚');
});

test('drag a page boundary; dragging past another boundary is rejected', async ({ page }) => {
  await create(page, SRC.replace('<scanend file="1" page="3" />', '<scanend file="1" page="3" /><scanbegin file="1" page="4" />午未<scanend file="1" page="4" />'));
  await drag(page, await atomCenter(page, '.ct-page', 1), await charPoint(page, '壬')); // 2|3 boundary
  let out = await exportText(page);
  expect(out).toContain('庚辛<scanend file="1" page="2" /><scanbegin file="1" page="3" />壬子');
  await drag(page, await atomCenter(page, '.ct-page', 1), await charPoint(page, '未'));
  out = await exportText(page);
  expect(out).toContain('庚辛<scanend file="1" page="2" /><scanbegin file="1" page="3" />壬子');
});

test('split (Ctrl+Enter) and merge (Backspace) keep scanend numbers consistent', async ({ page }) => {
  await create(page);
  await selectText(page, '戊', '戊', 'start');
  await page.keyboard.press('Control+Enter');
  let out = await exportText(page);
  expect(out).toContain('丁<scanend file="1" page="2" /><scanbegin file="1" page="3" />戊');
  expect(out).toContain('壬<scanend file="1" page="3" /><scanbegin file="1" page="3" />子'); // old scanend fixed
  await expect(page.locator('.pagelist')).toContainText('p.3');
  await page.click('[aria-label="問題"], .tabs button:has-text("問題")');
  await expect(page.locator('.issue-list')).toContainText('頁碼重複');
  // renumber following pages +1 from the 3rd page
  await page.locator('.pagelist .pagelink').nth(2).click();
  await page.click('.tabs button:has-text("原典對照")');
  await page.click('.page-actions .menu summary:has-text("頁碼")');
  await page.click('.menu-list button:has-text("本頁起頁碼 +1")');
  out = await exportText(page);
  expect(out).toContain('壬<scanend file="1" page="3" /><scanbegin file="1" page="4" />子');
  expect(out).toContain('巳<scanend file="1" page="4" />');
});

test('inspector edits y of a scanbreak', async ({ page }) => {
  await create(page);
  await page.locator('.ProseMirror .ct-break').nth(1).click();
  const y = page.locator('.inspector input[data-field="y"]');
  await expect(y).toHaveValue('2');
  await y.fill('5');
  await y.press('Enter');
  await y.blur();
  expect(await exportText(page)).toContain('己<scanbreak file="1" y="5" />');
});

// ------------------------------------------------------------ marks

test('toolbar note toggle and entity apply', async ({ page }) => {
  await create(page);
  await selectText(page, '子', '丑');
  await page.click('.toolbar button:has-text("夾注")');
  expect(await exportText(page)).toContain('{{子丑}}寅');
  await selectText(page, '卯', '辰');
  await page.locator('.inspector input[data-field="entityid"]').fill('123');
  await page.click('.inspector button:has-text("套用")');
  expect(await exportText(page)).toContain('<entity entityid="123" type="place">卯辰</entity>巳');
});

// ------------------------------------------------------------ source mode

test('source mode edits are applied when switching back', async ({ page }) => {
  await create(page);
  await page.click('.seg button:has-text("原始文字")');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('尾');
  await page.click('.seg button:has-text("所見即所得")');
  await expect(page.locator('.ProseMirror')).toContainText('尾');
});

// ------------------------------------------------------------ proofreading view

test('page view follows the cursor and jumps back on click', async ({ page }) => {
  await create(page);
  await selectText(page, '寅', '寅', 'start');
  await expect(page.locator('.compare-head .pnum-big')).toHaveText('p.3');
  await expect(page.locator('.vpage .vcol')).toHaveCount(2);
  await page.locator('.vpage span', { hasText: '卯辰巳' }).click();
  await expect(page.locator('.pagelist li[aria-current="true"]')).toContainText('p.3');
  // previous page via the header button
  await page.click('[aria-label="上一頁"]');
  await expect(page.locator('.compare-head .pnum-big')).toHaveText('p.2');
  // y=2 column is indented by 2em
  const pad = await page.locator('.vpage .vcol').nth(2).evaluate((el) => getComputedStyle(el).paddingInlineStart);
  expect(pad).toBe('40px');
});

test('proofread status goes stale after an edit', async ({ page }) => {
  await create(page);
  await selectText(page, '子', '子', 'start');
  await page.locator('#proofCheck').check();
  await expect(page.locator('.pagelist li[aria-current="true"]')).toHaveClass(/st-done/);
  await selectText(page, '子', '子', 'end');
  await page.keyboard.insertText('乙');
  await expect(page.locator('.pagelist li[aria-current="true"]')).toHaveClass(/st-stale/);
  await page.click('.compare-head button:has-text("重新確認")');
  await expect(page.locator('.pagelist li[aria-current="true"]')).toHaveClass(/st-done/);
});

test('image mapping: infer template from an example URL and show the scan', async ({ page }) => {
  await create(page);
  await expect(page.locator('.imgpane')).toContainText('尚未設定圖片來源');
  await page.fill('[aria-label="範例圖片網址"]', 'https://library.ctext.org/h0005527/h0005527_0092.jpg');
  await page.fill('[aria-label="範例頁碼"]', '92');
  await page.click('.mapping-form button:has-text("推算")');
  await expect(page.locator('.mapping-form input[data-field="template"]')).toHaveValue('https://library.ctext.org/h0005527/h0005527_{page:4}.jpg');
  await page.click('.mapping-form button:has-text("儲存對照")');
  const img = page.locator('.imgscroll img');
  await expect(img).toHaveAttribute('src', 'https://library.ctext.org/h0005527/h0005527_0002.jpg');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
  await page.click('.tabs button:has-text("圖片對照表")');
  await expect(page.locator('.ftable')).toContainText('{page:4}');
});

test('export dialog lists edits and structural changes', async ({ page }) => {
  await create(page);
  await drag(page, await atomCenter(page, '.ct-seq', 2), await charPoint(page, '丙'));
  await selectText(page, '子', '子');
  await page.keyboard.insertText('午');
  await page.click('#exportBtn');
  await expect(page.locator('#exportStatus')).toContainText('處修改');
  await expect(page.locator('dialog .struct')).toContainText('seq 位置變動：1 個（sid 30）');
  await expect(page.locator('dialog .hunks ins').first()).toBeVisible();
});
