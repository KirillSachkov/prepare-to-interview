// Continuity on the Canvas (ticket #9): the review after a graded set proposes Candidate profile and Decision log updates the
// Candidate confirms in the Chat, and older result Cards move to history, reachable from the
// Control panel menu and the toolbar's «Ещё» menu.
import type { Page } from "@playwright/test";
import { apiPaths, cardPaths, practiceSetPaths, type CanvasSnapshot } from "@prepare-to-interview/shared";
import { apiCall, chooseAgent, expect, openCanvas, placeQuiz, resetChatLayout, test } from "./fixtures.ts";

const chat = (page: Page) => page.locator('.react-flow__node[data-id="chat"]');

/** Answers every Card of the Quiz with its first option and submits it, as the Candidate does on the Cards. */
async function answerQuiz(baseURL: string, title: string): Promise<void> {
  const canvas = (await apiCall(baseURL, apiPaths.canvas)) as CanvasSnapshot;
  const set = canvas.nodes.find((n) => n.kind === "practice_set" && n.data.title === title);
  if (set?.kind !== "practice_set") throw new Error(`No Quiz "${title}" on the Canvas`);
  for (const card of set.data.cards) await apiCall(baseURL, cardPaths.draft(card.id), { method: "PUT", body: { choices: [0] } });
  await apiCall(baseURL, practiceSetPaths.submit(set.id), { method: "POST" });
}

test.beforeEach(async ({ page, baseURL }) => {
  await chooseAgent(baseURL!);
  await resetChatLayout(baseURL!);
  await openCanvas(page);
});

test("the review proposes Candidate profile and Decision log updates that are saved only on confirmation", async ({ page, baseURL }) => {
  await placeQuiz(baseURL!, "e2e-review квиз");
  await answerQuiz(baseURL!, "e2e-review квиз");
  await expect(chat(page)).toContainText("Квиз проверен: «e2e-review квиз»");
  await expect(chat(page)).toContainText("Сильная сторона — тесты.");
  const proposal = chat(page).getByLabel("Предложение запомнить");
  await expect(proposal).toContainText("Слабые места: Метрики ретривера");
  await expect(proposal).toContainText("Решение: Фокус на оценке ретривера");
  await proposal.getByRole("button", { name: "Сохранить" }).click();
  await expect(proposal).toContainText("Сохранено");
  await expect(proposal.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
});

test("older result Cards move to history, reachable from the menu and «Ещё»", async ({ page, baseURL }) => {
  for (const title of ["История: первый", "История: второй"]) {
    await placeQuiz(baseURL!, title);
    await answerQuiz(baseURL!, title);
  }
  await placeQuiz(baseURL!, "История: третий");
  // Off-screen nodes are not rendered: fit all until the live Canvas shows the latest result Card.
  const sets = page.locator(".react-flow__node-practice_set");
  await expect(async () => {
    await page.keyboard.press("Shift+Digit1");
    await expect(sets.filter({ hasText: "История: второй" })).toContainText("уйдёт в историю сам", { timeout: 1000 });
    await expect(sets.filter({ hasText: "История: третий" })).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  await expect(sets.filter({ hasText: "История: первый" })).toHaveCount(0);

  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("menu", { name: "Меню" }).getByRole("menuitem", { name: "История" }).click();
  const dialog = page.getByRole("dialog", { name: "История" });
  const first = dialog.getByRole("region", { name: "История: первый" });
  await expect(first).toContainText("3/3");
  await first.getByRole("button", { name: /История: первый/ }).click();
  await expect(first).toContainText("какой индекс PostgreSQL создаёт по умолчанию?");
  await expect(first).toContainText("3 из 3");
  await dialog.getByRole("button", { name: "Закрыть" }).click();

  await page.getByRole("toolbar", { name: "Панель инструментов" }).getByRole("button", { name: "Ещё" }).click();
  const more = page.getByRole("menu", { name: "Ещё" });
  await expect(more).toContainText(/История · \d+/);
  await more.getByRole("menuitem", { name: "Вся история…" }).click();
  await expect(page.getByRole("dialog", { name: "История" })).toBeVisible();
});
