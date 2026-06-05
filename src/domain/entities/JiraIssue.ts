export interface JiraChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly changedAt: Date;
}

export interface JiraSprint {
  readonly id: number;
  readonly state: string | null;
}

export interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly summary: string;
  readonly issueType: string;
  readonly priority: string;
  readonly stack: string | null;
  readonly bugEnvironment: string | null;
  readonly status: string;
  readonly assigneeLogin: string | null;
  readonly sprints: readonly JiraSprint[];
  readonly projectKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly labels: readonly string[];
  readonly changes: readonly JiraChange[];
  readonly fixVersion: string | null;
}

export function isIssueType(issue: JiraIssue, acceptedTypes: readonly string[]): boolean {
  const normalized = issue.issueType.trim().toLowerCase();
  return acceptedTypes.some((item) => item.trim().toLowerCase() === normalized);
}

export function isMinorPriority(priority: string, minorPriorities: readonly string[]): boolean {
  const normalized = priority.trim().toLowerCase();
  return minorPriorities.some((item) => item.trim().toLowerCase() === normalized);
}
