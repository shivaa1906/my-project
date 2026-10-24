import { Router, Request, Response } from 'express';
import { query, transaction } from '@voice-saas/database';
import { CreateCampaignSchema } from '@voice-saas/shared';
import { recordAuditLog } from '../middleware/audit.js';

export const campaignsRouter = Router();

// List campaigns
campaignsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const result = await query(
      `SELECT c.*, a.name as agent_name,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = c.id)::int as total_contacts,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = c.id AND cc.status = 'called')::int as completed_calls
       FROM campaigns c
       LEFT JOIN voice_agents a ON a.id = c.agent_id
       WHERE c.organization_id = $1
       ORDER BY c.created_at DESC`,
      [ctx.organizationId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create campaign
campaignsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = CreateCampaignSchema.parse(req.body);

    // Verify agent belongs to org
    const agentRes = await query(
      `SELECT id FROM voice_agents WHERE id = $1 AND organization_id = $2`,
      [parsed.agent_id, ctx.organizationId]
    );

    if (agentRes.rows.length === 0) {
      res.status(404).json({ error: 'Voice agent not found in your organization' });
      return;
    }

    const campaign = await transaction(async (client) => {
      const campRes = await client.query(
        `INSERT INTO campaigns (organization_id, agent_id, name, max_concurrency, dnd_check_enabled, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')
         RETURNING *`,
        [ctx.organizationId, parsed.agent_id, parsed.name, parsed.max_concurrency, parsed.dnd_check_enabled]
      );
      const newCamp = campRes.rows[0];

      // Add contacts to campaign
      if (parsed.contact_ids && parsed.contact_ids.length > 0) {
        for (const contactId of parsed.contact_ids) {
          await client.query(
            `INSERT INTO campaign_contacts (campaign_id, contact_id, status)
             VALUES ($1, $2, 'pending')
             ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
            [newCamp.id, contactId]
          );
        }
      }

      return newCamp;
    });

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'create_campaign',
      'campaign',
      campaign.id,
      { name: parsed.name, contactCount: parsed.contact_ids?.length || 0 }
    );

    res.status(201).json(campaign);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// Emergency Stop Kill Switch
campaignsRouter.post('/:id/emergency-stop', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;

    const result = await query(
      `UPDATE campaigns
       SET status = 'emergency_stopped', emergency_stopped = true
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [req.params.id, ctx.organizationId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'campaign_emergency_stop',
      'campaign',
      req.params.id,
      { action: 'immediate_halt' }
    );

    res.json({
      success: true,
      message: 'Campaign emergency stopped. All call dispatches permanently halted.',
      campaign: result.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
