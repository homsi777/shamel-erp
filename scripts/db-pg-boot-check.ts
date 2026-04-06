process.env.DB_DIALECT = process.env.DB_DIALECT || 'postgres';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:12345678@127.0.0.1:5432/shamel_erp_pg';
process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
process.env.QR_MENU_PORT = process.env.QR_MENU_PORT || '0';
process.env.SERVER_PORT = process.env.SERVER_PORT || '3111';

const main = async () => {
  const mod = await import('../backend/server.ts');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await mod.server.close();
  console.log('[db:pg:boot-check] server booted and closed cleanly');
};

main().catch((error) => {
  console.error('[db:pg:boot-check] failed:', error?.message || error);
  process.exit(1);
});
