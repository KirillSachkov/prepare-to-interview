// What waits for the Candidate's confirmation in the Chat: Candidate profile and Decision log updates the Interviewer
// proposed in a review, saved only on «Сохранить», or a Question bank change it asked for, applied only on «Подтвердить».
import { useState } from "react";
import type { ReviewProposalView } from "@prepare-to-interview/shared";
import { answerProposal } from "./chat-api.ts";

const labels = {
  memory: { accept: "Сохранить", decline: "Не сохранять", accepted: "Сохранено", declined: "Не сохранено", region: "Предложение запомнить" },
  bank: { accept: "Подтвердить", decline: "Отменить", accepted: "Подтверждено", declined: "Отменено", region: "Подтверждение изменения банка" },
} as const;

export function ProposalCard({ proposal }: { proposal: ReviewProposalView }) {
  const label = labels[proposal.kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const answer = (accept: boolean) => {
    setBusy(true);
    setError(undefined);
    // The updated message also arrives over the event channel.
    answerProposal(proposal.id, accept)
      .catch((e: unknown) => setError(`Не удалось ответить: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <div className="nodrag mt-2 rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[12.5px] whitespace-normal" aria-label={label.region}>
      <ul className="list-disc space-y-0.5 pl-4 text-stone-700">
        {proposal.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {proposal.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => answer(true)} className="rounded bg-indigo-600 px-2.5 py-1 text-white disabled:opacity-50">
            {label.accept}
          </button>
          <button type="button" disabled={busy} onClick={() => answer(false)} className="rounded px-2.5 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-50">
            {label.decline}
          </button>
        </div>
      ) : (
        <div className="mt-1.5 text-stone-400">{label[proposal.status]}</div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
