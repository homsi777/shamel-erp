import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { upsertValidatedSetting } from '../lib/settings';

function getAppVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
}

import {
  buildActivationTelegramHtml,
  logActivationTelegramOutcome,
  sendActivationTelegramMessage,
  type ActivationTelegramContext,
} from '../services/activationNotificationService';
import {
  getLicenseMissionDefinition,
  getLicenseMissionLabel,
  inferLicenseMissionFromLegacyActivationType,
  maskActivationCode,
  normalizeLicenseMission,
  recognizeLicenseMissionFromCode,
  type LicenseMission,
} from '../../src/lib/licenseMission';
import {
  trimActivationField,
  validateOptionalActivatorName,
  validateActivationCodeForNotify,
  validateOptionalBusinessDomain,
} from '../lib/activationFieldValidation';
import { DEFAULT_ROLE_PERMISSIONS, type UserRole } from '../../src/types';
import { validateProvisioningRequest } from '../services/provisioningService';
import { serverConfig } from '../lib/serverConfig';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';

const TYPE_LABELS: Record<string, string> = {
  local: 'تفعيل محلي',
  cloud: 'سحابي مؤجل',
  trial: 'تجريبي',
  branch: 'طرفية فرعية',
};

const resolveSetupRole = (raw: unknown): UserRole => {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized && Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS, normalized)) {
    return normalized as UserRole;
  }
  return 'admin';
};

const resolveSetupPermissions = (raw: unknown, role: UserRole): string[] => {
  const fallback = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.admin;
  if (Array.isArray(raw)) {
    const values = raw.map((value) => String(value || '').trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  if (typeof raw === 'string') {
    const values = raw.split(',').map((value) => String(value || '').trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  }
  return fallback;
};

async function ensureInternetForActivation(url: string) {
  const candidates = Array.from(new Set([
    String(url || '').trim(),
    'https://api.telegram.org',
    'https://www.google.com/generate_204',
  ].filter(Boolean)));
  const errors: string[] = [];

  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await fetch(candidate, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(7000),
        });

        if (res.ok || (res.status >= 200 && res.status < 400)) {
          return;
        }

        errors.push(`${candidate} -> HTTP ${res.status}`);
      } catch (error: any) {
        errors.push(`${candidate} -> ${error?.message || 'NETWORK_ERROR'}`);
      }
    }
  }

  throw new Error(`Activation internet check failed: ${errors.join(' | ')}`);
}

async function deliverActivationTelegram(
  ctx: ActivationTelegramContext,
  serverCfg: { activationNotifyBotToken: string | null; activationNotifyChatId: string | null },
  auditMeta: { code: string; activatorName?: string; businessDomain?: string; orgName?: string; customerName?: string },
) {
  const html = buildActivationTelegramHtml(ctx);
  try {
    const result = await sendActivationTelegramMessage(html, serverCfg);
    if (result.ok) {
      logActivationTelegramOutcome({
        event: 'activation.telegram.sent',
        code: auditMeta.code,
        activatorName: auditMeta.activatorName,
        businessDomain: auditMeta.businessDomain,
        orgName: auditMeta.orgName,
        customerName: auditMeta.customerName,
        attempted: true,
        ok: true,
      });
      return 'sent';
    }
    if (result.reason === 'not_configured') {
      logActivationTelegramOutcome({
        event: 'activation.telegram.skipped',
        code: auditMeta.code,
        activatorName: auditMeta.activatorName,
        businessDomain: auditMeta.businessDomain,
        orgName: auditMeta.orgName,
        customerName: auditMeta.customerName,
        attempted: true,
        ok: false,
        detail: 'missing_bot_or_chat_env',
      });
      console.warn('[activation] Telegram not configured (set ACTIVATION_NOTIFY_BOT_TOKEN and ACTIVATION_NOTIFY_CHAT_ID). Activation itself succeeded.');
      return 'skipped';
    }
    logActivationTelegramOutcome({
      event: 'activation.telegram.failed',
      code: auditMeta.code,
      activatorName: auditMeta.activatorName,
      businessDomain: auditMeta.businessDomain,
      orgName: auditMeta.orgName,
      customerName: auditMeta.customerName,
      attempted: true,
      ok: false,
      detail: result.detail,
    });
    return 'failed';
  } catch (e: any) {
    logActivationTelegramOutcome({
      event: 'activation.telegram.failed',
      code: auditMeta.code,
      activatorName: auditMeta.activatorName,
      businessDomain: auditMeta.businessDomain,
      orgName: auditMeta.orgName,
      customerName: auditMeta.customerName,
      attempted: true,
      ok: false,
      detail: e?.message || String(e),
    });
    return 'failed';
  }
}

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, bcrypt, server, serverConfig, auditLogger } = ctx as any;

  const persistValidatedSetting = async (
    key: string,
    value: any,
    scope?: { companyId?: string | null; branchId?: string | null },
  ) => {
    const { storedValue, existing, rowKey } = await upsertValidatedSetting(db, schema, eq, key, value, scope);
    if (existing) {
      await db.update(schema.systemSettings)
        .set({ companyId: scope?.companyId || null, branchId: scope?.branchId || null, value: storedValue })
        .where(eq(schema.systemSettings.key, rowKey))
        .run();
    } else {
      await db.insert(schema.systemSettings).values({
        key: rowKey,
        companyId: scope?.companyId || null,
        branchId: scope?.branchId || null,
        value: storedValue,
      }).run();
    }
  };

  api.get('/activation/status', async () => {
    try {
      const row = await db.select()
        .from(schema.activationCodes)
        .where(eq(schema.activationCodes.isUsed, true))
        .get();
      if (row) {
        const activationType = String((row as any).activationType || 'local');
        const activationMission = normalizeLicenseMission((row as any).licenseMission || inferLicenseMissionFromLegacyActivationType(activationType));
        return {
          activated: true,
          activationType,
          activationMission,
          activationMissionLabel: getLicenseMissionLabel(activationMission),
        };
      }
      return { activated: false };
    } catch {
      return { activated: false };
    }
  });

  api.post('/activation/activate', async (req, reply) => {
    const {
      code,
      customerName,
      orgName,
      profession,
      businessDomain: businessDomainRaw,
      activatorName,
      activatorPhone,
      province,
      activationMethod,
      clientPlatform,
      clientPlatformLabel,
      clientDeviceName,
      clientAppMode,
      clientActivationPath,
      activationMission: activationMissionRaw,
      activationMissionLabel: activationMissionLabelRaw,
    } = req.body as {
      code: string;
      customerName?: string;
      orgName?: string;
      profession?: string;
      businessDomain?: string;
      activatorName?: string;
      activatorPhone?: string;
      province?: string;
      activationMethod?: string;
      clientPlatform?: string;
      clientPlatformLabel?: string;
      clientDeviceName?: string;
      clientAppMode?: string;
      clientActivationPath?: string;
      activationMission?: string;
      activationMissionLabel?: string;
    };

    if (!code || typeof code !== 'string') {
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.attempt.rejected',
        affectedItems: [{ code: null }],
        meta: { reason: 'MISSING_CODE' },
      });
      return reply.status(400).send({ error: 'يرجى إدخال رمز التفعيل.' });
    }

    const trimmedCode = code.trim().toUpperCase();
    const businessDomain = trimActivationField(businessDomainRaw ?? profession);
    const recognition = recognizeLicenseMissionFromCode(trimmedCode);
    if (!recognition) {
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.attempt.rejected',
        affectedItems: [{ code: trimmedCode }],
        meta: { reason: 'UNRECOGNIZED_LICENSE_MISSION' },
      });
      return reply.status(400).send({ error: 'تعذر التعرف على مهمة الترخيص من هذا الرمز.' });
    }

    const nameErr = validateOptionalActivatorName(activatorName);
    if (nameErr) {
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.attempt.rejected',
        affectedItems: [{ code: trimmedCode }],
        meta: { reason: 'INVALID_ACTIVATOR_NAME' },
      });
      return reply.status(400).send({ error: nameErr });
    }
    const domainErr = validateOptionalBusinessDomain(businessDomain);
    if (domainErr) {
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.attempt.rejected',
        affectedItems: [{ code: trimmedCode }],
        meta: { reason: 'INVALID_BUSINESS_DOMAIN' },
      });
      return reply.status(400).send({ error: domainErr });
    }

    const activatorNameNorm = trimActivationField(activatorName);

    try {
      try {
        await ensureInternetForActivation(String(serverConfig?.activationConnectivityUrl || 'https://api.telegram.org'));
      } catch (connectivityError: any) {
        console.warn('[activation] connectivity check failed:', connectivityError?.message || connectivityError);
        await auditLogger.log({
          userId: 'system',
          operationType: 'activation.attempt.rejected',
          affectedItems: [{ code: trimmedCode }],
          meta: {
            reason: 'CONNECTIVITY_CHECK_FAILED',
            detail: connectivityError?.message || null,
          },
        });
        return reply.status(503).send({
          error: 'التفعيل يتطلب اتصال إنترنت فعّال. تأكد من الإنترنت ثم أعد المحاولة.',
          detail: serverConfig?.isProduction ? undefined : String(connectivityError?.message || ''),
        });
      }

      const record = await db.select()
        .from(schema.activationCodes)
        .where(eq(schema.activationCodes.code, trimmedCode))
        .get();

      if (!record) {
        await auditLogger.log({
          userId: 'system',
          operationType: 'activation.attempt.failed',
          affectedItems: [{ code: trimmedCode }],
          meta: { reason: 'CODE_NOT_FOUND' },
        });
        return reply.status(404).send({ error: 'رمز التفعيل غير صحيح.' });
      }

      const activationType = String((record as any).activationType || recognition.legacyActivationType || 'local');
      const activationMission = normalizeLicenseMission(
        String((record as any).licenseMission || activationMissionRaw || recognition.mission || inferLicenseMissionFromLegacyActivationType(activationType))
      );
      const missionDefinition = getLicenseMissionDefinition(activationMission);
      const typeLabel = TYPE_LABELS[activationType] || activationType;
      const missionLabel = String(activationMissionLabelRaw || getLicenseMissionLabel(activationMission));
      const now = new Date().toISOString();
      const computerName = os.hostname();
      const version = getAppVersion();

      const baseCtx = (kind: 'success' | 'duplicate_attempt', title: string, duplicateExtra?: string): ActivationTelegramContext => ({
        kind,
        title,
        code: maskActivationCode(trimmedCode),
        activationTypeLabel: typeLabel,
        activationMissionLabel: missionLabel,
        activationMissionSummary: missionDefinition.operatorSummary,
        timestamp: now,
        version,
        serverHost: computerName,
        customerName: trimActivationField(customerName) || undefined,
        orgName: orgName?.trim() || undefined,
        businessDomain,
        activatorName: activatorNameNorm,
        activatorPhone: activatorPhone?.trim() || undefined,
        province: province?.trim() || undefined,
        activationMethod: activationMethod?.trim() || undefined,
        clientPlatformLabel: clientPlatformLabel || clientPlatform,
        clientDeviceName,
        clientAppMode,
        clientActivationPath,
        duplicateExtra,
      });

      if (record.isUsed) {
        const telegramStatus = await deliverActivationTelegram(
          baseCtx(
            'duplicate_attempt',
            '⚠️ <b>محاولة تفعيل مكررة</b>',
            `استُخدم الرمز سابقًا بتاريخ: ${record.usedAt || 'غير معروف'}\nعلى مضيف: ${record.computerName || 'غير معروف'}`,
          ),
          serverConfig,
          {
            code: trimmedCode,
            activatorName: activatorNameNorm,
            businessDomain,
            orgName: orgName?.trim(),
            customerName: trimActivationField(customerName) || undefined,
          },
        );

        await auditLogger.log({
          userId: 'system',
          operationType: 'activation.attempt.failed',
          affectedItems: [{ code: trimmedCode }],
          meta: { reason: 'CODE_ALREADY_USED', activationType, activationMission, usedAt: record.usedAt || null },
        });

        return reply.status(409).send({
          error: 'رمز التفعيل مستخدم بالفعل.',
          telegram: telegramStatus,
          activationType,
          activationMission,
          activationMissionLabel: missionLabel,
        });
      }

      if (activationMission === 'CLOUD_PLACEHOLDER') {
        const telegramStatus = await deliverActivationTelegram(
          baseCtx('success', '☁️ <b>تم التعرف على ترخيص سحابي مؤجل</b>'),
          serverConfig,
          {
            code: trimmedCode,
            activatorName: activatorNameNorm,
            businessDomain,
            orgName: orgName?.trim(),
            customerName: trimActivationField(customerName) || undefined,
          },
        );

        await auditLogger.log({
          userId: 'system',
          operationType: 'activation.cloud_placeholder',
          affectedItems: [{ code: trimmedCode }],
          meta: { activationType, activationMission, customerName: customerName || null, orgName: orgName || null },
        });

        return {
          success: true,
          deferred: true,
          message: 'تم التعرف على ترخيص سحابي مؤجل. هذا المسار غير متاح بعد في هذا الإصدار المحلي.',
          activationType,
          activationMission,
          activationMissionLabel: missionLabel,
          telegram: telegramStatus,
        };
      }

      await db.update(schema.activationCodes)
        .set({
          isUsed: true,
          usedAt: now,
          computerName,
          appVersion: version,
          licenseMission: activationMission,
        })
        .where(eq(schema.activationCodes.code, trimmedCode))
        .run();

      const telegramStatus = await deliverActivationTelegram(
        baseCtx('success', '✅ <b>تم تفعيل البرنامج بنجاح</b>'),
        serverConfig,
        {
          code: trimmedCode,
          activatorName: activatorNameNorm,
          businessDomain,
          orgName: orgName?.trim(),
          customerName: trimActivationField(customerName) || undefined,
        },
      );

      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.success',
        affectedItems: [{ code: trimmedCode }],
        newValues: {
          activationType,
          activationMission,
          usedAt: now,
          computerName,
          appVersion: version,
        },
        meta: {
          customerName: customerName || null,
          orgName: orgName || null,
          profession: profession || null,
          businessDomain: businessDomain || null,
          activatorName: activatorNameNorm || null,
          activatorPhone: activatorPhone || null,
          province: province || null,
          activationMethod: activationMethod || null,
          clientPlatform: clientPlatform || null,
          clientPlatformLabel: clientPlatformLabel || null,
          clientDeviceName: clientDeviceName || null,
          clientAppMode: clientAppMode || null,
          clientActivationPath: clientActivationPath || null,
          activationMission,
          activationMissionLabel: missionLabel,
        },
      });

      return {
        success: true,
        message: 'تم تفعيل البرنامج بنجاح.',
        activationType,
        activationMission,
        activationMissionLabel: missionLabel,
        telegram: telegramStatus,
      };
    } catch (e: any) {
      console.error('Activation error:', e);
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.attempt.failed',
        affectedItems: [{ code: trimmedCode }],
        meta: { reason: 'UNEXPECTED_ERROR', error: e?.message || 'UNKNOWN' },
      });
      return reply.status(500).send({ error: 'حدث خطأ أثناء التفعيل.' });
    }
  });

  /**
   * After client-side local/trial activation (no row consumed in activation_codes), send the same Telegram audit as server activations.
   * Idempotent via client-generated notificationId (UUID) stored in activation_telegram_dedupe.
   */
  api.post('/activation/notify-success', async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const notificationId = trimActivationField(body?.notificationId);
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!notificationId || !UUID_RE.test(notificationId)) {
      return reply.status(400).send({ error: 'معرّف تتبع الإشعار (notificationId) غير صالح.' });
    }

    const code = trimActivationField(body?.code).toUpperCase();
    const activationType = String(body?.activationType || '').trim().toLowerCase();
    const activationMission = normalizeLicenseMission(
      String(body?.activationMission || inferLicenseMissionFromLegacyActivationType(activationType))
    );
    const missionDefinition = getLicenseMissionDefinition(activationMission);
    const missionLabel = String(body?.activationMissionLabel || getLicenseMissionLabel(activationMission));
    const customerName = trimActivationField(body?.customerName);
    const businessDomain = trimActivationField(body?.businessDomain ?? body?.profession);
    const activatorNameNorm = trimActivationField(body?.activatorName);

    const nameErr = validateOptionalActivatorName(activatorNameNorm);
    if (nameErr) return reply.status(400).send({ error: nameErr });
    const domainErr = validateOptionalBusinessDomain(businessDomain);
    if (domainErr) return reply.status(400).send({ error: domainErr });
    const codeErr = validateActivationCodeForNotify(code, activationType);
    if (codeErr) return reply.status(400).send({ error: codeErr });

    if (activationType !== 'local' && activationType !== 'trial') {
      return reply.status(400).send({ error: 'هذا المسار مخصص لتفعيل محلي أو تجريبي فقط. استخدم مسار التفعيل عبر الخادم للأنواع الأخرى.' });
    }

    try {
      const existing = await db.select().from(schema.activationTelegramDedupe).where(eq(schema.activationTelegramDedupe.id, notificationId)).get();
      if (existing) {
        console.info('[activation/notify-success] duplicate notificationId, skipping Telegram');
        return { success: true, duplicate: true, telegram: 'skipped' };
      }

      await db.insert(schema.activationTelegramDedupe).values({ id: notificationId }).run();
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        console.info('[activation/notify-success] duplicate notificationId (constraint), skipping Telegram');
        return { success: true, duplicate: true, telegram: 'skipped' };
      }
      console.error('[activation/notify-success] dedupe insert failed', e);
      return reply.status(500).send({ error: 'تعذر تسجيل حدث الإشعار.' });
    }

    const now = new Date().toISOString();
    const computerName = os.hostname();
    const version = getAppVersion();
    const typeLabel = TYPE_LABELS[activationType] || activationType;

    const ctx: ActivationTelegramContext = {
      kind: 'success',
      title: '✅ <b>تم تفعيل البرنامج بنجاح</b> (محلي/تجريبي — إشعار خادم)',
      code,
      activationTypeLabel: typeLabel,
      activationMissionLabel: missionLabel,
      activationMissionSummary: missionDefinition.operatorSummary,
      timestamp: now,
      version,
      serverHost: computerName,
      customerName: customerName || undefined,
      orgName: trimActivationField(body?.orgName) || undefined,
      businessDomain,
      activatorName: activatorNameNorm,
      activatorPhone: trimActivationField(body?.activatorPhone) || undefined,
      province: trimActivationField(body?.province) || undefined,
      activationMethod: trimActivationField(body?.activationMethod) || undefined,
      clientPlatformLabel: String(body?.clientPlatformLabel || body?.clientPlatform || '') || undefined,
      clientDeviceName: String(body?.clientDeviceName || '') || undefined,
      clientAppMode: String(body?.clientAppMode || '') || undefined,
      clientActivationPath: String(body?.clientActivationPath || '') || undefined,
    };

    const telegramStatus = await deliverActivationTelegram(ctx, serverConfig, {
      code,
      activatorName: activatorNameNorm,
      businessDomain,
      orgName: trimActivationField(body?.orgName) || undefined,
      customerName: customerName || undefined,
    });

    try {
      await auditLogger.log({
        userId: 'system',
        operationType: 'activation.notify_success',
        affectedItems: [{ code, notificationId }],
        meta: {
          activationType,
          activationMission,
          activationMissionLabel: missionLabel,
          customerName: customerName || null,
          businessDomain,
          activatorName: activatorNameNorm,
          orgName: trimActivationField(body?.orgName) || null,
        },
      });
    } catch (auditErr) {
      console.warn('[activation/notify-success] audit log failed', auditErr);
    }

    return { success: true, telegram: telegramStatus };
  });

  api.get('/setup/status', async () => {
    try {
      const existingUsers = await db.select().from(schema.users).all();
      return { needsSetup: existingUsers.length === 0 };
    } catch {
      return { needsSetup: false };
    }
  });

  api.post('/setup/complete', async (req, reply) => {
    const body = req.body as any;
    // Always normalize to 'org-main' to stay consistent with seed-accounts backfill
    const companyId = 'org-main';
    const DEFAULT_BRANCH_ID = 'br-main';
    const branchName = String(
      body?.branch?.name ||
      body?.branchName ||
      body?.settings?.branchName ||
      body?.company?.branchName ||
      'الفرع الرئيسي',
    ).trim() || 'الفرع الرئيسي';
    const setupRole = resolveSetupRole(body?.user?.role);
    const setupPermissions = resolveSetupPermissions(body?.user?.permissions, setupRole);

    const existingUsers = await db.select().from(schema.users).all();
    if (existingUsers.length > 0) {
      return reply.status(409).send({ error: 'النظام مُعد مسبقًا.', code: 'SETUP_ALREADY_COMPLETE' });
    }

    // Provisioning validation — reject before writing anything
    const provisioningErrors = validateProvisioningRequest(body);
    if (provisioningErrors.length > 0) {
      await auditLogger.log({
        userId: 'system',
        operationType: 'setup.rejected',
        affectedItems: [{ reason: 'VALIDATION_FAILED' }],
        meta: { errors: provisioningErrors.map((e: any) => e.code) },
      });
      return reply.status(400).send({
        error: 'بيانات الإعداد غير مكتملة.',
        code: 'SETUP_VALIDATION_FAILED',
        details: provisioningErrors,
      });
    }

    try {
      // Ensure default company exists
      try {
        const existingCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
        if (!existingCompany) {
          await db.insert(schema.companies).values({
            id: companyId,
            name: body.company?.name || 'الشركة الرئيسية',
            code: String(companyId).toUpperCase().slice(0, 10),
            isActive: true,
          }).run();
        }
      } catch {}

      // Ensure default branch exists
      try {
        const existingBranch = await db.select().from(schema.branches).where(eq(schema.branches.id, DEFAULT_BRANCH_ID)).get();
        if (!existingBranch) {
          await db.insert(schema.branches).values({
            id: DEFAULT_BRANCH_ID,
            companyId,
            name: branchName,
            code: 'MAIN',
            isMain: true,
            isActive: true,
          }).run();
        } else {
          await db.update(schema.branches).set({ companyId, name: branchName, isMain: true, isActive: true }).where(eq(schema.branches.id, DEFAULT_BRANCH_ID)).run();
        }
      } catch {}

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(body.user.password, salt);
      await db.insert(schema.users).values({
        id: 'u-admin',
        username: body.user.username,
        passwordHash,
        name: body.user.name || body.user.username,
        role: setupRole,
        permissions: setupPermissions.join(','),
        companyId,
        defaultBranchId: DEFAULT_BRANCH_ID,
        branchScope: 'company_wide',
      }).run();

      try {
        await db.insert(schema.userCompanyAccess).values({
          id: `uca-u-admin-${companyId}`,
          userId: 'u-admin',
          companyId,
          isDefault: true,
          isActive: true,
        }).onConflictDoNothing().run();
      } catch {}

      // Grant admin access to the default branch
      try {
        await db.insert(schema.userBranchAccess).values({
          id: `uba-u-admin-${DEFAULT_BRANCH_ID}`,
          userId: 'u-admin',
          branchId: DEFAULT_BRANCH_ID,
          isDefault: true,
          isActive: true,
        }).onConflictDoNothing().run();
      } catch {}

      const whName = body.settings?.mainWarehouseName || 'المستودع الرئيسي';
      try {
        const existingWarehouse = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, 'wh-main')).get();
        if (existingWarehouse) {
          await db.update(schema.warehouses).set({
            name: whName,
            companyId,
            branchId: DEFAULT_BRANCH_ID,
            location: body.company?.address || '',
            manager: body.user.name || 'المدير',
          }).where(eq(schema.warehouses.id, 'wh-main')).run();
        } else {
          await db.insert(schema.warehouses).values({
            id: 'wh-main',
            name: whName,
            companyId,
            branchId: DEFAULT_BRANCH_ID,
            location: body.company?.address || '',
            manager: body.user.name || 'المدير',
          }).run();
        }
      } catch {}

      const cbName = body.settings?.mainCashBoxName || 'صندوق الكاشير الرئيسي';
      const currency = body.settings?.primaryCurrency || 'USD';
      try {
        const existingCashBox = await db.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, 'cb-main')).get();
        if (existingCashBox) {
          await db.update(schema.cashBoxes).set({
            name: cbName,
            companyId,
            branchId: DEFAULT_BRANCH_ID,
            balance: Number(existingCashBox.balance || 0),
            currency,
          }).where(eq(schema.cashBoxes.id, 'cb-main')).run();
        } else {
          await db.insert(schema.cashBoxes).values({
            id: 'cb-main',
            name: cbName,
            companyId,
            branchId: DEFAULT_BRANCH_ID,
            balance: 0,
            currency,
          }).run();
        }
      } catch {}

      const unitName = body.settings?.defaultUnit || 'متر';
      try {
        await db.insert(schema.units).values({ id: 'u1', name: unitName }).run();
      } catch {}

      const clientName = body.settings?.defaultClientName || 'عميل نقدي عام';
      const supplierName = body.settings?.defaultSupplierName || 'مورد أساسي';
      try {
        const existingCashCustomer = await db.select().from(schema.parties).where(eq(schema.parties.id, 'party-cash-customer')).get();
        if (existingCashCustomer) {
          await db.update(schema.parties).set({
            name: clientName,
            type: 'CUSTOMER',
            isActive: true,
          }).where(eq(schema.parties.id, 'party-cash-customer')).run();
        } else {
          await db.insert(schema.parties).values({
            id: 'party-cash-customer',
            name: clientName,
            type: 'CUSTOMER',
            isActive: true,
          }).run();
        }
      } catch {}
      try {
        const existingCashSupplier = await db.select().from(schema.parties).where(eq(schema.parties.id, 'party-cash-supplier')).get();
        if (existingCashSupplier) {
          await db.update(schema.parties).set({
            name: supplierName,
            type: 'SUPPLIER',
            isActive: true,
          }).where(eq(schema.parties.id, 'party-cash-supplier')).run();
        } else {
          await db.insert(schema.parties).values({
            id: 'party-cash-supplier',
            name: supplierName,
            type: 'SUPPLIER',
            isActive: true,
          }).run();
        }
      } catch {}

      if (Array.isArray(body.parties)) {
        for (let i = 0; i < body.parties.length; i++) {
          const party = body.parties[i];
          if (!party.name) continue;
          const partyId = `p-setup-${Date.now()}-${i}`;
          try {
            await db.insert(schema.parties).values({
              id: partyId,
              name: party.name,
              type: party.type || 'CUSTOMER',
              isActive: true,
              balance: Number(party.openingBalance) || 0,
            }).run();
          } catch {}
        }
      }

      if (body.company) {
        await persistValidatedSetting('company', {
          name: body.company.name || '',
          address: body.company.address || '',
          phone1: body.company.phone || '',
          logo: body.company.logo || '',
        }, { companyId });
      }

      await persistValidatedSetting('defaultCurrency', currency, { companyId });
      await persistValidatedSetting('primaryCurrency', currency, { companyId });

      if (body.settings?.secondaryCurrency) {
        const rates: Record<string, number> = {};
        rates[currency] = 1;
        rates[body.settings.secondaryCurrency] = body.settings.secondaryCurrencyRate || 1;
        await persistValidatedSetting('currencyRates', rates, { companyId });
      }

      if (body.printers) {
        await persistValidatedSetting('print', body.printers, { companyId });
      }

      if (body.deployment) {
        await persistValidatedSetting('deployment', body.deployment, { companyId });
      }

      if (body.projectProfile) {
        await persistValidatedSetting('projectProfile', body.projectProfile, { companyId });
      }

      const allowedBranchIds = [DEFAULT_BRANCH_ID];
      const token = server.jwt.sign({
        id: 'u-admin',
        role: setupRole,
        companyId,
        allowedBranchIds,
        defaultBranchId: DEFAULT_BRANCH_ID,
        currentBranchId: DEFAULT_BRANCH_ID,
        branchScope: 'company_wide',
      });
      await auditLogger.log({
        userId: 'u-admin',
        operationType: 'setup.complete',
        affectedItems: [{ userId: 'u-admin' }],
        newValues: {
          username: body.user.username,
          companyId,
          companyName: body.company?.name || null,
          branchName,
          role: setupRole,
          currency,
        },
      });

      // Warn if system was set up with a weak or dev-generated JWT secret
      if (serverConfig.usedDevelopmentSecret || serverConfig.secretStrength !== 'strong') {
        try {
          await (ctx as any).systemEventLogger?.log({
            eventType: SYSTEM_EVENT_TYPES.SECURITY_WEAK_SECRET,
            severity: 'warning',
            sourceModule: 'setup',
            action: 'setup.complete',
            status: 'success',
            errorCode: serverConfig.usedDevelopmentSecret ? 'SETUP_WITH_DEV_SECRET' : 'SETUP_WITH_WEAK_SECRET',
            requiresManualReview: false,
            metadata: {
              secretStrength: serverConfig.secretStrength,
              recommendation: 'تأكد من ضبط JWT_SECRET إلى نص عشوائي قوي (32 حرف على الأقل) قبل الاستخدام الفعلي.',
            },
          });
        } catch {}
      }

      return {
        success: true,
        token,
        user: {
          id: 'u-admin',
          username: body.user.username,
          name: body.user.name || body.user.username,
          role: setupRole,
          permissions: setupPermissions,
          companyId,
          defaultBranchId: DEFAULT_BRANCH_ID,
          currentBranchId: DEFAULT_BRANCH_ID,
          allowedBranchIds,
          branchScope: 'company_wide',
        },
      };
    } catch (e: any) {
      console.error('Setup error:', e);
      await auditLogger.log({
        userId: 'system',
        operationType: 'setup.failed',
        affectedItems: [{ userId: 'u-admin' }],
        meta: { error: e?.message || 'UNKNOWN' },
      });
      return reply.status(500).send({ error: 'حدث خطأ أثناء التجهيز: ' + e.message });
    }
  });
}
