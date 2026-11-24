import { expect, test, type Page } from '@playwright/test';

const CH1 = '<scanbegin file="9" page="1" />*<seq sid="1" />卷一甲乙<scanbreak file="9" />丙丁<scanend file="9" page="1" />';
const CH2 = '<scanbegin file="9" page="2" />卷二子丑<scanend file="9" page="2" />';

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
});

async function create(page: Page, text = CH1) {
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
async function addChapter(page: Page, text: string, title = '') {
  await page.click('#addChapter');
  if (title) await page.locator('dialog.add-chapter #newTitle').fill(title);
  await page.locator('dialog.add-chapter #newText').fill(text);
  await page.click('dialog.add-chapter #create');
  await expect(page.locator('dialog.add-chapter')).toHaveCount(0);
}
/** Put the cursor before the n-th occurrence of `ch`. */
async function cursorAt(page: Page, ch: string) {
  await page.evaluate((ch) => {
    const v = (window as any).__ctView;
    let at = -1;
    v.state.doc.descendants((n: any, p: number) => {
      if (at >= 0 || !n.isText) return at < 0;
      const i = n.text.indexOf(ch);
      if (i >= 0) at = p + i;
      return false;
    });
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, at)));
    v.focus();
  }, ch);
}

// ------------------------------------------------------------------ chapters

test('chapters: add, switch, edit and export each one separately', async ({ page }) => {
  await create(page);
  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await addChapter(page, CH2, '卷二');
  await expect(page.locator('.chapter-list li')).toHaveCount(2);
  await expect(page.locator('.chapter-list li[aria-current="true"]')).toContainText('卷二');
  await expect(page.locator('.ProseMirror')).toContainText('卷二子丑');
  await expect(page.locator('.chapter-input')).toHaveValue('卷二');

  await cursorAt(page, '子');
  await page.keyboard.type('寅');
  expect(await exportText(page)).toBe(CH2.replace('子', '寅子'));

  await page.click('.chapter-list button:has-text("卷一")');
  await expect(page.locator('.ProseMirror')).toContainText('卷一甲乙');
  expect(await exportText(page)).toBe(CH1);

  // the chapter is kept in the URL; edits survive a reload
  await page.click('.chapter-list button:has-text("卷二")');
  await expect(page.locator('.ProseMirror')).toContainText('寅子');
  await page.waitForTimeout(1000); // autosave
  await page.reload();
  await expect(page.locator('.chapter-list li[aria-current="true"]')).toContainText('卷二');
  await expect(page.locator('.ProseMirror')).toContainText('寅子丑');

  // undo history is kept per chapter while the project is open
  await page.click('.chapter-list button:has-text("卷一")');
  await cursorAt(page, '甲');
  await page.keyboard.type('戊');
  await page.click('.chapter-list button:has-text("卷二")');
  await page.click('.chapter-list button:has-text("卷一")');
  await page.locator('.ProseMirror').focus();
  await page.keyboard.press('Control+z');
  expect(await exportText(page)).toBe(CH1);
});

test('chapters: plain text continues the file id and page of the last chapter', async ({ page }) => {
  await create(page);
  await page.click('#addChapter');
  await page.locator('dialog.add-chapter #newText').fill('甲乙\n丙');
  await expect(page.locator('dialog.add-chapter #plainFile')).toHaveValue('9');
  await expect(page.locator('dialog.add-chapter input[type="number"]')).toHaveValue('2');
  await page.click('dialog.add-chapter #create');
  expect(await exportText(page)).toContain('<scanbegin file="9" page="2" />甲乙');
});

test('chapters: reorder, delete, and the project file carries all of them', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await create(page);
  await addChapter(page, CH2, '卷二');
  await page.click('.topbar summary:has-text("章節")');
  await page.click('.topbar button:has-text("本章上移")');
  await expect(page.locator('.chapter-list li').first()).toContainText('卷二');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.topbar button:has-text("匯出專案檔")')]);
  const file = await dl.path();

  await page.click('.topbar summary:has-text("章節")');
  await page.click('.topbar button:has-text("刪除本章")');
  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.ProseMirror')).toContainText('卷一甲乙');

  // import into a fresh profile: both chapters, in order
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5179' });
  const p2 = await ctx.newPage();
  await p2.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await p2.goto('/');
  await p2.locator('.card input[type="file"]').setInputFiles(file);
  await expect(p2.locator('.chapter-list li')).toHaveCount(2);
  await expect(p2.locator('.chapter-list li').first()).toContainText('卷二');
  await ctx.close();
});

test('a project saved before chapters existed opens as one chapter', async ({ page }) => {
  // create the old (v2) database before the app runs
  await page.route('**/src/main.tsx', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.goto('/');
  await page.evaluate(
    (text) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('ctext-editor', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('projects', { keyPath: 'id' });
          d.createObjectStore('fileMappings', { keyPath: 'fileId' });
          d.createObjectStore('dictionary', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('projects', 'readwrite');
          const t = '2026-01-01T00:00:00.000Z';
          tx.objectStore('projects').put({ id: 'old', title: '舊專案', text, originalText: text, proofread: { '9:1': { done: true, hash: 'x', at: t } }, createdAt: t, updatedAt: t, rejected: ['r'] });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
        req.onerror = () => reject(req.error);
      }),
    CH1,
  );
  await page.unroute('**/src/main.tsx');
  await page.goto('/#p=old');
  await page.reload(); // only the hash changed: load the app now
  await expect(page.locator('.ProseMirror')).toContainText('卷一甲乙');
  await expect(page.locator('.chapter-list li')).toHaveCount(1);
  await expect(page.locator('.chapter-list li')).toContainText('舊專案');
  expect(await exportText(page)).toBe(CH1);
});

// ------------------------------------------------------------------ notes and headings

const NOTES = '<scanbegin file="9" page="1" />甲{{AB}}{{　}}乙{{ABCD}}丙<scanend file="9" page="1" />';

test('page view keeps adjacent notes apart and shows spaces; the issue fix joins them', async ({ page }) => {
  await create(page, NOTES);
  await expect(page.locator('.vpage .v-note')).toHaveCount(3);
  await expect(page.locator('.vpage .v-sp')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .ct-space')).toHaveCount(1);

  await page.click('.tabs button:has-text("問題")');
  await page.click('.issues button:has-text("合併所有緊鄰的夾注")');
  expect(await exportText(page)).toBe(NOTES.replace('{{AB}}{{　}}', '{{AB　}}'));
  await page.click('.tabs button:has-text("原典對照")');
  await expect(page.locator('.vpage .v-note')).toHaveCount(2);
});

test('pad a note to one line from the toolbar', async ({ page }) => {
  await create(page, NOTES);
  await cursorAt(page, 'C');
  await page.click('.toolbar summary:has-text("夾注排版")');
  await page.click('.toolbar button:has-text("排成單行")');
  expect(await exportText(page)).toBe(NOTES.replace('{{ABCD}}', '{{ABCD　　　}}'));
  // the page view now shows the four characters in the first line, spaces in the second
  const lines = await page.locator('.vpage .v-note').last().locator('.v-nl').allTextContents();
  expect(lines).toEqual(['ABCD', '　　　']);
});

test('heading marker position is shown and a misplaced one is fixed', async ({ page }) => {
  const src = '<scanbegin file="9" page="1" /><seq sid="1" />*標題\n\n正文<scanend file="9" page="1" />';
  await create(page, src);
  // the * badge is drawn after the seq anchor, where the source has it
  const order = await page.locator('.ProseMirror h2').evaluate((h) => [...h.querySelectorAll('.ct-seq, .ct-stars')].map((e) => e.className.includes('ct-stars') ? '*' : 'seq'));
  expect(order).toEqual(['seq', '*']);
  await page.click('.tabs button:has-text("問題")');
  await page.click('.issues button:has-text("修正所有標題記號位置")');
  expect(await exportText(page)).toBe('<scanbegin file="9" page="1" />*<seq sid="1" />標題\n\n正文<scanend file="9" page="1" />');
  const after = await page.locator('.ProseMirror h2').evaluate((h) => [...h.querySelectorAll('.ct-seq, .ct-stars')].map((e) => e.className.includes('ct-stars') ? '*' : 'seq'));
  expect(after).toEqual(['*', 'seq']);
});

test('page view: scanbreak in a note at a column start splits its lines; scanskip in a note is a blank cell', async ({ page }) => {
  await create(page, '<scanbegin file="9" page="1" />{{天地<scanbreak file="9" />日月}}<scanbreak file="9" />{{山<scanskip file="9" y="1" />川草木}}<scanend file="9" page="1" />');
  const notes = page.locator('.vpage .v-note');
  await expect(page.locator('.vpage .vcol')).toHaveCount(2);
  for (const punct of [false, true]) {
    if (punct) await page.check('#showPunct');
    expect(await notes.nth(0).locator('.v-nl').allTextContents()).toEqual(['天地', '日月']);
    expect(await notes.nth(1).locator('.v-nl').allTextContents()).toEqual(['山　川', '草木']);
    await expect(notes.nth(1).locator('.v-blank')).toHaveCount(1);
  }
  // re-rendering (cursor moves) must not change the layout
  await page.locator('.vpage .vcol').nth(1).click();
  expect(await notes.nth(0).locator('.v-nl').allTextContents()).toEqual(['天地', '日月']);
});
