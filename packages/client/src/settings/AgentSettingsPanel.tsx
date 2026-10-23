import { useEffect, useState } from "react";
import type { AgentId, AgentModelsResponse, AgentsResponse } from "@prepare-to-interview/shared";
import { fetchAgents, fetchAgentModels, updateAgentSettings } from "../chat/chat-api.ts";

/**
 * Agent settings: which installed coding agent the Interviewer runs on, and an optional model.
 * Self-contained so the Chat node and the Canvas menu can both open it.
 */
export function AgentSettingsPanel({ onClose }: { onClose?: () => void }) {
  const [data, setData] = useState<AgentsResponse>();
  const [agent, setAgent] = useState<AgentId | "">("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<string>();
  const [catalogue, setCatalogue] = useState<{ agent: AgentId; data?: AgentModelsResponse; error?: string }>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    fetchAgentModels(agent).then(
      (models) => { if (!cancelled) setCatalogue({ agent, data: models }); },
      (error: unknown) => { if (!cancelled) setCatalogue({ agent, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
  }, [agent, retry]);

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
    setCatalogue(undefined);
    setModel(data?.settings.models[id] ?? "");
    setStatus(undefined);
  };

  const save = () => {
    if (!agent) return;
    updateAgentSettings({ agent, model: model.trim() || null })
      .then((settings) => {
        setData((current) => current && { ...current, settings });
        setStatus("Сохранено.");
        onClose?.();
      })
      .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
  };

  if (!data) return <div className="p-3 text-sm text-stone-500">{status ?? "Ищу установленных агентов…"}</div>;
  const models = catalogue?.agent === agent ? catalogue.data : undefined;
  const modelError = catalogue?.agent === agent ? catalogue.error : undefined;
  const loading = Boolean(agent && !models && !modelError);
  const unavailable = Boolean(models && model && !models.models.some((choice) => choice.id === model));
  const defaultLabel = models?.models.find((choice) => choice.id === models.defaultModel)?.label;

  return (
    <form
      className="flex flex-col gap-3 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-medium text-stone-800">Агент</legend>
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
              <span className="block text-xs text-stone-500">{a.installed ? "Установлен" : a.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-stone-800">Модель</span>
        <select
          aria-label="Модель"
          className="rounded border border-stone-300 px-2 py-1"
          value={model}
          disabled={!agent || loading || Boolean(modelError)}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">По умолчанию у агента{defaultLabel ? ` (${defaultLabel})` : ""}</option>
          {unavailable && <option value={model} disabled>{model} — недоступна</option>}
          {models?.models.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </label>
      {loading && <p role="status" className="text-xs text-stone-500">Загружаю модели агента…</p>}
      {models && models.models.length === 0 && <p className="text-xs text-stone-500">Агент не сообщил список моделей. Доступна модель по умолчанию.</p>}
      {unavailable && <p role="alert" className="text-xs text-amber-700">Сохранённая модель недоступна. Выберите другую или модель по умолчанию.</p>}
      {modelError && <div role="alert" className="text-xs text-amber-700">
        Не удалось загрузить модели. {modelError}
        <button type="button" className="ml-2 underline" onClick={() => { setCatalogue(undefined); setRetry((value) => value + 1); }}>Повторить</button>
      </div>}
      <p className="text-xs text-stone-500">Приложение работает через вход и подписку самого агента и никогда не просит API-ключи.</p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!agent || loading || Boolean(modelError) || unavailable}
          className="rounded bg-stone-800 px-3 py-1 text-white disabled:bg-stone-300"
        >
          Сохранить
        </button>
        {onClose && (
          <button type="button" className="rounded px-3 py-1 text-stone-600 hover:bg-stone-100" onClick={onClose}>
            Отмена
          </button>
        )}
        {status && <span className="text-xs text-stone-600">{status}</span>}
      </div>
    </form>
  );
}
