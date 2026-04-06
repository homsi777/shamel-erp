import { eq } from 'drizzle-orm';
import { db, closeDb, getResolvedDbPath } from '../backend/db';
import * as schema from '../backend/db/schema';
import { createJournalEntry, postJournalEntry } from '../backend/accountingService';
import { ACCOUNTING_LABELS, buildDescription } from '../backend/accounting-labels';
import { buildInvoiceJournalLines, server } from '../backend/server';

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const invoiceIdArg = args.find((entry) => entry.startsWith('--invoiceId='))?.slice('--invoiceId='.length).trim() || '';

const main = async () => {
  const invoices = await db.select().from(schema.invoices).all();
  const candidates = (invoices || []).filter((invoice: any) => {
    if (String(invoice.type || '').toLowerCase() !== 'opening_stock') return false;
    if (invoiceIdArg && String(invoice.id || '') !== invoiceIdArg) return false;
    return !Number(invoice.journalEntryId || 0);
  });

  const summary = {
    ok: true,
    dryRun,
    dbPath: getResolvedDbPath(),
    scanned: candidates.length,
    repaired: 0,
    skipped: 0,
    failures: [] as Array<{ invoiceId: string; error: string }>,
  };

  for (const invoice of candidates) {
    try {
      const lines = await buildInvoiceJournalLines(invoice);
      if (lines.length === 0) {
        summary.skipped += 1;
        continue;
      }

      if (!dryRun) {
        const entry = await createJournalEntry({
          description: buildDescription(ACCOUNTING_LABELS.OPENING_STOCK, ACCOUNTING_LABELS.NUMBER, invoice.invoiceNumber),
          referenceType: 'invoice',
          referenceId: null,
          lines,
          currencyCode: invoice.currency || 'USD',
        });
        await postJournalEntry(entry.id);
        await db.update(schema.invoices)
          .set({ journalEntryId: entry.id })
          .where(eq(schema.invoices.id, invoice.id))
          .run();
      }

      summary.repaired += 1;
    } catch (error: any) {
      summary.failures.push({
        invoiceId: String(invoice.id || ''),
        error: error?.message || 'UNKNOWN',
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
};

try {
  await main();
} finally {
  try { await server.close(); } catch {}
  try { closeDb(); } catch {}
}
