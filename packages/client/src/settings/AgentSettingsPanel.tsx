import { useEffect, useState } from "react";
import type { AgentId, AgentsResponse } from "@prepare-to-interview/shared";
import { fetchAgents, updateAgentSettings } from "../chat/chat-api.ts";

/**
 * Agent settings: which installed coding agent the Interviewer runs on, and an optional model.
 * Self-contained so the Chat node and the Canvas menu can both open it.
 */
export function AgentSettingsPanel({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<AgentsResponse>();
  const [agent, setAgent] = useState<AgentId | "">("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    fetchAgents()
      .then((response) => {
        setData(response);
        const current = response.settings.agent;
        setAgent(current ?? response.agents.find((a) => a.installed)?.id ?? "");
        setModel(current ? (response.settings.models[current] ?? "") : "");
      })
      .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
  }, []);

  const choose = (id: AgentId) => {
    setAgent(id);
    setModel(data?.settings.models[id] ?? "");
    setStatus(undefined);
  };

  const save = () => {
    if (!agent) return;
    updateAgentSettings({ agent, model: model.trim() || null })
      .then((settings) => {
        setData((current) => current && { ...current, settings });
        setStatus("Saved.");
        onClose?.();
      })
      .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
  };

  if (!data) return <div className="p-3 text-sm text-stone-500">{status ?? "Looking for installed agents…"}</div>;

  return (
    <form
      className="flex flex-col gap-3 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-medium text-stone-800">Coding agent</legend>
        {data.agents.map((a) => (
          <label key={a.id} className={`flex items-start gap-2 ${a.installed ? "" : "text-stone-400"}`}>
            <input
              type="radio"
              name="agent"
              className="mt-0.5"
              value={a.id}
              checked={agent === a.id}
              disabled={!a.installed}
              onChange={() => choose(a.id)}
            />
            <span>
              {a.label}
              <span className="block text-xs text-stone-500">{a.installed ? "Installed" : a.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-stone-800">Model</span>
        <input
          className="rounded border border-stone-300 px-2 py-1"
          placeholder="Agent default"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <p className="text-xs text-stone-500">The app uses the agent's own login and subscription; it never asks for API keys.</p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!agent}
          className="rounded bg-stone-800 px-3 py-1 text-white disabled:bg-stone-300"
        >
          Save
        </button>
        {onClose && (
          <button type="button" className="rounded px-3 py-1 text-stone-600 hover:bg-stone-100" onClick={onClose}>
            Cancel
          </button>
        )}
        {status && <span className="text-xs text-stone-600">{status}</span>}
      </div>
    </form>
  );
}
