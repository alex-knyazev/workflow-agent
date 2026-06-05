import axios, { type AxiosInstance } from "axios";
import type { NotificationOptions, Notifier } from "../../application/ports/Notifier.js";

export class LoopWebhookNotifier implements Notifier {
  private readonly http: AxiosInstance;

  constructor(webhookUrl: string) {
    this.http = axios.create({
      baseURL: webhookUrl,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async sendMessage(text: string, options?: NotificationOptions): Promise<void> {
    await this.http.post("", {
      text,
      ...(options?.channel ? { channel: options.channel } : {})
    });
  }
}
