// What a node type supplies to the Canvas. Each Canvas node kind registers one definition in
// `registry.ts`; the shell renders, culls, summarizes, and builds context menus from it.
import type { ComponentType } from "react";
import type { CanvasNode, CanvasNodeKind } from "@prepare-to-interview/shared";
import type { Commands } from "../shell/commands.ts";
import type { MenuEntry } from "../shell/menu.ts";

export type NodeContent<K extends CanvasNodeKind> = Extract<CanvasNode, { kind: K }>["data"];

export interface NodeViewProps<K extends CanvasNodeKind> {
  id: string;
  content: NodeContent<K>;
  collapsed: boolean;
  selected: boolean;
  /** Stores the collapsed state in the layout store. */
  setCollapsed: (collapsed: boolean) => void;
}

export interface NodeMenuContext {
  commands: Commands;
  /** The element right-clicked inside the node, to tell apart its parts (a Card inside a Practice set). */
  target: Element;
  /** Shows a short message, such as why an action failed. */
  notify: (message: string) => void;
}

export interface NodeTypeDefinition<K extends CanvasNodeKind> {
  /** Full rendering at normal zoom. Mark the element to focus on "show" with `data-focus-target`. */
  View: ComponentType<NodeViewProps<K>>;
  /** Compact rendering when the Canvas is zoomed out far enough that details are unreadable. */
  Summary: ComponentType<NodeViewProps<K>>;
  /** Initial size of the expanded node, for views that fill their node (resizable ones); collapsed nodes size to content. */
  size?: { width: number; height: number };
  /** CSS selector of the part that drags the node; the whole node drags when absent. */
  dragHandle?: string;
  /** Right-click entries for this node; the empty-Canvas menu is used when absent. */
  menu?: (node: NodeViewProps<K>, context: NodeMenuContext) => MenuEntry[];
}

/** One definition per node kind; the compiler rejects a kind added to the contract without one. */
export type NodeTypeRegistry = { [K in CanvasNodeKind]: NodeTypeDefinition<K> };
