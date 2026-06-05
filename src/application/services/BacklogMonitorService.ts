import type { AlertRule, AlertRuleDataSource } from "../ports/AlertRule.js";
import type { IssueLabelWriter } from "../ports/IssueLabelWriter.js";
import type { JiraIssueSource } from "../ports/JiraIssueSource.js";
import type { NewsSource } from "../ports/NewsSource.js";
import type { Notifier } from "../ports/Notifier.js";
import { type JiraIssue } from "../../domain/entities/JiraIssue.js";
import { type NewsItem } from "../../domain/entities/NewsItem.js";
import { type WorkCalendar } from "../../domain/WorkCalendar.js";
import { AsyncTask, CronJob, SimpleIntervalJob, ToadScheduler } from "toad-scheduler";
import { createTestIssuesForRule } from "./ruleTestIssueFixtures.js";
import { createTestNewsForRule } from "./ruleTestNewsFixtures.js";

interface BacklogMonitorDeps {
  readonly issueSource: JiraIssueSource;
  readonly newsSource: NewsSource;
  readonly labelWriter: IssueLabelWriter;
  readonly notifier: Notifier;
  readonly ruleFailureNotifier?: Notifier;
  readonly ruleFailureChannel?: string;
  readonly monitoredProjectKeys: readonly string[];
  readonly rules: readonly AlertRule[];
  readonly workCalendar?: WorkCalendar | undefined;
}

interface RuleRunState {
  lastRunAt: Date;
  isRunning: boolean;
}

interface RuleExecutionOptions {
  readonly issuesMode?: "live" | "test";
  readonly skipIssueMutations?: boolean;
  readonly ignoreNonWorkDays?: boolean;
}

export interface RuleExecutionResult {
  readonly matchedIssuesCount: number;
  readonly notifiedCount: number;
}

export class BacklogMonitorService {
  private static readonly RULE_FAILURE_ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

  private readonly issueSource: JiraIssueSource;
  private readonly newsSource: NewsSource;
  private readonly labelWriter: IssueLabelWriter;
  private readonly notifier: Notifier;
  private readonly ruleFailureNotifier: Notifier | undefined;
  private readonly ruleFailureChannel: string | undefined;
  private readonly lastRuleFailureAlertAtByRuleId: Map<string, Date>;
  private readonly monitoredProjectKeys: readonly string[];
  private readonly scheduler: ToadScheduler;
  private rulesById: Map<string, AlertRule>;
  private readonly ruleStateById: Map<string, RuleRunState>;
  private readonly workCalendar: WorkCalendar | undefined;
  private started: boolean;

  constructor(deps: BacklogMonitorDeps) {
    this.issueSource = deps.issueSource;
    this.newsSource = deps.newsSource;
    this.labelWriter = deps.labelWriter;
    this.notifier = deps.notifier;
    this.ruleFailureNotifier = deps.ruleFailureNotifier;
    this.ruleFailureChannel = deps.ruleFailureChannel;
    this.lastRuleFailureAlertAtByRuleId = new Map();
    this.monitoredProjectKeys = deps.monitoredProjectKeys;
    this.scheduler = new ToadScheduler();
    this.rulesById = new Map();
    this.ruleStateById = new Map();
    this.workCalendar = deps.workCalendar;
    this.started = false;
    this.replaceRules(deps.rules);
  }

  async runRuleOnce(rule: AlertRule): Promise<void> {
    if (this.isRuleRunning(rule.id)) {
      return;
    }

    await this.executeRule(rule, {});
  }

  async triggerRuleManually(
    rule: AlertRule,
    options: RuleExecutionOptions = {}
  ): Promise<RuleExecutionResult> {
    if (this.isRuleRunning(rule.id)) {
      throw new Error(`Rule ${rule.id} is already running right now`);
    }

    return this.executeRule(rule, {
      issuesMode: options.issuesMode ?? "live",
      skipIssueMutations: options.skipIssueMutations ?? false,
      ignoreNonWorkDays: true
    });
  }

  private isRuleRunning(ruleId: string): boolean {
    const state = this.ruleStateById.get(ruleId);
    return Boolean(state?.isRunning);
  }

  private getOrCreateRuleState(rule: AlertRule): RuleRunState {
    const existing = this.ruleStateById.get(rule.id);
    if (existing) {
      return existing;
    }

    const created: RuleRunState = {
      lastRunAt: getInitialLastRunAt(rule),
      isRunning: false
    };
    this.ruleStateById.set(rule.id, created);
    return created;
  }

  private async executeRule(
    rule: AlertRule,
    options: RuleExecutionOptions
  ): Promise<RuleExecutionResult> {
    const ruleState = this.getOrCreateRuleState(rule);

    // Skip rule execution on non-work days if configured
    if (!options.ignoreNonWorkDays && rule.skipOnNonWorkDays && this.workCalendar) {
      const now = new Date();
      if (!this.workCalendar.isWorkDay(now)) {
        console.log(`[workflow-agent] rule=${rule.id} skipped (non-work day)`);
        return {
          matchedIssuesCount: 0,
          notifiedCount: 0
        };
      }
    }

    ruleState.isRunning = true;

    try {
      const since = ruleState.lastRunAt;
      const now = new Date();
      const dataSource = resolveDataSource(rule);
      const sourcePayload = await loadSourcePayload({
        issueSource: this.issueSource,
        newsSource: this.newsSource,
        rule,
        dataSource,
        now,
        mode: options.issuesMode ?? "live"
      });

      const issues = sourcePayload.issues;
      const newsItems = sourcePayload.newsItems;
      const eligibleIssues = rule.skipHandledCheck
        ? issues
        : issues.filter((issue) => !isHandledForRule(issue, rule));
      const skippedHandled = issues.length - eligibleIssues.length;

      console.log(
        `[workflow-agent] rule=${rule.id} source=${dataSource} window ${since.toISOString()}..${now.toISOString()}, fetched=${sourcePayload.fetchedCount}, projects=${this.monitoredProjectKeys.join(",")}`
      );

      const evaluation = await rule.evaluate({
        issues: eligibleIssues,
        newsItems,
        monitoredProjectKeys: this.monitoredProjectKeys,
        now,
        ...(this.workCalendar ? { workCalendar: this.workCalendar } : {})
      });

      let quoteFallbackUsed = 0;
      let clearedSprintCount = 0;
      for (const notification of evaluation.notifications) {
        if (notification.usedFallback) {
          quoteFallbackUsed += 1;
        }

        await this.notifier.sendMessage(
          notification.message,
          notification.destinationChannel
            ? { channel: notification.destinationChannel }
            : undefined
        );
        if (!options.skipIssueMutations) {
          for (const issueKey of notification.issueKeysToLabel) {
            await this.labelWriter.addLabel(issueKey, rule.handledLabel);
          }

          for (const issueKey of notification.issueKeysToClearSprint) {
            await this.labelWriter.clearSprintField(issueKey);
            clearedSprintCount += 1;
          }
        }
      }

      const matchedRules = evaluation.matchedIssuesCount;
      const skipBase = dataSource === "kommersant_payments_news" ? newsItems.length : eligibleIssues.length;
      const skippedNoTrigger = Math.max(skipBase - matchedRules, 0);
      const notified = evaluation.notifications.length;

      console.log(
        `[workflow-agent] rule=${rule.id} result fetched=${sourcePayload.fetchedCount}, matchedRules=${matchedRules}, notified=${notified}, skippedHandled=${skippedHandled}, skippedNoTrigger=${skippedNoTrigger}, quoteFallbackUsed=${quoteFallbackUsed}, clearedSprintCount=${clearedSprintCount}`
      );

      ruleState.lastRunAt = now;

      return {
        matchedIssuesCount: matchedRules,
        notifiedCount: notified
      };
    } catch (error: unknown) {
      await this.notifyRuleExecutionFailure(rule, error);
      throw error;
    } finally {
      ruleState.isRunning = false;
    }
  }

  private async notifyRuleExecutionFailure(rule: AlertRule, error: unknown): Promise<void> {
    if (!this.ruleFailureNotifier) {
      return;
    }

    const now = new Date();
    const lastAlertAt = this.lastRuleFailureAlertAtByRuleId.get(rule.id);
    if (
      lastAlertAt
      && now.getTime() - lastAlertAt.getTime() < BacklogMonitorService.RULE_FAILURE_ALERT_THROTTLE_MS
    ) {
      return;
    }

    const normalizedError = normalizeUnknownError(error);
    const message = [
      `Workflow agent rule execution failed.`,
      `rule: ${rule.id}`,
      `time: ${now.toISOString()}`,
      `error: ${normalizedError.message}`,
      ...(normalizedError.stack ? ["", truncateText(normalizedError.stack, 2000)] : [])
    ].join("\n");

    try {
      await this.ruleFailureNotifier.sendMessage(
        message,
        this.ruleFailureChannel ? { channel: this.ruleFailureChannel } : undefined
      );
      this.lastRuleFailureAlertAtByRuleId.set(rule.id, now);
    } catch (notificationError: unknown) {
      console.error(
        `[workflow-agent] failed to send rule failure alert for rule=${rule.id}`,
        notificationError
      );
    }
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    for (const rule of this.rulesById.values()) {
      this.registerRule(rule);
    }
  }

  stop(): void {
    this.scheduler.stop();
    this.started = false;
  }

  replaceRules(rules: readonly AlertRule[]): void {
    for (const ruleId of this.rulesById.keys()) {
      if (this.scheduler.existsById(ruleId)) {
        this.scheduler.removeById(ruleId);
      }
    }

    this.rulesById = new Map(rules.map((rule) => [rule.id, rule]));
    this.ruleStateById.clear();

    for (const rule of this.rulesById.values()) {
      this.ruleStateById.set(rule.id, {
        lastRunAt: getInitialLastRunAt(rule),
        isRunning: false
      });

      if (this.started) {
        this.registerRule(rule);
      }
    }
  }

  private registerRule(rule: AlertRule): void {
    const task = new AsyncTask(
      `rule:${rule.id}`,
      async () => this.runRuleOnce(rule),
      (error: unknown) => {
        console.error(`[workflow-agent] rule=${rule.id} failed`, error);
      }
    );

    const job = createSchedulerJob(rule, task);

    if (job instanceof CronJob) {
      this.scheduler.addCronJob(job);
      return;
    }

    this.scheduler.addSimpleIntervalJob(job);
  }
}

function normalizeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(typeof error.stack === "string" && error.stack.length > 0 ? { stack: error.stack } : {})
    };
  }

  return {
    message: String(error)
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function createSchedulerJob(rule: AlertRule, task: AsyncTask): CronJob | SimpleIntervalJob {
  if (rule.schedule.kind === "cron") {
    return new CronJob(
      rule.schedule.timeZone
        ? {
            cronExpression: rule.schedule.cronExpression,
            timezone: rule.schedule.timeZone
          }
        : {
            cronExpression: rule.schedule.cronExpression
          },
      task,
      {
        id: rule.id,
        preventOverrun: true
      }
    );
  }

  return new SimpleIntervalJob(
    {
      milliseconds: rule.schedule.intervalMs,
      runImmediately: rule.schedule.runImmediately ?? true
    },
    task,
    {
      id: rule.id,
      preventOverrun: true
    }
  );
}

function getInitialLastRunAt(rule: AlertRule): Date {
  if (rule.schedule.kind === "interval") {
    return new Date(Date.now() - rule.schedule.intervalMs);
  }

  return new Date();
}

function isHandledForRule(issue: JiraIssue, rule: AlertRule): boolean {
  const handledLabel = rule.handledLabel.trim().toLowerCase();
  return issue.labels.some((label) => label.trim().toLowerCase() === handledLabel);
}

function resolveDataSource(rule: AlertRule): AlertRuleDataSource {
  if (rule.dataSource) {
    return rule.dataSource;
  }

  if (rule.issueScope === "cancelled_with_sprint") {
    return "jira_cancelled_with_sprint_issues";
  }

  return "jira_active_issues";
}

async function loadSourcePayload(args: {
  issueSource: JiraIssueSource;
  newsSource: NewsSource;
  rule: AlertRule;
  dataSource: AlertRuleDataSource;
  now: Date;
  mode: "live" | "test";
}): Promise<{
  issues: readonly JiraIssue[];
  newsItems: readonly NewsItem[];
  fetchedCount: number;
}> {
  if (args.mode === "test") {
    if (args.dataSource === "kommersant_payments_news") {
      const newsItems = createTestNewsForRule(args.rule.id, args.now);
      return {
        issues: [],
        newsItems,
        fetchedCount: newsItems.length
      };
    }

    const issues = createTestIssuesForRule(args.rule.id, args.now);
    return {
      issues,
      newsItems: [],
      fetchedCount: issues.length
    };
  }

  if (args.dataSource === "kommersant_payments_news") {
    const newsItems = await args.newsSource.findKommersantPaymentsNews();
    return {
      issues: [],
      newsItems,
      fetchedCount: newsItems.length
    };
  }

  const issues = args.dataSource === "jira_cancelled_with_sprint_issues"
    ? await args.issueSource.findCancelledIssuesWithSprint()
    : await args.issueSource.findActiveIssues();

  return {
    issues,
    newsItems: [],
    fetchedCount: issues.length
  };
}
