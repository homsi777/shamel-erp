import http from 'http';
import { Client } from 'pg';
import { DEFAULT_DATABASE_URL, findLanIpv4 } from './_pgTools';

const SERVER_PORT = Number(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT || '3111');
const APP_BASE_URL = String(process.env.APP_BASE_URL || '').trim() || `http://${findLanIpv4()}:${SERVER_PORT}`;

const getJson = (url: string) =>
  new Promise<any>((resolve, reject) => {
    http.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode || 0, body: data ? JSON.parse(data) : null });
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });

const main = async () => {
  const db = new Client({ connectionString: DEFAULT_DATABASE_URL });
  await db.connect();
  try {
    const dbResult = await db.query('select current_database() as db, count(*)::int as invoices from invoices');
    const health = await getJson(`${APP_BASE_URL}/api/system/healthz`);
    const readiness = await getJson(`${APP_BASE_URL}/api/system/readiness`);
    const networkReady = await getJson(`${APP_BASE_URL}/api/restaurant/network-ready`);

    console.log(JSON.stringify({
      success: health.status === 200 && readiness.status === 200 && networkReady.status === 200,
      appBaseUrl: APP_BASE_URL,
      db: dbResult.rows[0] || {},
      health,
      readiness,
      networkReady,
    }, null, 2));
  } finally {
    await db.end();
  }
};

main().catch((error) => {
  console.error('[local-lan-readiness] failed:', error?.message || error);
  process.exit(1);
});
