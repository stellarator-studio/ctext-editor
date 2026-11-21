# cText Editor

A browser-based editor that helps proofread and mark up texts for the [Chinese Text Project (cText)](https://ctext.org) wiki.

Copy a text from a cText edit box, proofread it page by page against the scanned original, and copy the result back. The editor never fetches cText pages itself: text goes in and out by copy-paste, and a scan image is requested only when you open that page.

## Features

- **Lossless round-trip.** Text you have not touched is exported byte-for-byte as it was pasted, including tag attributes and spacing.
- **Structured WYSIWYG editing.** cText wiki markup is shown formatted: headings, `{{ }}` notes, `{ }`, `{{{ }}}`, 【 】, 〖 〗, collation marks and `<entity>`. Page and line tags (`scanbegin`, `scanend`, `scanbreak`, `scanskip`) appear as small markers that can be dragged.
- **Protected `<seq>` anchors.** These sentence anchors carry the translation alignment. They can be dragged between their neighbours but cannot be deleted, duplicated or renumbered.
- **Page tools.**
  - Split a page with Ctrl+Enter.
  - Merge pages by deleting a page boundary.
  - Shift page numbers from a given page onward.
  - Matching `scanend` numbers are corrected automatically.
- **Proofreading view.** The current page is laid out like the original book: vertical columns, `y` offsets in character cells, and notes as double small lines. The scan image sits beside it, and each page can be ticked as proofread. A ticked page is flagged again if its text changes.
- **Scan image mapping.** Paste one example image URL and the editor infers the URL template for that scan file id. A local folder of images also works.
- **Lint.** Flags duplicate or out-of-order page numbers, mismatched file ids, half-width punctuation and unknown tags.
- **Export review.** Shows a character diff against the pasted text, plus a summary of structural changes (moved `seq`, added or removed pages, changed line breaks) for the cText edit summary.
- **Raw text mode.** Edit the cText source directly when needed.

Everything is stored in your browser's IndexedDB. Use **匯出專案檔** to back up a project or move it to another machine.

## Development

```sh
nvm use          # Node 22
npm ci
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run e2e      # browser tests (Playwright; first run: npx playwright install chromium)
npm run build
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

### Layout

| Path | Contents |
|---|---|
| `src/core/` | Format core with no DOM: lexer, ProseMirror schema, parse/serialize, page index, lint, diff |
| `src/editor/` | Editor behaviour: `seq` guard, page guard, paste handling, commands |
| `src/store/` | IndexedDB persistence and project/mapping files |
| `src/app/` | App state (signals) and editor wiring |
| `src/ui/` | Preact components |
