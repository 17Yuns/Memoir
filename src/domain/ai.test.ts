import { expect, it } from "vitest";
import {
  citationTitleFromPath,
  formatNoteCitation,
  mergeNoteCitations,
  selectUsedNoteCitations,
} from "./ai";

it("keeps unique citation paths in first-seen order", () => {
  expect(
    mergeNoteCitations(
      [
        { path: " 工作/秋招/百度笔试.mdx ", title: " 百度笔试 " },
        { path: "工作/秋招/百度笔试.mdx", title: "duplicate" },
      ],
      [{ path: "LeetCode/two-sum.md", title: "" }],
      [{ path: "", title: "skip" }],
      null,
    ),
  ).toEqual([
    { path: "工作/秋招/百度笔试.mdx", title: "百度笔试" },
    { path: "LeetCode/two-sum.md", title: "two-sum" },
  ]);
});

it("labels citations with a distinct title when it adds information", () => {
  expect(citationTitleFromPath("工作/秋招/百度笔试.mdx")).toBe("百度笔试");
  expect(
    formatNoteCitation({ path: "工作/秋招/百度笔试.mdx", title: "百度笔试" }),
  ).toBe("工作/秋招/百度笔试.mdx");
  expect(
    formatNoteCitation({ path: "LeetCode/two-sum.md", title: "Two Sum" }),
  ).toBe("Two Sum · LeetCode/two-sum.md");
});

it("keeps only notes named in the reply and ignores unused search hits", () => {
  const retrieved = [
    { path: "工作/秋招/秋招投递记录.mdx", title: "秋招投递记录" },
    { path: "工作/秋招/百度笔试.mdx", title: "百度笔试" },
    { path: "学习/八股/python.mdx", title: "Python" },
    { path: "welcome.mdx", title: "欢迎使用 Memoir" },
  ];
  expect(
    selectUsedNoteCitations(
      "我找到了百度笔试题的记录（工作/秋招/百度笔试.mdx）：附有完整的 Python 解法。",
      retrieved,
      { path: "日记.mdx", title: "日记" },
    ),
  ).toEqual([{ path: "工作/秋招/百度笔试.mdx", title: "百度笔试" }]);
});

it("falls back to the open note only when nothing was retrieved", () => {
  expect(
    selectUsedNoteCitations("这篇笔记有三个章节。", [], { path: "notes.md", title: "notes" }),
  ).toEqual([{ path: "notes.md", title: "notes" }]);
  expect(
    selectUsedNoteCitations("没有点名任何路径。", [{ path: "LeetCode/two-sum.md", title: "Two Sum" }], {
      path: "notes.md",
      title: "notes",
    }),
  ).toEqual([]);
});
