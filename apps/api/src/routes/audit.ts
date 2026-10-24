import { Router, Request, Response } from 'express';
import { query } from '@voice-saas/database';

export const auditRouter = Router();

// Get audit logs for current organization
auditRouter.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = req.context!;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await query(
      `SELECT a.*, u.name as user_name, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [ctx.organizationId, limit]
    );

    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
