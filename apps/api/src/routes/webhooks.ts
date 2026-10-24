import { Router, Request, Response } from 'express';
import { query } from '@voice-saas/database';
import { getVoiceProvider } from '@voice-saas/provider-adapters';
import { reconcileAndSettleCall } from '@voice-saas/billing';

export const webhooksRouter = Router();

// Provider Webhook Endpoint (No tenant context middleware needed here as it comes from provider)
webhooksRouter.post('/voice', async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const providerName = (req.headers['x-provider'] as string) || 'mock';
    const provider = getVoiceProvider(providerName);

    // 1. Verify Webhook Signature / Authenticity
    const isValid = await provider.verifyWebhook(
      req.headers as Record<string, string | undefined>,
      rawBody
    );

    if (!isValid) {
      res.status(401).json({ error: 'Invalid provider webhook signature' });
      return;
    }

    const payload = req.body;
    const idempotencyKey =
      (req.headers['x-idempotency-key'] as string) ||
      payload.event_id ||
      payload.idempotency_key ||
      `evt-${payload.provider_call_id}-${payload.event_type}-${payload.duration_seconds || 0}`;

    // 2. Webhook Deduplication: Check if already processed
    const existingDelivery = await query(
      `SELECT id, status FROM webhook_deliveries WHERE provider = $1 AND idempotency_key = $2`,
      [providerName, idempotencyKey]
    );

    if (existingDelivery.rows.length > 0) {
      // Duplicate event safely acknowledged without duplicate charges
      res.status(200).json({
        status: 'duplicate_ignored',
        message: 'Webhook event was already processed previously (idempotent)',
      });
      return;
    }

    // 3. Record raw webhook delivery
    await query(
      `INSERT INTO webhook_deliveries (provider, event_type, idempotency_key, raw_payload, status)
       VALUES ($1, $2, $3, $4, 'processed')`,
      [providerName, payload.event_type || 'call.completed', idempotencyKey, rawBody]
    );

    // 4. Normalize event
    const normalized = provider.parseWebhookEvent(payload);

    // 5. Look up matching call
    const callRes = await query(
      `SELECT id, organization_id, status FROM calls WHERE provider_call_id = $1`,
      [normalized.providerCallId]
    );

    if (callRes.rows.length === 0) {
      // Call not found in DB
      res.status(200).json({ status: 'call_not_found', providerCallId: normalized.providerCallId });
      return;
    }

    const call = callRes.rows[0];

    // 6. Record call lifecycle event
    await query(
      `INSERT INTO call_events (call_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [call.id, normalized.eventType, JSON.stringify(payload)]
    );

    // If call completion event with duration, reconcile and settle billing ledger
    if (normalized.eventType === 'call.ended' || normalized.eventType === 'call.completed') {
      const settlement = await reconcileAndSettleCall(
        call.organization_id,
        call.id,
        normalized.durationSeconds || 0,
        idempotencyKey
      );

      res.status(200).json({
        status: 'settled',
        callId: call.id,
        settlement,
      });
      return;
    }

    res.status(200).json({ status: 'acknowledged', eventType: normalized.eventType });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
});
