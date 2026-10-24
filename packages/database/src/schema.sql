-- Enable pgcrypto / gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. organizations
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    balance_credit_inr NUMERIC(12, 2) NOT NULL DEFAULT 500.00,
    trai_a2p_declared BOOLEAN NOT NULL DEFAULT FALSE,
    trai_cli_registered VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. organization_members
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- 4. voice_agents
CREATE TABLE IF NOT EXISTS voice_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    prompt TEXT NOT NULL,
    languages JSONB NOT NULL DEFAULT '["te-IN", "en-IN"]'::jsonb,
    provider VARCHAR(50) NOT NULL DEFAULT 'mock',
    voice_persona VARCHAR(100) NOT NULL DEFAULT 'telugu-female-friendly',
    goals JSONB NOT NULL DEFAULT '[]'::jsonb,
    faq_knowledge JSONB NOT NULL DEFAULT '[]'::jsonb,
    fallback_text TEXT NOT NULL DEFAULT 'దయచేసి క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను.',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    consent_status VARCHAR(50) NOT NULL DEFAULT 'consented', -- 'consented', 'revoked', 'pending'
    consent_source VARCHAR(100) NOT NULL DEFAULT 'web-form',
    consent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, phone)
);

-- 6. consent_records (Immutable audit trail of consent & withdrawal per TRAI & DPDP)
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    phone VARCHAR(30) NOT NULL,
    source VARCHAR(100) NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    evidence TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opt_out_date TIMESTAMPTZ
);

-- 7. suppression_list (Do Not Call / Opt-out list)
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(30) NOT NULL,
    reason VARCHAR(100) NOT NULL DEFAULT 'dnd', -- 'dnd', 'opt_out', 'regulatory', 'user_request'
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, phone)
);

-- 8. campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'running', 'paused', 'completed', 'emergency_stopped'
    scheduled_at TIMESTAMPTZ,
    max_concurrency INT NOT NULL DEFAULT 3,
    dnd_check_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    emergency_stopped BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. campaign_contacts
CREATE TABLE IF NOT EXISTS campaign_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'queued', 'called', 'failed', 'suppressed'
    call_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(campaign_id, contact_id)
);

-- 10. calls
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    phone_number VARCHAR(30) NOT NULL,
    provider_call_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'mock',
    status VARCHAR(50) NOT NULL DEFAULT 'initiated', -- 'initiated', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer'
    duration_seconds INT NOT NULL DEFAULT 0,
    billable_minutes INT NOT NULL DEFAULT 0,
    cost_inr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    outcome VARCHAR(100),
    recording_url TEXT,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. call_events
CREATE TABLE IF NOT EXISTS call_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. transcripts
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    speaker VARCHAR(50) NOT NULL, -- 'agent', 'user', 'system'
    text TEXT NOT NULL,
    language VARCHAR(20) NOT NULL DEFAULT 'te-IN',
    latency_ms INT DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. usage_ledger (Immutable transaction ledger)
CREATE TABLE IF NOT EXISTS usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL, -- 'RESERVE', 'SETTLE', 'REFUND', 'TOPUP'
    amount_inr NUMERIC(12, 2) NOT NULL,
    balance_after_inr NUMERIC(12, 2) NOT NULL,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. webhook_deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    raw_payload TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'processed', -- 'processed', 'duplicate_ignored', 'failed'
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, idempotency_key)
);

-- 15. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance & Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_voice_agents_org ON voice_agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_calls_org ON calls(organization_id);
CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_events_call ON call_events(call_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_call ON transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_org ON usage_ledger(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppression_org_phone ON suppression_list(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_consent_records_org ON consent_records(organization_id, phone);
