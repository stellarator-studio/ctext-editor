import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const SRC =
  '<scanbegin file="1" page="2" />卷一英吉<scanbreak file="1" />利與英吉利{{小注}}<scanbreak file="1" y="2" />' +
  '<entity entityid="7" type="place">英國</entity>甲乙<scanend file="1" page="2" />' +
  '<scanbegin file="1" page="3" />子<scanbreak file="1" />丑<scanbreak file="1" />寅<scanbreak file="1" />卯<scanbreak file="1" />辰<scanend file="1" page="3" />\n';

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
  await page.click('dialog.export [aria-label="關閉"]');
  await expect(page.locator('dialog.export')).toHaveCount(0);
  return t;
}
async function select(page: Page, a: string, b: string) {
  await page.evaluate(
    ([a, b]) => {
      const v = (window as any).__ctView;
      let from = -1;
      let to = -1;
      v.state.doc.descendants((n: any, p: number) => {
        if (!n.isText) return true;
        if (from < 0 && n.text.includes(a)) from = p + n.text.indexOf(a);
        if (from >= 0 && to < 0 && n.text.includes(b)) to = p + n.text.indexOf(b) + b.length;
        return false;
      });
      const sel = v.state.selection.constructor.create(v.state.doc, from, to); // TextSelection
      v.dispatch(v.state.tr.setSelection(sel));
      v.focus();
    },
    [a, b] as const,
  );
}

test('find across column breaks and replace all, keeping markers', async ({ page }) => {
  await create(page);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#findInput')).toBeFocused();
  await page.locator('#findInput').fill('英吉利');
  await expect(page.locator('#findCount')).toHaveText('1 / 2');
  await expect(page.locator('.ProseMirror .ct-find')).not.toHaveCount(0);
  await page.locator('.findbar input[type="checkbox"]').nth(1).uncheck(); // 跨標記 off
  await expect(page.locator('#findCount')).toHaveText(/\/ 1$/);
  await page.locator('.findbar input[type="checkbox"]').nth(1).check();
  await page.click('.findbar button[aria-expanded]');
  await page.locator('#replaceInput').fill('英國');
  await page.click('.findbar button:has-text("全部取代")');
  await expect(page.locator('#findCount')).toHaveText('0 / 0');
  expect(await exportText(page)).toContain('卷一英國<scanbreak file="1" />與英國{{小注}}');
});

test('find in raw text mode searches the whole source', async ({ page }) => {
  await create(page, SRC + '甲'.repeat(20000) + '尾端');
  await page.click('.seg button:has-text("原始文字")');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await page.locator('#findInput').fill('scanbreak');
  await expect(page.locator('#findCount')).toHaveText(/\/ 6$/);
  await page.locator('#findInput').fill('尾端');
  await expect(page.locator('#findCount')).toHaveText('1 / 1');
  await page.click('.findbar button[aria-expanded]');
  await page.locator('#replaceInput').fill('結尾');
  await page.click('.findbar button:has-text("全部取代")');
  await page.click('.seg button:has-text("所見即所得")');
  await expect(page.locator('.ProseMirror')).toContainText('結尾');
});

test('set a heading and clear formatting from the toolbar', async ({ page }) => {
  await create(page);
  await select(page, '卷', '一');
  await page.selectOption('#blockLevel', '1');
  let out = await exportText(page);
  expect(out).toContain('<scanbegin file="1" page="2" />*卷一\n\n英吉<scanbreak');
  await select(page, '利與', '小注');
  await page.click('.toolbar button:has-text("清除格式")');
  out = await exportText(page);
  expect(out).toContain('與英吉利小注<scanbreak');
  // rarely used actions are in menus
  await expect(page.locator('.toolbar button:has-text("大字")')).toBeHidden();
  await page.click('.toolbar .menu summary:has-text("其他標記")');
  await expect(page.locator('.toolbar button:has-text("大字")')).toBeVisible();
});

test('select a column in the page view and adjust its y with the arrow keys', async ({ page }) => {
  await create(page);
  await page.locator('.vpage .vcol').nth(1).locator('span').first().click();
  await expect(page.locator('.vpage .vcol.cur')).toHaveCount(1);
  await expect(page.locator('#lineY')).toHaveValue('0');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lineY')).toHaveValue('2');
  expect(await page.locator('.vpage .vcol').nth(1).evaluate((el) => getComputedStyle(el).paddingInlineStart)).toBe('40px');
  await page.keyboard.press('ArrowLeft'); // next column (y=2)
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#lineY')).toHaveValue('1');
  const out = await exportText(page);
  expect(out).toContain('英吉<scanbreak file="1" y="2" />利');
  expect(out).toContain('{{小注}}<scanbreak file="1" y="1" />');
});

test('page view width follows the number of columns', async ({ page }) => {
  await create(page);
  const width = () => page.locator('.vpage').evaluate((el) => el.getBoundingClientRect().width);
  const w3 = await width(); // p.2: 3 columns
  await page.click('[aria-label="下一頁"]');
  await expect(page.locator('.vpage .vcol')).toHaveCount(5);
  const w5 = await width();
  await page.click('[aria-label="上一頁"]');
  await expect(page.locator('.vpage .vcol')).toHaveCount(3);
  expect(w5).toBeGreaterThan(w3);
  expect(Math.abs((await width()) - w3)).toBeLessThan(1);
  // the columns fit inside the box
  const fits = await page.locator('.vpage').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
});

test('project file carries image mappings and the dictionary', async ({ page }) => {
  await create(page);
  await page.fill('[aria-label="範例圖片網址"]', 'https://library.ctext.org/x/x_0002.jpg');
  await page.fill('[aria-label="範例頁碼"]', '2');
  await page.click('.mapping-form button:has-text("推算")');
  await page.click('.mapping-form button:has-text("儲存對照")');
  await page.click('.tabs button:has-text("標註")');
  await page.click('.annotate .seg button:has-text("字典")');
  await page.click('.annotate button:has-text("從文本收集")');
  await expect(page.locator('.dict-table')).toContainText('英國');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.topbar button:has-text("匯出專案檔")')]);
  const file = await dl.path();

  // a fresh browser profile: nothing stored
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5179' });
  const p2 = await ctx.newPage();
  await p2.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await p2.goto('/');
  p2.on('dialog', (d) => d.accept());
  await p2.locator('.card input[type="file"]').setInputFiles(file);
  await expect(p2.locator('.ProseMirror')).toBeVisible();
  await expect(p2.locator('.imgpane img')).toHaveAttribute('src', 'https://library.ctext.org/x/x_0002.jpg');
  await p2.click('.tabs button:has-text("標註")');
  await p2.click('.annotate .seg button:has-text("字典")');
  await expect(p2.locator('.dict-table')).toContainText('英國');
  await ctx.close();
});

test('dictionary keeps several terms per entity', async ({ page }) => {
  await create(page);
  await page.click('.tabs button:has-text("標註")');
  await page.click('.annotate .seg button:has-text("字典")');
  await page.click('.annotate button:has-text("新增詞條")');
  await page.locator('.entry-form input[data-field="surface"]').fill('英吉利、英國');
  await page.locator('.entry-form input[data-field="dict-entityid"]').fill('7');
  await page.click('.entry-form button:has-text("加入字典")');
  await expect(page.locator('.dict-table tr')).toHaveCount(1);
  await expect(page.locator('.dict-table')).toContainText('英吉利、英國');
  // harvesting the tagged 英國 (same entity) adds nothing new
  await page.click('.annotate button:has-text("從文本收集")');
  await expect(page.locator('.dict-table tr')).toHaveCount(1);
  await page.click('.annotate .seg button:has-text("候選")');
  await expect(page.locator('#candCount')).toContainText('2 個候選'); // 英吉⏎利, 英吉利
});
