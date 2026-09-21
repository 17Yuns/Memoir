import { describe, expect, it } from "vitest";
import { extractNoteLinks, resolveNoteRef } from "./note-links";
import { wikiInsertToken } from "./wiki-link";

describe("wiki link generation", () => {
  it("resolves duplicate titles, duplicate stems, path shadowing and md/mdx siblings", () => {
    const catalog = [
      { relativePath: "a/记忆.md", title: "记忆" }, { relativePath: "b/记忆.md", title: "记忆" },
      { relativePath: "b/记忆.mdx", title: "记忆" }, { relativePath: "a/b/记忆.md", title: "shadow" },
    ];
    for (const source of ["source.md", "a/source.md", "a/b/source.md"]) {
      for (const note of catalog) {
        const token = wikiInsertToken(note, catalog, "", false, source);
        const link = extractNoteLinks(`[[${token}]]`)[0];
        expect(resolveNoteRef(link.targetRef, source, catalog)).toBe(note.relativePath);
      }
    }
  });
});
