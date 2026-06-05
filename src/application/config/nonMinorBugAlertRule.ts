import type { AlertTrigger } from "../ports/AiProvider.js";
import {
  evaluatePerIssueRule,
  type AlertRule,
  type AlertRuleMatch,
  type IntervalAlertRuleSchedule
} from "../ports/AlertRule.js";
import { isIssueType, isMinorPriority, type JiraIssue } from "../../domain/entities/JiraIssue.js";

const BUG_ISSUE_TYPES = ["Bug"] as const;
const MINOR_PRIORITIES = ["Minоr"] as const; //Здесь буква о на кириллице так как почему-то такое именно написание в нашей Jira.

export const DEFAULT_NON_MINOR_BUG_ALERT_SCHEDULE: IntervalAlertRuleSchedule = {
  kind: "interval",
  intervalMs: 5 * 60_000,
  runImmediately: true
};

function detectNonMinorBugAlertTrigger(
  issue: JiraIssue,
  monitoredProjectKeys: readonly string[]
): AlertTrigger | null {
  if (!isIssueType(issue, BUG_ISSUE_TYPES)) {
    return null;
  }

  if (isMinorPriority(issue.priority, MINOR_PRIORITIES)) {
    return null;
  }

  const monitoredProjects = new Set(monitoredProjectKeys.map((item) => item.trim().toUpperCase()));

  if (!monitoredProjects.has(issue.projectKey.toUpperCase())) {
    return null;
  }

  if (isDevelopmentEnvironment(issue.bugEnvironment)) {
    return null;
  }

  const movedToMonitoredProject = issue.changes.some((change) => {
    if (!change.field.toLowerCase().includes("project")) {
      return false;
    }

    const toProject = (change.to ?? "").toUpperCase();
    return monitoredProjects.has(toProject);
  });

  if (movedToMonitoredProject) {
    return "moved_non_minor_bug";
  }

  const priorityBecameNonMinor = issue.changes.some((change) => {
    if (change.field.toLowerCase() !== "priority") {
      return false;
    }

    const previous = change.from ?? "";
    const current = change.to ?? "";

    return isMinorPriority(previous, MINOR_PRIORITIES) && !isMinorPriority(current, MINOR_PRIORITIES);
  });

  if (priorityBecameNonMinor) {
    return "priority_became_non_minor_bug";
  }

  return "created_non_minor_bug";
}

async function buildNonMinorBugAlertMessage(
  issue: JiraIssue,
  trigger: AlertTrigger,
  monitoredProjectKeys: readonly string[],
  jiraBaseUrl: string
): Promise<{ readonly message: string; readonly usedFallback: boolean }> {
  const mention = resolveMention(issue.stack);
  const issueUrl = buildIssueUrl(jiraBaseUrl, issue.key);
  const quote = pickJasonStathamQuote();

  return {
    message: [
      `${mention} ${issue.priority}: [${issue.key}](${issueUrl}): ${issue.summary}`,
      `стек: ${issue.stack ?? "не указан"}`,
      "Что нужно сделать: взять в разбор и оценить влияние на команду.",
      `_${quote}_`
    ].join("\n"),
    usedFallback: false
  };
}

export const nonMinorBugAlertRule: AlertRule = {
  id: "non-minor-bug-alert",
  schedule: DEFAULT_NON_MINOR_BUG_ALERT_SCHEDULE,
  handledLabel: "wa-non-minor-bug-alert",
  evaluate(context) {
    return evaluatePerIssueRule(this, context);
  },
  match(issue: JiraIssue, monitoredProjectKeys: readonly string[]): AlertRuleMatch | null {
    const trigger = detectNonMinorBugAlertTrigger(issue, monitoredProjectKeys);
    return trigger ? { trigger } : null;
  },
  buildMessage(
    issue: JiraIssue,
    match: AlertRuleMatch,
    monitoredProjectKeys: readonly string[]
  ) {
    return buildNonMinorBugAlertMessage(issue, match.trigger, monitoredProjectKeys, "");
  }
};

export function createNonMinorBugAlertRule(
  jiraBaseUrl: string,
  schedule: IntervalAlertRuleSchedule = DEFAULT_NON_MINOR_BUG_ALERT_SCHEDULE
): AlertRule {
  return {
    ...nonMinorBugAlertRule,
    schedule: {
      kind: "interval",
      intervalMs: schedule.intervalMs,
      runImmediately: schedule.runImmediately ?? true
    },
    evaluate(context) {
      return evaluatePerIssueRule(this, context);
    },
    buildMessage(
      issue: JiraIssue,
      match: AlertRuleMatch,
      monitoredProjectKeys: readonly string[]
    ) {
      return buildNonMinorBugAlertMessage(issue, match.trigger, monitoredProjectKeys, jiraBaseUrl);
    }
  };
}

function resolveMention(stack: string | null): string {
  const normalized = (stack ?? "").trim().toLowerCase();

  if (normalized === "android") {
    return "@elisov";
  }

  if (normalized === "python") {
    return "@payments-duty";
  }

  return "@knyazev.a";
}

function buildIssueUrl(jiraBaseUrl: string, issueKey: string): string {
  const normalizedBase = jiraBaseUrl.endsWith("/") ? jiraBaseUrl.slice(0, -1) : jiraBaseUrl;
  return `${normalizedBase}/browse/${encodeURIComponent(issueKey)}`;
}

function isDevelopmentEnvironment(bugEnvironment: string | null): boolean {
  if (!bugEnvironment) {
    return false;
  }

  return bugEnvironment.trim().toLowerCase() === "development";
}

function pickJasonStathamQuote(): string {
  const quotes = [
    "Как говорит Джейсон Стетхем: \"Если баг не ищется, значит он уже нашел тебя.\" 😎",
    "Как говорит Джейсон Стетхем: \"Сначала чинишь один баг, потом он зовет друзей.\" 🤝",
    "Как говорит Джейсон Стетхем: \"Хороший разработчик — тот, кто боится своего же кода в пятницу вечером.\" 🌅",
    "Как говорит Джейсон Стетхем: \"Продакшн — не место для экспериментов. Но именно там они и происходят.\" 🔥",
    "Как говорит Джейсон Стетхем: \"Если баг воспроизводится только у пользователя, значит это фича.\" 🎩",
    "Как говорит Джейсон Стетхем: \"Дедлайн — это когда перестаешь делать хорошо и начинаешь делать быстро.\" ⏱️",
    "Как говорит Джейсон Стетхем: \"У каждого бага есть имя. Обычно это имя того, кто делал ревью.\" 🧐",
    "Как говорит Джейсон Стетхем: \"Самый опасный человек в команде — тот, кто уверен, что все понял.\" 😬",
    "Как говорит Джейсон Стетхем: \"Хотфикс — это обещание, что в следующий раз сделаю нормально.\" 🩹",
    "Как говорит Джейсон Стетхем: \"У null pointer нет уважения к чужим границам.\" 💢",
    "Как говорит Джейсон Стетхем: \"Если не знаешь как назвать переменную — значит не понимаешь задачу.\" 🤔",
    "Как говорит Джейсон Стетхем: \"Баг в проде — это просто фича, о которой не предупредили.\" 🤷",
    "Как говорит Джейсон Стетхем: \"Если у тебя нет мониторинга, у тебя нет прода — у тебя есть казино.\" 🎰",
    "Как говорит Джейсон Стетхем: \"Любой код можно понять. Просто иногда на это уходит вся карьера.\" 🎓",
    "Как говорит Джейсон Стетхем: \"Exception без stacktrace — это письмо без адреса.\" 📬",
    "Как говорит Джейсон Стетхем: \"Если MR прошел ревью за две минуты — значит никто не читал.\" 👀",
    "Как говорит Джейсон Стетхем: \"Оценка в story points — это поэзия, а не математика.\" ✍️",
    "Как говорит Джейсон Стетхем: \"Когда говоришь 'почти готово', это значит половина пути позади. И половина впереди.\" 🏔️",
    "Как говорит Джейсон Стетхем: \"Документация устаревает в момент написания. Это закон природы.\" 📄",
    "Как говорит Джейсон Стетхем: \"Если все в команде молчат на стендапе — что-то точно горит.\" 🔕🔥",
    "Как говорит Джейсон Стетхем: \"Если прод упал в пятницу вечером — значит ты деплоил в пятницу вечером.\" 🌃",
    "Как говорит Джейсон Стетхем: \"Самый быстрый код — тот, который не написан.\" 🏎️",
    "Как говорит Джейсон Стетхем: \"Методом проб и ошибок — я пробовал и ошибался.\" 🤷",
    "Как говорит Джейсон Стетхем: \"Магическую атаку знаешь? Я атаковал.\" 💪",
    "Как говорит Джейсон Стетхем: \"Лучшее чувство — когда никто не знает, чем ты занимаешься в жизни. Даже ты сам.\" 🙃",
    "Как говорит Джейсон Стетхем: \"Не понимаю, что сложного бросить пить? Я постоянно бросаю.\" 🍺",
    "Как говорит Джейсон Стетхем: \"Если обидели — не обижайся, если ударили — не ударяйся.\" 🥊",
    "Как говорит Джейсон Стетхем: \"Если пьянка неизбежна, пей первым.\" 🥂",
    "Как говорит Джейсон Стетхем: \"Зачем идти на похороны друга, если он на твои не придёт?\" 💐",
    "Как говорит Джейсон Стетхем: \"Когда я режу лук, плачу не я, а лук.\" 🧅",
    "Как говорит Джейсон Стетхем: \"Я падаю с 10-го этажа сразу на одиннадцатый.\" 🦅",
    "Как говорит Джейсон Стетхем: \"Инопланетяне существуют, просто они не рискуют прилетать на землю, где живу я.\" 👽",
    "Как говорит Джейсон Стетхем: \"Когда я падаю, звёзды загадывают желание.\" ⭐",
    "Как говорит Джейсон Стетхем: \"Военкомат скрывался от меня, пока мне не исполнилось 27 лет.\" 🎖️",
    "Как говорит Джейсон Стетхем: \"Когда мне говорят ВАЛИМ, я спрашиваю — кого?\" 😤",
    "Как говорит Джейсон Стетхем: \"То чувство, когда постоянно бухаешь, но так и не стал алкоголиком.\" 🍻",
    "Как говорит Джейсон Стетхем: \"Пол-литра хорошо, когда один не пьёт.\" 👴",
    "Как говорит Джейсон Стетхем: \"Вчера проходил мимо фитнес-клуба с надписью «Ты можешь больше» — я вернулся в бар и догнался ещё пивом.\" 💪",
    "Как говорит Джейсон Стетхем: \"У меня на потолке написано — завтра бросаю пить. Каждое утро просыпаюсь и благодарю бога, что завтра, а не\" сегодня. 🙏",
    "Как говорит Джейсон Стетхем: \"Когда я смотрю на солнце, оно щурится.\" ☀️",
    "Как говорит Джейсон Стетхем: \"Лучше быть каблуком, чем луком.\" 👟",
    "Как говорит Джейсон Стетхем: \"Если гонка, то самогонка.\" 🏁",
    "Как говорит Джейсон Стетхем: \"Храни нас от мигалок красных и поворотов опасных.\" 🚨",
    "Как говорит Джейсон Стетхем: \"Я скажу две фразы, открывающие любые двери: от себя и на себя.\" 🚪",
    "Как говорит Джейсон Стетхем: \"Если драка неизбежна — беги первым.\" 🏃",
    "Как говорит Джейсон Стетхем: \"Шаг влево, шаг вправо — два шага.\" 👣",
    "Как говорит Джейсон Стетхем: \"Чтобы накопить 12 млн, нужно откладывать по 1 млн в месяц.\" 💰",
    "Как говорит Джейсон Стетхем: \"Подобное притягивается подобным. А что делать, если я бесподобный?\" 💎",
    "Как говорит Джейсон Стетхем: \"Однажды я смотрел в бездну. Она моргнула первой.\" 👁️",
    "Как говорит Джейсон Стетхем: \"Я уважаю мнение каждого, кто со мной согласен.\" 🤝",
    "Как говорит Джейсон Стетхем: \"Влюбленный волк уже не хищник.\" 🐺",
    "Как говорит Джейсон Стетхем: \"Я не пересолил борщ, я переборщил с солью.\" 🍲",
    "Как говорит Джейсон Стетхем: \"Не плачь, отец, твой сын борец, пусть плачет тот, чей сын певец.\" 🥊",
    "Как говорит Джейсон Стетхем: \"Спасибо матери с отцом, что я родился пацаном.\" 🙌",
    "Как говорит Джейсон Стетхем: \"Ещё одно слово — и ты у зубного.\" 🦷",
    "Как говорит Джейсон Стетхем: \"Вся наша жизнь — игра в рулетку: неверный шаг и небо в клетку.\" 🎲",
    "Как говорит Джейсон Стетхем: \"Верь в себя, не бойся ксивы, сильно бей, живи красиво!\" 💥",
    "Как говорит Джейсон Стетхем: \"За базар ответ обеспечен, один удар в печень отнимает дар речи.\" 👊",
    "Как говорит Джейсон Стетхем: \"Дружба дружбой... а по Пьяне можно.\" 🍾",
    "Как говорит Джейсон Стетхем: \"Я буду отвечать только в присутствии своего адеквата.\" 🧠",
    "Как говорит Джейсон Стетхем: \"Алло, это суши-бар? Три пары трусов мне посушите.\" 🍣",
    "Как говорит Джейсон Стетхем: \"Одного боюсь — прийти домой и сказать: я дома, мама! А в ответ услышать: где сдача?\" 😱",
    "Как говорит Джейсон Стетхем: \"Лечусь я мёдом, пивом и корицей. Такой вот метод неплохой. Но мёда нет, корицы тоже. Поэтому уже бухой.\" 🍯",
    "Как говорит Джейсон Стетхем: \"Бухаю только по дням, начинающимся на С: среда, суббота, сегодня.\" 📅",
    "Как говорит Джейсон Стетхем: \"Помню времена — шёл в магазин с 50 рублями, выходил с полными пакетами. А щас что? Понаставили видеокамер...\" 📹",
    "Как говорит Джейсон Стетхем: \"Не могу ударить женщину, потому что вдруг она сильнее.\" 💪",
    "Как говорит Джейсон Стетхем: \"Ты ушла, не смыв за собой, и я понял, что я дышу тобой.\" 💨",
    "Как говорит Джейсон Стетхем: \"Можно симпатизировать сотням, увлекаться десятками, восхищаться единицами, а любить только пивасик.\" 🍺",
    "Как говорит Джейсон Стетхем: \"Как-то бежал за автобусом — водила остановился. А я дальше пробежал, просто вспомнил, что на проезд не хватает.\" 🚌",
    "Как говорит Джейсон Стетхем: \"Братьев береги, шкуру люби, маму храни, врагов хорони, суп посоли, ковёр отряхни, Мухаммед Али.\" 🥊",
    "Как говорит Джейсон Стетхем: \"Береги честь смолоду, а яйца от холода.\" 🥶"
  ];

  return quotes[Math.floor(Math.random() * quotes.length)]!;
}
