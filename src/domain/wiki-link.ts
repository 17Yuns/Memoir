import { noteStem, resolveNoteRef, type NoteLinkIdentity } from "./note-links";

/** Generate a token using the same resolver as reading and graph construction. */
export function wikiInsertToken(
  note: NoteLinkIdentity,
  catalog: NoteLinkIdentity[],
  query: string,
  preferPath = false,
  sourcePath = "",
) {
  const title = note.title.trim();
  const needle = query.trim().toLowerCase();
  const stem = noteStem(note.relativePath);
  const preferStem = needle && (stem.toLowerCase().startsWith(needle) ||
    note.relativePath.toLowerCase().includes(`/${needle}`));
  const duplicateTitle = catalog.filter((item) => item.title.trim().toLowerCase() === title.toLowerCase()).length > 1;
  const candidates = duplicateTitle ? [] : preferPath ? [stem] : preferStem ? [stem, title] : [title, stem];
  for (const token of candidates) {
    if (token && !/[\[\]|#\n]/.test(token) &&
        resolveNoteRef(token, sourcePath, catalog) === note.relativePath) return token;
  }
  // A relative path with its extension also disambiguates .md and .mdx siblings.
  const source = sourcePath.split("/").slice(0, -1);
  const target = note.relativePath.split("/");
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  const path = `${source.length ? "../".repeat(source.length) : "./"}${target.join("/")}`;
  return path;
}
