// PROTOTYPE - small shared primitives. Layout lives in each variant.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hintRungs, mockQuestion, topicById, useStore, type Msg } from '../model/store';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export function heat(m: number) {
  if (m < 0.4) return { text: 'text-rose-600', bg: 'bg-rose-50', stroke: '#e11d48', soft: '#ffe4e6', label: 'плавает' };
  if (m < 0.7) return { text: 'text-amber-600', bg: 'bg-amber-50', stroke: '#d97706', soft: '#fef3c7', label: 'в процессе' };
  return { text: 'text-emerald-600', bg: 'bg-emerald-50', stroke: '#059669', soft: '#d1fae5', label: 'уверенно' };
}

export function Ring({ value, size = 40, stroke = 4, color, children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e5e4" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? heat(value).stroke} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">{children ?? Math.round(value * 100)}</div>
    </div>
  );
}

export function ScoreDots({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${score} из 3`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx('h-2 w-2 rounded-full', i < score ? (score === 3 ? 'bg-emerald-500' : score === 2 ? 'bg-amber-500' : 'bg-rose-500') : 'bg-stone-200')} />
      ))}
      <span className="ml-1 text-xs font-medium tabular-nums text-stone-500">{score}/3</span>
    </span>
  );
}

export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function Timer({ from, to }: { from: number; to?: number }) {
  useTick();
  const sec = Math.floor(((to ?? Date.now()) - from) / 1000);
  return <span className="tabular-nums">{String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}</span>;
}

const typeLabel = { open: 'Развёрнутый ответ', single: 'Тест · один ответ', multi: 'Тест · несколько ответов' } as const;

/** Body of a Card: question, answer input, and the grade once revealed. */
export function CardBody({ cardId, dense, hideDiscuss }: { cardId: string; dense?: boolean; hideDiscuss?: boolean }) {
  const { state, actions } = useStore();
  const c = state.cards[cardId];
  const q = mockQuestion(state, c.qid);
  const set = state.sets.find((x) => x.id === c.setId)!;
  const topic = topicById(state, q.topicId);
  const isMock = set.kind === 'mock';
  const locked = c.state !== 'open' || set.status !== 'active';
  const graded = c.state === 'graded';
  const focused = state.focus?.cardId === cardId;

  return (
    <div key={focused ? state.focus!.nonce : 'n'} className={cx('rounded-xl', focused && 'focus-pulse')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-stone-500">
          <span className="truncate rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{topic?.name}</span>
          {!dense && <span>{isMock ? 'Вопрос интервьюера' : typeLabel[q.type]}</span>}
        </div>
        {graded && <ScoreDots score={c.score ?? 0} />}
        {c.state === 'skipped' && <span className="text-xs text-stone-400">Пропущено</span>}
        {c.state === 'grading' && <span className="animate-pulse text-xs text-indigo-500">проверяется…</span>}
        {isMock && c.state === 'answered' && <span className="text-xs text-stone-400">оценка в конце</span>}
      </div>

      <p className={cx('mt-2.5 font-medium leading-snug text-stone-800', dense ? 'text-[13px]' : 'text-[14.5px]')}>{q.text}</p>

      {q.type === 'open' ? (
        <textarea
          className="nodrag nowheel nopan mt-3 block w-full resize-none rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-[13.5px] leading-relaxed outline-none transition placeholder:text-stone-400 focus:border-indigo-300 focus:bg-white disabled:text-stone-600"
          rows={dense ? 3 : 4}
          placeholder="Ваш ответ…"
          value={c.text}
          disabled={locked}
          onChange={(e) => actions.answerText(cardId, e.target.value)}
        />
      ) : (
        <div className="mt-3 space-y-1.5">
          {q.options!.map((o, i) => {
            const picked = c.choice.includes(i);
            const right = graded && q.correct!.includes(i);
            const wrong = graded && picked && !q.correct!.includes(i);
            return (
              <button
                key={i}
                disabled={locked}
                onClick={() => actions.toggleChoice(cardId, i)}
                className={cx(
                  'nodrag flex w-full items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left text-[13px] transition',
                  right ? 'border-emerald-300 bg-emerald-50' : wrong ? 'border-rose-300 bg-rose-50' : picked ? 'border-indigo-300 bg-indigo-50' : 'border-stone-200 hover:border-stone-300',
                )}
              >
                <span className={cx('grid h-4 w-4 shrink-0 place-items-center border', q.type === 'single' ? 'rounded-full' : 'rounded', picked ? 'border-indigo-500 bg-indigo-500' : 'border-stone-300')}>
                  {picked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                {o}
              </button>
            );
          })}
          {set.kind === 'quiz' && q.type === 'multi' && c.state === 'open' && (
            <button className="nodrag mt-1 text-xs font-medium text-indigo-600 disabled:text-stone-300" disabled={!c.choice.length} onClick={() => actions.checkCard(cardId)}>
              Проверить
            </button>
          )}
        </div>
      )}

      {!!c.hints && (
        <div className="mt-2.5 space-y-1 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          {hintRungs(q).slice(0, c.hints).map((h, i) => <div key={i}><span className="font-medium">Подсказка {i + 1}.</span> {h}</div>)}
          <div className="text-[11px] text-amber-700/80">С подсказками максимум {3 - c.hints}/3</div>
        </div>
      )}

      {graded && c.feedback && (
        <div className="fade-in mt-3 rounded-lg bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-600">
          {c.quote && <blockquote className="mb-1.5 border-l-2 border-stone-300 pl-2 italic text-stone-500">«{c.quote}»</blockquote>}
          {c.feedback}
        </div>
      )}

      {c.showRef && (
        <div className="fade-in mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[12.5px] leading-relaxed text-indigo-900">
          <span className="font-medium">Эталон:</span> {q.keyIdea}.
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        {isMock && c.state === 'open' && set.status === 'active' ? (
          <button className="nodrag rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-stone-300" disabled={!c.text.trim()} onClick={() => actions.answerMock(cardId)}>
            Ответить
          </button>
        ) : <span />}
        {!hideDiscuss && (!isMock || set.status === 'graded' || set.status === 'collapsed') && (
          <button className="nodrag text-xs text-stone-400 transition hover:text-indigo-600" onClick={() => actions.discuss(cardId)}>
            Обсудить →
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatThread({ compact }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [state.chat.length, state.typing]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className="nowheel nodrag min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {state.chat.map((m) => <Bubble key={m.id} m={m} compact={compact} />)}
        {state.typing && <div className="text-xs text-stone-400"><span className="animate-pulse">Интервьюер печатает…</span></div>}
      </div>
      <form
        className="nodrag flex gap-2 border-t border-stone-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          actions.sendChat(text.trim());
          setText('');
        }}
      >
        <input className="min-w-0 flex-1 rounded-lg bg-stone-100 px-3 py-2 text-[13px] outline-none placeholder:text-stone-400 focus:bg-stone-50 focus:ring-1 focus:ring-indigo-200" placeholder="Написать интервьюеру…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="rounded-lg px-2 text-sm text-indigo-600 disabled:text-stone-300" disabled={!text.trim()}>↵</button>
      </form>
    </div>
  );
}

function Bubble({ m, compact }: { m: Msg; compact?: boolean }) {
  const { state, actions } = useStore();
  const ref = m.refCardId ? state.cards[m.refCardId] : undefined;
  const q = ref ? mockQuestion(state, ref.qid) : undefined;
  return (
    <div className={cx('fade-in flex flex-col', m.from === 'me' ? 'items-end' : 'items-start')}>
      {m.divider && <div className="mb-2 flex w-full items-center gap-2 text-[10.5px] uppercase tracking-wider text-stone-300"><span className="h-px flex-1 bg-stone-200" />новая тема<span className="h-px flex-1 bg-stone-200" /></div>}
      {q && (
        <button onClick={() => actions.focusCard(ref!.id)} className="mb-1 max-w-[90%] truncate rounded-md border border-indigo-100 bg-indigo-50/60 px-2 py-1 text-left text-[11px] text-indigo-700 hover:bg-indigo-50">
          ↗ {q.text}
        </button>
      )}
      <div className={cx('max-w-[90%] rounded-2xl px-3 py-2 leading-relaxed', compact ? 'text-[12.5px]' : 'text-[13px]', m.from === 'me' ? 'rounded-br-md bg-stone-900 text-white' : 'rounded-bl-md bg-stone-100 text-stone-700')}>
        {m.text}
      </div>
    </div>
  );
}

/** Proposed queue rows for the current Preparation target. */
export function ProposedList({ dense }: { dense?: boolean }) {
  const { state, actions } = useStore();
  const items = state.proposed.filter((p) => p.targetId === state.targetId);
  if (!items.length) return <p className="py-3 text-[13px] text-stone-400">Очередь пуста.{state.approvedCount ? ` Одобрено: ${state.approvedCount}.` : ''}</p>;
  return (
    <ul className="divide-y divide-stone-100">
      {items.map((p) => (
        <li key={p.id} className={cx('fade-in flex items-start gap-3', dense ? 'py-2' : 'py-3')}>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-stone-400">{p.kind === 'topic' ? 'Новая тема' : 'Вопрос'} · {p.topic}</div>
            <div className="text-[13px] font-medium leading-snug text-stone-800">{p.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-stone-400">Источник: {p.source}</div>
          </div>
          <div className="nodrag flex shrink-0 gap-1">
            <button className="rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-stone-100" onClick={() => actions.reject(p.id)}>Нет</button>
            <button className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100" onClick={() => actions.approve(p.id)}>Одобрить</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function useBank() {
  const { state } = useStore();
  const topics = state.topics.filter((t) => t.targets.includes(state.targetId));
  return topics.map((t) => ({ topic: t, questions: state.questions.filter((q) => q.topicId === t.id) }));
}
