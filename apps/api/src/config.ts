import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgrespassword@localhost:5432/voice_saas',
  webhookSecret: process.env.VOICE_WEBHOOK_SECRET || 'voice-mock-secret-key-1234',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
