import { Router, Request, Response } from 'express';
import { query } from '@voice-saas/database';
import { CreateAgentSchema, UpdateAgentSchema, SimulationTurnSchema } from '@voice-saas/shared';
import { getVoiceProvider } from '@voice-saas/provider-adapters';
import { recordAuditLog } from '../middleware/audit.js';

export const agentsRouter = Router();

// List agents for the current organization
agentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const result = await query(
      `SELECT id, organization_id, name, description, prompt, languages,
              provider, voice_persona, goals, faq_knowledge, fallback_text,
              version, created_at, updated_at
       FROM voice_agents
       WHERE organization_id = $1
       ORDER BY updated_at DESC`,
      [ctx.organizationId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create agent
agentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = CreateAgentSchema.parse(req.body);

    const providerAdapter = getVoiceProvider(parsed.provider);
    // Register agent with voice provider
    const providerRef = await providerAdapter.createAgent({
      name: parsed.name,
      prompt: parsed.prompt,
      languages: parsed.languages,
      voicePersona: parsed.voice_persona,
      faqKnowledge: parsed.faq_knowledge,
    });

    const result = await query(
      `INSERT INTO voice_agents (
        organization_id, name, description, prompt, languages, provider,
        voice_persona, goals, faq_knowledge, fallback_text, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
      RETURNING *`,
      [
        ctx.organizationId,
        parsed.name,
        parsed.description,
        parsed.prompt,
        JSON.stringify(parsed.languages),
        parsed.provider,
        parsed.voice_persona,
        JSON.stringify(parsed.goals),
        JSON.stringify(parsed.faq_knowledge),
        parsed.fallback_text,
      ]
    );

    const createdAgent = result.rows[0];

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'create_voice_agent',
      'voice_agent',
      createdAgent.id,
      { name: parsed.name, providerAgentId: providerRef.providerAgentId }
    );

    res.status(201).json(createdAgent);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// Get agent by ID
agentsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const result = await query(
      `SELECT * FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update agent (increments version)
agentsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = UpdateAgentSchema.parse(req.body);

    const existingRes = await query(
      `SELECT * FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (existingRes.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found' });
      return;
    }

    const current = existingRes.rows[0];
    const newVersion = (current.version || 1) + 1;

    const updatedRes = await query(
      `UPDATE voice_agents SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        prompt = COALESCE($3, prompt),
        languages = COALESCE($4, languages),
        provider = COALESCE($5, provider),
        voice_persona = COALESCE($6, voice_persona),
        goals = COALESCE($7, goals),
        faq_knowledge = COALESCE($8, faq_knowledge),
        fallback_text = COALESCE($9, fallback_text),
        version = $10,
        updated_at = NOW()
       WHERE id = $11 AND organization_id = $12
       RETURNING *`,
      [
        parsed.name,
        parsed.description,
        parsed.prompt,
        parsed.languages ? JSON.stringify(parsed.languages) : null,
        parsed.provider,
        parsed.voice_persona,
        parsed.goals ? JSON.stringify(parsed.goals) : null,
        parsed.faq_knowledge ? JSON.stringify(parsed.faq_knowledge) : null,
        parsed.fallback_text,
        newVersion,
        req.params.id,
        ctx.organizationId,
      ]
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'update_voice_agent',
      'voice_agent',
      req.params.id,
      { version: newVersion, changes: Object.keys(parsed) }
    );

    res.json(updatedRes.rows[0]);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete agent
agentsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const result = await query(
      `DELETE FROM voice_agents WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [req.params.id, ctx.organizationId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found' });
      return;
    }

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'delete_voice_agent',
      'voice_agent',
      req.params.id
    );

    res.json({ success: true, message: 'Voice agent deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Simulated conversation turn for agent testing (₹0 prototyping deliverable!)
agentsRouter.post('/:id/simulate', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = SimulationTurnSchema.parse(req.body);

    const agentRes = await query(
      `SELECT * FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (agentRes.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found' });
      return;
    }

    const agent = agentRes.rows[0];
    const provider = getVoiceProvider(agent.provider || 'mock');

    const result = await provider.generateSimulatedTurn({
      agentPrompt: agent.prompt,
      faqKnowledge: agent.faq_knowledge || [],
      userMessage: parsed.user_message,
      conversationHistory: parsed.history as any,
    });

    res.json({
      agent_id: agent.id,
      agent_name: agent.name,
      voice_persona: agent.voice_persona,
      user_message: parsed.user_message,
      reply_text: result.replyText,
      language: result.language,
      latency_ms: result.latencyMs,
      matched_faq: result.matchedFaq,
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});
