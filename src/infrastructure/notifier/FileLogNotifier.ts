import fs from "node:fs/promises";
import path from "node:path";
import type { NotificationOptions, Notifier } from "../../application/ports/Notifier.js";

export class FileLogNotifier implements Notifier {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async sendMessage(text: string, options?: NotificationOptions): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const channelLine = options?.channel ? `channel: ${options.channel}\n` : "";
    await fs.appendFile(this.filePath, `${new Date().toISOString()}\n${channelLine}${text}\n\n`, "utf-8");
  }
}