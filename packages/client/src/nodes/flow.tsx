// Bridges the node-type registry to React Flow: node conversion, zoom-aware rendering, menus.
import { useStore, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { CanvasNode, CanvasNodeKind } from "@prepare-to-interview/shared";
import type { Commands } from "../shell/commands.ts";
import type { MenuEntry } from "../shell/menu.ts";
import { nodeTypeRegistry } from "./registry.ts";
import type { NodeContent, NodeTypeDefinition, NodeViewProps } from "./types.ts";

/** Below this zoom nodes render their Summary instead of full details. */
export const summaryZoom = 0.45;

export interface FlowNodeData<K extends CanvasNodeKind = CanvasNodeKind> extends Record<string, unknown> {
  content: NodeContent<K>;
  collapsed: boolean;
}

export type FlowNode = Node<FlowNodeData, CanvasNodeKind>;

export function toFlowNode(node: CanvasNode): FlowNode {
  return {
    id: node.id,
    type: node.kind,
    position: node.position,
    data: { content: node.data, collapsed: node.collapsed },
    dragHandle: nodeTypeRegistry[node.kind].dragHandle,
  };
}

/** Lets node views store their collapsed state without knowing the layout store. */
export const SetCollapsedContext = createContext<(nodeId: string, collapsed: boolean) => void>(() => undefined);

function viewProps<K extends CanvasNodeKind>(
  id: string,
  data: FlowNodeData,
  selected: boolean,
  setCollapsed: (nodeId: string, collapsed: boolean) => void,
): NodeViewProps<K> {
  return {
    id,
    content: data.content as NodeContent<K>,
    collapsed: data.collapsed,
    selected,
    setCollapsed: (collapsed) => setCollapsed(id, collapsed),
  };
}

function flowComponent<K extends CanvasNodeKind>(definition: NodeTypeDefinition<K>) {
  const { View, Summary } = definition;
  return function RegisteredNode({ id, data, selected }: NodeProps<FlowNode>) {
    const zoomedOut = useStore((s) => s.transform[2] < summaryZoom);
    const setCollapsed = useContext(SetCollapsedContext);
    const props = viewProps<K>(id, data, selected, setCollapsed);
    return zoomedOut ? <Summary {...props} /> : <View {...props} />;
  };
}

const kinds = Object.keys(nodeTypeRegistry) as CanvasNodeKind[];

/** Stable React Flow `nodeTypes`, one zoom-aware component per registered kind. */
export const flowNodeTypes: NodeTypes = Object.fromEntries(
  kinds.map((kind) => [kind, flowComponent(nodeTypeRegistry[kind] as NodeTypeDefinition<CanvasNodeKind>)]),
);

/** The node's own context-menu entries, or undefined when its type registers none. */
export function nodeMenu(
  node: FlowNode,
  commands: Commands,
  setCollapsed: (nodeId: string, collapsed: boolean) => void,
): MenuEntry[] | undefined {
  const definition = nodeTypeRegistry[node.type] as NodeTypeDefinition<CanvasNodeKind>;
  return definition.menu?.(viewProps(node.id, node.data, Boolean(node.selected), setCollapsed), commands);
}
