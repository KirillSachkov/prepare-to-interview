// Candidate profile and Decision log updates the Interviewer proposed in a review: the app saves them to the Candidate profile
// and the Decision log only when the Candidate presses «Сохранить».
import { useState } from "react";
import type { ReviewProposalView } from "@prepare-to-interview/shared";
import { answerProposal } from "./chat-api.ts";

const settledLabel = { accepted: "Сохранено", declined: "Не сохранено" } as const;

export function ProposalCard({ proposal }: { proposal: ReviewProposalView }) {
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
    <div className="nodrag mt-2 rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[12.5px] whitespace-normal" aria-label="Предложение запомнить">
      <ul className="list-disc space-y-0.5 pl-4 text-stone-700">
        {proposal.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {proposal.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => answer(true)} className="rounded bg-indigo-600 px-2.5 py-1 text-white disabled:opacity-50">
            Сохранить
          </button>
          <button type="button" disabled={busy} onClick={() => answer(false)} className="rounded px-2.5 py-1 text-stone-500 hover:bg-stone-100 disabled:opacity-50">
            Не сохранять
          </button>
        </div>
      ) : (
        <div className="mt-1.5 text-stone-400">{settledLabel[proposal.status]}</div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
