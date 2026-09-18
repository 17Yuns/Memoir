/** Read only a top-level message string. Never preview the edit envelope/source. */
export function streamedMessage(raw: string): string {
  const message = readStreamedMessage(raw);
  // Hide leaked provider syntax, including a marker split across stream chunks.
  const marker = /<\s*\/?\s*[|｜]\s*DSML\b/i.exec(message);
  if (marker) return message.slice(0, marker.index).trimEnd();
  return message.replace(/<\s*(?:[|｜]\s*(?:D(?:S(?:M(?:L)?)?)?)?)?$/i, "").trimEnd();
}

function readStreamedMessage(raw: string): string {
  const text = raw.trimStart().replace(/^```(?:json)?\s*\n/i, "");
  if (!text.startsWith("{")) return "";
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === '"') {
      const start = index;
      for (index += 1; index < text.length; index += 1) {
        if (text[index] === "\\") index += 1;
        else if (text[index] === '"') break;
      }
      if (depth !== 1 || text.slice(start, index + 1) !== '"message"') continue;
      const valueStart = /^\s*:\s*"/.exec(text.slice(index + 1));
      if (!valueStart) continue;
      const value = text.slice(index + 1 + valueStart[0].length);
      let output = "";
      for (let at = 0; at < value.length; at += 1) {
        const next = value[at];
        if (next === '"') return output;
        if (next !== "\\") { output += next; continue; }
        if (at + 1 === value.length) return output;
        const length = value[at + 1] === "u" ? 6 : 2;
        if (at + length > value.length) return output;
        try { output += JSON.parse('"' + value.slice(at, at + length) + '"') as string; }
        catch { return output; }
        at += length - 1;
      }
      return output;
    }
  }
  return "";
}
