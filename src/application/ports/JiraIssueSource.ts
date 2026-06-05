import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

export interface JiraIssueSource {
  findActiveIssues(): Promise<readonly JiraIssue[]>;
  findCancelledIssuesWithSprint(): Promise<readonly JiraIssue[]>;
}
