export const ALERT_TYPES = [
  "trade_opened",
  "trade_closed",
  "large_loss",
  "daily_stop_reached",
  "strategy_disabled",
  "strategy_degraded",
  "risk_rejection",
  "api_failure",
  "broker_mismatch",
  "system_restart",
  "data_feed_stale",
  "kill_switch",
  "circuit_breaker",
  "reconciliation_failed",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data?: Record<string, unknown>;
  at: number;
}

export interface AlertChannel {
  readonly name: string;
  send(alert: Alert): Promise<void>;
}

export class ConsoleAlertChannel implements AlertChannel {
  readonly name = "console";
  async send(alert: Alert): Promise<void> {
    const line = `[ALERT:${alert.severity.toUpperCase()}] ${alert.type} — ${alert.message}`;
    if (alert.severity === "critical") console.error(line);
    else console.warn(line);
  }
}

/** Generic JSON webhook (Slack/Discord/Telegram relays, ntfy, etc.). */
export class WebhookAlertChannel implements AlertChannel {
  readonly name = "webhook";
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(alert: Alert): Promise<void> {
    await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[${alert.severity}] ${alert.type}: ${alert.message}`, alert }),
    });
  }
}

export class MemoryAlertChannel implements AlertChannel {
  readonly name = "memory";
  readonly alerts: Alert[] = [];
  async send(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

/** Fans alerts out to every channel; a failing channel never blocks the others. */
export class Alerter {
  private readonly listeners: Array<(alert: Alert) => void> = [];

  constructor(
    private readonly channels: AlertChannel[] = [new ConsoleAlertChannel()],
    private readonly now: () => number = Date.now,
  ) {}

  onAlert(listener: (alert: Alert) => void): void {
    this.listeners.push(listener);
  }

  async alert(type: AlertType, severity: AlertSeverity, message: string, data?: Record<string, unknown>): Promise<Alert> {
    const alert: Alert = { type, severity, message, at: this.now(), ...(data ? { data } : {}) };
    for (const l of this.listeners) {
      try {
        l(alert);
      } catch {
        /* listener errors are ignored */
      }
    }
    await Promise.allSettled(this.channels.map((c) => c.send(alert)));
    return alert;
  }
}

export function alerterFromEnv(env: NodeJS.ProcessEnv = process.env): Alerter {
  const channels: AlertChannel[] = [new ConsoleAlertChannel()];
  if (env.ALERT_WEBHOOK_URL) channels.push(new WebhookAlertChannel(env.ALERT_WEBHOOK_URL));
  return new Alerter(channels);
}
