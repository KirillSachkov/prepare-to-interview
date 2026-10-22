// The practice loop on Cards (ticket #6): answer in any order with drafts that survive reload,
// hints, submit with Cmd/Ctrl+Enter, live grades from the app and the Grader, the Chat summary,
// and the collapse into a result Card.
import type { Page } from "@playwright/test";
import { chooseAgent, expect, openCanvas, placePracticeSet, resetChatLayout, test } from "./fixtures.ts";

const chat = (page: Page) => page.locator('.react-flow__node[data-id="chat"]');
const practiceSet = (page: Page, title: string) => page.locator(".react-flow__node-practice_set").filter({ hasText: title });

const openCard = {
  topic: "RAG",
  prompt: "Как выбрать размер чанков для RAG?",
  type: "open",
  reference_answer: "Резать по смысловым границам, 300–800 токенов с перекрытием, проверять на метриках ретривера.",
  hints: ["Начните с границ смысла."],
};
const singleCard = {
  topic: "Evals",
  prompt: "Что считается галлюцинацией в RAG-ответе?",
  type: "single_choice",
  options: [
    { text: "Утверждение без опоры на документы", correct: true },
    { text: "Медленный ответ", correct: false },
  ],
};
const multiCard = {
  topic: "Evals",
  prompt: "Какие метрики подходят для оценки ретривера?",
  type: "multiple_choice",
  options: [
    { text: "Recall@k", correct: true },
    { text: "MRR", correct: true },
    { text: "BLEU", correct: false },
  ],
};

test.beforeEach(async ({ page, baseURL }) => {
  await chooseAgent(baseURL!);
  await resetChatLayout(baseURL!);
  await openCanvas(page);
});

test("answer → submit → grades → collapse into a result Card", async ({ page, baseURL }) => {
  await placePracticeSet(baseURL!, { title: "Подборка на сегодня", cards: [openCard, singleCard, multiCard] });
  const set = practiceSet(page, "Подборка на сегодня");
  await page.keyboard.press("Shift+Digit1");
  await expect(set).toContainText("отвечено 0 из 3");
  await expect(set.getByRole("button", { name: /Отправить/ })).toBeDisabled();
  const open = set.locator("[data-card-id]").filter({ hasText: openCard.prompt });
  const single = set.locator("[data-card-id]").filter({ hasText: singleCard.prompt });
  const multi = set.locator("[data-card-id]").filter({ hasText: multiCard.prompt });
  // The Reference answer stays hidden until an Attempt exists.
  await expect(set.getByRole("button", { name: "Показать эталон" })).toHaveCount(0);

  // A hint lowers the maximum score.
  await open.getByRole("button", { name: /Подсказка/ }).click();
  await expect(open).toContainText("Подсказка 1. Начните с границ смысла.");
  await expect(open).toContainText("С подсказками максимум 2/3");

  // Drafts survive a reload; letters typed into a Card never fire Canvas hotkeys.
  const answer = "Режу документы по заголовкам. Чанки примерно 500 токенов.";
  const saved = page.waitForResponse((r) => r.url().includes("/draft") && r.request().method() === "PUT");
  await open.getByLabel("Ваш ответ").fill(answer);
  await saved;
  await single.getByRole("radio", { name: "Утверждение без опоры на документы" }).click();
  await multi.getByRole("checkbox", { name: "Recall@k" }).click();
  await multi.getByRole("checkbox", { name: "BLEU" }).click();
  await expect(set).toContainText("отвечено 3 из 3");
  await page.reload();
  await page.keyboard.press("Shift+Digit1");
  await expect(open.getByLabel("Ваш ответ")).toHaveValue(answer);
  await expect(single.getByRole("radio", { name: "Утверждение без опоры на документы" })).toHaveAttribute("aria-checked", "true");
  await expect(multi.getByRole("checkbox", { name: "BLEU" })).toHaveAttribute("aria-checked", "true");

  // Cmd/Ctrl+Enter submits from inside a Card.
  await open.getByLabel("Ваш ответ").press("ControlOrMeta+Enter");

  // Tests are checked by the app; the open answer arrives from the Grader with its quote.
  await expect(single.getByLabel("Оценка 3 из 3")).toBeVisible();
  await expect(multi.getByLabel("Оценка 0 из 3")).toBeVisible();
  await expect(open.getByLabel("Оценка 2 из 3")).toBeVisible();
  await expect(open).toContainText("«Режу документы по заголовкам.»");
  await expect(open).toContainText("Не хватает проверки на метриках.");
  await expect(set).toContainText("итог 5/9");
  await open.getByRole("button", { name: "Показать эталон" }).click();
  await expect(open).toContainText(`Эталон: ${openCard.reference_answer}`);

  // The Chat receives a short summary.
  await expect(chat(page)).toContainText("Подборка проверена: «Подборка на сегодня» — 5 из 9.");

  // The graded set collapses into a result Card, also after reload.
  await set.getByRole("button", { name: "Свернуть в итог" }).click();
  await expect(set).toContainText("итог 5/9");
  await expect(set.locator("[data-card-id]")).toHaveCount(0);
  await page.reload();
  await expect(practiceSet(page, "Подборка на сегодня").getByRole("button", { name: "Развернуть" })).toBeVisible();
});

test("skip, training mode, and «Обсудить» bring a Card into the Chat", async ({ page, baseURL }) => {
  await placePracticeSet(baseURL!, { title: "Тренировка", cards: [singleCard, multiCard] });
  const set = practiceSet(page, "Тренировка");
  await page.keyboard.press("Shift+Digit1");
  const single = set.locator("[data-card-id]").filter({ hasText: singleCard.prompt });
  const multi = set.locator("[data-card-id]").filter({ hasText: multiCard.prompt });

  // Skipped is a status, not a score of 0.
  await multi.getByRole("button", { name: "Пропустить" }).click();
  await expect(multi).toContainText("Пропущено");
  await expect(multi.getByLabel(/Оценка/)).toHaveCount(0);

  // In training mode each Card is checked right away.
  await set.getByLabel("Оценка сразу").click();
  await expect(set.getByLabel("Оценка сразу")).toBeChecked();
  await single.getByRole("radio", { name: "Медленный ответ" }).click();
  await single.getByRole("button", { name: "Проверить" }).click();
  await expect(single.getByLabel("Оценка 0 из 3")).toBeVisible();
  await expect(set).toContainText("итог 0/3");

  await single.getByRole("button", { name: "Обсудить →" }).click();
  await expect(chat(page)).toContainText("Обсудим эту карточку.");
  await expect(chat(page).getByRole("button", { name: `↗ ${singleCard.prompt}` })).toBeVisible();
});

test("the toolbar asks the Interviewer for today's Practice set", async ({ page }) => {
  await page.getByRole("toolbar", { name: "Панель инструментов" }).getByRole("button", { name: "Подборка на сегодня" }).click();
  await expect(chat(page)).toContainText("Хочу подборку на сегодня.");
});
