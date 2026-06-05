import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

export type AlertTrigger =
  | "created_non_minor_bug"
  | "moved_non_minor_bug"
  | "priority_became_non_minor_bug"
  | "daily_sprint_status_digest"
  | "mobile_ticket_released";

export interface AiProvider {
  generateJoke(input: {
    issue: JiraIssue;
    trigger: AlertTrigger;
    projectKey: string;
  }): Promise<string>;
}
