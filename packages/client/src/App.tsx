import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import type { CanvasNode, DemoNoteNode } from "@prepare-to-interview/shared";
import { fetchCanvas, subscribeToEvents } from "./api.ts";

type DemoNoteFlowNode = Node<DemoNoteNode["data"], "demo_note">;

const nodeTypes = { demo_note: DemoNote };

function toFlowNode(node: CanvasNode): DemoNoteFlowNode {
  return { id: node.id, type: node.kind, position: node.position, data: node.data };
}

/** Adds nodes not shown yet; snapshot and live events may deliver the same node twice. */
function mergeNodes(current: DemoNoteFlowNode[], incoming: CanvasNode[]): DemoNoteFlowNode[] {
  const known = new Set(current.map((n) => n.id));
  const added = incoming.filter((n) => !known.has(n.id)).map(toFlowNode);
  return added.length ? [...current, ...added] : current;
}

export function App() {
  const [nodes, setNodes] = useState<DemoNoteFlowNode[]>([]);
  const [error, setError] = useState<string>();

  useEffect(
    () =>
      subscribeToEvents({
        // Load the snapshot after the live channel opens, so no change falls between them.
        onOpen: () => {
          fetchCanvas()
            .then((snapshot) => {
              setError(undefined);
              setNodes((current) => mergeNodes(current, snapshot.nodes));
            })
            .catch((e: unknown) => setError(String(e)));
        },
        // The only event so far is canvas.node_added; new kinds will need a switch here.
        onEvent: (event) => setNodes((current) => mergeNodes(current, [event.node])),
      }),
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<DemoNoteFlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  return (
    <div className="h-full w-full bg-stone-50">
      <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls position="bottom-left" />
      </ReactFlow>
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded bg-red-100 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}

function DemoNote({ data }: NodeProps<DemoNoteFlowNode>) {
  return (
    <div className="w-60 rounded-lg border border-stone-300 bg-white p-3 shadow-sm">
      <div className="font-medium text-stone-900">{data.title}</div>
      {data.body && <div className="mt-1 text-sm whitespace-pre-wrap text-stone-600">{data.body}</div>}
    </div>
  );
}
