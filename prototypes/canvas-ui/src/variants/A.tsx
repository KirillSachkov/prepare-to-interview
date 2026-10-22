// PROTOTYPE variant A «Спокойный холст»:
// free React Flow canvas, slim top bar as the Control panel, Chat as a draggable node,
// Practice sets as grouped regions. Question bank and Proposed queue live inside the Skill map.
import { useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { TARGETS } from '../model/data';
import { currentSets, dueTotal, historySets, mockQuestion, readiness, setScore, target, useStore, useStructureKey } from '../model/store';
import { useSyncedNodes, rightEdge } from '../shared/flow';
import { CardBody, ChatThread, ProposedList, Ring, Timer, cx, heat, useBank } from '../shared/ui';

export const variantAName = 'Спокойный холст';

export function VariantA() {
  const { state } = useStore();
  return (
    <div className="flex h-full flex-col bg-[#f7f6f3]">
      <TopBar />
      <div className="relative min-h-0 flex-1">{state.view === 'canvas' ? <CanvasA /> : <SkillMapA />}</div>
    </div>
  );
}

/* ---------------- Control panel: slim top bar ---------------- */

function TopBar() {
  const { state, actions } = useStore();
  const [menu, setMenu] = useState<null | 'target' | 'more' | 'history'>(null);
  const t = target(state);
  const r = readiness(state);
  const proposedN = state.proposed.filter((p) => p.targetId === state.targetId).length;
  const toggle = (m: typeof menu) => setMenu((x) => (x === m ? null : m));
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-5 border-b border-stone-200/80 bg-white/80 px-5 backdrop-blur">
      <div className="relative">
        <button onClick={() => toggle('target')} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100">
          <span className="h-2 w-2 rounded-full bg-indigo-500" />
          <span className="text-[14px] font-semibold">{t.name}</span>
          <span className="text-[13px] text-stone-400">{t.grade}</span>
          <span className="text-stone-400">▾</span>
        </button>
        {menu === 'target' && (
          <Pop>
            {TARGETS.map((x) => (
              <MenuItem key={x.id} active={x.id === state.targetId} onClick={() => { actions.setTarget(x.id); setMenu(null); }}>
                {x.name} <span className="text-stone-400">· {x.grade}</span>
              </MenuItem>
            ))}
            <div className="my-1 h-px bg-stone-100" />
            <MenuItem onClick={() => { actions.newTarget(); setMenu(null); }}>+ Новая цель</MenuItem>
          </Pop>
        )}
      </div>

      <div className="flex items-center gap-3 text-[12.5px] text-stone-500">
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-700" style={{ width: `${r}%` }} />
        </div>
        <span><b className="font-semibold text-stone-700">{r}%</b> готовности</span>
        {t.daysLeft && <span className="text-stone-400">· собеседование через {t.daysLeft} дн.</span>}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button onClick={actions.startDaily} className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm hover:bg-indigo-700">
          Подборка на сегодня <span className="ml-1 rounded bg-white/20 px-1.5 text-[11px]">{dueTotal(state)}</span>
        </button>
        <button onClick={actions.startMock} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-stone-700 hover:bg-stone-100">Мок-интервью</button>
        <div className="relative">
          <button onClick={() => toggle('more')} className="rounded-lg px-2.5 py-1.5 text-[13px] text-stone-500 hover:bg-stone-100">Ещё ▾</button>
          {menu === 'more' && (
            <Pop right>
              <MenuItem onClick={() => { actions.startQuiz(); setMenu(null); }}>Квиз на 4 теста</MenuItem>
              <MenuItem onClick={() => { actions.research(); setMenu(null); }}>{state.researching ? 'Исследую…' : 'Исследовать'}</MenuItem>
              <MenuItem onClick={() => { actions.newTarget(); setMenu(null); }}>Новая цель</MenuItem>
              <MenuItem onClick={() => setMenu('history')}>История · {historySets(state).length}</MenuItem>
            </Pop>
          )}
          {menu === 'history' && <Pop right><HistoryList /></Pop>}
        </div>
        <div className="ml-3 flex rounded-lg bg-stone-100 p-0.5 text-[12.5px]">
          {(['canvas', 'skills'] as const).map((v) => (
            <button key={v} onClick={() => actions.setView(v)} className={cx('relative rounded-md px-3 py-1', state.view === v ? 'bg-white font-medium shadow-sm' : 'text-stone-500')}>
              {v === 'canvas' ? 'Холст' : 'Карта навыков'}
              {v === 'skills' && proposedN > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-[10px] text-white">{proposedN}</span>}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function Pop({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <div className={cx('fade-in absolute top-full z-30 mt-1 min-w-56 rounded-xl border border-stone-200 bg-white p-1 shadow-lg', right ? 'right-0' : 'left-0')}>{children}</div>;
}
function MenuItem({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} className={cx('block w-full rounded-lg px-3 py-1.5 text-left text-[13px] hover:bg-stone-100', active && 'font-medium text-indigo-700')}>{children}</button>;
}

function HistoryList() {
  const { state } = useStore();
  const h = historySets(state);
  if (!h.length) return <p className="w-64 px-3 py-2 text-[13px] text-stone-400">История пуста. Итоги попадут сюда сами при новой подборке или на следующий день.</p>;
  return (
    <div className="w-72 p-1">
      {h.map((s) => { const sc = setScore(state, s); return (
        <div key={s.id} className="flex justify-between rounded-lg px-2 py-1.5 text-[13px]"><span>{s.title} <span className="text-stone-400">· день {s.day}</span></span><span className="tabular-nums text-stone-500">{sc.got}/{sc.max}</span></div>
      ); })}
    </div>
  );
}

/* ---------------- Canvas ---------------- */

const nodeTypes = { chat: ChatNode, region: RegionNode, result: ResultNode, mockHead: MockHeadNode, mockCard: MockCardNode, empty: EmptyNode };

function CanvasA() {
  const { state } = useStore();
  const key = useStructureKey();
  const rf = useReactFlow();

  const derived = useMemo<Node[]>(() => {
    const ns: Node[] = [{ id: 'chat', type: 'chat', position: { x: 0, y: 0 }, data: {}, dragHandle: '.drag', style: { width: 340 } }];
    const sets = currentSets(state);
    if (!sets.length) ns.push({ id: 'empty', type: 'empty', position: { x: 420, y: 40 }, data: {}, draggable: false });
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
  }, [key]);

  const [nodes, , onNodesChange] = useSyncedNodes(derived, (n, existing) => {
    if (n.type === 'mockCard') {
      const head = existing.find((e) => e.id === `set-${n.data.setId}`);
      const step = n.data.step as number;
      return { x: (head?.position.x ?? 0) + step * 48, y: (head?.position.y ?? 0) + 130 + step * 300 };
    }
    const others = existing.filter((e) => e.type !== 'mockCard' && e.type !== 'empty' && e.id !== n.id);
    return { x: rightEdge(others) + 80, y: 0 };
  }, stackMockCards);

  const edges = useMemo<Edge[]>(() => {
    const es: Edge[] = [];
    for (const s of currentSets(state)) {
      if (s.kind !== 'mock' || s.status === 'collapsed') continue;
      s.cardIds.forEach((cid, i) => {
        const from = i === 0 ? `set-${s.id}` : `card-${s.cardIds[i - 1]}`;
        es.push({ id: `e-${cid}`, source: from, target: `card-${cid}`, animated: s.status === 'active', style: { stroke: '#a5b4fc', strokeWidth: 1.5 }, label: i === 0 ? undefined : 'уточнение', labelStyle: { fontSize: 10, fill: '#78716c' }, labelBgStyle: { fill: '#f7f6f3' } });
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
    const t = setTimeout(() => rf.fitView({ nodes: [{ id }, set.kind === 'mock' ? { id: `set-${set.id}` } : { id: 'chat' }], duration: 600, padding: 0.12, maxZoom: 1 }), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focus?.nonce]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView fitViewOptions={{ maxZoom: 1, padding: 0.2 }} minZoom={0.2} maxZoom={1.4} proOptions={{ hideAttribution: true }} panOnScroll selectionOnDrag={false} nodesConnectable={false} elementsSelectable={false}>
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d6d3d1" />
      <Controls showInteractive={false} position="bottom-left" className="!rounded-lg !border !border-stone-200 !shadow-none" />
    </ReactFlow>
  );
}

/** Mock interview Cards hang below their header as a thread; dragging the header moves the thread. */
function stackMockCards(ns: Node[]): Node[] {
  const byId = new Map(ns.map((n) => [n.id, n]));
  const pos = new Map<string, { x: number; y: number }>();
  for (const head of ns.filter((n) => n.type === 'mockHead')) {
    let y = head.position.y + (head.measured?.height ?? 80) + 56;
    ns.filter((n) => n.type === 'mockCard' && n.data.setId === head.data.setId)
      .sort((a, b) => (a.data.step as number) - (b.data.step as number))
      .forEach((c) => {
        pos.set(c.id, { x: head.position.x + (c.data.step as number) * 40, y });
        y += (byId.get(c.id)?.measured?.height ?? 260) + 56;
      });
  }
  return ns.map((n) => { const p = pos.get(n.id); return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n; });
}

function ChatNode() {
  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.04)]">
      <div className="drag flex cursor-grab items-center gap-2 border-b border-stone-100 px-4 py-3 active:cursor-grabbing">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">И</span>
        <span className="text-[13px] font-semibold">Интервьюер</span>
        <span className="ml-auto text-[11px] text-stone-300">⠿</span>
      </div>
      <ChatThread />
    </div>
  );
}

function RegionNode({ data }: NodeProps) {
  const { state, actions } = useStore();
  const s = state.sets.find((x) => x.id === data.setId)!;
  const answered = s.cardIds.filter((id) => { const c = state.cards[id]; return c.text.trim() || c.choice.length || c.state === 'graded'; }).length;
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
            <button disabled={!answered} onClick={() => actions.submitSet(s.id)} className="nodrag rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium text-white disabled:bg-stone-300">Отправить</button>
          )}
          {s.status === 'graded' && <button onClick={() => actions.collapseSet(s.id)} className="nodrag rounded-lg px-3 py-1.5 text-[12.5px] text-stone-500 hover:bg-white">Свернуть в итог</button>}
        </div>
      </div>
      <div className={cx('grid gap-3', wide ? 'grid-cols-2' : 'grid-cols-1')}>
        {s.cardIds.map((id) => (
          <div key={id} className="rounded-2xl border border-stone-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]">
            <CardBody cardId={id} />
          </div>
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
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <HandleStub />
      <CardBody cardId={data.cardId as string} />
    </div>
  );
}

function HandleStub() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-indigo-300" />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-indigo-300" />
    </>
  );
}

function EmptyNode() {
  const { state, actions } = useStore();
  return (
    <div className="w-[380px] rounded-2xl border border-dashed border-stone-300 p-6 text-center">
      <div className="text-[14px] font-medium text-stone-600">На холсте пока пусто</div>
      <p className="mt-1 text-[12.5px] text-stone-400">Здесь появятся подборки, мок-интервью и последние итоги. В повторении {dueTotal(state)} вопросов.</p>
      <button onClick={actions.startDaily} className="nodrag mt-4 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[13px] font-medium text-white">Подборка на сегодня</button>
    </div>
  );
}

/* ---------------- Skill map (separate view) with bank + Proposed ---------------- */

function SkillMapA() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState<'proposed' | 'bank'>('proposed');
  const [open, setOpen] = useState<string | null>(null);
  const topics = state.topics.filter((t) => t.targets.includes(state.targetId));
  const groups = [...new Set(topics.map((t) => t.group))];
  const proposedN = state.proposed.filter((p) => p.targetId === state.targetId).length;
  const bank = useBank();
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {topics.filter((t) => t.group === g).map((t) => (
                <div key={t.id} className="group rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-sm">
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

      <aside className="flex w-[380px] shrink-0 flex-col border-l border-stone-200 bg-white">
        <div className="flex gap-1 border-b border-stone-100 p-2 text-[13px]">
          <button onClick={() => setTab('proposed')} className={cx('flex-1 rounded-lg py-1.5', tab === 'proposed' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Предложено {proposedN > 0 && <span className="ml-1 rounded-full bg-indigo-500 px-1.5 text-[10px] text-white">{proposedN}</span>}</button>
          <button onClick={() => setTab('bank')} className={cx('flex-1 rounded-lg py-1.5', tab === 'bank' ? 'bg-stone-100 font-medium' : 'text-stone-500')}>Банк вопросов</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {tab === 'proposed' ? (
            <>
              <div className="flex items-center justify-between py-3 text-[12px] text-stone-500">
                <span>Найдено агентом. В банк попадёт только одобренное.</span>
              </div>
              <ProposedList />
              <div className="flex gap-2 py-4">
                {proposedN > 1 && <button onClick={actions.approveAll} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white">Одобрить все</button>}
                <button onClick={actions.research} className="rounded-lg px-3 py-1.5 text-[12.5px] text-stone-600 hover:bg-stone-100">{state.researching ? 'Исследую…' : 'Исследовать ещё'}</button>
              </div>
            </>
          ) : (
            <ul className="py-2">
              {bank.map(({ topic, questions }) => (
                <li key={topic.id}>
                  <button onClick={() => setOpen(open === topic.id ? null : topic.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-stone-50">
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
