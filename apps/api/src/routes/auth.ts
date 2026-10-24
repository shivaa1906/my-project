import { Router, Request, Response } from 'express';
import { query, transaction } from '@voice-saas/database';
import { recordAuditLog } from '../middleware/audit.js';

export const authRouter = Router();

// Current session info: user, active tenant context, and available organizations
authRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const orgsRes = await query(
      `SELECT o.id, o.name, o.slug, o.balance_credit_inr, o.trai_a2p_declared, o.trai_cli_registered, m.role
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC`,
      [ctx.userId]
    );

    res.json({
      user: {
        id: ctx.userId,
        email: ctx.userEmail,
        name: ctx.userName,
      },
      currentOrganization: {
        id: ctx.organizationId,
        name: ctx.organizationName,
        slug: ctx.organizationSlug,
        role: ctx.role,
      },
      organizations: orgsRes.rows.map((r) => ({
        ...r,
        balance_credit_inr: Number(r.balance_credit_inr),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List organizations accessible by current user
authRouter.get('/organizations', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const orgsRes = await query(
      `SELECT o.id, o.name, o.slug, o.balance_credit_inr, o.trai_a2p_declared, o.trai_cli_registered, m.role, o.created_at
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC`,
      [ctx.userId]
    );
    res.json(
      orgsRes.rows.map((r) => ({
        ...r,
        balance_credit_inr: Number(r.balance_credit_inr),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create new organization and assign owner
authRouter.post('/organizations', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const { name, slug } = req.body;

    if (!name || !slug) {
      res.status(400).json({ error: 'Name and slug are required' });
      return;
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const createdOrg = await transaction(async (client) => {
      const orgRes = await client.query(
        `INSERT INTO organizations (name, slug, balance_credit_inr)
         VALUES ($1, $2, 500.00) RETURNING *`,
        [name, cleanSlug]
      );
      const newOrg = orgRes.rows[0];

      // Assign user as owner
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [newOrg.id, ctx.userId]
      );

      // Welcome credit entry in ledger
      await client.query(
        `INSERT INTO usage_ledger (organization_id, transaction_type, amount_inr, balance_after_inr, idempotency_key, description)
         VALUES ($1, 'TOPUP', 500.00, 500.00, $2, 'Initial welcome promotional credit')`,
        [newOrg.id, `welcome-credit-${newOrg.id}`]
      );

      return newOrg;
    });

    await recordAuditLog(
      createdOrg.id,
      ctx.userId,
      'create_organization',
      'organization',
      createdOrg.id,
      { name, slug: cleanSlug }
    );

    res.status(201).json({
      ...createdOrg,
      balance_credit_inr: Number(createdOrg.balance_credit_inr),
    });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Organization slug is already in use' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// Get members of current organization
authRouter.get('/organizations/:id/members', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    if (req.params.id !== ctx.organizationId) {
      res.status(403).json({ error: 'Forbidden: Cannot view members of another organization' });
      return;
    }

    const membersRes = await query(
      `SELECT m.id, m.role, m.created_at, u.id as user_id, u.email, u.name
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [ctx.organizationId]
    );

    res.json(membersRes.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
