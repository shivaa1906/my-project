import React, { useState, useEffect } from 'react';
import {
  api,
  setActiveOrg,
  getActiveOrg,
  SessionInfo,
} from './api/client';
import {
  Bot,
  PhoneCall,
  ShieldCheck,
  CreditCard,
  History,
  Play,
  Plus,
  RefreshCw,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  UserCheck,
  Send,
  X,
  Radio,
  FileText,
  Volume2,
} from 'lucide-react';

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'calls' | 'compliance' | 'billing' | 'audit'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [agents, setAgents] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [suppression, setSuppression] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Modals & Drawers
  const [showSimulateModal, setShowSimulateModal] = useState<any | null>(null);
  const [simTurnInput, setSimTurnInput] = useState('');
  const [simChatHistory, setSimChatHistory] = useState<any[]>([]);
  const [simLoading, setSimLoading] = useState(false);

  const [showCallModal, setShowCallModal] = useState(false);
  const [callAgentId, setCallAgentId] = useState('');
  const [callPhone, setCallPhone] = useState('+919848022338');
  const [callInProgress, setCallInProgress] = useState(false);
  const [callSimResult, setCallSimResult] = useState<any | null>(null);

  const [selectedCallDetail, setSelectedCallDetail] = useState<any | null>(null);

  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agentForm, setAgentForm] = useState({
    name: '',
    description: '',
    prompt: '',
    languages: ['te-IN', 'en-IN'],
    voice_persona: 'telugu-female-friendly',
    faq_question: '',
    faq_answer: '',
  });

  const [showTopupModal, setShowTopupModal] = useState(false);
  const [topupAmount, setTopupAmount] = useState(500);

  // Load session and data
  const loadData = async (orgId?: string) => {
    try {
      setLoading(true);
      setError(null);
      if (orgId) {
        setActiveOrg(orgId);
      }
      const s = await api.getSession();
      setSession(s);

      // Load all sub-resources for current org
      const [agentsData, callsData, billingData, contactsData, suppressionData, auditData] = await Promise.all([
        api.getAgents().catch(() => []),
        api.getCalls().catch(() => []),
        api.getBilling().catch(() => null),
        api.getContacts().catch(() => []),
        api.getSuppressionList().catch(() => []),
        api.getAuditLogs().catch(() => []),
      ]);

      setAgents(agentsData);
      setCalls(callsData);
      setBilling(billingData);
      setContacts(contactsData);
      setSuppression(suppressionData);
      setAuditLogs(auditData);

      if (agentsData.length > 0 && !callAgentId) {
        setCallAgentId(agentsData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load organization data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Organization switcher handler
  const handleOrgSwitch = (newOrgId: string) => {
    setActiveOrg(newOrgId);
    loadData(newOrgId);
  };

  // Run interactive turn simulation
  const handleSendSimTurn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!simTurnInput.trim() || !showSimulateModal || simLoading) return;

    const userMsg = simTurnInput;
    setSimTurnInput('');
    setSimChatHistory((prev) => [...prev, { speaker: 'user', text: userMsg }]);
    setSimLoading(true);

    try {
      const res = await api.simulateTurn(showSimulateModal.id, {
        user_message: userMsg,
        history: simChatHistory,
      });

      setSimChatHistory((prev) => [
        ...prev,
        {
          speaker: 'agent',
          text: res.reply_text,
          language: res.language,
          latencyMs: res.latency_ms,
          matchedFaq: res.matched_faq,
        },
      ]);
    } catch (err: any) {
      setSimChatHistory((prev) => [
        ...prev,
        { speaker: 'system', text: `Simulation error: ${err.message}` },
      ]);
    } finally {
      setSimLoading(false);
    }
  };

  // Run full simulated phone call lifecycle
  const handleSimulateFullCall = async () => {
    if (!callAgentId || !callPhone) return;
    setCallInProgress(true);
    setCallSimResult(null);

    try {
      const res = await api.simulateFullCall({
        agent_id: callAgentId,
        phone_number: callPhone,
      });
      setCallSimResult(res);
      // Refresh calls and billing
      const [newCalls, newBilling] = await Promise.all([api.getCalls(), api.getBilling()]);
      setCalls(newCalls);
      setBilling(newBilling);
    } catch (err: any) {
      alert(`Call simulation failed: ${err.message}`);
    } finally {
      setCallInProgress(false);
    }
  };

  // Create new Voice Agent
  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const faqList = [];
      if (agentForm.faq_question && agentForm.faq_answer) {
        faqList.push({
          question: agentForm.faq_question,
          answer: agentForm.faq_answer,
          language: 'te-IN',
        });
      }

      await api.createAgent({
        name: agentForm.name,
        description: agentForm.description,
        prompt: agentForm.prompt,
        languages: agentForm.languages,
        voice_persona: agentForm.voice_persona,
        goals: ['Provide bilingual support', 'Schedule appointments'],
        faq_knowledge: faqList,
      });

      setShowNewAgentModal(false);
      setAgentForm({
        name: '',
        description: '',
        prompt: '',
        languages: ['te-IN', 'en-IN'],
        voice_persona: 'telugu-female-friendly',
        faq_question: '',
        faq_answer: '',
      });
      const newAgents = await api.getAgents();
      setAgents(newAgents);
    } catch (err: any) {
      alert(`Agent creation failed: ${err.message}`);
    }
  };

  // Handle Top-up
  const handleTopup = async () => {
    try {
      const ref = `UPI-${Date.now().toString().slice(-6)}`;
      await api.topupCredit({ amount_inr: topupAmount, payment_reference: ref });
      setShowTopupModal(false);
      const newBilling = await api.getBilling();
      setBilling(newBilling);
      alert(`Top-up of ₹${topupAmount} completed via ${ref}!`);
    } catch (err: any) {
      alert(`Top-up failed: ${err.message}`);
    }
  };

  // Open call detail drawer
  const handleViewCallDetail = async (callId: string) => {
    try {
      const detail = await api.getCallDetail(callId);
      setSelectedCallDetail(detail);
    } catch (err: any) {
      alert(`Failed to load call detail: ${err.message}`);
    }
  };

  if (loading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-sm font-medium tracking-wide text-slate-300">
            Initializing Dhvani Voice AI SaaS...
          </p>
        </div>
      </div>
    );
  }

  const currentOrg = session?.organizations.find(
    (o) => o.id === (getActiveOrg() || session.currentOrganization.id)
  ) || session?.currentOrganization;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-indigo-500/20 shadow-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Dhvani Voice AI
                </span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                  Telugu + English
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Production-Ready Multi-Tenant SaaS</p>
            </div>
          </div>

          {/* Right Header items */}
          <div className="flex items-center space-x-4">
            {/* TRAI Compliance Status */}
            <div className="hidden md:flex items-center space-x-1.5 px-3 py-1 bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>TRAI 2026 Compliant</span>
              {currentOrg && (currentOrg as any).trai_cli_registered && (
                <span className="text-[10px] opacity-75">({(currentOrg as any).trai_cli_registered})</span>
              )}
            </div>

            {/* Credit Balance */}
            <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
              <CreditCard className="w-4 h-4 text-amber-400" />
              <div>
                <span className="text-slate-400 block text-[10px]">Balance</span>
                <span className="font-bold text-white">
                  ₹{billing?.balanceCreditInr?.toFixed(2) || currentOrg?.balance_credit_inr?.toFixed(2) || '0.00'}
                </span>
              </div>
              <button
                onClick={() => setShowTopupModal(true)}
                className="ml-2 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded transition"
              >
                + Top Up
              </button>
            </div>

            {/* Multi-Tenant Switcher */}
            <div className="flex items-center space-x-2 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
              <Building2 className="w-4 h-4 text-indigo-400" />
              <select
                value={currentOrg?.id}
                onChange={(e) => handleOrgSwitch(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {session?.organizations.map((org) => (
                  <option key={org.id} value={org.id} className="bg-slate-900 text-white">
                    {org.name} ({org.role})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1">
        {/* Sub-Header & Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {currentOrg?.name || 'Dashboard'}
            </h1>
            <p className="text-sm text-slate-500">
              Autonomous Telugu and English Voice AI Agents · Pay-as-you-go ₹3.50/min
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowCallModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              <PhoneCall className="w-4 h-4" />
              <span>Simulate Live Call</span>
            </button>
            <button
              onClick={() => setShowNewAgentModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Voice Agent</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex space-x-1 bg-slate-200/70 p-1 rounded-xl w-fit mb-6 text-xs font-medium text-slate-600">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'overview' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'agents' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Voice Agents ({agents.length})
          </button>
          <button
            onClick={() => setActiveTab('calls')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'calls' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Calls & Activity ({calls.length})
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'compliance' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Compliance & DPDP
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'billing' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Usage Ledger
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === 'audit' ? 'bg-white text-slate-900 font-bold shadow-sm' : 'hover:text-slate-900'
            }`}
          >
            Audit Logs
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Voice Agents</span>
                  <Bot className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="text-2xl font-bold text-slate-900">{agents.length}</div>
                <p className="text-xs text-slate-500 mt-1">Bilingual Telugu-English ready</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Calls</span>
                  <PhoneCall className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold text-slate-900">{calls.length}</div>
                <p className="text-xs text-slate-500 mt-1">Reconciled with usage ledger</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Available Credits</span>
                  <CreditCard className="w-5 h-5 text-amber-600" />
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  ₹{billing?.balanceCreditInr?.toFixed(2) || '0.00'}
                </div>
                <p className="text-xs text-slate-500 mt-1">₹3.50 / conversation minute</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Regulatory Compliance</span>
                  <ShieldCheck className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="text-sm font-bold text-emerald-600 flex items-center space-x-1 mt-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>TRAI A2P & DPDP Active</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">DND checks & opt-out enforced</p>
              </div>
            </div>

            {/* Quick Actions & Agent Spotlight */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-slate-900">Configured Voice Agents</h2>
                  <button
                    onClick={() => setActiveTab('agents')}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    View All →
                  </button>
                </div>

                <div className="space-y-4">
                  {agents.slice(0, 3).map((agent) => (
                    <div
                      key={agent.id}
                      className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-sm text-slate-900">{agent.name}</span>
                          <span className="px-2 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 font-medium rounded-full">
                            v{agent.version}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1">{agent.description || agent.prompt}</p>
                        <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                          <span>Languages: {agent.languages.join(', ')}</span>
                          <span>•</span>
                          <span>Persona: {agent.voice_persona}</span>
                          <span>•</span>
                          <span>FAQs: {agent.faq_knowledge?.length || 0}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setShowSimulateModal(agent);
                          setSimChatHistory([
                            {
                              speaker: 'agent',
                              text: `నమస్కారం! నేను ${agent.name}. మీకు ఎలా సహాయపడగలను?`,
                              language: 'te-IN',
                            },
                          ]);
                        }}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-600 text-slate-700 rounded-lg text-xs font-medium transition flex items-center space-x-1 shadow-sm"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Test Simulator</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Zero-Budget Architecture Overview Card */}
              <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-md flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-indigo-500/30 rounded-lg text-[11px] font-semibold text-indigo-200 mb-4">
                    <Radio className="w-3.5 h-3.5" />
                    <span>₹0 Prototype Milestones</span>
                  </div>
                  <h3 className="font-bold text-lg mb-2">Managed First, Replaceable Later</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Test complete multi-tenant workflows, conversation logic in Telugu and English, DND compliance, and financial ledger safety locally before spending on paid telephony.
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-indigo-800/60 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>Base AI Rate:</span>
                    <span className="font-semibold text-white">₹3.50 / minute</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Isolation:</span>
                    <span className="font-semibold text-emerald-400">Strict Tenant Scoping</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Idempotency:</span>
                    <span className="font-semibold text-emerald-400">Double-Charge Protected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: VOICE AGENTS */}
        {activeTab === 'agents' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Voice Agents Directory</h2>
                <p className="text-xs text-slate-500">Configure prompt goals, persona, and bilingual Telugu/English knowledge base</p>
              </div>
              <button
                onClick={() => setShowNewAgentModal(true)}
                className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Agent</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                        <Bot className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-full">
                        v{agent.version}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{agent.name}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{agent.description || agent.prompt}</p>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                      <div className="flex justify-between text-slate-500">
                        <span>Persona:</span>
                        <span className="font-medium text-slate-700">{agent.voice_persona}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>Languages:</span>
                        <span className="font-medium text-indigo-600">{agent.languages.join(', ')}</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>FAQ Entries:</span>
                        <span className="font-medium text-slate-700">{agent.faq_knowledge?.length || 0} Q&A</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center space-x-2">
                    <button
                      onClick={() => {
                        setShowSimulateModal(agent);
                        setSimChatHistory([
                          {
                            speaker: 'agent',
                            text: `నమస్కారం! నేను ${agent.name}. మీకు ఎలా సహాయపడగలను?`,
                            language: 'te-IN',
                          },
                        ]);
                      }}
                      className="flex-1 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-lg transition flex items-center justify-center space-x-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Test Chat Simulator</span>
                    </button>
                    <button
                      onClick={() => {
                        setCallAgentId(agent.id);
                        setShowCallModal(true);
                      }}
                      className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                      title="Simulate Call"
                    >
                      <PhoneCall className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: CALLS & ACTIVITY */}
        {activeTab === 'calls' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Calls & Conversation Records</h2>
                <p className="text-xs text-slate-500">Lifecycle telemetry, speech transcripts, and usage ledger reconciliation</p>
              </div>
              <button
                onClick={() => setShowCallModal(true)}
                className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Simulate Call</span>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="px-6 py-3.5">Recipient Phone</th>
                      <th className="px-6 py-3.5">Voice Agent</th>
                      <th className="px-6 py-3.5">Status</th>
                      <th className="px-6 py-3.5">Duration</th>
                      <th className="px-6 py-3.5">Billable Mins</th>
                      <th className="px-6 py-3.5">Cost (₹)</th>
                      <th className="px-6 py-3.5">Initiated At</th>
                      <th className="px-6 py-3.5 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {calls.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                          No calls recorded yet. Click "Simulate Call" to test end-to-end conversation!
                        </td>
                      </tr>
                    ) : (
                      calls.map((call) => (
                        <tr key={call.id} className="hover:bg-slate-50/80 transition">
                          <td className="px-6 py-4 font-mono font-medium text-slate-900">
                            {call.phone_number}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900">
                            {call.agent_name || 'Agent'}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                call.status === 'completed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : call.status === 'initiated'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {call.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono">
                            {call.duration_seconds}s
                          </td>
                          <td className="px-6 py-4 font-mono">
                            {call.billable_minutes} min
                          </td>
                          <td className="px-6 py-4 font-bold text-slate-900 font-mono">
                            ₹{Number(call.cost_inr).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {new Date(call.initiated_at).toLocaleTimeString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleViewCallDetail(call.id)}
                              className="text-indigo-600 hover:text-indigo-800 font-semibold"
                            >
                              View Dialogue →
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: COMPLIANCE & DPDP */}
        {activeTab === 'compliance' && (
          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-amber-900 text-xs flex items-start space-x-3">
              <ShieldCheck className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-amber-950 mb-1">
                  Indian Telecom & DPDP Act 2023 Regulatory Release Gate
                </h4>
                <p className="leading-relaxed">
                  Per TRAI 2026 Third Amendment Regulations, commercial voice calls require documented A2P declaration and registered Calling Line Identities. Contacts must have explicit, verifiable consent records with immediate right-to-withdraw enforcement and Do Not Disturb (DND) suppression.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Contacts with Consent Records */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm text-slate-900">Consented Contacts Directory</h3>
                  <span className="text-xs text-slate-500">{contacts.length} Records</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {contacts.map((c) => (
                    <div key={c.id} className="py-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900 text-xs">{c.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{c.phone}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Source: {c.consent_source} • Consent Date: {new Date(c.consent_date).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.consent_status === 'consented'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {c.consent_status}
                        </span>

                        {c.consent_status === 'consented' && (
                          <button
                            onClick={async () => {
                              if (confirm(`Revoke consent for ${c.name} (${c.phone})? This will immediately add them to the suppression list.`)) {
                                await api.revokeConsent(c.id);
                                loadData();
                              }
                            }}
                            className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suppression / DND List */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm text-slate-900">Suppression List (Do Not Call)</h3>
                  <span className="text-xs text-slate-500">{suppression.length} Numbers</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {suppression.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">No numbers suppressed.</p>
                  ) : (
                    suppression.map((s) => (
                      <div key={s.id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="font-mono text-xs font-semibold text-slate-900">{s.phone}</div>
                          <div className="text-[10px] text-slate-400">
                            Reason: {s.reason} • Added: {new Date(s.added_at).toLocaleDateString()}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold rounded">
                          BLOCKED
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: BILLING & USAGE LEDGER */}
        {activeTab === 'billing' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Immutable Usage Ledger</h2>
                <p className="text-xs text-slate-500">Transactional reservations, reconciliations, and credit transactions</p>
              </div>

              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">Balance Available</span>
                  <span className="text-lg font-bold text-slate-900">
                    ₹{billing?.balanceCreditInr?.toFixed(2) || '0.00'}
                  </span>
                </div>
                <button
                  onClick={() => setShowTopupModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                >
                  + Add Credit
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="px-6 py-3.5">Transaction Type</th>
                      <th className="px-6 py-3.5">Adjustment (₹)</th>
                      <th className="px-6 py-3.5">Balance After</th>
                      <th className="px-6 py-3.5">Idempotency Key</th>
                      <th className="px-6 py-3.5">Description</th>
                      <th className="px-6 py-3.5">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {billing?.ledger?.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              tx.transaction_type === 'TOPUP'
                                ? 'bg-emerald-100 text-emerald-800'
                                : tx.transaction_type === 'RESERVE'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {tx.transaction_type}
                          </span>
                        </td>
                        <td
                          className={`px-6 py-4 font-mono font-bold ${
                            tx.amount_inr > 0 ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {tx.amount_inr > 0 ? `+₹${tx.amount_inr.toFixed(2)}` : `-₹${Math.abs(tx.amount_inr).toFixed(2)}`}
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-slate-900">
                          ₹{tx.balance_after_inr.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 font-mono text-[11px] text-slate-500 max-w-[150px] truncate">
                          {tx.idempotency_key}
                        </td>
                        <td className="px-6 py-4 text-slate-600 max-w-[280px]">
                          {tx.description}
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                          {new Date(tx.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Security & Operational Audit Logs</h2>
              <p className="text-xs text-slate-500">Immutable record of tenant activities, agent configurations, and calls</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-4 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900 font-mono">{log.action}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">
                          {log.resource_type}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px]">
                        By: {log.user_email || 'System / API'} • Resource: {log.resource_id}
                      </p>
                    </div>

                    <div className="text-slate-400 text-[11px]">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: INTERACTIVE AGENT SIMULATOR (No phone call needed!) */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl flex flex-col h-[600px] overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{showSimulateModal.name}</h3>
                  <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                    <span className="text-emerald-600 font-semibold">● Simulated Voice Mode</span>
                    <span>•</span>
                    <span>Persona: {showSimulateModal.voice_persona}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowSimulateModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/40">
              {simChatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${
                      msg.speaker === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-sm'
                    }`}
                  >
                    <p className="leading-relaxed font-normal">{msg.text}</p>
                    {msg.latencyMs !== undefined && (
                      <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                        <span>Latency: {msg.latencyMs}ms</span>
                        {msg.matchedFaq && (
                          <span className="text-indigo-600 font-semibold">FAQ Matched</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {simLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2 text-xs text-slate-400 flex items-center space-x-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                    <span>AI generating response...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Telugu prompts suggestions */}
            <div className="p-2 border-t border-slate-100 bg-slate-50 flex items-center space-x-1 overflow-x-auto text-[11px]">
              <span className="text-slate-400 px-1 font-medium">Quick Prompts:</span>
              <button
                type="button"
                onClick={() => setSimTurnInput('నమస్కారం! క్లినిక్ సమయాలు ఏమిటి?')}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-full hover:border-indigo-400 text-slate-700 whitespace-nowrap"
              >
                క్లినిక్ సమయాలు (Clinic Timings)
              </button>
              <button
                type="button"
                onClick={() => setSimTurnInput('డాక్టర్ అపాయింట్‌మెంట్ బుక్ చేయండి')}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-full hover:border-indigo-400 text-slate-700 whitespace-nowrap"
              >
                అపాయింట్‌మెంట్ (Appointment)
              </button>
              <button
                type="button"
                onClick={() => setSimTurnInput('కన్సల్టేషన్ ఫీజు ఎంత?')}
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-full hover:border-indigo-400 text-slate-700 whitespace-nowrap"
              >
                కన్సల్టేషన్ ఫీజు (Consultation Fee)
              </button>
            </div>

            {/* Input Footer */}
            <form onSubmit={handleSendSimTurn} className="p-3 border-t border-slate-200 bg-white flex items-center space-x-2">
              <input
                type="text"
                value={simTurnInput}
                onChange={(e) => setSimTurnInput(e.target.value)}
                placeholder="Type in Telugu or English (e.g. సమయాలు ఏమిటి? or Hello)..."
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!simTurnInput.trim() || simLoading}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: FULL CALL SIMULATOR */}
      {showCallModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <PhoneCall className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">Simulate End-to-End Voice Call</h3>
              </div>
              <button onClick={() => setShowCallModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Simulates the full call lifecycle: DND validation, credit reservation, ringing, bilingual Telugu/English conversation, hang-up, and ledger reconciliation at ₹3.50/min.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Select Voice Agent</label>
                <select
                  value={callAgentId}
                  onChange={(e) => setCallAgentId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.languages.join(', ')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Recipient Phone Number</label>
                <input
                  type="text"
                  value={callPhone}
                  onChange={(e) => setCallPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-900 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Tip: +919848022338 is consented in seed data. +919849099999 is in DND suppression.
                </p>
              </div>

              <button
                onClick={handleSimulateFullCall}
                disabled={callInProgress}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm transition flex items-center justify-center space-x-2"
              >
                {callInProgress ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Executing Call Lifecycle Simulation...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Dispatch Simulated Call</span>
                  </>
                )}
              </button>
            </div>

            {callSimResult && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2 text-emerald-950">
                <div className="font-bold flex items-center space-x-1.5 text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Call Completed & Settled!</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>Duration: <strong>{callSimResult.durationSeconds}s</strong></div>
                  <div>Billable: <strong>{callSimResult.billableMinutes} min</strong></div>
                  <div>Reserved: <strong>₹{callSimResult.reservationInr.toFixed(2)}</strong></div>
                  <div>Final Cost: <strong>₹{callSimResult.costInr.toFixed(2)}</strong></div>
                  <div>Refunded Credit: <strong>₹{callSimResult.refundedInr.toFixed(2)}</strong></div>
                  <div>New Balance: <strong>₹{callSimResult.finalBalanceInr.toFixed(2)}</strong></div>
                </div>
                <p className="text-[11px] text-emerald-700 pt-1">
                  Generated {callSimResult.transcripts?.length} dialogue turns in Telugu. View details in the Calls tab!
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 3: CALL DETAIL & TRANSCRIPT DRAWER */}
      {selectedCallDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Call Record: {selectedCallDetail.phone_number}
                </h3>
                <p className="text-xs text-slate-500">
                  Agent: {selectedCallDetail.agent_name} • Duration: {selectedCallDetail.duration_seconds}s ({selectedCallDetail.billable_minutes} billable min) • Cost: ₹{selectedCallDetail.cost_inr.toFixed(2)}
                </p>
              </div>
              <button onClick={() => setSelectedCallDetail(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Audio Placeholder */}
              <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">Private Object Storage Recording</span>
                    <span className="text-[11px] text-slate-500">AES-256 Encrypted • Short-lived Signed URL</span>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded text-[11px] font-mono">
                  01:15
                </span>
              </div>

              {/* Lifecycle Events */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Normalized Lifecycle Events
                </h4>
                <div className="space-y-1.5">
                  {selectedCallDetail.events?.map((evt: any) => (
                    <div key={evt.id} className="text-xs font-mono p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between">
                      <span className="font-semibold text-indigo-700">{evt.event_type}</span>
                      <span className="text-slate-400 text-[10px]">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dialogue Transcripts */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Telugu + English Bilingual Transcript
                </h4>
                <div className="space-y-3">
                  {selectedCallDetail.transcripts?.map((turn: any) => (
                    <div
                      key={turn.id}
                      className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3 text-xs shadow-sm ${
                          turn.speaker === 'user'
                            ? 'bg-slate-800 text-white rounded-br-sm'
                            : 'bg-indigo-50/80 border border-indigo-100 text-indigo-950 rounded-bl-sm'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] opacity-75 mb-1">
                          <span className="font-bold uppercase">{turn.speaker}</span>
                          <span>{turn.language} • {turn.latency_ms}ms</span>
                        </div>
                        <p className="leading-relaxed font-normal">{turn.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: NEW VOICE AGENT */}
      {showNewAgentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Bot className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">Create Bilingual Voice Agent</h3>
              </div>
              <button onClick={() => setShowNewAgentModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ఆరోగ్య సంరక్షకుడు (Care Assistant)"
                  value={agentForm.name}
                  onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">System Prompt & Instructions</label>
                <textarea
                  required
                  rows={3}
                  placeholder="You are an empathetic, bilingual AI assistant for Hyderabad patients. Greet with నమస్కారం..."
                  value={agentForm.prompt}
                  onChange={(e) => setAgentForm({ ...agentForm, prompt: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Voice Persona</label>
                  <select
                    value={agentForm.voice_persona}
                    onChange={(e) => setAgentForm({ ...agentForm, voice_persona: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-slate-900 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="telugu-female-friendly">Telugu Female Friendly</option>
                    <option value="telugu-male-formal">Telugu Male Formal</option>
                    <option value="telugu-female-professional">Telugu Female Professional</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Languages</label>
                  <input
                    type="text"
                    disabled
                    value="Telugu (te-IN) + Indian English"
                    className="w-full border border-slate-200 bg-slate-50 rounded-xl p-2.5 text-slate-500"
                  />
                </div>
              </div>

              {/* FAQ Knowledge Base Item */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <span className="font-semibold text-slate-800 block text-[11px]">Primary Telugu FAQ Knowledge Base</span>
                <input
                  type="text"
                  placeholder="Question: క్లినిక్ సమయాలు ఏమిటి? (What are clinic hours?)"
                  value={agentForm.faq_question}
                  onChange={(e) => setAgentForm({ ...agentForm, faq_question: e.target.value })}
                  className="w-full border border-slate-200 bg-white rounded-lg p-2 text-slate-900"
                />
                <input
                  type="text"
                  placeholder="Answer: మా క్లినిక్ ఉదయం 8 నుండి రాత్రి 8 వరకు తెరిచి ఉంటుంది."
                  value={agentForm.faq_answer}
                  onChange={(e) => setAgentForm({ ...agentForm, faq_answer: e.target.value })}
                  className="w-full border border-slate-200 bg-white rounded-lg p-2 text-slate-900"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-sm transition"
              >
                Deploy Voice Agent (v1)
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: TOP UP CREDITS */}
      {showTopupModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Add Pre-Paid Credits</h3>
              <button onClick={() => setShowTopupModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Select credit amount to top up to your organization balance. AI voice calls deduct ₹3.50/min from this balance.
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[500, 1000, 2500].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setTopupAmount(amt)}
                  className={`py-3 rounded-xl border text-xs font-bold transition ${
                    topupAmount === amt
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  ₹{amt}
                </button>
              ))}
            </div>

            <button
              onClick={handleTopup}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-sm transition"
            >
              Confirm Top-Up (₹{topupAmount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
