// The command table: every Canvas action the toolbar, menus, hotkeys, and shortcuts dialog offer.
// Later tickets implement an action by giving its command a `run` (and a badge where it applies);
// until then the command shows as disabled "coming soon" everywhere it appears.
import { letter, modLabel, type Hotkey } from "./hotkeys.ts";
import type { IconName } from "./ui.tsx";

export type Tool = "select" | "hand";

export type CommandGroup = "Инструменты" | "Холст" | "Карточки" | "Вид";

export type CommandId =
  | "tool.select"
  | "tool.hand"
  | "practice.today"
  | "practice.topic"
  | "practice.submit"
  | "quiz.start"
  | "mock.start"
  | "research.start"
  | "bank.open"
  | "question.custom"
  | "target.new"
  | "history.open"
  | "view.skillMap"
  | "chat.toggle"
  | "zoom.in"
  | "zoom.out"
  | "zoom.reset"
  | "view.fitAll"
  | "view.fitSelection"
  | "view.grid"
  | "view.zen"
  | "help.shortcuts"
  | "ui.escape";

export interface Command {
  id: CommandId;
  label: string;
  group: CommandGroup;
  icon?: IconName;
  hotkey?: Hotkey;
  /** Absent while no ticket has implemented the action: shown disabled as "coming soon". */
  run?: () => void;
  /** Toggle state or the current tool, highlighted in the toolbar. */
  active?: boolean;
  badge?: number;
  accentBadge?: boolean;
  /** Fires even while focus is in a field (submitting from inside a Card). */
  whileTyping?: boolean;
}

export type Commands = Record<CommandId, Command>;

/** What the shell can do right now; the command table binds these to labels and hotkeys. */
export interface ShellControls {
  tool: Tool;
  setTool: (tool: Tool) => void;
  grid: boolean;
  toggleGrid: () => void;
  zen: boolean;
  toggleZen: () => void;
  chatHidden: boolean;
  toggleChat: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fitAll: () => void;
  fitSelection: () => void;
  openShortcuts: () => void;
  escape: () => void;
  /** Starts onboarding for a new Preparation target in the Chat. */
  newTarget: () => void;
  /** Opens the dialog for the Candidate's own Question. */
  addQuestion: () => void;
  /** Asks the Interviewer in the Chat for today's Practice set. */
  practiceToday: () => void;
  /** Opens the Topic picker for a Practice set by Topic. */
  practiceTopic: () => void;
  /** Asks the Interviewer in the Chat for a Quiz. */
  quiz: () => void;
  /** Submits the Practice set holding the focused Card, or the latest unsubmitted one. */
  submitPractice: () => void;
  /** Opens the history of graded Practice sets that left the Canvas. */
  openHistory: () => void;
  /** Questions of the active Preparation target Due today. */
  due: number | null;
}

export function buildCommands(c: ShellControls): Commands {
  return {
    "tool.select": {
      id: "tool.select",
      label: "Выделение",
      group: "Инструменты",
      icon: "select",
      hotkey: letter("V"),
      run: () => c.setTool("select"),
      active: c.tool === "select",
    },
    "tool.hand": {
      id: "tool.hand",
      label: "Рука: двигать холст",
      group: "Инструменты",
      icon: "hand",
      hotkey: letter("H"),
      run: () => c.setTool("hand"),
      active: c.tool === "hand",
    },
    "practice.today": {
      id: "practice.today",
      label: "Подборка на сегодня",
      group: "Инструменты",
      icon: "set",
      hotkey: letter("P"),
      run: c.practiceToday,
      ...(c.due ? { badge: c.due } : {}),
    },
    "practice.topic": { id: "practice.topic", label: "Подборка по теме…", group: "Инструменты", run: c.practiceTopic },
    "mock.start": { id: "mock.start", label: "Мок-интервью", group: "Инструменты", icon: "mock", hotkey: letter("M") },
    "research.start": {
      id: "research.start",
      label: "Исследовать",
      group: "Инструменты",
      icon: "research",
      hotkey: letter("R"),
    },
    "bank.open": {
      id: "bank.open",
      label: "Банк / Предложено",
      group: "Инструменты",
      icon: "bank",
      hotkey: letter("B"),
      accentBadge: true,
    },
    "view.skillMap": {
      id: "view.skillMap",
      label: "Карта навыков",
      group: "Инструменты",
      icon: "map",
      hotkey: letter("K"),
    },
    "chat.toggle": {
      id: "chat.toggle",
      label: "Показать или скрыть чат",
      group: "Инструменты",
      icon: "chat",
      hotkey: letter("C"),
      run: c.toggleChat,
      active: !c.chatHidden,
    },
    "quiz.start": { id: "quiz.start", label: "Квиз", group: "Инструменты", hotkey: letter("Q"), run: c.quiz },
    "question.custom": { id: "question.custom", label: "Вставить свой вопрос", group: "Карточки", run: c.addQuestion },
    "target.new": { id: "target.new", label: "+ Новая цель", group: "Инструменты", run: c.newTarget },
    "history.open": { id: "history.open", label: "История", group: "Инструменты", run: c.openHistory },
    "practice.submit": {
      id: "practice.submit",
      label: "Отправить подборку / ответить в моке",
      group: "Карточки",
      hotkey: { label: `${modLabel} ↵`, key: ["Enter"], mod: true },
      run: c.submitPractice,
      whileTyping: true,
    },
    "zoom.in": {
      id: "zoom.in",
      label: "Приблизить",
      group: "Холст",
      hotkey: { label: `${modLabel} +`, key: ["=", "+"], mod: true },
      run: c.zoomIn,
    },
    "zoom.out": {
      id: "zoom.out",
      label: "Отдалить",
      group: "Холст",
      hotkey: { label: `${modLabel} −`, key: ["-", "_"], mod: true },
      run: c.zoomOut,
    },
    "zoom.reset": {
      id: "zoom.reset",
      label: "Масштаб 100%",
      group: "Холст",
      hotkey: { label: `${modLabel} 0`, key: ["0"], mod: true },
      run: c.zoomReset,
    },
    "view.fitAll": {
      id: "view.fitAll",
      label: "Показать всё",
      group: "Холст",
      hotkey: { label: "⇧1", code: "Digit1", shift: true },
      run: c.fitAll,
    },
    "view.fitSelection": {
      id: "view.fitSelection",
      label: "К выделенному",
      group: "Холст",
      hotkey: { label: "⇧2", code: "Digit2", shift: true },
      run: c.fitSelection,
    },
    "view.grid": {
      id: "view.grid",
      label: "Сетка",
      group: "Вид",
      hotkey: { label: `${modLabel} '`, code: "Quote", mod: true },
      run: c.toggleGrid,
      active: c.grid,
    },
    "view.zen": {
      id: "view.zen",
      label: "Дзен-режим",
      group: "Вид",
      hotkey: { label: "Alt+Z", code: "KeyZ", alt: true },
      run: c.toggleZen,
      active: c.zen,
    },
    "help.shortcuts": {
      id: "help.shortcuts",
      label: "Горячие клавиши",
      group: "Вид",
      hotkey: { label: "?", key: ["?"], code: "Slash", shift: true },
      run: c.openShortcuts,
    },
    "ui.escape": {
      id: "ui.escape",
      label: "Снять выделение, закрыть меню",
      group: "Карточки",
      hotkey: { label: "Esc", key: ["Escape"] },
      run: c.escape,
    },
  };
}
