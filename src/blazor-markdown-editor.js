import { Schema, Slice } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
} from "prosemirror-inputrules";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import {
  schema as mdSchema,
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from "prosemirror-markdown";
import {
  tableNodes,
  columnResizing,
  tableEditing,
  goToNextCell,
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  addRowAfter,
  addRowBefore,
  deleteRow,
  deleteTable,
} from "prosemirror-tables";
import {
  setBlockType,
  wrapIn,
  chainCommands,
  newlineInCode,
  createParagraphNear,
  liftEmptyBlock,
  splitBlock,
  baseKeymap,
} from "prosemirror-commands";
import { wrapInList, splitListItem, liftListItem } from "prosemirror-schema-list";
import markdownit from "markdown-it";

const tNodes = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {
    alignment: {
      default: null,
      getFromDOM: (dom) => (dom.style && dom.style.textAlign) || null,
      setDOMAttr(v, a) {
        if (v) a.style = (a.style || "") + `text-align:${v};`;
      },
    },
  },
});

let nodes = mdSchema.spec.nodes;
for (const [n, s] of Object.entries(tNodes)) nodes = nodes.update(n, s);
const schema = new Schema({ nodes, marks: mdSchema.spec.marks });
const md = markdownit("default", { html: false });

const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    table(state, node) {
      const rows = [];
      node.forEach((row, i) => {
        const cells = [];
        row.forEach((cell) => {
          const text = cell.textContent.replace(/\|/g, "\\|");
          cells.push(` ${text} `);
        });
        rows.push(`|${cells.join("|")}|`);

        if (i === 0) {
          const separators = [];
          row.forEach((cell) => {
            const align = cell.attrs.alignment;
            if (align === "center") separators.push(":---:");
            else if (align === "right") separators.push("---:");
            else separators.push("---");
          });
          rows.push(`| ${separators.join(" | ")} |`);
        }
      });
      state.write(rows.join("\n"));
      state.closeBlock(node);
    },
    table_row() {},
    table_cell() {},
    table_header() {},
  },
  defaultMarkdownSerializer.marks,
);

function inlineNodes(tokens) {
  if (!tokens || !tokens.length) return [];
  const out = [];
  const marks = [];

  for (const t of tokens) {
    if (t.type === "text" && t.content) out.push(schema.text(t.content, marks.slice()));
    else if (t.type === "code_inline") out.push(schema.text(t.content, [...marks, schema.marks.code.create()]));
    else if (t.type === "strong_open") marks.push(schema.marks.strong.create());
    else if (t.type === "strong_close") marks.splice(marks.findIndex((m) => m.type === schema.marks.strong), 1);
    else if (t.type === "em_open") marks.push(schema.marks.em.create());
    else if (t.type === "em_close") marks.splice(marks.findIndex((m) => m.type === schema.marks.em), 1);
    else if (t.type === "link_open") marks.push(schema.marks.link.create({ href: (t.attrGet && t.attrGet("href")) || "", title: (t.attrGet && t.attrGet("title")) || "" }));
    else if (t.type === "link_close") marks.splice(marks.findIndex((m) => m.type === schema.marks.link), 1);
    else if (t.type === "softbreak") out.push(schema.text("\n", marks.slice()));
    else if (t.type === "hardbreak") out.push(schema.node("hard_break"));
    else if (t.type === "image") out.push(schema.node("image", {
      src: (t.attrGet && t.attrGet("src")) || "", alt: t.content || "",
      title: (t.attrGet && t.attrGet("title")) || null }));
  }
  return out;
}

function parseMarkdown(src) {
  const tokens = md.parse(src || "", {});
  const stack = [{ type: "doc", children: [] }];
  const top = () => stack[stack.length - 1];
  const push = (n) => top().children.push(n);

  for (const t of tokens) {
    if (t.type === "paragraph_open") { stack.push({ type: "paragraph", children: [] }); continue; }
    if (t.type === "heading_open") { stack.push({ type: "heading", attrs: { level: +t.tag.slice(1) }, children: [] }); continue; }
    if (t.type === "blockquote_open") { stack.push({ type: "blockquote", children: [] }); continue; }
    if (t.type === "bullet_list_open") { stack.push({ type: "bullet_list", children: [] }); continue; }
    if (t.type === "ordered_list_open") { stack.push({ type: "ordered_list", attrs: { order: +(t.attrGet && t.attrGet("start")) || 1 }, children: [] }); continue; }
    if (t.type === "list_item_open") { stack.push({ type: "list_item", children: [] }); continue; }
    if (t.type === "table_open") { stack.push({ type: "table", children: [] }); continue; }
    if (t.type === "tr_open") { stack.push({ type: "table_row", children: [] }); continue; }
    if (t.type === "thead_open" || t.type === "tbody_open") continue;
    if (t.type === "thead_close" || t.type === "tbody_close") continue;
    if (t.type === "th_open" || t.type === "td_open") {
      const sty = (t.attrGet && t.attrGet("style")) || "";
      const m = sty.match(/text-align:\s*(\w+)/);
      stack.push({ type: t.type === "th_open" ? "table_header" : "table_cell", attrs: { alignment: m ? m[1] : null }, children: [] });
      continue;
    }

    if (t.type === "paragraph_close") { const f = stack.pop(); push(schema.node("paragraph", null, inlineNodes(f.children))); continue; }
    if (t.type === "heading_close") { const f = stack.pop(); push(schema.node("heading", f.attrs, inlineNodes(f.children))); continue; }
    if (t.type === "blockquote_close") { const f = stack.pop(); push(schema.node("blockquote", null, f.children.length ? f.children : [schema.node("paragraph")])); continue; }
    if (t.type === "bullet_list_close") { const f = stack.pop(); push(schema.node("bullet_list", null, f.children)); continue; }
    if (t.type === "ordered_list_close") { const f = stack.pop(); push(schema.node("ordered_list", f.attrs, f.children)); continue; }
    if (t.type === "list_item_close") { const f = stack.pop(); push(schema.node("list_item", null, f.children.length ? f.children : [schema.node("paragraph")])); continue; }
    if (t.type === "table_close") { const f = stack.pop(); push(schema.node("table", null, f.children)); continue; }
    if (t.type === "tr_close") { const f = stack.pop(); push(schema.node("table_row", null, f.children)); continue; }
    if (t.type === "th_close" || t.type === "td_close") {
      const f = stack.pop();
      const il = inlineNodes(f.children);
      push(schema.node(f.type, f.attrs, il.length ? [schema.node("paragraph", null, il)] : [schema.node("paragraph")]));
      continue;
    }

    if (t.type === "fence" || t.type === "code_block") {
      const txt = (t.content || "").replace(/\n$/, "");
      push(schema.node("code_block", null, txt ? [schema.text(txt)] : []));
      continue;
    }
    if (t.type === "hr") { push(schema.node("horizontal_rule")); continue; }
    if (t.type === "inline" && t.children) { top().children.push(...t.children); continue; }
  }

  const doc = stack[0];
  return schema.node("doc", null, doc.children.length ? doc.children : [schema.node("paragraph")]);
}

function buildBlockInputRules() {
  const rules = [];
  if (schema.nodes.blockquote) rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
  if (schema.nodes.ordered_list) rules.push(wrappingInputRule(/^\s*(\d+)\.\s$/, schema.nodes.ordered_list, (m) => ({ order: +m[1] })));
  if (schema.nodes.bullet_list) rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
  if (schema.nodes.code_block) rules.push(textblockTypeInputRule(/^```$/, schema.nodes.code_block));
  if (schema.nodes.horizontal_rule) rules.push(new InputRule(/^---$/, (state, _m, start, end) => state.tr.replaceWith(start - 1, end, schema.nodes.horizontal_rule.create())));
  if (schema.nodes.heading) rules.push(textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (m) => ({ level: m[1].length })));
  return inputRules({ rules });
}

function tableInputRulePlugin() {
  function parseHeaderCells(text) {
    if (!text.match(/^\s*\|.+\|\s*$/)) return null;
    const cells = text
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
    return cells.length >= 2 ? cells : null;
  }

  function parseSeparatorCells(text) {
    if (!text.match(/^\s*\|[\s:]*-{3,}[\s:]*(?:\|[\s:]*-{3,}[\s:]*)+\|?\s*$/)) return null;
    const cells = text
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());

    if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
    return cells;
  }

  function getAlignments(separatorCells) {
    return separatorCells.map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      return null;
    });
  }

  function buildTableNode(headerCells, aligns) {
    const headerRow = schema.nodes.table_row.create(
      null,
      headerCells.map((text, i) =>
        schema.nodes.table_header.create(
          { alignment: aligns[i] || null },
          text ? [schema.node("paragraph", null, [schema.text(text)])] : [schema.node("paragraph")],
        ),
      ),
    );

    const emptyRow = schema.nodes.table_row.create(
      null,
      headerCells.map((_, i) => schema.nodes.table_cell.create({ alignment: aligns[i] || null }, [schema.node("paragraph")])),
    );

    return schema.nodes.table.create(null, [headerRow, emptyRow]);
  }

  function findTableMarkdownRange(state) {
    const { $head } = state.selection;
    const paragraph = $head.parent;
    if (paragraph.type.name !== "paragraph") return null;

    const paragraphDepth = $head.depth;
    const paragraphFrom = $head.before(paragraphDepth);
    const paragraphTo = $head.after(paragraphDepth);

    const text = paragraph.textContent;
    const lines = text.split("\n");

    if (lines.length === 2) {
      const headerCells = parseHeaderCells(lines[0]);
      const separatorCells = parseSeparatorCells(lines[1]);
      if (!headerCells || !separatorCells || separatorCells.length !== headerCells.length) return null;
      return {
        from: paragraphFrom,
        to: paragraphTo,
        headerCells,
        aligns: getAlignments(separatorCells),
      };
    }

    const containerDepth = paragraphDepth - 1;
    const container = $head.node(containerDepth);
    const paragraphIndex = $head.index(containerDepth);
    if (paragraphIndex === 0) return null;

    const headerBlock = container.child(paragraphIndex - 1);
    if (headerBlock.type.name !== "paragraph") return null;

    const headerCells = parseHeaderCells(headerBlock.textContent);
    const separatorCells = parseSeparatorCells(text);
    if (!headerCells || !separatorCells || separatorCells.length !== headerCells.length) return null;

    return {
      from: paragraphFrom - headerBlock.nodeSize,
      to: paragraphTo,
      headerCells,
      aligns: getAlignments(separatorCells),
    };
  }

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter") return false;
        const { state } = view;
        const tableRange = findTableMarkdownRange(state);
        if (!tableRange) return false;

        const table = buildTableNode(tableRange.headerCells, tableRange.aligns);
        const tr = state.tr.replaceWith(tableRange.from, tableRange.to, table);
        const afterTable = tr.mapping.map(tableRange.from) + table.nodeSize;
        tr.insert(afterTable, schema.node("paragraph"));
        tr.setSelection(TextSelection.near(tr.doc.resolve(afterTable + 1)));
        view.dispatch(tr);
        event.preventDefault();
        return true;
      },
    },
  });
}

// ── Enter-key helpers ──

function splitHeadingCommand(state, dispatch) {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to)) return false;
  if ($from.parent.type.name !== "heading") return false;

  if (dispatch) {
    const atEnd = $from.parentOffset === $from.parent.content.size;
    const atStart = $from.parentOffset === 0;

    if (atStart) {
      // Insert empty paragraph before the heading
      const tr = state.tr.insert($from.before(), schema.node("paragraph"));
      dispatch(tr.scrollIntoView());
    } else if (atEnd) {
      // Insert empty paragraph after the heading
      const after = $from.after();
      const tr = state.tr.insert(after, schema.node("paragraph"));
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      dispatch(tr.scrollIntoView());
    } else {
      // Split heading; convert the new (second) part to paragraph
      const tr = state.tr.split($from.pos);
      const $new = tr.doc.resolve(tr.mapping.map($from.pos, 1));
      tr.setNodeMarkup($new.before($new.depth), schema.nodes.paragraph);
      dispatch(tr.scrollIntoView());
    }
  }
  return true;
}

function tableCellEnterCommand(state, dispatch) {
  const { $head } = state.selection;
  let cellDepth = -1;
  for (let d = $head.depth; d > 0; d--) {
    const name = $head.node(d).type.name;
    if (name === "table_cell" || name === "table_header") { cellDepth = d; break; }
  }
  if (cellDepth < 0) return false;

  // "Double-enter": cursor at end of paragraph whose last inline node is hard_break → exit table
  const prevNode = $head.nodeBefore;
  const atEnd = $head.parentOffset === $head.parent.content.size;
  if (atEnd && prevNode && prevNode.type.name === "hard_break") {
    let tableDepth = -1;
    for (let d = cellDepth; d > 0; d--) {
      if ($head.node(d).type.name === "table") { tableDepth = d; break; }
    }
    if (tableDepth < 0) return false;
    if (dispatch) {
      const tr = state.tr;
      // Remove trailing hard_break
      tr.delete($head.pos - 1, $head.pos);
      const afterTable = tr.mapping.map($head.after(tableDepth));
      tr.insert(afterTable, schema.node("paragraph"));
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterTable + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // Single enter: insert hard_break
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
  }
  return true;
}

function compactLineBreak(state, dispatch) {
  const { $head } = state.selection;
  if ($head.parent.type.name === "code_block") {
    if (dispatch) dispatch(state.tr.insertText("\n"));
    return true;
  }
  if (!$head.parent.inlineContent) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
  return true;
}

function codeBlockDoubleEnterExitCommand(state, dispatch) {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $head } = selection;
  if ($head.parent.type.name !== "code_block") return false;
  if ($head.parentOffset !== $head.parent.content.size) return false;

  // If the code block ends in a newline, Enter was already pressed once on an empty line.
  const text = $head.parent.textContent;
  if (!text.endsWith("\n")) return false;

  if (dispatch) {
    const tr = state.tr;
    tr.delete($head.pos - 1, $head.pos);
    const afterCodeBlock = tr.mapping.map($head.after($head.depth));
    tr.insert(afterCodeBlock, schema.node("paragraph"));
    tr.setSelection(TextSelection.near(tr.doc.resolve(afterCodeBlock + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function getActiveTableContext(state) {
  const { $head } = state.selection;
  let tableDepth = -1;
  let rowDepth = -1;

  for (let d = $head.depth; d > 0; d--) {
    const name = $head.node(d).type.name;
    if (rowDepth < 0 && name === "table_row") rowDepth = d;
    if (name === "table") {
      tableDepth = d;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0) return null;

  return {
    tableDepth,
    rowDepth,
    rowIndex: $head.index(tableDepth),
  };
}

function addRowBeforeIfAllowed(state, dispatch) {
  const tableContext = getActiveTableContext(state);
  if (tableContext?.rowIndex === 0) return false;
  return addRowBefore(state, dispatch);
}

function deleteRowIfAllowed(state, dispatch) {
  const tableContext = getActiveTableContext(state);
  if (tableContext?.rowIndex === 0) return false;
  return deleteRow(state, dispatch);
}

// ── Inline Markdown Input Rules ──
const inlineMarkdownRules = inputRules({ rules: [
  // **bold**
  new InputRule(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/, (state, match, start, end) => {
    if (!match[1]) return null;
    return state.tr.replaceWith(start, end, schema.text(match[1], [schema.marks.strong.create()]));
  }),
  // __bold__
  new InputRule(/__([^\s_](?:[^_]*[^\s_])?)__$/, (state, match, start, end) => {
    if (!match[1]) return null;
    return state.tr.replaceWith(start, end, schema.text(match[1], [schema.marks.strong.create()]));
  }),
  // *italic*
  new InputRule(/(?:^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*$/, (state, match, start, end) => {
    if (!match[1]) return null;
    const from = start + (match[0].length > match[1].length + 2 ? 1 : 0);
    return state.tr.replaceWith(from, end, schema.text(match[1], [schema.marks.em.create()]));
  }),
  // _italic_
  new InputRule(/(?:^|[^_])_([^\s_](?:[^_]*[^\s_])?)_$/, (state, match, start, end) => {
    if (!match[1]) return null;
    const from = start + (match[0].length > match[1].length + 2 ? 1 : 0);
    return state.tr.replaceWith(from, end, schema.text(match[1], [schema.marks.em.create()]));
  }),
  // `code`
  new InputRule(/`([^`]+)`$/, (state, match, start, end) => {
    if (!match[1]) return null;
    return state.tr.replaceWith(start, end, schema.text(match[1], [schema.marks.code.create()]));
  }),
]});

// ── Paste Handler ──
function pastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData && event.clipboardData.getData("text/plain");
        if (!text) return false;
        const looksLikeMarkdown =
          /^#{1,6}\s/m.test(text) ||
          /\*\*[^*]+\*\*/m.test(text) ||
          /^\s*[-*+]\s/m.test(text) ||
          /^\s*\d+\.\s/m.test(text) ||
          /^\s*>/m.test(text) ||
          /\|.+\|.+\|/m.test(text) ||
          /^```/m.test(text) ||
          /^---\s*$/m.test(text);
        if (!looksLikeMarkdown) return false;
        const doc = parseMarkdown(text);
        view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)));
        return true;
      }
    }
  });
}

// ── Floating Table Toolbar ──
function tableToolbarPlugin() {
  let toolbarEl = null;
  let blurHandler = null;
  let focusHandler = null;

  function hideToolbar() {
    if (toolbarEl) toolbarEl.style.display = "none";
  }

  function createToolbar() {
    const el = document.createElement("div");
    el.className = "table-toolbar";
    el.innerHTML = `
      <button data-cmd="addColumnBefore" title="Insert column left">\u21d0 Col</button>
      <button data-cmd="addColumnAfter"  title="Insert column right">Col \u21d2</button>
      <div class="sep"></div>
      <button data-cmd="addRowBefore" title="Insert row above">\u21d1 Row</button>
      <button data-cmd="addRowAfter"  title="Insert row below">Row \u21d3</button>
      <div class="sep"></div>
      <button data-cmd="deleteColumn" class="danger" title="Delete column">\u2715 Col</button>
      <button data-cmd="deleteRow"    class="danger" title="Delete row">\u2715 Row</button>
      <div class="sep"></div>
      <button data-cmd="deleteTable"  class="danger" title="Delete table">\u2715 Table</button>
    `;
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }
  const cmds = { addColumnBefore, addColumnAfter, deleteColumn,
                 addRowBefore: addRowBeforeIfAllowed, addRowAfter, deleteRow: deleteRowIfAllowed, deleteTable };

  function updateButtonStates(state) {
    if (!toolbarEl) return;

    toolbarEl.querySelectorAll("button[data-cmd]").forEach((btn) => {
      const cmd = cmds[btn.dataset.cmd];
      btn.disabled = cmd ? !cmd(state) : true;
    });
  }

  function positionForSelection(view) {
    if (!view.hasFocus()) { hideToolbar(); return; }

    const $h = view.state.selection.$head;
    let inTbl = false;
    let tblDom = null;
    for (let d = $h.depth; d > 0; d--) {
      if ($h.node(d).type.name === "table") {
        inTbl = true;
        tblDom = view.nodeDOM($h.before(d));
        break;
      }
    }

    if (!inTbl || !tblDom) { hideToolbar(); return; }

  updateButtonStates(view.state);
    const r = tblDom.getBoundingClientRect();
    toolbarEl.style.display = "flex";
    toolbarEl.style.left = r.left + "px";
    toolbarEl.style.top = (r.top - toolbarEl.offsetHeight - 6 + window.scrollY) + "px";
  }

  return new Plugin({
    view(editorView) {
      toolbarEl = createToolbar();
      toolbarEl.addEventListener("mousedown", e => {
        e.preventDefault();
        const btn = e.target.closest("button[data-cmd]");
        if (btn?.disabled) return;
        if (btn) { const c = cmds[btn.dataset.cmd]; if (c) c(editorView.state, editorView.dispatch); }
      });

      blurHandler = () => hideToolbar();
      focusHandler = () => requestAnimationFrame(() => positionForSelection(editorView));
      editorView.dom.addEventListener("focusout", blurHandler);
      editorView.dom.addEventListener("focusin", focusHandler);

      return {
        update(view) {
          positionForSelection(view);
        },
        destroy() {
          if (blurHandler) editorView.dom.removeEventListener("focusout", blurHandler);
          if (focusHandler) editorView.dom.removeEventListener("focusin", focusHandler);
          if (toolbarEl) toolbarEl.remove();
        }
      };
    }
  });
}

// ── Floating Link Toolbar ──
function linkToolbarPlugin() {
  let toolbarEl = null;
  let currentHref = "";
  let blurHandler = null;
  let focusHandler = null;

  function hideToolbar() {
    if (toolbarEl) toolbarEl.style.display = "none";
    currentHref = "";
  }

  function getActiveLinkHref(state) {
    const { selection } = state;
    const linkMarkType = schema.marks.link;
    if (!linkMarkType) return null;

    if (selection.empty) {
      const { $from } = selection;
      const marks = $from.marks();
      const direct = marks.find((m) => m.type === linkMarkType);
      if (direct?.attrs?.href) return direct.attrs.href;

      const before = $from.nodeBefore;
      if (before?.marks) {
        const m = before.marks.find((mark) => mark.type === linkMarkType);
        if (m?.attrs?.href) return m.attrs.href;
      }

      const after = $from.nodeAfter;
      if (after?.marks) {
        const m = after.marks.find((mark) => mark.type === linkMarkType);
        if (m?.attrs?.href) return m.attrs.href;
      }

      return null;
    }

    let href = null;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!node.isText || !node.marks || href) return;
      const mark = node.marks.find((m) => m.type === linkMarkType);
      if (mark?.attrs?.href) href = mark.attrs.href;
    });
    return href;
  }

  function createToolbar() {
    const el = document.createElement("div");
    el.className = "link-toolbar";
    el.innerHTML = `<button type="button" data-cmd="openLink">Open Link</button>`;
    el.style.display = "none";
    document.body.appendChild(el);
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (!currentHref) return;
      window.open(currentHref, "_blank", "noopener,noreferrer");
    });
    return el;
  }

  function positionForSelection(view) {
    if (!view.hasFocus()) {
      hideToolbar();
      return;
    }

    const href = getActiveLinkHref(view.state);
    if (!href) {
      hideToolbar();
      return;
    }

    currentHref = href;
    const coords = view.coordsAtPos(view.state.selection.from);
    toolbarEl.style.display = "flex";
    toolbarEl.style.left = coords.left + "px";
    toolbarEl.style.top = (coords.top - toolbarEl.offsetHeight - 6 + window.scrollY) + "px";
  }

  return new Plugin({
    view(editorView) {
      toolbarEl = createToolbar();
      blurHandler = () => hideToolbar();
      focusHandler = () => requestAnimationFrame(() => positionForSelection(editorView));
      editorView.dom.addEventListener("focusout", blurHandler);
      editorView.dom.addEventListener("focusin", focusHandler);

      return {
        update(view) {
          positionForSelection(view);
        },
        destroy() {
          if (blurHandler) editorView.dom.removeEventListener("focusout", blurHandler);
          if (focusHandler) editorView.dom.removeEventListener("focusin", focusHandler);
          if (toolbarEl) toolbarEl.remove();
        },
      };
    },
  });
}

// ── Slash Command Menu ──
const slashKey = new PluginKey("slashMenu");
const SLASH_ITEMS = [
  { label:"Heading 1",     icon:"H1", desc:"Big section heading",
    action:(s,d) => setBlockType(schema.nodes.heading,{level:1})(s,d) },
  { label:"Heading 2",     icon:"H2", desc:"Medium heading",
    action:(s,d) => setBlockType(schema.nodes.heading,{level:2})(s,d) },
  { label:"Heading 3",     icon:"H3", desc:"Small heading",
    action:(s,d) => setBlockType(schema.nodes.heading,{level:3})(s,d) },
  { label:"Paragraph",     icon:"\u00b6",  desc:"Plain text",
    action:(s,d) => setBlockType(schema.nodes.paragraph)(s,d) },
  { label:"Bullet List",   icon:"\u2022",  desc:"Unordered list",
    action:(s,d) => wrapInList(schema.nodes.bullet_list)(s,d) },
  { label:"Numbered List", icon:"1.", desc:"Ordered list",
    action:(s,d) => wrapInList(schema.nodes.ordered_list)(s,d) },
  { label:"Blockquote",    icon:"\u275d",  desc:"Quote block",
    action:(s,d) => wrapIn(schema.nodes.blockquote)(s,d) },
  { label:"Code Block",    icon:"<>", desc:"Fenced code block",
    action:(s,d) => setBlockType(schema.nodes.code_block)(s,d) },
  { label:"Divider",       icon:"\u2015",  desc:"Horizontal rule",
    action:(s,d) => { if(d) d(s.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create())); return true; } },
  { label:"Table",         icon:"\u25a6",  desc:"Insert 3\u00d73 table",
    action:(s,d) => {
      if (!d) return true;
      const hdr = () => schema.nodes.table_header.createAndFill();
      const cel = () => schema.nodes.table_cell.createAndFill();
      const table = schema.nodes.table.create(null,[
        schema.nodes.table_row.create(null,[hdr(),hdr(),hdr()]),
        schema.nodes.table_row.create(null,[cel(),cel(),cel()]),
        schema.nodes.table_row.create(null,[cel(),cel(),cel()]),
      ]);
      const tr = s.tr.replaceSelectionWith(table);
      const afterTable = tr.selection.from;
      tr.insert(afterTable, schema.node("paragraph"));
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterTable + 1)));
      d(tr.scrollIntoView());
      return true;
    } },
];

function slashMenuPlugin() {
  let menuEl = null, activeIdx = 0, filterText = "", slashPos = null;
  const filtered = () => {
    const q = filterText.toLowerCase();
    return SLASH_ITEMS.filter(it => it.label.toLowerCase().includes(q));
  };
  function destroy() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    slashPos = null; filterText = ""; activeIdx = 0;
  }
  function render(view) {
    const items = filtered();
    if (!items.length) { destroy(); return; }
    if (!menuEl) { menuEl = document.createElement("div"); menuEl.className = "slash-menu"; document.body.appendChild(menuEl); }
    const coords = view.coordsAtPos(view.state.selection.from);
    menuEl.style.left = coords.left + "px";
    menuEl.style.top  = (coords.bottom + 4) + "px";
    activeIdx = Math.min(activeIdx, items.length - 1);
    menuEl.innerHTML = items.map((it, i) =>
      `<div class="slash-menu-item${i===activeIdx?" active":""}" data-i="${i}">
        <span class="icon">${it.icon}</span>
        <span><span class="label">${it.label}</span><br><span class="desc">${it.desc}</span></span>
      </div>`
    ).join("");
    menuEl.querySelectorAll(".slash-menu-item").forEach(el => {
      el.addEventListener("mousedown", e => { e.preventDefault(); execute(view, items[+el.dataset.i]); });
    });
    const activeEl = menuEl.querySelector(".slash-menu-item.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }
  function execute(view, item) {
    view.dispatch(view.state.tr.delete(slashPos, view.state.selection.from));
    destroy();
    item.action(view.state, view.dispatch, view);
    view.focus();
  }
  return new Plugin({
    key: slashKey,
    props: {
      handleKeyDown(view, e) {
        if (!menuEl) return false;
        const items = filtered();
        if (e.key==="ArrowDown") { e.preventDefault(); activeIdx=(activeIdx+1)%items.length; render(view); return true; }
        if (e.key==="ArrowUp")   { e.preventDefault(); activeIdx=(activeIdx-1+items.length)%items.length; render(view); return true; }
        if (e.key==="Enter")     { e.preventDefault(); if(items[activeIdx]) execute(view,items[activeIdx]); return true; }
        if (e.key==="Escape")    { destroy(); return true; }
        return false;
      },
      handleTextInput(view, from, to, text) {
        if (text === "/" && !menuEl) {
          const $f = view.state.doc.resolve(from);
          const before = $f.parent.textBetween(0, $f.parentOffset, null, "\ufffc");
          if (!before.length || /\s$/.test(before))
            setTimeout(() => { slashPos = from; filterText = ""; activeIdx = 0; render(view); }, 0);
        }
        return false;
      },
    },
    view() {
      return {
        update(view) {
          if (!menuEl || slashPos === null) return;
          const { from } = view.state.selection;
          if (from <= slashPos) { destroy(); return; }
          filterText = view.state.doc.textBetween(slashPos + 1, from, "", "\ufffc");
          render(view);
        },
        destroy() { if (menuEl) menuEl.remove(); }
      };
    }
  });
}

// ── Code Block Escape (ArrowDown navigation) ──
function codeBlockEscapeKeymap() {
  return keymap({
    ArrowDown: (state, dispatch) => {
      const { $head } = state.selection;
      if ($head.parent.type.name !== "code_block") return false;
      const cursorAtEnd = $head.parentOffset === $head.parent.content.size;
      if (!cursorAtEnd) return false;
      const after = $head.after($head.depth);
      if (after < state.doc.content.size) {
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(after + 1))));
        return true;
      } else {
        if (dispatch) {
          const tr = state.tr;
          tr.insert(state.doc.content.size, schema.node("paragraph"));
          tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
          dispatch(tr);
        }
        return true;
      }
    },
  });
}

function createPlugins() {
  return [
    slashMenuPlugin(),
    tableInputRulePlugin(),
    history(),
    dropCursor(),
    gapCursor(),
    keymap({
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      "Mod-Enter": compactLineBreak,
      "Shift-Enter": compactLineBreak,
      Enter: chainCommands(
        codeBlockDoubleEnterExitCommand,
        newlineInCode,
        tableCellEnterCommand,
        splitListItem(schema.nodes.list_item),
        splitHeadingCommand,
        createParagraphNear,
        liftEmptyBlock,
        splitBlock,
      ),
    }),
    keymap(baseKeymap),
    buildBlockInputRules(),
    inlineMarkdownRules,
    codeBlockEscapeKeymap(),
    columnResizing(),
    tableEditing(),
    keymap({ Tab: goToNextCell(1), "Shift-Tab": goToNextCell(-1) }),
    tableToolbarPlugin(),
    linkToolbarPlugin(),
    pastePlugin(),
  ];
}

const editors = new Map();
let idCounter = 1;

function resolveTarget(target) {
  if (typeof target === "string") return document.querySelector(target);
  return target;
}

function create(target, options = {}) {
  const el = resolveTarget(target);
  if (!el) throw new Error("blazorMarkdownEditor.create: target element not found");

  const doc = parseMarkdown(options.markdown || "");
  const view = new EditorView(el, {
    state: EditorState.create({ doc, plugins: createPlugins() }),
  });

  const id = String(idCounter++);
  editors.set(id, { view });
  return id;
}

function getEditor(id) {
  const editor = editors.get(String(id));
  if (!editor) throw new Error(`blazorMarkdownEditor: unknown editor id '${id}'`);
  return editor;
}

function setMarkdown(id, markdown) {
  const { view } = getEditor(id);
  const doc = parseMarkdown(markdown || "");
  view.updateState(EditorState.create({ doc, plugins: createPlugins() }));
}

function getMarkdown(id) {
  const { view } = getEditor(id);
  return serializer.serialize(view.state.doc);
}

function focus(id) {
  getEditor(id).view.focus();
}

function destroy(id) {
  const key = String(id);
  const editor = getEditor(key);
  editor.view.destroy();
  editors.delete(key);
}

export const blazorMarkdownEditor = { create, setMarkdown, getMarkdown, focus, destroy };
window.blazorMarkdownEditor = blazorMarkdownEditor;
