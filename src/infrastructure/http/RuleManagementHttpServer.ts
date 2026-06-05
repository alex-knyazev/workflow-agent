import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { RuleConfigurationService } from "../../application/services/RuleConfigurationService.js";
import type { RuleUpdateCommand } from "../../application/config/RuleDefinition.js";

interface RuleManagementHttpServerDeps {
  readonly host: string;
  readonly port: number;
  readonly auth: {
    readonly login: string;
    readonly passwordHash: string;
    readonly sessionTtlMinutes: number;
  };
  readonly ruleConfigurationService: RuleConfigurationService;
  readonly onRulesChanged: () => void;
  readonly onRuleManualTrigger: (
    ruleId: string,
    options: { readonly mode: "live" | "test" }
  ) => Promise<{ readonly matchedIssuesCount: number; readonly notifiedCount: number }>;
}

const STATIC_FILE_PATHS = new Map<string, string>([
  ["/", resolve(process.cwd(), "public/index.html")],
  ["/index.html", resolve(process.cwd(), "public/index.html")],
  ["/app.js", resolve(process.cwd(), "public/app.js")],
  ["/styles.css", resolve(process.cwd(), "public/styles.css")]
]);

export class RuleManagementHttpServer {
  private readonly host: string;
  private readonly port: number;
  private readonly ruleConfigurationService: RuleConfigurationService;
  private readonly onRulesChanged: () => void;
  private readonly onRuleManualTrigger: RuleManagementHttpServerDeps["onRuleManualTrigger"];
  private readonly authConfig: RuleManagementHttpServerDeps["auth"];
  private readonly sessionByToken: Map<string, { readonly login: string; readonly expiresAt: number }>;
  private server: Server | null;

  constructor(deps: RuleManagementHttpServerDeps) {
    this.host = deps.host;
    this.port = deps.port;
    this.authConfig = deps.auth;
    this.ruleConfigurationService = deps.ruleConfigurationService;
    this.onRulesChanged = deps.onRulesChanged;
    this.onRuleManualTrigger = deps.onRuleManualTrigger;
    this.sessionByToken = new Map();
    this.server = null;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, this.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (method === "POST" && requestUrl.pathname === "/api/session") {
        const body = await readJsonBody(request);
        const credentials = parseCredentials(body);

        if (
          credentials.login !== this.authConfig.login
          || !isPasswordHashValid(credentials.password, this.authConfig.passwordHash)
        ) {
          this.sendJson(response, 401, { error: "Invalid login or password" });
          return;
        }

        const token = randomBytes(32).toString("base64url");
        const maxAgeSeconds = this.authConfig.sessionTtlMinutes * 60;
        const expiresAt = Date.now() + maxAgeSeconds * 1000;
        this.sessionByToken.set(token, { login: credentials.login, expiresAt });

        response.setHeader("Set-Cookie", buildSessionCookie(token, maxAgeSeconds));
        this.sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "DELETE" && requestUrl.pathname === "/api/session") {
        const sessionToken = readSessionToken(request);
        if (sessionToken) {
          this.sessionByToken.delete(sessionToken);
        }

        response.setHeader("Set-Cookie", buildClearSessionCookie());
        this.sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/api/session") {
        const session = this.readSession(request);
        if (!session) {
          this.sendJson(response, 401, { error: "Unauthorized" });
          return;
        }

        this.sendJson(response, 200, { login: session.login });
        return;
      }

      if (!isPublicRoute(method, requestUrl.pathname) && !this.readSession(request)) {
        this.sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/api/rules") {
        this.sendJson(response, 200, { rules: this.ruleConfigurationService.listRules() });
        return;
      }

      if (method === "PUT" && requestUrl.pathname.startsWith("/api/rules/")) {
        const ruleId = decodeURIComponent(requestUrl.pathname.slice("/api/rules/".length));
        const body = await readJsonBody(request);
        const updatedRule = await this.ruleConfigurationService.updateRule(ruleId, body as RuleUpdateCommand);
        this.onRulesChanged();
        this.sendJson(response, 200, { rule: updatedRule });
        return;
      }

      if (method === "POST" && requestUrl.pathname.startsWith("/api/rules/") && requestUrl.pathname.endsWith("/trigger")) {
        const suffix = "/trigger";
        const ruleId = decodeURIComponent(requestUrl.pathname.slice("/api/rules/".length, -suffix.length));
        const result = await this.onRuleManualTrigger(ruleId, { mode: "live" });
        this.sendJson(response, 200, { result });
        return;
      }

      if (method === "POST" && requestUrl.pathname.startsWith("/api/rules/") && requestUrl.pathname.endsWith("/trigger-test")) {
        const suffix = "/trigger-test";
        const ruleId = decodeURIComponent(requestUrl.pathname.slice("/api/rules/".length, -suffix.length));
        const result = await this.onRuleManualTrigger(ruleId, { mode: "test" });
        this.sendJson(response, 200, { result });
        return;
      }

      if (method === "GET") {
        const staticFilePath = STATIC_FILE_PATHS.get(requestUrl.pathname);
        if (staticFilePath) {
          await this.serveStaticFile(response, staticFilePath, requestUrl.pathname);
          return;
        }
      }

      this.sendJson(response, 404, { error: "Not found" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const statusCode = isClientError(error) ? 400 : 500;
      this.sendJson(response, statusCode, { error: message });
    }
  }

  private async serveStaticFile(response: ServerResponse, filePath: string, requestPath: string): Promise<void> {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": getContentType(requestPath) });
    response.end(content);
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  }

  private readSession(request: IncomingMessage): { readonly login: string; readonly expiresAt: number } | null {
    const sessionToken = readSessionToken(request);
    if (!sessionToken) {
      return null;
    }

    const session = this.sessionByToken.get(sessionToken);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessionByToken.delete(sessionToken);
      return null;
    }

    return session;
  }
}

function readSessionToken(request: IncomingMessage): string | null {
  const cookiesHeader = request.headers.cookie;
  if (!cookiesHeader) {
    return null;
  }

  const cookies = cookiesHeader.split(";").map((item) => item.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name === "wa_session") {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

function parseCredentials(body: unknown): { readonly login: string; readonly password: string } {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid credentials payload");
  }

  const payload = body as Record<string, unknown>;
  const login = typeof payload.login === "string" ? payload.login.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (login.length === 0 || password.length === 0) {
    throw new Error("login and password are required");
  }

  return { login, password };
}

function isPasswordHashValid(password: string, passwordHash: string): boolean {
  const [algorithm, saltBase64, hashBase64] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !saltBase64 || !hashBase64) {
    throw new Error("WEB_ADMIN_PASSWORD_HASH has invalid format");
  }

  const salt = Buffer.from(saltBase64, "base64");
  const expectedHash = Buffer.from(hashBase64, "base64");
  const actualHash = scryptSync(password, salt, expectedHash.length);

  return timingSafeEqual(actualHash, expectedHash);
}

function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `wa_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ].join("; ");
}

function buildClearSessionCookie(): string {
  return [
    "wa_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

function isPublicRoute(method: string, pathname: string): boolean {
  if (method === "POST" && pathname === "/api/session") {
    return true;
  }

  if (method === "GET" && STATIC_FILE_PATHS.has(pathname)) {
    return true;
  }

  return false;
}


async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (body.length === 0) {
    return {};
  }

  return JSON.parse(body);
}

function getContentType(requestPath: string): string {
  const extension = extname(requestPath);
  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}

function isClientError(error: unknown): boolean {
  return error instanceof Error;
}