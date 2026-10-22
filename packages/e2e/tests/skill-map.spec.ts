// The Skill map, Topic detail, and the Proposed queue (ticket #7): Mastery rings and untouched
// Topics, readiness, «Потренировать», Attempt history with Reference answer editing, and batch
// approval of Research output with the toolbar B badge.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FakeDriver } from "@prepare-to-interview/server/agent/fake-driver";
import { apiPaths, cardPaths, practiceSetPaths } from "@prepare-to-interview/shared";
import { e2eEnv } from "../env.ts";
import { chooseAgent, expect, openCanvas, resetChatLayout, saveTarget, test } from "./fixtures.ts";

const token = () => fs.readFileSync(path.join(e2eEnv().dataDir, "token"), "utf8").trim();

/** Calls one MCP tool as the Interviewer does and returns its structured output. */
async function agentCall(baseURL: string, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let output: unknown;
  const driver = new FakeDriver([[{ callTool: { server: "interview", tool, arguments: args } }]]);
  const session = await driver.startSession({
    persona: "e2e",
    allowedBuiltins: [],
    mcpServers: [{ type: "http", name: "interview", url: new URL(apiPaths.mcp, baseURL).href, headers: [{ name: "Authorization", value: `Bearer ${token()}` }] }],
  });
  await session.prompt({ text: "e2e" }, (event) => {
    if (event.type === "tool_call_update") output = event.rawOutput;
  });
  await session.close();
  return output as Record<string, unknown>;
}

async function rest(baseURL: string, route: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(new URL(route, baseURL), {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  expect(res.ok).toBe(true);
}

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Панель инструментов" });
const skillMap = (page: Page) => page.getByRole("region", { name: "Карта навыков" });

test.beforeEach(async ({ baseURL }) => {
  await chooseAgent(baseURL!);
  await resetChatLayout(baseURL!);
});

test("Skill map shows Mastery, untouched Topics, and readiness; a Topic shows its history and edits its Reference answer", async ({ page, baseURL }) => {
  await saveTarget(baseURL!, {
    role: "Frontend developer",
    name: "Frontend React",
    topics: [
      { name: "React hooks", priority: "high", group: "React" },
      { name: "Браузерный рендеринг", priority: "medium" },
    ],
  });
  // One graded Quiz in «React hooks»: 3 of 3.
  const placed = await agentCall(baseURL!, "place_practice_set", {
    title: "Хуки",
    kind: "quiz",
    replace_unfinished: true,
    cards: [
      {
        topic: "React hooks",
        prompt: "Когда срабатывает cleanup у useEffect?",
        type: "single_choice",
        options: [
          { text: "Перед следующим эффектом и при размонтировании", correct: true },
          { text: "Только при первом рендере", correct: false },
        ],
      },
    ],
  });
  const cardId = (placed.cards as { card_id: string }[])[0]!.card_id;
  await rest(baseURL!, cardPaths.draft(cardId), "PUT", { choices: [0] });
  await rest(baseURL!, practiceSetPaths.submit(placed.practice_set_id as string), "POST");

  await openCanvas(page);
  await page.keyboard.press("k");
  const map = skillMap(page);
  await expect(map.getByRole("heading", { name: "Карта навыков" })).toBeVisible();
  await expect(map.getByLabel("Готовность")).toContainText("Frontend React · готовность 60%");
  const hooks = map.getByRole("article", { name: "React hooks" });
  await expect(hooks.getByRole("img", { name: "Освоение 100%" })).toBeVisible();
  await expect(hooks).toContainText("уверенно");
  const rendering = map.getByRole("article", { name: "Браузерный рендеринг" });
  await expect(rendering.getByRole("img", { name: "Освоение: не начата" })).toBeVisible();
  await expect(rendering).toContainText("не начата");
  await expect(map.getByRole("region", { name: "React" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Карта навыков" })).toHaveAttribute("aria-pressed", "true");

  // Topic detail: the Attempt history and the Reference answer.
  await hooks.getByRole("button", { name: /React hooks/ }).click();
  const question = map.getByRole("article", { name: "Когда срабатывает cleanup у useEffect?" });
  await expect(question.getByRole("region", { name: "История попыток" })).toContainText("тренировка");
  await expect(question.getByRole("region", { name: "История попыток" })).toContainText("3/3");
  await expect(question).toContainText("черновик");
  await question.getByRole("button", { name: "Изменить" }).click();
  await question.getByLabel("Эталонный ответ").fill("Cleanup вызывается перед повторным запуском эффекта и при размонтировании.");
  await question.getByRole("button", { name: "Сохранить" }).click();
  await expect(question).toContainText("Cleanup вызывается перед повторным запуском эффекта");
  await question.getByRole("button", { name: "Отметить эталон проверенным" }).click();
  await expect(question.getByRole("button", { name: "Снять отметку «проверен»" })).toBeVisible();
  await page.reload();
  await page.keyboard.press("k");
  await skillMap(page).getByRole("article", { name: "React hooks" }).getByRole("button", { name: /React hooks/ }).click();
  await expect(skillMap(page).getByRole("article", { name: "Когда срабатывает cleanup у useEffect?" }).getByRole("button", { name: "Снять отметку «проверен»" })).toBeVisible();

  // «Потренировать» goes back to the Canvas and asks the Interviewer.
  await skillMap(page).getByRole("button", { name: "← Все темы" }).click();
  await skillMap(page).getByRole("article", { name: "Браузерный рендеринг" }).getByRole("button", { name: "Потренировать" }).click();
  await expect(skillMap(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="chat"]')).toContainText("Хочу подборку по теме «Браузерный рендеринг».");
});

test("Research output waits in «Предложено» with its Sources and is approved or rejected in batches", async ({ page, baseURL }) => {
  await saveTarget(baseURL!, { role: "QA engineer", name: "QA Auto", topics: [{ name: "Тест-дизайн", priority: "high" }] });
  const archived = await agentCall(baseURL!, "archive_source", {
    kind: "question_list",
    url: "https://habr.com/ru/articles/qa-questions/",
    title: "Вопросы на собеседовании QA",
    content: "Классы эквивалентности, граничные значения, pairwise; Playwright и локаторы.",
  });
  const sourceId = (archived.source as { source_id: string }).source_id;
  const proposal = await agentCall(baseURL!, "propose_questions", {
    topics: [{ name: "Playwright", priority: "medium", reason: "Есть в 5 из 8 вакансий", source_ids: [sourceId] }],
    questions: [
      { topic: "Тест-дизайн", prompt: "Что такое классы эквивалентности?", reference_answer: "Группы входных данных, которые система обрабатывает одинаково.", source_ids: [sourceId] },
      { topic: "Тест-дизайн", prompt: "Зачем нужен анализ граничных значений?", reference_answer: "Ошибки чаще на границах диапазонов.", source_ids: [sourceId] },
      { topic: "Playwright", prompt: "Чем локатор Playwright отличается от селектора?", reference_answer: "Локатор ленивый и сам ждёт элемент.", source_ids: [sourceId] },
    ],
  });
  expect((proposal.questions as unknown[]).length).toBe(3);

  await openCanvas(page);
  const bank = toolbar(page).getByRole("button", { name: "Банк / Предложено" });
  await expect(bank).toContainText("4");
  await bank.click();
  const proposed = skillMap(page).getByLabel("Предложено", { exact: true });
  await expect(skillMap(page).getByRole("tab", { name: /Предложено/ })).toHaveAttribute("aria-selected", "true");
  const playwright = proposed.getByRole("listitem", { name: "Playwright", exact: true });
  await expect(playwright).toContainText("Новая тема");
  await expect(playwright).toContainText("Есть в 5 из 8 вакансий");
  await expect(proposed.getByRole("listitem", { name: "Что такое классы эквивалентности?" })).toContainText("habr.com: Вопросы на собеседовании QA");

  // One Question approved, one rejected, then the rest of the batch at once.
  await proposed.getByRole("listitem", { name: "Что такое классы эквивалентности?" }).getByRole("button", { name: "Одобрить" }).click();
  await proposed.getByRole("listitem", { name: "Зачем нужен анализ граничных значений?" }).getByRole("button", { name: "Нет" }).click();
  await expect(bank).toContainText("2");
  await proposed.getByRole("button", { name: "Одобрить пакет" }).click();
  await expect(proposed).toContainText("Очередь пуста.");
  await expect(bank.locator("span").filter({ hasText: /^\d+$/ })).toHaveCount(0);

  // Approved Topics join the Skill map; approved Questions are in the bank, the rejected one is not.
  await expect(skillMap(page).getByRole("article", { name: "Playwright" })).toBeVisible();
  await skillMap(page).getByRole("tab", { name: "Банк вопросов" }).click();
  const bankPanel = skillMap(page).getByLabel("Банк вопросов", { exact: true });
  await bankPanel.getByLabel("Найти в банке").fill("эквивалентности");
  await expect(bankPanel).toContainText("Что такое классы эквивалентности?");
  await bankPanel.getByLabel("Найти в банке").fill("граничных");
  await expect(bankPanel).toContainText("Ничего не нашлось.");

  // Letters typed into a field never fire hotkeys; outside it, K returns to the Canvas.
  await page.keyboard.press("k");
  await expect(bankPanel.getByLabel("Найти в банке")).toHaveValue("граничныхk");
  await bankPanel.getByLabel("Найти в банке").blur();
  await page.keyboard.press("k");
  await expect(skillMap(page)).toHaveCount(0);
});

test("the toolbar asks the Interviewer for Research", async ({ page }) => {
  await openCanvas(page);
  await toolbar(page).getByRole("button", { name: "Исследовать" }).click();
  await expect(page.locator('.react-flow__node[data-id="chat"]')).toContainText("Хочу, чтобы ты исследовал темы и вопросы для моей цели подготовки.");
});
