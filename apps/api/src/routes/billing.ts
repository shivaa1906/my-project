import { Router, Request, Response } from 'express';
import {
  getOrganizationBalance,
  getUsageLedger,
  topupCredit,
} from '@voice-saas/billing';
import { TopupSchema } from '@voice-saas/shared';
import { recordAuditLog } from '../middleware/audit.js';

export const billingRouter = Router();

// Get balance & recent ledger history
billingRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const balance = await getOrganizationBalance(ctx.organizationId);
    const ledger = await getUsageLedger(ctx.organizationId, 50);

    res.json({
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      balanceCreditInr: balance,
      ledger,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Topup organization credit
billingRouter.post('/topup', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = TopupSchema.parse(req.body);

    const result = await topupCredit(
      ctx.organizationId,
      parsed.amount_inr,
      parsed.payment_reference
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'topup_credit',
      'organization_balance',
      ctx.organizationId,
      { amountInr: parsed.amount_inr, paymentRef: parsed.payment_reference }
    );

    res.json({
      success: true,
      newBalanceInr: result.newBalanceInr,
      idempotencyKey: result.idempotencyKey,
      message: `Successfully topped up ₹${parsed.amount_inr.toFixed(2)}`,
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});
