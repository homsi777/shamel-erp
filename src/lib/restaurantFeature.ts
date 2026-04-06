/**
 * Restaurant module visibility (sidebar, routes, reports hooks).
 *
 * Default: **enabled** for every activation type (محلي، تجريبي، سحابي، فرع) so pilot/dev can run without extra env wiring.
 * To hide after rollout: set `VITE_RESTAURANT_MODULE_ENABLED=false` (also accepts `0`, `no`, `off`).
 */
const parseEnvBool = (raw: string | undefined): boolean | null => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return null;
};

export const isRestaurantModuleEnabled = (): boolean => {
  try {
    const parsed = parseEnvBool(import.meta.env.VITE_RESTAURANT_MODULE_ENABLED);
    if (parsed !== null) return parsed;
    return true;
  } catch {
    return true;
  }
};
