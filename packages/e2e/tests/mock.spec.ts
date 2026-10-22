// The Mock interview on the Canvas (ticket #8): start with duration and focus, Cards one at a time
// with a follow-up that quotes the answer, a visible timer, no grades until the end, then the
// Grader's scores and feedback on the Cards.
import type { Page } from "@playwright/test";
import { agentTurn, chooseAgent, expect, openCanvas, resetChatLayout, submitUnfinishedSets, test } from "./fixtures.ts";

const chat = (page: Page) => page.locator('.react-flow__node[data-id="chat"]');
const mockNode = (page: Page) => page.locator(".react-flow__node-practice_set").filter({ hasText: "Мок-интервью" });

/** Fits the whole Canvas into view, from wherever focus is. */
async function fitAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Shift+Digit1");
}

const nextQuestion = (baseURL: string, args: Record<string, unknown>) =>
  agentTurn(baseURL, [{ callTool: { server: "interview", tool: "next_mock_question", arguments: args } }]);

const first = {
  topic: "RAG",
  prompt: "Нужен ассистент по базе знаний на 50 тысяч страниц. С чего начнёте?",
  type: "open",
  reference_answer: "Уточнить требования и метрики, затем RAG: чанкинг, гибридный поиск, реранкинг, ответ с цитатами.",
};
const followUp = {
  topic: "RAG",
  prompt: "Вы упомянули поиск. Как поймёте, что ретривер работает достаточно хорошо?",
  type: "open",
  reference_answer: "Золотой набор вопросов, Recall@k и MRR.",
};
const test3 = {
  topic: "Evals",
  prompt: "Какая метрика оценивает ретривер?",
  type: "single_choice",
  options: [
    { text: "Recall@k", correct: true },
    { text: "BLEU", correct: false },
  ],
};

test.beforeEach(async ({ page, baseURL }) => {
  await chooseAgent(baseURL!);
  await resetChatLayout(baseURL!);
  // A Mock interview does not start over an unsubmitted Practice set.
  await submitUnfinishedSets(baseURL!);
  await openCanvas(page);
});

test("mock turns with a follow-up, a timer, hidden grades, then the Grader's results", async ({ page, baseURL }) => {
  // M opens the start dialog: duration and focus.
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog", { name: "Мок-интервью" });
  await dialog.getByRole("radio", { name: "15 мин" }).click();
  await dialog.getByRole("radio", { name: "Слабые места" }).click();
  await dialog.getByRole("button", { name: "Начать" }).click();
  await expect(chat(page)).toContainText("Хочу мок-интервью на 15 минут, фокус — слабые места.");
  const mock = mockNode(page);
  // The new node may reach the live Canvas after the first fit; off-screen nodes are not rendered.
  await expect(async () => {
    await fitAll(page);
    await expect(mock).toContainText("вопрос 0 · оценки в конце", { timeout: 1000 });
  }).toPass();
  await expect(mock.getByRole("timer")).toHaveAccessibleName(/^Осталось 1[45]:\d\d$/);

  // Turn 1: the Interviewer places the first Card; the Candidate answers with Cmd/Ctrl+Enter.
  await nextQuestion(baseURL!, { question: first });
  await fitAll(page);
  const card1 = mock.locator("[data-card-id]").filter({ hasText: first.prompt });
  await expect(mock).toContainText("вопрос 1 · оценки в конце");
  await expect(card1).toContainText("оценка в конце");
  const answer1 = "Начну с требований и метрик. Потом поиск по чанкам с цитатами.";
  await card1.getByLabel("Ваш ответ").fill(answer1);
  await card1.getByLabel("Ваш ответ").press("ControlOrMeta+Enter");
  await expect(card1).toContainText("ответ принят");
  await expect(card1.getByLabel("Ваш ответ")).toBeDisabled();
  await expect(chat(page)).toContainText("Мой ответ — на карточке.");

  // Turn 2: a follow-up linked to the first Card, quoting the answer.
  const card1Id = await card1.getAttribute("data-card-id");
  await nextQuestion(baseURL!, { question: followUp, follow_up_of: card1Id, quote: "поиск по чанкам с цитатами" });
  await fitAll(page);
  const card2 = mock.locator("[data-card-id]").filter({ hasText: followUp.prompt });
  await expect(card2).toContainText("Вы сказали: «поиск по чанкам с цитатами»");
  await expect(mock).toContainText("уточнение");
  await card2.getByLabel("Ваш ответ").fill("Соберу золотой набор вопросов. Посчитаю Recall@k.");
  await card2.getByRole("button", { name: /Ответить/ }).click();
  await expect(card2).toContainText("ответ принят");

  // Turn 3: a test Card. No grades are shown during the mock.
  await nextQuestion(baseURL!, { question: test3 });
  await fitAll(page);
  const card3 = mock.locator("[data-card-id]").filter({ hasText: test3.prompt });
  await card3.getByRole("radio", { name: "Recall@k" }).click();
  await card3.getByRole("button", { name: /Ответить/ }).click();
  await expect(card3).toContainText("ответ принят");
  await expect(mock.getByLabel(/Оценка/)).toHaveCount(0);
  await expect(mock.getByRole("button", { name: "Обсудить →" })).toHaveCount(0);

  // Ending early: the Grader grades every answer and the results appear on the Cards.
  await fitAll(page);
  await mock.getByRole("button", { name: "Завершить" }).click();
  await expect(mock).toContainText("итог 7/9");
  await expect(card1.getByLabel("Оценка 2 из 3")).toBeVisible();
  await expect(card1).toContainText("«Начну с требований и метрик.»");
  await expect(card2.getByLabel("Оценка 2 из 3")).toBeVisible();
  await expect(card3.getByLabel("Оценка 3 из 3")).toBeVisible();
  await expect(mock.getByRole("timer")).toHaveAccessibleName(/^Длилось \d\d:\d\d$/);
  await expect(chat(page)).toContainText("Мок-интервью завершено.");
  await expect(chat(page)).toContainText("Мок-интервью проверено: 7 из 9.");

  // It folds into a result Card on request.
  await mock.getByRole("button", { name: "Свернуть в итог" }).click();
  await expect(mock.getByRole("button", { name: "Развернуть" })).toBeVisible();
});
