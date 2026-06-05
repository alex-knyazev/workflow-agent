export interface NotificationOptions {
  readonly channel?: string;
}

export interface Notifier {
  sendMessage(text: string, options?: NotificationOptions): Promise<void>;
}
