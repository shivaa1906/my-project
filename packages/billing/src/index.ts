import { query, transaction } from '@voice-saas/database';

export const RATE_PER_MINUTE_INR = 3.50; // Sarvam-aligned base rate ₹3.50 / conversation minute
export const DEFAULT_RESERVE_MINUTES = 3; // Conservative 3-minute reserve = ₹10.50

export class InsufficientCreditError extends Error {
  constructor(public currentBalance: number, public requiredAmount: number) {
    super(`Insufficient credit balance. Current: ₹${currentBalance.toFixed(2)}, Required: ₹${requiredAmount.toFixed(2)}`);
    this.name = 'InsufficientCreditError';
  }
}

export interface ReservationResult {
  reservedAmountInr: number;
  newBalanceInr: number;
  idempotencyKey: string;
}

export interface SettlementResult {
  callId: string;
  actualDurationSeconds: number;
  billableMinutes: number;
  actualCostInr: number;
  reservedAmountInr: number;
  netAdjustmentInr: number;
  newBalanceInr: number;
  alreadySettled: boolean;
}

/**
 * Transactional credit reservation before starting an authorized call.
 * Uses SELECT ... FOR UPDATE to prevent race conditions & overspending.
 */
export async function reserveCreditForCall(
  organizationId: string,
  callId: string,
  estimatedMinutes: number = DEFAULT_RESERVE_MINUTES
): Promise<ReservationResult> {
  const reserveAmountInr = Number((estimatedMinutes * RATE_PER_MINUTE_INR).toFixed(2));
  const idempotencyKey = `reserve-call-${callId}`;

  return await transaction(async (client) => {
    // 1. Check if reservation already exists for this call (idempotent)
    const existingLedger = await client.query(
      `SELECT amount_inr, balance_after_inr FROM usage_ledger WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existingLedger.rows.length > 0) {
      return {
        reservedAmountInr: Number(existingLedger.rows[0].amount_inr),
        newBalanceInr: Number(existingLedger.rows[0].balance_after_inr),
        idempotencyKey,
      };
    }

    // 2. Lock organization balance row
    const orgRes = await client.query(
      `SELECT balance_credit_inr FROM organizations WHERE id = $1 FOR UPDATE`,
      [organizationId]
    );

    if (orgRes.rows.length === 0) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const currentBalance = Number(orgRes.rows[0].balance_credit_inr);
    if (currentBalance < reserveAmountInr) {
      throw new InsufficientCreditError(currentBalance, reserveAmountInr);
    }

    const newBalance = Number((currentBalance - reserveAmountInr).toFixed(2));

    // 3. Update organization balance
    await client.query(
      `UPDATE organizations SET balance_credit_inr = $1 WHERE id = $2`,
      [newBalance, organizationId]
    );

    // 4. Record immutable usage ledger entry
    await client.query(
      `INSERT INTO usage_ledger (
        organization_id, call_id, transaction_type, amount_inr,
        balance_after_inr, idempotency_key, description
      ) VALUES ($1, $2, 'RESERVE', $3, $4, $5, $6)`,
      [
        organizationId,
        callId,
        -reserveAmountInr,
        newBalance,
        idempotencyKey,
        `Pre-call reservation for call ${callId} (${estimatedMinutes} min @ ₹${RATE_PER_MINUTE_INR}/min)`,
      ]
    );

    return {
      reservedAmountInr: reserveAmountInr,
      newBalanceInr: newBalance,
      idempotencyKey,
    };
  });
}

/**
 * Reconciles provider completion event with immutable usage ledger.
 * Releases unused reservation or charges remaining minutes.
 * Protected by idempotency key against duplicate webhook delivery.
 */
export async function reconcileAndSettleCall(
  organizationId: string,
  callId: string,
  actualDurationSeconds: number,
  webhookIdempotencyKey: string
): Promise<SettlementResult> {
  const settleIdempotencyKey = `settle-call-${callId}-${webhookIdempotencyKey}`;

  // Calculate billable minutes and actual cost
  let billableMinutes = 0;
  if (actualDurationSeconds > 0) {
    billableMinutes = Math.ceil(actualDurationSeconds / 60);
  }
  const actualCostInr = Number((billableMinutes * RATE_PER_MINUTE_INR).toFixed(2));

  return await transaction(async (client) => {
    // 1. Idempotency check: has this settlement already processed?
    const existingSettlement = await client.query(
      `SELECT amount_inr, balance_after_inr FROM usage_ledger WHERE idempotency_key = $1`,
      [settleIdempotencyKey]
    );

    if (existingSettlement.rows.length > 0) {
      return {
        callId,
        actualDurationSeconds,
        billableMinutes,
        actualCostInr,
        reservedAmountInr: 0,
        netAdjustmentInr: 0,
        newBalanceInr: Number(existingSettlement.rows[0].balance_after_inr),
        alreadySettled: true,
      };
    }

    // 2. Lock organization balance row
    const orgRes = await client.query(
      `SELECT balance_credit_inr FROM organizations WHERE id = $1 FOR UPDATE`,
      [organizationId]
    );

    if (orgRes.rows.length === 0) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const currentBalance = Number(orgRes.rows[0].balance_credit_inr);

    // 3. Find original reservation
    const reserveIdempotencyKey = `reserve-call-${callId}`;
    const reserveRes = await client.query(
      `SELECT amount_inr FROM usage_ledger WHERE idempotency_key = $1`,
      [reserveIdempotencyKey]
    );

    let reservedAmountInr = 0;
    if (reserveRes.rows.length > 0) {
      // amount_inr was recorded as negative in ledger (-reserveAmountInr)
      reservedAmountInr = Math.abs(Number(reserveRes.rows[0].amount_inr));
    }

    // netAdjustment = reservedAmount - actualCost
    // If we reserved ₹10.50 and actual was ₹3.50, we credit back ₹7.00 (+7.00)
    // If we reserved ₹10.50 and actual was ₹14.00, we deduct extra ₹3.50 (-3.50)
    const netAdjustmentInr = Number((reservedAmountInr - actualCostInr).toFixed(2));
    const newBalance = Number((currentBalance + netAdjustmentInr).toFixed(2));

    // 4. Update organization balance
    await client.query(
      `UPDATE organizations SET balance_credit_inr = $1 WHERE id = $2`,
      [newBalance, organizationId]
    );

    // 5. Insert SETTLE ledger entry
    await client.query(
      `INSERT INTO usage_ledger (
        organization_id, call_id, transaction_type, amount_inr,
        balance_after_inr, idempotency_key, description
      ) VALUES ($1, $2, 'SETTLE', $3, $4, $5, $6)`,
      [
        organizationId,
        callId,
        netAdjustmentInr,
        newBalance,
        settleIdempotencyKey,
        `Call reconciliation: ${actualDurationSeconds}s (${billableMinutes} billable mins @ ₹${RATE_PER_MINUTE_INR}/min = ₹${actualCostInr}). Reserved: ₹${reservedAmountInr}. Net adjustment: ₹${netAdjustmentInr}`,
      ]
    );

    // 6. Update call record with final duration, billable minutes, cost and status
    await client.query(
      `UPDATE calls
       SET duration_seconds = $1, billable_minutes = $2, cost_inr = $3, status = 'completed', ended_at = NOW()
       WHERE id = $4`,
      [actualDurationSeconds, billableMinutes, actualCostInr, callId]
    );

    return {
      callId,
      actualDurationSeconds,
      billableMinutes,
      actualCostInr,
      reservedAmountInr,
      netAdjustmentInr,
      newBalanceInr: newBalance,
      alreadySettled: false,
    };
  });
}

/**
 * Top up organization balance
 */
export async function topupCredit(
  organizationId: string,
  amountInr: number,
  paymentReference: string
): Promise<{ newBalanceInr: number; idempotencyKey: string }> {
  if (amountInr <= 0) {
    throw new Error('Topup amount must be greater than zero');
  }

  const idempotencyKey = `topup-${paymentReference}`;

  return await transaction(async (client) => {
    // Check idempotency
    const existing = await client.query(
      `SELECT balance_after_inr FROM usage_ledger WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existing.rows.length > 0) {
      return {
        newBalanceInr: Number(existing.rows[0].balance_after_inr),
        idempotencyKey,
      };
    }

    const orgRes = await client.query(
      `SELECT balance_credit_inr FROM organizations WHERE id = $1 FOR UPDATE`,
      [organizationId]
    );

    if (orgRes.rows.length === 0) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    const currentBalance = Number(orgRes.rows[0].balance_credit_inr);
    const newBalance = Number((currentBalance + amountInr).toFixed(2));

    await client.query(
      `UPDATE organizations SET balance_credit_inr = $1 WHERE id = $2`,
      [newBalance, organizationId]
    );

    await client.query(
      `INSERT INTO usage_ledger (
        organization_id, transaction_type, amount_inr,
        balance_after_inr, idempotency_key, description
      ) VALUES ($1, 'TOPUP', $2, $3, $4, $5)`,
      [
        organizationId,
        amountInr,
        newBalance,
        idempotencyKey,
        `Balance top-up via reference ${paymentReference}`,
      ]
    );

    return {
      newBalanceInr: newBalance,
      idempotencyKey,
    };
  });
}

/**
 * Retrieve current balance for an organization
 */
export async function getOrganizationBalance(organizationId: string): Promise<number> {
  const res = await query(
    `SELECT balance_credit_inr FROM organizations WHERE id = $1`,
    [organizationId]
  );
  if (res.rows.length === 0) {
    throw new Error(`Organization ${organizationId} not found`);
  }
  return Number(res.rows[0].balance_credit_inr);
}

/**
 * Retrieve usage ledger history for an organization
 */
export async function getUsageLedger(organizationId: string, limit: number = 50) {
  const res = await query(
    `SELECT id, organization_id, call_id, transaction_type, amount_inr,
            balance_after_inr, idempotency_key, description, created_at
     FROM usage_ledger
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [organizationId, limit]
  );
  return res.rows.map((row) => ({
    ...row,
    amount_inr: Number(row.amount_inr),
    balance_after_inr: Number(row.balance_after_inr),
  }));
}
