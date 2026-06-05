import type { NewsItem } from "../../domain/entities/NewsItem.js";

export function createTestNewsForRule(ruleId: string, now: Date): readonly NewsItem[] {
  if (ruleId !== "kommersant-payments-news-alert") {
    return [];
  }

  const parts = extractMoscowParts(now);
  const previousDay = shiftMoscowDay(parts, -1);

  return [
    {
      title: "На Кубе из-за санкций США прекратят работу карты Visa и Mastercard",
      link: "https://www.kommersant.ru/doc/8711401",
      publishedAt: moscowToUtcDate(previousDay.year, previousDay.month, previousDay.day, 18, 20)
    },
    {
      title: "ВТБ планирует запустить в Казахстане оплату по QR-коду",
      link: "https://www.kommersant.ru/doc/8692404",
      publishedAt: moscowToUtcDate(parts.year, parts.month, parts.day, 8, 35)
    },
    {
      title: "В ЦБ призвали Mastercard и Visa уйти с российского рынка",
      link: "https://www.kommersant.ru/doc/8689486",
      publishedAt: moscowToUtcDate(parts.year, parts.month, parts.day, 10, 15)
    }
  ];
}

function extractMoscowParts(now: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const tokens = formatter.formatToParts(now);
  const map = new Map(tokens.map((item) => [item.type, item.value]));

  return {
    year: Number.parseInt(map.get("year") ?? "1970", 10),
    month: Number.parseInt(map.get("month") ?? "01", 10),
    day: Number.parseInt(map.get("day") ?? "01", 10)
  };
}

function shiftMoscowDay(
  date: { year: number; month: number; day: number },
  deltaDays: number
): { year: number; month: number; day: number } {
  const utcDate = moscowToUtcDate(date.year, date.month, date.day, 12, 0);
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);

  const shifted = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function moscowToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0));
}