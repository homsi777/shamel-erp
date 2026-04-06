import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './_common';

export default async function register(api: FastifyInstance, ctx: RouteContext) {
  const { db, schema, sql, eq, desc, and, TABLE_MAP, safeJsonParse, stringifyOrEmpty, loadZkService, shouldApplyPartyLedgerForVoucher, parseMultiCurrencyError, resolveSystemAccountId, buildInvoiceJournalLines, buildVoucherJournalLines, createVoucherWithAccounting, appendAudit, buildPartyStatement, getBackupDir, buildBackupPayload, ACCOUNTING_LABELS, buildDescription, applyPartyTransaction, createPartySubAccount, computePartyDelta, createJournalEntry, deletePartyTransactionByRef, getAccountBalance, getAccountStatement, getTrialBalance, ledgerIdForRef, normalizePaymentTerm, postJournalEntry, recomputePartyBalance, reverseJournalEntry, roundMoney, resolveAccountByCode, SYSTEM_ACCOUNTS, fs, path, getResolvedDbPath, closeDb, bcrypt, server, getLocalIp } = ctx as any;

api.post('/biometric/test-connection', async (req, reply) => {
    const payload = (req.body || {}) as any;
    const device = payload.device || payload;
    if (!device?.ip) return reply.status(400).send({ success: false, message: 'عنوان IP مطلوب.' });
    const zkService = await loadZkService();
    if (!zkService?.testConnectionNode) {
        return reply.status(500).send({ success: false, message: 'خدمة جهاز البصمة غير متوفرة.' });
    }
    try {
        return await zkService.testConnectionNode(device);
    } catch (e: any) {
        return reply.status(500).send({ success: false, message: e?.message || 'خطأ غير معروف.' });
    }
});


api.post('/biometric/sync', async (req, reply) => {
    const payload = (req.body || {}) as any;
    const deviceId = payload.deviceId || payload.device_id;
    let device = payload.device || null;
    if (!device && deviceId) {
        device = await db.select().from(schema.biometricDevices).where(eq(schema.biometricDevices.id, String(deviceId))).get();
    }
    if (!device?.ip) return reply.status(400).send({ success: false, message: 'بيانات الجهاز غير مكتملة.' });

    const zkService = await loadZkService();
    if (!zkService?.syncAttendanceNode) {
        return reply.status(500).send({ success: false, message: 'خدمة جهاز البصمة غير متوفرة.' });
    }

    const result = await zkService.syncAttendanceNode({ ip: device.ip, port: device.port || 4370 });
    if (!result?.success) return result;

    const employees = await db.select().from(schema.employees).all();
    const byBio = new Map<string, any>();
    for (const emp of employees) {
        const bio = String((emp as any).biometricId || (emp as any).biometric_id || '').trim();
        if (bio) byBio.set(bio, emp);
    }

    let inserted = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    await db.transaction(async (tx: any) => {
        for (const rec of result.data || []) {
            const biometricId = String(rec.user_id || '').trim();
            if (!biometricId) { skipped++; continue; }

            const exists = await tx.select().from(schema.attendanceRecords)
                .where(sql`${schema.attendanceRecords.biometricId} = ${biometricId} AND ${schema.attendanceRecords.timestamp} = ${rec.timestamp} AND ${schema.attendanceRecords.deviceIp} = ${device.ip}`)
                .get();
            if (exists) { skipped++; continue; }

            const emp = byBio.get(biometricId);
            await tx.insert(schema.attendanceRecords).values({
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                deviceId: device.id,
                deviceIp: device.ip,
                employeeId: emp?.id || null,
                employeeName: emp?.name || null,
                biometricId,
                timestamp: rec.timestamp,
                eventType: rec.eventType || null,
                source: 'zk',
                createdAt: now,
            }).run();
            inserted++;
        }
    });

    return {
        success: true,
        message: `تمت المزامنة: ${inserted} سجل جديد، ${skipped} مكرر.`,
        total: (result.data || []).length,
        inserted,
        skipped
    };
});


api.get('/biometric/attendance', async (req) => {
    const q = (req.query || {}) as any;
    const conditions: any[] = [];
    if (q.from) conditions.push(sql`${schema.attendanceRecords.timestamp} >= ${q.from}`);
    if (q.to) conditions.push(sql`${schema.attendanceRecords.timestamp} <= ${q.to}`);
    if (q.employeeId) conditions.push(eq(schema.attendanceRecords.employeeId, String(q.employeeId)));
    if (q.deviceId) conditions.push(eq(schema.attendanceRecords.deviceId, String(q.deviceId)));
    if (q.biometricId) conditions.push(eq(schema.attendanceRecords.biometricId, String(q.biometricId)));
    if (q.eventType) conditions.push(eq(schema.attendanceRecords.eventType, String(q.eventType)));

    let query = db.select().from(schema.attendanceRecords);
    if (conditions.length) query = query.where(and(...conditions));
    return await query.orderBy(desc(schema.attendanceRecords.timestamp)).all();
});
}
