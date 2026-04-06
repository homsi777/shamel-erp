/** Strict cashier request status transitions (operational QR batches). */

export type CashierRequestAction = 'seen' | 'accept' | 'reject' | 'archive';

export type RequestWorkflowStatus = 'new' | 'seen' | 'accepted' | 'rejected' | 'archived';

/**
 * Returns next status after action, or null if transition is not allowed.
 */
export function nextStatusForCashierAction(
  current: string,
  action: CashierRequestAction,
): RequestWorkflowStatus | null {
  const st = String(current || '');
  switch (action) {
    case 'seen':
      return st === 'new' ? 'seen' : null;
    case 'accept':
      return st === 'new' || st === 'seen' ? 'accepted' : null;
    case 'reject':
      return st === 'new' || st === 'seen' ? 'rejected' : null;
    case 'archive':
      return st === 'accepted' || st === 'rejected' ? 'archived' : null;
    default:
      return null;
  }
}
