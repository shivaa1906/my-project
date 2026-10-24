import { z } from 'zod';

export type UserRole = 'owner' | 'admin' | 'member';
export type ProviderType = 'mock' | 'sarvam' | 'custom';
export type CallStatus = 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'failed' | 'busy' | 'no-answer';
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'emergency_stopped';
export type ConsentStatus = 'consented' | 'revoked' | 'pending';
export type LedgerTransactionType = 'RESERVE' | 'SETTLE' | 'REFUND' | 'TOPUP';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  balance_credit_inr: number; // e.g. ₹500.00
  trai_a2p_declared: boolean; // TRAI 2026 3rd Amendment declaration status
  trai_cli_registered: string | null; // e.g. Approved Calling Line Identity '040-XXXXX'
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  user_email?: string;
  user_name?: string;
}

export interface FAQItem {
  question: string;
  answer: string;
  language: 'te-IN' | 'en-IN' | 'mixed';
}

export interface VoiceAgent {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  prompt: string;
  languages: string[]; // e.g. ['te-IN', 'en-IN']
  provider: ProviderType;
  voice_persona: string; // e.g. 'telugu-female-friendly', 'telugu-male-formal'
  goals: string[];
  faq_knowledge: FAQItem[];
  fallback_text: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  organization_id: string;
  name: string;
  phone: string;
  consent_status: ConsentStatus;
  consent_source: string;
  consent_date: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  organization_id: string;
  contact_id?: string;
  phone: string;
  source: string; // e.g. 'web-form-opt-in', 'ivr-prompt', 'sms'
  purpose: string; // e.g. 'appointment_reminders', 'transactional_alerts'
  evidence: string; // IP, digital signature, or IVR recording ref
  timestamp: string;
  opt_out_date?: string | null;
}

export interface SuppressionEntry {
  id: string;
  organization_id: string;
  phone: string;
  reason: 'dnd' | 'opt_out' | 'regulatory' | 'user_request';
  added_at: string;
}

export interface Campaign {
  id: string;
  organization_id: string;
  agent_id: string;
  name: string;
  status: CampaignStatus;
  scheduled_at?: string | null;
  max_concurrency: number;
  dnd_check_enabled: boolean;
  emergency_stopped: boolean;
  total_contacts?: number;
  completed_calls?: number;
  created_at: string;
}

export interface Call {
  id: string;
  organization_id: string;
  agent_id: string;
  contact_id?: string | null;
  campaign_id?: string | null;
  phone_number: string;
  provider_call_id: string;
  provider: ProviderType;
  status: CallStatus;
  duration_seconds: number;
  billable_minutes: number;
  cost_inr: number;
  outcome?: string;
  recording_url?: string | null;
  initiated_at: string;
  ended_at?: string | null;
  created_at: string;
}

export interface CallEvent {
  id: string;
  call_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface Transcript {
  id: string;
  call_id: string;
  speaker: 'agent' | 'user' | 'system';
  text: string;
  language: string;
  latency_ms?: number;
  timestamp: string;
}

export interface UsageLedgerEntry {
  id: string;
  organization_id: string;
  call_id?: string | null;
  transaction_type: LedgerTransactionType;
  amount_inr: number;
  balance_after_inr: number;
  idempotency_key: string;
  description: string;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  provider: string;
  event_type: string;
  idempotency_key: string;
  raw_payload: string;
  status: 'processed' | 'duplicate_ignored' | 'failed';
  error_message?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// Zod validation schemas
export const CreateAgentSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().default(''),
  prompt: z.string().min(10),
  languages: z.array(z.string()).default(['te-IN', 'en-IN']),
  provider: z.enum(['mock', 'sarvam', 'custom']).default('mock'),
  voice_persona: z.string().default('telugu-female-friendly'),
  goals: z.array(z.string()).default([]),
  faq_knowledge: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      language: z.enum(['te-IN', 'en-IN', 'mixed']),
    })
  ).default([]),
  fallback_text: z.string().default('దయచేసి క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మళ్ళీ చెప్పగలరా?'),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

export const StartCallSchema = z.object({
  agent_id: z.string().uuid(),
  phone_number: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid E.164 phone number format'),
  contact_id: z.string().uuid().optional(),
  campaign_id: z.string().uuid().optional(),
  simulate_interactive: z.boolean().optional().default(false),
});

export const SimulationTurnSchema = z.object({
  user_message: z.string().min(1),
  history: z.array(
    z.object({
      speaker: z.enum(['agent', 'user', 'system']),
      text: z.string(),
      language: z.string().optional(),
    })
  ).default([]),
});

export const TopupSchema = z.object({
  amount_inr: z.number().positive(),
  payment_reference: z.string().min(3),
});

export const CreateContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  consent_status: z.enum(['consented', 'revoked', 'pending']).default('consented'),
  consent_source: z.string().default('web-form'),
  consent_purpose: z.string().default('general_service_calling'),
});

export const CreateCampaignSchema = z.object({
  agent_id: z.string().uuid(),
  name: z.string().min(3),
  max_concurrency: z.number().int().min(1).max(20).default(3),
  dnd_check_enabled: z.boolean().default(true),
  contact_ids: z.array(z.string().uuid()).default([]),
});
