/**
 * Join a workspace root with relative segments and resolve `.` / `..`.
 * Leaves URL schemes (`demo://`) and Windows drive letters intact.
 */
export function resolveWorkspaceFilePath(root: string, ...relativeParts: string[]): string {
  let rootNormalized = root.replace(/\\/g, "/");
  // Windows APIs (including folder dialogs and Path::canonicalize) can return
  // extended-length paths. They are valid native paths, but `convertFileSrc`
  // cannot serve the `/?/C:/...` URL produced by treating that prefix as a
  // normal path segment.
  if (/^\/\/\?\/UNC\//i.test(rootNormalized)) {
    rootNormalized = `//${rootNormalized.slice(8)}`;
  } else if (rootNormalized.startsWith("//?/")) {
    rootNormalized = rootNormalized.slice(4);
  }
  rootNormalized = rootNormalized.replace(/\/+$/, "");
  const relative = relativeParts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/");
  const full = relative ? `${rootNormalized}/${relative}` : rootNormalized;
  const scheme =
    full.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/{0,2}/)?.[0] ??
    (full.startsWith("//") ? "//" : full.startsWith("/") ? "/" : "");
  const body = full.slice(scheme.length);
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${scheme}${parts.join("/")}`;
}

export function noteDirectory(relativePath: string): string {
  if (!relativePath.includes("/")) return "";
  return relativePath.slice(0, relativePath.lastIndexOf("/"));
}

export function relativePathFrom(fromDirectory: string, targetPath: string): string {
  const fromParts = fromDirectory ? fromDirectory.split("/").filter(Boolean) : [];
  const targetParts = targetPath.split("/").filter(Boolean);
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < targetParts.length - 1 &&
    fromParts[shared] === targetParts[shared]
  ) {
    shared += 1;
  }
  const up = fromParts.length - shared;
  const down = targetParts.slice(shared);
  return [...Array.from({ length: up }, () => ".."), ...down].join("/") || ".";
}

export function relativePathFromNote(noteRelativePath: string, targetPath: string): string {
  return relativePathFrom(noteDirectory(noteRelativePath), targetPath);
}

/** MDX / markdown encode local image hrefs; undo that before hitting the filesystem. */
export function decodeMediaHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}
