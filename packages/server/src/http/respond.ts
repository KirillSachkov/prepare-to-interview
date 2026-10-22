// Responses shared by the REST routes: domain refusals in Russian, the busy Chat, and request parsing.
import type { Context } from "hono";
import { ChatBusyError } from "../chat/chat.ts";
import { DomainError } from "../domain/domain.ts";

export const chatBusyMessage = "Интервьюер ещё отвечает: дождитесь ответа или остановите его.";

/** Answers 202 with the Candidate's Chat message, or 409 while the Interviewer is replying. */
export function sendToChat(send: () => unknown): Response {
  try {
    return Response.json({ message: send() }, { status: 202 });
  } catch (error) {
    if (error instanceof ChatBusyError) return Response.json({ error: chatBusyMessage }, { status: 409 });
    throw error;
  }
}

/** Answers a refused domain change with its Russian text: 404 for an unknown record, 400 otherwise. */
export function domainResult(respond: () => Response): Response {
  try {
    return respond();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const message = error.candidateMessage ?? "приложение отклонило запрос.";
    return Response.json({ error: message }, { status: error.kind === "not_found" ? 404 : 400 });
  }
}

/** The `:id` of a Card or Practice set route. */
export function idParam(c: Context): string {
  return c.req.param("id") ?? "";
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
