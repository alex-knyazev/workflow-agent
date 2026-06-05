import { type JiraIssue } from "../../domain/entities/JiraIssue.js";

function createBaseIssue(partial: Partial<JiraIssue> & Pick<JiraIssue, "id" | "key" | "summary">): JiraIssue {
  const now = new Date();

  return {
    id: partial.id,
    key: partial.key,
    summary: partial.summary,
    issueType: partial.issueType ?? "Task",
    priority: partial.priority ?? "Major",
    stack: partial.stack ?? null,
    bugEnvironment: partial.bugEnvironment ?? null,
    status: partial.status ?? "In Progress",
    assigneeLogin: partial.assigneeLogin ?? "test.user",
    sprints: partial.sprints ?? [],
    projectKey: partial.projectKey ?? "PAY",
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    labels: partial.labels ?? [],
    changes: partial.changes ?? [],
    fixVersion: partial.fixVersion ?? null
  };
}

export function createTestIssuesForRule(
  ruleId: string,
  now: Date
): readonly JiraIssue[] {
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const projectKey = "PAY";

  switch (ruleId) {
    case "non-minor-bug-alert":
      return [
        createBaseIssue({
          id: "90001",
          key: "PAY-9001",
          summary: "Падает мобильный экран подтверждения",
          issueType: "Bug",
          priority: "Major",
          stack: "android",
          status: "Open",
          projectKey,
          createdAt: oneHourAgo,
          updatedAt: oneHourAgo,
          changes: []
        })
      ];
    case "daily-sprint-status-digest":
      return [
        createBaseIssue({
          id: "90002",
          key: "PAY-9002",
          summary: "Сверстать экран релиз-заметок",
          issueType: "Task",
          status: "In Progress",
          assigneeLogin: "gorin",
          sprints: [{ id: 777, state: "ACTIVE" }],
          projectKey
        })
      ];
    case "cancelled-sprint-cleanup":
      return [
        createBaseIssue({
          id: "90003",
          key: "PAY-9003",
          summary: "Снять устаревший эксперимент",
          status: "Cancelled",
          sprints: [{ id: 778, state: "CLOSED" }],
          projectKey
        })
      ];
    case "acceptance-status-alert":
      return [
        createBaseIssue({
          id: "90004",
          key: "PAY-9004",
          summary: "Проверить итоговую интеграцию оплаты",
          status: "Acceptance",
          assigneeLogin: "knyazev.a",
          projectKey
        })
      ];
    case "python-prod-days-alert":
      return [
        createBaseIssue({
          id: "90005",
          key: "PAY-9005",
          summary: "Обновить воркер сверки вебхуков",
          status: "On Prod",
          stack: "python",
          assigneeLogin: "payments-duty",
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
          projectKey
        })
      ];
    case "mobile-release-alert":
      return [
        createBaseIssue({
          id: "90006",
          key: "PAY-9006",
          summary: "Выложить платежный SDK в App Store",
          status: "Done",
          stack: "ios",
          fixVersion: "2026.06.04",
          projectKey,
          changes: [
            {
              field: "status",
              from: "In Progress",
              to: "Done",
              changedAt: oneHourAgo
            }
          ]
        })
      ];
    case "kommersant-payments-news-alert":
      // This rule uses news source fixtures from ruleTestNewsFixtures.ts.
      return [];
    case "code-review-working-day-alert":
      return [
        createBaseIssue({
          id: "90007",
          key: "PAY-9007",
          summary: "Проверить регрессию в обработке чарджбеков",
          status: "Code Review",
          assigneeLogin: "review.owner",
          projectKey,
          createdAt: twoDaysAgo,
          updatedAt: now,
          changes: [
            {
              field: "status",
              from: "In Progress",
              to: "Code Review",
              changedAt: twoDaysAgo
            }
          ]
        })
      ];
    case "stack-title-prefix-normalization":
      return [
        createBaseIssue({
          id: "90008",
          key: "PAY-9008",
          summary: "Backend: Доработать обработчик вебхуков",
          stack: "python",
          projectKey
        })
      ];
    default:
      return [];
  }
}