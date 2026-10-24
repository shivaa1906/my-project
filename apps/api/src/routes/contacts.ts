import { Router, Request, Response } from 'express';
import { query, transaction } from '@voice-saas/database';
import { CreateContactSchema } from '@voice-saas/shared';
import { recordAuditLog } from '../middleware/audit.js';

export const contactsRouter = Router();

// List contacts
contactsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const contactsRes = await query(
      `SELECT c.*,
        (SELECT json_agg(cr.*) FROM consent_records cr WHERE cr.contact_id = c.id) as consent_history
       FROM contacts c
       WHERE c.organization_id = $1
       ORDER BY c.created_at DESC`,
      [ctx.organizationId]
    );
    res.json(contactsRes.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add contact with DPDP consent record
contactsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const parsed = CreateContactSchema.parse(req.body);

    const contact = await transaction(async (client) => {
      // 1. Insert contact
      const contactRes = await client.query(
        `INSERT INTO contacts (organization_id, name, phone, consent_status, consent_source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, phone)
         DO UPDATE SET name = EXCLUDED.name, consent_status = EXCLUDED.consent_status, consent_source = EXCLUDED.consent_source
         RETURNING *`,
        [ctx.organizationId, parsed.name, parsed.phone, parsed.consent_status, parsed.consent_source]
      );
      const newContact = contactRes.rows[0];

      // 2. Insert immutable consent record per DPDP Act
      await client.query(
        `INSERT INTO consent_records (organization_id, contact_id, phone, source, purpose, evidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          ctx.organizationId,
          newContact.id,
          parsed.phone,
          parsed.consent_source,
          parsed.consent_purpose,
          `Opt-in recorded via API/Dashboard by user ${ctx.userEmail}`,
        ]
      );

      return newContact;
    });

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'create_contact_consent',
      'contact',
      contact.id,
      { phone: parsed.phone, purpose: parsed.consent_purpose }
    );

    res.status(201).json(contact);
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

// Revoke contact consent (DPDP compliance right to withdraw consent)
contactsRouter.post('/:id/revoke-consent', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;

    const contactRes = await query(
      `SELECT * FROM contacts WHERE id = $1 AND organization_id = $2`,
      [req.params.id, ctx.organizationId]
    );

    if (contactRes.rows.length === 0) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const contact = contactRes.rows[0];

    await transaction(async (client) => {
      // Update contact consent status
      await client.query(
        `UPDATE contacts SET consent_status = 'revoked' WHERE id = $1`,
        [contact.id]
      );

      // Add to suppression list automatically
      await client.query(
        `INSERT INTO suppression_list (organization_id, phone, reason)
         VALUES ($1, $2, 'user_opt_out')
         ON CONFLICT (organization_id, phone) DO UPDATE SET reason = 'user_opt_out'`,
        [ctx.organizationId, contact.phone]
      );

      // Mark consent record with opt_out_date
      await client.query(
        `UPDATE consent_records SET opt_out_date = NOW()
         WHERE organization_id = $1 AND phone = $2 AND opt_out_date IS NULL`,
        [ctx.organizationId, contact.phone]
      );
    });

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'revoke_consent',
      'contact',
      contact.id,
      { phone: contact.phone }
    );

    res.json({ success: true, message: 'Consent revoked and phone added to suppression list' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List suppression list (DND)
contactsRouter.get('/suppression', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const resList = await query(
      `SELECT * FROM suppression_list WHERE organization_id = $1 ORDER BY added_at DESC`,
      [ctx.organizationId]
    );
    res.json(resList.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add to suppression list
contactsRouter.post('/suppression', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const { phone, reason } = req.body;

    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const result = await query(
      `INSERT INTO suppression_list (organization_id, phone, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, phone) DO UPDATE SET reason = EXCLUDED.reason
       RETURNING *`,
      [ctx.organizationId, phone, reason || 'dnd']
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'add_suppression',
      'suppression_list',
      result.rows[0].id,
      { phone, reason: reason || 'dnd' }
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update TRAI Commercial Communication Declaration
contactsRouter.post('/trai-declaration', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const { trai_a2p_declared, trai_cli_registered } = req.body;

    await query(
      `UPDATE organizations
       SET trai_a2p_declared = $1, trai_cli_registered = $2
       WHERE id = $3`,
      [!!trai_a2p_declared, trai_cli_registered || null, ctx.organizationId]
    );

    await recordAuditLog(
      ctx.organizationId,
      ctx.userId,
      'update_trai_declaration',
      'organization',
      ctx.organizationId,
      { trai_a2p_declared, trai_cli_registered }
    );

    res.json({
      success: true,
      trai_a2p_declared: !!trai_a2p_declared,
      trai_cli_registered,
      message: 'TRAI A2P declaration and Calling Line Identity updated',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
