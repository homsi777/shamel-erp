import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RouteContext } from './_common';
import { loadNormalizedSettingsMap, upsertValidatedSetting } from '../lib/settings';
import { getResolvedDbPath } from '../db';
import { normalizeLicenseMission, getLicenseMissionLabel } from '../../src/lib/licenseMission';
import { recognizeLicenseExtensionCode } from '../../src/lib/licenseExtensions';
import { DEFAULT_MODULE_CONTROL, normalizeModuleControl, summarizeEnabledModules } from '../../src/lib/systemModules';
import { normalizeProjectProfile, resolveProjectProfile } from '../../src/lib/projectProfiles';

const getAppVersion = () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
};

const getBackupSummary = () => {
  try {
    const dbPath = getResolvedDbPath();
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    if (!fs.existsSync(backupDir)) return null;
    const entries = fs.readdirSync(backupDir)
      .map((name) => {
        const full = path.join(backupDir, name);
        const stat = fs.statSync(full);
        return stat.isFile() ? { name, size: stat.size, createdAt: new Date(stat.mtimeMs).toISOString() } : null;
      })
      .filter(Boolean) as Array<{ name: string; size: number; createdAt: string }>;
    return entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null;
  } catch {
    return null;
  }
};

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, bcrypt, server, serverConfig, auditLogger } = ctx as any;

  const getCurrentSuperAdmin = async (req: any) => {
    const auth = (req as any).superAdminContext || {};
    const id = String(auth.id || '').trim();
    if (!id) return null;
    return db.select().from(schema.systemSuperAdmins).where(eq(schema.systemSuperAdmins.id, id)).get();
  };

  api.post('/super-admin/login', async (req, reply) => {
    const body = (req.body || {}) as any;
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return reply.status(400).send({ error: 'SUPER_ADMIN_CREDENTIALS_REQUIRED' });
    }

    const account = await db.select().from(schema.systemSuperAdmins).where(eq(schema.systemSuperAdmins.username, username)).get();
    if (!account || !bcrypt.compareSync(password, String(account.passwordHash || ''))) {
      await auditLogger.log({
        userId: 'system',
        operationType: 'super_admin.login.failed',
        affectedItems: [{ username }],
      });
      return reply.status(401).send({ error: 'INVALID_SUPER_ADMIN_CREDENTIALS' });
    }

    await db.update(schema.systemSuperAdmins)
      .set({ lastLoginAt: new Date().toISOString() })
      .where(eq(schema.systemSuperAdmins.id, account.id))
      .run();

    const token = server.jwt.sign({
      id: account.id,
      username: account.username,
      scope: 'super_admin',
    });

    return {
      token,
      user: {
        id: String(account.id),
        username: String(account.username),
        displayName: String(account.displayName || 'System Super Admin'),
        scope: 'super_admin',
        mustChangePassword: Boolean(account.mustChangePassword),
      },
    };
  });

  api.get('/super-admin/dashboard', async () => {
    const settingsMap = await loadNormalizedSettingsMap(db, schema);
    const projectProfile = normalizeProjectProfile(settingsMap.get('projectProfile') || resolveProjectProfile(settingsMap.get('company') ? { company: settingsMap.get('company') } as any : undefined));
    const deployment = settingsMap.get('deployment') || null;
    const moduleControl = normalizeModuleControl(settingsMap.get('moduleControl') || DEFAULT_MODULE_CONTROL);
    const activationRow = await db.select().from(schema.activationCodes).where(eq(schema.activationCodes.isUsed, true)).get();
    const extensions = await db.select().from(schema.licenseExtensions).all();
    return {
      activation: activationRow
        ? {
            code: String(activationRow.code || ''),
            activationType: String(activationRow.activationType || 'local'),
            mission: normalizeLicenseMission(activationRow.licenseMission),
            missionLabel: getLicenseMissionLabel(normalizeLicenseMission(activationRow.licenseMission)),
            usedAt: activationRow.usedAt || null,
          }
        : null,
      projectProfile,
      deployment,
      moduleControl,
      modules: summarizeEnabledModules(projectProfile.id, moduleControl),
      runtime: {
        version: getAppVersion(),
        dbPath: getResolvedDbPath(),
        nodeEnv: serverConfig.nodeEnv,
        secretStrength: serverConfig.secretStrength,
      },
      lastBackup: getBackupSummary(),
      extensions: (extensions || []).map((row: any) => ({
        code: String(row.code || ''),
        extensionType: String(row.extensionType || ''),
        label: String(row.label || ''),
        appliedAt: String(row.appliedAt || ''),
      })),
    };
  });

  api.get('/super-admin/license', async () => {
    const activationRow = await db.select().from(schema.activationCodes).where(eq(schema.activationCodes.isUsed, true)).get();
    const settingsMap = await loadNormalizedSettingsMap(db, schema);
    const projectProfile = normalizeProjectProfile(settingsMap.get('projectProfile'));
    const moduleControl = normalizeModuleControl(settingsMap.get('moduleControl') || DEFAULT_MODULE_CONTROL);
    const extensions = await db.select().from(schema.licenseExtensions).all();
    return {
      baseLicense: activationRow
        ? {
            code: String(activationRow.code || ''),
            activationType: String(activationRow.activationType || 'local'),
            mission: normalizeLicenseMission(activationRow.licenseMission),
            missionLabel: getLicenseMissionLabel(normalizeLicenseMission(activationRow.licenseMission)),
            usedAt: activationRow.usedAt || null,
          }
        : null,
      projectProfile,
      moduleControl,
      effectiveModules: summarizeEnabledModules(projectProfile.id, moduleControl),
      extensions: extensions || [],
    };
  });

  api.post('/super-admin/license/apply', async (req, reply) => {
    const body = (req.body || {}) as any;
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return reply.status(400).send({ error: 'EXTENSION_CODE_REQUIRED' });

    const currentAdmin = await getCurrentSuperAdmin(req);
    const existing = await db.select().from(schema.licenseExtensions).where(eq(schema.licenseExtensions.code, code)).get();
    if (existing) {
      return reply.status(409).send({ error: 'EXTENSION_ALREADY_APPLIED' });
    }

    const extension = recognizeLicenseExtensionCode(code);
    if (!extension) {
      return reply.status(400).send({ error: 'UNSUPPORTED_EXTENSION_CODE' });
    }

    const settingRow = await loadNormalizedSettingsMap(db, schema);
    const currentModuleControl = normalizeModuleControl(settingRow.get('moduleControl') || DEFAULT_MODULE_CONTROL);
    const nextModuleControl = normalizeModuleControl({
      ...currentModuleControl,
      forceEnabledTabs: Array.from(new Set([...currentModuleControl.forceEnabledTabs, ...extension.forceEnabledTabs])),
      extensionCodes: Array.from(new Set([...(currentModuleControl.extensionCodes || []), extension.code])),
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: currentAdmin?.username || 'super_admin',
    });

    const { storedValue, existing: existingSetting, rowKey } = await upsertValidatedSetting(db, schema, eq, 'moduleControl', nextModuleControl);
    if (existingSetting) {
      await db.update(schema.systemSettings).set({ value: storedValue }).where(eq(schema.systemSettings.key, rowKey)).run();
    } else {
      await db.insert(schema.systemSettings).values({ key: rowKey, value: storedValue }).run();
    }

    await db.insert(schema.licenseExtensions).values({
      id: `lic-ext-${Date.now()}`,
      code: extension.code,
      extensionType: extension.extensionType,
      label: extension.label,
      payload: JSON.stringify(extension),
      appliedBy: currentAdmin?.username || 'super_admin',
      appliedAt: new Date().toISOString(),
    }).run();

    await auditLogger.log({
      userId: currentAdmin?.id || 'super_admin',
      operationType: 'super_admin.license_extension.apply',
      affectedItems: [{ code: extension.code }],
      newValues: extension,
    });

    return {
      success: true,
      extension,
      moduleControl: nextModuleControl,
    };
  });

  api.get('/super-admin/module-control', async () => {
    const settingsMap = await loadNormalizedSettingsMap(db, schema);
    const projectProfile = normalizeProjectProfile(settingsMap.get('projectProfile'));
    const moduleControl = normalizeModuleControl(settingsMap.get('moduleControl') || DEFAULT_MODULE_CONTROL);
    return {
      projectProfile,
      moduleControl,
      modules: summarizeEnabledModules(projectProfile.id, moduleControl),
    };
  });

  api.post('/super-admin/module-control', async (req) => {
    const body = (req.body || {}) as any;
    const currentAdmin = await getCurrentSuperAdmin(req);
    const nextModuleControl = normalizeModuleControl({
      disabledTabs: body.disabledTabs,
      forceEnabledTabs: body.forceEnabledTabs,
      nodeOverrides: body.nodeOverrides,
      extensionCodes: body.extensionCodes,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: currentAdmin?.username || 'super_admin',
    });
    const { storedValue, existing, rowKey } = await upsertValidatedSetting(db, schema, eq, 'moduleControl', nextModuleControl);
    if (existing) {
      await db.update(schema.systemSettings).set({ value: storedValue }).where(eq(schema.systemSettings.key, rowKey)).run();
    } else {
      await db.insert(schema.systemSettings).values({ key: rowKey, value: storedValue }).run();
    }
    return { success: true, moduleControl: nextModuleControl };
  });

  api.get('/super-admin/diagnostics', async () => {
    const settingsMap = await loadNormalizedSettingsMap(db, schema);
    const activationRow = await db.select().from(schema.activationCodes).where(eq(schema.activationCodes.isUsed, true)).get();
    return {
      runtime: {
        version: getAppVersion(),
        dbPath: getResolvedDbPath(),
        nodeEnv: serverConfig.nodeEnv,
        secretStrength: serverConfig.secretStrength,
        strictMode: serverConfig.strictMode,
      },
      deployment: settingsMap.get('deployment') || null,
      projectProfile: normalizeProjectProfile(settingsMap.get('projectProfile')),
      moduleControl: normalizeModuleControl(settingsMap.get('moduleControl') || DEFAULT_MODULE_CONTROL),
      activationMission: activationRow ? normalizeLicenseMission(activationRow.licenseMission) : null,
      activationMissionLabel: activationRow ? getLicenseMissionLabel(normalizeLicenseMission(activationRow.licenseMission)) : null,
      lastBackup: getBackupSummary(),
    };
  });
}
