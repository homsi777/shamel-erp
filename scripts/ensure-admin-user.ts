import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { closeDb, db, getResolvedDbPath } from '../backend/db';
import * as schema from '../backend/db/schema';
import { DEFAULT_BRANCH_ID, DEFAULT_COMPANY_ID } from '../backend/lib/tenantScope';

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

const username = String(getArg('--username') || 'admin').trim();
const password = String(getArg('--password') || 'admin123').trim();
const name = String(getArg('--name') || 'System Admin').trim();
const companyId = String(getArg('--companyId') || DEFAULT_COMPANY_ID).trim();
const branchId = String(getArg('--branchId') || DEFAULT_BRANCH_ID).trim();
const resetPassword = args.includes('--reset-password');

const main = async () => {
  if (!username || !password || !companyId || !branchId) {
    throw new Error('username, password, companyId, and branchId are required');
  }

  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!company) {
    throw new Error(`COMPANY_NOT_FOUND:${companyId}`);
  }

  const branch = await db.select().from(schema.branches).where(eq(schema.branches.id, branchId)).get();
  if (!branch) {
    throw new Error(`BRANCH_NOT_FOUND:${branchId}`);
  }
  if (String((branch as any).companyId || '') !== companyId) {
    throw new Error(`BRANCH_OUTSIDE_COMPANY:${branchId}`);
  }

  const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
  const existing = await db.select().from(schema.users).where(eq(schema.users.username, username)).get();

  if (existing) {
    const patch: Record<string, any> = {
      name: existing.name || name,
      companyId,
      defaultBranchId: branchId,
      branchScope: 'company_wide',
      role: existing.role || 'admin',
      permissions: existing.permissions || '*',
      isActive: true,
    };
    if (resetPassword) {
      patch.passwordHash = passwordHash;
    }
    await db.update(schema.users).set(patch).where(eq(schema.users.id, String(existing.id))).run();
    await db.delete(schema.userBranchAccess).where(eq(schema.userBranchAccess.userId, String(existing.id))).run();
    await db.insert(schema.userBranchAccess).values({
      id: `uba-${existing.id}-${branchId}`,
      userId: String(existing.id),
      branchId,
      isDefault: true,
      isActive: true,
    }).onConflictDoNothing().run();

    console.log(JSON.stringify({
      ok: true,
      action: 'updated',
      dbPath: getResolvedDbPath(),
      username,
      companyId,
      branchId,
      passwordReset: resetPassword,
    }, null, 2));
    return;
  }

  const id = `u-admin-${Date.now()}`;
  await db.insert(schema.users).values({
    id,
    username,
    passwordHash,
    name,
    role: 'admin',
    permissions: '*',
    companyId,
    defaultBranchId: branchId,
    branchScope: 'company_wide',
    isActive: true,
  }).run();

  await db.insert(schema.userBranchAccess).values({
    id: `uba-${id}-${branchId}`,
    userId: id,
    branchId,
    isDefault: true,
    isActive: true,
  }).onConflictDoNothing().run();

  console.log(JSON.stringify({
    ok: true,
    action: 'created',
    dbPath: getResolvedDbPath(),
    username,
    companyId,
    branchId,
    passwordReset: true,
  }, null, 2));
};

try {
  await main();
} catch (error: any) {
  console.error(JSON.stringify({
    ok: false,
    dbPath: getResolvedDbPath(),
    error: error?.message || 'UNKNOWN',
  }, null, 2));
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
}
