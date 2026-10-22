// PROTOTYPE - simulated app state. The Interviewer and Grader are faked with timeouts.
// Shared by all variants so switching variants keeps the same Canvas content.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CHAT_REPLIES, INITIAL_PROPOSED, MOCK_SCRIPTS, QUESTIONS, RESEARCH_BATCH, TARGETS, TOPICS,
  type Proposed, type Question, type Topic,
} from './data';

export type CardState = 'open' | 'answered' | 'grading' | 'graded' | 'skipped';

export interface Card {
  id: string;
  qid: string;
  setId: string;
  text: string; // open answer
  choice: number[]; // test answer
  state: CardState;
  score?: number; // 0..3 for open; 3 or 0 for tests
  correct?: boolean;
  feedback?: string;
  quote?: string;
  parentId?: string; // follow-up link in a Mock interview
  hints?: number; // Hint ladder rungs used; each lowers the maximum score
  showRef?: boolean; // Reference answer revealed after grading
}

export type SetKind = 'practice' | 'quiz' | 'mock';
export type SetStatus = 'active' | 'grading' | 'graded' | 'collapsed' | 'archived';

export interface PracticeSet {
  id: string;
  kind: SetKind;
  title: string;
  targetId: string;
  cardIds: string[];
  status: SetStatus;
  day: number;
  startedAt: number;
  finishedAt?: number;
  mockDone?: boolean; // Interviewer has no more follow-ups
}

export interface Msg {
  id: string;
  from: 'agent' | 'me';
  text: string;
  refCardId?: string;
  divider?: boolean; // starts a new conversation topic
}

export interface State {
  day: number;
  targetId: string;
  view: 'canvas' | 'skills';
  sets: PracticeSet[];
  cards: Record<string, Card>;
  chat: Msg[];
  typing: boolean;
  topics: Topic[];
  questions: Question[];
  proposed: Proposed[];
  approvedCount: number;
  researching: boolean;
  focus: { cardId: string; nonce: number } | null;
}

let seq = 100;
const uid = (p: string) => `${p}${++seq}`;

export const qById = (s: State, id: string) => s.questions.find((q) => q.id === id)!;
export const topicById = (s: State, id: string) => s.topics.find((t) => t.id === id);
export const targetTopics = (s: State) => s.topics.filter((t) => t.targets.includes(s.targetId));
export const readiness = (s: State) => {
  const ts = targetTopics(s);
  return Math.round((ts.reduce((a, t) => a + t.mastery, 0) / ts.length) * 100);
};
export const dueTotal = (s: State) => targetTopics(s).reduce((a, t) => a + t.due, 0);
export const currentSets = (s: State) => s.sets.filter((x) => x.status !== 'archived');
export const historySets = (s: State) => s.sets.filter((x) => x.status === 'archived');
export const setScore = (s: State, set: PracticeSet) => {
  const cs = set.cardIds.map((id) => s.cards[id]).filter((c) => c.state === 'graded');
  return { got: cs.reduce((a, c) => a + (c.score ?? 0), 0), max: set.cardIds.length * 3 };
};
export const target = (s: State) => TARGETS.find((t) => t.id === s.targetId)!;

function gradeOpen(q: Question, answer: string, hints = 0): Pick<Card, 'score' | 'feedback' | 'quote'> {
  const a = answer.trim();
  const len = a.length;
  const score = Math.min(3 - hints, len > 160 ? 3 : len > 70 ? 2 : len > 15 ? 1 : 0);
  const quote = a.length > 90 ? a.slice(0, 88).trimEnd() + '…' : a;
  const feedback =
    score === 3 ? `Полный ответ: ${q.keyIdea}.`
    : score === 2 ? `Ключевая идея есть, но ${q.gap}.`
    : score === 1 ? `Есть фрагменты, но нет главного: ${q.keyIdea}.`
    : 'Ответ не по существу вопроса.';
  return { score, feedback, quote };
}

function checkTest(q: Question, choice: number[]) {
  const ok = [...choice].sort().join() === [...(q.correct ?? [])].sort().join();
  return { correct: ok, score: ok ? 3 : 0, feedback: ok ? 'Верно.' : `Верный ответ: ${q.correct!.map((i) => q.options![i]).join(', ')}.` };
}

/** Hint ladder rungs derived from the Reference answer. */
export function hintRungs(q: Question): string[] {
  const first = q.keyIdea.split(';')[0].replace(/\s*\([^)]*\)/g, '').split(',').slice(0, 2).join(',');
  return [`Начните с главного: ${first}.`, `Эталон по пунктам: ${q.keyIdea}.`];
}

function initialState(): State {
  return {
    day: 1,
    targetId: 'ai',
    view: 'canvas',
    sets: [],
    cards: {},
    chat: [
      { id: 'm1', from: 'agent', text: 'Доброе утро! До собеседования на AI Engineer 23 дня. В повторении 19 вопросов, сильнее всего проседают evals и защита от prompt injection.' },
      { id: 'm2', from: 'agent', text: 'Начнём с подборки на сегодня? Ещё я нашёл 4 новых вопроса, они ждут вашего одобрения.' },
    ],
    typing: false,
    topics: TOPICS.map((t) => ({ ...t })),
    questions: QUESTIONS,
    proposed: INITIAL_PROPOSED,
    approvedCount: 0,
    researching: false,
    focus: null,
  };
}

function pickQuestions(s: State, opts: { topicId?: string; onlyTests?: boolean; n: number }) {
  const used = new Set(Object.values(s.cards).map((c) => c.qid));
  const topics = targetTopics(s)
    .filter((t) => !opts.topicId || t.id === opts.topicId)
    .sort((a, b) => b.due - a.due || a.mastery - b.mastery);
  const pool = topics.flatMap((t) => s.questions.filter((q) => q.topicId === t.id));
  const filtered = pool.filter((q) => (opts.onlyTests ? q.type !== 'open' : true));
  const fresh = filtered.filter((q) => !used.has(q.id));
  const list = fresh.length >= Math.min(opts.n, filtered.length) ? fresh : filtered;
  if (opts.onlyTests || opts.topicId) return list.slice(0, opts.n);
  // daily mix: 2 open + 2 tests
  const open = list.filter((q) => q.type === 'open').slice(0, 2);
  const tests = list.filter((q) => q.type !== 'open').slice(0, opts.n - open.length);
  return [...open, ...tests];
}

/** Auto-tidy when a new activity starts: graded sets collapse, collapsed results go to history. */
function tidy(sets: PracticeSet[]): PracticeSet[] {
  return sets.map((x) =>
    x.status === 'collapsed' ? { ...x, status: 'archived' as const }
    : x.status === 'graded' ? { ...x, status: 'collapsed' as const }
    : x,
  );
}

function useStoreImpl() {
  const [state, setState] = useState<State>(initialState);
  const ref = useRef(state);
  ref.current = state;
  const later = (ms: number, fn: (s: State) => State) => setTimeout(() => setState(fn), ms);

  const agentSay = (ms: number, text: string, extra?: Partial<Msg>, focusId?: string) => {
    setState((s) => ({ ...s, typing: true }));
    later(ms, (s) => ({
      ...s,
      typing: false,
      chat: [...s.chat, { id: uid('m'), from: 'agent', text, ...extra }],
      focus: focusId ? { cardId: focusId, nonce: Date.now() } : s.focus,
    }));
  };

  const createSet = (kind: SetKind, title: string, qs: Question[]) => {
    const setId = uid('s');
    const cards: Record<string, Card> = {};
    const ids = qs.map((q) => {
      const id = uid('c');
      cards[id] = { id, qid: q.id, setId, text: '', choice: [], state: 'open' };
      return id;
    });
    setState((s) => ({
      ...s,
      view: 'canvas',
      sets: [...tidy(s.sets), { id: setId, kind, title, targetId: s.targetId, cardIds: ids, status: 'active', day: s.day, startedAt: Date.now() }],
      cards: { ...s.cards, ...cards },
      focus: ids[0] ? { cardId: ids[0], nonce: Date.now() } : s.focus,
    }));
    return { setId, ids };
  };

  const actions = {
    setTarget(id: string) {
      setState((s) => ({ ...s, targetId: id }));
      const t = TARGETS.find((x) => x.id === id)!;
      agentSay(700, `Переключились на «${t.name}». Карта навыков и повторения теперь считаются для этой цели.`);
    },
    setView(view: State['view']) {
      setState((s) => ({ ...s, view }));
    },
    startDaily() {
      const s = ref.current;
      const qs = pickQuestions(s, { n: 4 });
      createSet('practice', 'Подборка на сегодня', qs);
      agentSay(600, 'Собрал подборку из 4 вопросов: два развёрнутых и два теста. Отвечайте в любом порядке, потом «Отправить».');
    },
    startQuiz() {
      const qs = pickQuestions(ref.current, { n: 4, onlyTests: true });
      createSet('quiz', 'Квиз: быстрая проверка', qs);
      agentSay(500, 'Квиз из 4 тестов, проверяется сразу при ответе.');
    },
    practiceTopic(topicId: string) {
      const s = ref.current;
      const t = topicById(s, topicId)!;
      const qs = pickQuestions(s, { n: 3, topicId });
      const onlyTests = qs.every((q) => q.type !== 'open');
      createSet(onlyTests ? 'quiz' : 'practice', `Тема: ${t.name}`, qs);
      agentSay(600, `Подборка по теме «${t.name}» на холсте.`);
    },
    startMock() {
      const s = ref.current;
      const script = MOCK_SCRIPTS[s.targetId];
      const setId = uid('s');
      setState((st) => ({
        ...st,
        view: 'canvas',
        sets: [...tidy(st.sets), { id: setId, kind: 'mock', title: 'Мок-интервью', targetId: st.targetId, cardIds: [], status: 'active', day: st.day, startedAt: Date.now() }],
      }));
      placeMockCard(setId, 0, undefined, script[0].comment);
    },
    answerText(cardId: string, text: string) {
      setState((s) => ({ ...s, cards: { ...s.cards, [cardId]: { ...s.cards[cardId], text } } }));
    },
    toggleChoice(cardId: string, idx: number) {
      setState((s) => {
        const c = s.cards[cardId];
        const q = qById(s, c.qid);
        const set = s.sets.find((x) => x.id === c.setId)!;
        const choice = q.type === 'single' ? [idx] : c.choice.includes(idx) ? c.choice.filter((i) => i !== idx) : [...c.choice, idx];
        let next: Card = { ...c, choice };
        // Quiz: single-choice tests are checked instantly.
        if (set.kind === 'quiz' && q.type === 'single') next = { ...next, state: 'graded', ...checkTest(q, choice) };
        return finishQuizIfDone({ ...s, cards: { ...s.cards, [cardId]: next } }, set.id);
      });
    },
    checkCard(cardId: string) {
      setState((s) => {
        const c = s.cards[cardId];
        const q = qById(s, c.qid);
        return finishQuizIfDone({ ...s, cards: { ...s.cards, [cardId]: { ...c, state: 'graded', ...checkTest(q, c.choice) } } }, c.setId);
      });
    },
    submitSet(setId: string) {
      const s = ref.current;
      const set = s.sets.find((x) => x.id === setId)!;
      const openIds = set.cardIds.filter((id) => qById(s, s.cards[id].qid).type === 'open');
      setState((st) => {
        const cards = { ...st.cards };
        for (const id of set.cardIds) {
          const c = cards[id];
          const q = qById(st, c.qid);
          if (c.state === 'skipped') continue;
          if (q.type === 'open') cards[id] = { ...c, state: c.text.trim() ? 'grading' : 'skipped' };
          else cards[id] = c.choice.length ? { ...c, state: 'graded', ...checkTest(q, c.choice) } : { ...c, state: 'skipped' };
        }
        return { ...st, cards, sets: st.sets.map((x) => (x.id === setId ? { ...x, status: 'grading' } : x)) };
      });
      // Grader returns open answers one by one.
      openIds.forEach((id, i) => {
        later(1400 + i * 1100, (st) => {
          const c = st.cards[id];
          if (c.state !== 'grading') return st;
          return { ...st, cards: { ...st.cards, [id]: { ...c, state: 'graded', ...gradeOpen(qById(st, c.qid), c.text, c.hints) } } };
        });
      });
      later(1500 + openIds.length * 1100, (st) => applyMastery({ ...st, sets: st.sets.map((x) => (x.id === setId ? { ...x, status: 'graded', finishedAt: Date.now() } : x)) }, setId));
      agentSay(1600 + openIds.length * 1100, 'Проверка готова. Оценки и цитаты из ответов на карточках.');
    },
    answerMock(cardId: string) {
      const s = ref.current;
      const c = s.cards[cardId];
      const set = s.sets.find((x) => x.id === c.setId)!;
      const step = set.cardIds.length;
      const script = MOCK_SCRIPTS[set.targetId];
      setState((st) => ({ ...st, cards: { ...st.cards, [cardId]: { ...st.cards[cardId], state: 'answered' } } }));
      if (step < script.length) placeMockCard(set.id, step, cardId, script[step].comment);
      else {
        setState((st) => ({ ...st, sets: st.sets.map((x) => (x.id === set.id ? { ...x, mockDone: true } : x)) }));
        agentSay(900, 'Спасибо, у меня всё. Завершите интервью, чтобы увидеть оценки.');
      }
    },
    finishMock(setId: string) {
      setState((st) => {
        const set = st.sets.find((x) => x.id === setId)!;
        const cards = { ...st.cards };
        for (const id of set.cardIds) cards[id] = { ...cards[id], state: cards[id].text.trim() ? 'grading' : 'skipped' };
        return { ...st, cards, sets: st.sets.map((x) => (x.id === setId ? { ...x, status: 'grading', finishedAt: Date.now(), mockDone: true } : x)) };
      });
      agentSay(500, 'Интервью завершено. Проверяющий оценивает ответы, это займёт пару секунд.');
      later(2600, (st) => {
        const set = st.sets.find((x) => x.id === setId)!;
        const cards = { ...st.cards };
        for (const id of set.cardIds) {
          const c = cards[id];
          if (c.state === 'grading') {
            const q = mockQuestion(st, c.qid);
            cards[id] = { ...c, state: 'graded', ...gradeOpen(q, c.text, c.hints) };
          }
        }
        return applyMastery({ ...st, cards, sets: st.sets.map((x) => (x.id === setId ? { ...x, status: 'graded' } : x)) }, setId);
      });
      agentSay(2900, 'Оценки открыты. Слабее всего вышло последнее уточнение: могу добавить похожие вопросы в повторение.');
    },
    collapseSet(setId: string) {
      setState((s) => ({ ...s, sets: s.sets.map((x) => (x.id === setId ? { ...x, status: 'collapsed' } : x)) }));
    },
    expandSet(setId: string) {
      setState((s) => ({ ...s, sets: s.sets.map((x) => (x.id === setId ? { ...x, status: 'graded' } : x)) }));
    },
    discuss(cardId: string) {
      const s = ref.current;
      const c = s.cards[cardId];
      const q = mockQuestion(s, c.qid);
      setState((st) => ({ ...st, chat: [...st.chat, { id: uid('m'), from: 'me', text: 'Обсудим эту карточку?', refCardId: cardId }] }));
      agentSay(1100, `Ключевая идея здесь: ${q.keyIdea}. ${c.score !== undefined && c.score < 3 ? 'В вашем ответе не хватило этого. ' : ''}Хотите, добавлю похожий вопрос в повторение?`, { refCardId: cardId }, cardId);
    },
    sendChat(text: string) {
      setState((s) => ({ ...s, chat: [...s.chat, { id: uid('m'), from: 'me', text }] }));
      const s = ref.current;
      // Occasionally the agent points at a weak Card and the Canvas focuses it.
      const weak = Object.values(s.cards).filter((c) => c.state === 'graded' && (c.score ?? 3) < 2).at(-1);
      if (weak) {
        agentSay(1000, 'Посмотрите на эту карточку: здесь самый заметный пробел, с него и начнём.', { refCardId: weak.id }, weak.id);
      } else {
        agentSay(1000, CHAT_REPLIES[s.chat.length % CHAT_REPLIES.length]);
      }
    },
    hint(cardId: string) {
      setState((s) => {
        const c = s.cards[cardId];
        if (c.state !== 'open' || (c.hints ?? 0) >= 2) return s;
        return { ...s, cards: { ...s.cards, [cardId]: { ...c, hints: (c.hints ?? 0) + 1 } } };
      });
    },
    skip(cardId: string) {
      const s = ref.current;
      const c = s.cards[cardId];
      const set = s.sets.find((x) => x.id === c.setId)!;
      if (c.state !== 'open' || set.status !== 'active') return;
      if (set.kind === 'mock') {
        setState((st) => ({ ...st, cards: { ...st.cards, [cardId]: { ...st.cards[cardId], text: '' } } }));
        actions.answerMock(cardId);
        return;
      }
      setState((st) => finishQuizIfDone({ ...st, cards: { ...st.cards, [cardId]: { ...st.cards[cardId], state: 'skipped' } } }, set.id));
    },
    showRef(cardId: string) {
      setState((s) => ({ ...s, cards: { ...s.cards, [cardId]: { ...s.cards[cardId], showRef: true } } }));
    },
    addCustom(text: string) {
      const s = ref.current;
      const q: Question = {
        id: uid('u'), topicId: targetTopics(s)[0].id, type: 'open', text,
        keyIdea: 'эталон составит агент после первой проверки', gap: 'проверяющий сверит ответ с эталоном, когда тот появится',
      };
      setState((st) => ({ ...st, questions: [...st.questions, q] }));
      createSet('practice', 'Свой вопрос', [q]);
      agentSay(700, 'Добавил ваш вопрос на холст. Эталонный ответ подготовлю к проверке.');
    },
    newChatTopic() {
      setState((s) => ({ ...s, chat: [...s.chat, { id: uid('m'), from: 'agent', text: 'Новая тема. О чём поговорим?', divider: true }] }));
    },
    focusCard(cardId: string) {
      setState((s) => ({ ...s, view: 'canvas', focus: { cardId, nonce: Date.now() } }));
    },
    approve(id: string) {
      setState((s) => ({ ...s, proposed: s.proposed.filter((p) => p.id !== id), approvedCount: s.approvedCount + 1 }));
    },
    reject(id: string) {
      setState((s) => ({ ...s, proposed: s.proposed.filter((p) => p.id !== id) }));
    },
    approveAll() {
      setState((s) => {
        const mine = s.proposed.filter((p) => p.targetId === s.targetId);
        return { ...s, proposed: s.proposed.filter((p) => p.targetId !== s.targetId), approvedCount: s.approvedCount + mine.length };
      });
    },
    research() {
      setState((s) => ({ ...s, researching: true }));
      agentSay(400, 'Ищу свежие вопросы по вакансиям и документации. Новое попадёт в очередь «Предложено».');
      later(2800, (s) => ({ ...s, researching: false, proposed: [...s.proposed, ...RESEARCH_BATCH.filter((p) => !s.proposed.some((x) => x.id === p.id))] }));
      agentSay(3000, 'Готово: 3 новых предложения. Одобрите то, что стоит взять в банк.');
    },
    newTarget() {
      setState((s) => ({ ...s, chat: [...s.chat, { id: uid('m'), from: 'me', text: 'Хочу добавить новую цель подготовки.' }] }));
      agentSay(900, 'Давайте настроим. На какую позицию и грейд готовитесь? Можно просто вставить ссылку на вакансию.');
    },
    newDay() {
      setState((s) => ({
        ...s,
        day: s.day + 1,
        sets: s.sets.map((x) => (x.status === 'graded' || x.status === 'collapsed' ? { ...x, status: 'archived' } : x)),
        topics: s.topics.map((t) => ({ ...t, due: t.due + (t.mastery < 0.6 ? 1 : 0) })),
        chat: [...s.chat, { id: uid('m'), from: 'agent', text: `День ${s.day + 1}. Вчерашние итоги ушли в историю. В повторении появились новые вопросы.` }],
      }));
    },
  };

  function placeMockCard(setId: string, step: number, parentId: string | undefined, comment: string) {
    const cardId = uid('c');
    agentSay(700, comment);
    later(1300, (st) => {
      const set = st.sets.find((x) => x.id === setId)!;
      return {
        ...st,
        cards: { ...st.cards, [cardId]: { id: cardId, qid: `mock:${set.targetId}:${step}`, setId, text: '', choice: [], state: 'open', parentId } },
        sets: st.sets.map((x) => (x.id === setId ? { ...x, cardIds: [...x.cardIds, cardId] } : x)),
        focus: { cardId, nonce: Date.now() },
      };
    });
  }

  function finishQuizIfDone(s: State, setId: string): State {
    const set = s.sets.find((x) => x.id === setId)!;
    if (set.kind !== 'quiz' || set.status !== 'active') return s;
    if (!set.cardIds.every((id) => s.cards[id].state === 'graded' || s.cards[id].state === 'skipped')) return s;
    return applyMastery({ ...s, sets: s.sets.map((x) => (x.id === setId ? { ...x, status: 'graded', finishedAt: Date.now() } : x)) }, setId);
  }

  return { state, actions };
}

function applyMastery(s: State, setId: string): State {
  const set = s.sets.find((x) => x.id === setId)!;
  const deltas: Record<string, number> = {};
  for (const id of set.cardIds) {
    const c = s.cards[id];
    if (c.state !== 'graded') continue;
    const tId = mockQuestion(s, c.qid).topicId;
    deltas[tId] = (deltas[tId] ?? 0) + ((c.score ?? 0) - 1.5) * 0.04;
  }
  return {
    ...s,
    topics: s.topics.map((t) =>
      deltas[t.id] !== undefined ? { ...t, mastery: Math.min(1, Math.max(0, t.mastery + deltas[t.id])), due: Math.max(0, t.due - 1) } : t,
    ),
  };
}

/** Mock interview Cards use scripted questions; regular Cards use the bank. */
export function mockQuestion(s: State, qid: string): Question {
  if (!qid.startsWith('mock:')) return qById(s, qid);
  const [, tid, step] = qid.split(':');
  const m = MOCK_SCRIPTS[tid][Number(step)];
  return { id: qid, topicId: m.topicId, type: 'open', text: m.text, keyIdea: m.keyIdea, gap: m.gap };
}

type Store = ReturnType<typeof useStoreImpl>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStoreImpl();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx)!;
}

/** Stable key describing Canvas structure, so variants rebuild nodes only when structure changes. */
export function useStructureKey() {
  const { state } = useStore();
  return useMemo(
    () => currentSets(state).map((x) => `${x.id}:${x.status}:${x.cardIds.join('.')}`).join('|'),
    [state.sets],
  );
}

