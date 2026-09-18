import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { notePropertyInput, updateNoteProperty } from "./note-properties";

describe("updateNoteProperty", () => {
  it("preserves comments, unrelated YAML, and the exact MDX body", () => {
    const content = '---\n# metadata\ntitle: Old # keep\ntags: [one, two]\nconfig:\n  enabled: true\n---\n\n<Card>Hello</Card>';
    const updated = updateNoteProperty(content, "title", 'New: "title" # literal');
    expect(updated).toBe(content.replace('title: Old', 'title: "New: \\"title\\" # literal"'));
    expect(matter(updated).data.title).toBe('New: "title" # literal');
    expect(matter(content).data.title).toBe("Old");
  });

  it("updates block lists and allows clearing them", () => {
    const content = "---\naliases:\n  - Old\n  - Other\nstatus: draft\n---\nBody";
    const updated = updateNoteProperty(content, "aliases", "新别名， Second");
    expect(matter(updated).data).toEqual({ aliases: ["新别名", "Second"], status: "draft" });
    expect(updateNoteProperty(updated, "aliases", "")).toContain("aliases: []");
  });

  it("adds frontmatter without changing body content or its final newline", () => {
    const content = "# Heading\n\n---\nBody";
    const updated = updateNoteProperty(content, "title", "New");
    expect(matter(updated).data.title).toBe("New");
    expect(matter(updated).content).toBe(content);
  });

  it("preserves BOM and CRLF", () => {
    const content = '\uFEFF---\r\n"title": Old\r\n# note\r\n---\r\nBody';
    expect(updateNoteProperty(content, "title", "New")).toBe(content.replace('title": Old', 'title": "New"'));
  });

  it("keeps custom field types and rejects invalid values", () => {
    const content = '---\ncount: 1\nready: false\nconfig: {enabled: true}\nitems: [one]\n---\nBody';
    expect(matter(updateNoteProperty(content, "count", "2")).data.count).toBe(2);
    expect(matter(updateNoteProperty(content, "ready", "true")).data.ready).toBe(true);
    expect(matter(updateNoteProperty(content, "config", '{"enabled":false}')).data.config).toEqual({ enabled: false });
    expect(notePropertyInput(content, "items", "")).toBe('["one"]');
    expect(() => updateNoteProperty(content, "count", '"two"')).toThrow();
  });

  it("rejects malformed frontmatter and edits that break aliases", () => {
    expect(() => updateNoteProperty("---\ntitle: [\n---\nBody", "title", "New")).toThrow();
    expect(() => updateNoteProperty("---\ntitle: Old", "title", "New")).toThrow();
    expect(() => updateNoteProperty("---\ntitle: &name Old\nalias: *name\n---\nBody", "title", "New")).toThrow();
  });
});
