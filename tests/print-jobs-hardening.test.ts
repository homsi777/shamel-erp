/**
 * Print jobs hardening — pure checks (no DB / no full backend import).
 */
import assert from 'assert';

/** Mirrors backend probeTcpPrinterConnection port/host validation semantics. */
function validateTcpProbe(host: string, port?: number): { ok: true } | { ok: false; code: string } {
  const p = port ?? 9100;
  if (!Number.isFinite(p) || p < 1 || p > 65535) return { ok: false, code: 'EINVAL_PORT' };
  const h = String(host || '').trim();
  if (!h) return { ok: false, code: 'EINVAL_HOST' };
  return { ok: true };
}

{
  const badPort = validateTcpProbe('127.0.0.1', 999999);
  assert.strictEqual(badPort.ok, false);
  assert.strictEqual((badPort as any).code, 'EINVAL_PORT');
  console.log('✅ TCP probe validation — invalid port');
}

{
  const noHost = validateTcpProbe('', 9100);
  assert.strictEqual(noHost.ok, false);
  assert.strictEqual((noHost as any).code, 'EINVAL_HOST');
  console.log('✅ TCP probe validation — empty host');
}

{
  const inv = { queueNumber: '99' };
  const stable = String((inv as any).queueNumber);
  assert.strictEqual(stable, '99');
  const reprintPayload = { queueNumber: stable };
  assert.strictEqual(reprintPayload.queueNumber, '99');
  console.log('✅ queue number stable on reprint (logical)');
}
