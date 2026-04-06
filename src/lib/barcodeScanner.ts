import { Capacitor } from '@capacitor/core';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

export function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function scanBarcodeOnce(): Promise<string | null> {
  if (!isAndroidNative()) return null;

  try {
    await BarcodeScanner.requestPermissions();
    const result = await BarcodeScanner.scan();
    const value = result?.barcodes?.[0]?.rawValue;
    return value ? String(value) : null;
  } catch (error) {
    console.error('Barcode scan failed', error);
    return null;
  }
}
