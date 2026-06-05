import type { RuleDefinition, ManagedRuleState, RuleOverride, RuleUpdateCommand } from "../config/RuleDefinition.js";
import type { RuleOverrideStore } from "../ports/RuleOverrideStore.js";
import type {
  AlertRule,
  AlertRuleSchedule,
  CronAlertRuleSchedule,
  IntervalAlertRuleSchedule
} from "../ports/AlertRule.js";

interface RuleConfigurationServiceDeps {
  readonly definitions: readonly RuleDefinition[];
  readonly store: RuleOverrideStore;
}

export class RuleConfigurationService {
  private readonly definitions: readonly RuleDefinition[];
  private readonly definitionsById: Map<string, RuleDefinition>;
  private readonly store: RuleOverrideStore;
  private overridesById: Map<string, RuleOverride>;

  constructor(deps: RuleConfigurationServiceDeps) {
    this.definitions = deps.definitions;
    this.definitionsById = new Map(deps.definitions.map((definition) => [definition.id, definition]));
    this.store = deps.store;
    this.overridesById = new Map();
  }

  async initialize(): Promise<void> {
    const persistedOverrides = await this.store.load();

    for (const [ruleId, override] of Object.entries(persistedOverrides)) {
      const definition = this.definitionsById.get(ruleId);
      if (!definition) {
        continue;
      }

      const normalizedOverride = normalizeOverride(definition, override);
      if (normalizedOverride) {
        this.overridesById.set(ruleId, normalizedOverride);
      }
    }
  }

  listRules(): readonly ManagedRuleState[] {
    return this.definitions.map((definition) => buildManagedRuleState(definition, this.overridesById.get(definition.id)));
  }

  getActiveRules(): readonly AlertRule[] {
    return this.definitions
      .map((definition) => ({ definition, state: buildManagedRuleState(definition, this.overridesById.get(definition.id)) }))
      .filter((item) => item.state.enabled)
      .map((item) => item.definition.buildRule(item.state.schedule));
  }

  buildRuleById(ruleId: string): AlertRule {
    const definition = this.definitionsById.get(ruleId);
    if (!definition) {
      throw new Error(`Unknown rule: ${ruleId}`);
    }

    const state = buildManagedRuleState(definition, this.overridesById.get(ruleId));
    return definition.buildRule(state.schedule);
  }

  async updateRule(ruleId: string, command: RuleUpdateCommand): Promise<ManagedRuleState> {
    const definition = this.definitionsById.get(ruleId);
    if (!definition) {
      throw new Error(`Unknown rule: ${ruleId}`);
    }

    const currentOverride = this.overridesById.get(ruleId) ?? {};
    const nextOverride: RuleOverride = {
      ...(currentOverride.enabled !== undefined ? { enabled: currentOverride.enabled } : {}),
      ...(currentOverride.schedule ? { schedule: cloneSchedule(currentOverride.schedule) } : {}),
      ...(command.enabled !== undefined ? { enabled: command.enabled } : {}),
      ...(command.schedule ? { schedule: cloneSchedule(command.schedule) } : {})
    };

    const normalizedOverride = normalizeOverride(definition, nextOverride);
    if (normalizedOverride) {
      this.overridesById.set(ruleId, normalizedOverride);
    } else {
      this.overridesById.delete(ruleId);
    }

    await this.store.save(serializeOverrides(this.overridesById));

    return buildManagedRuleState(definition, this.overridesById.get(ruleId));
  }
}

function serializeOverrides(overridesById: ReadonlyMap<string, RuleOverride>): Record<string, RuleOverride> {
  const result: Record<string, RuleOverride> = {};

  for (const [ruleId, override] of overridesById.entries()) {
    result[ruleId] = {
      ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
      ...(override.schedule ? { schedule: cloneSchedule(override.schedule) } : {})
    };
  }

  return result;
}

function buildManagedRuleState(definition: RuleDefinition, override: RuleOverride | undefined): ManagedRuleState {
  const enabled = override?.enabled ?? definition.defaultEnabled;
  const schedule = override?.schedule ? cloneSchedule(override.schedule) : cloneSchedule(definition.defaultSchedule);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    enabled,
    defaultEnabled: definition.defaultEnabled,
    enabledOverridden: override?.enabled !== undefined,
    schedule,
    defaultSchedule: cloneSchedule(definition.defaultSchedule),
    scheduleOverridden: override?.schedule !== undefined
  };
}

function normalizeOverride(definition: RuleDefinition, override: RuleOverride): RuleOverride | undefined {
  const normalized: RuleOverride = {};

  if (override.enabled !== undefined) {
    if (typeof override.enabled !== "boolean") {
      throw new Error(`Rule ${definition.id} has invalid enabled flag`);
    }

    if (override.enabled !== definition.defaultEnabled) {
      Object.assign(normalized, { enabled: override.enabled });
    }
  }

  if (override.schedule) {
    const schedule = normalizeSchedule(definition, override.schedule);
    if (!schedulesEqual(schedule, definition.defaultSchedule)) {
      Object.assign(normalized, { schedule });
    }
  }

  return normalized.enabled !== undefined || normalized.schedule ? normalized : undefined;
}

function normalizeSchedule(definition: RuleDefinition, schedule: AlertRuleSchedule): AlertRuleSchedule {
  if (schedule.kind !== definition.defaultSchedule.kind) {
    throw new Error(`Rule ${definition.id} schedule kind cannot be changed`);
  }

  if (schedule.kind === "interval") {
    return normalizeIntervalSchedule(definition.id, schedule);
  }

  return normalizeCronSchedule(definition.id, schedule);
}

function normalizeIntervalSchedule(ruleId: string, schedule: IntervalAlertRuleSchedule): IntervalAlertRuleSchedule {
  if (!Number.isInteger(schedule.intervalMs) || schedule.intervalMs <= 0) {
    throw new Error(`Rule ${ruleId} interval must be a positive integer in milliseconds`);
  }

  return {
    kind: "interval",
    intervalMs: schedule.intervalMs,
    ...(schedule.runImmediately !== undefined ? { runImmediately: schedule.runImmediately } : {})
  };
}

function normalizeCronSchedule(ruleId: string, schedule: CronAlertRuleSchedule): CronAlertRuleSchedule {
  const cronExpression = schedule.cronExpression.trim();
  if (cronExpression.length === 0) {
    throw new Error(`Rule ${ruleId} cron expression cannot be empty`);
  }

  const timeZone = schedule.timeZone?.trim();
  if (timeZone) {
    validateTimeZone(ruleId, timeZone);
  }

  return {
    kind: "cron",
    cronExpression,
    ...(timeZone ? { timeZone } : {})
  };
}

function validateTimeZone(ruleId: string, timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Rule ${ruleId} has invalid time zone: ${timeZone}`);
  }
}

function cloneSchedule(schedule: AlertRuleSchedule): AlertRuleSchedule {
  if (schedule.kind === "interval") {
    return {
      kind: "interval",
      intervalMs: schedule.intervalMs,
      ...(schedule.runImmediately !== undefined ? { runImmediately: schedule.runImmediately } : {})
    };
  }

  return {
    kind: "cron",
    cronExpression: schedule.cronExpression,
    ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
  };
}

function schedulesEqual(left: AlertRuleSchedule, right: AlertRuleSchedule): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "interval" && right.kind === "interval") {
    return left.intervalMs === right.intervalMs && (left.runImmediately ?? true) === (right.runImmediately ?? true);
  }

  if (left.kind === "cron" && right.kind === "cron") {
    return left.cronExpression === right.cronExpression && (left.timeZone ?? "") === (right.timeZone ?? "");
  }

  return false;
}