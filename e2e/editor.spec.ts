import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SRC =
  '<scanbegin file="1" page="2" />*<seq sid="10" />標題{{小注}}<scanbreak file="1" />\n\n' +
  '<seq sid="20" />甲乙丙<seq sid="30" />丁戊己<scanbreak file="1" y="2" /><seq sid="40" />庚辛壬<scanend file="1" page="2" />\n';

async function load(page: Page, text: string) {
  await page.goto('/');
  await page.locator('#input').fill(text);
  await page.click('#load');
}
async function exported(page: Page): Promise<string> {
  await page.click('#export');
  return page.locator('#output').inputValue();
}
/** Put a DOM selection over [from, to) characters of the first text node containing `anchor`. */
async function selectText(page: Page, anchor: string, endAnchor: string) {
  await page.evaluate(
    ([a, b]) => {
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
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    [anchor, endAnchor],
  );
}

test('load + export unchanged is byte-identical', async ({ page }) => {
  await load(page, SRC);
  expect(await exported(page)).toBe(SRC);
  await expect(page.locator('#exportStatus')).toContainText('逐字相同');
});

const SAMPLES = resolve(import.meta.dirname, '../.work/requirement');
for (const f of ['content.txt', 'sea.txt']) {
  test(`real sample ${f} round-trips in the browser`, async ({ page }) => {
    test.skip(!existsSync(resolve(SAMPLES, f)), 'local sample not present');
    const s = readFileSync(resolve(SAMPLES, f), 'utf8');
    await load(page, s);
    expect(await exported(page)).toBe(s);
  });
}

test('deleting a selection keeps seq anchors', async ({ page }) => {
  await load(page, SRC);
  await page.locator('.ProseMirror').focus();
  await selectText(page, '乙', '戊');
  await page.keyboard.press('Backspace');
  const out = await exported(page);
  expect(out).toContain('甲<seq sid="30" />己');
  await expect(page.locator('#seqStatus')).toContainText('✅');
});

test('cut + paste does not duplicate seq', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, SRC);
  await page.locator('.ProseMirror').focus();
  await selectText(page, '乙', '戊');
  await page.keyboard.press('Control+x');
  await page.keyboard.press('Control+v');
  const out = await exported(page);
  expect(out.match(/<seq sid="30" \/>/g)).toHaveLength(1);
  expect(out).toContain('乙丙丁戊');
  await expect(page.locator('#seqStatus')).toContainText('✅');
});

test('IME composition over a selection containing seq', async ({ page }) => {
  await load(page, SRC);
  await page.locator('.ProseMirror').focus();
  await selectText(page, '乙', '戊');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ㄓ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'ㄓㄨ', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '注' });
  const out = await exported(page);
  expect(out).toContain('注');
  expect(out).not.toContain('ㄓ');
  expect(out).not.toContain('乙丙');
  await expect(page.locator('#seqStatus')).toContainText('✅');
});

test('typing plain text', async ({ page }) => {
  await load(page, SRC);
  await selectText(page, '甲', '甲');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('乂');
  expect(await exported(page)).toContain('甲乂乙');
});

async function dragSeqTo(page: Page, sid: string, beforeChar: string) {
  const seq = page.locator('.ct-seq', { hasText: new RegExp(`^${sid}$`) });
  const from = (await seq.boundingBox())!;
  const to = await page.evaluate((ch) => {
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
    throw new Error('char not found');
  }, beforeChar);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('drag seq within neighbours moves it', async ({ page }) => {
  await load(page, SRC);
  await dragSeqTo(page, '30', '丙');
  const out = await exported(page);
  expect(out).toContain('甲乙<seq sid="30" />丙丁戊己');
  await expect(page.locator('#seqStatus')).toContainText('✅');
});

test('drag seq past a neighbour is rejected', async ({ page }) => {
  await load(page, SRC);
  await dragSeqTo(page, '20', '辛');
  const out = await exported(page);
  expect(out).toBe(SRC);
});

test('Ctrl+Enter splits the page; deleting the boundary merges back', async ({ page }) => {
  await load(page, SRC);
  await selectText(page, '丁', '丁');
  await page.keyboard.press('ArrowLeft'); // collapse to just before 丁
  await page.keyboard.press('Control+Enter');
  let out = await exported(page);
  expect(out).toContain('<scanend file="1" page="2" /><scanbegin file="1" page="3" />丁');
  expect(out).toContain('丙<seq sid="30" /><scanend'); // seq stays with the preceding text
  await page.locator('.ProseMirror').focus(); // export button took focus
  await page.keyboard.press('Backspace');
  out = await exported(page);
  expect(out).toBe(SRC);
});
