import { loadEnv } from "./config/env.js";
import { BacklogMonitorService } from "./application/services/BacklogMonitorService.js";
import { RuleConfigurationService } from "./application/services/RuleConfigurationService.js";
import { JiraApiClient } from "./infrastructure/jira/JiraApiClient.js";
import { LoopWebhookNotifier } from "./infrastructure/loop/LoopWebhookNotifier.js";
import { FileLogNotifier } from "./infrastructure/notifier/FileLogNotifier.js";
import { createRuleCatalog } from "./application/config/ruleCatalog.js";
import { FileRuleOverrideStore } from "./infrastructure/rules/FileRuleOverrideStore.js";
import { RuleManagementHttpServer } from "./infrastructure/http/RuleManagementHttpServer.js";
import { WorkCalendar } from "./domain/WorkCalendar.js";
import { readFileSync } from "node:fs";
import { KommersantThemeNewsSource } from "./infrastructure/news/KommersantThemeNewsSource.js";
import type { Notifier } from "./application/ports/Notifier.js";

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const issueSource = new JiraApiClient({
    baseUrl: env.jiraBaseUrl,
    bearerToken: env.jiraApiToken,
    teamProjectKeys: env.jiraTeamProjectKeys,
    stackFieldId: env.jiraStackFieldId,
    bugEnvironmentFieldId: env.jiraBugEnvironmentFieldId,
    sprintFieldId: env.jiraSprintFieldId
  });
  const newsSource = new KommersantThemeNewsSource();
  const loopNotifier = env.loopWebhookUrl.length > 0 ? new LoopWebhookNotifier(env.loopWebhookUrl) : undefined;

  const ruleConfigurationService = new RuleConfigurationService({
    definitions: createRuleCatalog({
      jiraBaseUrl: env.jiraBaseUrl,
      dutyBackendSprintId: env.jiraDutyBackendSprintId,
      kommersantPaymentsNewsLoopChannel: env.kommersantPaymentsNewsLoopChannel
    }),
    store: new FileRuleOverrideStore(env.ruleOverridesPath)
  });

  await ruleConfigurationService.initialize();
  let workCalendar: WorkCalendar | undefined;
  try {
    const holidaysJson = readFileSync(env.holidaysDataPath, "utf-8");
    workCalendar = WorkCalendar.createFromJson(holidaysJson);
    console.log(`[workflow-agent] Loaded work calendar from ${env.holidaysDataPath}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[workflow-agent] Could not load work calendar: ${msg}. Rules will not skip non-work days.`);
  }


  const service = new BacklogMonitorService({
    issueSource,
    newsSource,
    labelWriter: issueSource,
    notifier: env.notificationMode === "file" ? new FileLogNotifier(env.notificationLogPath) : requireLoopNotifier(loopNotifier),
    ...(loopNotifier ? { ruleFailureNotifier: loopNotifier } : {}),
    ...(env.loopFailureAlertChannel.length > 0 ? { ruleFailureChannel: env.loopFailureAlertChannel } : {}),
    monitoredProjectKeys: env.jiraTeamProjectKeys,
    rules: ruleConfigurationService.getActiveRules(),
    workCalendar
  });

  const ruleManagementServer = new RuleManagementHttpServer({
    host: env.ruleManagementHost,
    port: env.ruleManagementPort,
    auth: {
      login: env.webAdminLogin,
      passwordHash: env.webAdminPasswordHash,
      sessionTtlMinutes: env.webAdminSessionTtlMinutes
    },
    ruleConfigurationService,
    onRulesChanged: () => {
      service.replaceRules(ruleConfigurationService.getActiveRules());
    },
    onRuleManualTrigger: async (ruleId, options) => {
      const rule = ruleConfigurationService.buildRuleById(ruleId);

      return service.triggerRuleManually(rule, {
        issuesMode: options.mode,
        skipIssueMutations: options.mode === "test"
      });
    }
  });

  service.start();
  await ruleManagementServer.start();

  registerShutdownHandlers(service, ruleManagementServer);
  registerFatalErrorHandlers(loopNotifier, env.loopFailureAlertChannel.length > 0 ? env.loopFailureAlertChannel : undefined);

  console.log(
    `Team workflow agent started. Rule management UI: http://${env.ruleManagementHost}:${env.ruleManagementPort}`
  );
}

function requireLoopNotifier(loopNotifier: LoopWebhookNotifier | undefined): LoopWebhookNotifier {
  if (!loopNotifier) {
    throw new Error("LOOP_WEBHOOK_URL must be configured when NOTIFICATION_MODE=loop");
  }

  return loopNotifier;
}

function registerShutdownHandlers(
  service: BacklogMonitorService,
  ruleManagementServer: RuleManagementHttpServer
): void {
  const shutdown = async () => {
    service.stop();
    await ruleManagementServer.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

function registerFatalErrorHandlers(notifier: Notifier | undefined, channel: string | undefined): void {
  const reportAndExit = async (eventName: string, error: unknown): Promise<void> => {
    console.error(`[workflow-agent] ${eventName}`, error);
    await sendFailureAlert(notifier, channel, eventName, error);
    process.exit(1);
  };

  process.once("uncaughtException", (error: unknown) => {
    void reportAndExit("uncaughtException", error);
  });

  process.once("unhandledRejection", (reason: unknown) => {
    void reportAndExit("unhandledRejection", reason);
  });
}

async function sendFailureAlert(
  notifier: Notifier | undefined,
  channel: string | undefined,
  eventName: string,
  error: unknown
): Promise<void> {
  if (!notifier) {
    return;
  }

  const normalizedError = normalizeUnknownError(error);
  const text = [
    "Workflow agent fatal error.",
    `event: ${eventName}`,
    `time: ${new Date().toISOString()}`,
    `error: ${normalizedError.message}`,
    ...(normalizedError.stack ? ["", truncateText(normalizedError.stack, 2000)] : [])
  ].join("\n");

  try {
    await notifier.sendMessage(text, channel ? { channel } : undefined);
  } catch (notificationError: unknown) {
    console.error("[workflow-agent] failed to send fatal error alert", notificationError);
  }
}

function normalizeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(typeof error.stack === "string" && error.stack.length > 0 ? { stack: error.stack } : {})
    };
  }

  return {
    message: String(error)
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start team workflow agent.", error);
  process.exit(1);
});
