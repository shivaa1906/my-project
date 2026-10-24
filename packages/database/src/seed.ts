import { query, closePool } from './index.js';
import { runMigrations } from './migrate.js';

export async function seedDatabase() {
  await runMigrations();

  console.log('Seeding initial multi-tenant data...');

  // 1. Clean existing sample data (safe idempotency)
  await query(`DELETE FROM audit_logs WHERE metadata->>'seed' = 'true'`);
  await query(`DELETE FROM usage_ledger WHERE idempotency_key LIKE 'seed-%'`);
  await query(`DELETE FROM organizations WHERE slug IN ('apex-health', 'telugu-fintech')`);

  // 2. Insert Organizations
  const org1Res = await query(
    `INSERT INTO organizations (name, slug, balance_credit_inr, trai_a2p_declared, trai_cli_registered)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    ['Apex Healthcare Hyderabad', 'apex-health', 1500.00, true, '040-67890123']
  );
  const org1Id = org1Res.rows[0].id;

  const org2Res = await query(
    `INSERT INTO organizations (name, slug, balance_credit_inr, trai_a2p_declared, trai_cli_registered)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    ['Telugu FinTech Solutions', 'telugu-fintech', 850.00, true, '040-45678901']
  );
  const org2Id = org2Res.rows[0].id;

  // 3. Insert Users & Memberships
  const user1Res = await query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['ramesh@apexhealth.in', 'Dr. Ramesh Kumar']
  );
  const user1Id = user1Res.rows[0].id;

  const user2Res = await query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['sneha@apexhealth.in', 'Sneha Rao']
  );
  const user2Id = user2Res.rows[0].id;

  const user3Res = await query(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['ananya@telugufintech.com', 'Ananya Reddy']
  );
  const user3Id = user3Res.rows[0].id;

  // Link users to orgs
  await query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'admin'), ($4, $5, 'owner')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [org1Id, user1Id, user2Id, org2Id, user3Id]
  );

  // 4. Voice Agents
  const agent1Faq = JSON.stringify([
    {
      question: 'క్లినిక్ సమయాలు ఏమిటి? (What are clinic hours?)',
      answer: 'మా క్లినిక్ సోమవారం నుండి శనివారం వరకు ఉదయం 8:00 నుండి రాత్రి 8:00 వరకు తెరిచి ఉంటుంది. We are open Monday to Saturday from 8 AM to 8 PM.',
      language: 'mixed',
    },
    {
      question: 'డాక్టర్ అపాయింట్‌మెంట్ ఎలా బుక్ చేసుకోవాలి?',
      answer: 'నేను మీ కోసం వెంటనే డాక్టర్ రమేష్ గారి అపాయింట్‌మెంట్ స్లాట్ బుక్ చేయగలను. దయచేసి మీకు అనుకూలమైన సమయం చెప్పండి.',
      language: 'te-IN',
    },
    {
      question: 'What is the consultation fee?',
      answer: 'జనరల్ కన్సల్టేషన్ ఫీజు ₹500 మాత్రమే. You can pay via UPI or at the reception.',
      language: 'mixed',
    },
  ]);

  const agent1Prompt = `You are "ఆరోగ్య సంరక్షకుడు" (Apex Care Assistant), an empathetic, courteous bilingual AI voice assistant for Apex Healthcare in Hyderabad.
You speak fluent Telugu and conversational Indian English (code-switching smoothly).
Your goals:
1. Greet the patient warmly: "నమస్కారం! అపెక్స్ హెల్త్‌కేర్ నుండి మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయపడగలను?"
2. Answer inquiries about doctor appointments, clinic timings, and lab test instructions.
3. Be respectful, patient, and assure privacy under India DPDP Act.`;

  const agent1Res = await query(
    `INSERT INTO voice_agents (
      organization_id, name, description, prompt, languages, provider,
      voice_persona, goals, faq_knowledge, fallback_text
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      org1Id,
      'ఆరోగ్య సంరక్షకుడు (Apex Care Assistant)',
      'Bilingual Telugu-English assistant for patient appointments and clinic inquiries',
      agent1Prompt,
      JSON.stringify(['te-IN', 'en-IN']),
      'mock',
      'telugu-female-friendly',
      JSON.stringify(['Book appointment', 'Provide clinic timings', 'Emergency guidance']),
      agent1Faq,
      'దయచేసి క్షమించండి, నేను అర్థం చేసుకోలేకపోయాను. దయచేసి మరొకసారి చెప్పగలరా?',
    ]
  );
  const agent1Id = agent1Res.rows[0].id;

  const agent2Faq = JSON.stringify([
    {
      question: 'నా EMI చివరి తేదీ ఎప్పుడు? (When is my EMI due?)',
      answer: 'మీ పర్సనల్ లోన్ EMI ప్రతి నెలా 5వ తేదీన ఆటో-డెబిట్ అవుతుంది. Please keep sufficient balance in your bank account.',
      language: 'mixed',
    },
    {
      question: 'Can I pay via UPI?',
      answer: 'అవును, మేము మీ రిజిస్టర్డ్ మొబైల్ నంబర్‌కు అధికారిక UPI పేమెంట్ లింక్ SMS ద్వారా పంపుతాము.',
      language: 'mixed',
    },
  ]);

  const agent2Prompt = `You are "రుణ సహాయకురాలు" (Loan Mitra), a professional voice assistant for Telugu FinTech Solutions.
You communicate clearly in polite Telugu and English.
Your goals:
1. Inform customers respectfully about their upcoming EMI payment date.
2. Answer questions regarding payment modes and receipts.
3. If the customer requests an extension, explain the restructuring request procedure.`;

  await query(
    `INSERT INTO voice_agents (
      organization_id, name, description, prompt, languages, provider,
      voice_persona, goals, faq_knowledge, fallback_text
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      org2Id,
      'రుణ సహాయకురాలు (Loan Mitra)',
      'Telugu-English financial assistant for loan updates and payment help',
      agent2Prompt,
      JSON.stringify(['te-IN', 'en-IN']),
      'mock',
      'telugu-female-professional',
      JSON.stringify(['EMI reminders', 'UPI payment link dispatch', 'Payment restructuring info']),
      agent2Faq,
      'క్షమించండి, మీ ప్రశ్న అర్థం కాలేదు. మళ్ళీ చెప్పండి.',
    ]
  );

  // 5. Contacts & Consent Records (DPDP & TRAI compliance)
  const contact1Res = await query(
    `INSERT INTO contacts (organization_id, name, phone, consent_status, consent_source, consent_date, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id`,
    [
      org1Id,
      'Venkatesh Murthy',
      '+919848022338',
      'consented',
      'web-portal-registration',
      JSON.stringify({ patient_id: 'APX-1082', language_preference: 'te-IN' }),
    ]
  );
  const contact1Id = contact1Res.rows[0].id;

  await query(
    `INSERT INTO consent_records (organization_id, contact_id, phone, source, purpose, evidence, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      org1Id,
      contact1Id,
      '+919848022338',
      'web-portal-registration',
      'appointment_reminders_and_care',
      'IP: 183.82.110.12 - Form Submission #4489',
    ]
  );

  await query(
    `INSERT INTO contacts (organization_id, name, phone, consent_status, consent_source, consent_date, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
    [
      org1Id,
      'Lakshmi Devi',
      '+919849011223',
      'consented',
      'opd-reception-consent-form',
      JSON.stringify({ patient_id: 'APX-2041', language_preference: 'te-IN' }),
    ]
  );

  // Suppression / DND list
  await query(
    `INSERT INTO suppression_list (organization_id, phone, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, phone) DO NOTHING`,
    [org1Id, '+919849099999', 'user_request']
  );

  // 6. Usage Ledger Initial Topup records
  await query(
    `INSERT INTO usage_ledger (organization_id, transaction_type, amount_inr, balance_after_inr, idempotency_key, description)
     VALUES
     ($1, 'TOPUP', 1500.00, 1500.00, 'seed-topup-apex-01', 'Initial welcome promotional credit'),
     ($2, 'TOPUP', 850.00, 850.00, 'seed-topup-fintech-01', 'Initial welcome promotional credit')`,
    [org1Id, org2Id]
  );

  console.log('Seeding completed successfully!');
  console.log(`Org 1 (Apex Healthcare): ${org1Id}`);
  console.log(`Org 2 (Telugu FinTech): ${org2Id}`);
  console.log(`Agent 1: ${agent1Id}`);
}

if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  seedDatabase()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await closePool();
      process.exit(1);
    });
}
