import { expect, test, type Page } from '@playwright/test';

const SRC =
  '<scanbegin file="1" page="2" /><entity entityid="190387" type="place">緬甸</entity>與暹羅，緬甸<scanbreak file="1" />國、緬<scanbreak file="1" />甸。' +
  '<scanend file="1" page="2" /><scanbegin file="1" page="3" />曰:"安南"<scanend file="1" page="3" />\n';

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
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
async function charPoint(page: Page, ch: string, nth = 0) {
  return page.evaluate(
    ([ch, nth]) => {
      const root = document.querySelector('.ProseMirror')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let k = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        let i = n.textContent!.indexOf(ch as string);
        while (i >= 0) {
          if (k++ === nth) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const b = r.getBoundingClientRect();
            return { x: b.left + 1, y: b.top + b.height / 2 };
          }
          i = n.textContent!.indexOf(ch as string, i + 1);
        }
      }
      throw new Error('char not found');
    },
    [ch, nth] as const,
  );
}

// ------------------------------------------------------------ annotation

test('harvest dictionary from text, accept and reject candidates', async ({ page }) => {
  await create(page);
  await page.click('.tabs button:has-text("標註")');
  await expect(page.locator('.annotate')).toContainText('字典是空的');
  await page.click('.annotate .seg button:has-text("字典")');
  await page.click('.annotate button:has-text("從文本收集")');
  await expect(page.locator('.dict-table')).toContainText('緬甸');
  await page.click('.annotate .seg button:has-text("候選")');
  // untagged: 緬甸 (before ⏎國) and 緬⏎甸 across a column break
  await expect(page.locator('#candCount')).toContainText('2 個候選');
  await page.locator('.cand-list li').nth(1).locator('[aria-label="拒絕"]').click();
  await expect(page.locator('#candCount')).toContainText('1 個候選');
  await expect(page.locator('#candCount')).toContainText('已拒絕 1');
  await page.click('.cand-group button:has-text("全部接受")');
  await expect(page.locator('.annotate')).toContainText('沒有未標註的候選');
  const out = await exportText(page);
  expect(out).toContain('與暹羅，<entity entityid="190387" type="place">緬甸</entity><scanbreak file="1" />國、緬<scanbreak file="1" />甸');
  // rejection survives a reload
  await page.reload();
  await page.click('.tabs button:has-text("標註")');
  await page.locator('.annotate label:has-text("顯示已拒絕") input').check();
  await expect(page.locator('.cand-list li.rejected')).toHaveCount(1);
});

test('add a dictionary entry manually from the editor selection', async ({ page }) => {
  await create(page);
  // select 暹羅
  await page.evaluate(() => {
    const root = document.querySelector('.ProseMirror') as HTMLElement;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent!.indexOf('暹羅');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 2);
        root.focus();
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
    }
  });
  await page.locator('.inspector input[data-field="entityid"]').fill('491558');
  await page.click('.inspector button:has-text("加入字典")');
  await expect(page.locator('.popover input[data-field="surface"]')).toHaveValue('暹羅');
  await page.click('.popover button:has-text("加入字典")');
  await expect(page.locator('.tabs button[aria-selected="true"]')).toHaveText('標註');
  await expect(page.locator('#candCount')).toContainText('1 個候選');
  await page.locator('.cand-list li').first().locator('[aria-label="接受"]').click();
  expect(await exportText(page)).toContain('與<entity entityid="491558" type="place">暹羅</entity>，');
});

// ------------------------------------------------------------ page view

test('page view hides punctuation by default; click still maps to the right place', async ({ page }) => {
  await create(page);
  await page.locator('.pagelist .pagelink').first().click();
  const vtext = () => page.locator('.vpage').evaluate((el) => el.textContent);
  expect(await vtext()).toBe('緬甸與暹羅緬甸國緬甸');
  await page.locator('#showPunct').check();
  expect(await vtext()).toBe('緬甸與暹羅，緬甸國、緬甸。');
  await page.locator('#showPunct').uncheck();
  // click on 暹 (after the hidden comma in the source) → editor cursor right there
  await page.locator('.vpage span', { hasText: '與暹羅' }).click({ position: { x: 5, y: 5 } });
  const sel = await page.evaluate(() => {
    const v = (window as any).__ctView;
    const { from } = v.state.selection;
    return v.state.doc.textBetween(from, from + 1);
  });
  expect(sel).toBe('與');
});

test('set the page number from here', async ({ page }) => {
  await create(page);
  await page.locator('.pagelist .pagelink').first().click();
  page.once('dialog', (d) => d.accept('10'));
  await page.click('.page-actions .menu summary:has-text("頁碼")');
  await page.click('.menu-list button:has-text("設定本頁頁碼…")');
  const out = await exportText(page);
  expect(out).toContain('<scanbegin file="1" page="10" />');
  expect(out).toContain('<scanend file="1" page="10" /><scanbegin file="1" page="11" />');
  expect(out).toContain('<scanend file="1" page="11" />');
});

// ------------------------------------------------------------ layout

test('the divider between text and the side panel can be dragged and is remembered', async ({ page }) => {
  await create(page);
  const side = page.locator('.pane-side');
  const before = (await side.boundingBox())!.width;
  const s = (await page.locator('.splitter[aria-label="主文與對照分隔線"]').boundingBox())!;
  await page.mouse.move(s.x + 3, s.y + 200);
  await page.mouse.down();
  await page.mouse.move(s.x - 150, s.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = (await side.boundingBox())!.width;
  expect(after - before).toBeGreaterThan(120);
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(Math.abs((await side.boundingBox())!.width - after)).toBeLessThan(4);
  // double-click resets
  await page.locator('.splitter[aria-label="主文與對照分隔線"]').dblclick();
  expect(Math.abs((await side.boundingBox())!.width - before)).toBeLessThan(4);
});

// ------------------------------------------------------------ editing tools

test('click-to-break mode inserts a scanbreak; Shift+click splits the page', async ({ page }) => {
  await create(page);
  await page.click('.toolbar button:has-text("點擊斷行")');
  const p = await charPoint(page, '暹');
  await page.mouse.click(p.x, p.y);
  let out = await exportText(page);
  expect(out).toContain('與<scanbreak file="1" />暹羅');
  const q = await charPoint(page, '安');
  await page.keyboard.down('Shift');
  await page.mouse.click(q.x, q.y);
  await page.keyboard.up('Shift');
  out = await exportText(page);
  expect(out).toContain('曰:"<scanend file="1" page="3" /><scanbegin file="1" page="4" />安南"');
});

test('fix half-width punctuation from the issues panel', async ({ page }) => {
  await create(page);
  await page.click('.tabs button:has-text("問題")');
  await page.click('.issues button:has-text("全部半形標點轉為全形")');
  expect(await exportText(page)).toContain('曰：「安南」');
});

test('plain text import adds page and column markers', async ({ page }) => {
  await page.goto('/');
  await page.locator('#newText').fill('甲乙丙\n丁戊\n\n己庚');
  await expect(page.locator('#create')).toBeDisabled(); // file id required
  await page.locator('#plainFile').fill('555');
  await page.click('#create');
  await expect(page.locator('.pagelist')).toContainText('p.2');
  expect(await exportText(page)).toBe(
    '<scanbegin file="555" page="1" />甲乙丙<scanbreak file="555" />丁戊<scanend file="555" page="1" /><scanbegin file="555" page="2" />己庚<scanend file="555" page="2" />\n',
  );
});
