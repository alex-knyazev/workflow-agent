import axios, { type AxiosInstance } from "axios";
import type { IssueLabelWriter } from "../../application/ports/IssueLabelWriter.js";
import type { JiraIssueSource } from "../../application/ports/JiraIssueSource.js";
import type { JiraChange, JiraIssue, JiraSprint } from "../../domain/entities/JiraIssue.js";

interface JiraApiClientConfig {
  readonly baseUrl: string;
  readonly bearerToken: string;
  readonly teamProjectKeys: readonly string[];
  readonly stackFieldId?: string;
  readonly bugEnvironmentFieldId?: string;
  readonly sprintFieldId?: string;
}

interface JiraSearchResponse {
  readonly maxResults: number;
  readonly startAt: number;
  readonly total: number;
  readonly issues: readonly JiraIssuePayload[];
}

interface JiraIssuePayload {
  readonly id: string;
  readonly key: string;
  readonly fields: {
    readonly summary: string;
    readonly issuetype: { readonly name: string };
    readonly priority: { readonly name: string };
    readonly status: { readonly name: string };
    readonly assignee?: { readonly name?: string | null; readonly key?: string | null } | null;
    readonly project: { readonly key: string };
    readonly labels?: readonly string[];
    readonly created: string;
    readonly updated: string;
  } & Record<string, unknown>;
  readonly changelog?: {
    readonly histories?: readonly {
      readonly created: string;
      readonly items: readonly {
        readonly field: string;
        readonly fromString: string | null;
        readonly toString: string | null;
      }[];
    }[];
  };
}

export class JiraApiClient implements JiraIssueSource, IssueLabelWriter {
  private readonly http: AxiosInstance;
  private readonly teamProjectKeys: readonly string[];
  private readonly stackFieldId: string | null;
  private readonly bugEnvironmentFieldId: string | null;
  private readonly sprintFieldId: string | null;

  constructor(config: JiraApiClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.bearerToken}`
      }
    });

    this.teamProjectKeys = config.teamProjectKeys;
    this.stackFieldId = config.stackFieldId?.trim() ? config.stackFieldId.trim() : null;
    this.bugEnvironmentFieldId = config.bugEnvironmentFieldId?.trim() ? config.bugEnvironmentFieldId.trim() : null;
    this.sprintFieldId = config.sprintFieldId?.trim() ? config.sprintFieldId.trim() : null;
  }

  async findActiveIssues(): Promise<readonly JiraIssue[]> {
    const jql = `project in (${buildProjectJqlList(this.teamProjectKeys)}) AND statusCategory != Done ORDER BY updated DESC`;
    const issues: JiraIssue[] = [];
    let startAt = 0;
    const pageSize = 100;

    while (true) {
      const response = await this.http.get<JiraSearchResponse>("/rest/api/2/search", {
        params: {
          jql,
          fields: buildFields(this.stackFieldId, this.bugEnvironmentFieldId, this.sprintFieldId),
          expand: "changelog",
          startAt,
          maxResults: pageSize
        }
      });

      issues.push(
        ...response.data.issues.map((issue) =>
          mapIssue(issue, this.stackFieldId, this.bugEnvironmentFieldId, this.sprintFieldId)
        )
      );

      const nextStartAt = response.data.startAt + response.data.issues.length;
      if (nextStartAt >= response.data.total || response.data.issues.length === 0) {
        break;
      }

      startAt = nextStartAt;
    }

    return issues;
  }

  async findCancelledIssuesWithSprint(): Promise<readonly JiraIssue[]> {
    if (!this.sprintFieldId) {
      return [];
    }

    const jql = [
      `project in (${buildProjectJqlList(this.teamProjectKeys)})`,
      "status in (Cancelled, CANCELLED)",
      `${this.sprintFieldId} is not EMPTY`,
      "ORDER BY updated DESC"
    ].join(" AND ");

    const issues: JiraIssue[] = [];
    let startAt = 0;
    const pageSize = 100;

    while (true) {
      const response = await this.http.get<JiraSearchResponse>("/rest/api/2/search", {
        params: {
          jql,
          fields: buildFields(this.stackFieldId, this.bugEnvironmentFieldId, this.sprintFieldId),
          startAt,
          maxResults: pageSize
        }
      });

      issues.push(
        ...response.data.issues.map((issue) =>
          mapIssue(issue, this.stackFieldId, this.bugEnvironmentFieldId, this.sprintFieldId)
        )
      );

      const nextStartAt = response.data.startAt + response.data.issues.length;
      if (nextStartAt >= response.data.total || response.data.issues.length === 0) {
        break;
      }

      startAt = nextStartAt;
    }

    return issues;
  }

  async addLabel(issueKey: string, label: string): Promise<void> {
    await this.http.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      update: {
        labels: [
          {
            add: label
          }
        ]
      }
    });
  }

  async clearSprintField(issueKey: string): Promise<void> {
    if (!this.sprintFieldId) {
      throw new Error("Cannot clear sprint: JIRA_SPRINT_FIELD_ID is not configured");
    }

    await this.http.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        [this.sprintFieldId]: null
      }
    });
  }

  async updateSummary(issueKey: string, summary: string): Promise<void> {
    await this.http.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        summary
      }
    });
  }
}

function buildProjectJqlList(projectKeys: readonly string[]): string {
  return projectKeys.map((item) => `"${item}"`).join(",");
}

function mapIssue(
  payload: JiraIssuePayload,
  stackFieldId: string | null,
  bugEnvironmentFieldId: string | null,
  sprintFieldId: string | null
): JiraIssue {
  return {
    id: payload.id,
    key: payload.key,
    summary: payload.fields.summary,
    issueType: payload.fields.issuetype.name,
    priority: payload.fields.priority.name,
    stack: readStackValue(payload.fields, stackFieldId),
    bugEnvironment: readTextFieldValue(payload.fields, bugEnvironmentFieldId),
    status: payload.fields.status.name,
    assigneeLogin: readAssigneeLogin(payload.fields.assignee),
    sprints: readSprints(payload.fields, sprintFieldId),
    projectKey: payload.fields.project.key,
    createdAt: new Date(payload.fields.created),
    updatedAt: new Date(payload.fields.updated),
    labels: readLabels(payload.fields.labels),
    changes: mapChanges(payload),
    fixVersion: readFixVersion(payload.fields.fixVersions)
  };
}

function buildFields(
  stackFieldId: string | null,
  bugEnvironmentFieldId: string | null,
  sprintFieldId: string | null
): string {
  const base = ["summary", "issuetype", "priority", "status", "assignee", "project", "labels", "created", "updated", "fixVersions"];
  if (bugEnvironmentFieldId) {
    base.push(bugEnvironmentFieldId);
  }

  if (stackFieldId) {
    base.push(stackFieldId);
  }

  if (sprintFieldId) {
    base.push(sprintFieldId);
  }

  return base.join(",");
}

function readAssigneeLogin(rawAssignee: JiraIssuePayload["fields"]["assignee"]): string | null {
  if (!rawAssignee) {
    return null;
  }

  const candidate = typeof rawAssignee.name === "string" && rawAssignee.name.trim().length > 0
    ? rawAssignee.name
    : typeof rawAssignee.key === "string" && rawAssignee.key.trim().length > 0
      ? rawAssignee.key
      : null;

  if (!candidate) {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function readSprints(fields: Record<string, unknown>, sprintFieldId: string | null): readonly JiraSprint[] {
  if (!sprintFieldId) {
    return [];
  }

  const raw = fields[sprintFieldId];
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: JiraSprint[] = [];
  for (const item of raw) {
    const sprint = parseSprint(item);
    if (sprint) {
      result.push(sprint);
    }
  }

  return result;
}

function parseSprint(raw: unknown): JiraSprint | null {
  if (typeof raw === "string") {
    const idMatch = raw.match(/(?:^|,)id=(\d+)/);
    if (!idMatch) {
      return null;
    }

    const rawId = idMatch[1];
    if (!rawId) {
      return null;
    }

    const parsedId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(parsedId)) {
      return null;
    }

    const stateMatch = raw.match(/(?:^|,)state=([^,\]]+)/);
    const state = stateMatch?.[1]?.trim() ?? null;
    return { id: parsedId, state: state ? state.toUpperCase() : null };
  }

  if (typeof raw === "object" && raw !== null) {
    const candidate = raw as { id?: unknown; state?: unknown };
    if (typeof candidate.id !== "number" || !Number.isFinite(candidate.id)) {
      return null;
    }

    const state = typeof candidate.state === "string" && candidate.state.trim().length > 0
      ? candidate.state.trim().toUpperCase()
      : null;
    return {
      id: candidate.id,
      state
    };
  }

  return null;
}

function readStackValue(fields: Record<string, unknown>, stackFieldId: string | null): string | null {
  if (!stackFieldId) {
    return null;
  }

  return readValueAsText(fields[stackFieldId]);
}

function readTextFieldValue(fields: Record<string, unknown>, fieldId: string | null): string | null {
  if (!fieldId) {
    return null;
  }

  return readValueAsText(fields[fieldId]);
}

function readValueAsText(raw: unknown): string | null {
  if (typeof raw === "string") {
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (isObject(raw) && typeof raw.value === "string") {
    const normalized = raw.value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function readLabels(rawLabels: unknown): readonly string[] {
  if (!Array.isArray(rawLabels)) {
    return [];
  }

  return rawLabels.filter((item): item is string => typeof item === "string");
}

function readFixVersion(rawFixVersions: unknown): string | null {
  if (!Array.isArray(rawFixVersions) || rawFixVersions.length === 0) {
    return null;
  }

  const first = rawFixVersions[0];
  if (typeof first === "object" && first !== null && "name" in first) {
    const name = (first as Record<string, unknown>).name;
    if (typeof name === "string") {
      const normalized = name.trim();
      return normalized.length > 0 ? normalized : null;
    }
  }

  return null;
}

function isObject(value: unknown): value is { readonly value?: unknown } {
  return typeof value === "object" && value !== null;
}

function mapChanges(payload: JiraIssuePayload): readonly JiraChange[] {
  const histories = payload.changelog?.histories ?? [];
  const changes: JiraChange[] = [];

  for (const history of histories) {
    const changedAt = new Date(history.created);
    for (const item of history.items) {
      changes.push({
        field: item.field,
        from: item.fromString,
        to: item.toString,
        changedAt
      });
    }
  }

  return changes;
}

