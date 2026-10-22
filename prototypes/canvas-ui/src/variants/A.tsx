// PROTOTYPE variant A «Спокойный холст» (iteration 2):
// free React Flow canvas with an Excalidraw-style floating toolbar as the Control panel,
// hotkeys, a right-click context menu, a zoom pill, and Chat as a draggable node.
// Practice sets are grouped regions; the Question bank and Proposed queue live inside the Skill map.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Background, BackgroundVariant, Handle, Position, ReactFlow, SelectionMode, useReactFlow, useStore as useRF,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import { TARGETS } from '../model/data';
import {
  currentSets, dueTotal, historySets, mockQuestion, readiness, setScore, target, useStore, useStructureKey,
} from '../model/store';
import { useSyncedNodes, rightEdge } from '../shared/flow';
import { CardBody, ChatThread, ProposedList, Ring, Timer, cx, heat, useBank } from '../shared/ui';

export const variantAName = 'Спокойный холст';

type Tool = 'select' | 'hand';
type MenuTarget =
  | { kind: 'pane' }
  | { kind: 'card'; cardId: string }
  | { kind: 'set'; setId: string }
  | { kind: 'mock'; setId: string }
  | { kind: 'result'; setId: string }
  | { kind: 'chat' };
type Menu = MenuTarget & { x: number; y: number };
type Dialog = null | 'shortcuts' | 'settings' | 'custom';

interface Ui {
  openMenu: (m: Menu) => void;
  chatCollapsed: boolean;
  setChatCollapsed: (v: boolean) => void;
}
const UiCtx = createContext<Ui>(null!);
const useUi = () => useContext(UiCtx);

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
// Keep fitted content clear of the floating toolbar and the bottom controls.
const FIT_PAD = { top: '120px', bottom: '72px', left: '48px', right: '48px' } as const;
const MOD = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

/* ======================================================================== */

export function VariantA() {
  const { state, actions } = useStore();
  const rf = useReactFlow();
  const [tool, setTool] = useState<Tool>('select');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [zen, setZen] = useState(false);
  const [grid, setGrid] = useState(true);
  const [chatHidden, setChatHidden] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [mapTab, setMapTab] = useState<'proposed' | 'bank'>('proposed');
  const [highlightTopic, setHighlightTopic] = useState<string | null>(null);
  const [popover, setPopover] = useState<null | 'burger' | 'more'>(null);
  const onCanvas = state.view === 'canvas';

  const fitAll = () => rf.fitView({ padding: FIT_PAD, duration: 300, maxZoom: 1 });
  const zoomSelection = () => {
    const sel = rf.getNodes().filter((n) => n.selected);
    if (sel.length) rf.fitView({ nodes: sel, padding: FIT_PAD, duration: 300, maxZoom: 1.2 });
  };
  const deselect = () => rf.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
  const openBank = () => { setMapTab('proposed'); actions.setView('skills'); };
  const toggleView = () => actions.setView(onCanvas ? 'skills' : 'canvas');
  const submitFromFocus = () => {
    const el = document.activeElement?.closest('[data-card-id]') as HTMLElement | null;
    const cardId = el?.dataset.cardId;
    const card = cardId ? state.cards[cardId] : undefined;
    const set = card ? state.sets.find((x) => x.id === card.setId) : [...currentSets(state)].reverse().find((x) => x.status === 'active' && x.kind === 'practice');
    if (!set || set.status !== 'active') return;
    if (set.kind === 'practice') actions.submitSet(set.id);
    if (set.kind === 'mock' && card && card.state === 'open' && card.text.trim()) actions.answerMock(card.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); submitFromFocus(); return; }
      if (isTyping(document.activeElement)) return;
      if (e.key === 'Escape') { setMenu(null); setDialog(null); setPopover(null); deselect(); return; }
      if (dialog) return;
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); rf.zoomIn({ duration: 150 }); return; }
      if (mod && e.key === '-') { e.preventDefault(); rf.zoomOut({ duration: 150 }); return; }
      if (mod && e.key === '0') { e.preventDefault(); rf.zoomTo(1, { duration: 150 }); return; }
      if (mod && e.code === 'Quote') { e.preventDefault(); setGrid((g) => !g); return; }
      if (e.altKey && e.code === 'KeyZ') { e.preventDefault(); setZen((z) => !z); return; }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitAll(); return; }
      if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); zoomSelection(); return; }
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); setDialog('shortcuts'); return; }
      if (e.key === 'Enter') {
        const card = (document.activeElement as HTMLElement | null)?.closest('[data-card-id]');
        const input = card?.querySelector('textarea:not([disabled]), button:not([disabled])') as HTMLElement | null;
        if (input) { e.preventDefault(); input.focus(); }
        return;
      }
      if (mod || e.altKey || e.shiftKey) return;
      const map: Record<string, () => void> = {
        KeyV: () => setTool('select'),
        KeyH: () => setTool('hand'),
        KeyP: actions.startDaily,
        KeyM: actions.startMock,
        KeyR: actions.research,
        KeyB: openBank,
        KeyK: toggleView,
        KeyC: () => setChatHidden((h) => !h),
        KeyQ: actions.startQuiz,
      };
      const fn = map[e.code];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ui: Ui = { openMenu: setMenu, chatCollapsed, setChatCollapsed };

  return (
    <UiCtx.Provider value={ui}>
      <div className="variant-a relative h-full overflow-hidden bg-[#f7f6f3]" onMouseDown={() => setPopover(null)}>
        {onCanvas ? <CanvasA tool={tool} grid={grid} chatHidden={chatHidden} /> : <SkillMapA tab={mapTab} setTab={setMapTab} highlight={highlightTopic} />}

        {!zen && (
          <>
            <TopLeft open={popover === 'burger'} setOpen={(v) => setPopover(v ? 'burger' : null)} onSettings={() => setDialog('settings')} />
            <Toolbar
              tool={tool} setTool={setTool} onBank={openBank} onToggleView={toggleView}
              moreOpen={popover === 'more'} setMoreOpen={(v) => setPopover(v ? 'more' : null)}
              onShortcuts={() => setDialog('shortcuts')} onFit={fitAll} grid={grid} setGrid={setGrid} setZen={setZen}
            />
            <div className="absolute right-4 top-4 z-30">
              <button
                aria-label="Чат"
                title="Показать или скрыть чат — C"
                onClick={() => setChatHidden((h) => !h)}
                className={cx('flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] shadow-sm', chatHidden ? 'border-stone-200 bg-white text-stone-500' : 'border-indigo-100 bg-indigo-50 text-indigo-700')}
              >
                <Icon name="chat" /> Чат
              </button>
            </div>
            {onCanvas && <ZoomPill />}
            <button aria-label="Горячие клавиши" onClick={() => setDialog('shortcuts')} className="absolute bottom-4 right-4 z-30 grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-[15px] font-semibold text-stone-500 shadow-sm hover:text-indigo-600">?</button>
          </>
        )}
        {zen && <button onClick={() => setZen(false)} className="absolute bottom-4 left-4 z-30 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-500 shadow-sm">Выйти из дзен-режима <Kbd>Alt+Z</Kbd></button>}

        {menu && (
          <ContextMenu
            menu={menu}
            close={() => setMenu(null)}
            onCustom={() => setDialog('custom')}
            onFit={fitAll}
            grid={grid} setGrid={setGrid} setZen={setZen}
            chatCollapsed={chatCollapsed} setChatCollapsed={setChatCollapsed}
            goTopic={(id) => { setHighlightTopic(id); setMapTab('bank'); actions.setView('skills'); }}
          />
        )}
        {dialog === 'shortcuts' && <ShortcutsDialog close={() => setDialog(null)} />}
        {dialog === 'settings' && <SettingsDialog close={() => setDialog(null)} />}
        {dialog === 'custom' && <CustomQuestionDialog close={() => setDialog(null)} />}
      </div>
    </UiCtx.Provider>
  );
}

/* ---------------- Icons and small bits ---------------- */

const ICONS: Record<string, string[]> = {
  select: ['M5 3l14 8-6 1.5L10 19z'],
  hand: ['M18 11V6a2 2 0 0 0-4 0v5', 'M14 10V4a2 2 0 0 0-4 0v6', 'M10 10.5V6a2 2 0 0 0-4 0v8', 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15'],
  set: ['M8 3h12v12', 'M4 7h12v13H4z'],
  mock: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
  research: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M21 21l-4.3-4.3'],
  bank: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'],
  map: ['M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z', 'M9 3v15', 'M15 6v15'],
  canvas: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  burger: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-stone-200 bg-stone-50 px-1 font-sans text-[10.5px] text-stone-500">{children}</kbd>;
}

/* ---------------- Top-left: hamburger + target chip ---------------- */

function TopLeft({ open, setOpen, onSettings }: { open: boolean; setOpen: (v: boolean) => void; onSettings: () => void }) {
  const { state, actions } = useStore();
  const t = target(state);
  const r = readiness(state);
  return (
    <div className="absolute left-4 top-4 z-30 flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
      <button aria-label="Меню" onClick={() => setOpen(!open)} className={cx('grid h-10 w-10 place-items-center rounded-xl border shadow-sm', open ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-stone-200 bg-white text-stone-600')}>
        <Icon name="burger" />
      </button>
      <button onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white/90 px-3 text-[12.5px] shadow-sm backdrop-blur">
        <span className="font-semibold text-stone-800">{t.name}</span>
        <span className="text-stone-300">·</span>
        <span className="tabular-nums text-indigo-600">{r}%</span>
        {t.daysLeft && <><span className="text-stone-300">·</span><span className="text-stone-500">{t.daysLeft} дн.</span></>}
      </button>
      {open && (
        <div className="fade-in absolute left-0 top-12 w-64 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg">
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-400">Цель подготовки</div>
          {TARGETS.map((x) => (
            <MenuRow key={x.id} onClick={() => { actions.setTarget(x.id); setOpen(false); }} active={x.id === state.targetId}>
              <span className="flex-1">{x.name} <span className="text-stone-400">· {x.grade}</span></span>
              {x.daysLeft && <span className="text-[11px] text-stone-400">{x.daysLeft} дн.</span>}
            </MenuRow>
          ))}
          <MenuRow onClick={() => { actions.newTarget(); setOpen(false); }}>+ Новая цель</MenuRow>
          <Sep />
          <div className="px-2.5 py-1.5 text-[12px] text-stone-500">
            Готовность <b className="text-stone-800">{r}%</b> · в повторении {dueTotal(state)}
            {t.interviewDate && <div className="text-stone-400">Собеседование {t.interviewDate}</div>}
          </div>
          <Sep />
          <MenuRow onClick={() => { onSettings(); setOpen(false); }}>Настройки</MenuRow>
        </div>
      )}
    </div>
  );
}

function MenuRow({ children, onClick, active, hint, disabled }: { children: ReactNode; onClick?: () => void; active?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-indigo-50/70 disabled:pointer-events-none disabled:opacity-40', active && 'font-medium text-indigo-700')}>
      <span className="flex flex-1 items-center">{children}</span>
      {hint && <span className="text-[11.5px] text-stone-400">{hint}</span>}
    </button>
  );
}
const Sep = () => <div className="mx-2 my-1 h-px bg-stone-100" />;

/* ---------------- Excalidraw-style toolbar ---------------- */

function Toolbar(p: {
  tool: Tool; setTool: (t: Tool) => void; onBank: () => void; onToggleView: () => void;
  moreOpen: boolean; setMoreOpen: (v: boolean) => void; onShortcuts: () => void; onFit: () => void;
  grid: boolean; setGrid: (f: (g: boolean) => boolean) => void; setZen: (v: boolean) => void;
}) {
  const { state, actions } = useStore();
  const onCanvas = state.view === 'canvas';
  const proposedN = state.proposed.filter((x) => x.targetId === state.targetId).length;
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 flex -translate-x-1/2 flex-col items-center" onMouseDown={(e) => e.stopPropagation()}>
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-200 bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,.06),0_6px_20px_rgba(0,0,0,.05)]">
        <ToolBtn icon="select" label="Выделение" hotkey="V" active={onCanvas && p.tool === 'select'} disabled={!onCanvas} onClick={() => p.setTool('select')} />
        <ToolBtn icon="hand" label="Рука: двигать холст" hotkey="H" active={onCanvas && p.tool === 'hand'} disabled={!onCanvas} onClick={() => p.setTool('hand')} />
        <Divider />
        <ToolBtn icon="set" label="Подборка на сегодня" hotkey="P" badge={dueTotal(state)} onClick={actions.startDaily} />
        <ToolBtn icon="mock" label="Мок-интервью" hotkey="M" onClick={actions.startMock} />
        <ToolBtn icon="research" label={state.researching ? 'Исследую…' : 'Исследовать'} hotkey="R" busy={state.researching} onClick={actions.research} />
        <ToolBtn icon="bank" label="Банк / Предложено" hotkey="B" badge={proposedN || undefined} accentBadge onClick={p.onBank} />
        <Divider />
        <ToolBtn icon={onCanvas ? 'map' : 'canvas'} label={onCanvas ? 'Карта навыков' : 'Холст'} hotkey="K" active={!onCanvas} onClick={p.onToggleView} />
        <div className="relative">
          <ToolBtn icon="more" label="Ещё" hotkey="" active={p.moreOpen} onClick={() => p.setMoreOpen(!p.moreOpen)} />
          {p.moreOpen && (
            <div className="fade-in absolute right-0 top-12 w-64 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg">
              <MenuRow hint="Q" onClick={() => { actions.startQuiz(); p.setMoreOpen(false); }}>Квиз на 4 теста</MenuRow>
              <MenuRow hint="⇧1" onClick={() => { p.onFit(); p.setMoreOpen(false); }}>Показать всё</MenuRow>
              <MenuRow hint={`${MOD}+'`} onClick={() => p.setGrid((g) => !g)}>Сетка: {p.grid ? 'вкл' : 'выкл'}</MenuRow>
              <MenuRow hint="Alt+Z" onClick={() => { p.setZen(true); p.setMoreOpen(false); }}>Дзен-режим</MenuRow>
              <MenuRow hint="?" onClick={() => { p.onShortcuts(); p.setMoreOpen(false); }}>Горячие клавиши</MenuRow>
              <Sep />
              <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-stone-400">История · {historySets(state).length}</div>
              {historySets(state).slice(-5).reverse().map((s) => { const sc = setScore(state, s); return (
                <div key={s.id} className="flex justify-between px-2.5 py-1 text-[12.5px] text-stone-600"><span className="truncate">{s.title} · день {s.day}</span><span className="tabular-nums text-stone-400">{sc.got}/{sc.max}</span></div>
              ); })}
              {!historySets(state).length && <div className="px-2.5 pb-1.5 text-[12px] text-stone-400">Итоги попадут сюда сами при новой подборке или на следующий день.</div>}
            </div>
          )}
        </div>
      </div>
      {onCanvas && <div className="mt-2 text-[11.5px] text-stone-400">Чтобы двигать холст, зажмите колесо мыши или пробел, либо выберите руку (H)</div>}
    </div>
  );
}

function Divider() { return <span className="mx-1 h-7 w-px bg-stone-200" />; }

function ToolBtn({ icon, label, hotkey, active, onClick, badge, accentBadge, disabled, busy }: {
  icon: string; label: string; hotkey: string; active?: boolean; onClick: () => void; badge?: number; accentBadge?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cx('relative flex h-10 w-10 flex-col items-center justify-center rounded-lg transition disabled:opacity-35', active ? 'bg-indigo-100 text-indigo-700' : 'text-stone-600 hover:bg-stone-100')}
      >
        <span className={cx(busy && 'animate-pulse')}><Icon name={icon} size={17} /></span>
        {hotkey && <span className="absolute bottom-0.5 right-1 text-[8.5px] leading-none text-stone-400">{hotkey}</span>}
        {badge !== undefined && <span className={cx('absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-semibold', accentBadge ? 'bg-indigo-500 text-white' : 'bg-stone-800 text-white')}>{badge}</span>}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-12 z-40 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-[11.5px] text-white group-hover:block">
        {label}{hotkey && <span className="ml-1.5 text-stone-400">{hotkey}</span>}
      </div>
    </div>
  );
}

function ZoomPill() {
  const rf = useReactFlow();
  const zoom = useRF((s) => s.transform[2]);
  return (
    <div className="absolute bottom-4 left-4 z-30 flex items-center rounded-xl border border-stone-200 bg-white shadow-sm">
      <button aria-label="Отдалить" title={`Отдалить — ${MOD} −`} onClick={() => rf.zoomOut({ duration: 150 })} className="h-9 w-9 rounded-l-xl text-[16px] text-stone-500 hover:bg-stone-100">−</button>
      <button title={`Сбросить до 100% — ${MOD} 0`} onClick={() => rf.zoomTo(1, { duration: 150 })} className="h-9 min-w-14 px-1 text-[12.5px] tabular-nums text-stone-600 hover:bg-stone-100">{Math.round(zoom * 100)}%</button>
      <button aria-label="Приблизить" title={`Приблизить — ${MOD} +`} onClick={() => rf.zoomIn({ duration: 150 })} className="h-9 w-9 rounded-r-xl text-[16px] text-stone-500 hover:bg-stone-100">+</button>
    </div>
  );
}

/* ---------------- Context menu ---------------- */

function ContextMenu(p: {
  menu: Menu; close: () => void; onCustom: () => void; onFit: () => void;
  grid: boolean; setGrid: (f: (g: boolean) => boolean) => void; setZen: (v: boolean) => void;
  chatCollapsed: boolean; setChatCollapsed: (v: boolean) => void; goTopic: (topicId: string) => void;
}) {
  const { state, actions } = useStore();
  const [sub, setSub] = useState(false);
  const { menu, close } = p;
  const run = (fn: () => void) => () => { fn(); close(); };
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu.x, menu.y]);

  let body: ReactNode = null;
  if (menu.kind === 'pane') {
    const topics = state.topics.filter((t) => t.targets.includes(state.targetId));
    body = (
      <>
        <MenuRow hint="P" onClick={run(actions.startDaily)}>Подборка на сегодня</MenuRow>
        <div className="relative" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)}>
          <MenuRow hint="›">Подборка по теме…</MenuRow>
          {sub && (
            <div className={cx('absolute max-h-80 w-64 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg', pos.x > window.innerWidth - 560 ? 'right-full mr-1' : 'left-full ml-1', pos.y > window.innerHeight - 380 ? 'bottom-0' : 'top-0')}>
              {topics.map((t) => (
                <MenuRow key={t.id} hint={`${Math.round(t.mastery * 100)}%`} onClick={run(() => actions.practiceTopic(t.id))}>
                  <span className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ background: heat(t.mastery).stroke }} />{t.name}
                </MenuRow>
              ))}
            </div>
          )}
        </div>
        <MenuRow hint="M" onClick={run(actions.startMock)}>Мок-интервью</MenuRow>
        <MenuRow onClick={run(p.onCustom)}>Вставить свой вопрос</MenuRow>
        <Sep />
        <MenuRow hint="⇧1" onClick={run(p.onFit)}>Показать всё</MenuRow>
        <MenuRow hint={`${MOD}+'`} onClick={run(() => p.setGrid((g) => !g))}>Сетка: {p.grid ? 'выключить' : 'включить'}</MenuRow>
        <MenuRow hint="Alt+Z" onClick={run(() => p.setZen(true))}>Дзен-режим</MenuRow>
      </>
    );
  } else if (menu.kind === 'card') {
    const c = state.cards[menu.cardId];
    const q = mockQuestion(state, c.qid);
    const set = state.sets.find((x) => x.id === c.setId)!;
    const open = c.state === 'open' && set.status === 'active';
    body = (
      <>
        <MenuRow onClick={run(() => actions.discuss(c.id))}>Обсудить в чате</MenuRow>
        <MenuRow disabled={!open || q.type !== 'open' || (c.hints ?? 0) >= 2} hint={`−1 балл`} onClick={run(() => actions.hint(c.id))}>Подсказка{c.hints ? ` (${c.hints}/2)` : ''}</MenuRow>
        <MenuRow disabled={!open} onClick={run(() => actions.skip(c.id))}>Пропустить</MenuRow>
        {c.state === 'graded' && <MenuRow disabled={c.showRef} onClick={run(() => actions.showRef(c.id))}>Показать эталон</MenuRow>}
        <Sep />
        <MenuRow onClick={run(() => p.goTopic(q.topicId))}>Перейти к теме на карте</MenuRow>
      </>
    );
  } else if (menu.kind === 'set') {
    const s = state.sets.find((x) => x.id === menu.setId)!;
    body = (
      <>
        <MenuRow disabled={s.status !== 'active' || s.kind !== 'practice'} hint={`${MOD}+↵`} onClick={run(() => actions.submitSet(s.id))}>Отправить</MenuRow>
        <MenuRow disabled={s.status !== 'graded'} onClick={run(() => actions.collapseSet(s.id))}>Свернуть в итог</MenuRow>
      </>
    );
  } else if (menu.kind === 'mock') {
    const s = state.sets.find((x) => x.id === menu.setId)!;
    body = (
      <>
        <MenuRow disabled={s.status !== 'active'} onClick={run(() => actions.finishMock(s.id))}>Завершить интервью</MenuRow>
        <MenuRow disabled={s.status !== 'graded'} onClick={run(() => actions.collapseSet(s.id))}>Свернуть в итог</MenuRow>
      </>
    );
  } else if (menu.kind === 'result') {
    body = <MenuRow onClick={run(() => actions.expandSet(menu.setId))}>Развернуть</MenuRow>;
  } else {
    body = (
      <>
        <MenuRow onClick={run(() => p.setChatCollapsed(!p.chatCollapsed))}>{p.chatCollapsed ? 'Развернуть' : 'Свернуть'}</MenuRow>
        <MenuRow onClick={run(actions.newChatTopic)}>Новая тема разговора</MenuRow>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div ref={ref} role="menu" className="absolute w-60 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,.12)]" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}

/* ---------------- Dialogs ---------------- */

function Modal({ title, close, children, width = 560 }: { title: string; close: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/15" onMouseDown={close}>
      <div className="fade-in max-h-[85vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button onClick={close} className="ml-auto rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['Инструменты', [['Выделение', 'V'], ['Рука', 'H'], ['Подборка на сегодня', 'P'], ['Мок-интервью', 'M'], ['Исследовать', 'R'], ['Банк / Предложено', 'B'], ['Холст ⇄ Карта навыков', 'K'], ['Показать или скрыть чат', 'C'], ['Квиз', 'Q']]],
  ['Холст', [['Двигать', 'колесо / пробел + тащить / средняя кнопка'], ['Масштаб', `${MOD} + колесо, щипок`], ['Приблизить / отдалить', `${MOD} + / ${MOD} −`], ['Масштаб 100%', `${MOD} 0`], ['Показать всё', '⇧1'], ['К выделенному', '⇧2'], ['Выделить рамкой', 'тащить по пустому месту']]],
  ['Карточки', [['Начать ответ на карточке в фокусе', '↵'], ['Отправить подборку / ответить в моке', `${MOD} ↵`], ['Снять выделение, закрыть меню', 'Esc'], ['Действия с карточкой', 'правый клик']]],
  ['Вид', [['Сетка', `${MOD} '`], ['Дзен-режим', 'Alt+Z'], ['Эта справка', '?']]],
];

function ShortcutsDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Горячие клавиши" close={close} width={720}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {SHORTCUTS.map(([g, rows]) => (
          <div key={g}>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-400">{g}</div>
            {rows.map(([a, k]) => <div key={a} className="flex justify-between gap-4 border-b border-stone-100 py-1.5 text-[13px]"><span className="text-stone-700">{a}</span><Kbd>{k}</Kbd></div>)}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-stone-400">Пока курсор в поле ответа, буквенные клавиши печатают текст и не срабатывают как команды.</p>
    </Modal>
  );
}

function SettingsDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Настройки" close={close} width={460}>
      <div className="space-y-3 text-[13px]">
        {[['Агент', 'Claude Code (подписка)'], ['Язык интервью', 'Русский'], ['Строгость проверяющего', 'Как на реальном собеседовании'], ['Длина подборки', '4 вопроса']].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2"><span className="text-stone-500">{k}</span><span className="font-medium">{v}</span></div>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-stone-400">Прототип: настройки только для вида.</p>
    </Modal>
  );
}

function CustomQuestionDialog({ close }: { close: () => void }) {
  const { actions } = useStore();
  const [text, setText] = useState('');
  return (
    <Modal title="Свой вопрос" close={close} width={480}>
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: «Как бы вы версионировали промпты в продакшене?»" className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[13.5px] outline-none focus:border-indigo-300 focus:bg-white" />
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={close} className="rounded-lg px-3 py-1.5 text-[13px] text-stone-500 hover:bg-stone-100">Отмена</button>
        <button disabled={!text.trim()} onClick={() => { actions.addCustom(text.trim()); close(); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:bg-stone-300">Добавить на холст</button>
      </div>
    </Modal>
  );
}

/* ---------------- Canvas ---------------- */

const nodeTypes = { chat: ChatNode, region: RegionNode, result: ResultNode, mockHead: MockHeadNode, mockCard: MockCardNode, empty: EmptyNode };

function CanvasA({ tool, grid, chatHidden }: { tool: Tool; grid: boolean; chatHidden: boolean }) {
  const { state } = useStore();
  const { openMenu } = useUi();
  const key = useStructureKey();
  const rf = useReactFlow();

  const derived = useMemo<Node[]>(() => {
    const ns: Node[] = [];
    if (!chatHidden) ns.push({ id: 'chat', type: 'chat', position: { x: 0, y: 0 }, data: {}, dragHandle: '.drag', style: { width: 340 } });
    const sets = currentSets(state);
    if (!sets.length) ns.push({ id: 'empty', type: 'empty', position: { x: 420, y: 40 }, data: {}, draggable: false, selectable: false });
    for (const s of sets) {
      if (s.status === 'collapsed') { ns.push({ id: `set-${s.id}`, type: 'result', position: { x: 0, y: 0 }, data: { setId: s.id } }); continue; }
      if (s.kind === 'mock') {
        ns.push({ id: `set-${s.id}`, type: 'mockHead', position: { x: 0, y: 0 }, data: { setId: s.id }, style: { width: 400 } });
        s.cardIds.forEach((cid, i) => ns.push({ id: `card-${cid}`, type: 'mockCard', position: { x: 0, y: 0 }, data: { cardId: cid, setId: s.id, step: i }, draggable: false, style: { width: 400 } }));
      } else {
        ns.push({ id: `set-${s.id}`, type: 'region', position: { x: 0, y: 0 }, data: { setId: s.id }, dragHandle: '.drag', style: { width: s.cardIds.length > 3 ? 760 : 400 } });
      }
    }
    return ns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, chatHidden]);

  const [nodes, , onNodesChange] = useSyncedNodes(derived, (n, existing) => {
    if (n.id === 'chat') return { x: 0, y: 0 };
    if (n.type === 'mockCard') {
      const head = existing.find((e) => e.id === `set-${n.data.setId}`);
      return { x: head?.position.x ?? 0, y: (head?.position.y ?? 0) + 130 };
    }
    const others = existing.filter((e) => e.type !== 'mockCard' && e.type !== 'empty' && e.id !== n.id);
    return { x: Math.max(420, rightEdge(others) + 80), y: 0 };
  }, stackMockCards);

  const edges = useMemo<Edge[]>(() => {
    const es: Edge[] = [];
    for (const s of currentSets(state)) {
      if (s.kind !== 'mock' || s.status === 'collapsed') continue;
      s.cardIds.forEach((cid, i) => {
        const from = i === 0 ? `set-${s.id}` : `card-${s.cardIds[i - 1]}`;
        es.push({ id: `e-${cid}`, source: from, target: `card-${cid}`, animated: s.status === 'active', selectable: false, style: { stroke: '#a5b4fc', strokeWidth: 1.5 }, label: i === 0 ? undefined : 'уточнение', labelStyle: { fontSize: 10, fill: '#78716c' }, labelBgStyle: { fill: '#f7f6f3' } });
      });
    }
    return es;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!state.focus) return;
    const c = state.cards[state.focus.cardId];
    const set = c && state.sets.find((x) => x.id === c.setId);
    if (!set || set.status === 'archived') return;
    const id = set.kind === 'mock' && set.status !== 'collapsed' ? `card-${c.id}` : `set-${set.id}`;
    const extra = set.kind === 'mock' ? [{ id: `set-${set.id}` }] : chatHidden ? [] : [{ id: 'chat' }];
    const t = setTimeout(() => rf.fitView({ nodes: [{ id }, ...extra], duration: 600, padding: FIT_PAD, maxZoom: 1 }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focus?.nonce]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      fitView
      fitViewOptions={{ maxZoom: 1, padding: FIT_PAD }}
      minZoom={0.1}
      maxZoom={2}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      zoomActivationKeyCode={['Meta', 'Control']}
      panActivationKeyCode="Space"
      panOnDrag={tool === 'hand' ? [0, 1] : [1]}
      selectionOnDrag={tool === 'select'}
      selectionMode={SelectionMode.Partial}
      nodesDraggable={tool === 'select'}
      elementsSelectable={tool === 'select'}
      multiSelectionKeyCode="Shift"
      deleteKeyCode={null}
      nodesConnectable={false}
      className={tool === 'hand' ? 'tool-hand' : ''}
      proOptions={{ hideAttribution: true }}
      onPaneContextMenu={(e) => { e.preventDefault(); openMenu({ kind: 'pane', x: e.clientX, y: e.clientY }); }}
      onNodeContextMenu={(e, node) => {
        const t = e.target as HTMLElement;
        if (t.closest('textarea, input')) return; // keep the native menu for text editing
        e.preventDefault();
        const cardEl = t.closest('[data-card-id]') as HTMLElement | null;
        const at = { x: e.clientX, y: e.clientY };
        if (cardEl) return openMenu({ kind: 'card', cardId: cardEl.dataset.cardId!, ...at });
        const setId = node.data.setId as string;
        if (node.type === 'region') return openMenu({ kind: 'set', setId, ...at });
        if (node.type === 'mockHead') return openMenu({ kind: 'mock', setId, ...at });
        if (node.type === 'result') return openMenu({ kind: 'result', setId, ...at });
        if (node.type === 'chat') return openMenu({ kind: 'chat', ...at });
        openMenu({ kind: 'pane', ...at });
      }}
      onSelectionContextMenu={(e) => { e.preventDefault(); openMenu({ kind: 'pane', x: e.clientX, y: e.clientY }); }}
    >
      {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d6d3d1" />}
    </ReactFlow>
  );
}

/** Mock interview Cards hang below their header as a thread; dragging the header moves the thread. */
function stackMockCards(ns: Node[]): Node[] {
  const pos = new Map<string, { x: number; y: number }>();
  for (const head of ns.filter((n) => n.type === 'mockHead')) {
    let y = head.position.y + (head.measured?.height ?? 80) + 56;
    ns.filter((n) => n.type === 'mockCard' && n.data.setId === head.data.setId)
      .sort((a, b) => (a.data.step as number) - (b.data.step as number))
      .forEach((c) => {
        pos.set(c.id, { x: head.position.x + (c.data.step as number) * 40, y });
        y += (c.measured?.height ?? 260) + 56;
      });
  }
  return ns.map((n) => { const p = pos.get(n.id); return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n; });
}

/** Focusable Card shell: Tab moves between Cards, Enter starts typing. */
function CardShell({ cardId, children, className }: { cardId: string; children: ReactNode; className?: string }) {
  return (
    <div data-card-id={cardId} tabIndex={0} className={cx('outline-none focus-visible:ring-2 focus-visible:ring-indigo-300', className)}>
      {children}
    </div>
  );
}

function ChatNode() {
  const { state } = useStore();
  const { chatCollapsed, setChatCollapsed } = useUi();
  if (chatCollapsed) {
    const last = state.chat.at(-1);
    return (
      <button onClick={() => setChatCollapsed(false)} className="drag flex w-[340px] items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">И</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-stone-500">{state.typing ? 'печатает…' : last?.text}</span>
        <span className="text-[11px] text-stone-400">развернуть</span>
      </button>
    );
  }
  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.04)]">
      <div className="drag flex cursor-grab items-center gap-2 border-b border-stone-100 px-4 py-3 active:cursor-grabbing">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">И</span>
        <span className="text-[13px] font-semibold">Интервьюер</span>
        <button onClick={() => setChatCollapsed(true)} title="Свернуть" className="nodrag ml-auto rounded px-1.5 text-[13px] text-stone-300 hover:bg-stone-100 hover:text-stone-500">–</button>
      </div>
      <ChatThread />
    </div>
  );
}

function RegionNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const answered = s.cardIds.filter((id) => { const c = state.cards[id]; return c.text.trim() || c.choice.length || c.state === 'graded' || c.state === 'skipped'; }).length;
  const sc = setScore(state, s);
  const wide = s.cardIds.length > 3;
  return (
    <div className="rounded-[22px] border border-stone-200/80 bg-stone-200/30 p-3">
      <div className="drag flex cursor-grab items-center gap-3 px-2 pb-3 pt-1 active:cursor-grabbing">
        <div>
          <div className="text-[14px] font-semibold">{s.title}</div>
          <div className="text-[12px] text-stone-500">
            {s.kind === 'quiz' ? 'Квиз · тесты проверяются сразу' : 'Отвечайте в любом порядке'} · {s.status === 'active' ? `отвечено ${answered} из ${s.cardIds.length}` : s.status === 'grading' ? 'проверяется…' : `итог ${sc.got}/${sc.max}`}
          </div>
        </div>
        <div className="ml-auto">
          {s.status === 'active' && s.kind === 'practice' && (
            <button disabled={!answered} onClick={() => actions.submitSet(s.id)} title={`Отправить — ${MOD}+Enter`} className="nodrag whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium text-white disabled:bg-stone-300">Отправить <span className="ml-1 text-[11px] text-indigo-200">{MOD}↵</span></button>
          )}
          {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-3 py-1.5 text-[12.5px] text-stone-500 hover:bg-white">Свернуть в итог</button>}
        </div>
      </div>
      <div className={cx('grid gap-3', wide ? 'grid-cols-2' : 'grid-cols-1')}>
        {s.cardIds.map((id) => (
          <CardShell key={id} cardId={id} className="rounded-2xl border border-stone-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]">
            <CardBody cardId={id} />
          </CardShell>
        ))}
      </div>
    </div>
  );
}

function ResultNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  return (
    <div className="fade-in w-[250px] rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Ring value={sc.got / sc.max} size={42}>{sc.got}</Ring>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{s.title}</div>
          <div className="text-[11.5px] text-stone-400">итог {sc.got}/{sc.max} · день {s.day}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-1">
        {s.cardIds.map((id) => { const c = state.cards[id]; return <span key={id} title={mockQuestion(state, c.qid).text} className={cx('h-1.5 flex-1 rounded-full', c.state === 'skipped' ? 'bg-stone-200' : (c.score ?? 0) === 3 ? 'bg-emerald-400' : (c.score ?? 0) >= 2 ? 'bg-amber-400' : 'bg-rose-400')} />; })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11.5px]">
        <span className="text-stone-400">уйдёт в историю сам</span>
        <button className="nodrag text-indigo-600" onClick={() => actions.expandSet(s.id)}>Развернуть</button>
      </div>
    </div>
  );
}

function MockHeadNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3">
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-indigo-300" />
      <div className="flex items-center gap-3">
        <span className={cx('h-2 w-2 rounded-full', s.status === 'active' ? 'animate-pulse bg-rose-500' : 'bg-stone-300')} />
        <div className="text-[14px] font-semibold">Мок-интервью</div>
        <div className="ml-auto font-mono text-[13px] text-stone-600"><Timer from={s.startedAt} to={s.finishedAt} /></div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[12px] text-stone-500">
        <span>{s.status === 'active' ? `вопрос ${s.cardIds.length} · оценки в конце` : s.status === 'grading' ? 'проверяющий оценивает…' : `итог ${sc.got}/${sc.max}`}</span>
        {s.status === 'active' && <button onClick={() => actions.finishMock(s.id)} className={cx('nodrag rounded-lg px-3 py-1 text-[12.5px] font-medium', s.mockDone ? 'bg-indigo-600 text-white' : 'text-stone-500 hover:bg-white')}>Завершить</button>}
        {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-3 py-1 text-[12.5px] text-stone-500 hover:bg-white">Свернуть в итог</button>}
      </div>
    </div>
  );
}

function MockCardNode({ data }: NodeProps) {
  return (
    <CardShell cardId={data.cardId as string} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-indigo-300" />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-indigo-300" />
      <CardBody cardId={data.cardId as string} />
    </CardShell>
  );
}

function EmptyNode() {
  const { state, actions } = useStore();
  return (
    <div className="w-[380px] rounded-2xl border border-dashed border-stone-300 p-6 text-center">
      <div className="text-[14px] font-medium text-stone-600">На холсте пока пусто</div>
      <p className="mt-1 text-[12.5px] text-stone-400">Здесь появятся подборки, мок-интервью и последние итоги. В повторении {dueTotal(state)} вопросов.</p>
      <button onClick={actions.startDaily} className="nodrag mt-4 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium text-white">Подборка на сегодня <span className="ml-1 text-[11px] text-indigo-200">P</span></button>
      <p className="mt-3 text-[11.5px] text-stone-400">Правый клик по холсту — все действия</p>
    </div>
  );
}

/* ---------------- Skill map (separate view) with bank + Proposed ---------------- */

function SkillMapA({ tab, setTab, highlight }: { tab: 'proposed' | 'bank'; setTab: (t: 'proposed' | 'bank') => void; highlight: string | null }) {
  const { state, actions } = useStore();
  const [open, setOpen] = useState<string | null>(highlight);
  const topics = state.topics.filter((t) => t.targets.includes(state.targetId));
  const groups = [...new Set(topics.map((t) => t.group))];
  const proposedN = state.proposed.filter((p) => p.targetId === state.targetId).length;
  const bank = useBank();
  useEffect(() => {
    if (!highlight) return;
    setOpen(highlight);
    document.getElementById(`topic-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  return (
    <div className="flex h-full pt-24">
      <div className="min-w-0 flex-1 overflow-y-auto px-10 pb-20 pt-2">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-[20px] font-semibold">Карта навыков</h2>
            <p className="text-[13px] text-stone-500">Цвет показывает освоение темы, бейдж — сколько вопросов пора повторить.</p>
          </div>
          <div className="flex gap-4 text-[12px] text-stone-500">
            {[0.2, 0.55, 0.85].map((m) => <span key={m} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: heat(m).stroke }} />{heat(m).label}</span>)}
          </div>
        </div>
        {groups.map((g) => (
          <section key={g} className="mb-8">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-stone-400">{g}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {topics.filter((t) => t.group === g).map((t) => (
                <div key={t.id} id={`topic-${t.id}`} className={cx('group rounded-2xl border bg-white p-4 transition hover:shadow-sm', highlight === t.id ? 'focus-pulse border-indigo-300 ring-2 ring-indigo-200' : 'border-stone-200')}>
                  <div className="flex items-center gap-3">
                    <Ring value={t.mastery} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium leading-snug">{t.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11.5px]">
                        <span className={heat(t.mastery).text}>{heat(t.mastery).label}</span>
                        {t.due > 0 && <span className="rounded-full bg-indigo-50 px-1.5 font-medium text-indigo-700">{t.due} к повторению</span>}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => actions.practiceTopic(t.id)} className="mt-3 w-full rounded-lg border border-stone-200 py-1.5 text-[12.5px] text-stone-600 transition hover:border-indigo-300 hover:text-indigo-700">Потренировать</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className="mb-20 mr-4 flex w-[380px] shrink-0 flex-col rounded-2xl border border-stone-200 bg-white">
        <div className="flex gap-1 border-b border-stone-100 p-2 text-[13px]">
          <button onClick={() => setTab('proposed')} className={cx('flex-1 rounded-lg py-1.5', tab === 'proposed' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Предложено {proposedN > 0 && <span className="ml-1 rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{proposedN}</span>}</button>
          <button onClick={() => setTab('bank')} className={cx('flex-1 rounded-lg py-1.5', tab === 'bank' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Банк вопросов</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {tab === 'proposed' ? (
            <>
              <p className="py-3 text-[12px] text-stone-500">Найдено агентом. В банк попадёт только одобренное.</p>
              <ProposedList />
              <div className="flex gap-2 py-4">
                {proposedN > 1 && <button onClick={actions.approveAll} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white">Одобрить все</button>}
                <button onClick={actions.research} className="rounded-lg px-3 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">{state.researching ? 'Исследую…' : 'Исследовать ещё'} <span className="text-stone-400">R</span></button>
              </div>
            </>
          ) : (
            <ul className="py-2">
              {bank.map(({ topic, questions }) => (
                <li key={topic.id}>
                  <button onClick={() => setOpen(open === topic.id ? null : topic.id)} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-stone-50', open === topic.id && 'bg-stone-50')}>
                    <span className="h-2 w-2 rounded-full" style={{ background: heat(topic.mastery).stroke }} />
                    <span className="flex-1">{topic.name}</span>
                    <span className="text-[11.5px] text-stone-400">{questions.length}</span>
                  </button>
                  {open === topic.id && (
                    <ul className="mb-2 ml-6 space-y-1.5">
                      {questions.map((q) => <li key={q.id} className="text-[12.5px] leading-snug text-stone-600">{q.text} <span className="text-stone-300">· {q.type === 'open' ? 'ответ' : 'тест'}</span></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
