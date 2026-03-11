# ProseMirror Markdown Editor: production packaging for MudBlazor JSInterop

This prototype is a strong start. For production in a Blazor/MudBlazor app, the safest path is to **ship this as a small JavaScript package** (or static asset bundle) with explicit pinned dependencies, instead of loading many modules directly from CDN import maps.

## Recommended packaging approach

1. Create a small frontend package (for example `@your-org/blazer-markdown-editor`).
2. Move editor setup code into a module that exports a tiny API:
   - `createEditor(element, options)`
   - `setMarkdown(instance, markdown)`
   - `getMarkdown(instance)`
   - `destroy(instance)`
3. Bundle with `esbuild`, `vite`, or `rollup` into one or two static files.
4. Copy the built artifacts into `wwwroot` and call through JSInterop.
5. Keep ProseMirror package versions pinned and update intentionally.

## Minimal dependency set used by this prototype

From current code paths, the direct runtime dependencies are:

- `prosemirror-model`
- `prosemirror-transform`
- `prosemirror-state`
- `prosemirror-view`
- `prosemirror-keymap`
- `prosemirror-history`
- `prosemirror-commands`
- `prosemirror-schema-list`
- `prosemirror-inputrules`
- `prosemirror-dropcursor`
- `prosemirror-gapcursor`
- `prosemirror-markdown`
- `prosemirror-tables`
- `markdown-it`

`prosemirror-example-setup` and `prosemirror-menu` are not required.

## Gaps / holes to evaluate before production

- **Sanitization / trust boundary**
  - If Markdown can come from untrusted users, sanitize rendered HTML on display paths.
  - Keep `html: false` for markdown-it when parsing input in the editor.
- **Persistence model**
  - Decide if your source of truth is Markdown only, PM JSON only, or dual-format.
  - If dual-format, define reconciliation rules and tests.
- **Schema migrations**
  - If schema changes later, old stored content may need migration logic.
- **Plugin ordering contracts**
  - Current setup depends on plugin order (slash menu priority, keymaps).
  - Lock this in tests to prevent regressions.
- **Keyboard behavior consistency**
  - Verify Windows/macOS/Linux keybindings in Blazor host pages.
- **Table markdown round-trip**
  - Ensure table alignment and edge cases survive parse -> edit -> serialize cycles.
- **Clipboard behavior**
  - Paste detection is heuristic; test mixed-content clipboard payloads.
- **Error reporting**
  - Add JS-level hooks for errors/events so .NET can log and react.
- **Styling isolation**
  - Consider scoping editor styles to avoid collisions with MudBlazor theme styles.

## Suggested JSInterop contract

A minimal contract that stays stable:

- `window.blazerMarkdownEditor.create(element, options)` => returns `editorId`
- `window.blazerMarkdownEditor.setMarkdown(editorId, markdown)`
- `window.blazerMarkdownEditor.getMarkdown(editorId)` => `string`
- `window.blazerMarkdownEditor.onChange(editorId, dotNetRef, methodName)`
- `window.blazerMarkdownEditor.destroy(editorId)`

This keeps lifecycle ownership clear and avoids leaking ProseMirror internals into C#.

## Why the prototype import map was adjusted

For local prototyping, import maps are fine and this prototype keeps explicit pinned CDN imports for compatibility. In production, prefer your own package lock + local bundling over CDN-resolved dependency trees.
