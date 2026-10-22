// The Canvas shell (ticket #4, prototype variant A): chrome, navigation, hotkeys, context menus,
// layout persistence, Zen mode, culling, and zoomed-out summaries.
import type { Locator, Page } from "@playwright/test";
import { expect, openCanvas, placeNote, resetChatLayout, test } from "./fixtures.ts";

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Панель инструментов" });
const zoomLabel = (page: Page) => page.getByRole("button", { name: "Сбросить масштаб" });
const chatNode = (page: Page) => page.locator('.react-flow__node[data-id="chat"]');
const grid = (page: Page) => page.locator(".react-flow__background");
const menu = (page: Page, target: string) => page.locator(`[role="menu"][data-menu-target="${target}"]`);

/** Viewport pan and zoom, read from React Flow's transform. */
async function viewport(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const transform = await page.locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);
  const [a, , , , e, f] = transform.replace(/^matrix\(|\)$/g, "").split(",").map(Number);
  return { x: e ?? 0, y: f ?? 0, zoom: a ?? 1 };
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element is not visible");
  return box;
}

function toCanvas(box: { x: number; y: number }, view: { x: number; y: number; zoom: number }) {
  return { x: (box.x - view.x) / view.zoom, y: (box.y - view.y) / view.zoom };
}

/** A point on the empty Canvas, away from nodes and chrome. */
const emptySpot = { x: 1300, y: 760 };

test.beforeEach(async ({ page, baseURL }) => {
  await resetChatLayout(baseURL!);
  await openCanvas(page);
});

test("chrome matches variant A", async ({ page }) => {
  const bar = toolbar(page);
  for (const name of ["Выделение", "Рука: двигать холст", "Подборка на сегодня", "Мок-интервью", "Исследовать", "Банк / Предложено", "Карта навыков", "Ещё"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(bar.getByRole("button", { name: "Выделение" })).toHaveAttribute("aria-pressed", "true");
  // Later tickets implement the activity actions; until then they read as "coming soon".
  await expect(bar.getByRole("button", { name: "Подборка на сегодня" })).toBeDisabled();
  await bar.getByRole("button", { name: "Мок-интервью" }).hover({ force: true });
  await expect(page.getByRole("tooltip").filter({ hasText: "Мок-интервью · скоро" })).toBeVisible();
  await expect(page.getByText("Чтобы двигать холст, зажмите колесо мыши или пробел, либо выберите руку (H)")).toBeVisible();

  await expect(page.getByRole("button", { name: "Цель подготовки" })).toContainText("Цель не выбрана");
  await page.getByRole("button", { name: "Меню" }).click();
  const topMenu = page.getByRole("menu", { name: "Меню" });
  await expect(topMenu.getByText("Цель подготовки")).toBeVisible();
  await expect(topMenu.getByRole("menuitem", { name: "+ Новая цель" })).toBeDisabled();
  await topMenu.getByRole("menuitem", { name: "Настройки" }).click();
  const settings = page.getByRole("dialog", { name: "Настройки" });
  // The agent choice from the Chat ticket plugs into the settings slot.
  await expect(settings.getByRole("region", { name: "Агент" })).toContainText("Claude Code");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Ещё" }).click();
  const more = page.getByRole("menu", { name: "Ещё" });
  await expect(more.getByRole("menuitem", { name: /Квиз/ })).toBeDisabled();
  await expect(more.getByRole("menuitem", { name: /Показать всё/ })).toBeEnabled();

  await expect(page.getByRole("button", { name: "Чат", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(zoomLabel(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Отдалить" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Приблизить" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Горячие клавиши" })).toBeVisible();
});

test("mouse navigation: scroll pans, modifier-scroll zooms, space, middle, and Hand drags pan", async ({ page }) => {
  await page.mouse.move(emptySpot.x, emptySpot.y);
  let before = await viewport(page);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await viewport(page)).y).toBeLessThan(before.y - 50);

  before = await viewport(page);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await viewport(page)).zoom).toBeLessThan(before.zoom);

  const drag = async (prepare: () => Promise<void>, button: "left" | "middle", release: () => Promise<void>) => {
    const start = await viewport(page);
    await page.mouse.move(emptySpot.x, emptySpot.y);
    await prepare();
    await page.mouse.down({ button });
    await page.mouse.move(emptySpot.x - 150, emptySpot.y - 100, { steps: 8 });
    await page.mouse.up({ button });
    await release();
    await expect.poll(async () => (await viewport(page)).x).toBeLessThan(start.x - 100);
  };
  const nothing = () => Promise.resolve();
  await drag(() => page.keyboard.down("Space"), "left", () => page.keyboard.up("Space"));
  await drag(nothing, "middle", nothing);
  await toolbar(page).getByRole("button", { name: "Рука: двигать холст" }).click();
  await drag(nothing, "left", nothing);
});

test("Select tool marquee-selects nodes; Shift+1 fits all and Shift+2 fits the selection", async ({ page, baseURL }) => {
  await placeNote(baseURL!, "Marquee target");
  const note = page.locator(".react-flow__node-demo_note").filter({ hasText: "Marquee target" });
  await page.keyboard.press("Shift+Digit1");
  await expect(note).toBeVisible();

  const box = await boxOf(note);
  await page.mouse.move(box.x - 30, box.y - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 30, box.y + box.height + 30, { steps: 8 });
  await page.mouse.up();
  await expect(note).toHaveClass(/selected/);

  await page.keyboard.press("Shift+Digit2");
  await expect.poll(async () => (await boxOf(note)).width).toBeGreaterThan(box.width);
  await page.keyboard.press("Escape");
  await expect(note).not.toHaveClass(/selected/);
});

test("zoom hotkeys and the zoom pill", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+0");
  await expect(zoomLabel(page)).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+Equal");
  await expect(zoomLabel(page)).not.toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(zoomLabel(page)).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+Minus");
  await expect.poll(async () => parseInt(await zoomLabel(page).innerText())).toBeLessThan(100);
  await page.getByRole("button", { name: "Приблизить" }).click();
  await page.getByRole("button", { name: "Отдалить" }).click();
  await zoomLabel(page).click();
  await expect(zoomLabel(page)).toHaveText("100%");
});

test("tool, grid, Chat, Zen, and shortcuts hotkeys", async ({ page }) => {
  const pressed = (name: string) => toolbar(page).getByRole("button", { name });
  await page.keyboard.press("h");
  await expect(pressed("Рука: двигать холст")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(pressed("Выделение")).toHaveAttribute("aria-pressed", "true");

  await expect(grid(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Quote");
  await expect(grid(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Quote");
  await expect(grid(page)).toHaveCount(1);

  await page.keyboard.press("c");
  await expect(chatNode(page)).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(chatNode(page)).toBeVisible();
  // The shown Chat may take focus for typing; click the Canvas to leave it before more hotkeys.
  await expect(chatNode(page)).toContainText("Агент для программирования");
  await page.mouse.click(emptySpot.x, emptySpot.y);

  await page.keyboard.press("p");
  await expect(page.getByRole("status")).toHaveText("«Подборка на сегодня» — скоро");

  await page.keyboard.press("Alt+KeyZ");
  await expect(toolbar(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Меню" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Чат", exact: true })).toHaveCount(0);
  await expect(zoomLabel(page)).toHaveCount(0);
  await page.keyboard.press("Alt+KeyZ");
  await expect(toolbar(page)).toBeVisible();
  await page.keyboard.press("Alt+KeyZ");
  await page.getByRole("button", { name: /Выйти из дзен-режима/ }).click();
  await expect(toolbar(page)).toBeVisible();

  await page.keyboard.press("Shift+Slash");
  const dialog = page.getByRole("dialog", { name: "Горячие клавиши" });
  await expect(dialog).toBeVisible();
  for (const keys of ["V", "H", "P", "M", "R", "B", "K", "C", "Q", "⇧1", "⇧2", "Alt+Z", "?", "Esc"]) {
    await expect(dialog.locator("kbd", { hasText: new RegExp(`^${keys.replace(/[?+]/g, "\\$&")}$`) })).toHaveCount(1);
  }
  for (const keys of ["+", "−", "0", "'", "↵"]) await expect(dialog.locator("kbd", { hasText: keys }).first()).toBeVisible();
  // Letter hotkeys stay inert while the dialog is open.
  await page.keyboard.press("h");
  await expect(pressed("Выделение")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // On the Russian layout Shift+/ types ",", yet the physical key still opens the dialog.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Slash", key: ",", shiftKey: true })),
  );
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
});

test("hotkeys never fire while typing in an input, textarea, or contenteditable", async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:200px;top:300px;z-index:100;background:white";
    host.innerHTML = '<input id="t-input"><textarea id="t-area"></textarea><div id="t-edit" contenteditable="true">x</div>';
    document.body.append(host);
  });
  for (const id of ["t-input", "t-area", "t-edit"]) {
    await page.locator(`#${id}`).focus();
    await page.keyboard.type("hcvp?");
    await page.keyboard.press("Alt+KeyZ");
    await page.keyboard.press("Shift+Digit1");
    await expect(toolbar(page).getByRole("button", { name: "Выделение" })).toHaveAttribute("aria-pressed", "true");
    await expect(chatNode(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
  }
  // Shift+1 typed "!"; nothing reached the Canvas.
  await expect(page.locator("#t-input")).toHaveValue(/^hcvp\?!/);
});

test("context menus depend on the target under the cursor", async ({ page, baseURL }) => {
  await page.mouse.click(emptySpot.x, emptySpot.y, { button: "right" });
  const pane = menu(page, "canvas");
  await expect(pane.getByRole("menuitem", { name: /Подборка на сегодня/ })).toBeDisabled();
  await expect(pane.getByRole("menuitem", { name: /Мок-интервью/ })).toBeDisabled();
  await expect(pane.getByRole("menuitem", { name: /Показать всё/ })).toBeEnabled();
  await pane.getByRole("menuitem", { name: /Сетка: выключить/ }).click();
  await expect(grid(page)).toHaveCount(0);
  await page.mouse.click(emptySpot.x, emptySpot.y, { button: "right" });
  await menu(page, "canvas").getByRole("menuitem", { name: /Сетка: включить/ }).click();
  await expect(grid(page)).toHaveCount(1);

  // The Chat node registers its own items.
  await chatNode(page).getByText("Интервьюер", { exact: true }).click({ button: "right" });
  const chatMenu = menu(page, "chat");
  await expect(chatMenu.getByRole("menuitem", { name: /Новая тема разговора/ })).toBeDisabled();
  await chatMenu.getByRole("menuitem", { name: "Свернуть" }).click();
  await expect(chatNode(page)).toContainText("развернуть");
  await page.keyboard.press("Escape");

  // Collapsing is stored in the layout store.
  await page.reload();
  await expect(chatNode(page)).toContainText("развернуть");
  await chatNode(page).getByText("Интервьюер", { exact: true }).click({ button: "right" });
  await menu(page, "chat").getByRole("menuitem", { name: "Развернуть" }).click();
  await expect(chatNode(page)).toContainText("Агент не выбран");

  // A node type without its own items falls back to the Canvas menu.
  await placeNote(baseURL!, "Menu fallback");
  const note = page.locator(".react-flow__node-demo_note").filter({ hasText: "Menu fallback" });
  await page.keyboard.press("Shift+Digit1");
  await note.click({ button: "right" });
  await expect(menu(page, "canvas")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page, "canvas")).toHaveCount(0);
});

test("dragged node positions persist across reload", async ({ page }) => {
  const header = chatNode(page).getByText("Интервьюер", { exact: true });
  const before = await boxOf(chatNode(page));
  const grip = await boxOf(header);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 220, grip.y + 140, { steps: 10 });
  await page.mouse.up();
  const moved = await boxOf(chatNode(page));
  expect(moved.x - before.x).toBeGreaterThan(150);

  // Positions live in Canvas coordinates; the viewport may differ after reload.
  const saved = toCanvas(moved, await viewport(page));
  await page.reload();
  await expect(chatNode(page)).toBeVisible();
  const after = toCanvas(await boxOf(chatNode(page)), await viewport(page));
  expect(Math.abs(after.x - saved.x)).toBeLessThan(2);
  expect(Math.abs(after.y - saved.y)).toBeLessThan(2);
});

test("only visible nodes render, and zoomed-out nodes show summaries", async ({ page, baseURL }) => {
  await placeNote(baseURL!, "Culling probe");
  const note = page.locator(".react-flow__node-demo_note").filter({ hasText: "Culling probe" });
  await page.keyboard.press("Shift+Digit1");
  await expect(note).toBeVisible();

  // Pan the note far off-screen: React Flow drops it from the DOM.
  await page.keyboard.press("ControlOrMeta+0");
  await page.mouse.move(emptySpot.x, emptySpot.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(4000, 0);
  await expect(note).toHaveCount(0);

  // Zoomed far out, node types render their compact summaries.
  await page.keyboard.press("Shift+Digit1");
  await expect(chatNode(page)).toContainText("Агент не выбран");
  const zoomPercent = async () => parseInt(await zoomLabel(page).innerText());
  while ((await zoomPercent()) >= 45) {
    const current = await zoomPercent();
    await page.keyboard.press("ControlOrMeta+Minus");
    await expect.poll(zoomPercent).toBeLessThan(current);
  }
  await expect(chatNode(page)).toHaveText("Чат");
  await expect(chatNode(page)).not.toContainText("Агент не выбран");
});
