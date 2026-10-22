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
const LONG = 'Индекс построен по значению столбца email, а условие использует выражение lower(email), поэтому планировщик не может применить B-tree. Нужен индекс по выражению: CREATE INDEX ON users (lower(email)), либо тип citext.';
const MID = 'Поколения 0, 1 и 2: молодые объекты собираются чаще. Крупные объекты лежат в LOH.';
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
  for (const t of ['GIN', 'От 85 000 байт', 'Read Committed', "'object'"]) {
    const b = page.getByRole('button', { name: t, exact: true });
    if (await b.count()) await b.first().click().catch(() => {});
  }
}

async function mockTurns(page) {
  for (let i = 0; i < 3; i++) {
    await wait(1900);
    await page.locator('textarea:not([disabled])').last().fill(i === 0 ? LONG : MID);
    await btn(page, 'Ответить').click();
  }
  await wait(1500);
}

async function walkA() {
  const page = await open('A');
  await shot(page, 'A-1-start');
  await btn(page, /Подборка на сегодня/).click();
  await wait(900);
  await answerVisible(page);
  await shot(page, 'A-2-practice-answering');
  await btn(page, 'Отправить').click();
  await wait(4500);
  await shot(page, 'A-3-graded');
  await btn(page, /Обсудить/).click();
  await wait(1600);
  await shot(page, 'A-4-discuss');
  await btn(page, 'Мок-интервью').click();
  await mockTurns(page);
  await shot(page, 'A-5-mock-turns');
  await btn(page, 'Завершить').click();
  await wait(3600);
  await shot(page, 'A-6-mock-graded-and-collapsed-result');
  await btn(page, /Карта навыков/).click();
  await wait(400);
  await shot(page, 'A-7-skill-map-proposed');
  await page.getByRole('button', { name: 'Одобрить', exact: true }).first().click();
  await btn(page, 'Банк вопросов').click();
  await page.getByRole('button', { name: /Индексы PostgreSQL/ }).first().click();
  await shot(page, 'A-8-skill-map-bank');
  await page.getByRole('button', { name: 'Потренировать' }).nth(1).click();
  await wait(1000);
  await shot(page, 'A-9-topic-practice');
  await btn(page, /новый день/).click();
  await wait(800);
  await shot(page, 'A-10-new-day');
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
