// REST routes of the Skill map, the Question bank, the Proposed queue, Research, and search.
import type { Hono } from "hono";
import { z } from "zod";
import { bankPaths, searchKinds, type ReviewRequest, type SearchResponse } from "@prepare-to-interview/shared";
import type { Chat } from "../chat/chat.ts";
import type { Bank } from "../domain/bank.ts";
import type { Search } from "../search/search.ts";
import { chatBusyMessage, domainResult, idParam, readJson, sendToChat } from "./app.ts";

export interface BankRouteDeps {
  bank: Bank;
  search: Search;
  chat: Chat;
  /** Research waits while a Mock interview runs, like every other Activity. */
  mockRunning: () => boolean;
}

const reviewRequest = z.strictObject({
  action: z.enum(["approve", "reject"]),
  topics: z.array(z.string().min(1)).max(500).optional(),
  questions: z.array(z.string().min(1)).max(500).optional(),
  batchId: z.string().min(1).nullable().optional(),
  all: z.boolean().optional(),
});

const referenceUpdate = z
  .strictObject({ referenceAnswer: z.string().max(10_000).nullable().optional(), verified: z.boolean().optional() })
  .refine((u) => u.referenceAnswer !== undefined || u.verified !== undefined);

/** What the Candidate says in the Chat when they press «Исследовать». */
export const researchRequestMessage = "Хочу, чтобы ты исследовал темы и вопросы для моей цели подготовки.";

export function registerBankRoutes(app: Hono, deps: BankRouteDeps): void {
  app.get(bankPaths.skillMap, (c) => c.json(deps.bank.skillMap()));
  app.get(bankPaths.topic(":id"), (c) => domainResult(() => c.json(deps.bank.topicDetail(idParam(c)))));
  app.get(bankPaths.bank, (c) => c.json(deps.bank.bank()));
  app.get(bankPaths.proposed, (c) => c.json(deps.bank.queue()));
  app.post(bankPaths.review, async (c) => {
    const body = reviewRequest.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Не указано, что одобрить или отклонить." }, 400);
    const { batchId, ...rest } = body.data;
    const request: ReviewRequest = { ...rest, ...(batchId !== undefined && { batchId }) };
    return c.json(deps.bank.review(request));
  });
  app.put(bankPaths.reference(":id"), async (c) => {
    const body = referenceUpdate.safeParse(await readJson(c.req.raw));
    if (!body.success) return c.json({ error: "Эталонный ответ не сохранён: неверные данные." }, 400);
    const update = {
      ...(body.data.referenceAnswer !== undefined && { referenceAnswer: body.data.referenceAnswer }),
      ...(body.data.verified !== undefined && { verified: body.data.verified }),
    };
    return domainResult(() => c.json(deps.bank.updateReference(idParam(c), update)));
  });
  app.post(bankPaths.researchRequest, (c) => {
    if (deps.chat.busy) return c.json({ error: chatBusyMessage }, 409);
    if (deps.mockRunning()) return c.json({ error: "сначала завершите мок-интервью." }, 409);
    return sendToChat(() => deps.chat.send(researchRequestMessage));
  });
  app.get(bankPaths.search, (c) => {
    const q = c.req.query("q") ?? "";
    const kinds = (c.req.query("kinds") ?? "").split(",").filter((k): k is (typeof searchKinds)[number] => (searchKinds as readonly string[]).includes(k));
    return c.json({ hits: deps.search.search(q.slice(0, 500), { ...(kinds.length && { kinds }), limit: 20 }) } satisfies SearchResponse);
  });
}
