// Shared e2e fixtures: an authenticated Canvas page and agent-side actions through the fake driver.
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { FakeDriver, type FakeTurn } from "@prepare-to-interview/server/agent/fake-driver";
import { apiPaths, chatNodeId, tokenQueryParam, type LayoutUpdateRequest } from "@prepare-to-interview/shared";
import { e2eEnv } from "../env.ts";

function token(): string {
  return fs.readFileSync(path.join(e2eEnv().dataDir, "token"), "utf8").trim();
}

/** Plays one scripted agent turn against the app's MCP server, as a real Interviewer would. */
export async function agentTurn(baseURL: string, turn: FakeTurn): Promise<void> {
  const driver = new FakeDriver([turn]);
  const session = await driver.startSession({
    persona: "e2e",
    allowedBuiltins: [],
    mcpServers: [
      {
        type: "http",
        name: "interview",
        url: new URL(apiPaths.mcp, baseURL).href,
        headers: [{ name: "Authorization", value: `Bearer ${token()}` }],
      },
    ],
  });
  await session.prompt({ text: "e2e" }, () => undefined);
  await session.close();
}

export const placeNote = (baseURL: string, title: string) =>
  agentTurn(baseURL, [{ callTool: { server: "interview", tool: "demo_place_note", arguments: { title } } }]);

/** Opens the tokenized URL the way the Candidate does and waits for the Canvas. */
export async function openCanvas(page: Page): Promise<void> {
  await page.goto(`/?${tokenQueryParam}=${token()}`);
  await expect(page.getByRole("toolbar", { name: "Панель инструментов" })).toBeVisible();
  const chat = page.locator('.react-flow__node[data-id="chat"]');
  await expect(chat).toBeVisible();
  // With no agent chosen the Chat settles on its agent settings; until then its composer may hold focus.
  if (!(await chat.textContent())?.includes("развернуть")) await expect(chat).toContainText("Агент для программирования");
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

/** Puts the Chat back where a fresh Canvas has it, so tests do not depend on each other's drags. */
export async function resetChatLayout(baseURL: string): Promise<void> {
  const body: LayoutUpdateRequest = {
    updates: [{ nodeId: chatNodeId, position: { x: -460, y: 0 }, collapsed: false }],
  };
  const res = await fetch(new URL(apiPaths.canvasLayout, baseURL), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}

export { expect, test } from "@playwright/test";
