export interface SessionInfo {
  user: { id: string; email: string; name: string };
  currentOrganization: {
    id: string;
    name: string;
    slug: string;
    role: string;
    balance_credit_inr?: number;
    trai_a2p_declared?: boolean;
    trai_cli_registered?: string | null;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    balance_credit_inr: number;
    trai_a2p_declared: boolean;
    trai_cli_registered: string | null;
    role: string;
  }>;
}

let activeOrgId: string | null = null;
let activeUserId: string | null = null;

export function setActiveOrg(orgId: string) {
  activeOrgId = orgId;
  localStorage.setItem('active_org_id', orgId);
}

export function getActiveOrg(): string | null {
  if (!activeOrgId) {
    activeOrgId = localStorage.getItem('active_org_id');
  }
  return activeOrgId;
}

export function setActiveUser(userId: string) {
  activeUserId = userId;
  localStorage.setItem('active_user_id', userId);
}

export function getActiveUser(): string | null {
  if (!activeUserId) {
    activeUserId = localStorage.getItem('active_user_id');
  }
  return activeUserId;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const orgId = getActiveOrg();
  if (orgId) {
    headers['x-organization-id'] = orgId;
  }

  const userId = getActiveUser();
  if (userId) {
    headers['x-user-id'] = userId;
  }

  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

export const api = {
  // Auth & Tenant
  getSession: () => request<SessionInfo>('/auth/me'),
  getOrganizations: () => request<any[]>('/auth/organizations'),
  createOrganization: (data: { name: string; slug: string }) =>
    request<any>('/auth/organizations', { method: 'POST', body: JSON.stringify(data) }),

  // Voice Agents
  getAgents: () => request<any[]>('/agents'),
  getAgent: (id: string) => request<any>(`/agents/${id}`),
  createAgent: (data: any) =>
    request<any>('/agents', { method: 'POST', body: JSON.stringify(data) }),
  updateAgent: (id: string, data: any) =>
    request<any>(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAgent: (id: string) =>
    request<any>(`/agents/${id}`, { method: 'DELETE' }),
  simulateTurn: (id: string, data: { user_message: string; history?: any[] }) =>
    request<any>(`/agents/${id}/simulate`, { method: 'POST', body: JSON.stringify(data) }),

  // Calls & Simulation
  getCalls: () => request<any[]>('/calls'),
  getCallDetail: (id: string) => request<any>(`/calls/${id}`),
  startCall: (data: { agent_id: string; phone_number: string }) =>
    request<any>('/calls', { method: 'POST', body: JSON.stringify(data) }),
  simulateFullCall: (data: { agent_id: string; phone_number: string }) =>
    request<any>('/calls/simulate-full', { method: 'POST', body: JSON.stringify(data) }),

  // Billing
  getBilling: () => request<{ organizationId: string; balanceCreditInr: number; ledger: any[] }>('/billing'),
  topupCredit: (data: { amount_inr: number; payment_reference: string }) =>
    request<any>('/billing/topup', { method: 'POST', body: JSON.stringify(data) }),

  // Contacts & Compliance
  getContacts: () => request<any[]>('/contacts'),
  createContact: (data: any) =>
    request<any>('/contacts', { method: 'POST', body: JSON.stringify(data) }),
  revokeConsent: (id: string) =>
    request<any>(`/contacts/${id}/revoke-consent`, { method: 'POST' }),
  getSuppressionList: () => request<any[]>('/contacts/suppression'),
  addSuppression: (data: { phone: string; reason?: string }) =>
    request<any>('/contacts/suppression', { method: 'POST', body: JSON.stringify(data) }),
  updateTraiDeclaration: (data: { trai_a2p_declared: boolean; trai_cli_registered: string }) =>
    request<any>('/contacts/trai-declaration', { method: 'POST', body: JSON.stringify(data) }),

  // Campaigns
  getCampaigns: () => request<any[]>('/campaigns'),
  createCampaign: (data: any) =>
    request<any>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  emergencyStopCampaign: (id: string) =>
    request<any>(`/campaigns/${id}/emergency-stop`, { method: 'POST' }),

  // Audit
  getAuditLogs: () => request<any[]>('/audit-logs'),
};
