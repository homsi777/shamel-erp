import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { createPartySubAccount } from '../accountingService';

type PartyRow = any;

const normalizeText = (value: unknown) => String(value ?? '').trim();

const normalizeNumericId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const requiresReceivable = (type: string) => ['CUSTOMER', 'BOTH'].includes(type);
const requiresPayable = (type: string) => ['SUPPLIER', 'BOTH'].includes(type);

export async function ensurePartyAccountLinks(
  db: any,
  partyOrId: string | PartyRow,
  companyIdOverride?: string | null,
): Promise<PartyRow> {
  const party = typeof partyOrId === 'string'
    ? await db.select().from(schema.parties).where(eq(schema.parties.id, partyOrId)).get()
    : partyOrId;
  if (!party) throw new Error('PARTY_NOT_FOUND_FOR_ACCOUNT_ENFORCEMENT');

  const normalizedType = normalizeText((party as any).type).toUpperCase() || 'CUSTOMER';
  const companyId = normalizeText(companyIdOverride || (party as any).companyId);
  if (!companyId) throw new Error('PARTY_COMPANY_ID_REQUIRED');

  let accountId = normalizeNumericId((party as any).accountId);
  let arAccountId = normalizeNumericId((party as any).arAccountId);
  let apAccountId = normalizeNumericId((party as any).apAccountId);
  let changed = false;

  if (requiresReceivable(normalizedType) && !arAccountId) {
    arAccountId = await createPartySubAccount(db, String((party as any).name || ''), 'customer', String((party as any).id || ''), companyId);
    changed = true;
  }
  if (requiresPayable(normalizedType) && !apAccountId) {
    apAccountId = await createPartySubAccount(db, String((party as any).name || ''), 'supplier', String((party as any).id || ''), companyId);
    changed = true;
  }

  if (!accountId) {
    accountId = arAccountId || apAccountId || null;
    if (accountId) changed = true;
  }

  if (requiresReceivable(normalizedType) && !arAccountId) {
    throw new Error('PARTY_RECEIVABLE_ACCOUNT_REQUIRED');
  }
  if (requiresPayable(normalizedType) && !apAccountId) {
    throw new Error('PARTY_PAYABLE_ACCOUNT_REQUIRED');
  }
  if (!accountId) {
    throw new Error('PARTY_ACCOUNT_ID_REQUIRED');
  }

  if (changed) {
    await db.update(schema.parties).set({
      accountId,
      arAccountId: arAccountId ? String(arAccountId) : null,
      apAccountId: apAccountId ? String(apAccountId) : null,
    }).where(eq(schema.parties.id, String((party as any).id || ''))).run();
  }

  const refreshed = await db.select().from(schema.parties).where(
    and(
      eq(schema.parties.id, String((party as any).id || '')),
      eq(schema.parties.companyId, companyId),
    ),
  ).get();
  if (!refreshed) throw new Error('PARTY_NOT_FOUND_AFTER_ACCOUNT_ENFORCEMENT');
  return refreshed;
}

export async function requirePartyAccountId(
  db: any,
  partyOrId: string | PartyRow,
  role: 'receivable' | 'payable',
  companyIdOverride?: string | null,
): Promise<number> {
  const party = await ensurePartyAccountLinks(db, partyOrId, companyIdOverride);
  const accountId = role === 'receivable'
    ? normalizeNumericId((party as any).arAccountId) || normalizeNumericId((party as any).accountId)
    : normalizeNumericId((party as any).apAccountId) || normalizeNumericId((party as any).accountId);
  if (!accountId) {
    throw new Error(role === 'receivable' ? 'PARTY_RECEIVABLE_ACCOUNT_REQUIRED' : 'PARTY_PAYABLE_ACCOUNT_REQUIRED');
  }
  return accountId;
}

export async function ensureAllPartyAccountLinks(
  db: any,
  options?: { companyId?: string | null },
): Promise<{ scanned: number; fixed: number; failed: Array<{ partyId: string; error: string }> }> {
  const companyId = normalizeText(options?.companyId);
  const parties = companyId
    ? await db.select().from(schema.parties).where(eq(schema.parties.companyId, companyId)).all()
    : await db.select().from(schema.parties).all();

  const result = {
    scanned: 0,
    fixed: 0,
    failed: [] as Array<{ partyId: string; error: string }>,
  };

  for (const party of parties) {
    result.scanned += 1;
    const beforeAccountId = normalizeNumericId((party as any).accountId);
    const beforeArAccountId = normalizeNumericId((party as any).arAccountId);
    const beforeApAccountId = normalizeNumericId((party as any).apAccountId);
    try {
      const enforced = await ensurePartyAccountLinks(db, party, companyId || normalizeText((party as any).companyId));
      const afterAccountId = normalizeNumericId((enforced as any).accountId);
      const afterArAccountId = normalizeNumericId((enforced as any).arAccountId);
      const afterApAccountId = normalizeNumericId((enforced as any).apAccountId);
      if (
        beforeAccountId !== afterAccountId
        || beforeArAccountId !== afterArAccountId
        || beforeApAccountId !== afterApAccountId
      ) {
        result.fixed += 1;
      }
    } catch (error: any) {
      result.failed.push({
        partyId: String((party as any).id || ''),
        error: String(error?.message || error || 'Unknown error'),
      });
    }
  }

  return result;
}
