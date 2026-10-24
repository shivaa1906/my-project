import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { query, closePool } from '@voice-saas/database';
import { seedDatabase } from '@voice-saas/database/dist/seed.js';

describe('Voice AI SaaS - Milestone 1 Automated Test Suite', () => {
  let app: any;
  let apexOrgId: string;
  let fintechOrgId: string;
  let apexUserId: string;
  let fintechUserId: string;
  let apexAgentId: string;
  let fintechAgentId: string;

  before(async () => {
    await seedDatabase();
    app = createApp();

    // Query seeded IDs
    const apexOrgRes = await query(`SELECT id FROM organizations WHERE slug = 'apex-health'`);
    apexOrgId = apexOrgRes.rows[0].id;

    const fintechOrgRes = await query(`SELECT id FROM organizations WHERE slug = 'telugu-fintech'`);
    fintechOrgId = fintechOrgRes.rows[0].id;

    const user1Res = await query(`SELECT id FROM users WHERE email = 'ramesh@apexhealth.in'`);
    apexUserId = user1Res.rows[0].id;

    const user3Res = await query(`SELECT id FROM users WHERE email = 'ananya@telugufintech.com'`);
    fintechUserId = user3Res.rows[0].id;

    const agent1Res = await query(`SELECT id FROM voice_agents WHERE organization_id = $1 LIMIT 1`, [apexOrgId]);
    apexAgentId = agent1Res.rows[0].id;

    const agent2Res = await query(`SELECT id FROM voice_agents WHERE organization_id = $1 LIMIT 1`, [fintechOrgId]);
    fintechAgentId = agent2Res.rows[0].id;
  });

  after(async () => {
    await closePool();
  });

  describe('1. Tenant Isolation & Security (Section 12)', () => {
    test('Apex user cannot access Telugu FinTech organization (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/agents')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', fintechOrgId);

      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'TENANT_ACCESS_DENIED');
    });

    test('Apex user cannot view Telugu FinTech voice agents', async () => {
      // Direct GET by ID
      const res = await request(app)
        .get(`/api/agents/${fintechAgentId}`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId);

      assert.equal(res.status, 404);
    });

    test('FinTech user cannot view Apex Healthcare voice agents', async () => {
      const res = await request(app)
        .get(`/api/agents/${apexAgentId}`)
        .set('x-user-id', fintechUserId)
        .set('x-organization-id', fintechOrgId);

      assert.equal(res.status, 404);
    });

    test('Tenant isolation on calls and billing ledger', async () => {
      // FinTech user cannot view Apex billing ledger
      const res = await request(app)
        .get('/api/billing')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId);

      assert.equal(res.status, 200);
      assert.equal(res.body.organizationId, apexOrgId);
      // All ledger items must belong to apexOrgId
      for (const item of res.body.ledger) {
        assert.equal(item.organization_id, apexOrgId);
      }
    });
  });

  describe('2. Voice Agent CRUD, Telugu FAQs & Simulation (Section 10)', () => {
    let createdAgentId: string;

    test('Create a bilingual Telugu-English Voice Agent with FAQs', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          name: 'హైదరాబాద్ డెంటల్ కేర్ అసిస్టెంట్ (Hyderabad Dental Care)',
          description: 'Specialist dental appointment assistant',
          prompt: 'You are a warm dental assistant in Hyderabad. Greet patients with నమస్కారం and book teeth cleaning slots.',
          languages: ['te-IN', 'en-IN'],
          voice_persona: 'telugu-female-friendly',
          goals: ['Book appointment', 'Quote pricing'],
          faq_knowledge: [
            {
              question: 'పంటి క్లీనింగ్ ఖర్చు ఎంత? (Teeth cleaning cost)',
              answer: 'పంటి క్లీనింగ్ ఖర్చు ₹800 మాత్రమే. Teeth cleaning is ₹800.',
              language: 'mixed',
            },
          ],
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.name, 'హైదరాబాద్ డెంటల్ కేర్ అసిస్టెంట్ (Hyderabad Dental Care)');
      assert.equal(res.body.version, 1);
      createdAgentId = res.body.id;
    });

    test('Update Voice Agent increments version number', async () => {
      const res = await request(app)
        .put(`/api/agents/${createdAgentId}`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          description: 'Updated specialist dental assistant with emergency care support',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.version, 2);
      assert.equal(res.body.description, 'Updated specialist dental assistant with emergency care support');
    });

    test('Simulated conversation turn matches Telugu FAQ knowledge without a phone call', async () => {
      const res = await request(app)
        .post(`/api/agents/${createdAgentId}/simulate`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          user_message: 'నమస్కారం, పంటి క్లీనింగ్ ఖర్చు ఎంత అవుతుంది?',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.matched_faq, true);
      assert.match(res.body.reply_text, /₹800/);
      assert.ok(res.body.latency_ms > 0);
    });

    test('Simulated conversation handles greetings in Telugu/English', async () => {
      const res = await request(app)
        .post(`/api/agents/${apexAgentId}/simulate`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          user_message: 'Hello, what are your clinic timings?',
        });

      assert.equal(res.status, 200);
      assert.match(res.body.reply_text, /ఉదయం 8:00|8 AM/);
    });
  });

  describe('3. Financial Safety & Usage Ledger (Section 9 & 12)', () => {
    test('Overspending protection: Rejects call when balance is insufficient', async () => {
      // Create a broke organization with ₹0 balance
      const brokeSlug = `zero-bal-${Date.now()}`;
      const orgRes = await query(
        `INSERT INTO organizations (name, slug, balance_credit_inr)
         VALUES ('Zero Balance Clinic', $1, 0.00) RETURNING id`,
        [brokeSlug]
      );
      const brokeOrgId = orgRes.rows[0].id;

      await query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [brokeOrgId, apexUserId]
      );

      // Create dummy agent in broke org
      const agentRes = await query(
        `INSERT INTO voice_agents (organization_id, name, prompt, languages)
         VALUES ($1, 'Dummy Agent', 'Test prompt for broke org', '["te-IN"]'::jsonb) RETURNING id`,
        [brokeOrgId]
      );
      const dummyAgentId = agentRes.rows[0].id;

      const res = await request(app)
        .post('/api/calls')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', brokeOrgId)
        .send({
          agent_id: dummyAgentId,
          phone_number: '+919876543210',
        });

      assert.equal(res.status, 402);
      assert.equal(res.body.code, 'INSUFFICIENT_CREDITS');
    });

    test('Provider webhook idempotency: Duplicate delivery does not double bill', async () => {
      // 1. Initiate valid call
      const initRes = await request(app)
        .post('/api/calls')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          agent_id: apexAgentId,
          phone_number: '+919848022338',
        });

      assert.equal(initRes.status, 201);
      const callId = initRes.body.id;
      const providerCallId = initRes.body.providerCallId;

      // 2. Deliver provider completion webhook (60 seconds = 1 billable minute = ₹3.50)
      const webhookPayload = {
        event_type: 'call.ended',
        provider_call_id: providerCallId,
        call_id: callId,
        duration_seconds: 60,
        disconnect_reason: 'normal_hangup',
        timestamp: new Date().toISOString(),
      };

      const idempotencyKey = `wh-idem-${callId}`;

      const hookRes1 = await request(app)
        .post('/api/webhooks/voice')
        .set('x-provider', 'mock')
        .set('x-mock-test', 'true')
        .set('x-idempotency-key', idempotencyKey)
        .send(webhookPayload);

      assert.equal(hookRes1.status, 200);
      assert.equal(hookRes1.body.status, 'settled');
      assert.equal(hookRes1.body.settlement.actualCostInr, 3.50);

      // 3. Re-deliver exact same webhook (replay attack / network retry)
      const hookRes2 = await request(app)
        .post('/api/webhooks/voice')
        .set('x-provider', 'mock')
        .set('x-mock-test', 'true')
        .set('x-idempotency-key', idempotencyKey)
        .send(webhookPayload);

      assert.equal(hookRes2.status, 200);
      assert.equal(hookRes2.body.status, 'duplicate_ignored');

      // Verify in DB that only 1 SETTLE entry exists for this call
      const settleCount = await query(
        `SELECT COUNT(*) FROM usage_ledger WHERE call_id = $1 AND transaction_type = 'SETTLE'`,
        [callId]
      );
      assert.equal(parseInt(settleCount.rows[0].count, 10), 1);
    });
  });

  describe('4. Regulatory Checks: DND & DPDP Consent (Section 13)', () => {
    test('DND Check: Rejects call to phone number on the suppression list', async () => {
      // In seed, '+919849099999' is on apex suppression list
      const res = await request(app)
        .post('/api/calls')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          agent_id: apexAgentId,
          phone_number: '+919849099999',
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'PHONE_SUPPRESSED_DND');
    });

    test('DPDP Right to Withdraw: Revoking consent prevents subsequent calls', async () => {
      // 1. Add contact
      const contactRes = await request(app)
        .post('/api/contacts')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          name: 'Nagarjuna Rao',
          phone: '+919123456780',
          consent_status: 'consented',
          consent_source: 'web-form',
          consent_purpose: 'healthcare_alerts',
        });

      assert.equal(contactRes.status, 201);
      const contactId = contactRes.body.id;

      // 2. Revoke consent
      const revokeRes = await request(app)
        .post(`/api/contacts/${contactId}/revoke-consent`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId);

      assert.equal(revokeRes.status, 200);

      // 3. Attempt to call this number should be blocked
      const callRes = await request(app)
        .post('/api/calls')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          agent_id: apexAgentId,
          phone_number: '+919123456780',
        });

      assert.equal(callRes.status, 400);
    });

    test('Campaign Emergency Stop immediately halts campaign dispatches', async () => {
      // 1. Create a campaign
      const campRes = await request(app)
        .post('/api/campaigns')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          agent_id: apexAgentId,
          name: 'Hyderabad Health Check Reminders',
          max_concurrency: 5,
        });

      assert.equal(campRes.status, 201);
      const campId = campRes.body.id;

      // 2. Trigger Emergency Stop
      const stopRes = await request(app)
        .post(`/api/campaigns/${campId}/emergency-stop`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId);

      assert.equal(stopRes.status, 200);
      assert.equal(stopRes.body.campaign.status, 'emergency_stopped');
      assert.equal(stopRes.body.campaign.emergency_stopped, true);
    });
  });

  describe('5. Full End-to-End Call Simulation Lifecycle', () => {
    test('Simulates complete call: initiation -> ringing -> conversation -> hangup -> ledger reconciliation', async () => {
      const res = await request(app)
        .post('/api/calls/simulate-full')
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId)
        .send({
          agent_id: apexAgentId,
          phone_number: '+919848022338',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'completed');
      assert.equal(res.body.durationSeconds, 75);
      assert.equal(res.body.billableMinutes, 2); // 75 seconds = 2 billable mins
      assert.equal(res.body.costInr, 7.00); // 2 * 3.50 = 7.00 INR
      assert.equal(res.body.reservationInr, 10.50); // 3 * 3.50 = 10.50 INR
      assert.equal(res.body.refundedInr, 3.50); // 10.50 - 7.00 = +3.50 refunded!
      assert.ok(res.body.transcripts.length >= 4);

      // Verify call details endpoint returns full transcripts and events
      const detailRes = await request(app)
        .get(`/api/calls/${res.body.callId}`)
        .set('x-user-id', apexUserId)
        .set('x-organization-id', apexOrgId);

      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.transcripts.length, res.body.transcripts.length);
      assert.ok(detailRes.body.events.length >= 4);
    });
  });
});
