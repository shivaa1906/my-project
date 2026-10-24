import { query } from '@voice-saas/database';

export async function recordAuditLog(
  organizationId: string,
  userId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organizationId, userId, action, resourceType, resourceId, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
