const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000;

type AttemptRecord = {
  failedCount: number;
  lockedUntil: number | null;
};

const loginAttempts = new Map<string, AttemptRecord>();

const normalizeKeyPart = (value: unknown) => String(value || '').trim().toLowerCase();

export const buildLoginAttemptKey = (username: string, companyId?: string | null) => {
  const normalizedUsername = normalizeKeyPart(username);
  const normalizedCompanyId = normalizeKeyPart(companyId || '__global__');
  return `${normalizedCompanyId}::${normalizedUsername}`;
};

export const getLoginAttemptPolicy = () => ({
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockoutWindowMs: LOCKOUT_WINDOW_MS,
});

export const getLoginAttemptStatus = (key: string, now = Date.now()) => {
  const record = loginAttempts.get(key);
  if (!record) {
    return {
      isLocked: false,
      failedCount: 0,
      remainingAttempts: MAX_FAILED_ATTEMPTS,
      remainingMs: 0,
    };
  }

  if (record.lockedUntil && record.lockedUntil > now) {
    return {
      isLocked: true,
      failedCount: record.failedCount,
      remainingAttempts: 0,
      remainingMs: record.lockedUntil - now,
    };
  }

  if (record.lockedUntil && record.lockedUntil <= now) {
    loginAttempts.delete(key);
    return {
      isLocked: false,
      failedCount: 0,
      remainingAttempts: MAX_FAILED_ATTEMPTS,
      remainingMs: 0,
    };
  }

  return {
    isLocked: false,
    failedCount: record.failedCount,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - record.failedCount),
    remainingMs: 0,
  };
};

export const recordFailedLoginAttempt = (key: string, now = Date.now()) => {
  const current = getLoginAttemptStatus(key, now);
  const nextFailedCount = current.failedCount + 1;
  const shouldLock = nextFailedCount >= MAX_FAILED_ATTEMPTS;
  const nextRecord: AttemptRecord = {
    failedCount: nextFailedCount,
    lockedUntil: shouldLock ? now + LOCKOUT_WINDOW_MS : null,
  };
  loginAttempts.set(key, nextRecord);

  return {
    isLocked: shouldLock,
    failedCount: nextFailedCount,
    remainingAttempts: shouldLock ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - nextFailedCount),
    remainingMs: shouldLock ? LOCKOUT_WINDOW_MS : 0,
    lockedUntil: nextRecord.lockedUntil,
  };
};

export const clearLoginAttemptState = (key: string) => {
  loginAttempts.delete(key);
};

export const resetLoginAttemptLimiterForTests = () => {
  loginAttempts.clear();
};
