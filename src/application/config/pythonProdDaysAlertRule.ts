import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

const PYTHON_STACK = "python";
const ON_PROD_STATUS = "on prod";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const DAILY_RUN_HOUR_MSK = 10;
const DAILY_RUN_MINUTE_MSK = 0;
const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const DEFAULT_PYTHON_PROD_DAYS_ALERT_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: `${DAILY_RUN_MINUTE_MSK} ${DAILY_RUN_HOUR_MSK} * * *`,
  timeZone: MOSCOW_TIME_ZONE
};

function isPythonStack(stack: string | null): boolean {
  if (!stack) {
    return false;
  }

  return stack.trim().toLowerCase() === PYTHON_STACK;
}

function isOnProdStatus(issue: JiraIssue): boolean {
  return issue.status.trim().toLowerCase() === ON_PROD_STATUS;
}

function getTimeInCurrentStatus(issue: JiraIssue, now: Date): number {
  // Ищем последнее изменение статуса в истории
  const statusChanges = issue.changes
    .filter((change) => change.field.toLowerCase().includes("status"))
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  if (statusChanges.length === 0) {
    // Если нет истории изменений, используем updatedAt
    return now.getTime() - issue.updatedAt.getTime();
  }

  const lastStatusChange = statusChanges[0]!;
  return now.getTime() - lastStatusChange.changedAt.getTime();
}

function isInStatusMoreThanOneDay(issue: JiraIssue, now: Date): boolean {
  const timeInStatus = getTimeInCurrentStatus(issue, now);
  return timeInStatus > ONE_DAY_MS;
}

function buildPythonProdAlertMessage(issue: JiraIssue, jiraBaseUrl: string, daysInStatus: number): string {
  const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
  const assigneeHandle = issue.assigneeLogin ? `@${issue.assigneeLogin}` : "Ответственный";
  const roundedDays = Math.round(daysInStatus * 100) / 100;

  const lines = [
    `${assigneeHandle} [${issue.key}](${issueUrl}): ${issue.summary}`,
    `стек: Python`,
    `Статус: On Prod (дней: ${roundedDays})`,
    "Что нужно сделать:",
    "1. Убедиться, что изменения стабильны и не требуют отката.",
    "2. Принять решение - нужно ли тестировать/проверять на проде, или можно переводить в Done",
  ];

  return lines.join("\n");
}

export function createPythonProdDaysAlertRule(
  jiraBaseUrl: string,
  schedule: CronAlertRuleSchedule = DEFAULT_PYTHON_PROD_DAYS_ALERT_SCHEDULE
): AlertRule {
  return {
    id: "python-prod-days-alert",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-python-prod-days-alert",
    skipHandledCheck: true,
    skipOnNonWorkDays: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const notifications = [];
      let matchedIssuesCount = 0;

      for (const issue of context.issues) {
        if (!isOnProdStatus(issue)) {
          continue;
        }

        if (!isPythonStack(issue.stack)) {
          continue;
        }

        if (!isInStatusMoreThanOneDay(issue, context.now)) {
          continue;
        }

        matchedIssuesCount += 1;

        const timeInStatus = getTimeInCurrentStatus(issue, context.now);
        const daysInStatus = timeInStatus / ONE_DAY_MS;

        const message = buildPythonProdAlertMessage(issue, jiraBaseUrl, daysInStatus);
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
