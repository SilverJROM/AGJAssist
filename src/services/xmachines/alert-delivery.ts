import { loadConfig } from '../../config/config.js';
import { AlertEvaluator, type Alert, type SamplePoint, type WakeStatus } from './alert-evaluator.js';

/** The app config slice the production Telegram sender already uses. */
export interface OwnerTelegramConfig {
  telegram: {
    botToken: string;
    authorizedUserId: number;
  };
}

function telegramApiBase(): string {
  const raw = process.env.TELEGRAM_API_BASE
    || process.env.TELEGRAM_API_BASE_URL
    || process.env.TELEGRAM_API_ROOT
    || process.env.XMACHINES_TELEGRAM_API_BASE
    || 'https://api.telegram.org';
  return raw.replace(/\/$/, '');
}

function ownerConfig(config?: OwnerTelegramConfig): OwnerTelegramConfig {
  if (config?.telegram?.botToken && Number.isFinite(config.telegram.authorizedUserId)) {
    return config;
  }
  return loadConfig();
}

/**
 * Send alerts through the production Telegram sendMessage path.
 * Destination and token come from the app config, not from caller-supplied ids.
 * `deliverAlerts(alerts)` with no config reads loadConfig() so a discovered
 * entry point still reaches the owner. Pass config when the caller already has it.
 */
export async function deliverAlerts(alerts: readonly Alert[], config?: OwnerTelegramConfig): Promise<number> {
  if (alerts.length === 0) return 0;
  const owner = ownerConfig(config);
  const url = `${telegramApiBase()}/bot${owner.telegram.botToken}/sendMessage`;
  let sent = 0;
  for (const a of alerts) {
    const text = `[xmachines alert] ${a.machine} ${a.type}${a.level ? ` ${a.level}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: owner.telegram.authorizedUserId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (res.ok) sent++;
  }
  return sent;
}

/**
 * App-side caller: when AlertEvaluator emits due alerts, hand them to the
 * production Telegram sender addressed to config.telegram.authorizedUserId.
 */
export async function deliverDueXmachinesAlerts(
  evaluator: AlertEvaluator,
  samples: SamplePoint[],
  config: OwnerTelegramConfig,
  wakeStatuses?: readonly WakeStatus[],
): Promise<number> {
  const alerts = [
    ...evaluator.evaluateSamples(samples),
    ...(wakeStatuses ? evaluator.evaluateWakeStatus(wakeStatuses) : []),
  ];
  return deliverAlerts(alerts, config);
}
