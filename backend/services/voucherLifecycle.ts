import { appError } from '../lib/errors';
import { buildCompensationAppError, runCriticalCompensation } from '../lib/compensation';
import { SYSTEM_EVENT_TYPES } from '../lib/systemEvents';

const normalizeVoucherType = (value: any) => {
  const raw = String(value || 'receipt').toLowerCase();
  if (raw === 'payment') return 'payment';
  if (raw === 'receipt') return 'receipt';
  return raw;
};

export const createVoucherLifecycleService = (ctx: any) => {
  const {
    BASE_CURRENCY,
    db,
    schema,
    sql,
    eq,
    roundMoney,
    shouldApplyPartyLedgerForVoucher,
    computePartyDelta,
    applyPartyTransaction,
    ledgerIdForRef,
    deletePartyTransactionByRef,
    recomputePartyBalance,
    reverseJournalEntry,
    createVoucherWithAccounting,
    auditLogger,
    systemEventLogger,
  } = ctx;

  const restoreVoucherInTransaction = (voucher: any) => db.transaction(async (tx: any) => {
    await restoreVoucherEffectsTx(tx, voucher);
  });

  const buildSuccessCompensationDetails = (primaryError: any, compensation: any, voucherId: string) => ({
    main_error_code: String(primaryError?.code || 'UNKNOWN_PRIMARY_ERROR'),
    compensation_status: compensation.status,
    requires_manual_review: false,
    affected_document_type: 'voucher',
    affected_document_id: voucherId,
    compensation: compensation.steps,
  });

  const buildManualReviewError = (code: string, message: string, primaryError: any, compensation: any, voucherId: string) =>
    buildCompensationAppError({
      statusCode: 500,
      code,
      message,
      primaryError,
      compensation,
      affectedDocumentType: 'voucher',
      affectedDocumentId: voucherId,
    });

  const removeVoucherEffectsTx = async (tx: any, voucher: any) => {
    const amount = roundMoney(Number(voucher.amountBase ?? voucher.amount ?? 0));
    const type = normalizeVoucherType(voucher.type);
    const isCashMove = type === 'payment' || type === 'receipt';

    if (voucher.cashBoxId && isCashMove) {
      const box = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, voucher.cashBoxId)).get();
      if (!box) throw new Error('CASH_BOX_NOT_FOUND_FOR_VOUCHER_ROLLBACK');
      const delta = type === 'payment' ? -amount : amount;
      await tx.update(schema.cashBoxes)
        .set({ balance: Number(box.balance || 0) - delta })
        .where(eq(schema.cashBoxes.id, box.id))
        .run();
    }

    if (voucher.clientId && isCashMove) {
      const party = await tx.select().from(schema.parties).where(eq(schema.parties.id, voucher.clientId)).get();
      const ledgerRow = await tx.select({
        sum: sql<number>`coalesce(sum(${schema.partyTransactions.delta}), 0)`,
        cnt: sql<number>`count(*)`,
      }).from(schema.partyTransactions).where(eq(schema.partyTransactions.refId, String(voucher.id))).get();
      const ledgerCount = Number(ledgerRow?.cnt || 0);
      if (ledgerCount > 0) {
        await deletePartyTransactionByRef(tx, String(voucher.id));
        if (party) await recomputePartyBalance(tx, party.id);
      } else if (party && await shouldApplyPartyLedgerForVoucher(tx, voucher, isCashMove)) {
        const partyDelta = computePartyDelta({
          partyType: party.type,
          event: type === 'receipt' ? 'receipt' : 'payment',
          paymentTerm: 'cash',
          totalOrAmount: amount,
        });
        if (partyDelta !== 0) {
          await tx.update(schema.parties)
            .set({ balance: sql`${schema.parties.balance} - ${partyDelta}` })
            .where(eq(schema.parties.id, party.id))
            .run();
        }
      }
    } else {
      await deletePartyTransactionByRef(tx, String(voucher.id));
    }

    await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, String(voucher.id))).run();
  };

  const restoreVoucherEffectsTx = async (tx: any, voucher: any) => {
    await tx.insert(schema.vouchers).values(voucher).run();

    const amount = roundMoney(Number(voucher.amountBase ?? voucher.amount ?? 0));
    const type = normalizeVoucherType(voucher.type);
    const isCashMove = type === 'payment' || type === 'receipt';

    if (voucher.cashBoxId && isCashMove) {
      const box = await tx.select().from(schema.cashBoxes).where(eq(schema.cashBoxes.id, voucher.cashBoxId)).get();
      if (!box) throw new Error('CASH_BOX_NOT_FOUND_FOR_VOUCHER_RESTORE');
      const delta = type === 'payment' ? -amount : amount;
      await tx.update(schema.cashBoxes)
        .set({ balance: Number(box.balance || 0) + delta })
        .where(eq(schema.cashBoxes.id, box.id))
        .run();
    }

    if (voucher.clientId && isCashMove && await shouldApplyPartyLedgerForVoucher(tx, voucher, isCashMove)) {
      const party = await tx.select().from(schema.parties).where(eq(schema.parties.id, voucher.clientId)).get();
      if (party) {
        const partyDelta = computePartyDelta({
          partyType: party.type,
          event: type === 'receipt' ? 'receipt' : 'payment',
          paymentTerm: 'cash',
          totalOrAmount: amount,
        });
        if (partyDelta !== 0) {
          await applyPartyTransaction(tx, {
            id: ledgerIdForRef(String(voucher.id)),
            companyId: voucher.companyId || party.companyId || null,
            branchId: voucher.branchId || null,
            partyId: party.id,
            partyType: party.type,
            kind: type === 'receipt' ? 'voucher_receipt' : 'voucher_payment',
            refId: String(voucher.id),
            amount,
            amountBase: amount,
            amountTransaction: Number(voucher.amountTransaction ?? voucher.originalAmount ?? amount),
            delta: partyDelta,
            deltaBase: partyDelta,
            deltaTransaction: String(voucher.currency || BASE_CURRENCY).toUpperCase() === BASE_CURRENCY
              ? partyDelta
              : roundMoney(partyDelta * Number(voucher.exchangeRate || 1)),
            currency: voucher.currency || BASE_CURRENCY,
            exchangeRate: Number(voucher.exchangeRate || 1),
            createdAt: voucher.createdAt || new Date().toISOString(),
          });
        }
      }
    }
  };

  const deleteVoucher = async (
    id: string,
    auditContext?: any,
    options?: { skipAudit?: boolean; reason?: string }
  ) => {
    const voucher = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get();
    if (!voucher) {
      throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found.');
    }

    await db.transaction(async (tx: any) => {
      await removeVoucherEffectsTx(tx, voucher);
    });

    const jeId = Number((voucher as any).journalEntryId || 0);
    if (jeId > 0) {
      try {
        await reverseJournalEntry(jeId, options?.reason || 'حذف سند');
      } catch (error: any) {
        const compensation = await runCriticalCompensation({
          operationType: 'voucher.delete',
          userId: String(auditContext?.userId || 'system'),
          affectedDocumentType: 'voucher',
          affectedDocumentId: id,
          primaryError: error,
          auditLogger,
          systemEventLogger,
          steps: [{
            key: 'original_restore',
            forceKey: 'voucher.original_restore',
            failureCode: 'VOUCHER_ORIGINAL_RESTORE_FAILED',
            run: () => restoreVoucherInTransaction(voucher),
          }],
        });
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.CRITICAL_OPERATION_FAILED,
          severity: compensation.requiresManualReview ? 'critical' : 'error',
          sourceModule: 'vouchers',
          action: 'delete',
          status: compensation.requiresManualReview ? 'partial' : 'failed',
          errorCode: compensation.requiresManualReview ? 'VOUCHER_DELETE_COMPENSATION_FAILED' : 'VOUCHER_REVERSE_FAILED',
          requiresManualReview: compensation.requiresManualReview,
          affectedDocumentType: 'voucher',
          affectedDocumentId: id,
          compensationStatus: compensation,
          metadata: {
            message: error?.message || 'Failed to reverse voucher journal entry.',
          },
        });
        if (compensation.requiresManualReview) {
          throw buildManualReviewError(
            'VOUCHER_DELETE_COMPENSATION_FAILED',
            'Voucher delete failed and restoration requires manual review.',
            error,
            compensation,
            id
          );
        }
        throw appError(
          500,
          'VOUCHER_REVERSE_FAILED',
          error?.message || 'Failed to reverse voucher journal entry.',
          buildSuccessCompensationDetails(error, compensation, id)
        );
      }
    }

    if (!options?.skipAudit) {
      await auditLogger.log({
        userId: String(auditContext?.userId || 'system'),
        operationType: 'voucher.delete',
        affectedItems: [{ voucherId: id }],
        oldValues: voucher,
      });
    }

    return { success: true };
  };

  const updateVoucher = async (id: string, patch: any, auditContext?: any) => {
    const existing = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id)).get();
    if (!existing) {
      throw appError(404, 'VOUCHER_NOT_FOUND', 'Voucher not found.');
    }
    if (String(existing.status || 'DRAFT').toUpperCase() === 'POSTED') {
      throw appError(409, 'POSTED_VOUCHER_EDIT_BLOCKED', 'لا يمكن تعديل سند مرحّل. استخدم العكس/الإلغاء حسب الصلاحيات.');
    }

    const nextPayload = {
      ...existing,
      ...(patch || {}),
      id,
      journalEntryId: null,
      status: 'DRAFT',
      createdAt: existing.createdAt || new Date().toISOString(),
    };
    const hasAmountPatch =
      patch?.amount !== undefined
      || patch?.amountBase !== undefined
      || patch?.amountTransaction !== undefined
      || patch?.originalAmount !== undefined;
    if (hasAmountPatch) {
      const patchedBaseAmount = Number(patch?.amountBase ?? patch?.amount ?? existing.amountBase ?? existing.amount ?? 0);
      const patchedTransactionAmount = Number(
        patch?.amountTransaction
        ?? patch?.originalAmount
        ?? patch?.amount
        ?? patch?.amountBase
        ?? existing.amountTransaction
        ?? existing.originalAmount
        ?? existing.amount
        ?? 0
      );
      nextPayload.amount = patchedBaseAmount;
      nextPayload.amountBase = patchedBaseAmount;
      nextPayload.amountTransaction = patchedTransactionAmount;
      nextPayload.originalAmount = patchedTransactionAmount;
    }

    await db.transaction(async (tx: any) => {
      await removeVoucherEffectsTx(tx, existing);
    });

    try {
      await createVoucherWithAccounting(nextPayload);
    } catch (error: any) {
      const compensation = await runCriticalCompensation({
        operationType: 'voucher.update',
        userId: String(auditContext?.userId || 'system'),
        affectedDocumentType: 'voucher',
        affectedDocumentId: id,
        primaryError: error,
        auditLogger,
        systemEventLogger,
        steps: [{
          key: 'original_restore',
          forceKey: 'voucher.original_restore',
          failureCode: 'VOUCHER_ORIGINAL_RESTORE_FAILED',
          run: () => restoreVoucherInTransaction(existing),
        }],
      });
      await systemEventLogger?.log({
        eventType: SYSTEM_EVENT_TYPES.VOUCHER_UPDATE,
        severity: compensation.requiresManualReview ? 'critical' : 'error',
        sourceModule: 'vouchers',
        action: 'update',
        status: compensation.requiresManualReview ? 'partial' : 'failed',
        errorCode: compensation.requiresManualReview ? 'VOUCHER_UPDATE_COMPENSATION_FAILED' : 'VOUCHER_UPDATE_REPLACEMENT_FAILED',
        requiresManualReview: compensation.requiresManualReview,
        affectedDocumentType: 'voucher',
        affectedDocumentId: id,
        compensationStatus: compensation,
        metadata: {
          stage: 'replacement',
          message: error?.message || 'Failed to recreate voucher safely.',
        },
      });
      if (compensation.requiresManualReview) {
        throw buildManualReviewError(
          'VOUCHER_UPDATE_COMPENSATION_FAILED',
          'Voucher update failed and original voucher restoration requires manual review.',
          error,
          compensation,
          id
        );
      }
      throw appError(
        500,
        'VOUCHER_UPDATE_REPLACEMENT_FAILED',
        error?.message || 'Failed to recreate voucher safely.',
        buildSuccessCompensationDetails(error, compensation, id)
      );
    }

    const oldJeId = Number((existing as any).journalEntryId || 0);
    if (oldJeId > 0) {
      try {
        await reverseJournalEntry(oldJeId, 'تحديث سند');
      } catch (error: any) {
        const compensation = await runCriticalCompensation({
          operationType: 'voucher.update',
          userId: String(auditContext?.userId || 'system'),
          affectedDocumentType: 'voucher',
          affectedDocumentId: id,
          primaryError: error,
          auditLogger,
          systemEventLogger,
          steps: [
            {
              key: 'new_voucher_cleanup',
              forceKey: 'voucher.new_voucher_cleanup',
              failureCode: 'VOUCHER_NEW_CLEANUP_FAILED',
              run: () => deleteVoucher(id, auditContext, {
                skipAudit: true,
                reason: 'تعويض فشل تحديث سند',
              }),
            },
            {
              key: 'original_restore',
              forceKey: 'voucher.original_restore',
              failureCode: 'VOUCHER_ORIGINAL_RESTORE_FAILED',
              run: () => restoreVoucherInTransaction(existing),
            },
          ],
        });
        await systemEventLogger?.log({
          eventType: SYSTEM_EVENT_TYPES.VOUCHER_UPDATE,
          severity: compensation.requiresManualReview ? 'critical' : 'error',
          sourceModule: 'vouchers',
          action: 'update',
          status: compensation.requiresManualReview ? 'partial' : 'failed',
          errorCode: compensation.requiresManualReview ? 'VOUCHER_UPDATE_COMPENSATION_FAILED' : 'VOUCHER_UPDATE_REVERSE_FAILED',
          requiresManualReview: compensation.requiresManualReview,
          affectedDocumentType: 'voucher',
          affectedDocumentId: id,
          compensationStatus: compensation,
          metadata: {
            stage: 'reverse_original',
            message: error?.message || 'Failed to reverse original voucher journal entry.',
          },
        });
        if (compensation.requiresManualReview) {
          throw buildManualReviewError(
            'VOUCHER_UPDATE_COMPENSATION_FAILED',
            'Voucher update compensation is incomplete and requires manual review.',
            error,
            compensation,
            id
          );
        }
        throw appError(
          500,
          'VOUCHER_UPDATE_REVERSE_FAILED',
          error?.message || 'Failed to reverse original voucher journal entry.',
          buildSuccessCompensationDetails(error, compensation, id)
        );
      }
    }

    await auditLogger.log({
      userId: String(auditContext?.userId || 'system'),
      operationType: 'voucher.update',
      affectedItems: [{ voucherId: id }],
      oldValues: existing,
      newValues: nextPayload,
    });

    await systemEventLogger?.log({
      eventType: SYSTEM_EVENT_TYPES.VOUCHER_UPDATE,
      severity: 'info',
      sourceModule: 'vouchers',
      action: 'update',
      status: 'success',
      affectedDocumentType: 'voucher',
      affectedDocumentId: id,
      metadata: {
        amount: nextPayload.amountBase ?? nextPayload.amount ?? null,
        type: nextPayload.type || null,
      },
    });

    return { success: true, id };
  };

  return {
    createVoucher: (payload: any) => createVoucherWithAccounting(payload),
    updateVoucher,
    deleteVoucher,
  };
};
