import { agentPaths, apiPaths } from "@prepare-to-interview/shared";
import { expect, openCanvas, resetChatLayout, test } from "./fixtures.ts";

test("Candidate picks an agent's available model and saves it", async ({ page, baseURL }) => {
  await page.route(`**${apiPaths.agents}`, (route) => route.fulfill({ json: {
    agents: [
      { id: "claude", label: "Claude Code", installed: true, detail: "Installed" },
      { id: "codex", label: "Codex", installed: true, detail: "Installed" },
    ],
    settings: { agent: "claude", models: { claude: "deep" } },
  } }));
  await page.route(`**${agentPaths.models("claude")}`, (route) => route.fulfill({ json: {
    models: [{ id: "fast", label: "Fast model" }, { id: "deep", label: "Deep model" }], defaultModel: "fast",
  } }));
  await resetChatLayout(baseURL!);
  await openCanvas(page);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки" });
  const model = settings.getByRole("combobox", { name: "Модель", exact: true });
  await expect(model).toHaveValue("deep");
  await expect(model.locator("option")).toHaveText(["По умолчанию у агента (Fast model)", "Fast model", "Deep model"]);
  await model.selectOption("fast");
  const save = page.waitForRequest((req) => req.url().endsWith(apiPaths.agentSettings) && req.method() === "PUT");
  await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect((await save).postDataJSON()).toEqual({ agent: "claude", model: "fast" });
});

test("loading an earlier agent cannot replace the newly selected agent's models", async ({ page, baseURL }) => {
  await page.route(`**${apiPaths.agents}`, (route) => route.fulfill({ json: {
    agents: [
      { id: "claude", label: "Claude Code", installed: true, detail: "Installed" },
      { id: "codex", label: "Codex", installed: true, detail: "Installed" },
    ], settings: { agent: "claude", models: { claude: "deep", codex: "code" } },
  } }));
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const earlier: Promise<void>[] = [];
  await page.route(`**${agentPaths.models("claude")}`, async (route) => {
    await gate;
    const response = route.fulfill({ json: { models: [{ id: "deep", label: "Deep model" }], defaultModel: "deep" } });
    earlier.push(response);
    await response;
  });
  await page.route(`**${agentPaths.models("codex")}`, (route) => route.fulfill({ json: {
    models: [{ id: "code", label: "Code model" }], defaultModel: "code",
  } }));
  await resetChatLayout(baseURL!);
  await openCanvas(page);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки" });
  const model = settings.getByRole("combobox", { name: "Модель", exact: true });
  await expect(model).toBeDisabled();
  await expect(settings.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await settings.getByRole("radio", { name: /Codex/ }).check();
  await expect(model).toBeEnabled();
  await expect(model).toHaveValue("code");
  release();
  await Promise.all(earlier);
  await expect(model.locator("option")).toHaveText(["По умолчанию у агента (Code model)", "Code model"]);
  await model.selectOption("");
  const save = page.waitForRequest((req) => req.url().endsWith(apiPaths.agentSettings) && req.method() === "PUT");
  await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect((await save).postDataJSON()).toEqual({ agent: "codex", model: null });
});

test("a failed model list can be retried and a missing saved model requires a new choice", async ({ page, baseURL }) => {
  await page.route(`**${apiPaths.agents}`, (route) => route.fulfill({ json: {
    agents: [{ id: "claude", label: "Claude Code", installed: true, detail: "Installed" }],
    settings: { agent: "claude", models: { claude: "retired" } },
  } }));
  let failed = true;
  await page.route(`**${agentPaths.models("claude")}`, (route) => route.fulfill(failed
    ? { status: 502, json: { error: "Please log in to the agent." } }
    : { json: { models: [{ id: "fast", label: "Fast model" }], defaultModel: "fast" } }));
  await resetChatLayout(baseURL!);
  await openCanvas(page);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки" });
  const model = settings.getByRole("combobox", { name: "Модель", exact: true });
  const save = settings.getByRole("button", { name: "Сохранить", exact: true });
  await expect(settings.getByRole("alert")).toContainText("Please log in to the agent.");
  await expect(save).toBeDisabled();
  failed = false;
  await settings.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(model).toHaveValue("retired");
  await expect(settings.getByRole("alert")).toContainText("Сохранённая модель недоступна");
  await expect(save).toBeDisabled();
  await model.selectOption("");
  await expect(save).toBeEnabled();
});
