import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apiPaths } from "@prepare-to-interview/shared";
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
    expect(await res.json()).toEqual({ nodes: [] });
  });

  it("exchanges the URL token for a cookie and then serves the Canvas page", async () => {
    const server = await start();
    const first = await fetch(server.url, { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const page = await fetch(new URL("/", server.url), {
      headers: { Cookie: cookie.split(";")[0] ?? "" },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(testIndexHtml);
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

describe("data directory", () => {
  it("defaults to ~/.prepare-to-interview", () => {
    expect(resolveDataDir({})).toBe(path.join(os.homedir(), ".prepare-to-interview"));
  });

  it("follows the PREPARE_TO_INTERVIEW_HOME override", () => {
    expect(resolveDataDir({ PREPARE_TO_INTERVIEW_HOME: "/tmp/pti-elsewhere" })).toBe("/tmp/pti-elsewhere");
  });
});
