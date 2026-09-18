import { describe, expect, it } from "vitest";
import { streamedMessage } from "./ai-stream-preview";

describe("streamed message preview", () => {
  it("decodes completed escapes and holds incomplete escapes", () => {
    expect(streamedMessage('{"message":"**你好**\\nnext\\u4f')).toBe("**你好**\nnext");
    expect(streamedMessage('{"message":"a\\"b\\\\c')).toBe('a"b\\c');
  });
  it("never displays replacement source or the JSON envelope", () => {
    expect(streamedMessage('{"edit":{"message":"hidden","replacement":"private"},"message":"Visible')).toBe("Visible");
    expect(streamedMessage('{"edit":{"replacement":"private')).toBe("");
    expect(streamedMessage('```json\n{"message":"Done","edit":{"replacement":"private')).toBe("Done");
    expect(streamedMessage('{"mes')).toBe("");
  });
});

it("hides DSML in the message even when the marker arrives in separate chunks", () => {
  for (const marker of ["<", "<|", "<|D", "<|DS", "<|DSM", "<|DSML", "<|DSML|tool_calls>", "<｜DSML｜invoke name=", "< | DSML | tool_calls>"]) {
    const raw = JSON.stringify({ message: `准备修改。\n${marker}`, edit: null });
    expect(streamedMessage(raw)).toBe("准备修改。");
  }
  expect(streamedMessage(JSON.stringify({ message: "正常回答中的 DSML 字样和 <em>HTML</em>。", edit: null })))
    .toBe("正常回答中的 DSML 字样和 <em>HTML</em>。");
});
