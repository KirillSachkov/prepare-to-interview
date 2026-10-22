// The Canvas with its chrome (prototype variant A, ADR-0004): the Control panel, zoom pill,
// shortcuts, context menus, hotkeys, and Zen mode.
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type FitViewOptions,
} from "@xyflow/react";
import { useEffect, useState } from "react";
import { chatNodeId } from "@prepare-to-interview/shared";
import { flowNodeTypes, nodeMenu, SetCollapsedContext, type FlowNode } from "../nodes/flow.tsx";
import { buildCommands, type Commands, type Tool } from "./commands.ts";
import { ContextMenu, type OpenMenu } from "./ContextMenu.tsx";
import { ControlPanel, type ControlPanelPopover } from "./ControlPanel.tsx";
import { SettingsDialog, ShortcutsDialog } from "./dialogs.tsx";
import { isTyping, matchesHotkey } from "./hotkeys.ts";
import { commandEntry, type MenuEntry } from "./menu.ts";
import { comingSoonLabel, cx, Kbd } from "./ui.tsx";
import { useCanvasNodes } from "./useCanvasNodes.ts";
import { usePersistentState } from "./usePersistentState.ts";
import { ZoomPill } from "./ZoomPill.tsx";

/** Keeps fitted content clear of the floating toolbar and the bottom controls. */
const fitPadding = { top: "120px", bottom: "72px", left: "48px", right: "48px" } as const;
const fitOptions: FitViewOptions = { padding: fitPadding, maxZoom: 1 };
const zoomDuration = { duration: 150 };

type Dialog = "shortcuts" | "settings";

export function CanvasShell() {
  const rf = useReactFlow<FlowNode>();
  const { nodes, error, onNodesChange, savePositions, setCollapsed, deselectAll } = useCanvasNodes();
  const [tool, setTool] = useState<Tool>("select");
  const [grid, setGrid] = usePersistentState("pti.canvas.grid", true);
  const [chatHidden, setChatHidden] = usePersistentState("pti.canvas.chatHidden", false);
  const [zen, setZen] = useState(false);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [popover, setPopover] = useState<ControlPanelPopover | null>(null);
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commands: Commands = buildCommands({
    tool,
    setTool,
    grid,
    toggleGrid: () => setGrid((g) => !g),
    zen,
    toggleZen: () => setZen((z) => !z),
    chatHidden,
    toggleChat: () => {
      if (chatHidden) setFocusRequest(chatNodeId);
      setChatHidden(!chatHidden);
    },
    zoomIn: () => void rf.zoomIn(zoomDuration),
    zoomOut: () => void rf.zoomOut(zoomDuration),
    zoomReset: () => void rf.zoomTo(1, zoomDuration),
    fitAll: () => void rf.fitView({ ...fitOptions, duration: 300 }),
    fitSelection: () => {
      const selected = rf.getNodes().filter((n) => n.selected);
      if (selected.length) void rf.fitView({ nodes: selected, padding: fitPadding, maxZoom: 1.2, duration: 300 });
    },
    openShortcuts: () => setDialog("shortcuts"),
    escape: () => {
      setMenu(null);
      setDialog(null);
      setPopover(null);
      deselectAll();
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(document.activeElement);
      for (const command of Object.values(commands)) {
        if (!command.hotkey || !matchesHotkey(event, command.hotkey)) continue;
        if (typing && !command.whileTyping) return;
        if (dialog && command.id !== "ui.escape") return;
        event.preventDefault();
        if (command.run) command.run();
        else if (!command.whileTyping) setNotice(`«${command.label}» — ${comingSoonLabel}`);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Showing the Chat brings it into view once React Flow has rendered it.
  useEffect(() => {
    if (!focusRequest) return;
    const timer = setTimeout(() => {
      void rf.fitView({ ...fitOptions, nodes: [{ id: focusRequest }], duration: 300 });
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${focusRequest}"] [data-focus-target]:not([disabled])`)
        ?.focus();
      setFocusRequest(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [focusRequest, rf]);

  const gridCommand = commands["view.grid"];
  const paneMenu: MenuEntry[] = [
    commandEntry(commands["practice.today"]),
    commandEntry(commands["practice.topic"]),
    commandEntry(commands["mock.start"]),
    commandEntry(commands["question.custom"]),
    "separator",
    commandEntry(commands["view.fitAll"]),
    commandEntry(gridCommand, gridCommand.active ? "Сетка: выключить" : "Сетка: включить"),
    commandEntry(commands["view.zen"]),
  ];
  const openMenu = (event: { clientX: number; clientY: number }, target: string, entries: MenuEntry[]) =>
    setMenu({ x: event.clientX, y: event.clientY, target, entries });

  const shown = chatHidden ? nodes.filter((n) => n.id !== chatNodeId) : nodes;

  return (
    <SetCollapsedContext value={setCollapsed}>
      <div
        className={cx("canvas-shell relative h-full overflow-hidden bg-[#f7f6f3]", tool === "hand" && "tool-hand")}
        onMouseDown={() => setPopover(null)}
      >
        <ReactFlow
          nodes={shown}
          nodeTypes={flowNodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_event, _node, dragged) => savePositions(dragged)}
          fitView
          fitViewOptions={fitOptions}
          minZoom={0.1}
          maxZoom={2}
          onlyRenderVisibleElements
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          zoomActivationKeyCode={["Meta", "Control"]}
          panActivationKeyCode="Space"
          panOnDrag={tool === "hand" ? [0, 1] : [1]}
          selectionOnDrag={tool === "select"}
          selectionMode={SelectionMode.Partial}
          nodesDraggable={tool === "select"}
          elementsSelectable={tool === "select"}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            openMenu(event, "canvas", paneMenu);
          }}
          onSelectionContextMenu={(event) => {
            event.preventDefault();
            openMenu(event, "canvas", paneMenu);
          }}
          onNodeContextMenu={(event, node) => {
            // Text fields keep the browser's own menu (copy, paste, spelling).
            if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) return;
            event.preventDefault();
            const own = nodeMenu(node, { commands, target: event.target as Element }, setCollapsed);
            openMenu(event, own ? node.type : "canvas", own ?? paneMenu);
          }}
        >
          {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d6d3d1" />}
        </ReactFlow>

        {!zen && (
          <>
            <ControlPanel
              commands={commands}
              popover={popover}
              setPopover={setPopover}
              openSettings={() => setDialog("settings")}
            />
            <ZoomPill commands={commands} />
            <button
              type="button"
              aria-label="Горячие клавиши"
              onClick={commands["help.shortcuts"].run}
              className="absolute right-4 bottom-4 z-30 grid h-10 w-10 place-items-center rounded-xl border border-stone-200 bg-white text-[15px] font-semibold text-stone-500 shadow-sm hover:text-indigo-600"
            >
              ?
            </button>
          </>
        )}
        {zen && (
          <button
            type="button"
            onClick={() => setZen(false)}
            className="absolute bottom-4 left-4 z-30 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-500 shadow-sm"
          >
            Выйти из дзен-режима <Kbd>Alt+Z</Kbd>
          </button>
        )}

        {error && (
          <div
            role="alert"
            className="absolute top-28 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="fade-in absolute bottom-16 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-stone-900 px-3 py-1.5 text-[12.5px] text-white"
          >
            {notice}
          </div>
        )}

        {menu && <ContextMenu menu={menu} close={() => setMenu(null)} />}
        {dialog === "shortcuts" && <ShortcutsDialog commands={commands} close={() => setDialog(null)} />}
        {dialog === "settings" && <SettingsDialog close={() => setDialog(null)} />}
      </div>
    </SetCollapsedContext>
  );
}
