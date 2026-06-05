import axios from "axios";
import { load } from "cheerio";
import type { NewsSource } from "../../application/ports/NewsSource.js";
import type { NewsItem } from "../../domain/entities/NewsItem.js";

const KOMMERSANT_THEME_URL = "https://www.kommersant.ru/theme/2017";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export class KommersantThemeNewsSource implements NewsSource {
  async findKommersantPaymentsNews(): Promise<readonly NewsItem[]> {
    const response = await axios.get<string>(KOMMERSANT_THEME_URL, {
      headers: {
        "User-Agent": USER_AGENT
      }
    });

    const $ = load(response.data);
    const result: NewsItem[] = [];
    const dedup = new Set<string>();

    $("article, .news-item, .theme-news-item, .uho__item").each((_, element) => {
      const title = $(element).find("a").first().text().trim();
      const rawLink = $(element).find("a").first().attr("href") ?? "";
      const dateText = $(element).find("p, .uho__tag, time").first().text().trim();

      if (!title || !rawLink || !dateText) {
        return;
      }

      const publishedAt = parseMoscowDate(dateText);
      if (!publishedAt) {
        return;
      }

      const link = rawLink.startsWith("http")
        ? rawLink
        : `https://www.kommersant.ru${rawLink}`;

      if (dedup.has(link)) {
        return;
      }

      dedup.add(link);
      result.push({
        title,
        link,
        publishedAt
      });
    });

    return result.sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
  }
}

function parseMoscowDate(value: string): Date | null {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const year = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  // Moscow time is UTC+3. Convert wall-clock to UTC timestamp.
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0));
}