import type { RuleOverride } from "../config/RuleDefinition.js";

export interface RuleOverrideStore {
  load(): Promise<Record<string, RuleOverride>>;
  save(overrides: Record<string, RuleOverride>): Promise<void>;
}