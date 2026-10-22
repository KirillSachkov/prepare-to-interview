import type { PracticeSetNode } from "@prepare-to-interview/shared";
import type { Chat } from "../chat/chat.ts";
import type { GradingJob, Practice, SetResult } from "../domain/practice.ts";
import { GradingError, type Grader } from "./grader.ts";

/** Open answers graded at the same time; each runs in its own Grader session. */
const parallelGradings = 2;

/** How long closing waits for running gradings before the drivers stop the agents. */
const closeTimeoutMs = 5000;

const interruptedMessage = "Проверка прервалась, когда приложение остановилось. Проверьте ответ ещё раз.";

/**
 * Interviewer orchestration of the practice loop: submits Practice sets and Cards to the domain
 * core, sends each open answer to the Grader in the background, records the verdicts, and posts
 * a short summary into the Chat once a set is graded.
 */
export class PracticeRunner {
  readonly #practice: Practice;
  readonly #grader: Grader;
  readonly #queue: GradingJob[] = [];
  readonly #running = new Set<Promise<void>>();
  /** Set once closing gave up waiting: the database may be gone, so late verdicts are dropped. */
  #stopped = false;

  constructor(options: { practice: Practice; grader: Grader; chat: Chat }) {
    this.#practice = options.practice;
    this.#grader = options.grader;
    this.#practice.recoverInterrupted(interruptedMessage);
    this.#practice.onGraded((result) => options.chat.post(summary(result)));
  }

  submit(setId: string): PracticeSetNode {
    const { node, jobs } = this.#practice.submit(setId);
    this.grade(jobs);
    return node;
  }

  check(cardId: string): PracticeSetNode {
    const { node, jobs } = this.#practice.check(cardId);
    this.grade(jobs);
    return node;
  }

  /** Resolves once no grading is queued or running. */
  async idle(): Promise<void> {
    while (this.#running.size) await Promise.all([...this.#running]);
  }

  /** Stops taking jobs; a grading still running after the timeout is left to the driver shutdown. */
  async close(): Promise<void> {
    this.#queue.length = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.idle(), new Promise((resolve) => (timer = setTimeout(resolve, closeTimeoutMs)))]);
    clearTimeout(timer);
    this.#stopped = true;
  }

  /** Queues open answers for the Grader, such as those of a finished Mock interview. */
  grade(jobs: GradingJob[]): void {
    this.#queue.push(...jobs);
    while (this.#running.size < parallelGradings && this.#queue.length) {
      const run: Promise<void> = this.#drain().finally(() => this.#running.delete(run));
      this.#running.add(run);
    }
  }

  async #drain(): Promise<void> {
    for (let job = this.#queue.shift(); job; job = this.#queue.shift()) {
      try {
        const grade = await this.#grader.grade(job);
        // A verdict that arrives while closing is still worth keeping.
        if (!this.#stopped) this.#practice.recordGrade(job.cardId, grade);
      } catch (error) {
        if (this.#stopped) return;
        const message = error instanceof GradingError ? error.message : "Не удалось проверить ответ. Попробуйте ещё раз.";
        this.#practice.gradingFailed(job.cardId, message);
      }
    }
  }
}

/** The short grading summary the Chat receives, in Russian. */
export function summary(result: SetResult): string {
  const checked = result.kind === "quiz" ? "Квиз проверен" : "Подборка проверена";
  const lines = [
    result.mode === "mock"
      ? `Мок-интервью проверено: ${result.score} из ${result.max}.`
      : `${checked}: «${result.title}» — ${result.score} из ${result.max}.`,
  ];
  // A Topic with any weak answer needs repetition; only Topics answered fully are strong.
  const weak = unique(result.cards.filter((c) => c.status === "graded" && (c.score ?? 0) <= 1).map((c) => c.topic));
  const strong = unique(result.cards.filter((c) => c.status === "graded" && c.score === 3).map((c) => c.topic)).filter((t) => !weak.includes(t));
  if (strong.length) lines.push(`Уверенно: ${strong.join(", ")}.`);
  if (weak.length) lines.push(`Стоит повторить: ${weak.join(", ")}.`);
  if (result.skipped) lines.push(`Пропущено: ${result.skipped}.`);
  lines.push(
    result.mode === "mock"
      ? "Оценки и разбор — на карточках; напишите в чат, чтобы Интервьюер разобрал интервью, или нажмите «Обсудить» на карточке."
      : "Оценки и разбор — на карточках; нажмите «Обсудить», чтобы разобрать ответ.",
  );
  return lines.join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
