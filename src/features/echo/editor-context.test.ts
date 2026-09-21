import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { captureEchoContext } from "./editor-context";

function capture(doc: string, anchor = doc.length, head = anchor) {
  return captureEchoContext(EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown()] }), "source.md", {});
}

describe("Echo context", () => {
  it("prefers selected text including reversed selections", () => {
    const doc = "选中的文字超过十二个字符可以作为上下文\n\n另一个段落也有足够长的文字。";
    const context = capture(doc, 19, 0);
    expect(context.kind).toBe("selection");
    expect(context.text).toBe(doc.slice(0, 19));
    expect(context.to).toBe(19);
  });
  it("uses multiline Markdown blocks and isolates list items", () => {
    expect(capture("A paragraph long enough to search.", 0).text).toBe("A paragraph long enough to search.");
    expect(capture("First paragraph is long enough.\nContinues here.\n\nSecond paragraph has enough words.", 40).text)
      .toBe("First paragraph is long enough.\nContinues here.");
    const list = "- The first list item is here.\n- The second list item\n  continues on this line.\n- Another sibling item.";
    expect(capture(list, list.indexOf("continues") + 4).text).toBe("- The second list item\n  continues on this line.");
    expect(capture(list, list.indexOf("- The second")).text).toBe("- The second list item\n  continues on this line.");
    const nested = "- Outer item with enough characters\n  - Inner item with enough characters\n- Sibling with enough characters";
    expect(capture(nested, nested.indexOf("Inner") + 6).text).toBe("- Inner item with enough characters");
  });
  it("excludes blank lines, code and frontmatter", () => {
    expect(capture("long enough paragraph for search\n\n", 33).text).toBe("");
    expect(capture("```js\nconst lengthyVariable = 'not a query';\n```", 25).text).toBe("");
    expect(capture("    const lengthyVariable = 'not a query';", 22).text).toBe("");
    expect(capture("---\ntitle: Some long enough metadata\n---\n\nActual body", 24).text).toBe("");
    expect(capture("---\ntitle: Unclosed frontmatter with enough characters", 24).text).toBe("");
  });
  it("counts Unicode characters and crops around the cursor or selection start", () => {
    expect(capture("一 二 三 四 五 六 七 八 九 十 一").text).toBe("");
    expect(capture("一二三四五六七八九十十一十二").text).not.toBe("");
    const doc = "甲".repeat(2000) + "光标中心" + "😀".repeat(2000);
    const paragraph = capture(doc, 2002).text;
    expect(Array.from(paragraph)).toHaveLength(1500);
    expect(paragraph).toContain("光标中心");
    expect(capture(doc, 0, doc.length).text).toBe("甲".repeat(1500));
  });
});
