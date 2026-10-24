import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { tenantAuthMiddleware } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { agentsRouter } from './routes/agents.js';
import { callsRouter } from './routes/calls.js';
import { billingRouter } from './routes/billing.js';
import { contactsRouter } from './routes/contacts.js';
import { campaignsRouter } from './routes/campaigns.js';
import { webhooksRouter } from './routes/webhooks.js';
import { auditRouter } from './routes/audit.js';

export function createApp(): Express {
  const app = express();

  // Middleware for CORS
  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  // JSON parsing with raw body retention for HMAC webhook verification
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  // Health endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'voice-saas-api', timestamp: new Date().toISOString() });
  });

  // Webhooks are unauthenticated by user session, authenticated via provider HMAC signature
  app.use('/api/webhooks', webhooksRouter);

  // Multi-tenant protected routes
  app.use('/api/auth', tenantAuthMiddleware, authRouter);
  app.use('/api/organizations', tenantAuthMiddleware, authRouter);
  app.use('/api/agents', tenantAuthMiddleware, agentsRouter);
  app.use('/api/calls', tenantAuthMiddleware, callsRouter);
  app.use('/api/billing', tenantAuthMiddleware, billingRouter);
  app.use('/api/contacts', tenantAuthMiddleware, contactsRouter);
  app.use('/api/campaigns', tenantAuthMiddleware, campaignsRouter);
  app.use('/api/audit-logs', tenantAuthMiddleware, auditRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
    });
  });

  return app;
}
