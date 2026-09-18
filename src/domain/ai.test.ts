import { expect, it } from "vitest";
import { citationTitleFromPath, formatNoteCitation, mergeNoteCitations } from "./ai";

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
