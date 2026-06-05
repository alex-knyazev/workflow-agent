import type { NewsItem } from "../../domain/entities/NewsItem.js";

export interface NewsSource {
  findKommersantPaymentsNews(): Promise<readonly NewsItem[]>;
}