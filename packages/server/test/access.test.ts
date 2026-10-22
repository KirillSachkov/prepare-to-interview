import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { apiPaths, bankPaths } from "@prepare-to-interview/shared";
import type { AgentDriver, SessionConfig } from "../src/agent/driver.ts";
import { FakeDriver } from "../src/agent/fake-driver.ts";
import { resolveDataDir } from "../src/config.ts";
import type { RunningServer } from "../src/server.ts";
import { authHeaders, makeTempDirs, startTestServer, testIndexHtml } from "./helpers.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function start(dirs = makeTempDirs()) {
  const { server } = await startTestServer(dirs);
  cleanups.push(() => server.close());
  return server;
}

function rawGet(server: RunningServer, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: server.port, path: apiPaths.canvas, headers },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("access to the app server", () => {
  it("listens only on the loopback address and prints a tokenized URL", async () => {
    const server = await start();
    const url = new URL(server.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.searchParams.get("token")).toBe(server.token);
    expect(server.token.length).toBeGreaterThanOrEqual(32);
    // Nothing answers on another local interface address, only on loopback.
    const lanAddress = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    if (lanAddress) {
      const refused = await fetch(`http://${lanAddress}:${server.port}/`, { signal: AbortSignal.timeout(2000) }).catch(
        (error: unknown) => (error as { cause?: { code?: string } }).cause?.code,
      );
      expect(refused).toBe("ECONNREFUSED");
    }
  });

  it("rejects requests without the token", async () => {
    const server = await start();
    const origin = new URL(server.url).origin;
    expect((await fetch(origin + apiPaths.canvas)).status).toBe(401);
    expect((await fetch(origin + "/")).status).toBe(401);
    const wrong = await fetch(origin + apiPaths.canvas, { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    const mcp = await fetch(origin + apiPaths.mcp, { method: "POST", body: "{}" });
    expect(mcp.status).toBe(401);
  });

  it("accepts the token as a bearer header", async () => {
    const server = await start();
    const res = await fetch(new URL(apiPaths.canvas, server.url), { headers: authHeaders(server) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nodes: [{ kind: "chat" }] });
  });

  it("exchanges the URL token for a cookie and then serves the Canvas page", async () => {
    const server = await start();
    const first = await fetch(server.url, { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    const cookie = first.headers.get("set-cookie") ?? "";
    // Cookies ignore the port: another instance on another port keeps its own cookie.
    expect(cookie.startsWith(`pti_token_${server.port}=`)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const page = await fetch(new URL("/", server.url), {
      headers: { Cookie: cookie.split(";")[0] ?? "" },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(testIndexHtml);
  });

  it("rejects browser requests from a foreign origin", async () => {
    const server = await start();
    const origin = new URL(server.url).origin;
    const fromOrigin = (value: string) =>
      fetch(origin + apiPaths.canvas, { headers: { ...authHeaders(server), Origin: value } });
    expect((await fromOrigin(origin)).status).toBe(200);
    expect((await fromOrigin("http://evil.example")).status).toBe(403);
  });

  it("rejects requests addressed to a foreign host name", async () => {
    const server = await start();
    expect(await rawGet(server, { ...authHeaders(server), Host: `127.0.0.1:${server.port}` })).toBe(200);
    expect(await rawGet(server, { ...authHeaders(server), Host: `evil.example:${server.port}` })).toBe(403);
  });

  it("generates the token on first start and keeps it across restarts", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    const first = await start(dirs);
    const token = first.token;
    await first.close();
    expect(fs.readFileSync(path.join(dirs.dataDir, "token"), "utf8").trim()).toBe(token);
    const second = await start(dirs);
    expect(second.token).toBe(token);
  });
});

describe("MCP roles", () => {
  it("gives each Agent session role its own token and derives the role from it, not from a header", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    let driver: FakeDriver | undefined;
    const { server } = await startTestServer(dirs, {
      drivers: (): AgentDriver => (driver ??= new FakeDriver([[{ event: { type: "message_chunk", text: "Привет." } }]])),
      detectAgents: () => [{ id: "claude", label: "Claude Code", installed: true, detail: "/bin/claude" }],
    });
    cleanups.push(() => server.close());
    const rest = (p: string, init: RequestInit = {}) => fetch(new URL(p, server.url), init);
    const json = { ...authHeaders(server), "Content-Type": "application/json" };
    await rest(apiPaths.agentSettings, { method: "PUT", headers: json, body: JSON.stringify({ agent: "claude" }) });
    await rest(apiPaths.chatMessages, { method: "POST", headers: json, body: JSON.stringify({ text: "Привет" }) });
    await expect.poll(() => driver?.sessions.length).toBe(1);
    const chatConfig: SessionConfig = driver!.sessions[0]!.config;
    const chatServer = chatConfig.mcpServers[0]!;
    const chatToken = chatServer.headers.find((h) => h.name === "Authorization")!.value;
    expect(chatToken).not.toBe(`Bearer ${server.token}`);
    expect(chatServer.headers.map((h) => h.name)).toEqual(["Authorization"]);

    // The Chat's token reaches the Chat's MCP tools and acts as the Chat; it opens nothing else.
    const connect = async (url: string, headers: Record<string, string>) => {
      const client = new Client({ name: "probe", version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
      cleanups.push(() => client.close());
      return client;
    };
    const asChat = await connect(chatServer.url, { Authorization: chatToken });
    const ended = await asChat.callTool({ name: "end_session", arguments: { summary: "Probe." } });
    expect((ended.content as { text: string }[])[0]!.text).not.toMatch(/Only the Chat's Agent session/);
    expect((await rest(apiPaths.canvas, { headers: { Authorization: chatToken } })).status).toBe(401);
    expect((await rest(bankPaths.researchMcp, { method: "POST", headers: { Authorization: chatToken }, body: "{}" })).status).toBe(401);

    // The app token with the old marker header is not the Chat.
    const spoofed = await connect(server.mcpServer.url, { ...authHeaders(server), "X-Interview-Caller": "chat" });
    const refused = await spoofed.callTool({ name: "end_session", arguments: { summary: "Spoofed." } });
    expect((refused.content as { text: string }[])[0]!.text).toMatch(/^Only the Chat's Agent session can end itself\./);
  });
});

describe("data directory", () => {
  it("replaces an empty token file left behind by a crash", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    fs.mkdirSync(dirs.dataDir, { recursive: true });
    fs.writeFileSync(path.join(dirs.dataDir, "token"), "");
    const server = await start(dirs);
    expect(server.token.length).toBeGreaterThanOrEqual(32);
    expect(fs.readFileSync(path.join(dirs.dataDir, "token"), "utf8").trim()).toBe(server.token);
    expect(fs.readdirSync(dirs.dataDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the data directory and the database files private, also when they already exist", async () => {
    const dirs = makeTempDirs();
    cleanups.push(dirs.cleanup);
    fs.mkdirSync(dirs.dataDir, { recursive: true, mode: 0o755 });
    fs.chmodSync(dirs.dataDir, 0o755);
    fs.writeFileSync(path.join(dirs.dataDir, "app.db"), "", { mode: 0o644 });
    fs.chmodSync(path.join(dirs.dataDir, "app.db"), 0o644);
    const server = await start(dirs);
    await fetch(new URL(apiPaths.canvas, server.url), { headers: authHeaders(server) });
    const mode = (file: string) => fs.statSync(path.join(dirs.dataDir, file)).mode & 0o777;
    expect(mode(".")).toBe(0o700);
    for (const file of ["app.db", "app.db-wal", "app.db-shm"]) expect([file, mode(file)]).toEqual([file, 0o600]);
  });

  it("defaults to ~/.prepare-to-interview", () => {
    expect(resolveDataDir({})).toBe(path.join(os.homedir(), ".prepare-to-interview"));
  });

  it("follows the PREPARE_TO_INTERVIEW_HOME override", () => {
    expect(resolveDataDir({ PREPARE_TO_INTERVIEW_HOME: "/tmp/pti-elsewhere" })).toBe("/tmp/pti-elsewhere");
  });
});
