import { extractTitle } from "../../domain/notes/note-utils";
import type { SpeechTarget } from "../../domain/speech";

function plainText(text: string) {
  return text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f#>*_`~[\]{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A small, frozen hint from the insertion target, used only by local recognition. */
export function buildSpeechContext(target: SpeechTarget): string {
  const cursor = Number.isFinite(target.from) ? Math.max(0, Math.min(target.content.length, target.from)) : 0;
  const fileName = target.path.split("/").pop() || "";
  const title = Array.from(plainText(extractTitle(target.content.slice(0, 4096), fileName))).slice(0, 48).join("");
  // Slice near the cursor first so a large note does not dominate the prompt.
  const before = Array.from(target.content.slice(Math.max(0, cursor - 320), cursor)).slice(-160).join("");
  const after = Array.from(target.content.slice(cursor, cursor + 192)).slice(0, 96).join("");
  const nearby = plainText(before + after);
  return [title, nearby].filter(Boolean).join("\n");
}
