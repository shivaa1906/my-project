import { Request, Response, NextFunction } from 'express';
import { query } from '@voice-saas/database';

export interface TenantContext {
  userId: string;
  userEmail: string;
  userName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: 'owner' | 'admin' | 'member';
}

declare global {
  namespace Express {
    interface Request {
      context?: TenantContext;
    }
  }
}

export async function tenantAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Resolve user ID from headers or default to seed user
    let userIdentifier =
      (req.headers['x-user-id'] as string) ||
      (req.headers['authorization']?.replace(/^Bearer\s+/i, '') as string);

    let userRow: any = null;

    if (userIdentifier) {
      const userRes = await query(
        `SELECT id, email, name FROM users WHERE id::text = $1 OR email = $1`,
        [userIdentifier]
      );
      if (userRes.rows.length > 0) {
        userRow = userRes.rows[0];
      }
    }

    if (!userRow) {
      // In local development / prototype fallback to first user
      const defaultUserRes = await query(`SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 1`);
      if (defaultUserRes.rows.length === 0) {
        res.status(401).json({ error: 'Unauthorized: No users exist in the system' });
        return;
      }
      userRow = defaultUserRes.rows[0];
    }

    // 2. Resolve target organization
    const requestedOrgId =
      (req.headers['x-organization-id'] as string) ||
      (req.query.organizationId as string);

    let memberQuery: string;
    let memberParams: any[];

    if (requestedOrgId) {
      memberQuery = `
        SELECT m.organization_id, m.role, o.name as org_name, o.slug as org_slug
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 AND (m.organization_id::text = $2 OR o.slug = $2)
      `;
      memberParams = [userRow.id, requestedOrgId];
    } else {
      memberQuery = `
        SELECT m.organization_id, m.role, o.name as org_name, o.slug as org_slug
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
        ORDER BY m.created_at ASC
        LIMIT 1
      `;
      memberParams = [userRow.id];
    }

    const memberRes = await query(memberQuery, memberParams);

    if (memberRes.rows.length === 0) {
      if (requestedOrgId) {
        res.status(403).json({
          error: 'Forbidden: You do not have access to the requested organization',
          code: 'TENANT_ACCESS_DENIED',
        });
        return;
      }
      res.status(403).json({
        error: 'Forbidden: User does not belong to any organization',
        code: 'NO_ORGANIZATION_MEMBERSHIP',
      });
      return;
    }

    const member = memberRes.rows[0];

    req.context = {
      userId: userRow.id,
      userEmail: userRow.email,
      userName: userRow.name,
      organizationId: member.organization_id,
      organizationName: member.org_name,
      organizationSlug: member.org_slug,
      role: member.role,
    };

    next();
  } catch (err) {
    console.error('Tenant auth middleware error:', err);
    res.status(500).json({ error: 'Internal authentication error' });
  }
}
