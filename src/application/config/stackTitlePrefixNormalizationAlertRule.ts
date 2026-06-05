import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const CREATED_AFTER_CUTOFF = new Date("2026-04-01T00:00:00+03:00");

export const DEFAULT_STACK_TITLE_PREFIX_NORMALIZATION_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: "0 12,16 * * *",
  timeZone: MOSCOW_TIME_ZONE
};

const STACK_TOKEN_PATTERN = "backend|frontend|android|ios|python|react";
const STACK_EMOJI_PATTERN = "⚙️|⚙|⚛️|⚛|🤖|🍏|🍎|🐛|🚨";
const BRACKET_PREFIX_RE = new RegExp(
  `^\\s*\\[\\s*(?:(?:${STACK_EMOJI_PATTERN})\\s+)*(?:${STACK_TOKEN_PATTERN})\\s*\\]\\s*[:\\-]?\\s*`,
  "iu"
);
const COLON_PREFIX_RE = new RegExp(
  `^\\s*(?:(?:${STACK_EMOJI_PATTERN})\\s+)*(?:${STACK_TOKEN_PATTERN})\\s*:\\s*`,
  "iu"
);

export function createStackTitlePrefixNormalizationAlertRule(
  schedule: CronAlertRuleSchedule = DEFAULT_STACK_TITLE_PREFIX_NORMALIZATION_SCHEDULE
): AlertRule {
  return {
    id: "stack-title-prefix-normalization",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-stack-title-prefix-normalized",
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const updates = context.issues
        .map((issue) => {
          if (!isCreatedAfterCutoff(issue.createdAt)) {
            return null;
          }

          const descriptor = resolveStackDescriptor(issue.stack, issue.issueType, issue.priority);
          if (!descriptor) {
            return null;
          }

          const normalizedSummary = buildNormalizedSummary(issue.summary, descriptor);
          if (normalizedSummary === issue.summary) {
            return null;
          }

          return {
            issueKey: issue.key,
            summary: normalizedSummary
          };
        })
        .filter((item): item is { issueKey: string; summary: string } => item !== null);

      if (updates.length === 0) {
        return {
          matchedIssuesCount: 0,
          notifications: []
        };
      }

      return {
        matchedIssuesCount: updates.length,
        notifications: [
          {
            message: "",
            usedFallback: false,
            deliverNotification: false,
            issueKeysToLabel: updates.map((item) => item.issueKey),
            issueKeysToClearSprint: [],
            issueSummariesToUpdate: updates
          }
        ]
      };
    }
  };
}

function resolveStackDescriptor(
  stack: string | null,
  issueType: string,
  priority: string
): { readonly emoji: string; readonly designation: string } | null {
  const normalized = stack?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const isBugIssue = issueType.trim().toLowerCase() === "bug";
    const bugLeadEmoji = isCriticalOrBlockerPriority(priority) ? "🚨" : "🐛";

  if (normalized === "python") {
    return {
      emoji: isBugIssue ? `${bugLeadEmoji} ⚙️` : "⚙️",
      designation: "Backend"
    };
  }

  if (normalized === "react") {
    return {
      emoji: isBugIssue ? `${bugLeadEmoji} ⚛️` : "⚛️",
      designation: "Frontend"
    };
  }

  if (normalized === "android") {
    return {
      emoji: isBugIssue ? `${bugLeadEmoji} 🤖` : "🤖",
      designation: "Android"
    };
  }

  if (normalized === "ios") {
    return {
      emoji: isBugIssue ? `${bugLeadEmoji} 🍏` : "🍏",
      designation: "iOS"
    };
  }

  return null;
}

function isCriticalOrBlockerPriority(priority: string): boolean {
  const normalized = priority.trim().toLowerCase();
  return normalized === "critical" || normalized === "blocker";
}

function isCreatedAfterCutoff(createdAt: Date): boolean {
  return createdAt.getTime() > CREATED_AFTER_CUTOFF.getTime();
}

function buildNormalizedSummary(
  summary: string,
  descriptor: { readonly emoji: string; readonly designation: string }
): string {
  const withoutOldPrefix = stripOldStackPrefix(summary);
  return `[${descriptor.emoji} ${descriptor.designation}] ${withoutOldPrefix}`;
}

function stripOldStackPrefix(summary: string): string {
  let normalized = summary.trim();

  // Remove one or more legacy stack prefixes if they were chained by hand edits.
  for (let index = 0; index < 3; index += 1) {
    const next = normalized.replace(BRACKET_PREFIX_RE, "").replace(COLON_PREFIX_RE, "").trim();
    if (next === normalized) {
      break;
    }

    normalized = next;
  }

  return normalized.length > 0 ? normalized : summary.trim();
}
