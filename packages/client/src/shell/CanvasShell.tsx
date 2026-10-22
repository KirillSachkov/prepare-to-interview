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
import { chatNodeId, type PracticeRequest, type PracticeSetNode } from "@prepare-to-interview/shared";
import { flowNodeTypes, nodeMenu, NotifyContext, SetCollapsedContext, type FlowNode } from "../nodes/flow.tsx";
import { focusCardEvent } from "../practice/focus.ts";
import { requestResearch, useProposedCount } from "../skillmap/skillmap-api.ts";
import { SkillMapView, type SkillMapTab } from "../skillmap/SkillMapView.tsx";
import { requestPractice, submitPracticeSet } from "../practice/practice-api.ts";
import { buildCommands, type Commands, type Tool } from "./commands.ts";
import { ContextMenu, type OpenMenu } from "./ContextMenu.tsx";
import { ControlPanel, type ControlPanelPopover } from "./ControlPanel.tsx";
import { QuestionDialog, SettingsDialog, ShortcutsDialog, TopicPracticeDialog } from "./dialogs.tsx";
import { isTyping, matchesHotkey } from "./hotkeys.ts";
import { commandEntry, type MenuEntry } from "./menu.ts";
import { comingSoonLabel, cx, Kbd } from "./ui.tsx";
import { useCanvasNodes } from "./useCanvasNodes.ts";
import { usePersistentState } from "./usePersistentState.ts";
import { startNewTarget, useTargets } from "./target.ts";
import { ZoomPill } from "./ZoomPill.tsx";

/** Keeps fitted content clear of the floating toolbar and the bottom controls. */
const fitPadding = { top: "120px", bottom: "72px", left: "48px", right: "48px" } as const;
const fitOptions: FitViewOptions = { padding: fitPadding, maxZoom: 1 };
const zoomDuration = { duration: 150 };

type Dialog = "shortcuts" | "settings" | "question" | "topic";

/** The Practice set node a Card belongs to. */
function setOfCard(nodes: FlowNode[], cardId: string): FlowNode | undefined {
  return nodes.find((n) => n.type === "practice_set" && (n.data.content as PracticeSetNode["data"]).cards.some((c) => c.id === cardId));
}

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
  const { active: activeTarget } = useTargets();
  const [skillMap, setSkillMap] = useState(false);
  const [mapTab, setMapTab] = useState<SkillMapTab>("proposed");
  const proposed = useProposedCount();

  const showChat = () => {
    setFocusRequest(chatNodeId);
    setChatHidden(false);
  };

  const askForPractice = (body: PracticeRequest) => {
    setDialog(null);
    setSkillMap(false);
    requestPractice(body)
      .then(showChat)
      .catch((e: unknown) => setNotice(`Не удалось попросить подборку: ${e instanceof Error ? e.message : String(e)}`));
  };

  const commands: Commands = buildCommands({
    tool,
    setTool,
    grid,
    toggleGrid: () => setGrid((g) => !g),
    zen,
    toggleZen: () => setZen((z) => !z),
    chatHidden,
    toggleChat: () => (chatHidden ? showChat() : setChatHidden(true)),
    zoomIn: () => void rf.zoomIn(zoomDuration),
    zoomOut: () => void rf.zoomOut(zoomDuration),
    zoomReset: () => void rf.zoomTo(1, zoomDuration),
    fitAll: () => void rf.fitView({ ...fitOptions, duration: 300 }),
    fitSelection: () => {
      const selected = rf.getNodes().filter((n) => n.selected);
      if (selected.length) void rf.fitView({ nodes: selected, padding: fitPadding, maxZoom: 1.2, duration: 300 });
    },
    openShortcuts: () => setDialog("shortcuts"),
    newTarget: () => {
      setPopover(null);
      startNewTarget()
        .then(showChat)
        .catch(() => setNotice("Не удалось начать новую цель. Если Интервьюер ещё отвечает, дождитесь ответа или остановите его."));
    },
    addQuestion: () => setDialog("question"),
    practiceToday: () => askForPractice({ kind: "today" }),
    practiceTopic: () => setDialog("topic"),
    quiz: () => askForPractice({ kind: "quiz" }),
    submitPractice: () => {
      const focusedSet = document.activeElement?.closest<HTMLElement>("[data-set-id]")?.dataset.setId;
      const sets = nodes.filter((n) => n.type === "practice_set");
      const node =
        sets.find((n) => n.id === focusedSet) ??
        sets.findLast((n) => !n.data.collapsed && (n.data.content as PracticeSetNode["data"]).status === "active");
      const content = node?.data.content as PracticeSetNode["data"] | undefined;
      if (!node || content?.status !== "active") return;
      submitPracticeSet({ id: node.id, kind: "practice_set", position: node.position, collapsed: node.data.collapsed, data: content })
        .catch((e: unknown) => setNotice(`Не удалось отправить подборку: ${e instanceof Error ? e.message : String(e)}`));
    },
    due: activeTarget?.due ?? null,
    skillMap,
    toggleSkillMap: () => setSkillMap((open) => !open),
    openProposed: () => {
      setMapTab("proposed");
      setSkillMap(true);
    },
    research: () => {
      setSkillMap(false);
      requestResearch()
        .then(showChat)
        .catch((e: unknown) => setNotice(`Не удалось попросить исследование: ${e instanceof Error ? e.message : String(e)}`));
    },
    proposed,
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

  // A Card chip in the Chat brings its Practice set into view.
  useEffect(() => {
    const onFocusCard = (event: Event) => {
      const node = setOfCard(rf.getNodes(), (event as CustomEvent<string>).detail);
      if (node) void rf.fitView({ ...fitOptions, nodes: [{ id: node.id }], duration: 300 });
    };
    window.addEventListener(focusCardEvent, onFocusCard);
    return () => window.removeEventListener(focusCardEvent, onFocusCard);
  }, [rf]);

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
    commandEntry(commands["quiz.start"]),
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
      <NotifyContext value={setNotice}>
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
            const own = nodeMenu(node, { commands, target: event.target as Element, notify: setNotice }, setCollapsed);
            openMenu(event, own ? node.type : "canvas", own ?? paneMenu);
          }}
        >
          {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d6d3d1" />}
        </ReactFlow>

        {skillMap && (
          <SkillMapView
            tab={mapTab}
            setTab={setMapTab}
            practise={(topic) => askForPractice({ kind: "topic", topic })}
            research={commands["research.start"].run ?? (() => undefined)}
            notify={setNotice}
          />
        )}

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
        {dialog === "topic" && <TopicPracticeDialog close={() => setDialog(null)} choose={(topic) => askForPractice({ kind: "topic", topic })} />}
        {dialog === "question" && (
          <QuestionDialog
            close={() => setDialog(null)}
            added={(topic) => {
              setDialog(null);
              setNotice(`Вопрос добавлен в банк, тема «${topic}»`);
            }}
          />
        )}
      </div>
      </NotifyContext>
    </SetCollapsedContext>
  );
}
