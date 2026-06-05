import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuleOverrideStore } from "../../application/ports/RuleOverrideStore.js";
import type { RuleOverride } from "../../application/config/RuleDefinition.js";

export class FileRuleOverrideStore implements RuleOverrideStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<Record<string, RuleOverride>> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      if (!isRecord(parsed)) {
        throw new Error("Rule override file must contain a JSON object");
      }

      return parsed as Record<string, RuleOverride>;
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return {};
      }

      throw error;
    }
  }

  async save(overrides: Record<string, RuleOverride>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}