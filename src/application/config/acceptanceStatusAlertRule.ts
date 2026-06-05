import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

const ACCEPTANCE_ALERT_HOUR_MSK = 17;
const ACCEPTANCE_ALERT_MINUTE_MSK = 50;
const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const DEFAULT_ACCEPTANCE_STATUS_ALERT_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: `${ACCEPTANCE_ALERT_MINUTE_MSK} ${ACCEPTANCE_ALERT_HOUR_MSK} * * *`,
  timeZone: MOSCOW_TIME_ZONE
};

function isInAcceptanceStatus(issue: JiraIssue): boolean {
  return issue.status.trim().toLowerCase() === "acceptance";
}

function buildAcceptanceAlertMessage(issue: JiraIssue, jiraBaseUrl: string): string {
  const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
  const assigneeHandle = issue.assigneeLogin ? `@${issue.assigneeLogin}` : "Ответственный";

  const lines = [
    `${assigneeHandle} [${issue.key}](${issueUrl}): ${issue.summary}`,
    "Статус: Acceptance",
    "Что нужно сделать:",
    "1. Если все готово к Done и нет внешнего заказчика - перевести в Done",
    "2. Если есть внешний заказчик - уведомить заказчика перед переводом в Done.",
    "3. Если нужны доработки — возвращать задачу в работу или переводить в Done и создавать новую."
  ];

  return lines.join("\n");
}

export function createAcceptanceStatusAlertRule(
  jiraBaseUrl: string,
  schedule: CronAlertRuleSchedule = DEFAULT_ACCEPTANCE_STATUS_ALERT_SCHEDULE
): AlertRule {
  return {
    id: "acceptance-status-alert",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-acceptance-status-alert",
    skipHandledCheck: false,
    skipOnNonWorkDays: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const notifications = [];
      let matchedIssuesCount = 0;

      for (const issue of context.issues) {
        if (!isInAcceptanceStatus(issue)) {
          continue;
        }

        matchedIssuesCount += 1;

        const message = buildAcceptanceAlertMessage(issue, jiraBaseUrl);
        notifications.push({
          message,
          usedFallback: false,
          issueKeysToLabel: [issue.key],
          issueKeysToClearSprint: []
        });
      }

      return {
        matchedIssuesCount,
        notifications
      };
    }
  };
}

function buildIssueUrl(jiraBaseUrl: string, issueKey: string): string {
  const normalizedBase = jiraBaseUrl.endsWith("/") ? jiraBaseUrl.slice(0, -1) : jiraBaseUrl;
  return `${normalizedBase}/browse/${encodeURIComponent(issueKey)}`;
}
