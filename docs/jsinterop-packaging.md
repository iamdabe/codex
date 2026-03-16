# Blazor Markdown Editor: JSInterop Packaging

This repo is optimized for Blazor/MudBlazor usage by shipping static assets from `wwwroot`.

## Packaging model

1. Author source in `src/`.
2. Build distributables with `npm run build`.
3. Ship only `wwwroot` artifacts in releases:
   - `wwwroot/blazor-markdown-editor.js`
   - `wwwroot/blazor-markdown-editor.min.js`
   - `wwwroot/blazor-markdown-editor.css`

## Build

```bash
npm ci
npm run build
```

Build output includes license headers automatically.

## Versioning

This project uses calendar versioning:

- Format: `YYYY.MINOR.PATCH`
- Example: `2026.2.1`

## Blazor / MudBlazor consumption

Include static assets:

```html
<link rel="stylesheet" href="_content/<YourPackageOrProject>/blazor-markdown-editor.css" />
<script src="_content/<YourPackageOrProject>/blazor-markdown-editor.js"></script>
```

JSInterop API:

- `window.blazorMarkdownEditor.create(target, { markdown })`
- `window.blazorMarkdownEditor.setMarkdown(editorId, markdown)`
- `window.blazorMarkdownEditor.getMarkdown(editorId)`
- `window.blazorMarkdownEditor.focus(editorId)`
- `window.blazorMarkdownEditor.destroy(editorId)`


Required assets:

- `wwwroot/blazor-markdown-editor.js`
- `wwwroot/blazor-markdown-editor.min.js`
- `wwwroot/blazor-markdown-editor.css`
