import crypto from 'crypto';

export interface AgentConfig {
  name: string;
  prompt: string;
  languages: string[];
  voicePersona?: string;
  faqKnowledge?: Array<{ question: string; answer: string; language: string }>;
}

export interface AgentRef {
  providerAgentId: string;
  status: 'ready' | 'deploying' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface StartCallInput {
  callId: string;
  organizationId: string;
  providerAgentId?: string;
  phoneNumber: string;
  agentPrompt: string;
  languages: string[];
  voicePersona?: string;
  faqKnowledge?: Array<{ question: string; answer: string; language: string }>;
}

export interface CallRef {
  providerCallId: string;
  status: 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'failed';
  initiatedAt: Date;
}

export interface SimulatedDialogueTurn {
  speaker: 'agent' | 'user' | 'system';
  text: string;
  language: string;
  latencyMs: number;
}

export interface NormalizedCallEvent {
  providerCallId: string;
  eventType: 'call.initiated' | 'call.ringing' | 'call.answered' | 'call.transcript' | 'call.ended' | 'call.completed' | 'call.failed';
  timestamp: Date;
  durationSeconds?: number;
  billableMinutes?: number;
  disconnectReason?: string;
  transcriptTurn?: SimulatedDialogueTurn;
  rawPayload: any;
}

export interface VoiceProvider {
  readonly providerName: string;
  createAgent(config: AgentConfig): Promise<AgentRef>;
  startCall(input: StartCallInput): Promise<CallRef>;
  endCall(providerCallId: string): Promise<void>;
  verifyWebhook(headers: Record<string, string | undefined>, rawBody: Buffer | string): Promise<boolean>;
  parseWebhookEvent(body: any): NormalizedCallEvent;
  generateSimulatedTurn(input: {
    agentPrompt: string;
    faqKnowledge?: Array<{ question: string; answer: string; language?: string }>;
    userMessage: string;
    conversationHistory?: Array<{ speaker: 'agent' | 'user' | 'system'; text: string }>;
  }): Promise<{
    replyText: string;
    language: string;
    latencyMs: number;
    matchedFaq: boolean;
  }>;
  generateFullSimulatedCallScript(input: {
    agentPrompt: string;
    faqKnowledge?: Array<{ question: string; answer: string; language?: string }>;
    callerName?: string;
    topic?: string;
  }): Array<SimulatedDialogueTurn>;
}

export class MockVoiceProvider implements VoiceProvider {
  readonly providerName = 'mock';
  private webhookSecret = process.env.VOICE_WEBHOOK_SECRET || 'voice-mock-secret-key-1234';

  async createAgent(config: AgentConfig): Promise<AgentRef> {
    const providerAgentId = `mock-agent-${crypto.randomBytes(6).toString('hex')}`;
    return {
      providerAgentId,
      status: 'ready',
      metadata: {
        registeredLanguages: config.languages,
        voicePersona: config.voicePersona || 'telugu-female-friendly',
        deployedAt: new Date().toISOString(),
      },
    };
  }

  async startCall(input: StartCallInput): Promise<CallRef> {
    const providerCallId = `mock-call-${crypto.randomBytes(8).toString('hex')}`;
    return {
      providerCallId,
      status: 'initiated',
      initiatedAt: new Date(),
    };
  }

  async endCall(providerCallId: string): Promise<void> {
    // In mock provider, call ends immediately
    return Promise.resolve();
  }

  async verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer | string
  ): Promise<boolean> {
    const signature = headers['x-provider-signature'] || headers['X-Provider-Signature'];
    if (!signature) {
      // In dev/mock testing without strict signature header, allow if bypass header or dev environment
      if (process.env.NODE_ENV !== 'production' && headers['x-mock-test'] === 'true') {
        return true;
      }
      return false;
    }

    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  createSignature(rawBody: string): string {
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
  }

  parseWebhookEvent(body: any): NormalizedCallEvent {
    const eventType = body.event_type || 'call.ended';
    return {
      providerCallId: body.provider_call_id || body.call_id || 'unknown',
      eventType,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
      durationSeconds: typeof body.duration_seconds === 'number' ? body.duration_seconds : 0,
      billableMinutes: Math.ceil((body.duration_seconds || 0) / 60),
      disconnectReason: body.disconnect_reason || 'normal_clearing',
      transcriptTurn: body.transcript_turn,
      rawPayload: body,
    };
  }

  async generateSimulatedTurn(input: {
    agentPrompt: string;
    faqKnowledge?: Array<{ question: string; answer: string; language?: string }>;
    userMessage: string;
    conversationHistory?: Array<{ speaker: 'agent' | 'user' | 'system'; text: string }>;
  }): Promise<{
    replyText: string;
    language: string;
    latencyMs: number;
    matchedFaq: boolean;
  }> {
    const userTextLower = input.userMessage.toLowerCase();
    const faqs = input.faqKnowledge || [];

    // Check if user query matches any FAQ item
    for (const faq of faqs) {
      const qWords = faq.question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const isMatch = qWords.some((word) => userTextLower.includes(word));
      if (isMatch) {
        return {
          replyText: faq.answer,
          language: faq.language || 'te-IN',
          latencyMs: 380 + Math.floor(Math.random() * 150),
          matchedFaq: true,
        };
      }
    }

    // Keyword matching for typical Telugu & English customer queries
    if (userTextLower.includes('నమస్కారం') || userTextLower.includes('hello') || userTextLower.includes('hi')) {
      return {
        replyText: 'నమస్కారం అండి! నేను మీకు ఎలా సహాయపడగలను? (Hello! How may I assist you today?)',
        language: 'mixed',
        latencyMs: 420,
        matchedFaq: false,
      };
    }

    if (userTextLower.includes('సమయం') || userTextLower.includes('timing') || userTextLower.includes('hours') || userTextLower.includes('time')) {
      return {
        replyText: 'మా పని వేళలు సోమవారం నుండి శనివారం వరకు ఉదయం 8:00 నుండి రాత్రి 8:00 వరకు ఉంటాయి.',
        language: 'te-IN',
        latencyMs: 460,
        matchedFaq: false,
      };
    }

    if (userTextLower.includes('appointment') || userTextLower.includes('అపాయింట్‌మెంట్') || userTextLower.includes('booking') || userTextLower.includes('బుకింగ్')) {
      return {
        replyText: 'తప్పకుండా అండి! నేను మీ అపాయింట్‌మెంట్ షెడ్యూల్ చేస్తాను. మీకు ఉదయం లేదా సాయంత్రం స్లాట్ అనుకూలమా?',
        language: 'te-IN',
        latencyMs: 490,
        matchedFaq: false,
      };
    }

    if (userTextLower.includes('fee') || userTextLower.includes('ఫీజు') || userTextLower.includes('cost') || userTextLower.includes('ఖర్చు')) {
      return {
        replyText: 'కన్సల్టేషన్ ఫీజు ₹500 మాత్రమే. మీరు UPI లేదా నగదు ద్వారా చెల్లించవచ్చు.',
        language: 'mixed',
        latencyMs: 440,
        matchedFaq: false,
      };
    }

    if (userTextLower.includes('emi') || userTextLower.includes('loan') || userTextLower.includes('payment') || userTextLower.includes('డబ్బు')) {
      return {
        replyText: 'మీ లోన్ వివరాలు మరియు EMI స్టేటస్ సరిచూసాను. మీ చెల్లింపు లింక్ SMS ద్వారా పంపబడింది.',
        language: 'mixed',
        latencyMs: 480,
        matchedFaq: false,
      };
    }

    if (userTextLower.includes('thanks') || userTextLower.includes('ధన్యవాదాలు') || userTextLower.includes('thank you') || userTextLower.includes('bye')) {
      return {
        replyText: 'చాలా ధన్యవాదాలు అండి! మీకు మంచి రోజు కావాలని కోరుకుంటున్నాము. నమస్కారం! (Thank you, have a great day!)',
        language: 'mixed',
        latencyMs: 390,
        matchedFaq: false,
      };
    }

    // Default polite bilingual response
    return {
      replyText: 'ధన్యవాదాలు, మీ అభ్యర్థనను నమోదు చేసుకున్నాను. మా ప్రతినిధి మరింత సమాచారంతో మిమ్మల్ని సంప్రదిస్తారు. (Thank you, your request has been noted.)',
      language: 'mixed',
      latencyMs: 510,
      matchedFaq: false,
    };
  }

  generateFullSimulatedCallScript(input: {
    agentPrompt: string;
    faqKnowledge?: Array<{ question: string; answer: string; language?: string }>;
    callerName?: string;
    topic?: string;
  }): Array<SimulatedDialogueTurn> {
    const caller = input.callerName || 'గౌరవనీయ కస్టమర్';
    return [
      {
        speaker: 'agent',
        text: `నమస్కారం ${caller} గారు! నేను మీ AI అసిస్టెంట్‌ని మాట్లాడుతున్నాను. నేను మీకు ఎలా సహాయపడగలను?`,
        language: 'te-IN',
        latencyMs: 420,
      },
      {
        speaker: 'user',
        text: 'నమస్కారం అండి, నాకు డాక్టర్ అపాయింట్‌మెంట్ సమయాల గురించి వివరాలు కావాలి.',
        language: 'te-IN',
        latencyMs: 0,
      },
      {
        speaker: 'agent',
        text: 'ఖచ్చితంగా అండి! మా స్పెషలిస్ట్ డాక్టర్లు సోమవారం నుండి శనివారం ఉదయం 9 నుండి మధ్యాహ్నం 1 గంట వరకు, మరియు సాయంత్రం 5 నుండి రాత్రి 8 గంటల వరకు అందుబాటులో ఉంటారు. మీకు రేపు ఉదయం 10:30 స్లాట్ కేటాయించమంటారా?',
        language: 'te-IN',
        latencyMs: 480,
      },
      {
        speaker: 'user',
        text: 'అవును, రేపు ఉదయం 10:30 గంటలకు బుక్ చేయండి. అలాగే కన్సల్టేషన్ ఫీజు ఎంత ఉంటుంది?',
        language: 'te-IN',
        latencyMs: 0,
      },
      {
        speaker: 'agent',
        text: 'రేపు ఉదయం 10:30 గంటలకు మీ అపాయింట్‌మెంట్ కన్ఫర్మ్ చేయబడింది. కన్సల్టేషన్ ఫీజు ₹500 మాత్రమే. వివరాలు మీ మొబైల్‌కు SMS ద్వారా పంపించాము. ఇంకేమైనా సహాయం కావాలా అండి?',
        language: 'mixed',
        latencyMs: 510,
      },
      {
        speaker: 'user',
        text: 'చాలా ధన్యవాదాలు, నాకు ఇంకేమీ అవసరం లేదు.',
        language: 'te-IN',
        latencyMs: 0,
      },
      {
        speaker: 'agent',
        text: 'ధన్యవాదాలు అండి! మీ ఆరోగ్యం జాగ్రత్తగా చూసుకోండి. నమస్కారం!',
        language: 'te-IN',
        latencyMs: 390,
      },
    ];
  }
}

// Registry of provider adapters
const providers: Record<string, VoiceProvider> = {
  mock: new MockVoiceProvider(),
};

export function getVoiceProvider(type: string = 'mock'): VoiceProvider {
  const provider = providers[type.toLowerCase()] || providers['mock'];
  return provider;
}
