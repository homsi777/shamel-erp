/**
 * POS silent print helpers — unit tests
 */
import assert from 'assert';
import { parseNetworkPrinterAddress } from '../src/lib/printEngine';

{
  const a = parseNetworkPrinterAddress('192.168.0.10');
  assert.strictEqual(a?.host, '192.168.0.10');
  assert.strictEqual(a?.port, 9100);
  console.log('✅ parseNetworkPrinterAddress — IP without port');
}

{
  const a = parseNetworkPrinterAddress('10.0.0.5:9101');
  assert.strictEqual(a?.host, '10.0.0.5');
  assert.strictEqual(a?.port, 9101);
  console.log('✅ parseNetworkPrinterAddress — IP:port');
}

{
  const a = parseNetworkPrinterAddress('[fc00::1]:9100');
  assert.strictEqual(a?.host, 'fc00::1');
  assert.strictEqual(a?.port, 9100);
  console.log('✅ parseNetworkPrinterAddress — bracketed IPv6');
}
