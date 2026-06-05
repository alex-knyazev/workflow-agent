import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { NewsItem } from "../../domain/entities/NewsItem.js";

const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const DEFAULT_KOMMERSANT_PAYMENTS_NEWS_ALERT_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: "0 9,17 * * *",
  timeZone: MOSCOW_TIME_ZONE
};

const HEADER = "💸 Коммерсантъ. Новости платежных систем/терминалов/агентов.";

export function createKommersantPaymentsNewsAlertRule(
  schedule: CronAlertRuleSchedule = DEFAULT_KOMMERSANT_PAYMENTS_NEWS_ALERT_SCHEDULE,
  destinationChannel = ""
): AlertRule {
  const normalizedDestinationChannel = normalizeDestinationChannel(destinationChannel);

  return {
    id: "kommersant-payments-news-alert",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-kommersant-payments-news-alert",
    dataSource: "kommersant_payments_news",
    skipHandledCheck: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const window = resolveKommersantWindow(context.now);
      const news = context.newsItems
        .filter((item) => item.publishedAt >= window.start && item.publishedAt < window.end)
        .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());

      if (news.length === 0) {
        return {
          matchedIssuesCount: 0,
          notifications: []
        };
      }

      return {
        matchedIssuesCount: news.length,
        notifications: [
          {
            message: buildDigestMessage(news),
            usedFallback: false,
            ...(normalizedDestinationChannel
              ? { destinationChannel: normalizedDestinationChannel }
              : {}),
            issueKeysToLabel: [],
            issueKeysToClearSprint: []
          }
        ]
      };
    }
  };
}

function normalizeDestinationChannel(value: string): string {
  const normalized = value.trim();
  return normalized;
}

function buildDigestMessage(news: readonly NewsItem[]): string {
  const lines = [HEADER, ""];

  for (const item of news) {
    lines.push(`- [${item.title}](${item.link})`);
  }

  return lines.join("\n");
}

function resolveKommersantWindow(now: Date): { start: Date; end: Date } {
  const today = extractMoscowParts(now);

  if (today.hour >= 17) {
    return {
      start: moscowToUtcDate(today.year, today.month, today.day, 9, 0),
      end: moscowToUtcDate(today.year, today.month, today.day, 17, 0)
    };
  }

  const previousDay = shiftMoscowDay(today.year, today.month, today.day, -1);

  return {
    start: moscowToUtcDate(previousDay.year, previousDay.month, previousDay.day, 17, 0),
    end: moscowToUtcDate(today.year, today.month, today.day, 9, 0)
  };
}

function extractMoscowParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(map.get("year") ?? "1970", 10),
    month: Number.parseInt(map.get("month") ?? "01", 10),
    day: Number.parseInt(map.get("day") ?? "01", 10),
    hour: Number.parseInt(map.get("hour") ?? "00", 10)
  };
}

function shiftMoscowDay(year: number, month: number, day: number, delta: number): {
  year: number;
  month: number;
  day: number;
} {
  const utc = moscowToUtcDate(year, month, day, 12, 0);
  utc.setUTCDate(utc.getUTCDate() + delta);

  const shifted = new Date(utc.getTime() + 3 * 60 * 60 * 1000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function moscowToUtcDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0));
}