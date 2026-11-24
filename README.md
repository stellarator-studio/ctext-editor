# cText Editor

A browser-based editor that helps proofread and mark up texts for the [Chinese Text Project (cText)](https://ctext.org) wiki.

Copy a text from a cText edit box, proofread it page by page against the scanned original, and copy the result back. A project can hold several chapters of a work, each one a separate cText edit box. The editor never fetches cText pages itself: text goes in and out by copy-paste, and a scan image is requested only when you open that page.

## Features

- **Lossless round-trip.** Text you have not touched is exported byte-for-byte as it was pasted, including tag attributes and spacing.
- **Chapters.** Add chapters to a project whenever you need them (＋ 加入 in the chapter list), then reorder, rename or delete them. Each chapter is exported to cText on its own and has its own proofreading state. All chapters share the project's annotation decisions, as well as the image mappings and the dictionary. A plain-text chapter continues the file id and page numbering of the last chapter.
- **Structured editing (編輯模式).** cText wiki markup is shown formatted: headings, `{{ }}` notes, `{ }`, `{{{ }}}`, 【 】, 〖 〗, collation marks and `<entity>`. Page and line tags (`scanbegin`, `scanend`, `scanbreak`, `scanskip`) appear as small markers that can be dragged. Things that change the output but are invisible in formatted text are made visible: each note is framed, so a marker inside a note (`{{…<scanbreak/>}}`) or two touching notes (`{{AB}}{{　}}`) can be told apart; spaces are underlined, with half-width spaces highlighted; and a heading shows its `*` / `**` where it sits in the source (`*<seq/>標題` vs `<seq/>*標題`).
- **Notes.** Marking text next to a note extends that note instead of starting a new one. 夾注排版 pads a note with N−1 full-width spaces so its N characters take only the first of the two small lines (`{{ABCD　　　}}`), and joins touching notes.
- **Protected `<seq>` anchors.** These sentence anchors carry the translation alignment. They can be dragged between their neighbours but cannot be deleted, duplicated or renumbered.
- **Find and replace** (Ctrl+F / Ctrl+H) in both modes, with regular expressions. In the structured editor, a term split by a column break, page boundary or `seq` still matches, and replacing keeps those markers. In raw text mode the whole source is searched, not only the part on screen.
- **Paragraph style and formatting.** Set a heading (`*` / `**`) from the toolbar or Ctrl+Alt+1 / 2 (Ctrl+Alt+0 for body text). 清除格式 (Ctrl+\\) removes notes and other spans from a selection; entities are kept. Less common marks and page actions sit in drop-down menus.
- **Page tools.**
  - Split a page with Ctrl+Enter.
  - Merge pages by deleting a page boundary.
  - Shift page numbers from a given page onward.
  - Matching `scanend` numbers are corrected automatically.
- **Proofreading view.** The current page is laid out like the original book: vertical columns, `y` offsets in character cells, and notes as double small lines. Each note is split into its two small lines (first line ⌈n/2⌉ cells, spaces and `scanskip` blanks included) and framed on its own, and spaces are drawn as visible cells. In a note that starts a column, a `scanbreak` ends the first small line instead of the column. Punctuation is hidden by default, since the original prints have none, so the text lines up with the scan character by character. Click a column to select it, then change its leading blank cells (`y` of its `scanbreak`) with ↑↓ or the 空格 control; ←→ move between columns. The scan image sits beside it (drag to pan, Ctrl+wheel to zoom; the divider between text and image can be dragged), and each page can be ticked as proofread. A ticked page is flagged again if its text changes.
- **Scan image mapping.** Paste one example image URL and the editor infers the URL template for that scan file id. A local folder of images also works.
- **Annotation.** A global dictionary maps terms to cText entities, one entry per entity with all of its spellings.
  - Build it from the `<entity>` tags already in a text, add entries by hand (or from the editor selection), or import and export it as JSON.
  - The editor lists untagged occurrences of dictionary terms, including ones split by a column break. Accept or reject them one by one or per term; rejections are remembered per project.
- **Click-to-break mode.** Click between characters to insert a column break (Shift+click splits the page), for aligning OCR text with the scan.
- **Plain text import.** Text without scan tags (e.g. OCR output) can be given page and column markers on import: each line becomes a column, and a blank line starts a new page.
- **Lint.** Flags duplicate or out-of-order page numbers, mismatched file ids, unknown tags, half-width punctuation, touching notes (`{{AB}}{{　}}`) and heading markers placed after a `<seq>` or `<scanbreak>`. The last three can be fixed one at a time or all at once.
- **Adjustable layout.** The dividers between the page list, the text and the side panel can be dragged. Widths are remembered per browser.
- **Export review.** Shows a character diff against the pasted text, plus a summary of structural changes (moved `seq`, added or removed pages, changed line breaks) for the cText edit summary.
- **Raw text mode.** Edit the cText source directly when needed.

Everything is stored in your browser's IndexedDB. Use **匯出專案檔** to back up a project or move it to another machine; the file holds all chapters and also carries the image mappings for the project's file ids and the annotation dictionary, which are merged in on import. Projects and project files from before chapters existed open as a project with one chapter.

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
