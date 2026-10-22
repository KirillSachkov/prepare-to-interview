// PROTOTYPE helper: walks each variant through the main flows and saves screenshots.
// Usage: pnpm --dir prototypes/canvas-ui dev  (in another terminal), then
//        node prototypes/canvas-ui/scripts/walk.mjs [A|B|C]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? 'http://127.0.0.1:5199/';
const LONG = 'Пишу рубрику с якорями для каждого балла, отдельный промпт судьи без истории диалога. Размечаю 100–200 ответов людьми и считаю согласие судьи с ними, проверяю позиционное смещение и любовь к длинным ответам.';
const MID = 'Режу документы по заголовкам, чанки примерно 500 токенов с небольшим перекрытием.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];


const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : { channel: 'chrome' });
const errors = [];

let current;
async function open(v) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${v}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${v}] ${e.message}`));
  current = page;
  await page.goto(`${BASE}?variant=${v}`);
  await wait(900);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const btn = (page, name) => page.getByRole('button', { name }).first();

async function answerVisible(page) {
  const tas = page.locator('textarea:not([disabled])');
  const n = await tas.count();
  for (let i = 0; i < n; i++) await tas.nth(i).fill(i === 0 ? LONG : MID);
  const picks = ['Утверждение, не подтверждённое найденными документами', 'Recall@k', 'MRR', 'nDCG', 'Косинусная близость', 'GIN', '422'];
  for (const t of picks) {
    const b = page.getByRole('button', { name: t, exact: true });
    if (await b.count()) await b.first().click().catch(() => {});
  }
}

async function mockTurns(page, hotkey = false) {
  for (let i = 0; i < 3; i++) {
    await wait(1900);
    const ta = page.locator('textarea:not([disabled])').last();
    await ta.fill(i === 0 ? LONG : MID);
    if (hotkey && i === 1) await page.keyboard.press('Meta+Enter'); // answer via hotkey
    else await btn(page, 'Ответить').click();
  }
  await wait(1500);
}

async function walkA() {
  const page = await open('A');
  const key = (k) => page.keyboard.press(k);
  const menuItem = (name) => page.getByRole('menu').getByRole('button', { name }).first();
  await shot(page, 'A-01-start');
  await page.getByRole('button', { name: 'Мок-интервью' }).first().hover();
  await wait(200);
  await shot(page, 'A-02-toolbar-tooltip');
  await page.mouse.move(700, 700);
  await key('KeyP'); // hotkey: Подборка на сегодня
  await wait(1100);
  await shot(page, 'A-03-practice-set');
  await page.locator('[data-card-id]').nth(1).click({ button: 'right', position: { x: 60, y: 14 } });
  await wait(200);
  await shot(page, 'A-04-card-context-menu');
  await menuItem(/^Подсказка/).click();
  await answerVisible(page);
  await shot(page, 'A-05-answering-with-hint');
  await page.locator('textarea').first().focus();
  await key('Meta+Enter'); // submit the Practice set from inside a Card
  await wait(4500);
  await shot(page, 'A-06-graded');
  await page.locator('[data-card-id]').nth(0).click({ button: 'right', position: { x: 60, y: 14 } });
  await menuItem('Показать эталон').click();
  await btn(page, /Обсудить/).click();
  await wait(1600);
  await shot(page, 'A-07-reference-and-discuss');
  await page.mouse.click(1300, 860, { button: 'right' });
  await wait(200);
  await menuItem(/Подборка по теме/).hover();
  await wait(200);
  await shot(page, 'A-08-pane-context-menu');
  await key('Escape');
  await key('KeyM'); // hotkey: Мок-интервью
  await mockTurns(page, true);
  await shot(page, 'A-09-mock-turns');
  await btn(page, 'Завершить').click();
  await wait(3600);
  await shot(page, 'A-10-mock-graded-and-collapsed-result');
  await key('Shift+Digit1');
  await wait(500);
  await shot(page, 'A-11-fit-all');
  await key('Shift+Slash'); await wait(300);
  await wait(200);
  await shot(page, 'A-12-shortcuts');
  await key('Escape');
  await key('KeyB'); // hotkey: Банк / Предложено
  await wait(400);
  await shot(page, 'A-13-skill-map-proposed');
  await page.getByRole('button', { name: 'Одобрить', exact: true }).first().click();
  await btn(page, 'Банк вопросов').click();
  await page.getByRole('button', { name: /^RAG/ }).first().click();
  await shot(page, 'A-14-skill-map-bank');
  await page.getByRole('button', { name: 'Потренировать' }).nth(1).click();
  await wait(1000);
  await shot(page, 'A-15-topic-practice');
  await btn(page, /новый день/).click();
  await wait(800);
  await shot(page, 'A-16-new-day');
  await page.getByRole('button', { name: 'Меню' }).click();
  await wait(200);
  await shot(page, 'A-17-burger-menu');
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.mouse.move(700, 600);
  await key('Alt+KeyZ');
  await wait(200);
  await shot(page, 'A-18-zen-mode');
  await key('Alt+KeyZ');
  await page.close();
}

async function walkB() {
  const page = await open('B');
  await shot(page, 'B-1-start-inbox');
  await page.getByRole('button', { name: 'Одобрить', exact: true }).first().click();
  await btn(page, /Подборка на сегодня/).click();
  await wait(1200);
  await answerVisible(page);
  await shot(page, 'B-2-feed-answering');
  await btn(page, 'Отправить').click();
  await wait(4500);
  await shot(page, 'B-3-graded');
  await btn(page, 'Мок-интервью').click();
  await mockTurns(page);
  await shot(page, 'B-4-mock-turns');
  await btn(page, 'Завершить').click();
  await wait(3600);
  await shot(page, 'B-5-mock-graded');
  await page.getByRole('button', { name: 'Карта', exact: true }).click();
  await wait(1200);
  await shot(page, 'B-6-semantic-zoom-skill-map');
  await page.mouse.move(700, 450);
  await btn(page, 'Лента').click();
  await wait(1000);
  await btn(page, /новый день/).click();
  await wait(900);
  await shot(page, 'B-7-new-day');
  await page.close();
}

async function walkC() {
  const page = await open('C');
  await shot(page, 'C-1-start-zones');
  await page.keyboard.press('Meta+k');
  await wait(300);
  await shot(page, 'C-2-command-palette');
  await page.keyboard.type('подборка');
  await page.keyboard.press('Enter');
  await wait(1000);
  for (let i = 0; i < 4; i++) {
    await answerVisible(page);
    if (i < 3) await btn(page, /следующий/).click();
  }
  await shot(page, 'C-3-deck-answering');
  await btn(page, 'Отправить').click();
  await wait(4500);
  await shot(page, 'C-4-deck-graded');
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('мок');
  await page.keyboard.press('Enter');
  await mockTurns(page);
  await shot(page, 'C-5-mock-zone');
  await btn(page, 'Завершить').click();
  await wait(3600);
  await shot(page, 'C-6-mock-graded-results-zone');
  await btn(page, /^Банк/).click();
  await wait(300);
  await shot(page, 'C-7-drawer-proposed');
  await page.getByRole('button', { name: 'Одобрить', exact: true }).first().click();
  await btn(page, 'Одобрить все').click();
  await page.getByRole('button', { name: 'Банк вопросов' }).click();
  await shot(page, 'C-8-drawer-bank');
  await page.keyboard.press('Escape');
  await btn(page, 'Карта').click();
  await wait(300);
  await shot(page, 'C-9-heat-map');
  await page.keyboard.press('Escape');
  await btn(page, /новый день/).click();
  await wait(800);
  await shot(page, 'C-10-new-day');
  await page.close();
}

for (const [k, fn] of [['A', walkA], ['B', walkB], ['C', walkC]]) {
  if (only && only !== k) continue;
  try { await fn(); } catch (e) {
    await current?.screenshot({ path: join(out, `${k}-FAIL.png`) }).catch(() => {}); errors.push(`[${k}] WALK FAILED: ${e.message.split("\n").slice(0, 12).join(" ")}`); }
}
await browser.close();
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No console errors.');
