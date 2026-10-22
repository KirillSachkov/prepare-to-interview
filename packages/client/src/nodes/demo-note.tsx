import type { NodeTypeDefinition, NodeViewProps } from "./types.ts";

type Props = NodeViewProps<"demo_note">;

function DemoNoteView({ content }: Props) {
  return (
    <div className="w-60 rounded-lg border border-stone-300 bg-white p-3 shadow-sm">
      <div className="font-medium text-stone-900">{content.title}</div>
      {content.body && <div className="mt-1 text-sm whitespace-pre-wrap text-stone-600">{content.body}</div>}
    </div>
  );
}

function DemoNoteSummary({ content }: Props) {
  return (
    <div className="w-60 truncate rounded-lg border border-stone-300 bg-white px-3 py-4 text-2xl font-semibold text-stone-700">
      {content.title}
    </div>
  );
}

/** Placeholder node from the walking skeleton; real Cards replace it. */
export const demoNoteType: NodeTypeDefinition<"demo_note"> = {
  View: DemoNoteView,
  Summary: DemoNoteSummary,
};
