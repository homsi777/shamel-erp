import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';
import { appError, isAppError } from '../lib/errors';
import { normalizeTenantId, resolveBranchAccessForUser, resolveCompanyAccessForUser } from '../lib/tenantScope';
import { buildLoginAttemptKey, clearLoginAttemptState, getLoginAttemptPolicy, getLoginAttemptStatus, recordFailedLoginAttempt } from '../lib/loginAttemptLimiter';

const sanitizeUser = (
  user: any,
  companyId?: string | null,
  branchContext?: {
    allowedBranchIds?: string[];
    defaultBranchId?: string | null;
    currentBranchId?: string | null;
    requiresBranchSelection?: boolean;
    branchScope?: string;
    allowedCompanyIds?: string[];
    hasMultiCompanyCapability?: boolean;
    companyVisibilityMode?: string;
  } | null,
) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  permissions: String(user.permissions || '').split(',').filter(Boolean),
  companyId: normalizeTenantId(companyId),
  defaultBranchId: normalizeTenantId(branchContext?.defaultBranchId),
  currentBranchId: normalizeTenantId(branchContext?.currentBranchId),
  allowedBranchIds: Array.isArray(branchContext?.allowedBranchIds) ? branchContext?.allowedBranchIds : [],
  requiresBranchSelection: Boolean(branchContext?.requiresBranchSelection),
  branchScope: String(branchContext?.branchScope || user.branchScope || 'restricted'),
  allowedCompanyIds: Array.isArray(branchContext?.allowedCompanyIds) ? branchContext?.allowedCompanyIds : [],
  hasMultiCompanyCapability: Boolean(branchContext?.hasMultiCompanyCapability),
  companyVisibilityMode: String(branchContext?.companyVisibilityMode || 'single'),
  posWarehouseId: user.posWarehouseId ?? null,
  posWarehouseName: user.posWarehouseName ?? null,
  isActive: user.isActive ?? true,
});

const buildSessionTokenPayload = (
  user: any,
  companyId: string,
  branchContext: {
    allowedBranchIds: string[];
    allowedCompanyIds?: string[];
    defaultBranchId: string | null;
    currentBranchId: string | null;
    branchScope: string;
    hasMultiCompanyCapability?: boolean;
    companyVisibilityMode?: string;
  },
) => ({
  id: user.id,
  role: user.role,
  companyId,
  allowedCompanyIds: Array.isArray(branchContext.allowedCompanyIds) ? branchContext.allowedCompanyIds : undefined,
  allowedBranchIds: branchContext.allowedBranchIds,
  defaultBranchId: branchContext.defaultBranchId,
  currentBranchId: branchContext.currentBranchId,
  branchScope: branchContext.branchScope,
  hasMultiCompanyCapability: Boolean(branchContext.hasMultiCompanyCapability),
  companyVisibilityMode: String(branchContext.companyVisibilityMode || 'single'),
});

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, eq, bcrypt, server, auditLogger } = ctx as any;

  const loadUserByUsername = async (username: string) => {
    let user = await db.select().from(schema.users).where(eq(schema.users.username, username)).get();
    if (!user) {
      const allUsers = await db.select().from(schema.users).all();
      user = allUsers.find((entry: any) => String(entry.username || '').trim() === username);
    }
    return user || null;
  };

  const syncUserBranchAccess = async (userId: string, allowedBranchIds: string[], defaultBranchId?: string | null) => {
    const normalizedBranchIds = Array.from(new Set(
      (allowedBranchIds || [])
        .map((value) => normalizeTenantId(value))
        .filter(Boolean) as string[]
    ));
    await db.delete(schema.userBranchAccess).where(eq(schema.userBranchAccess.userId, userId)).run();
    for (const branchId of normalizedBranchIds) {
      await db.insert(schema.userBranchAccess).values({
        id: `uba-${userId}-${branchId}`,
        userId,
        branchId,
        isDefault: normalizeTenantId(defaultBranchId) === branchId,
        isActive: true,
      }).run();
    }
  };

  const syncUserCompanyAccess = async (
    userId: string,
    allowedCompanyIds: string[],
    defaultCompanyId?: string | null,
  ) => {
    const normalizedCompanyIds = Array.from(new Set(
      (allowedCompanyIds || [])
        .map((value) => normalizeTenantId(value))
        .filter(Boolean) as string[]
    ));
    await db.delete(schema.userCompanyAccess).where(eq(schema.userCompanyAccess.userId, userId)).run();
    for (const companyId of normalizedCompanyIds) {
      await db.insert(schema.userCompanyAccess).values({
        id: `uca-${userId}-${companyId}`,
        userId,
        companyId,
        isDefault: normalizeTenantId(defaultCompanyId) === companyId,
        isActive: true,
      }).run();
    }
  };

  const resolveScopedBranchAssignment = async (
    companyId: string,
    allowedBranchIdsInput: unknown,
    defaultBranchIdInput?: unknown,
  ) => {
    const companyBranches = await db.select().from(schema.branches).where(eq(schema.branches.companyId, companyId)).all();
    const activeCompanyBranches = (companyBranches || []).filter((branch: any) => Number(branch?.isActive ?? 1) !== 0);
    const activeBranchIds = new Set(activeCompanyBranches.map((branch: any) => String(branch.id)));
    const requestedBranchIds = Array.isArray(allowedBranchIdsInput)
      ? Array.from(new Set(allowedBranchIdsInput.map((value) => normalizeTenantId(value)).filter(Boolean) as string[]))
      : [];

    const invalidBranchIds = requestedBranchIds.filter((branchId) => !activeBranchIds.has(branchId));
    if (invalidBranchIds.length > 0) {
      throw appError(400, 'INVALID_BRANCH_ASSIGNMENT', 'Selected branches are not active in the current company.', {
        invalid_branch_ids: invalidBranchIds,
        company_id: companyId,
      });
    }

    const defaultBranchId = normalizeTenantId(defaultBranchIdInput);
    if (defaultBranchId && !activeBranchIds.has(defaultBranchId)) {
      throw appError(400, 'INVALID_DEFAULT_BRANCH', 'Default branch does not belong to the current company.', {
        branch_id: defaultBranchId,
        company_id: companyId,
      });
    }

    if (defaultBranchId && requestedBranchIds.length > 0 && !requestedBranchIds.includes(defaultBranchId)) {
      throw appError(400, 'DEFAULT_BRANCH_NOT_ALLOWED', 'Default branch must be within the allowed branch set.', {
        branch_id: defaultBranchId,
        allowed_branch_ids: requestedBranchIds,
      });
    }

    const nextDefaultBranchId = defaultBranchId || requestedBranchIds[0] || null;
    return {
      allowedBranchIds: requestedBranchIds,
      defaultBranchId: nextDefaultBranchId,
      companyBranches: activeCompanyBranches,
    };
  };

  const resolveSessionForCompany = async (
    user: any,
    companyId: string,
    currentBranchId?: string | null,
  ) => {
    const companyAccess = await resolveCompanyAccessForUser(db, schema, eq, user);
    if (!companyAccess.allowedCompanyIds.includes(companyId)) {
      throw appError(403, 'COMPANY_ACCESS_DENIED', 'User is not allowed to access the selected company.', {
        company_id: companyId,
        allowed_company_ids: companyAccess.allowedCompanyIds,
      });
    }
    const branchContext = await resolveBranchAccessForUser(db, schema, eq, user, companyId);
    const nextCurrentBranchId = normalizeTenantId(currentBranchId)
      || branchContext.currentBranchId
      || branchContext.defaultBranchId;
    return {
      allowedCompanyIds: companyAccess.allowedCompanyIds,
      companies: companyAccess.companies,
      hasMultiCompanyCapability: Boolean((companyAccess as any).hasMultiCompanyCapability),
      companyVisibilityMode: String((companyAccess as any).visibilityMode || 'single'),
      branchContext: {
        ...branchContext,
        currentBranchId: nextCurrentBranchId,
      },
    };
  };

  const attemptSuperAdminLogin = async (username: string, password: string) => {
    if (!username || !password) return null;
    const account = await db.select().from(schema.systemSuperAdmins).where(eq(schema.systemSuperAdmins.username, username)).get();
    if (!account || !bcrypt.compareSync(password, String(account.passwordHash || ''))) {
      return null;
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
      scope: 'super_admin' as const,
    };
  };

  api.post('/login', async (req, reply) => {
    try {
      const body = req.body as any;
      const username = String(body?.username || '').trim();
      const password = body?.password ?? '';
      const bodyCompanyId = normalizeTenantId(body?.companyId);
      const headerCompanyId = normalizeTenantId(req.headers['x-company-id'] || req.headers['x-active-org']);
      const loginAttemptKey = buildLoginAttemptKey(username, bodyCompanyId || 'super-admin');
      if (headerCompanyId && headerCompanyId !== bodyCompanyId) {
        throw appError(400, 'COMPANY_CONTEXT_MISMATCH', 'Company context mismatch.');
      }

      const lockStatus = getLoginAttemptStatus(loginAttemptKey);
      if (lockStatus.isLocked) {
        const lockPolicy = getLoginAttemptPolicy();
        return reply.status(429).send({
          error: 'LOGIN_LOCKED',
          code: 'LOGIN_LOCKED',
          message: 'تم إيقاف تسجيل الدخول مؤقتاً بعد 3 محاولات فاشلة. حاول مرة أخرى بعد 5 دقائق.',
          details: {
            remainingSeconds: Math.ceil(lockStatus.remainingMs / 1000),
            retryAfterSeconds: Math.ceil(lockStatus.remainingMs / 1000),
            maxFailedAttempts: lockPolicy.maxFailedAttempts,
            lockoutWindowSeconds: Math.floor(lockPolicy.lockoutWindowMs / 1000),
          },
        });
      }

      if (bodyCompanyId) {
        const user = await loadUserByUsername(username);
        if (user && bcrypt.compareSync(password, user.passwordHash)) {
          clearLoginAttemptState(loginAttemptKey);
          const sessionContext = await resolveSessionForCompany(user, bodyCompanyId);
          const branchContext = {
            ...sessionContext.branchContext,
            allowedCompanyIds: sessionContext.allowedCompanyIds,
            hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
            companyVisibilityMode: sessionContext.companyVisibilityMode,
          };
          const token = server.jwt.sign(buildSessionTokenPayload(user, bodyCompanyId, {
            allowedCompanyIds: sessionContext.allowedCompanyIds,
            allowedBranchIds: branchContext.allowedBranchIds,
            defaultBranchId: branchContext.defaultBranchId,
            currentBranchId: branchContext.currentBranchId,
            branchScope: branchContext.branchScope,
            hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
            companyVisibilityMode: sessionContext.companyVisibilityMode,
          }));

          await auditLogger.log({
            userId: user.id,
            operationType: 'auth.login.success',
            affectedItems: [{ userId: user.id, username: user.username }],
            meta: {
              role: user.role,
              isActive: user.isActive ?? true,
              companyId: bodyCompanyId,
              allowedCompanyIds: sessionContext.allowedCompanyIds,
              hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
              companyVisibilityMode: sessionContext.companyVisibilityMode,
              currentBranchId: branchContext.currentBranchId,
              allowedBranchIds: branchContext.allowedBranchIds,
            },
          });

          return {
            token,
            user: sanitizeUser(user, bodyCompanyId, branchContext),
            scope: 'user',
          };
        }
      }

      const superAdminResult = await attemptSuperAdminLogin(username, String(password || ''));
      if (superAdminResult) {
        clearLoginAttemptState(loginAttemptKey);
        return superAdminResult;
      }

      if (!bodyCompanyId) {
        throw appError(400, 'COMPANY_REQUIRED', 'Company selection is required.');
      }

      const failedAttempt = recordFailedLoginAttempt(loginAttemptKey);
      await auditLogger.log({
        userId: 'system',
        operationType: 'auth.login.failed',
        affectedItems: [{ username }],
        meta: {
          reason: failedAttempt.isLocked ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS',
          companyId: bodyCompanyId,
          failedCount: failedAttempt.failedCount,
          remainingAttempts: failedAttempt.remainingAttempts,
          remainingSeconds: Math.ceil((failedAttempt.remainingMs || 0) / 1000),
        },
      });
      if (failedAttempt.isLocked) {
        const lockPolicy = getLoginAttemptPolicy();
        return reply.status(429).send({
          error: 'LOGIN_LOCKED',
          code: 'LOGIN_LOCKED',
          message: 'تم إيقاف تسجيل الدخول مؤقتاً بعد 3 محاولات فاشلة. حاول مرة أخرى بعد 5 دقائق.',
          details: {
            remainingSeconds: Math.ceil((failedAttempt.remainingMs || 0) / 1000),
            retryAfterSeconds: Math.ceil((failedAttempt.remainingMs || 0) / 1000),
            maxFailedAttempts: lockPolicy.maxFailedAttempts,
            lockoutWindowSeconds: Math.floor(lockPolicy.lockoutWindowMs / 1000),
          },
        });
      }
      return reply.status(401).send({
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
        details: {
          remainingAttempts: failedAttempt.remainingAttempts,
        },
      });
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: 'LOGIN_FAILED', code: 'LOGIN_FAILED' });
    }
  });

  api.get('/session/companies', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const userId = String(authContext?.userId || '').trim();
      const currentCompanyId = normalizeTenantId(authContext?.companyId);
      if (!userId || !currentCompanyId) {
        throw appError(401, 'UNAUTHENTICATED', 'Current session is not valid.');
      }

      const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
      if (!user) {
        throw appError(401, 'UNAUTHENTICATED', 'User not found.');
      }

      const companyAccess = await resolveCompanyAccessForUser(db, schema, eq, user);
      return {
        companies: companyAccess.companies,
        allowedCompanyIds: companyAccess.allowedCompanyIds,
        currentCompanyId,
        defaultCompanyId: companyAccess.defaultCompanyId,
        hasMultiCompanyCapability: Boolean((companyAccess as any).hasMultiCompanyCapability),
        companyVisibilityMode: String((companyAccess as any).visibilityMode || 'single'),
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: error?.message || 'SESSION_COMPANIES_FAILED' });
    }
  });

  api.post('/session/company-context', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const userId = String(authContext?.userId || '').trim();
      const targetCompanyId = normalizeTenantId((req.body as any)?.companyId);
      const requestedBranchId = normalizeTenantId((req.body as any)?.branchId);
      if (!userId) {
        throw appError(401, 'UNAUTHENTICATED', 'Current session is not valid.');
      }
      if (!targetCompanyId) {
        throw appError(400, 'COMPANY_REQUIRED', 'Target company is required.');
      }

      const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
      if (!user) {
        throw appError(401, 'UNAUTHENTICATED', 'User not found.');
      }

      const sessionContext = await resolveSessionForCompany(user, targetCompanyId, requestedBranchId);
      const branchContext = {
        ...sessionContext.branchContext,
        allowedCompanyIds: sessionContext.allowedCompanyIds,
        hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
        companyVisibilityMode: sessionContext.companyVisibilityMode,
      };
      const token = server.jwt.sign(buildSessionTokenPayload(user, targetCompanyId, {
        allowedCompanyIds: sessionContext.allowedCompanyIds,
        allowedBranchIds: branchContext.allowedBranchIds,
        defaultBranchId: branchContext.defaultBranchId,
        currentBranchId: branchContext.currentBranchId,
        branchScope: branchContext.branchScope,
        hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
        companyVisibilityMode: sessionContext.companyVisibilityMode,
      }));

      await auditLogger.log({
        userId,
        operationType: 'auth.company.switch',
        affectedItems: [{ companyId: targetCompanyId }],
        meta: {
          previousCompanyId: normalizeTenantId(authContext?.companyId),
          targetCompanyId,
          currentBranchId: branchContext.currentBranchId,
          allowedCompanyIds: sessionContext.allowedCompanyIds,
          companyVisibilityMode: sessionContext.companyVisibilityMode,
        },
      });

      return {
        token,
        user: sanitizeUser(user, targetCompanyId, branchContext),
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: error?.message || 'COMPANY_CONTEXT_UPDATE_FAILED' });
    }
  });

  api.post('/session/branch-context', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const userId = String(authContext?.userId || '').trim();
      const companyId = normalizeTenantId(authContext?.companyId);
      const requestedBranchId = normalizeTenantId((req.body as any)?.branchId);
      if (!userId || !companyId) {
        throw appError(401, 'UNAUTHENTICATED', 'Current session is not valid.');
      }
      if (!requestedBranchId) {
        throw appError(400, 'BRANCH_REQUIRED', 'Branch selection is required.');
      }

      const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
      if (!user) {
        throw appError(401, 'UNAUTHENTICATED', 'User not found.');
      }
      const sessionContext = await resolveSessionForCompany(user, companyId, requestedBranchId);
      const branchContext = sessionContext.branchContext;
      if (!branchContext.allowedBranchIds.includes(requestedBranchId) && branchContext.branchScope !== 'company_wide') {
        throw appError(403, 'BRANCH_ACCESS_DENIED', 'Selected branch is not allowed for this user.');
      }

      const nextContext = {
        ...branchContext,
        allowedCompanyIds: sessionContext.allowedCompanyIds,
        hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
        companyVisibilityMode: sessionContext.companyVisibilityMode,
        currentBranchId: requestedBranchId,
        defaultBranchId: branchContext.defaultBranchId || requestedBranchId,
      };
      const token = server.jwt.sign(buildSessionTokenPayload(user, companyId, {
        allowedCompanyIds: sessionContext.allowedCompanyIds,
        allowedBranchIds: nextContext.allowedBranchIds,
        defaultBranchId: nextContext.defaultBranchId,
        currentBranchId: nextContext.currentBranchId,
        branchScope: nextContext.branchScope,
        hasMultiCompanyCapability: sessionContext.hasMultiCompanyCapability,
        companyVisibilityMode: sessionContext.companyVisibilityMode,
      }));

      await auditLogger.log({
        userId,
        operationType: 'auth.branch.switch',
        affectedItems: [{ branchId: requestedBranchId }],
        meta: { companyId, requestedBranchId },
      });

      return {
        token,
        user: sanitizeUser(user, companyId, nextContext),
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: error?.message || 'BRANCH_CONTEXT_UPDATE_FAILED' });
    }
  });

  api.get('/session/branches', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const userId = String(authContext?.userId || '').trim();
      const companyId = normalizeTenantId(authContext?.companyId);
      if (!userId || !companyId) {
        throw appError(401, 'UNAUTHENTICATED', 'Current session is not valid.');
      }

      const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
      if (!user) {
        throw appError(401, 'UNAUTHENTICATED', 'User not found.');
      }

      const sessionContext = await resolveSessionForCompany(user, companyId, normalizeTenantId(authContext?.branchId));
      const branchContext = sessionContext.branchContext;
      const branches = branchContext.companyBranches.filter((branch: any) =>
        branchContext.branchScope === 'company_wide' || branchContext.allowedBranchIds.includes(String(branch.id))
      );

      return {
        branches,
        allowedBranchIds: branchContext.allowedBranchIds,
        currentBranchId: normalizeTenantId(authContext?.branchId) || branchContext.currentBranchId,
        defaultBranchId: branchContext.defaultBranchId,
        requiresBranchSelection: branchContext.requiresBranchSelection,
        branchScope: branchContext.branchScope,
      };
    } catch (error: any) {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: error?.message || 'SESSION_BRANCHES_FAILED' });
    }
  });

  api.post('/users', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const companyId = normalizeTenantId(authContext?.companyId);
      if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'Current company is required.');

      const data = req.body as any;
      const username = String(data.username || '').trim();
      if (!username || !data.password) {
        return reply.status(400).send({ error: 'Missing required user fields.' });
      }

      const existing = await db.select().from(schema.users).where(eq(schema.users.username, username)).get();
      if (existing) {
        return reply.status(409).send({ error: 'Username already exists.' });
      }

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(data.password, salt);
      const permissions = Array.isArray(data.permissions) ? data.permissions.join(',') : data.permissions;
      const scopedBranchAssignment = await resolveScopedBranchAssignment(companyId, data.allowedBranchIds, data.defaultBranchId);
      const allowedBranchIds = scopedBranchAssignment.allowedBranchIds;
      const defaultBranchId = scopedBranchAssignment.defaultBranchId;
      const allowedCompanyIds = [companyId];
      const createdUser = {
        id: data.id || `u-${Date.now()}`,
        username,
        passwordHash,
        name: data.name || data.username,
        role: data.role || 'warehouse_keeper',
        permissions: permissions || '',
        companyId,
        defaultBranchId,
        branchScope: String(data.branchScope || 'restricted'),
        posWarehouseId: data.posWarehouseId || null,
        posWarehouseName: data.posWarehouseName || null,
        isActive: data.isActive ?? true,
      };

      await db.insert(schema.users).values(createdUser).run();
      await syncUserCompanyAccess(createdUser.id, allowedCompanyIds, companyId);
      if (allowedBranchIds.length > 0) {
        await syncUserBranchAccess(createdUser.id, allowedBranchIds, defaultBranchId);
      }

      await auditLogger.log({
        userId: String((req as any).authContext?.userId || 'system'),
        operationType: 'users.create',
        affectedItems: [{ userId: createdUser.id }],
        newValues: sanitizeUser(createdUser, companyId, {
          allowedCompanyIds,
          allowedBranchIds,
          defaultBranchId,
          currentBranchId: defaultBranchId,
          requiresBranchSelection: false,
          branchScope: createdUser.branchScope,
        }),
      });

      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.put('/users/:id', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const companyId = normalizeTenantId(authContext?.companyId);
      if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'Current company is required.');

      const { id } = req.params as any;
      const data = req.body as any;
      const existing = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
      if (!existing) return reply.status(404).send({ error: 'User not found.' });
      if (normalizeTenantId(existing.companyId) && normalizeTenantId(existing.companyId) !== companyId) {
        throw appError(404, 'USER_OUTSIDE_COMPANY', 'User not found.');
      }

      const nextUsername = String(data.username ?? existing.username ?? '').trim();
      if (!nextUsername) {
        return reply.status(400).send({ error: 'Username is required.' });
      }

      const duplicate = await db.select().from(schema.users).where(eq(schema.users.username, nextUsername)).get();
      if (duplicate && String(duplicate.id) !== String(id)) {
        return reply.status(409).send({ error: 'Username already exists.' });
      }

      const scopedBranchAssignment = Array.isArray(data.allowedBranchIds) || data.defaultBranchId !== undefined
        ? await resolveScopedBranchAssignment(companyId, data.allowedBranchIds, data.defaultBranchId ?? existing.defaultBranchId)
        : null;
      const allowedBranchIds = scopedBranchAssignment?.allowedBranchIds ?? [];
      const defaultBranchId = scopedBranchAssignment?.defaultBranchId
        ?? normalizeTenantId(existing.defaultBranchId)
        ?? null;
      const patch: any = {
        username: nextUsername,
        name: data.name ?? existing.name,
        role: data.role ?? existing.role,
        permissions: Array.isArray(data.permissions) ? data.permissions.join(',') : (data.permissions ?? existing.permissions),
        companyId,
        defaultBranchId,
        branchScope: data.branchScope ?? existing.branchScope ?? 'restricted',
        posWarehouseId: data.posWarehouseId ?? existing.posWarehouseId ?? null,
        posWarehouseName: data.posWarehouseName ?? existing.posWarehouseName ?? null,
        isActive: data.isActive ?? existing.isActive,
      };
      if (data.password) {
        const salt = bcrypt.genSaltSync(10);
        patch.passwordHash = bcrypt.hashSync(data.password, salt);
      }

      await db.update(schema.users).set(patch).where(eq(schema.users.id, id)).run();
      await syncUserCompanyAccess(String(id), [companyId], companyId);
      if (scopedBranchAssignment) {
        await syncUserBranchAccess(String(id), allowedBranchIds, defaultBranchId);
      }

      await auditLogger.log({
        userId: String((req as any).authContext?.userId || 'system'),
        operationType: 'users.update',
        affectedItems: [{ userId: id }],
        oldValues: sanitizeUser(existing, companyId),
        newValues: sanitizeUser({ ...existing, ...patch }, companyId, {
          allowedCompanyIds: [companyId],
          allowedBranchIds,
          defaultBranchId,
          currentBranchId: defaultBranchId,
          requiresBranchSelection: false,
          branchScope: patch.branchScope,
        }),
      });

      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });

  api.delete('/users/:id', async (req, reply) => {
    try {
      const authContext = (req as any).authContext;
      const companyId = normalizeTenantId(authContext?.companyId);
      if (!companyId) throw appError(401, 'NO_COMPANY_CONTEXT', 'Current company is required.');

      const { id } = req.params as any;
      const existing = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
      if (!existing) return reply.status(404).send({ error: 'User not found.' });
      if (normalizeTenantId(existing.companyId) && normalizeTenantId(existing.companyId) !== companyId) {
        throw appError(404, 'USER_OUTSIDE_COMPANY', 'User not found.');
      }

      await db.delete(schema.userBranchAccess).where(eq(schema.userBranchAccess.userId, id)).run();
      await db.delete(schema.userCompanyAccess).where(eq(schema.userCompanyAccess.userId, id)).run();
      await db.delete(schema.users).where(eq(schema.users.id, id)).run();
      await auditLogger.log({
        userId: String((req as any).authContext?.userId || 'system'),
        operationType: 'users.delete',
        affectedItems: [{ userId: id }],
        oldValues: sanitizeUser(existing, companyId),
      });

      return { success: true };
    } catch (e: any) {
      if (isAppError(e)) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code, details: e.details });
      }
      return reply.status(500).send({ error: e.message });
    }
  });
}
