# Blazer Markdown Editor: JSInterop Packaging

This repo is optimized for Blazor/MudBlazor usage by shipping static assets from `wwwroot`.

## Packaging model

1. Author source in `src/`.
2. Build distributables with `npm run build`.
3. Ship only `wwwroot` artifacts in releases:
   - `wwwroot/blazer-markdown-editor.js`
   - `wwwroot/blazer-markdown-editor.min.js`
   - `wwwroot/blazer-markdown-editor.css`

## Build

```bash
npm ci
npm run build
```

Build output includes license headers automatically.

## Versioning

This project uses calendar versioning:

- Format: `YYYY.MINOR.PATCH`
- Current: `2026.2.1`

## Blazor / MudBlazor consumption

Include static assets:

```html
<link rel="stylesheet" href="_content/<YourPackageOrProject>/blazer-markdown-editor.css" />
<script src="_content/<YourPackageOrProject>/blazer-markdown-editor.js"></script>
```

JSInterop API:

- `window.blazerMarkdownEditor.create(target, { markdown })`
- `window.blazerMarkdownEditor.setMarkdown(editorId, markdown)`
- `window.blazerMarkdownEditor.getMarkdown(editorId)`
- `window.blazerMarkdownEditor.focus(editorId)`
- `window.blazerMarkdownEditor.destroy(editorId)`


Required assets:

- `wwwroot/blazer-markdown-editor.js`
- `wwwroot/blazer-markdown-editor.min.js`
- `wwwroot/blazer-markdown-editor.css`
