import type { AlertTrigger } from "./AiProvider.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";
import type { NewsItem } from "../../domain/entities/NewsItem.js";
import type { WorkCalendar } from "../../domain/WorkCalendar.js";

export interface AlertRuleMatch {
  readonly trigger: AlertTrigger;
}

export interface AlertRuleMessage {
  readonly message: string;
  readonly usedFallback: boolean;
}

export interface AlertNotification {
  readonly message: string;
  readonly usedFallback: boolean;
  readonly destinationChannel?: string;
  readonly deliverNotification?: boolean;
  readonly issueKeysToLabel: readonly string[];
  readonly issueKeysToClearSprint: readonly string[];
  readonly issueSummariesToUpdate?: readonly {
    readonly issueKey: string;
    readonly summary: string;
  }[];
}

export interface AlertRuleEvaluationContext {
  readonly issues: readonly JiraIssue[];
  readonly newsItems: readonly NewsItem[];
  readonly monitoredProjectKeys: readonly string[];
  readonly now: Date;
  readonly workCalendar?: WorkCalendar;
}

export interface AlertRuleEvaluationResult {
  readonly matchedIssuesCount: number;
  readonly notifications: readonly AlertNotification[];
}

export interface IntervalAlertRuleSchedule {
  readonly kind: "interval";
  readonly intervalMs: number;
  readonly runImmediately?: boolean;
}

export interface CronAlertRuleSchedule {
  readonly kind: "cron";
  readonly cronExpression: string;
  readonly timeZone?: string;
}

export type AlertRuleSchedule = IntervalAlertRuleSchedule | CronAlertRuleSchedule;

export type AlertRuleIssueScope = "active" | "cancelled_with_sprint";

export type AlertRuleDataSource =
  | "jira_active_issues"
  | "jira_cancelled_with_sprint_issues"
  | "kommersant_payments_news";

export interface AlertRule {
  readonly id: string;
  readonly schedule: AlertRuleSchedule;
  readonly handledLabel: string;
  readonly dataSource?: AlertRuleDataSource;
  readonly issueScope?: AlertRuleIssueScope;
  readonly skipHandledCheck?: boolean;
  readonly skipOnNonWorkDays?: boolean;
  evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult>;
  match?(issue: JiraIssue, monitoredProjectKeys: readonly string[]): AlertRuleMatch | null;
  buildMessage?(
    issue: JiraIssue,
    match: AlertRuleMatch,
    monitoredProjectKeys: readonly string[]
  ): Promise<AlertRuleMessage>;
}

export async function evaluatePerIssueRule(
  rule: AlertRule,
  context: AlertRuleEvaluationContext
): Promise<AlertRuleEvaluationResult> {
  if (!rule.match || !rule.buildMessage) {
    throw new Error(`Rule ${rule.id} does not implement per-issue evaluation methods`);
  }

  const notifications: AlertNotification[] = [];
  let matchedIssuesCount = 0;

  for (const issue of context.issues) {
    const match = rule.match(issue, context.monitoredProjectKeys);
    if (!match) {
      continue;
    }

    matchedIssuesCount += 1;

    const { message, usedFallback } = await rule.buildMessage(
      issue,
      match,
      context.monitoredProjectKeys
    );

    notifications.push({
      message,
      usedFallback,
      issueKeysToLabel: [issue.key],
      issueKeysToClearSprint: []
    });
  }

  return {
    matchedIssuesCount,
    notifications
  };
}