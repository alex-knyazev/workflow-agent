/**
 * Utility for checking if a given date is a work day.
 * Considers weekends (Saturday, Sunday) and holidays loaded from JSON.
 */
export class WorkCalendar {
  private readonly holidayDates: Set<string>;
  private readonly timeZone: string;

  constructor(holidays: readonly string[], timeZone = "Europe/Moscow") {
    // Convert dates to YYYY-MM-DD format for comparison
    this.holidayDates = new Set(
      holidays.map((date) => {
        const d = new Date(date);
        return d.toISOString().split("T")[0] ?? "";
      })
      .filter((d) => d.length > 0)
    );
    this.timeZone = timeZone;
  }

  /**
   * Check if a given date is a work day (not weekend, not holiday).
   * Takes timezone into account for date determination.
   */
  isWorkDay(date: Date): boolean {
    // Convert date to target timezone to check day of week
    const formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: this.timeZone,
      weekday: "short"
    });

    const parts = formatter.formatToParts(date);
    const weekdayPart = parts.find((p) => p.type === "weekday");

    if (!weekdayPart) {
      return true; // Fallback: assume work day if can't determine
    }

    const weekday = weekdayPart.value.toLowerCase();
    const isSaturday = weekday === "sat";
    const isSunday = weekday === "sun";

    if (isSaturday || isSunday) {
      return false;
    }

    // Check if it's a holiday
    const dateStr = this.getDateString(date);
    return !this.holidayDates.has(dateStr);
  }

  private getDateString(date: Date): string {
    // Format date in target timezone as YYYY-MM-DD
    const formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: this.timeZone
    });

    return formatter.format(date);
  }

  static createFromJson(
    jsonContent: string,
    timeZone = "Europe/Moscow"
  ): WorkCalendar {
    const data = JSON.parse(jsonContent) as { readonly holidays?: readonly string[] };
    const holidays = data.holidays ?? [];
    return new WorkCalendar(holidays, timeZone);
  }
}
