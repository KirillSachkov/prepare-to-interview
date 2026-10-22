// Sections of the Settings dialog (top-left menu → «Настройки»). A feature adds its own panel here;
// the dialog renders them in order.
import type { ComponentType } from "react";
import { AgentSettingsPanel } from "./AgentSettingsPanel.tsx";

export interface SettingsSection {
  id: string;
  title: string;
  Panel: ComponentType;
}

export const settingsSections: SettingsSection[] = [{ id: "agent", title: "Агент", Panel: AgentSettingsPanel }];
