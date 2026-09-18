import { yamlLanguage } from "@codemirror/lang-yaml";
import matter from "gray-matter";

function readFrontmatter(content: string) {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = content.slice(bom.length);
  const candidate = /^---\r?\n([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(source);
  const match = candidate?.index === 0 ? candidate : null;
  if (source.startsWith("---\n") || source.startsWith("---\r\n")) {
    if (!match || match.index !== 0) throw new Error("Invalid frontmatter");
  }
  return { bom, source, match, data: matter(source).data };
}

export function notePropertyInput(content: string, key: string, fallback: string) {
  try {
    const value = readFrontmatter(content).data[key];
    if (value == null) return value === null ? "" : fallback;
    if (key === "tags" || key === "aliases") {
      return Array.isArray(value) ? value.join(", ") : String(value);
    }
    if (value instanceof Date) return value.toISOString();
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/** Replace only the selected YAML value, retaining the body and other properties verbatim. */
export function updateNoteProperty(content: string, key: string, input: string) {
  const { bom, source, match, data } = readFrontmatter(content);
  const previous = data[key];
  let value: unknown = input;
  if (key === "tags" || key === "aliases") {
    value = input.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  } else if (previous instanceof Date) {
    const date = new Date(input);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid date");
    value = date;
  } else if (previous != null && typeof previous !== "string") {
    value = JSON.parse(input);
    if (
      value === null ||
      typeof value !== typeof previous ||
      Array.isArray(value) !== Array.isArray(previous)
    ) throw new Error("Invalid property type");
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  // JSON strings/collections are also valid YAML, including punctuation and quotes.
  const serialized = value instanceof Date ? value.toISOString() : JSON.stringify(value);
  if (!match) {
    return `${bom}---${newline}${JSON.stringify(key)}: ${serialized}${newline}---${newline}${source}`;
  }

  const yaml = match[1];
  const mapping = yamlLanguage.parser.parse(yaml).topNode.getChild("Document")?.firstChild;
  if (mapping && mapping.name !== "BlockMapping" && mapping.name !== "FlowMapping") {
    throw new Error("Frontmatter must be a mapping");
  }
  let nextYaml: string | undefined;
  for (const pair of mapping?.getChildren("Pair") ?? []) {
    const keyNode = pair.getChild("Key");
    const colon = pair.getChild(":");
    if (!keyNode || !colon) continue;
    const keySource = yaml.slice(keyNode.from, keyNode.to);
    const parsedKey = Object.keys(matter(`---\n${keySource}: null\n---\n`).data)[0];
    if (parsedKey !== key) continue;
    nextYaml = `${yaml.slice(0, colon.to)} ${serialized}${yaml.slice(pair.to)}`;
    break;
  }
  if (nextYaml === undefined) {
    if (mapping?.name === "FlowMapping") throw new Error("Cannot add to a flow mapping");
    nextYaml = `${yaml}${yaml && !yaml.endsWith("\n") ? newline : ""}${JSON.stringify(key)}: ${serialized}${newline}`;
  }
  const opening = source.slice(0, source.indexOf("\n") + 1);
  const next = `${bom}${opening}${nextYaml}${source.slice(opening.length + yaml.length)}`;
  // Reject edits that would break anchors or otherwise invalidate the remaining YAML.
  matter(next.slice(bom.length));
  return next;
}
