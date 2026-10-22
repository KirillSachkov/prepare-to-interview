// PROTOTYPE variant C «Столы»:
// the Canvas is split into fixed zones (Практика / Мок / Чат / Итоги); items snap into their zone.
// The Control panel is a ⌘K command palette plus a minimal corner widget.
// A Practice set is a deck: one Card at a time with numbered tabs.
// Question bank and Proposed queue live in a right-hand drawer; the Skill map is a heat table overlay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { TARGETS } from '../model/data';
import { currentSets, dueTotal, historySets, mockQuestion, readiness, setScore, target, useStore, useStructureKey } from '../model/store';
import { useSyncedNodes } from '../shared/flow';
import { CardBody, ChatThread, ProposedList, Ring, Timer, cx, heat, useBank } from '../shared/ui';

export const variantCName = 'Столы';

type ZoneId = 'practice' | 'mock' | 'chat' | 'results';
const ZONES: Record<ZoneId, { label: string; x: number; y: number; w: number; h: number; empty: string }> = {
  practice: { label: 'Практика', x: 0, y: 0, w: 940, h: 760, empty: 'Подборки и квизы появятся здесь. ⌘K → «Подборка на сегодня»' },
  mock: { label: 'Мок', x: 980, y: 0, w: 480, h: 1500, empty: 'Мок-интервью идёт здесь. ⌘K → «Мок-интервью»' },
  chat: { label: 'Чат', x: 1500, y: 0, w: 420, h: 760, empty: '' },
  results: { label: 'Итоги', x: 0, y: 800, w: 940, h: 700, empty: 'Свёрнутые итоги. Старые уходят в историю сами.' },
};

function slotPos(zone: ZoneId, slot: number) {
  const z = ZONES[zone];
  if (zone === 'practice') return { x: z.x + 24 + (slot % 2) * 452, y: z.y + 64 + Math.floor(slot / 2) * 420 };
  if (zone === 'mock') return { x: z.x + 24 + (slot > 0 ? 16 : 0), y: z.y + 64 + (slot === 0 ? 0 : 96 + (slot - 1) * 300) };
  if (zone === 'chat') return { x: z.x + 20, y: z.y + 56 };
  return { x: z.x + 24 + (slot % 4) * 224, y: z.y + 64 + Math.floor(slot / 4) * 150 };
}

export function VariantC() {
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState<null | 'proposed' | 'bank'>(null);
  const [map, setMap] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); }
      if (e.key === 'Escape') { setPalette(false); setDrawer(null); setMap(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="relative h-full bg-[#fafaf9]">
      <ZonesCanvas />
      <CornerWidget onPalette={() => setPalette(true)} onDrawer={() => setDrawer('proposed')} onMap={() => setMap(true)} />
      {map && <HeatMap onClose={() => setMap(false)} />}
      {drawer && <Drawer tab={drawer} setTab={setDrawer} />}
      {palette && <Palette onClose={() => setPalette(false)} openDrawer={setDrawer} openMap={() => setMap(true)} />}
    </div>
  );
}

/* ---------------- Control panel: corner widget + ⌘K palette ---------------- */

function CornerWidget({ onPalette, onDrawer, onMap }: { onPalette: () => void; onDrawer: () => void; onMap: () => void }) {
  const { state } = useStore();
  const t = target(state);
  const r = readiness(state);
  const n = state.proposed.filter((p) => p.targetId === state.targetId).length;
  return (
    <div className="absolute bottom-5 left-4 z-20 flex items-center gap-1 rounded-2xl border border-stone-200 bg-white/90 p-1.5 pr-2 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2.5 px-2">
        <Ring value={r / 100} size={30} stroke={3} color="#4f46e5"><span className="text-[9px]">{r}</span></Ring>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold">{t.name}</div>
          <div className="text-[11px] text-stone-400">{t.daysLeft ? `через ${t.daysLeft} дн.` : t.grade} · {dueTotal(state)} к повторению</div>
        </div>
      </div>
      <span className="mx-1 h-6 w-px bg-stone-200" />
      <button onClick={onMap} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">Карта</button>
      <button onClick={onDrawer} className="relative rounded-lg px-2.5 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">
        Банк{n > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
      </button>
      <button onClick={onPalette} className="ml-1 flex items-center gap-1.5 rounded-lg bg-stone-900 px-2.5 py-1.5 text-[12.5px] text-white">
        Действия <kbd className="rounded bg-white/20 px-1 font-sans text-[10.5px]">⌘K</kbd>
      </button>
    </div>
  );
}

function Palette({ onClose, openDrawer, openMap }: { onClose: () => void; openDrawer: (t: 'proposed' | 'bank') => void; openMap: () => void }) {
  const { state, actions } = useStore();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const n = state.proposed.filter((p) => p.targetId === state.targetId).length;
  const cmds = useMemo(() => {
    const list: { group: string; label: string; hint?: string; run: () => void }[] = [
      { group: 'Начать', label: 'Подборка на сегодня', hint: `${dueTotal(state)} к повторению`, run: actions.startDaily },
      { group: 'Начать', label: 'Мок-интервью', hint: '3 вопроса, таймер', run: actions.startMock },
      { group: 'Начать', label: 'Квиз', hint: '4 теста', run: actions.startQuiz },
      { group: 'Банк', label: 'Предложено агентом', hint: n ? `${n} ждут одобрения` : 'пусто', run: () => openDrawer('proposed') },
      { group: 'Банк', label: 'Банк вопросов', run: () => openDrawer('bank') },
      { group: 'Банк', label: 'Исследовать', hint: 'найти новые вопросы', run: actions.research },
      { group: 'Вид', label: 'Карта навыков', run: openMap },
      ...TARGETS.filter((t) => t.id !== state.targetId).map((t) => ({ group: 'Цель', label: `Переключить цель: ${t.name}`, run: () => actions.setTarget(t.id) })),
      { group: 'Цель', label: 'Новая цель', run: actions.newTarget },
      ...state.topics.filter((t) => t.targets.includes(state.targetId)).map((t) => ({ group: 'Потренировать тему', label: `Потренировать: ${t.name}`, hint: `${Math.round(t.mastery * 100)}%`, run: () => actions.practiceTopic(t.id) })),
    ];
    const f = q.trim().toLowerCase();
    return f ? list.filter((c) => c.label.toLowerCase().includes(f)) : list.filter((c) => c.group !== 'Потренировать тему');
  }, [q, state, actions, n, openDrawer, openMap]);
  const run = (k: number) => { cmds[k]?.run(); onClose(); };
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-40 bg-stone-900/10 backdrop-blur-[1px]" onMouseDown={onClose}>
      <div className="fade-in mx-auto mt-[14vh] w-[560px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(cmds.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') run(i);
          }}
          placeholder="Что сделать? Например, «индексы» или «мок»"
          className="w-full border-b border-stone-100 px-5 py-4 text-[15px] outline-none placeholder:text-stone-400"
        />
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {cmds.map((c, k) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.label}>
                {head && <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-stone-400">{head}</div>}
                <button onMouseEnter={() => setI(k)} onClick={() => run(k)} className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-[13.5px]', k === i ? 'bg-indigo-50 text-indigo-800' : 'text-stone-700')}>
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className="text-[12px] text-stone-400">{c.hint}</span>}
                </button>
              </div>
            );
          })}
          {!cmds.length && <div className="px-3 py-4 text-[13px] text-stone-400">Ничего не найдено</div>}
        </div>
        <div className="flex gap-4 border-t border-stone-100 px-5 py-2 text-[11px] text-stone-400"><span>↑↓ выбрать</span><span>↵ выполнить</span><span>esc закрыть</span><span className="ml-auto">поиск по темам: введите название</span></div>
      </div>
    </div>
  );
}

/* ---------------- Canvas with zones ---------------- */

const nodeTypes = { zone: ZoneNode, deck: DeckNode, mockHead: MockHead, mockCard: MockCard, chat: ChatNode, result: ResultTile };

function ZonesCanvas() {
  const { state } = useStore();
  const key = useStructureKey();
  const rf = useReactFlow();

  const derived = useMemo<Node[]>(() => {
    const ns: Node[] = (Object.keys(ZONES) as ZoneId[]).map((z) => ({ id: `zone-${z}`, type: 'zone', position: { x: ZONES[z].x, y: ZONES[z].y }, data: { zone: z, pin: true }, draggable: false, selectable: false, zIndex: -1, style: { width: ZONES[z].w, height: ZONES[z].h, pointerEvents: 'none' } }));
    ns.push({ id: 'chat', type: 'chat', position: slotPos('chat', 0), data: { zone: 'chat', slot: 0 }, dragHandle: '.drag', style: { width: 380 } });
    const sets = currentSets(state);
    let p = 0, r = 0;
    for (const s of sets) {
      if (s.status === 'collapsed') { const slot = r++; ns.push({ id: `res-${s.id}`, type: 'result', position: slotPos('results', slot), data: { setId: s.id, zone: 'results', slot }, style: { width: 208 } }); continue; }
      if (s.kind === 'mock') {
        ns.push({ id: `mock-${s.id}`, type: 'mockHead', position: slotPos('mock', 0), data: { setId: s.id, zone: 'mock', slot: 0 }, style: { width: 432 } });
        s.cardIds.forEach((cid, i) => ns.push({ id: `card-${cid}`, type: 'mockCard', position: slotPos('mock', i + 1), data: { cardId: cid, setId: s.id, zone: 'mock', slot: i + 1 }, draggable: false, style: { width: 416 } }));
      } else { const slot = p++; ns.push({ id: `deck-${s.id}`, type: 'deck', position: slotPos('practice', slot), data: { setId: s.id, zone: 'practice', slot }, dragHandle: '.drag', style: { width: 428 } }); }
    }
    return ns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [nodes, setNodes, onNodesChange] = useSyncedNodes(derived, (n) => n.position, stackMock);

  const edges = useMemo<Edge[]>(() => {
    const es: Edge[] = [];
    for (const s of currentSets(state)) {
      if (s.kind !== 'mock' || s.status === 'collapsed') continue;
      s.cardIds.forEach((cid, i) => es.push({ id: `e-${cid}`, source: i === 0 ? `mock-${s.id}` : `card-${s.cardIds[i - 1]}`, target: `card-${cid}`, type: 'smoothstep', animated: s.status === 'active', style: { stroke: '#a5b4fc', strokeWidth: 1.5 } }));
    }
    return es;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!state.focus) return;
    const c = state.cards[state.focus.cardId];
    const set = c && state.sets.find((x) => x.id === c.setId);
    if (!set || set.status === 'archived') return;
    const id = set.status === 'collapsed' ? `res-${set.id}` : set.kind === 'mock' ? `card-${c.id}` : `deck-${set.id}`;
    const nodesToFit = set.kind === 'mock' && set.status !== 'collapsed' ? [{ id }, { id: `mock-${set.id}` }] : [{ id }];
    const t = setTimeout(() => rf.fitView({ nodes: nodesToFit, duration: 600, padding: 0.3, maxZoom: 1 }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focus?.nonce]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      snapToGrid
      snapGrid={[16, 16]}
      onNodeDragStop={(_, node) => {
        const zone = node.data.zone as ZoneId | undefined;
        if (!zone) return;
        const z = ZONES[zone];
        const w = node.measured?.width ?? 300;
        const h = node.measured?.height ?? 200;
        const inside = node.position.x >= z.x && node.position.y >= z.y + 40 && node.position.x + w <= z.x + z.w && node.position.y + h <= z.y + z.h + 40;
        if (!inside) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: slotPos(zone, node.data.slot as number) } : n)));
      }}
      fitView
      fitViewOptions={{ nodes: [{ id: 'zone-practice' }, { id: 'zone-chat' }], padding: 0.04 }}
      minZoom={0.25}
      maxZoom={1.3}
      panOnScroll
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e7e5e4" />
    </ReactFlow>
  );
}

/** Mock Cards hang below the mock header as a thread, spaced by their measured height. */
function stackMock(ns: Node[]): Node[] {
  const pos = new Map<string, { x: number; y: number }>();
  for (const head of ns.filter((n) => n.type === 'mockHead')) {
    let y = head.position.y + (head.measured?.height ?? 64) + 36;
    ns.filter((n) => n.type === 'mockCard' && n.data.setId === head.data.setId)
      .sort((a, b) => (a.data.slot as number) - (b.data.slot as number))
      .forEach((c) => { pos.set(c.id, { x: head.position.x + 16, y }); y += (c.measured?.height ?? 240) + 28; });
  }
  return ns.map((n) => { const p = pos.get(n.id); return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n; });
}

function ZoneNode({ data }: NodeProps) {
  const { state } = useStore();
  const z = ZONES[data.zone as ZoneId];
  const sets = currentSets(state);
  const empty =
    data.zone === 'practice' ? !sets.some((s) => s.kind !== 'mock' && s.status !== 'collapsed')
    : data.zone === 'mock' ? !sets.some((s) => s.kind === 'mock' && s.status !== 'collapsed')
    : data.zone === 'results' ? !sets.some((s) => s.status === 'collapsed')
    : false;
  const extra = data.zone === 'results' ? ` · в истории ${historySets(state).length}` : '';
  return (
    <div className="h-full w-full rounded-[28px] border border-stone-200/70 bg-stone-100/60">
      <div className="px-6 pt-5 text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-400">{z.label}<span className="font-normal normal-case tracking-normal">{extra}</span></div>
      {empty && <div className="grid h-[calc(100%-60px)] place-items-center px-10 text-center text-[13px] text-stone-400">{z.empty}</div>}
    </div>
  );
}

function DeckNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const [tab, setTab] = useState(0);
  const sc = setScore(state, s);
  const focus = state.focus;
  useEffect(() => {
    if (focus && s.cardIds.includes(focus.cardId)) setTab(s.cardIds.indexOf(focus.cardId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  const answered = s.cardIds.filter((id) => { const c = state.cards[id]; return c.text.trim() || c.choice.length; }).length;
  const cardId = s.cardIds[tab];
  return (
    <div className="relative">
      {/* stacked sheets behind the deck */}
      <div className="absolute inset-x-3 -bottom-2 h-6 rounded-2xl border border-stone-200 bg-white/70" />
      <div className="absolute inset-x-1.5 -bottom-1 h-6 rounded-2xl border border-stone-200 bg-white/90" />
      <div className="relative rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="drag flex cursor-grab items-center gap-2 px-4 pb-2 pt-3.5 active:cursor-grabbing">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{s.title}</div>
            <div className="text-[11.5px] text-stone-400">{s.status === 'active' ? (s.kind === 'quiz' ? 'тесты проверяются сразу' : `отвечено ${answered} из ${s.cardIds.length} · в любом порядке`) : s.status === 'grading' ? 'проверяется…' : `итог ${sc.got}/${sc.max}`}</div>
          </div>
          {s.status === 'active' && s.kind === 'practice' && <button disabled={!answered} onClick={() => actions.submitSet(s.id)} className="nodrag rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:bg-stone-300">Отправить</button>}
          {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-2.5 py-1.5 text-[12px] text-stone-500 hover:bg-stone-100">В итоги ↓</button>}
        </div>
        <div className="nodrag flex gap-1.5 px-4 pb-3">
          {s.cardIds.map((id, k) => {
            const c = state.cards[id];
            const filled = c.text.trim() || c.choice.length;
            const color = c.state === 'graded' ? ((c.score ?? 0) === 3 ? 'bg-emerald-100 text-emerald-700' : (c.score ?? 0) >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700') : c.state === 'skipped' ? 'bg-stone-100 text-stone-400' : filled ? 'bg-indigo-50 text-indigo-700' : 'bg-stone-50 text-stone-400';
            return <button key={id} onClick={() => setTab(k)} className={cx('h-7 flex-1 rounded-lg text-[12px] font-medium transition', color, k === tab && 'ring-2 ring-stone-800/70')}>{c.state === 'graded' ? `${c.score}/3` : k + 1}</button>;
          })}
        </div>
        <div className="border-t border-stone-100 px-4 py-4"><CardBody cardId={cardId} /></div>
        <div className="nodrag flex justify-between px-4 pb-3 text-[12px] text-stone-400">
          <button disabled={tab === 0} onClick={() => setTab(tab - 1)} className="disabled:opacity-30">← предыдущий</button>
          <button disabled={tab === s.cardIds.length - 1} onClick={() => setTab(tab + 1)} className="disabled:opacity-30">следующий →</button>
        </div>
      </div>
    </div>
  );
}

function MockHead({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-white">
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <span className={cx('h-2 w-2 rounded-full', s.status === 'active' ? 'animate-pulse bg-rose-400' : 'bg-stone-500')} />
      <div className="flex-1">
        <div className="text-[13.5px] font-semibold">Мок-интервью</div>
        <div className="text-[11.5px] text-stone-400">{s.status === 'active' ? `вопрос ${s.cardIds.length} · оценки в конце` : s.status === 'grading' ? 'проверяется…' : `итог ${sc.got}/${sc.max}`}</div>
      </div>
      <span className="font-mono text-[15px] tabular-nums"><Timer from={s.startedAt} to={s.finishedAt} /></span>
      {s.status === 'active' && <button onClick={() => actions.finishMock(s.id)} className={cx('nodrag rounded-lg px-2.5 py-1 text-[12px] font-medium', s.mockDone ? 'bg-white text-stone-900' : 'text-stone-300 hover:bg-white/10')}>Завершить</button>}
      {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-2.5 py-1 text-[12px] text-stone-300 hover:bg-white/10">В итоги ↓</button>}
    </div>
  );
}

function MockCard({ data }: NodeProps) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <CardBody cardId={data.cardId as string} dense />
    </div>
  );
}

function ChatNode() {
  return (
    <div className="flex h-[680px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="drag flex cursor-grab items-center gap-2 border-b border-stone-100 px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">И</span>
        <span className="text-[13px] font-semibold">Интервьюер</span>
      </div>
      <ChatThread compact />
    </div>
  );
}

function ResultTile({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  return (
    <div className="fade-in rounded-2xl border border-stone-200 bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <Ring value={sc.got / sc.max} size={36}>{sc.got}</Ring>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold">{s.title}</div>
          <div className="text-[11px] text-stone-400">{sc.got}/{sc.max} · день {s.day}</div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1">
        {s.cardIds.map((id) => { const c = state.cards[id]; return <button key={id} onClick={() => actions.discuss(id)} title={`Обсудить: ${mockQuestion(state, c.qid).text}`} className={cx('nodrag h-5 rounded text-[10px] font-medium', c.state === 'skipped' ? 'bg-stone-100 text-stone-400' : (c.score ?? 0) === 3 ? 'bg-emerald-100 text-emerald-700' : (c.score ?? 0) >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>{c.state === 'skipped' ? '–' : c.score}</button>; })}
      </div>
      <button onClick={() => actions.expandSet(s.id)} className="nodrag mt-2 text-[11.5px] text-indigo-600">Развернуть</button>
    </div>
  );
}

/* ---------------- Drawer: Proposed + Question bank ---------------- */

function Drawer({ tab, setTab }: { tab: 'proposed' | 'bank'; setTab: (t: null | 'proposed' | 'bank') => void }) {
  const { state, actions } = useStore();
  const bank = useBank();
  const [filter, setFilter] = useState('');
  const n = state.proposed.filter((p) => p.targetId === state.targetId).length;
  return (
    <div className="fixed inset-0 z-30" onMouseDown={() => setTab(null)}>
      <aside className="fade-in absolute bottom-3 right-3 top-3 flex w-[420px] flex-col rounded-2xl border border-stone-200 bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 border-b border-stone-100 p-2 text-[13px]">
          <button onClick={() => setTab('proposed')} className={cx('rounded-lg px-3 py-1.5', tab === 'proposed' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Предложено {n > 0 && <span className="ml-1 text-indigo-600">{n}</span>}</button>
          <button onClick={() => setTab('bank')} className={cx('rounded-lg px-3 py-1.5', tab === 'bank' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Банк вопросов</button>
          <button onClick={() => setTab(null)} className="ml-auto rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {tab === 'proposed' ? (
            <>
              <p className="pt-4 text-[12.5px] text-stone-500">Агент нашёл эти темы и вопросы. В банк попадёт только одобренное.</p>
              <ProposedList />
              <div className="flex gap-2 pb-5 pt-2">
                {n > 1 && <button onClick={actions.approveAll} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white">Одобрить все</button>}
                <button onClick={actions.research} className="rounded-lg px-3 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">{state.researching ? 'Исследую…' : 'Исследовать ещё'}</button>
              </div>
            </>
          ) : (
            <>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск по банку" className="mt-4 w-full rounded-lg bg-stone-100 px-3 py-2 text-[13px] outline-none" />
              {bank.map(({ topic, questions }) => {
                const qs = questions.filter((q) => q.text.toLowerCase().includes(filter.toLowerCase()) || topic.name.toLowerCase().includes(filter.toLowerCase()));
                if (!qs.length) return null;
                return (
                  <div key={topic.id} className="mt-4">
                    <div className="flex items-center gap-2 text-[12px] font-medium text-stone-500">
                      <span className="h-2 w-2 rounded-full" style={{ background: heat(topic.mastery).stroke }} />{topic.name}
                      <button onClick={() => { actions.practiceTopic(topic.id); setTab(null); }} className="ml-auto text-[11.5px] font-normal text-indigo-600">потренировать</button>
                    </div>
                    <ul className="mt-1.5 space-y-1.5">{qs.map((q) => <li key={q.id} className="rounded-lg bg-stone-50 px-3 py-2 text-[12.5px] leading-snug text-stone-700">{q.text}<span className="ml-1 text-stone-400">· {q.type === 'open' ? 'ответ' : 'тест'}</span></li>)}</ul>
                  </div>
                );
              })}
              <div className="h-5" />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ---------------- Skill map: heat table overlay ---------------- */

function HeatMap({ onClose }: { onClose: () => void }) {
  const { state, actions } = useStore();
  const topics = state.topics.filter((t) => t.targets.includes(state.targetId)).sort((a, b) => a.mastery - b.mastery);
  // Fake recent Attempt history per Topic: last 6 scores derived from mastery.
  const recent = (m: number, seed: number) => Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(3, Math.round(m * 3 + Math.sin(seed * 7 + i * 3) * 1.1))));
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-stone-900/10 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div ref={ref} className="fade-in max-h-[86vh] w-[820px] overflow-y-auto rounded-3xl border border-stone-200 bg-white p-7 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-end">
          <div>
            <h2 className="text-[19px] font-semibold">Карта навыков</h2>
            <p className="text-[12.5px] text-stone-500">Слабые темы сверху. Клетки — последние попытки, 0–3.</p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-stone-400">
              <th className="pb-2 font-medium">Тема</th><th className="pb-2 font-medium">Освоение</th><th className="pb-2 font-medium">Попытки</th><th className="pb-2 font-medium">Повторить</th><th />
            </tr>
          </thead>
          <tbody>
            {topics.map((t, ti) => (
              <tr key={t.id} className="border-t border-stone-100">
                <td className="py-2.5 pr-3"><div className="font-medium">{t.name}</div><div className="text-[11px] text-stone-400">{t.group}</div></td>
                <td className="w-44 pr-4">
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${t.mastery * 100}%`, background: heat(t.mastery).stroke }} /></div><span className="w-8 text-right tabular-nums text-stone-500">{Math.round(t.mastery * 100)}</span></div>
                </td>
                <td className="pr-4"><div className="flex gap-1">{recent(t.mastery, ti).map((v, i) => <span key={i} className="h-5 w-5 rounded" style={{ background: ['#fecdd3', '#fde68a', '#bbf7d0', '#34d399'][v] }} />)}</div></td>
                <td className="w-24">{t.due > 0 ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11.5px] font-medium text-indigo-700">{t.due} к повтор.</span> : <span className="text-stone-300">—</span>}</td>
                <td className="w-32 text-right"><button onClick={() => { actions.practiceTopic(t.id); onClose(); }} className="rounded-lg border border-stone-200 px-2.5 py-1 text-[12px] text-stone-600 hover:border-indigo-300 hover:text-indigo-700">Потренировать</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
