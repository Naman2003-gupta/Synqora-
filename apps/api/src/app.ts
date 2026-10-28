import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

export const db = new PrismaClient();
export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 150 }));

const secret = process.env.JWT_SECRET || 'local-dev-only-change-this';
const orderSchema = z.object({
  customerId: z.string().min(1),
  currency: z.string().length(3).default('USD'),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().positive(),
  })).min(1),
});
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

const admin: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string' || decoded.role !== 'admin') return res.sendStatus(403);
    return next();
  } catch {
    return res.sendStatus(401);
  }
};

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', service: 'api' }));
app.get('/api/v1/health/ready', asyncRoute(async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  return res.json({ status: 'ready', service: 'api' });
}));

app.post('/api/v1/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Username and password are required' });

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  if (parsed.data.username !== username || parsed.data.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  return res.json({ token: jwt.sign({ sub: username, role: 'admin' }, secret, { expiresIn: '8h' }) });
});

app.post('/api/v1/orders', asyncRoute(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
  }

  const existing = await db.order.findUnique({
    where: { idempotencyKey },
    include: { items: true, transactions: true },
  });
  if (existing) return res.status(200).json(existing);

  const { data } = parsed;
  const total = data.items.reduce((amount, item) => amount + item.quantity * item.unitPrice, 0);

  try {
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber: `ORD-${randomUUID()}`,
          customerId: data.customerId,
          currency: data.currency,
          totalAmount: total,
          idempotencyKey,
          items: { create: data.items },
          transactions: { create: {} },
        },
        include: { items: true, transactions: true },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateId: created.id,
          eventType: 'ORDER_CREATED',
          payload: { orderId: created.id },
        },
      });
      return created;
    });

    return res.status(201).json(order);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await db.order.findUnique({
        where: { idempotencyKey },
        include: { items: true, transactions: true },
      });
      if (duplicate) return res.status(200).json(duplicate);
    }
    throw error;
  }
}));

app.get('/api/v1/orders', asyncRoute(async (_req, res) => {
  const orders = await db.order.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json(orders);
}));

app.get('/api/v1/orders/:id', asyncRoute(async (req, res) => {
  const order = await db.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, transactions: true },
  });
  return order ? res.json(order) : res.status(404).json({ error: 'Not found' });
}));

app.get('/api/v1/transactions', asyncRoute(async (_req, res) => {
  const transactions = await db.integrationTransaction.findMany({
    include: { order: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json(transactions);
}));

app.get('/api/v1/transactions/:id', asyncRoute(async (req, res) => {
  const transaction = await db.integrationTransaction.findUnique({
    where: { id: req.params.id },
    include: { order: true },
  });
  return transaction ? res.json(transaction) : res.status(404).json({ error: 'Not found' });
}));

app.get('/api/v1/dead-letter', asyncRoute(async (_req, res) => {
  const jobs = await db.deadLetterJob.findMany({ orderBy: { failedAt: 'desc' } });
  return res.json(jobs);
}));

async function retryTransaction(id: string) {
  return db.$transaction(async (tx) => {
    const transaction = await tx.integrationTransaction.findUnique({ where: { id } });
    if (!transaction || !['FAILED', 'RETRYING'].includes(transaction.status)) return null;

    await tx.integrationTransaction.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, lastError: null },
    });
    await tx.deadLetterJob.updateMany({
      where: { transactionId: id },
      data: { status: 'REPLAYED', retriedAt: new Date() },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateId: transaction.orderId,
        eventType: 'ORDER_CREATED',
        payload: { orderId: transaction.orderId },
      },
    });
    return { status: 'queued' };
  });
}

app.post('/api/v1/transactions/:id/retry', admin, asyncRoute(async (req, res) => {
  const result = await retryTransaction(req.params.id);
  return result ? res.status(202).json(result) : res.status(409).json({ error: 'Transaction not retryable' });
}));

app.post('/api/v1/dead-letter/:id/replay', admin, asyncRoute(async (req, res) => {
  const job = await db.deadLetterJob.findUnique({ where: { id: req.params.id } });
  if (!job || job.status !== 'OPEN') return res.status(409).json({ error: 'Job not replayable' });
  const result = await retryTransaction(job.transactionId);
  return result ? res.status(202).json(result) : res.status(409).json({ error: 'Job not replayable' });
}));

app.get('/api/v1/dashboard/stats', asyncRoute(async (_req, res) => {
  const [orders, transactions, failed, completed] = await Promise.all([
    db.order.count(),
    db.integrationTransaction.count(),
    db.integrationTransaction.count({ where: { status: 'FAILED' } }),
    db.integrationTransaction.count({ where: { status: 'COMPLETED' } }),
  ]);
  return res.json({ orders, transactions, failed, completed });
}));

app.get('/api/v1/integrations/sap/health', asyncRoute(async (_req, res) => {
  try {
    const response = await fetch(`${process.env.SAP_URL || 'http://localhost:4001'}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.status(response.ok ? 200 : 503).json({ connected: response.ok });
  } catch {
    return res.status(503).json({ connected: false });
  }
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
});
