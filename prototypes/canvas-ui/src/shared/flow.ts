// PROTOTYPE - keeps React Flow nodes in sync with the model while preserving
// positions the Candidate dragged and the sizes React Flow measured.
import { useCallback, useEffect, useState } from 'react';
import { applyNodeChanges, type Node, type NodeChange, type XYPosition } from '@xyflow/react';

export function useSyncedNodes(derived: Node[], place?: (n: Node, existing: Node[]) => XYPosition, transform?: (ns: Node[]) => Node[]) {
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const map = new Map(prev.map((n) => [n.id, n]));
      const out: Node[] = [];
      for (const raw of derived) {
        // React Flow disables pointer events on non-draggable, non-selectable nodes; our nodes hold inputs.
        const d = { ...raw, style: { pointerEvents: 'all' as const, ...raw.style } };
        const p = map.get(d.id);
        if (p) out.push({ ...d, position: d.data?.pin ? d.position : p.position, measured: p.measured });
        else out.push({ ...d, position: place ? place(d, [...out, ...prev]) : d.position });
      }
      return transform ? transform(out) : out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);
  const onNodesChange = useCallback(
    (ch: NodeChange[]) => setNodes((ns) => (transform ? transform(applyNodeChanges(ch, ns)) : applyNodeChanges(ch, ns))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [nodes, setNodes, onNodesChange] as const;
}

export const rightEdge = (ns: Node[]) => ns.reduce((m, n) => Math.max(m, n.position.x + (n.measured?.width ?? Number(n.style?.width ?? 300))), 0);
