const BOOTSTRAP_ACTIVATION_CODES = [
  { code: 'TEST1', activationType: 'trial', licenseMission: 'TRIAL' },
  { code: 'TEST2', activationType: 'trial', licenseMission: 'TRIAL' },
  { code: 'TEST3', activationType: 'trial', licenseMission: 'TRIAL' },
  { code: 'TEST4', activationType: 'trial', licenseMission: 'TRIAL' },
  { code: 'TEST5', activationType: 'trial', licenseMission: 'TRIAL' },
  { code: 'ALM-7K3M-Q9X2', activationType: 'local', licenseMission: 'LOCAL_STANDALONE' },
  { code: 'ALM-HST-7K3M-Q9X2', activationType: 'local', licenseMission: 'LOCAL_NETWORK_HOST' },
  { code: 'ALM-TRM-6W2X-N7M4', activationType: 'local', licenseMission: 'LOCAL_NETWORK_TERMINAL' },
];

const SUPER_ADMIN_USERNAME = 'homsi700';
const SUPER_ADMIN_PASSWORD_HASH = '$2a$12$fCJkGBg83mnBs7gDeyJM6efjChIQkgjxM8qdmmzncTJoUMdpS9NBC';
const SUPER_ADMIN_DISPLAY_NAME = 'System Super Admin';
const SUPER_ADMIN_ID = 'sysadmin-bootstrap';

type PgQueryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount?: number | null }>;
};

export const ensureBootstrapFoundation = async (client: PgQueryable) => {
  let insertedCodes = 0;

  for (const row of BOOTSTRAP_ACTIVATION_CODES) {
    const result = await client.query(
      `
        insert into activation_codes (code, activation_type, license_mission)
        values ($1, $2, $3)
        on conflict (code) do nothing
      `,
      [row.code, row.activationType, row.licenseMission],
    );
    insertedCodes += Number(result.rowCount || 0);
  }

  const superAdminResult = await client.query(
    `
      insert into system_super_admins (id, username, password_hash, display_name, must_change_password, is_bootstrap)
      values ($1, $2, $3, $4, false, true)
      on conflict (username) do nothing
    `,
    [SUPER_ADMIN_ID, SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD_HASH, SUPER_ADMIN_DISPLAY_NAME],
  );

  return {
    insertedCodes,
    insertedSuperAdmin: Number(superAdminResult.rowCount || 0),
  };
};
