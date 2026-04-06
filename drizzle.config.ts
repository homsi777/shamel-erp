
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './backend/db/schema.ts',
  out: './backend/drizzle',
  driver: 'better-sqlite',
  dbCredentials: {
    url: 'data/shamel.db',
  },
  verbose: true,
  strict: false,
} as any);
