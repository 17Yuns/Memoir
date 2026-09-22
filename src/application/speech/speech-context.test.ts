import { describe, expect, it } from "vitest";
import { buildSpeechContext } from "./speech-context";

const target = { root: "/private/workspace", path: "projects/技术简历.md", content: "", from: 0 };

describe("local speech context", () => {
  it("keeps nearby terminology and the title without sending distant note content or paths", () => {
    const content = "# 后端工程师\n远处的旧项目\n" + "旧内容。".repeat(500) + "\n字节跳动推理基础设施平台，灰度发布与机器资源管理。";
    const context = buildSpeechContext({ ...target, content, from: content.length });
    expect(context).toContain("后端工程师");
    expect(context).toContain("字节跳动推理基础设施平台，灰度发布与机器资源管理");
    expect(context).not.toContain("远处的旧项目");
    expect(context).not.toContain(target.root);
    expect(Array.from(context).length).toBeLessThanOrEqual(305);
  });

  it("includes both sides of the insertion point and strips link targets and formatting", () => {
    const content = "# 项目\n负责 **Rust** [推理平台](https://example.com/private) 和 Kubernetes 资源管理";
    const context = buildSpeechContext({ ...target, content, from: content.indexOf(" 和") });
    expect(context).toContain("Rust 推理平台 和 Kubernetes 资源管理");
    expect(context).not.toContain("https:");
    expect(context).not.toContain("**");
  });

  it("handles empty notes, out-of-range cursors and supplementary Unicode characters", () => {
    expect(buildSpeechContext(target)).toBe("技术简历");
    const content = "𠮷😀".repeat(300);
    for (const from of [-1, Number.NaN, content.length, content.length + 100]) {
      const context = buildSpeechContext({ ...target, content, from });
      expect(context).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(Array.from(context).length).toBeLessThanOrEqual(305);
    }
  });
});
