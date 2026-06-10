import type { AlertTrigger } from "../ports/AiProvider.js";
import {
  evaluatePerIssueRule,
  type AlertRule,
  type AlertRuleMatch,
  type IntervalAlertRuleSchedule
} from "../ports/AlertRule.js";
import { type JiraIssue } from "../../domain/entities/JiraIssue.js";

const MOBILE_STACKS = ["android", "ios"] as const;
const DONE_STATUS = "Done";

export const DEFAULT_MOBILE_RELEASE_ALERT_SCHEDULE: IntervalAlertRuleSchedule = {
  kind: "interval",
  intervalMs: 10 * 60_000,
  runImmediately: true
};

function detectMobileReleaseAlertTrigger(
  issue: JiraIssue,
  monitoredProjectKeys: readonly string[]
): AlertTrigger | null {
  if (issue.status.toLowerCase() !== DONE_STATUS.toLowerCase()) {
    return null;
  }

  if (!issue.stack) {
    return null;
  }

  const normalizedStack = issue.stack.trim().toLowerCase();
  const isMobileStack = MOBILE_STACKS.some((stack) => normalizedStack === stack);

  if (!isMobileStack) {
    return null;
  }

  if (!issue.fixVersion) {
    return null;
  }

  const monitoredProjects = new Set(monitoredProjectKeys.map((item) => item.trim().toUpperCase()));
  if (!monitoredProjects.has(issue.projectKey.toUpperCase())) {
    return null;
  }

  // Trigger на статус DONE
  const statusBecameDone = issue.changes.some((change) => {
    if (change.field.toLowerCase() !== "status") {
      return false;
    }

    const current = change.to ?? "";
    return current.toLowerCase() === DONE_STATUS.toLowerCase();
  });

  if (statusBecameDone) {
    return "mobile_ticket_released";
  }

  return null;
}

async function buildMobileReleaseAlertMessage(
  issue: JiraIssue,
  trigger: AlertTrigger,
  monitoredProjectKeys: readonly string[],
  jiraBaseUrl: string
): Promise<{ readonly message: string; readonly usedFallback: boolean }> {
  const mention = resolveMentionByStack(issue.stack);
  const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
  const stackName = issue.stack?.trim().toUpperCase() ?? "UNKNOWN";

  return {
    message: [
      `${mention} ✅ [${issue.key}](${issueUrl}): ${issue.summary}`,
      `Стек: ${stackName}`,
      `Релиз: ${issue.fixVersion}`
    ].join("\n"),
    usedFallback: false
  };
}

export const mobileReleaseAlertRule: AlertRule = {
  id: "mobile-release-alert",
  schedule: DEFAULT_MOBILE_RELEASE_ALERT_SCHEDULE,
  issueScope: "done_mobile",
  handledLabel: "wa-mobile-release-alert",
  evaluate(context) {
    return evaluatePerIssueRule(this, context);
  },
  match(issue: JiraIssue, monitoredProjectKeys: readonly string[]): AlertRuleMatch | null {
    const trigger = detectMobileReleaseAlertTrigger(issue, monitoredProjectKeys);
    return trigger ? { trigger } : null;
  },
  buildMessage(
    issue: JiraIssue,
    match: AlertRuleMatch,
    monitoredProjectKeys: readonly string[]
  ) {
    return buildMobileReleaseAlertMessage(issue, match.trigger, monitoredProjectKeys, "");
  }
};

export function createMobileReleaseAlertRule(
  jiraBaseUrl: string,
  schedule: IntervalAlertRuleSchedule = DEFAULT_MOBILE_RELEASE_ALERT_SCHEDULE
): AlertRule {
  return {
    ...mobileReleaseAlertRule,
    schedule: {
      kind: "interval",
      intervalMs: schedule.intervalMs,
      runImmediately: schedule.runImmediately ?? true
    },
    evaluate(context) {
      return evaluatePerIssueRule(this, context);
    },
    buildMessage(
      issue: JiraIssue,
      match: AlertRuleMatch,
      monitoredProjectKeys: readonly string[]
    ) {
      return buildMobileReleaseAlertMessage(issue, match.trigger, monitoredProjectKeys, jiraBaseUrl);
    }
  };
}

function resolveMentionByStack(stack: string | null): string {
  const normalized = (stack ?? "").trim().toLowerCase();

  if (normalized === "android") {
    return "@gorin @elisov";
  }

  return "@gorin";
}

function buildIssueUrl(jiraBaseUrl: string, issueKey: string): string {
  const normalizedBase = jiraBaseUrl.endsWith("/") ? jiraBaseUrl.slice(0, -1) : jiraBaseUrl;
  return `${normalizedBase}/browse/${encodeURIComponent(issueKey)}`;
}
