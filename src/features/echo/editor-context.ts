import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type { EchoContext } from "../../domain/echo";
import type { EchoContext } from "../../domain/echo";

export function captureEchoContext(state: EditorState, sourcePath: string, version: object, composing = false): EchoContext {
  const selection = state.selection.main;
  const { from, to, anchor, head } = selection;
  let start = from;
  let end = to;
  let excluded = false;
  if (selection.empty) {
    const line = state.doc.lineAt(head);
    excluded = !line.text.trim();
    // Markdown's standard parser treats YAML as headings; exclude it explicitly.
    if (state.doc.line(1).text.trim() === "---") {
      let frontmatterEnd = state.doc.length;
      for (let n = 2; n <= state.doc.lines; n++) {
        const candidate = state.doc.line(n);
        if (/^(---|\.\.\.)\s*$/.test(candidate.text)) { frontmatterEnd = candidate.to; break; }
      }
      excluded ||= head <= frontmatterEnd;
    }
    const tree = ensureSyntaxTree(state, head, 25) ?? syntaxTree(state);
    let node = tree.resolveInner(head, head === line.from ? 1 : -1);
    let block: typeof node | null = null;
    let item: typeof node | null = null;
    while (node.parent) {
      if (/^(FencedCode|CodeBlock|HTMLBlock)$/.test(node.name)) excluded = true;
      if (!item && node.name === "ListItem") item = node;
      if (/^(Paragraph|ATXHeading\d|SetextHeading\d|Table|Blockquote)$/.test(node.name) && !block) block = node;
      node = node.parent;
    }
    const context = item ?? block;
    if (context) { start = context.from; end = context.to; }
    else excluded = true;
  }
  // Bound extraction before converting to code points, including surrogate pairs.
  let windowStart = selection.empty ? Math.max(start, head - 3000) : start;
  let windowEnd = Math.min(end, selection.empty ? head + 3000 : start + 3000);
  if (windowStart > start && /[\uDC00-\uDFFF]/.test(state.doc.sliceString(windowStart, windowStart + 1))) windowStart--;
  if (windowEnd < end && /[\uD800-\uDBFF]/.test(state.doc.sliceString(windowEnd - 1, windowEnd))) windowEnd++;
  const chars = Array.from(state.doc.sliceString(windowStart, windowEnd));
  const cursor = Array.from(state.doc.sliceString(windowStart, head < windowStart ? windowStart : Math.min(head, windowEnd))).length;
  const offset = selection.empty ? Math.max(0, Math.min(chars.length - 1500, cursor - 750)) : 0;
  const text = excluded ? "" : chars.slice(offset, offset + 1500).join("").trim();
  return { sourcePath, version, doc: state.doc, anchor, head, from, to,
    kind: selection.empty ? "paragraph" : "selection",
    text: Array.from(text.replace(/\s/g, "")).length >= 12 ? text : "", composing };
}
