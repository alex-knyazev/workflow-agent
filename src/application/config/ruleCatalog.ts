import type { RuleDefinition } from "./RuleDefinition.js";
import {
  createNonMinorBugAlertRule,
  DEFAULT_NON_MINOR_BUG_ALERT_SCHEDULE
} from "./nonMinorBugAlertRule.js";
import {
  createSprintStatusDigestAlertRule,
  DEFAULT_SPRINT_STATUS_DIGEST_SCHEDULE
} from "./sprintStatusDigestAlertRule.js";
import {
  createCancelledSprintCleanupAlertRule,
  DEFAULT_CANCELLED_SPRINT_CLEANUP_SCHEDULE
} from "./cancelledSprintCleanupAlertRule.js";
import {
  createAcceptanceStatusAlertRule,
  DEFAULT_ACCEPTANCE_STATUS_ALERT_SCHEDULE
} from "./acceptanceStatusAlertRule.js";
import {
  createPythonProdDaysAlertRule,
  DEFAULT_PYTHON_PROD_DAYS_ALERT_SCHEDULE
} from "./pythonProdDaysAlertRule.js";
import {
  createMobileReleaseAlertRule,
  DEFAULT_MOBILE_RELEASE_ALERT_SCHEDULE
} from "./mobileReleaseAlertRule.js";
import {
  createKommersantPaymentsNewsAlertRule,
  DEFAULT_KOMMERSANT_PAYMENTS_NEWS_ALERT_SCHEDULE
} from "./kommersantPaymentsNewsAlertRule.js";
import {
  createCodeReviewWorkingDayAlertRule,
  DEFAULT_CODE_REVIEW_WORKING_DAY_ALERT_SCHEDULE
} from "./codeReviewWorkingDayAlertRule.js";
import {
  createStackTitlePrefixNormalizationAlertRule,
  DEFAULT_STACK_TITLE_PREFIX_NORMALIZATION_SCHEDULE
} from "./stackTitlePrefixNormalizationAlertRule.js";

interface RuleCatalogDeps {
  readonly jiraBaseUrl: string;
  readonly dutyBackendSprintId: number;
  readonly kommersantPaymentsNewsLoopChannel: string;
}

export function createRuleCatalog(deps: RuleCatalogDeps): readonly RuleDefinition[] {
  return [
    {
      id: "non-minor-bug-alert",
      name: "Non-minor bug alert",
      description: "Уведомляет о не-minor багах в мониторируемых проектах.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_NON_MINOR_BUG_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "interval") {
          throw new Error("non-minor-bug-alert supports only interval schedule");
        }

        return createNonMinorBugAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "daily-sprint-status-digest",
      name: "Daily sprint status digest",
      description: "Отправляет ежедневный дайджест по активному спринту и спринту payments-duty.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_SPRINT_STATUS_DIGEST_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("daily-sprint-status-digest supports only cron schedule");
        }

        return createSprintStatusDigestAlertRule(
          deps.jiraBaseUrl,
          deps.dutyBackendSprintId,
          schedule
        );
      }
    },
    {
      id: "cancelled-sprint-cleanup",
      name: "Cancelled sprint cleanup",
      description: "Раз в день очищает поле Sprint у задач в статусе CANCELLED.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_CANCELLED_SPRINT_CLEANUP_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("cancelled-sprint-cleanup supports only cron schedule");
        }

        return createCancelledSprintCleanupAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "acceptance-status-alert",
      name: "Acceptance status alert",
      description: "Ежедневное оповещение о задачах в статусе Acceptance. Напоминает о необходимости валидировать статус и переводить в Done.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_ACCEPTANCE_STATUS_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("acceptance-status-alert supports only cron schedule");
        }

        return createAcceptanceStatusAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "python-prod-days-alert",
      name: "Python on Prod days alert",
      description: "Оповещение о Python задачах, которые находятся в статусе On Prod более 1 дня.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_PYTHON_PROD_DAYS_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("python-prod-days-alert supports only cron schedule");
        }

        return createPythonProdDaysAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "mobile-release-alert",
      name: "Mobile release alert",
      description: "Оповещение о выходе задач в релиз на iOS и Android.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_MOBILE_RELEASE_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "interval") {
          throw new Error("mobile-release-alert supports only interval schedule");
        }

        return createMobileReleaseAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "kommersant-payments-news-alert",
      name: "Kommersant payments news alert",
      description: "Дайджест новостей Коммерсанта по теме платежных систем, терминалов и агентов.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_KOMMERSANT_PAYMENTS_NEWS_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("kommersant-payments-news-alert supports only cron schedule");
        }

        return createKommersantPaymentsNewsAlertRule(
          schedule,
          deps.kommersantPaymentsNewsLoopChannel
        );
      }
    },
    {
      id: "code-review-working-day-alert",
      name: "Code review working day alert",
      description: "Оповещение о задачах, которые находятся в Code Review более 8 рабочих часов (09:00-18:00).",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_CODE_REVIEW_WORKING_DAY_ALERT_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("code-review-working-day-alert supports only cron schedule");
        }

        return createCodeReviewWorkingDayAlertRule(deps.jiraBaseUrl, schedule);
      }
    },
    {
      id: "stack-title-prefix-normalization",
      name: "Stack title prefix normalization",
      description: "Нормализует префикс заголовка задачи по значению поля Stack и проставляет единый формат с emoji.",
      defaultEnabled: true,
      defaultSchedule: DEFAULT_STACK_TITLE_PREFIX_NORMALIZATION_SCHEDULE,
      buildRule(schedule) {
        if (schedule.kind !== "cron") {
          throw new Error("stack-title-prefix-normalization supports only cron schedule");
        }

        return createStackTitlePrefixNormalizationAlertRule(schedule);
      }
    }
  ];
}