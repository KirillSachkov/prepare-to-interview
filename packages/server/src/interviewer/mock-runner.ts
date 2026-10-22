import type { PracticeSetNode } from "@prepare-to-interview/shared";
import type { Chat } from "../chat/chat.ts";
import { DomainError } from "../domain/domain.ts";
import type { MockEnd, MockEndReason, MockInterviews, MockQuestionInput, MockStartInput, RunningMock } from "../domain/mock.ts";
import type { PracticeRunner } from "./practice-runner.ts";

/** What the Candidate says in the Chat when they answer a Mock interview Card. */
export const mockAnsweredMessage = "Мой ответ — на карточке.";
export const mockDontKnowMessage = "Не знаю.";

const endedNotes: Partial<Record<MockEndReason, string>> = {
  early: "Мок-интервью завершено. Проверяющий оценивает ответы — оценки появятся на карточках.",
  time: "Время мок-интервью вышло. Проверяющий оценивает ответы — оценки появятся на карточках.",
};

/**
 * Interviewer orchestration of a Mock interview. The server owns the flow: each answer starts an
 * Interviewer turn with the answer as hidden context, a timer ends the mock at its deadline (every
 * call checks it too, also after a restart), and ending the mock sends all answers to the Grader.
 * `onFinished` is the "Mock interview finished" Activity boundary.
 */
export class MockRunner {
  readonly #mock: MockInterviews;
  readonly #runner: PracticeRunner;
  readonly #chat: Chat;
  readonly #now: () => Date;
  readonly #finishedListeners: ((end: MockEnd) => void)[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: { mock: MockInterviews; runner: PracticeRunner; chat: Chat; now: () => Date }) {
    this.#mock = options.mock;
    this.#runner = options.runner;
    this.#chat = options.chat;
    this.#now = options.now;
    this.#enforceDeadline();
    this.#schedule();
  }

  /** Runs once a Mock interview ended, before its answers are graded. */
  onFinished(listener: (end: MockEnd) => void): void {
    this.#finishedListeners.push(listener);
  }

  running(): RunningMock | null {
    this.#enforceDeadline();
    return this.#mock.running();
  }

  start(input: MockStartInput): ReturnType<MockInterviews["start"]> {
    this.#enforceDeadline();
    const started = this.#mock.start(input);
    this.#schedule();
    return started;
  }

  /** Places the Interviewer's next Card; refused once the time is up, which ends the mock. */
  ask(input: MockQuestionInput): ReturnType<MockInterviews["ask"]> {
    if (this.#enforceDeadline()) {
      throw new DomainError(
        "The Mock interview time is up; the app ended it and the Grader is grading the answers.",
        "Do not ask more questions. Tell the Candidate the time is up and that grades appear on the Cards.",
      );
    }
    return this.#mock.ask(input);
  }

  /** Records the Candidate's answer and gives it to the Interviewer in a Chat turn. */
  answer(cardId: string): PracticeSetNode {
    if (this.#enforceDeadline()) throw new DomainError("The Mock interview time is up.", "Reload the Canvas.", { candidateMessage: "время интервью вышло." });
    const { node, answer } = this.#mock.answer(cardId);
    const blank = answer.type === "open" ? !answer.answer.trim() : !answer.choices.length;
    this.#chat.send(blank ? mockDontKnowMessage : mockAnsweredMessage, { cardId });
    return node;
  }

  /** Ends the running Mock interview and sends every open answer to the Grader. */
  finish(reason: MockEndReason, setId?: string): MockEnd {
    const end = this.#mock.finish(reason, setId);
    clearTimeout(this.#timer);
    this.#runner.grade(end.jobs);
    const note = endedNotes[reason];
    if (note) this.#chat.post(note);
    for (const listener of this.#finishedListeners) listener(end);
    return end;
  }

  close(): void {
    clearTimeout(this.#timer);
  }

  /** Ends a mock past its deadline; returns whether it did. */
  #enforceDeadline(): boolean {
    if (!this.#mock.overdue()) return false;
    this.finish("time");
    return true;
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    const running = this.#mock.running();
    if (!running) return;
    this.#timer = setTimeout(() => {
      if (!this.#enforceDeadline()) this.#schedule();
    }, Math.max(0, running.deadline.getTime() - this.#now().getTime()));
    this.#timer.unref();
  }
}
