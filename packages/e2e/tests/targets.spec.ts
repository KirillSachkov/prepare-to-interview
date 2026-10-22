// Preparation targets in the Control panel, «Новая цель», and the Candidate's own Question (ticket #5).
// Runs after canvas-shell.spec.ts, which expects a Canvas without targets or a chosen agent.
import type { Page } from "@playwright/test";
import { chooseAgent, expect, openCanvas, resetChatLayout, saveTarget, test } from "./fixtures.ts";

const chip = (page: Page) => page.getByRole("button", { name: "Цель подготовки" });
const topMenu = (page: Page) => page.getByRole("menu", { name: "Меню" });

/** A local calendar date `days` from today, as the server counts days left. */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test.beforeEach(async ({ page, baseURL }) => {
  await resetChatLayout(baseURL!);
  await openCanvas(page);
});

test("the chip shows the active target live and the menu switches between targets", async ({ page, baseURL }) => {
  await saveTarget(baseURL!, { role: "QA engineer", name: "QA", grade: "Middle" });
  await expect(chip(page)).toContainText("QA");
  await expect(chip(page)).toContainText("—");

  await saveTarget(baseURL!, { role: "Backend developer (Go)", name: "Go backend", grade: "Senior", interview_date: inDays(12) });
  await expect(chip(page)).toContainText("Go backend");
  await expect(chip(page)).toContainText("12 дн.");

  await page.getByRole("button", { name: "Меню" }).click();
  await expect(topMenu(page).getByRole("menuitem", { name: /Go backend · Senior/ })).toContainText("12 дн.");
  await topMenu(page).getByRole("menuitem", { name: /QA · Middle/ }).click();
  await expect(chip(page)).toContainText("QA");
  await expect(chip(page)).not.toContainText("дн.");

  // The active target is stored on the server.
  await page.reload();
  await expect(chip(page)).toContainText("QA");
});

test("«Новая цель» asks the Interviewer in the Chat", async ({ page, baseURL }) => {
  await chooseAgent(baseURL!);
  await page.reload();
  const chat = page.locator('.react-flow__node[data-id="chat"]');
  await page.getByRole("button", { name: "Меню" }).click();
  await topMenu(page).getByRole("menuitem", { name: "+ Новая цель" }).click();
  await expect(topMenu(page)).toHaveCount(0);
  await expect(chat).toContainText("Хочу добавить новую цель подготовки.");
});

test("the context menu adds the Candidate's own Question to the bank", async ({ page }) => {
  await page.mouse.click(1300, 760, { button: "right" });
  await page.locator('[role="menu"][data-menu-target="canvas"]').getByRole("menuitem", { name: "Вставить свой вопрос" }).click();
  const dialog = page.getByRole("dialog", { name: "Свой вопрос" });
  // Letters typed into the dialog never fire Canvas hotkeys.
  await dialog.getByLabel("Вопрос").fill("Как Kafka гарантирует порядок сообщений?");
  await dialog.getByLabel("Тема").fill("Kafka");
  await dialog.getByRole("button", { name: "Добавить в банк" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Вопрос добавлен в банк, тема «Kafka»");

  // The same Question again is refused, and the dialog stays open with the reason.
  await page.mouse.click(1300, 760, { button: "right" });
  await page.locator('[role="menu"][data-menu-target="canvas"]').getByRole("menuitem", { name: "Вставить свой вопрос" }).click();
  await dialog.getByLabel("Вопрос").fill("как kafka гарантирует порядок сообщений?");
  await dialog.getByLabel("Тема").fill("kafka");
  await dialog.getByRole("button", { name: "Добавить в банк" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Не удалось добавить вопрос");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
