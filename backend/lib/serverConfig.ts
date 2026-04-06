import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { getDatabaseStateDir, getResolvedDbPath } from '../db';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().trim().optional(),
  ERP_STRICT_MODE: z.string().optional(),
  ACTIVATION_NOTIFY_BOT_TOKEN: z.string().trim().optional(),
  ACTIVATION_NOTIFY_CHAT_ID: z.string().trim().optional(),
  ACTIVATION_CONNECTIVITY_URL: z.string().trim().optional(),
});

export type SecretStrength = 'strong' | 'weak' | 'dev_generated';

export type ServerConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  jwtSecret: string;
  isProduction: boolean;
  strictMode: boolean;
  usedDevelopmentSecret: boolean;
  secretStrength: SecretStrength;
  activationNotifyBotToken: string | null;
  activationNotifyChatId: string | null;
  activationConnectivityUrl: string;
};

const DEV_SECRET_FILE = '.dev-jwt-secret';
const resolveEnvFiles = () => {
  const profile = String(process.env.SHAMEL_ENV_PROFILE || process.env.APP_ENV_PROFILE || '').trim().toLowerCase();
  if (!profile) return ['.env', '.env.local'];
  return [`.env.${profile}`, `.env.${profile}.local`, '.env', '.env.local'];
};

const parseEnvFile = (content: string) => {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s+#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    values[key] = value.replace(/\\n/g, '\n');
  }
  return values;
};

const loadEnvFromFiles = () => {
  const merged: Record<string, string> = {};

  for (const relativePath of resolveEnvFiles()) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(fullPath)) continue;
    Object.assign(merged, parseEnvFile(fs.readFileSync(fullPath, 'utf8')));
  }

  for (const [key, value] of Object.entries(merged)) {
    if (typeof process.env[key] === 'undefined') {
      process.env[key] = value;
    }
  }

  return merged;
};

const ensureDevSecret = () => {
  const dbPath = getResolvedDbPath();
  const baseDir = getDatabaseStateDir();
  const secretPath = path.join(baseDir, DEV_SECRET_FILE);
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
    const seed = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretPath, seed, 'utf8');
    return seed;
  } catch {
    return crypto
      .createHash('sha256')
      .update(`${dbPath}:${process.cwd()}:shamel-dev-jwt`)
      .digest('hex');
  }
};

const fileEnv = loadEnvFromFiles();
const parsedEnv = envSchema.parse({ ...fileEnv, ...process.env });
const isProduction = parsedEnv.NODE_ENV === 'production';
const providedSecret = parsedEnv.JWT_SECRET?.trim();

if (isProduction && !providedSecret) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production.');
}

const KNOWN_WEAK_SECRETS = new Set([
  'secret', 'changeme', 'password', '12345', 'jwt_secret', 'your_jwt_secret',
  'development', 'test', 'dev', 'shamel', 'shamel-erp', 'default',
]);

const evaluateSecretStrength = (secret: string | undefined): SecretStrength => {
  if (!secret) return 'dev_generated';
  const lower = secret.trim().toLowerCase();
  if (KNOWN_WEAK_SECRETS.has(lower)) return 'weak';
  if (secret.length < 32) return 'weak';
  return 'strong';
};

const jwtSecret = providedSecret || ensureDevSecret();
const usedDevelopmentSecret = !providedSecret;
const secretStrength: SecretStrength = usedDevelopmentSecret ? 'dev_generated' : evaluateSecretStrength(providedSecret);

if (isProduction && secretStrength !== 'strong') {
  throw new Error(`JWT_SECRET is too weak for production. Use a random string of at least 32 characters. Current strength: ${secretStrength}`);
}

export const serverConfig: ServerConfig = {
  nodeEnv: parsedEnv.NODE_ENV,
  jwtSecret,
  isProduction,
  strictMode: parsedEnv.ERP_STRICT_MODE === 'true' || parsedEnv.ERP_STRICT_MODE === '1' || isProduction,
  usedDevelopmentSecret,
  secretStrength,
  activationNotifyBotToken: parsedEnv.ACTIVATION_NOTIFY_BOT_TOKEN?.trim() || null,
  activationNotifyChatId: parsedEnv.ACTIVATION_NOTIFY_CHAT_ID?.trim() || null,
  activationConnectivityUrl: parsedEnv.ACTIVATION_CONNECTIVITY_URL?.trim() || 'https://api.telegram.org',
};

export const getServerConfigSummary = () => ({
  nodeEnv: serverConfig.nodeEnv,
  isProduction: serverConfig.isProduction,
  strictMode: serverConfig.strictMode,
  usedDevelopmentSecret: serverConfig.usedDevelopmentSecret,
  secretStrength: serverConfig.secretStrength,
  activationNotificationsConfigured: Boolean(serverConfig.activationNotifyBotToken && serverConfig.activationNotifyChatId),
  requiredEnvVars: ['JWT_SECRET'],
  optionalEnvVars: ['ACTIVATION_NOTIFY_BOT_TOKEN', 'ACTIVATION_NOTIFY_CHAT_ID', 'ACTIVATION_CONNECTIVITY_URL'],
});
