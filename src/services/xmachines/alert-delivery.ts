import type { Alert } from './alert-evaluator.js';

export interface DeliverOptions {
  chatId: number;
  botToken: string;
  apiBase?: string;
}

export async function deliverAlerts(alerts: readonly Alert[], opts: DeliverOptions): Promise<number> {
  if (alerts.length === 0) return 0;
  const apiBase = opts.apiBase?.replace(/\/$/, '') ?? process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org';
  const url = `${apiBase}/bot${opts.botToken}/sendMessage`;
  let sent = 0;
  for (const a of alerts) {
    const text = `[xmachines alert] ${a.machine} ${a.type}${a.level ? ` ${a.level}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: opts.chatId, text, parse_mode: 'HTML' })
    });
    if (res.ok) sent++;
  }
  return sent;
}
