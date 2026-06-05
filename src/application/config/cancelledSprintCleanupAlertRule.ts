import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

const DAILY_RUN_HOUR_MSK = 16;
const DAILY_RUN_MINUTE_MSK = 0;
const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const DEFAULT_CANCELLED_SPRINT_CLEANUP_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: `${DAILY_RUN_MINUTE_MSK} ${DAILY_RUN_HOUR_MSK} * * *`,
  timeZone: MOSCOW_TIME_ZONE
};

export function createCancelledSprintCleanupAlertRule(
  jiraBaseUrl: string,
  schedule: CronAlertRuleSchedule = DEFAULT_CANCELLED_SPRINT_CLEANUP_SCHEDULE
): AlertRule {
  return {
    id: "cancelled-sprint-cleanup",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    issueScope: "cancelled_with_sprint",
    handledLabel: "wa-cancelled-sprint-cleanup",
    skipHandledCheck: true,
    skipOnNonWorkDays: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const candidates = context.issues.filter((issue) => isCancelledWithSprint(issue));
      if (candidates.length === 0) {
        return {
          matchedIssuesCount: 0,
          notifications: []
        };
      }

      const lines = candidates
        .slice(0, 20)
        .map((issue) => `- [${issue.key}](${buildIssueUrl(jiraBaseUrl, issue.key)}) ${issue.summary}`);

      if (candidates.length > 20) {
        lines.push(`- ... и еще ${candidates.length - 20} задач`);
      }

      return {
        matchedIssuesCount: candidates.length,
        notifications: [
          {
            message: [
              `🧹 Очищаю Sprint у CANCELLED задач: ${candidates.length}`,
              ...lines
            ].join("\n"),
            usedFallback: false,
            issueKeysToLabel: [],
            issueKeysToClearSprint: candidates.map((issue) => issue.key)
          }
        ]
      };
    }
  };
}

function isCancelledWithSprint(issue: JiraIssue): boolean {
  const normalizedStatus = issue.status.trim().toLowerCase();
  const isCancelledStatus = normalizedStatus === "cancelled" || normalizedStatus === "canceled";
  return isCancelledStatus && issue.sprints.length > 0;
}

function buildIssueUrl(jiraBaseUrl: string, issueKey: string): string {
  const normalizedBase = jiraBaseUrl.endsWith("/") ? jiraBaseUrl.slice(0, -1) : jiraBaseUrl;
  return `${normalizedBase}/browse/${encodeURIComponent(issueKey)}`;
}
