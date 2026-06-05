import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

const CODE_REVIEW_STATUS = "code review";
const WORK_DAY_HOURS_THRESHOLD = 8;
const WORK_DAY_START_HOUR = 9;
const WORK_DAY_END_HOUR = 18;
const MS_IN_HOUR = 60 * 60 * 1000;
const MS_IN_DAY = 24 * MS_IN_HOUR;
const MOSCOW_TIME_ZONE = "Europe/Moscow";
const MOSCOW_UTC_OFFSET_HOURS = 3;

const DAILY_RUN_HOUR_MSK = 10;
const DAILY_RUN_MINUTE_MSK = 0;

export const DEFAULT_CODE_REVIEW_WORKING_DAY_ALERT_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: `${DAILY_RUN_MINUTE_MSK} ${DAILY_RUN_HOUR_MSK} * * *`,
  timeZone: MOSCOW_TIME_ZONE
};

function isInCodeReviewStatus(issue: JiraIssue): boolean {
  return issue.status.trim().toLowerCase() === CODE_REVIEW_STATUS;
}

function findEnteredCodeReviewAt(issue: JiraIssue): Date {
  const transitionsToCodeReview = issue.changes
    .filter((change) => change.field.trim().toLowerCase() === "status")
    .filter((change) => (change.to ?? "").trim().toLowerCase() === CODE_REVIEW_STATUS)
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  return transitionsToCodeReview[0]?.changedAt ?? issue.updatedAt;
}

function calculateWorkingHoursBetween(
  start: Date,
  end: Date,
  context: AlertRuleEvaluationContext
): number {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) {
    return 0;
  }

  const offsetMs = MOSCOW_UTC_OFFSET_HOURS * MS_IN_HOUR;
  const localStartMs = startMs + offsetMs;
  const localEndMs = endMs + offsetMs;

  let totalWorkingMs = 0;
  let dayStartMs = getDayStartUtcMs(localStartMs);

  while (dayStartMs < localEndMs) {
    if (isWorkDayLocal(dayStartMs, context)) {
      const workWindowStartMs = dayStartMs + WORK_DAY_START_HOUR * MS_IN_HOUR;
      const workWindowEndMs = dayStartMs + WORK_DAY_END_HOUR * MS_IN_HOUR;

      const overlapStartMs = Math.max(workWindowStartMs, localStartMs);
      const overlapEndMs = Math.min(workWindowEndMs, localEndMs);

      if (overlapEndMs > overlapStartMs) {
        totalWorkingMs += overlapEndMs - overlapStartMs;
      }
    }

    dayStartMs += MS_IN_DAY;
  }

  return totalWorkingMs / MS_IN_HOUR;
}

function isWorkDayLocal(localDayStartUtcMs: number, context: AlertRuleEvaluationContext): boolean {
  if (!context.workCalendar) {
    const localDate = new Date(localDayStartUtcMs);
    const day = localDate.getUTCDay();
    return day !== 0 && day !== 6;
  }

  // Convert local day back to UTC instant and pick midday to avoid boundary issues.
  const dayMidpointUtcMs =
    localDayStartUtcMs - MOSCOW_UTC_OFFSET_HOURS * MS_IN_HOUR + 12 * MS_IN_HOUR;

  return context.workCalendar.isWorkDay(new Date(dayMidpointUtcMs));
}

function getDayStartUtcMs(localUtcMs: number): number {
  const localDate = new Date(localUtcMs);
  return Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate());
}

function formatMoscowDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function formatWorkingHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildCodeReviewAlertMessage(
  issue: JiraIssue,
  jiraBaseUrl: string,
  enteredCodeReviewAt: Date,
  workingHours: number
): string {
  const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
  const assigneeHandle = issue.assigneeLogin ? `@${issue.assigneeLogin}` : "Ответственный";

  return [
    `${assigneeHandle} [${issue.key}](${issueUrl}): ${issue.summary}`,
    `Задача перешла в Code Review: ${formatMoscowDateTime(enteredCodeReviewAt)} (МСК).`,
    `Находится в Code Review уже ${formatWorkingHours(workingHours)} рабочих часов (рабочее время: 09:00-18:00).`
  ].join("\n");
}

export function createCodeReviewWorkingDayAlertRule(
  jiraBaseUrl: string,
  schedule: CronAlertRuleSchedule = DEFAULT_CODE_REVIEW_WORKING_DAY_ALERT_SCHEDULE
): AlertRule {
  return {
    id: "code-review-working-day-alert",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-code-review-working-day-alert",
    skipHandledCheck: true,
    skipOnNonWorkDays: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const notifications = [];
      let matchedIssuesCount = 0;

      for (const issue of context.issues) {
        if (!isInCodeReviewStatus(issue)) {
          continue;
        }

        const enteredCodeReviewAt = findEnteredCodeReviewAt(issue);
        const workingHours = calculateWorkingHoursBetween(enteredCodeReviewAt, context.now, context);

        if (workingHours <= WORK_DAY_HOURS_THRESHOLD) {
          continue;
        }

        matchedIssuesCount += 1;

        const message = buildCodeReviewAlertMessage(
          issue,
          jiraBaseUrl,
          enteredCodeReviewAt,
          workingHours
        );

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
