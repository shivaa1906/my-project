import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query, transaction } from '@voice-saas/database';
import { StartCallSchema } from '@voice-saas/shared';
import { getVoiceProvider } from '@voice-saas/provider-adapters';
import {
  reserveCreditForCall,
  reconcileAndSettleCall,
  InsufficientCreditError,
  RATE_PER_MINUTE_INR,
} from '@voice-saas/billing';
import { recordAuditLog } from '../middleware/audit.js';

export const callsRouter = Router();

// List calls for current organization
callsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await query(
      `SELECT c.id, c.organization_id, c.agent_id, c.phone_number, c.provider_call_id,
              c.provider, c.status, c.duration_seconds, c.billable_minutes, c.cost_inr,
              c.outcome, c.recording_url, c.initiated_at, c.ended_at, c.created_at,
              a.name as agent_name, a.voice_persona
       FROM calls c
       LEFT JOIN voice_agents a ON a.id = c.agent_id
       WHERE c.organization_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [ctx.organizationId, limit, offset]
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        cost_inr: Number(row.cost_inr),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get call details with events, transcripts and ledger
callsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const callRes = await query(
      `SELECT c.*, a.name as agent_name, a.voice_persona, a.prompt as agent_prompt
       FROM calls c
       LEFT JOIN voice_agents a ON a.id = c.agent_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (callRes.rows.length === 0) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const call = {
      ...callRes.rows[0],
      cost_inr: Number(callRes.rows[0].cost_inr),
    };

    // Fetch call events
    const eventsRes = await query(
      `SELECT id, event_type, payload, timestamp
       FROM call_events
       WHERE call_id = $1
       ORDER BY timestamp ASC`,
      [call.id]
    );

    // Fetch transcripts
    const transcriptsRes = await query(
      `SELECT id, speaker, text, language, latency_ms, timestamp
       FROM transcripts
       WHERE call_id = $1
       ORDER BY timestamp ASC`,
      [call.id]
    );

    // Fetch ledger entries for this call
    const ledgerRes = await query(
      `SELECT id, transaction_type, amount_inr, balance_after_inr, idempotency_key, description, created_at
       FROM usage_ledger
       WHERE call_id = $1
       ORDER BY created_at ASC`,
      [call.id]
    );

    res.json({
      ...call,
      events: eventsRes.rows,
      transcripts: transcriptsRes.rows,
      ledger: ledgerRes.rows.map((l) => ({
        ...l,
        amount_inr: Number(l.amount_inr),
        balance_after_inr: Number(l.balance_after_inr),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Initiate an authorized voice call
callsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = StartCallSchema.parse(req.body);

    // 1. Check Voice Agent exists in this tenant
    const agentRes = await query(
      `SELECT * FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [parsed.agent_id, ctx.organizationId]
    );

    if (agentRes.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found in your organization' });
      return;
    }
    const agent = agentRes.rows[0];

    // 2. Regulatory Compliance Check: Check Suppression List (DND)
    const suppressionRes = await query(
      `SELECT reason FROM suppression_list WHERE organization_id = $1 AND phone = $2`,
      [ctx.organizationId, parsed.phone_number]
    );

    if (suppressionRes.rows.length > 0) {
      res.status(400).json({
        error: `Cannot initiate call: Phone number is on the Do Not Call / Suppression list (${suppressionRes.rows[0].reason}).`,
        code: 'PHONE_SUPPRESSED_DND',
      });
      return;
    }

    // 3. DPDP Compliance Check: If contact exists, verify consent is not revoked
    const contactRes = await query(
      `SELECT id, consent_status FROM contacts WHERE organization_id = $1 AND phone = $2`,
      [ctx.organizationId, parsed.phone_number]
    );

    if (contactRes.rows.length > 0 && contactRes.rows[0].consent_status === 'revoked') {
      res.status(400).json({
        error: 'Cannot initiate call: Contact has revoked consent under DPDP regulations.',
        code: 'CONSENT_REVOKED',
      });
      return;
    }

    const contactId = contactRes.rows[0]?.id || parsed.contact_id || null;
    const callId = crypto.randomUUID();

    // 4. Record initial call in database before ledger reservation (satisfies FK constraint)
    await query(
      `INSERT INTO calls (
        id, organization_id, agent_id, contact_id, campaign_id,
        phone_number, provider_call_id, provider, status, cost_inr
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, 'initiated', 0.00)`,
      [
        callId,
        ctx.organizationId,
        agent.id,
        contactId,
        parsed.campaign_id || null,
        parsed.phone_number,
        agent.provider || 'mock',
      ]
    );

    // 5. Financial Safety: Reserve credit transactionally
    let reservation;
    try {
      reservation = await reserveCreditForCall(ctx.organizationId, callId, 3);
    } catch (err) {
      // Remove or mark call failed if insufficient credit
      await query(`DELETE FROM calls WHERE id = $1`, [callId]);
      if (err instanceof InsufficientCreditError) {
        res.status(402).json({
          error: err.message,
          code: 'INSUFFICIENT_CREDITS',
          currentBalance: err.currentBalance,
          requiredAmount: err.requiredAmount,
        });
        return;
      }
      throw err;
    }

    // 6. Invoke Provider Adapter
    const provider = getVoiceProvider(agent.provider || 'mock');
    const callRef = await provider.startCall({
      callId,
      organizationId: ctx.organizationId,
      phoneNumber: parsed.phone_number,
      agentPrompt: agent.prompt,
      languages: agent.languages,
      voicePersona: agent.voice_persona,
      faqKnowledge: agent.faq_knowledge,
    });

    // 7. Update provider_call_id
    await query(`UPDATE calls SET provider_call_id = $1 WHERE id = $2`, [callRef.providerCallId, callId]);

    // 8. Record call event
    await query(
      `INSERT INTO call_events (call_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [callId, 'call.initiated', JSON.stringify({ providerCallId: callRef.providerCallId })]
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'initiate_call',
      'call',
      callId,
      { phoneNumber: parsed.phone_number, agentId: agent.id }
    );

    res.status(201).json({
      id: callId,
      providerCallId: callRef.providerCallId,
      status: 'initiated',
      reservedCreditInr: reservation.reservedAmountInr,
      remainingBalanceInr: reservation.newBalanceInr,
      message: 'Call initiated and credit reserved successfully',
    });
  } catch (err: any) {
    console.error('Error in POST /api/calls:', err);
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// End an ongoing call
callsRouter.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const durationSeconds = parseInt(req.body.duration_seconds || '60', 10);

    const callRes = await query(
      `SELECT * FROM calls WHERE id = $1 AND organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (callRes.rows.length === 0) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const call = callRes.rows[0];
    const provider = getVoiceProvider(call.provider);
    await provider.endCall(call.provider_call_id);

    // Reconcile and settle billing ledger
    const settlement = await reconcileAndSettleCall(
      ctx.organizationId,
      call.id,
      durationSeconds,
      `manual-end-${Date.now()}`
    );

    // Record call event
    await query(
      `INSERT INTO call_events (call_id, event_type, payload)
       VALUES ($1, 'call.ended', $2)`,
      [call.id, JSON.stringify({ durationSeconds, settlement })]
    );

    res.json({
      callId: call.id,
      status: 'completed',
      durationSeconds,
      settlement,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Full simulated call lifecycle for local prototyping & demonstration
callsRouter.post('/simulate-full', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = StartCallSchema.parse(req.body);

    const agentRes = await query(
      `SELECT * FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [parsed.agent_id, ctx.organizationId]
    );

    if (agentRes.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found' });
      return;
    }
    const agent = agentRes.rows[0];

    // Compliance check DND
    const suppressionRes = await query(
      `SELECT reason FROM suppression_list WHERE organization_id = $1 AND phone = $2`,
      [ctx.organizationId, parsed.phone_number]
    );
    if (suppressionRes.rows.length > 0) {
      res.status(400).json({
        error: `Cannot initiate call: Phone number is on the Do Not Call suppression list.`,
        code: 'PHONE_SUPPRESSED_DND',
      });
      return;
    }

    const callId = crypto.randomUUID();

    // 1. Create Call record in DB before reservation
    await query(
      `INSERT INTO calls (
        id, organization_id, agent_id, phone_number, provider_call_id,
        provider, status, outcome
      ) VALUES ($1, $2, $3, $4, 'pending', 'mock', 'initiated', 'simulated_success')`,
      [callId, ctx.organizationId, agent.id, parsed.phone_number]
    );

    // 2. Reserve credit
    let reservation;
    try {
      reservation = await reserveCreditForCall(ctx.organizationId, callId, 3);
    } catch (err) {
      await query(`DELETE FROM calls WHERE id = $1`, [callId]);
      if (err instanceof InsufficientCreditError) {
        res.status(402).json({
          error: err.message,
          code: 'INSUFFICIENT_CREDITS',
          currentBalance: err.currentBalance,
        });
        return;
      }
      throw err;
    }

    const provider = getVoiceProvider('mock');
    const callRef = await provider.startCall({
      callId,
      organizationId: ctx.organizationId,
      phoneNumber: parsed.phone_number,
      agentPrompt: agent.prompt,
      languages: agent.languages,
    });

    await query(`UPDATE calls SET provider_call_id = $1 WHERE id = $2`, [callRef.providerCallId, callId]);

    // Lifecycle events
    await query(
      `INSERT INTO call_events (call_id, event_type, payload) VALUES
       ($1, 'call.initiated', '{"stage":"initiated"}'),
       ($1, 'call.ringing', '{"network":"Airtel-Hyderabad","latency_ms":120}'),
       ($1, 'call.answered', '{"status":"connected"}')`,
      [callId]
    );

    // Generate dialogue script
    const script = provider.generateFullSimulatedCallScript({
      agentPrompt: agent.prompt,
      faqKnowledge: agent.faq_knowledge,
      callerName: 'వెంకటేష్ (Venkatesh)',
    });

    // Insert transcripts
    for (const turn of script) {
      await query(
        `INSERT INTO transcripts (call_id, speaker, text, language, latency_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [callId, turn.speaker, turn.text, turn.language, turn.latencyMs]
      );
    }

    // Call duration: 75 seconds (2 billable minutes @ ₹3.50 = ₹7.00)
    const simulatedDurationSeconds = 75;
    const webhookKey = `sim-hook-${callId}`;

    const settlement = await reconcileAndSettleCall(
      ctx.organizationId,
      callId,
      simulatedDurationSeconds,
      webhookKey
    );

    await query(
      `INSERT INTO call_events (call_id, event_type, payload)
       VALUES ($1, 'call.ended', $2)`,
      [callId, JSON.stringify({ reason: 'normal_hangup', duration: simulatedDurationSeconds })]
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'simulated_full_call',
      'call',
      callId,
      { phoneNumber: parsed.phone_number, costInr: settlement.actualCostInr }
    );

    res.status(201).json({
      callId,
      providerCallId: callRef.providerCallId,
      status: 'completed',
      durationSeconds: simulatedDurationSeconds,
      billableMinutes: settlement.billableMinutes,
      costInr: settlement.actualCostInr,
      reservationInr: settlement.reservedAmountInr,
      refundedInr: settlement.netAdjustmentInr,
      finalBalanceInr: settlement.newBalanceInr,
      transcripts: script,
      message: 'Full simulated call completed, transcripts generated, and ledger settled successfully!',
    });
  } catch (err: any) {
    console.error('Error in POST /api/calls:', err);
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});
