# How to Use Blazer Markdown Editor

## Build
```bash
npm ci
npm run build
```

## Include in Blazor / MudBlazor
Add built assets to your host page or static web assets pipeline:

```html
<link rel="stylesheet" href="_content/<YourPackageOrProject>/blazer-markdown-editor.css" />
<script src="_content/<YourPackageOrProject>/blazer-markdown-editor.js"></script>
```

## JSInterop API
Use the global object:

- `window.blazerMarkdownEditor.create(target, { markdown })` → `editorId`
- `window.blazerMarkdownEditor.setMarkdown(editorId, markdown)`
- `window.blazerMarkdownEditor.getMarkdown(editorId)`
- `window.blazerMarkdownEditor.focus(editorId)`
- `window.blazerMarkdownEditor.destroy(editorId)`

## Typical lifecycle (Blazor)
1. On first render, call `create` with the target element.
2. Push external value changes with `setMarkdown`.
3. Pull current editor state with `getMarkdown` when saving.
4. Dispose with `destroy` in component cleanup.

## Notes
- Keep `wwwroot` outputs as release artifacts (`js`, `min.js`, `css`).
- Use the packaging guidance in [jsinterop-packaging.md](jsinterop-packaging.md).
