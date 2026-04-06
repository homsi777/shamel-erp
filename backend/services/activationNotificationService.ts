/**
 * Single place for activation Telegram content + send + structured logging.
 * Failures must never throw to callers of "success" activation - log and return result.
 */

export const ACTIVATION_SYSTEM_NAME = 'العالمية للمحاسبة';
export const CANONICAL_COMPANY_ID_LABEL = 'org-main';

export type ActivationTelegramContext = {
  kind: 'success' | 'duplicate_attempt';
  title: string;
  code: string;
  activationTypeLabel: string;
  activationMissionLabel?: string;
  activationMissionSummary?: string;
  timestamp: string;
  version: string;
  serverHost: string;
  customerName?: string;
  orgName?: string;
  /** مجال العمل / نوع النشاط */
  businessDomain?: string;
  /** @deprecated use businessDomain; still shown if businessDomain empty */
  profession?: string;
  activatorName?: string;
  activatorPhone?: string;
  province?: string;
  activationMethod?: string;
  clientPlatformLabel?: string;
  clientDeviceName?: string;
  clientAppMode?: string;
  clientActivationPath?: string;
  duplicateExtra?: string;
};

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildActivationTelegramHtml(ctx: ActivationTelegramContext): string {
  const domain = ctx.businessDomain?.trim() || ctx.profession?.trim();
  const lines: string[] = [];
  lines.push(ctx.title);
  lines.push('');
  lines.push(`<b>النظام:</b> ${escapeHtml(ACTIVATION_SYSTEM_NAME)}`);
  lines.push(`<b>حالة التفعيل:</b> ${ctx.kind === 'success' ? 'نجاح' : 'تنبيه - محاولة مكررة'}`);
  lines.push(`<b>نوع الترخيص:</b> ${escapeHtml(ctx.activationTypeLabel)}`);
  lines.push(`<b>رمز التفعيل:</b> <code>${escapeHtml(ctx.code)}</code>`);
  if (ctx.customerName) lines.push(`<b>اسم العميل:</b> ${escapeHtml(ctx.customerName)}`);
  if (ctx.orgName) lines.push(`<b>اسم المنشأة:</b> ${escapeHtml(ctx.orgName)}`);
  if (ctx.activationMissionLabel) lines.push(`<b>مهمة الترخيص:</b> ${escapeHtml(ctx.activationMissionLabel)}`);
  if (ctx.activationMissionSummary) lines.push(`<b>التوجيه التشغيلي:</b> ${escapeHtml(ctx.activationMissionSummary)}`);
  if (ctx.activatorName) lines.push(`<b>المسؤول عن التفعيل:</b> ${escapeHtml(ctx.activatorName)}`);
  if (domain) lines.push(`<b>مجال العمل / النشاط:</b> ${escapeHtml(domain)}`);
  if (ctx.activatorPhone) lines.push(`<b>الهاتف:</b> ${escapeHtml(ctx.activatorPhone)}`);
  if (ctx.province) lines.push(`<b>المحافظة:</b> ${escapeHtml(ctx.province)}`);
  if (ctx.activationMethod) lines.push(`<b>طريقة التفعيل:</b> ${escapeHtml(ctx.activationMethod)}`);
  lines.push(`<b>المعرف القياسي للشركة:</b> <code>${CANONICAL_COMPANY_ID_LABEL}</code>`);
  if (ctx.clientPlatformLabel) lines.push(`<b>المنصة:</b> ${escapeHtml(ctx.clientPlatformLabel)}`);
  if (ctx.clientAppMode) lines.push(`<b>وضع التشغيل:</b> ${escapeHtml(ctx.clientAppMode)}`);
  if (ctx.clientActivationPath) lines.push(`<b>مسار التفعيل:</b> ${escapeHtml(ctx.clientActivationPath)}`);
  if (ctx.clientDeviceName) lines.push(`<b>الجهاز / الوكيل:</b> ${escapeHtml(ctx.clientDeviceName)}`);
  lines.push(`<b>الخادم / المضيف:</b> ${escapeHtml(ctx.serverHost)}`);
  lines.push(`<b>الإصدار:</b> ${escapeHtml(ctx.version)}`);
  lines.push(`<b>الوقت:</b> ${escapeHtml(ctx.timestamp)}`);
  if (ctx.duplicateExtra) lines.push('');
  if (ctx.duplicateExtra) lines.push(escapeHtml(ctx.duplicateExtra));
  return lines.join('\n');
}

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'http_error'; detail?: string };

export async function sendActivationTelegramMessage(
  html: string,
  config: { activationNotifyBotToken: string | null; activationNotifyChatId: string | null },
): Promise<TelegramSendResult> {
  const botToken = String(config.activationNotifyBotToken || '').trim();
  const chatId = String(config.activationNotifyChatId || '').trim();
  if (!botToken || !chatId) {
    return { ok: false, reason: 'not_configured' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, reason: 'http_error', detail: detail.slice(0, 500) };
  }
  return { ok: true };
}

export function logActivationTelegramOutcome(params: {
  event: 'activation.telegram.sent' | 'activation.telegram.skipped' | 'activation.telegram.failed';
  code: string;
  activatorName?: string;
  businessDomain?: string;
  orgName?: string;
  customerName?: string;
  attempted: boolean;
  ok?: boolean;
  detail?: string;
}) {
  const payload = {
    ...params,
    at: new Date().toISOString(),
  };
  if (params.event === 'activation.telegram.failed') {
    console.warn('[activation][telegram]', JSON.stringify(payload));
  } else {
    console.info('[activation][telegram]', JSON.stringify(payload));
  }
}
