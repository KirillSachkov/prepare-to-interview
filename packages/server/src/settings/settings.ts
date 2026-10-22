import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentIds, type AgentSettings, type AgentSettingsUpdate } from "@prepare-to-interview/shared";
import type { Database } from "../db/database.ts";
import { settings } from "../db/schema.ts";
import type { EventBus } from "../events.ts";

const agentSettingsKey = "agent";

const storedAgentSettings = z.object({
  agent: z.enum(agentIds).nullable().catch(null),
  models: z.partialRecord(z.enum(agentIds), z.string()).catch({}),
});

export const agentSettingsUpdate = z.strictObject({
  agent: z.enum(agentIds),
  model: z.string().trim().max(200).nullish(),
});

/** App settings kept in SQLite, starting with the agent the Interviewer runs on. */
export class Settings {
  readonly #db: Database;
  readonly #events: EventBus;

  constructor(db: Database, events: EventBus) {
    this.#db = db;
    this.#events = events;
  }

  agentSettings(): AgentSettings {
    const row = this.#db.select().from(settings).where(eq(settings.key, agentSettingsKey)).get();
    const parsed = storedAgentSettings.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : { agent: null, models: {} };
  }

  updateAgent(update: AgentSettingsUpdate): AgentSettings {
    const current = this.agentSettings();
    let models = current.models;
    if (update.model !== undefined) {
      const others = Object.entries(models).filter(([agent]) => agent !== update.agent);
      models = Object.fromEntries(update.model ? [...others, [update.agent, update.model]] : others);
    }
    const next: AgentSettings = { agent: update.agent, models };
    this.#db
      .insert(settings)
      .values({ key: agentSettingsKey, value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next } })
      .run();
    this.#events.publish({ type: "agent.settings", settings: next });
    return next;
  }
}
