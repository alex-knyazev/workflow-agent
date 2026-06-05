import type { AlertRule, AlertRuleSchedule } from "../ports/AlertRule.js";

export interface RuleOverride {
  readonly enabled?: boolean;
  readonly schedule?: AlertRuleSchedule;
}

export interface RuleDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
  readonly defaultSchedule: AlertRuleSchedule;
  buildRule(schedule: AlertRuleSchedule): AlertRule;
}

export interface ManagedRuleState {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly defaultEnabled: boolean;
  readonly enabledOverridden: boolean;
  readonly schedule: AlertRuleSchedule;
  readonly defaultSchedule: AlertRuleSchedule;
  readonly scheduleOverridden: boolean;
}

export interface RuleUpdateCommand {
  readonly enabled?: boolean;
  readonly schedule?: AlertRuleSchedule;
}