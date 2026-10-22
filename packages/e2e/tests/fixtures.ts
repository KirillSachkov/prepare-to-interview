// Shared e2e fixtures: an authenticated Canvas page and agent-side actions through the fake driver.
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { FakeDriver, type FakeTurn } from "@prepare-to-interview/server/agent/fake-driver";
import {
  apiPaths,
  chatNodeId,
  practiceSetPaths,
  tokenQueryParam,
  type CanvasSnapshot,
  type LayoutUpdateRequest,
} from "@prepare-to-interview/shared";
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

/**
 * Places a Practice set as the Interviewer does; an unsubmitted set left by an earlier test is
 * dropped, since tests share one Canvas.
 */
export const placePracticeSet = (baseURL: string, set: Record<string, unknown>) =>
  agentTurn(baseURL, [
    { callTool: { server: "interview", tool: "place_practice_set", arguments: { replace_unfinished: true, ...set } } },
  ]);

/** A Quiz of one test Card, the smallest node to place on the Canvas. */
export const placeQuiz = (baseURL: string, title: string) =>
  placePracticeSet(baseURL, {
    title,
    kind: "quiz",
    cards: [
      {
        topic: "SQL",
        prompt: `${title}: какой индекс PostgreSQL создаёт по умолчанию?`,
        type: "single_choice",
        options: [
          { text: "B-tree", correct: true },
          { text: "Hash", correct: false },
        ],
      },
    ],
  });

/** Creates a Preparation target through the MCP tool, as the Interviewer does in onboarding. */
export const saveTarget = (baseURL: string, target: Record<string, unknown>) =>
  agentTurn(baseURL, [{ callTool: { server: "interview", tool: "save_target", arguments: target } }]);

/** Picks the agent as the Candidate does in settings; the e2e server answers with the fake driver. */
export async function chooseAgent(baseURL: string): Promise<void> {
  const res = await fetch(new URL(apiPaths.agentSettings, baseURL), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "claude" }),
  });
  expect(res.status).toBe(200);
}

/** Opens the tokenized URL the way the Candidate does and waits for the Canvas. */
export async function openCanvas(page: Page): Promise<void> {
  await page.goto(`/?${tokenQueryParam}=${token()}`);
  await expect(page.getByRole("toolbar", { name: "Панель инструментов" })).toBeVisible();
  const chat = page.locator('.react-flow__node[data-id="chat"]');
  await expect(chat).toBeVisible();
  // The Chat settles on its agent settings (no agent chosen) or its thread; until then its composer may hold focus.
  if (!(await chat.textContent())?.includes("развернуть")) await expect(chat).toContainText(/Агент для программирования|на Claude Code/);
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

/** Submits Practice sets earlier tests left unsubmitted, since tests share one Canvas. */
export async function submitUnfinishedSets(baseURL: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token()}` };
  const snapshot = (await (await fetch(new URL(apiPaths.canvas, baseURL), { headers })).json()) as CanvasSnapshot;
  for (const node of snapshot.nodes) {
    if (node.kind !== "practice_set" || node.data.mode !== "training" || node.data.status !== "active") continue;
    const res = await fetch(new URL(practiceSetPaths.submit(node.id), baseURL), { method: "POST", headers });
    expect(res.status).toBe(202);
  }
}

export { expect, test } from "@playwright/test";
