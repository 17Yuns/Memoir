import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { APP_VERSION } from "../platform/app-version";
import { BrowserPersistenceGateway, BrowserWorkspaceGateway } from "./browser";

describe("BrowserPersistenceGateway", () => {
  it("does not call GitHub and reports the demo as up to date", async () => {
    const gateway = new BrowserPersistenceGateway();
    await expect(gateway.checkAppUpdate()).resolves.toEqual({
      status: "upToDate",
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      releaseUrl: null,
      releaseNotes: null,
    });
    await expect(gateway.skipAppUpdate("0.1.7")).resolves.toBeUndefined();
  });
});

describe("BrowserWorkspaceGateway", () => {
  it("renames and deletes nested folders, rejecting conflicts and root deletion", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const root = "demo://memoir";
    await gateway.createFolder(root, "work/empty");
    const note = await gateway.createNote({ root, title: "Nested", extension: "md", folder: "work/child" });
    const content = await gateway.readNote(root, note.relativePath);
    await gateway.createFolder(root, "taken");
    await expect(gateway.renameFolder(root, "work", "taken")).rejects.toThrow();
    await expect(gateway.deleteFolder(root, "")).rejects.toThrow();
    await gateway.renameFolder(root, "work", "renamed");
    await expect(gateway.readNote(root, "renamed/child/nested.md")).resolves.toBe(content);
    await gateway.deleteFolder(root, "renamed");
    await expect(gateway.readNote(root, "renamed/child/nested.md")).rejects.toThrow();
    const page = await gateway.queryLibrary(root, { q: "", nav: "all", folder: null, tag: null });
    expect(page.stats.folders.some((item) => item.folder.startsWith("renamed"))).toBe(false);
  });

  it("creates and keeps an empty folder in library stats", async () => {
    const gateway = new BrowserWorkspaceGateway();
    await expect(gateway.createFolder("demo://memoir", "工作/项目")).resolves.toBe("工作/项目");

    const page = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    expect(page.stats.folders).toEqual(
      expect.arrayContaining([
        { folder: "工作", count: 0 },
        { folder: "工作/项目", count: 0 },
      ]),
    );
  });

  it("returns title tags and excerpt from the in-memory scan", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const page = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    const notes = page.notes;
    const welcome = notes.find((note) => note.relativePath === "welcome.mdx");
    expect(welcome?.title).toBe("Welcome to Memoir");
    expect(welcome?.tags).toEqual(["memoir", "mdx"]);
    expect(welcome?.excerpt.length).toBeGreaterThan(0);
  });

  it("returns a note graph for wiki and markdown references", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const graph = await gateway.getNoteGraph("demo://memoir");
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(
      graph.edges.some(
        (edge) =>
          edge.sourcePath === "welcome.mdx" &&
          edge.targetRef === "Two Sum" &&
          edge.targetPath === "LeetCode/two-sum.md",
      ),
    ).toBe(true);
  });

  it("writes multiple tags into the new note frontmatter", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const path = await gateway.createNote({
      root: "demo://memoir",
      title: "New Practice",
      extension: "md",
      folder: "LeetCode",
      tags: ["leetcode", "rust"],
    });

    expect(path.relativePath).toBe("LeetCode/new-practice.md");
    expect(await gateway.readNote("demo://memoir", path.relativePath)).toContain(
      'tags: ["leetcode", "rust"]',
    );
  });

  it("downloads a PDF export in the browser demo", async () => {
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const gateway = new BrowserWorkspaceGateway();
    const path = await gateway.chooseExportPath({ defaultPath: "demo://memoir/two.pdf" });
    expect(path).toBe("two.pdf");
    await gateway.writeExportFile(path, "AAAA");
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    vi.unstubAllGlobals();
  });

  it("filters the in-memory library with the same query contract", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const all = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    const tagged = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: "diary",
    });
    const folder = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: "日记",
      tag: null,
    });
    expect(all.stats.total).toBeGreaterThan(0);
    expect(tagged.notes.every((note) => note.tags.map((tag) => tag.toLowerCase()).includes("diary"))).toBe(
      true,
    );
    expect(folder.notes.every((note) => note.relativePath.startsWith("日记/"))).toBe(true);
  });

  it("reports an in-memory index for the demo workspace", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const info = await gateway.getIndexInfo("demo://memoir");
    expect(info.persistent).toBe(false);
    expect(info.relativePath).toBe(".memoir/index.sqlite");
    expect(info.noteCount).toBeGreaterThan(0);
    expect(info.tagCount).toBeGreaterThan(0);
    await expect(gateway.rebuildIndex("demo://memoir")).resolves.toMatchObject({
      stats: { total: info.noteCount },
    });
  });

  it("stores pasted attachments in memory and resolves them as data URLs", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const saved = await gateway.saveAttachment("demo://memoir", {
      bytesBase64: "AAAA",
      fileName: "paste.png",
      mimeType: "image/png",
    });
    expect(saved.relativePath).toMatch(/^attachments\/\d{4}-\d{2}\/paste\.png$/);
    expect(await gateway.scanAttachments("demo://memoir")).toHaveLength(1);
    expect(gateway.resolveMediaPath(`demo://memoir/${saved.relativePath}`)).toMatch(
      /^data:image\/png;base64,AAAA$/,
    );
    await gateway.deleteAttachment("demo://memoir", saved.relativePath);
    expect(await gateway.scanAttachments("demo://memoir")).toEqual([]);
  });

  it("rejects non-http URLs before fetching a link preview", async () => {
    const gateway = new BrowserWorkspaceGateway();
    await expect(gateway.fetchLinkPreviewHtml("file:///tmp/note.md")).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("reads link preview HTML from fetch", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><title>Hello</title></html>", { status: 200 }),
    );
    await expect(gateway.fetchLinkPreviewHtml("https://example.com")).resolves.toContain("Hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" } }),
    );
    fetchMock.mockRestore();
  });

  it("omits editor context and suppresses edit proposals when no document is attached", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ choices: [{ message: { content: JSON.stringify({
        message: "Hello",
        edit: { tool: "replace_document", replacement: "Unexpected edit" },
      }) } }] }),
    );
    const messages = [{ role: "user" as const, content: "Hello there" }];
    const result = await new BrowserWorkspaceGateway().chatWithNote(
      "demo://memoir", DEFAULT_SETTINGS.ai, messages, null,
    );
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.messages.filter((message: { role: string }) => message.role === "user")).toEqual(messages);
    expect(JSON.stringify(payload)).not.toContain("<editor_context>");
    expect(payload.messages).toContainEqual(expect.objectContaining({
      role: "system", content: expect.stringContaining("No editor context is attached"),
    }));
    expect(result).toEqual({ message: "Hello", edit: null, citations: [] });
    fetchMock.mockRestore();
  });

  it.each(["```json\n", "```JSON\r\n", "```\n"])("holds a note conversation with a %s wrapper", async (fence) => {
    const gateway = new BrowserWorkspaceGateway();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        choices: [{
          message: {
            content:
              fence + '{"message":"Updated it.","edit":{"tool":"replace_selection","replacement":"  - revised\\n"}}\n```',
          },
        }],
      }),
    );

    await expect(
      gateway.chatWithNote(
        "demo://memoir",
        {
          enabled: true,
          provider: "openai",
          baseUrl: "https://api.example.com/v1/",
          apiKey: "secret",
          embeddingModel: "embedding",
          rerankingModel: "",
          chatModel: "chat-model",
          contextMaxLength: 32_000,
          embeddingMaxLength: 1_800,
        },
        [{ role: "user", content: "Polish it" }],
        {
          path: "notes/example.md",
          from: 2,
          to: 15,
          source: "  - original\n",
          scope: "selection",
        },
      ),
    ).resolves.toEqual({
      message: "Updated it.",
      edit: { tool: "replace_selection", replacement: "  - revised\n" },
      citations: [],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "chat-model",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Polish it" }),
      ]),
    });
    fetchMock.mockRestore();
  });

  it.each([
    '{"message":"Done","edit":{"tool":"replace_document","replacement":"unfinished',
    String.raw`{"message":"Done","edit":{"tool":"replace_document","replacement":"invalid \` escape"}}`,
    '{"message":"Done","edit":{"tool":"replace_selection","replacement":"wrong scope"}}',
    '{"message":"","edit":null}',
    '{"edit":null}',
  ])("rejects invalid editing envelopes instead of showing raw JSON: %s", async (content) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ choices: [{ message: { content } }] }),
    );
    try {
      await expect(new BrowserWorkspaceGateway().chatWithNote(
        "demo://memoir",
        { ...DEFAULT_SETTINGS.ai, enabled: true, baseUrl: "https://api.example.com/v1", chatModel: "chat" },
        [{ role: "user", content: "Polish it" }],
        { path: "note.md", from: 0, to: 4, source: "note", scope: "document" },
      )).rejects.toMatchObject({ code: "serialization" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("rejects editor content over the configured context length", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      await expect(new BrowserWorkspaceGateway().chatWithNote(
        "demo://memoir",
        { ...DEFAULT_SETTINGS.ai, enabled: true, contextMaxLength: 1_000 },
        [{ role: "user", content: "Summarize it" }],
        { path: "note.md", from: 0, to: 1_001, source: "字".repeat(1_001), scope: "document" },
      )).rejects.toMatchObject({ code: "io", message: expect.stringContaining("1000 characters") });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("streams a tool round and then validates the streamed edit", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const events: Array<{ stage: string; contentDelta?: string; reasoningDelta?: string }> = [];
    const stream = (deltas: object[], finish: string) => new Response(
      deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join("") +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(stream([
        { reasoning_content: "先检索。" },
        { tool_calls: [{ index: 0, id: "search-1", type: "function", function: { name: "search_notes", arguments: '{"query":"Two ' } }] },
        { tool_calls: [{ index: 0, function: { arguments: 'Sum"}' } }] },
      ], "tool_calls"))
      .mockResolvedValueOnce(stream([
        { content: '{"message":"**完成**","edit":' },
        { content: '{"tool":"replace_document","replacement":"# Revised"}}' },
      ], "stop"));
    try {
      await expect(gateway.chatWithNote(
        "demo://memoir",
        { ...DEFAULT_SETTINGS.ai, enabled: true, baseUrl: "https://api.example.com/v1", chatModel: "chat" },
        [{ role: "user", content: "Find Two Sum and revise" }],
        { path: "note.md", from: 0, to: 4, source: "note", scope: "document" },
        (event) => events.push(event),
      )).resolves.toEqual({
        message: "**完成**",
        edit: { tool: "replace_document", replacement: "# Revised" },
        citations: [
          { path: "LeetCode/two-sum.md", title: "Two Sum" },
          { path: "welcome.mdx", title: "Welcome to Memoir" },
        ],
      });
      const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      expect(second.stream).toBe(true);
      expect(second.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "assistant", reasoning_content: "先检索。" }),
        expect.objectContaining({ role: "tool", tool_call_id: "search-1" }),
      ]));
      expect(events.map((event) => event.stage)).toEqual(expect.arrayContaining(["reasoning", "preparingTool", "callingTool", "toolCompleted", "receiving", "validating", "completed"]));
    } finally { fetchMock.mockRestore(); }
  });

  it("runs the note search tool before returning a grounded answer", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const progress: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-search",
              type: "function",
              function: { name: "search_notes", arguments: '{"query":"Two Sum","limit":1}' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: '{"message":"Found it in [LeetCode/two-sum.md].","edit":null}' } }],
      }));

    await expect(gateway.chatWithNote(
      "demo://memoir",
      { ...DEFAULT_SETTINGS.ai, enabled: true, baseUrl: "https://api.example.com/v1", chatModel: "chat-model" },
      [{ role: "user", content: "Where is the Two Sum note?" }],
      { path: "welcome.mdx", from: 0, to: 1, source: "# Welcome", scope: "document" },
      (event) => progress.push(event.stage),
    )).resolves.toEqual({
      message: "Found it in [LeetCode/two-sum.md].",
      edit: null,
      citations: [{ path: "LeetCode/two-sum.md", title: "Two Sum" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.tools[0].function.name).toBe("search_notes");
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", tool_call_id: "call-search" }),
    ]));
    expect(progress).toEqual([
      "preparing",
      "callingModel",
      "callingTool",
      "toolCompleted",
      "generating",
      "validating",
      "completed",
    ]);
    fetchMock.mockRestore();
  });
});

const leakedEdit = '已添加。\n<|DSML|tool_calls>\n<|DSML|invoke name="replace_selection">\n<|DSML|parameter name="replacement" string="true">27. 原有记录\n28. 网易 笔试 [[网易笔试]]</|DSML|parameter>\n</|DSML|invoke>\n</|DSML|tool_calls>';
const selectionTarget = { path: "note.md", from: 5, to: 13, source: "27. 原有记录", scope: "selection" as const };

describe("AI tool markup recovery", () => {
  it.each([
    leakedEdit,
    leakedEdit.split("|").join("｜"),
    leakedEdit.split("|").join(" | "),
    JSON.stringify({ message: leakedEdit, edit: null }),
  ])("recovers a leaked edit as a validated proposal, not a claimed file write", async (content) => {
    const replacement = "27. 原有记录\n28. 网易 笔试 [[网易笔试]]";
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        message: "已准备修改，请审阅后应用。", edit: { tool: "replace_selection", replacement },
      }) } }] }));
    try {
      const gateway = new BrowserWorkspaceGateway();
      const progress = vi.fn();
      const result = await gateway.chatWithNote("demo://memoir", DEFAULT_SETTINGS.ai,
        [{ role: "user", content: "追加网易笔试记录" }], selectionTarget, progress);
      expect(result).toEqual({ message: "已准备修改，请审阅后应用。", edit: { tool: "replace_selection", replacement }, citations: [] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const repair = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      expect(repair.tools).toBeUndefined();
      expect(repair.messages.at(-1)).toMatchObject({ role: "system", content: expect.stringContaining("No edit was applied") });
      expect(repair.messages.at(-1).content).toContain('"tool":"replace_selection"');
      expect(repair.messages).toContainEqual({ role: "user", content: expect.stringContaining("27. 原有记录") });
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "generating" }));
    } finally { fetchMock.mockRestore(); }
  });

  it.each([
    leakedEdit,
    "已修改成功。",
    '{"message":"完成","edit":{"tool":"replace_document","replacement":"错误的范围"}}',
    '{"message":"完成","edit":{"tool":"replace_selection","replacement":"未完成',
  ])("stops after one failed repair and never returns raw tool markup", async (retry) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: leakedEdit } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: retry } }] }));
    try {
      await expect(new BrowserWorkspaceGateway().chatWithNote("demo://memoir", DEFAULT_SETTINGS.ai,
        [{ role: "user", content: "追加记录" }], selectionTarget)).rejects.toMatchObject({ code: "serialization" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { fetchMock.mockRestore(); }
  });

  it("allows tool markup as literal replacement source inside a valid envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ choices: [{ message: {
      content: JSON.stringify({ message: "文档示例待审阅。", edit: { tool: "replace_selection", replacement: leakedEdit } }),
    } }] }));
    try {
      const result = await new BrowserWorkspaceGateway().chatWithNote("demo://memoir", DEFAULT_SETTINGS.ai,
        [{ role: "user", content: "添加一个协议示例" }], selectionTarget);
      expect(result.edit?.replacement).toBe(leakedEdit);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  });

  it("keeps edits disabled during recovery without an attached note", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: leakedEdit } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        message: "请先引用笔记，当前没有修改。", edit: { tool: "replace_selection", replacement: "不能应用" },
      }) } }] }));
    try {
      const result = await new BrowserWorkspaceGateway().chatWithNote("demo://memoir", DEFAULT_SETTINGS.ai,
        [{ role: "user", content: "追加记录" }], null);
      expect(result.edit).toBeNull();
      const repair = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      expect(repair.messages.at(-1).content).toContain("Return edit: null");
    } finally { fetchMock.mockRestore(); }
  });
});
