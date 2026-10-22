// Canvas nodes as React Flow state: loaded from the snapshot, kept live over the event channel,
// and written back to the layout store when the Candidate moves or collapses a node.
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import type { CanvasNode, LayoutUpdate, NodeLayoutEntry } from "@prepare-to-interview/shared";
import { fetchCanvas, saveLayout, subscribeToEvents } from "../api.ts";
import { toFlowNode, withCollapsed, type FlowNode } from "../nodes/flow.tsx";

/** Adds nodes not shown yet and refreshes the layout of known ones; the server is the source of truth. */
function mergeNodes(current: FlowNode[], incoming: CanvasNode[]): FlowNode[] {
  const byId = new Map(incoming.map((n) => [n.id, n]));
  const known = new Set(current.map((n) => n.id));
  const updated = current.map((n) => {
    const fresh = byId.get(n.id);
    return fresh ? withLayout(n, { nodeId: n.id, position: fresh.position, collapsed: fresh.collapsed }) : n;
  });
  const added = incoming.filter((n) => !known.has(n.id)).map(toFlowNode);
  return [...updated, ...added];
}

/** A node being dragged keeps the position under the cursor. */
function withLayout(node: FlowNode, layout: NodeLayoutEntry): FlowNode {
  const position = node.dragging ? node.position : layout.position;
  const moved = position.x !== node.position.x || position.y !== node.position.y;
  return withCollapsed(moved ? { ...node, position } : node, layout.collapsed);
}

function applyLayouts(current: FlowNode[], layouts: NodeLayoutEntry[]): FlowNode[] {
  const byId = new Map(layouts.map((l) => [l.nodeId, l]));
  return current.map((n) => {
    const layout = byId.get(n.id);
    return layout ? withLayout(n, layout) : n;
  });
}

export function useCanvasNodes() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
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
        onEvent: (event) => {
          switch (event.type) {
            case "canvas.node_added":
              setNodes((current) => mergeNodes(current, [event.node]));
              break;
            case "canvas.layout_changed":
              setNodes((current) => applyLayouts(current, event.layouts));
              break;
          }
        },
        onDisconnect: () =>
          setError("Нет связи с приложением. Проверьте, что `pnpm start` запущен, и откройте адрес, который он напечатал."),
      }),
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const persist = useCallback((updates: LayoutUpdate[]) => {
    saveLayout(updates).catch((e: unknown) => setError(`Не удалось сохранить расположение: ${String(e)}`));
  }, []);

  /** Stores where the dragged nodes were dropped. */
  const savePositions = useCallback(
    (dragged: FlowNode[]) => persist(dragged.map((n) => ({ nodeId: n.id, position: n.position }))),
    [persist],
  );

  const setCollapsed = useCallback(
    (nodeId: string, collapsed: boolean) => {
      setNodes((current) =>
        current.map((n) => (n.id === nodeId ? withCollapsed(n, collapsed) : n)),
      );
      persist([{ nodeId, collapsed }]);
    },
    [persist],
  );

  const deselectAll = useCallback(
    () => setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n))),
    [],
  );

  return { nodes, error, onNodesChange, savePositions, setCollapsed, deselectAll };
}
