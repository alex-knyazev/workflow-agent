import type {
  AlertRule,
  AlertRuleEvaluationContext,
  AlertRuleEvaluationResult,
  CronAlertRuleSchedule
} from "../ports/AlertRule.js";
import type { JiraIssue } from "../../domain/entities/JiraIssue.js";

const DAILY_RUN_HOUR_MSK = 9;
const DAILY_RUN_MINUTE_MSK = 30;
const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const DEFAULT_SPRINT_STATUS_DIGEST_SCHEDULE: CronAlertRuleSchedule = {
  kind: "cron",
  cronExpression: `${DAILY_RUN_MINUTE_MSK} ${DAILY_RUN_HOUR_MSK} * * *`,
  timeZone: MOSCOW_TIME_ZONE
};

const GREETINGS: readonly string[] = [
  "Доброе утро (Доброе утро на русском)",
  "Good morning [гуд морнинг] (Доброе утро на английском)",
  "Buenos días [буэнос диас] (Доброе утро на испанском)",
  "Bonjour [бонжур] (Доброе утро на французском)",
  "Buongiorno [буонджорно] (Доброе утро на итальянском)",
  "Guten Morgen [гутен морген] (Доброе утро на немецком)",
  "Bom dia [бом диа] (Доброе утро на португальском)",
  "Selamat pagi [селамат паги] (Доброе утро на индонезийском)",
  "Günaydın [гюнайдын] (Доброе утро на турецком)",
  "Dzień dobry [джень добры] (Доброе утро на польском)",
  "Dobré ráno [добрэ рано] (Доброе утро на чешском)",
  "Jó reggelt [йо реггелт] (Доброе утро на венгерском)",
  "God morgon [гуд моррон] (Доброе утро на шведском)",
  "God morgen [гу морен] (Доброе утро на норвежском)",
  "Godmorgen [гомоэн] (Доброе утро на датском)",
  "Καλημέρα [калимера] (Доброе утро на греческом)",
  "Sabah al-khayr [сабах аль-хайр] (Доброе утро на арабском)",
  "Ohayou gozaimasu [охайо годзаимас] (Доброе утро на японском)",
  "Annyeonghaseyo [анёнхасейо] (Доброе утро на корейском)",
  "Shubh Prabhat [шубх прабхат] (Доброе утро на хинди)",
  "Chào buổi sáng [чао буой санг] (Доброе утро на вьетнамском)",
  "Sawubona [савубона] (Доброе утро на зулу)",
  "Habari za asubuhi [хабари за асубухи] (Доброе утро на суахили)",
  "Mirëmëngjes [мирэмэнджес] (Доброе утро на албанском)",
  "Dobro jutro [добро ютро] (Доброе утро на сербском)",
  "Labas rytas [лабас ритас] (Доброе утро на литовском)",
  "Tere hommikust [тере хоммикуст] (Доброе утро на эстонском)",
  "Labrīt [лабрит] (Доброе утро на латышском)",
  "Bonum mane [бонум манэ] (Доброе утро на латыни)",
  "おはようございます [охайо годзаимас] (Доброе утро на японском)",
  "좋은 아침 [чо-ын ачим] (Доброе утро на корейском)",
  "صباح الخير [сабах аль-хайр] (Доброе утро на арабском)",
  "Доброго ранку (Доброе утро на украинском)",
  "Vitaj ráno [витай рано] (Доброе утро на словацком)",
  "Supərgün [супэргюн] (Доброе утро на азербайджанском)",
  "Salom [салом] (Доброе утро на узбекском)",
  "Саубол (Доброе утро на казахском)",
  "Mag-andang umaga [маг-анданг умага] (Доброе утро на филиппинском)",
  "Góðan daginn [гоудан дагинн] (Доброе утро на исландском)",
  "Ndimaduka bwanji [ндимадука бванджи] (Доброе утро на чичева)",
];

const EMOJIS: readonly string[] = [
  "☀️", "🌅", "🌄", "🌞", "🌻", "☕", "🚀", "💪", "🎯", "✨",
  "🌿", "🐦", "🌈", "🦋", "🌸", "🍀", "⭐", "🎉", "🔥", "🏆",
];

interface SprintDigestState {
  readonly activeSprintIssues: readonly JiraIssue[];
  readonly dutySprintIssues: readonly JiraIssue[];
  readonly runDayMsk: string;
}

export function createSprintStatusDigestAlertRule(
  jiraBaseUrl: string,
  dutyBackendSprintId: number,
  schedule: CronAlertRuleSchedule = DEFAULT_SPRINT_STATUS_DIGEST_SCHEDULE
): AlertRule {
  return {
    id: "daily-sprint-status-digest",
    schedule: {
      kind: "cron",
      cronExpression: schedule.cronExpression,
      ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {})
    },
    handledLabel: "wa-daily-sprint-status-digest",
    skipHandledCheck: true,
    skipOnNonWorkDays: true,
    async evaluate(context: AlertRuleEvaluationContext): Promise<AlertRuleEvaluationResult> {
      const state = selectSprintDigestState(context, dutyBackendSprintId);
      if (state === null) {
        return {
          matchedIssuesCount: 0,
          notifications: []
        };
      }

      const dayHash = computeDayHash(state.runDayMsk);
      const greeting = GREETINGS[dayHash % GREETINGS.length]!;
      const emoji = EMOJIS[(dayHash + 7) % EMOJIS.length]!;

      const sections: string[] = [`${greeting} ${emoji}`];

      if (state.activeSprintIssues.length > 0) {
        sections.push("\n**Открытый спринт**\nУбедитесь, что тикеты находятся в корректных статусах.");
        sections.push(buildGroupedIssueList(state.activeSprintIssues, jiraBaseUrl));
      }

      if (state.dutySprintIssues.length > 0) {
        sections.push("\n**Дежурный бэкендер**\nУбедитесь, что тикеты находятся в корректных статусах.");
        sections.push(buildGroupedIssueList(state.dutySprintIssues, jiraBaseUrl));
      }

      return {
        matchedIssuesCount: countDistinctIssues(state),
        notifications: [
          {
            message: sections.join("\n"),
            usedFallback: false,
            issueKeysToLabel: [],
            issueKeysToClearSprint: []
          }
        ]
      };
    }
  };
}

function selectSprintDigestState(
  context: AlertRuleEvaluationContext,
  dutyBackendSprintId: number
): SprintDigestState | null {
  const nowParts = extractMoscowParts(context.now);
  const runDayMsk = nowParts.day;

  const monitoredProjects = new Set(
    context.monitoredProjectKeys.map((item) => item.trim().toUpperCase())
  );
  const relevantIssues = context.issues.filter((issue) =>
    monitoredProjects.has(issue.projectKey.toUpperCase())
  );

  const activeSprintIds = collectActiveSprintIds(relevantIssues);

  const activeSprintIssues = relevantIssues
    .filter((issue) => belongsToAnySprint(issue, activeSprintIds))
    .sort(sortByAssigneeThenKey);

  const dutySprintIssues = relevantIssues
    .filter((issue) => belongsToSprint(issue, dutyBackendSprintId))
    .sort(sortByAssigneeThenKey);

  if (activeSprintIssues.length === 0 && dutySprintIssues.length === 0) {
    return null;
  }

  return {
    activeSprintIssues,
    dutySprintIssues,
    runDayMsk
  };
}

function countDistinctIssues(state: SprintDigestState): number {
  return new Set(
    [...state.activeSprintIssues, ...state.dutySprintIssues].map((issue) => issue.key)
  ).size;
}

function buildGroupedIssueList(issues: readonly JiraIssue[], jiraBaseUrl: string): string {
  const assigneeOrder: string[] = [];
  const groupedByAssignee = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const key = issue.assigneeLogin ?? "__unassigned__";
    if (!groupedByAssignee.has(key)) {
      groupedByAssignee.set(key, []);
      assigneeOrder.push(key);
    }
    groupedByAssignee.get(key)!.push(issue);
  }

  const sortedKeys = [
    ...assigneeOrder.filter((k) => k !== "__unassigned__"),
    ...(assigneeOrder.includes("__unassigned__") ? ["__unassigned__"] : []),
  ];

  const lines: string[] = [];

  for (const key of sortedKeys) {
    const assigneeIssues = groupedByAssignee.get(key) ?? [];

    if (key === "__unassigned__") {
      lines.push("_Без исполнителя — необходимо назначить:_");
    } else {
      lines.push(`@${key}`);
    }

    for (const issue of assigneeIssues) {
      const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
      lines.push(`  - [${issue.key}](${issueUrl}) ${issue.summary} | ${issue.status}`);
    }
  }

  return lines.join("\n");
}

function sortByAssigneeThenKey(left: JiraIssue, right: JiraIssue): number {
  const leftAssignee = left.assigneeLogin ?? "\uFFFF";
  const rightAssignee = right.assigneeLogin ?? "\uFFFF";
  if (leftAssignee !== rightAssignee) {
    return leftAssignee.localeCompare(rightAssignee);
  }
  return left.key.localeCompare(right.key);
}

function collectActiveSprintIds(issues: readonly JiraIssue[]): Set<number> {
  const activeSprintIds = new Set<number>();

  for (const issue of issues) {
    for (const sprint of issue.sprints) {
      if ((sprint.state ?? "").toUpperCase() === "ACTIVE") {
        activeSprintIds.add(sprint.id);
      }
    }
  }

  return activeSprintIds;
}

function belongsToAnySprint(issue: JiraIssue, sprintIds: ReadonlySet<number>): boolean {
  return issue.sprints.some((sprint) => sprintIds.has(sprint.id));
}

function belongsToSprint(issue: JiraIssue, sprintId: number): boolean {
  return issue.sprints.some((sprint) => sprint.id === sprintId);
}

function buildIssueUrl(jiraBaseUrl: string, issueKey: string): string {
  const normalizedBase = jiraBaseUrl.endsWith("/") ? jiraBaseUrl.slice(0, -1) : jiraBaseUrl;
  return `${normalizedBase}/browse/${encodeURIComponent(issueKey)}`;
}

function computeDayHash(dayString: string): number {
  return dayString.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function extractMoscowParts(now: Date): { readonly day: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(now);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = map.get("year") ?? "1970";
  const month = map.get("month") ?? "01";
  const day = map.get("day") ?? "01";

  return {
    day: `${year}-${month}-${day}`
  };
}
