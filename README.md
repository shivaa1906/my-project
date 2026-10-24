# Dhvani Voice AI SaaS Monorepo

> **Production Architecture: Managed First, Replaceable Later**  
> Autonomous Telugu and English Voice AI Agents for multi-tenant businesses, built with strict tenant isolation, immutable usage billing, and TRAI & DPDP compliance.

---

## 🏗 Architecture & Milestone 1 Progress

```
Milestone 1 — Local SaaS Foundation
[x] 1. Create the React + Vite + TypeScript dashboard (apps/web)
[x] 2. Create the Express API and configuration (apps/api)
[x] 3. Start PostgreSQL using Docker Compose (infra/docker-compose.yml)
[x] 4. Implement users, organizations and memberships (packages/database & apps/api)
[x] 5. Create the voice-agent CRUD API with versioning (apps/api/src/routes/agents.ts)
[x] 6. Build a mock voice-provider adapter (packages/provider-adapters)
[x] 7. Simulate calls, events, transcripts and usage ledger (packages/billing & apps/api)
[x] 8. Add tenant-isolation and regulatory tests (apps/api/src/tests/voice-saas.test.ts)

Status: 8 of 8 tasks complete (100%)
```

---

## 📁 Repository Structure

```
voice-saas/
├── apps/
│   ├── web/                     # React 18 + Vite + Tailwind CSS Dashboard
│   │   ├── src/
│   │   │   ├── api/client.ts    # Multi-tenant API client with org scoping
│   │   │   └── App.tsx          # Full dashboard with simulator, logs & ledger
│   └── api/                     # Node.js + Express API
│       └── src/
│           ├── middleware/      # Tenant authorization & audit logging
│           ├── routes/          # Agents, calls, billing, compliance, webhooks
│           └── tests/           # Automated tenant-isolation & lifecycle tests
├── packages/
│   ├── database/                # PostgreSQL schema (15 tables), migrations & seed
│   ├── provider-adapters/       # VoiceProvider interface & MockVoiceProvider
│   ├── billing/                 # Immutable usage ledger & ₹3.50/min pricing
│   └── shared/                  # TypeScript interfaces & Zod validation schemas
├── infra/
│   └── docker-compose.yml       # Local PostgreSQL 16 & Redis 7
```

---

## ⚡ Quick Start

### 1. Start Database & Redis (Docker)
```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. Run Database Migrations & Multi-Tenant Seed
```bash
npm run db:migrate
npm run db:seed
```
This initializes the 15 required relational tables and seeds two test organizations:
- **Apex Healthcare Hyderabad** (Slug: `apex-health`, Balance: ₹1,500.00, Telugu medical agent)
- **Telugu FinTech Solutions** (Slug: `telugu-fintech`, Balance: ₹850.00, Telugu EMI agent)

### 3. Run Automated Tests
```bash
npm test
```
Executes 14 comprehensive test suites verifying:
- Cross-tenant isolation (403 Forbidden on unauthorized org access)
- Voice agent CRUD and prompt versioning
- Real-time Telugu FAQ simulation and latency measurement without a phone call
- Overspending balance checks (402 Payment Required)
- Idempotent webhook handling (duplicate webhook delivery never double-bills)
- DND suppression list enforcement (400 PHONE_SUPPRESSED_DND)
- DPDP right-to-withdraw consent revocation
- Complete end-to-end call lifecycle simulation with ledger reconciliation

### 4. Build All Workspaces
```bash
npm run build
```

### 5. Start Development Servers
```bash
# Terminal 1: Backend API (port 4000)
npm run dev:api

# Terminal 2: Web Dashboard (port 3000)
npm run dev:web
```

---

## 🛡 Security & Compliance Highlights

- **Tenant Isolation**: Every request verifies tenant membership via `organization_members`. Client-supplied organization IDs are validated strictly in the service layer.
- **Financial Safety**: Pre-call credit reservation locks funds before initiating an authorized call. Reconciled usage writes an immutable `SETTLE` ledger entry and releases unused reservations.
- **Telecom Compliance**: TRAI 2026 Commercial Communications A2P declarations and Calling Line Identity (CLI) tracking.
- **Data Protection**: Indian DPDP Act 2023 consent records with opt-out enforcement and automatic DND suppression.
