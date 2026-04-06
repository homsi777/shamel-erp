
declare module 'thermal-printer-cordova-plugin/src' {
  export interface PrinterInfo {
    name?: string;
    address?: string;
    deviceId?: string;
  }
  export interface ThermalPrinterPlugin {
    requestBTPermissions?: (
      opts: { type: 'bluetooth' },
      ok: (res: any) => void,
      err: (e: any) => void
    ) => void;

    requestPermissions?: (
      opts: { type: 'bluetooth' | 'usb' | 'tcp'; id?: string | number; address?: string; port?: number },
      ok: (res: any) => void,
      err: (e: any) => void
    ) => void;

    listPrinters(
      opts: { type: 'bluetooth' | 'usb' },
      ok: (res: PrinterInfo[]) => void,
      err: (e: any) => void
    ): void;

    printFormattedText(
      opts: {
        type: 'bluetooth' | 'tcp' | 'usb';
        id: string;
        text: string;
        address?: string;
        port?: number;
        mmFeedPaper?: number;
        dotsFeedPaper?: number;
        printerDpi?: number;
        printerWidthMM?: number;
        printerNbrCharactersPerLine?: number;
        charsetEncoding?: { charsetName?: string; charsetId?: number };
      },
      ok: () => void,
      err: (e: any) => void
    ): void;

    printFormattedTextAndCut?: (
      opts: {
        type: 'bluetooth' | 'tcp' | 'usb';
        id: string;
        text: string;
        address?: string;
        port?: number;
        mmFeedPaper?: number;
        dotsFeedPaper?: number;
        printerDpi?: number;
        printerWidthMM?: number;
        printerNbrCharactersPerLine?: number;
        charsetEncoding?: { charsetName?: string; charsetId?: number };
      },
      ok: () => void,
      err: (e: any) => void
    ) => void;

    printText?: (
      opts: {
        type: 'bluetooth' | 'tcp' | 'usb';
        id: string;
        text: string;
        address?: string;
        port?: number;
        mmFeedPaper?: number;
        dotsFeedPaper?: number;
        printerDpi?: number;
        printerWidthMM?: number;
        printerNbrCharactersPerLine?: number;
        charsetEncoding?: { charsetName?: string; charsetId?: number };
      },
      ok: () => void,
      err: (e: any) => void
    ) => void;
  }
}
