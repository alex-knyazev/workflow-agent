import dotenv from "dotenv";

dotenv.config();

export interface AppEnv {
  readonly jiraBaseUrl: string;
  readonly jiraApiToken: string;
  readonly jiraTeamProjectKeys: readonly string[];
  readonly jiraStackFieldId: string;
  readonly jiraBugEnvironmentFieldId: string;
  readonly jiraSprintFieldId: string;
  readonly jiraDutyBackendSprintId: number;
  readonly notificationMode: "loop" | "file";
  readonly notificationLogPath: string;
  readonly loopWebhookUrl: string;
  readonly loopFailureAlertChannel: string;
  readonly kommersantPaymentsNewsLoopChannel: string;
  readonly ruleOverridesPath: string;
  readonly ruleManagementHost: string;
  readonly ruleManagementPort: number;
  readonly webAdminLogin: string;
  readonly webAdminPasswordHash: string;
  readonly webAdminSessionTtlMinutes: number;
  readonly holidaysDataPath: string;
}

export function loadEnv(): AppEnv {
  const testMode = optional("TEST_MODE", "false").toLowerCase() === "true";
  const notificationModeRaw = optional("NOTIFICATION_MODE", testMode ? "file" : "loop").toLowerCase();
  const platformPort = optional("PORT", "");
  const defaultRuleManagementHost = platformPort.length > 0 ? "0.0.0.0" : "127.0.0.1";
  const defaultRuleManagementPort = platformPort.length > 0 ? platformPort : "3210";

  if (notificationModeRaw !== "loop" && notificationModeRaw !== "file") {
    throw new Error("NOTIFICATION_MODE must be either 'loop' or 'file'");
  }

  const notificationMode = testMode ? "file" : notificationModeRaw;
  const loopWebhookUrl = optional("LOOP_WEBHOOK_URL", "");
  const loopFailureAlertChannel = optional("LOOP_FAILURE_ALERT_CHANNEL", "");

  if (notificationMode === "loop" && loopWebhookUrl.length === 0) {
    throw new Error("Missing required env variable: LOOP_WEBHOOK_URL");
  }

  return {
    jiraBaseUrl: required("JIRA_BASE_URL"),
    jiraApiToken: required("JIRA_API_TOKEN"),
    jiraTeamProjectKeys: splitCsv(required("JIRA_TEAM_PROJECT_KEYS")),
    jiraStackFieldId: required("JIRA_STACK_FIELD_ID", ""),
    jiraBugEnvironmentFieldId: required("JIRA_BUG_ENVIRONMENT_FIELD_ID", ""),
    jiraSprintFieldId: required("JIRA_SPRINT_FIELD_ID"),
    jiraDutyBackendSprintId: parsePositiveInt(
      required("JIRA_DUTY_BACKEND_SPRINT_ID", "4007"),
      "JIRA_DUTY_BACKEND_SPRINT_ID"
    ),
    notificationMode,
    notificationLogPath: required("NOTIFICATION_LOG_PATH", "logs/notifications.log"),
    loopWebhookUrl,
    loopFailureAlertChannel,
    kommersantPaymentsNewsLoopChannel: required("KOMMERSANT_PAYMENTS_NEWS_LOOP_CHANNEL", "#team_payments"),
    ruleOverridesPath: required("RULE_OVERRIDES_PATH", "logs/rule-overrides.json"),
    ruleManagementHost: required("RULE_MANAGEMENT_HOST", defaultRuleManagementHost),
    ruleManagementPort: parsePositiveInt(required("RULE_MANAGEMENT_PORT", defaultRuleManagementPort), "RULE_MANAGEMENT_PORT"),
    webAdminLogin: required("WEB_ADMIN_LOGIN"),
    webAdminPasswordHash: required("WEB_ADMIN_PASSWORD_HASH"),
    webAdminSessionTtlMinutes: parsePositiveInt(
      required("WEB_ADMIN_SESSION_TTL_MINUTES", "480"),
      "WEB_ADMIN_SESSION_TTL_MINUTES"
    ),
    holidaysDataPath: required("HOLIDAYS_DATA_PATH", "public/data/holidays-2026.json")
  };
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string") {
    throw new Error(`Missing required env variable: ${name}`);
  }

  return value.trim();
}

function optional(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function splitCsv(value: string): readonly string[] {
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (parts.length === 0) {
    throw new Error("JIRA_TEAM_PROJECT_KEYS must contain at least one project key");
  }

  return parts;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}
