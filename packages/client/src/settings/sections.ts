// Sections of the Settings dialog (top-left menu → «Настройки»). A feature adds its own panel here,
// such as the agent choice; the dialog renders them in order.
import type { ComponentType } from "react";

export interface SettingsSection {
  id: string;
  title: string;
  Panel: ComponentType;
}

export const settingsSections: SettingsSection[] = [];
