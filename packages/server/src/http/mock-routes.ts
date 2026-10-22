// REST routes of the Mock interview: start it from the toolbar, answer its Cards, end it early.
import type { Hono } from "hono";
import { z } from "zod";
import { apiPaths, mockDurationLimits, mockPaths, type MockRequest } from "@prepare-to-interview/shared";
import type { Chat } from "../chat/chat.ts";
import type { MockRunner } from "../interviewer/mock-runner.ts";
// Called while createApp builds the routes, after app.ts has finished loading.
import { chatBusyMessage, domainResult, idParam, readJson, sendToChat } from "./app.ts";

const mockRequest = z.strictObject({
  durationMinutes: z.number().int().min(mockDurationLimits.min).max(mockDurationLimits.max),
  focus: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("target") }),
    z.strictObject({ kind: z.literal("weak_spots") }),
    z.strictObject({ kind: z.literal("topics"), topics: z.array(z.string().trim().min(1).max(120)).min(1).max(10) }),
  ]),
});

export function mockRoutes(app: Hono, deps: { chat: Chat; mock: MockRunner }): void {
  app.post(apiPaths.mockRequest, async (c) => {
    const body = mockRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: `Укажите длительность от ${mockDurationLimits.min} до ${mockDurationLimits.max} минут и фокус.` }, 400);
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    const { focus } = body.data;
    return domainResult(() => {
      deps.mock.start({
        durationMinutes: body.data.durationMinutes,
        focus: { topics: focus.kind === "topics" ? focus.topics : [], weakSpots: focus.kind === "weak_spots" },
      });
      return sendToChat(() => deps.chat.send(mockRequestMessage(body.data)));
    });
  });

  app.post(mockPaths.answer(":id"), (c) => {
    // The Interviewer must take the answer in a turn right away, so it waits for a running reply.
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    return domainResult(() => c.json(deps.mock.answer(idParam(c)), 202));
  });

  app.post(mockPaths.finish(":id"), (c) => domainResult(() => c.json(deps.mock.finish("early", idParam(c)).node, 202)));
}

/** What the Candidate says in the Chat when they start a Mock interview from the toolbar or a menu. */
export function mockRequestMessage(request: MockRequest): string {
  const focus =
    request.focus.kind === "topics" ? `темы ${request.focus.topics.map((t) => `«${t}»`).join(", ")}` : request.focus.kind === "weak_spots" ? "слабые места" : "вся цель подготовки";
  return `Хочу мок-интервью на ${request.durationMinutes} ${minutesWord(request.durationMinutes)}, фокус — ${focus}.`;
}

function minutesWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "минут";
  if (ones === 1) return "минуту";
  if (ones >= 2 && ones <= 4) return "минуты";
  return "минут";
}
