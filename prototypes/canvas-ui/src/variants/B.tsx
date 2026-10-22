// PROTOTYPE variant B «Фокус-лента»:
// left rail as the Control panel; the Canvas auto-arranges current items into one column;
// Chat is a node docked to the right of the column and follows vertical scrolling;
// the Skill map is a zoomed-out level of the same canvas (semantic zoom), where each Topic
// also lists its bank Questions. The Proposed queue is an inbox node at the top of the feed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, useReactFlow, useStore as useRF, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { TARGETS } from '../model/data';
import { currentSets, dueTotal, historySets, mockQuestion, readiness, setScore, target, useStore, useStructureKey } from '../model/store';
import { useSyncedNodes } from '../shared/flow';
import { CardBody, ChatThread, ProposedList, Ring, Timer, cx, heat } from '../shared/ui';

export const variantBName = 'Фокус-лента';

const FEED_W = 600;
const CHAT_X = FEED_W + 48;
const ZOOM_MAP = 0.55; // below this zoom level the canvas reads as the Skill map

const useZoom = () => useRF((s) => s.transform[2]);

export function VariantB() {
  return (
    <div className="flex h-full bg-[#f5f5f4]">
      <Rail />
      <div className="relative min-w-0 flex-1"><FeedCanvas /></div>
    </div>
  );
}

/* ---------------- Control panel: left rail ---------------- */

function Rail() {
  const { state, actions } = useStore();
  const rf = useReactFlow();
  const zoom = useZoom();
  const r = readiness(state);
  const t = target(state);
  const atMap = zoom < ZOOM_MAP;
  const [hist, setHist] = useState(false);
  return (
    <aside className="z-10 flex w-[236px] shrink-0 flex-col border-r border-stone-200 bg-white px-4 py-5">
      <div className="space-y-0.5">
        {TARGETS.map((x) => (
          <button key={x.id} onClick={() => actions.setTarget(x.id)} className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]', x.id === state.targetId ? 'bg-stone-100 font-medium' : 'text-stone-500 hover:bg-stone-50')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', x.id === state.targetId ? 'bg-indigo-500' : 'bg-stone-300')} />
            <span className="flex-1 truncate">{x.name}</span>
            <span className="text-[11px] text-stone-400">{x.grade}</span>
          </button>
        ))}
        <button onClick={actions.newTarget} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-stone-400 hover:text-indigo-600">+ Новая цель</button>
      </div>

      <div className="my-6 flex flex-col items-center gap-2">
        <Ring value={r / 100} size={96} stroke={7} color="#4f46e5"><span className="text-[22px] font-semibold">{r}%</span></Ring>
        <div className="text-center text-[12px] leading-snug text-stone-500">
          готовность<br />
          {t.daysLeft ? <>собеседование через <b className="font-medium text-stone-700">{t.daysLeft} дн.</b></> : 'дата не задана'}
        </div>
      </div>

      <nav className="space-y-1">
        <RailBtn primary onClick={actions.startDaily} hint={`${dueTotal(state)}`}>Подборка на сегодня</RailBtn>
        <RailBtn onClick={actions.startMock}>Мок-интервью</RailBtn>
        <RailBtn onClick={actions.startQuiz}>Квиз</RailBtn>
        <RailBtn onClick={actions.research}>{state.researching ? 'Исследую…' : 'Исследовать'}</RailBtn>
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-xl bg-stone-100 p-1 text-[12.5px]">
          <div className="grid grid-cols-2 gap-1">
            <button onClick={() => focusFeed(rf)} className={cx('rounded-lg py-1.5', !atMap ? 'bg-white font-medium shadow-sm' : 'text-stone-500')}>Лента</button>
            <button onClick={() => rf.fitView({ nodes: state.topics.map((x) => ({ id: `topic-${x.id}` })), duration: 800, padding: 0.06, maxZoom: 0.5 })} className={cx('rounded-lg py-1.5', atMap ? 'bg-white font-medium shadow-sm' : 'text-stone-500')}>Карта</button>
          </div>
          <div className="px-2 pb-1 pt-1.5 text-center text-[10.5px] text-stone-400">или отдалите холст колесом</div>
        </div>
        <button onClick={() => setHist((x) => !x)} className="w-full text-left text-[12px] text-stone-400 hover:text-stone-600">История · {historySets(state).length}</button>
        {hist && (
          <div className="fade-in max-h-40 space-y-1 overflow-y-auto text-[12px]">
            {historySets(state).map((s) => { const sc = setScore(state, s); return <div key={s.id} className="flex justify-between text-stone-500"><span className="truncate">{s.title} · д{s.day}</span><span>{sc.got}/{sc.max}</span></div>; })}
            {!historySets(state).length && <div className="text-stone-400">пусто</div>}
          </div>
        )}
      </div>
    </aside>
  );
}

function RailBtn({ children, onClick, primary, hint }: { children: React.ReactNode; onClick: () => void; primary?: boolean; hint?: string }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition', primary ? 'bg-indigo-600 font-medium text-white hover:bg-indigo-700' : 'text-stone-700 hover:bg-stone-100')}>
      <span className="flex-1">{children}</span>
      {hint && <span className={cx('rounded px-1.5 text-[11px]', primary ? 'bg-white/20' : 'bg-stone-100')}>{hint}</span>}
    </button>
  );
}

function focusFeed(rf: ReturnType<typeof useReactFlow>) {
  const el = document.querySelector('.react-flow') as HTMLElement | null;
  const w = el?.clientWidth ?? 1200;
  rf.setViewport({ x: Math.max(24, (w - (CHAT_X + 360)) / 2), y: 32, zoom: 1 }, { duration: 700 });
}

/* ---------------- Canvas ---------------- */

const nodeTypes = { inbox: InboxNode, head: HeadNode, card: FeedCard, foot: FootNode, result: ResultNode, chat: ChatDock, topic: TopicNode, groupLabel: GroupLabel, intro: IntroNode, label: LabelNode };

function FeedCanvas() {
  const { state } = useStore();
  const key = useStructureKey();
  const rf = useReactFlow();
  const proposedN = state.proposed.filter((p) => p.targetId === state.targetId).length;
  const viewport = useRef({ x: 0, y: 0, zoom: 1 });

  const derived = useMemo<Node[]>(() => {
    const ns: Node[] = [];
    let order = 0;
    const feed = (n: Omit<Node, 'position'>, gap: number, indent = 0) => ns.push({ ...n, position: { x: indent, y: 0 }, draggable: false, data: { ...n.data, feed: true, order: order++, gap, indent }, style: { width: FEED_W - indent } });

    if (proposedN || state.researching) feed({ id: 'inbox', type: 'inbox', data: {} }, 0);
    const sets = currentSets(state);
    const live = sets.filter((s) => s.status !== 'collapsed').reverse();
    const done = sets.filter((s) => s.status === 'collapsed');
    if (!live.length) feed({ id: 'intro', type: 'intro', data: {} }, 40);
    for (const s of live) {
      feed({ id: `head-${s.id}`, type: 'head', data: { setId: s.id } }, 48);
      s.cardIds.forEach((cid, i) => feed({ id: `card-${cid}`, type: 'card', data: { cardId: cid, step: i, mock: s.kind === 'mock' } }, s.kind === 'mock' ? 28 : 12, s.kind === 'mock' ? Math.min(i, 3) * 28 : 0));
      if (s.kind === 'practice') feed({ id: `foot-${s.id}`, type: 'foot', data: { setId: s.id } }, 12);
    }
    if (done.length) {
      feed({ id: 'label-done', type: 'label', data: { text: 'Последние итоги' } }, 56);
      for (const s of done) feed({ id: `res-${s.id}`, type: 'result', data: { setId: s.id } }, 10);
    }

    ns.push({ id: 'chat', type: 'chat', position: { x: CHAT_X, y: 0 }, data: {}, draggable: false, style: { width: 360 } });

    // Skill map level: Topics placed to the left of the feed, grouped in columns.
    const topics = state.topics.filter((t) => t.targets.includes(state.targetId));
    const groups = [...new Set(topics.map((t) => t.group))];
    groups.forEach((g, gi) => {
      const x = -520 * (groups.length - gi) - 240;
      ns.push({ id: `group-${g}`, type: 'groupLabel', position: { x, y: -110 }, data: { text: g, pin: true }, draggable: false, selectable: false });
      topics.filter((t) => t.group === g).forEach((t, ti) => ns.push({ id: `topic-${t.id}`, type: 'topic', position: { x, y: ti * 420 }, data: { topicId: t.id, pin: true }, draggable: false, style: { width: 440 } }));
    });
    return ns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, proposedN > 0, state.researching, state.targetId]);

  const layout = useCallback((ns: Node[]) => {
    const feedNodes = ns.filter((n) => n.data.feed).sort((a, b) => (a.data.order as number) - (b.data.order as number));
    let y = 0;
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of feedNodes) {
      y += n.data.gap as number;
      pos.set(n.id, { x: n.data.indent as number, y });
      y += n.measured?.height ?? 180;
    }
    return ns.map((n) => {
      if (n.id === 'chat') return { ...n, position: { x: CHAT_X, y: (16 - viewport.current.y) / viewport.current.zoom } };
      const p = pos.get(n.id);
      return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
    });
  }, []);

  const [nodes, setNodes, onNodesChange] = useSyncedNodes(derived, undefined, layout);

  const edges = useMemo<Edge[]>(() => {
    const es: Edge[] = [];
    for (const s of currentSets(state)) {
      if (s.kind !== 'mock' || s.status === 'collapsed') continue;
      s.cardIds.forEach((cid, i) => {
        if (i === 0) return;
        es.push({ id: `e-${cid}`, source: `card-${s.cardIds[i - 1]}`, target: `card-${cid}`, type: 'smoothstep', animated: s.status === 'active', style: { stroke: '#a5b4fc', strokeWidth: 1.5 } });
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
    const id = set.status === 'collapsed' ? `res-${set.id}` : `card-${c.id}`;
    const t = setTimeout(() => {
      const n = rf.getNode(id);
      if (!n) return;
      const el = document.querySelector('.react-flow') as HTMLElement | null;
      const w = el?.clientWidth ?? 1200;
      rf.setViewport({ x: Math.max(24, (w - (CHAT_X + 360)) / 2), y: -n.position.y + 120, zoom: 1 }, { duration: 600 });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focus?.nonce]);

  // When the Interviewer runs out of follow-ups, bring the mock header (with «Завершить») into view.
  const doneMock = currentSets(state).find((x) => x.kind === 'mock' && x.mockDone && x.status === 'active')?.id;
  useEffect(() => {
    if (!doneMock) return;
    const n = rf.getNode(`head-${doneMock}`);
    if (!n) return;
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    const w = el?.clientWidth ?? 1200;
    rf.setViewport({ x: Math.max(24, (w - (CHAT_X + 360)) / 2), y: -n.position.y + 60, zoom: 1 }, { duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneMock]);

  useEffect(() => { focusFeed(rf); /* initial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onMove={(_, vp) => {
        viewport.current = vp;
        setNodes((ns) => ns.map((n) => (n.id === 'chat' ? { ...n, position: { x: CHAT_X, y: (16 - vp.y) / vp.zoom } } : n)));
      }}
      minZoom={0.12}
      maxZoom={1.3}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background variant={BackgroundVariant.Lines} gap={48} color="#ececeb" />
      <ZoomHint />
    </ReactFlow>
  );
}

function ZoomHint() {
  const zoom = useZoom();
  return (
    <div className="pointer-events-none absolute bottom-5 right-4 z-10 rounded-full bg-white/80 px-3 py-1 text-[11px] text-stone-500 shadow-sm backdrop-blur">
      {zoom < ZOOM_MAP ? 'Уровень: карта навыков' : 'Уровень: лента'} · {Math.round(zoom * 100)}% · ⌘/Ctrl + колесо для масштаба
    </div>
  );
}

/** Wraps feed nodes so they turn into quiet silhouettes at the Skill map zoom level. */
function Semantic({ children, title }: { children: React.ReactNode; title: string }) {
  const zoom = useZoom();
  if (zoom < ZOOM_MAP) return <div className="rounded-2xl bg-stone-200/70 px-6 py-5 text-[28px] font-medium text-stone-400">{title}</div>;
  return <>{children}</>;
}

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!left-3 !h-1.5 !w-1.5 !border-0 !bg-indigo-300 !opacity-0" />
      <Handle type="source" position={Position.Left} className="!left-3 !h-1.5 !w-1.5 !border-0 !bg-indigo-300 !opacity-0" />
    </>
  );
}

function InboxNode() {
  const { state, actions } = useStore();
  const n = state.proposed.filter((p) => p.targetId === state.targetId).length;
  return (
    <Semantic title={`Предложено · ${n}`}>
      <div className="rounded-2xl border border-indigo-100 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold">Предложено агентом</span>
          <span className="rounded-full bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700">{n}</span>
          {state.researching && <span className="animate-pulse text-[12px] text-indigo-500">ищу ещё…</span>}
          {n > 1 && <button onClick={actions.approveAll} className="nodrag ml-auto text-[12.5px] font-medium text-indigo-600">Одобрить все</button>}
        </div>
        <p className="mt-0.5 text-[12px] text-stone-400">В банк попадёт только одобренное. Весь банк виден на уровне карты навыков.</p>
        <div className="mt-1"><ProposedList dense /></div>
      </div>
    </Semantic>
  );
}

function IntroNode() {
  const { state, actions } = useStore();
  return (
    <Semantic title="Сегодня">
      <div className="px-1 py-6">
        <div className="text-[22px] font-semibold tracking-tight">Сегодня в повторении {dueTotal(state)} вопросов</div>
        <p className="mt-1 text-[13.5px] text-stone-500">Лента показывает только текущее. Начните с подборки или пройдите мок-интервью.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={actions.startDaily} className="nodrag rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white">Подборка на сегодня</button>
          <button onClick={actions.startMock} className="nodrag rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-stone-700 shadow-sm">Мок-интервью</button>
        </div>
      </div>
    </Semantic>
  );
}

function HeadNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  const mock = s.kind === 'mock';
  return (
    <Semantic title={s.title}>
      <div className="flex items-end gap-3 px-1">
        <div>
          <div className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wider text-stone-400">
            {mock && s.status === 'active' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />}
            {mock ? 'Мок-интервью' : s.kind === 'quiz' ? 'Квиз' : 'Подборка'} · день {s.day}
          </div>
          <div className="text-[19px] font-semibold tracking-tight">{s.title}</div>
        </div>
        <div className="ml-auto flex items-center gap-3 pb-0.5 text-[12.5px] text-stone-500">
          {mock && <span className="font-mono"><Timer from={s.startedAt} to={s.finishedAt} /></span>}
          {s.status === 'grading' && <span className="animate-pulse text-indigo-500">проверяется…</span>}
          {s.status === 'graded' && <span>итог <b className="text-stone-800">{sc.got}/{sc.max}</b></span>}
          {mock && s.status === 'active' && <button onClick={() => actions.finishMock(s.id)} className={cx('nodrag rounded-lg px-3 py-1 font-medium', s.mockDone ? 'bg-indigo-600 text-white' : 'text-stone-500 hover:bg-white')}>Завершить</button>}
          {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-2 py-1 hover:bg-white">Свернуть</button>}
        </div>
      </div>
    </Semantic>
  );
}

function FeedCard({ data }: NodeProps) {
  const { state } = useStore();
  const c = state.cards[data.cardId as string];
  return (
    <Semantic title={mockQuestion(state, c.qid).text.slice(0, 32) + '…'}>
      <div className={cx('rounded-2xl bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,.04),0_4px_16px_rgba(0,0,0,.03)]', data.mock ? 'border-l-2 border-indigo-200' : '')}>
        <Handles />
        <CardBody cardId={c.id} />
      </div>
    </Semantic>
  );
}

function FootNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const answered = s.cardIds.filter((id) => { const c = state.cards[id]; return c.text.trim() || c.choice.length; }).length;
  if (s.status !== 'active') return <div className="h-1" />;
  return (
    <Semantic title="Отправить">
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-stone-300 px-5 py-3">
        <div className="flex gap-1">{s.cardIds.map((id) => { const c = state.cards[id]; return <span key={id} className={cx('h-1.5 w-6 rounded-full', c.text.trim() || c.choice.length ? 'bg-indigo-400' : 'bg-stone-200')} />; })}</div>
        <span className="text-[12.5px] text-stone-500">отвечено {answered} из {s.cardIds.length}, пустые засчитаются как пропуск</span>
        <button disabled={!answered} onClick={() => actions.submitSet(s.id)} className="nodrag ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white disabled:bg-stone-300">Отправить</button>
      </div>
    </Semantic>
  );
}

function LabelNode({ data }: NodeProps) {
  return <Semantic title={data.text as string}><div className="px-1 text-[11.5px] font-medium uppercase tracking-wider text-stone-400">{data.text as string}</div></Semantic>;
}

function ResultNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const sc = setScore(state, s);
  return (
    <Semantic title={`${s.title} · ${sc.got}/${sc.max}`}>
      <button onClick={() => actions.expandSet(s.id)} className="nodrag fade-in flex w-full items-center gap-4 rounded-xl bg-white/70 px-4 py-2.5 text-left hover:bg-white">
        <span className="text-[13px] font-medium">{s.title}</span>
        <span className="flex flex-1 gap-1">{s.cardIds.map((id) => { const c = state.cards[id]; return <span key={id} className={cx('h-1.5 w-5 rounded-full', c.state === 'skipped' ? 'bg-stone-200' : (c.score ?? 0) === 3 ? 'bg-emerald-400' : (c.score ?? 0) >= 2 ? 'bg-amber-400' : 'bg-rose-400')} />; })}</span>
        <span className="text-[13px] tabular-nums text-stone-500">{sc.got}/{sc.max}</span>
      </button>
    </Semantic>
  );
}

function ChatDock() {
  const zoom = useZoom();
  return (
    <div className={cx('flex h-[560px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-opacity', zoom < ZOOM_MAP && 'pointer-events-none opacity-0')}>
      <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">И</span>
        <span className="text-[13px] font-semibold">Интервьюер</span>
        <span className="ml-auto text-[11px] text-stone-400">чат</span>
      </div>
      <ChatThread compact />
    </div>
  );
}

function GroupLabel({ data }: NodeProps) {
  const zoom = useZoom();
  return <div className={cx('text-[40px] font-semibold tracking-tight text-stone-300 transition-opacity', zoom >= 0.9 && 'opacity-0')}>{data.text as string}</div>;
}

function TopicNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const zoom = useZoom();
  const t = state.topics.find((x) => x.id === data.topicId)!;
  const h = heat(t.mastery);
  const qs = state.questions.filter((q) => q.topicId === t.id);
  const detail = zoom >= 0.75;
  return (
    <div className="rounded-[28px] border-2 bg-white p-6" style={{ borderColor: h.soft, background: `linear-gradient(180deg, ${h.soft}66, white 60%)` }}>
      <div className="flex items-center gap-5">
        <Ring value={t.mastery} size={88} stroke={9}><span className="text-[22px] font-semibold">{Math.round(t.mastery * 100)}</span></Ring>
        <div className="min-w-0 flex-1">
          <div className="text-[26px] font-semibold leading-tight tracking-tight">{t.name}</div>
          <div className={cx('text-[16px]', h.text)}>{h.label}</div>
        </div>
        {t.due > 0 && <span className="rounded-full bg-indigo-600 px-3 py-1 text-[16px] font-semibold text-white">{t.due}</span>}
      </div>
      {detail ? (
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-stone-400">Вопросы в банке · {qs.length}</div>
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-stone-600">{qs.map((q) => <li key={q.id}>· {q.text}</li>)}</ul>
          <button onClick={() => actions.practiceTopic(t.id)} className="nodrag mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white">Потренировать</button>
        </div>
      ) : (
        <button onClick={() => actions.practiceTopic(t.id)} className="nodrag mt-5 w-full rounded-xl border border-stone-200 py-3 text-[18px] font-medium text-stone-600 hover:border-indigo-300 hover:text-indigo-700">Потренировать</button>
      )}
    </div>
  );
}
