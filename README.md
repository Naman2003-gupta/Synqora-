# Enterprise SAP Integration & Reliability Platform

Full-stack local SAP-style integration demonstration: Express + TypeScript, PostgreSQL/Prisma, RabbitMQ, mock SAP OData, React dashboard, retry and dead-letter tracking.

## Quick start (Docker Desktop required)

```bash
npm install
# PowerShell: Copy-Item .env.example .env
# macOS/Linux: cp .env.example .env
# Edit JWT_SECRET, ADMIN_USER and ADMIN_PASSWORD in .env
npm run stack:up
```

Start Docker Desktop first and wait until its engine is running. `stack:up` builds and starts the services, then waits for the dashboard's API and its database/SAP dependencies to become healthy.

Open **http://localhost:5173** (dashboard), **http://localhost:4000/api/v1/health** (API), **http://localhost:4001/health** (mock SAP), **http://localhost:15672** (RabbitMQ management, guest/guest).

Click **New demo order**. The API commits the order and outbox event atomically. The worker publishes pending outbox events to RabbitMQ, consumes the event, posts to mock SAP and updates transaction status. Refresh or wait five seconds to see the status.

To stop the services without deleting the database volume, run `npm run stack:down`. To inspect startup or processing errors, run `docker compose logs -f api worker mock-sap`.

## Example API request

```bash
curl -X POST http://localhost:4000/api/v1/orders -H 'Content-Type: application/json' -H 'Idempotency-Key: example-123' -d '{"customerId":"ACME","items":[{"productId":"SKU-1","quantity":2,"unitPrice":50}]}'
```

To test failures: set `SAP_FAILURE_RATE=1` in `.env`, then run `docker compose up -d --force-recreate mock-sap`. Create an order and wait for retries. Set it back to `0` and restart mock-sap. Click **Retry** on a failed transaction, logging in with `ADMIN_USER` and `ADMIN_PASSWORD` (defaults admin/admin123 for local demo only).

## API routes

- POST `/api/v1/auth/login` (admin credentials)
- GET `/api/v1/health`
- POST `/api/v1/orders` (requires `Idempotency-Key`)
- GET `/api/v1/orders`, GET `/api/v1/orders/:id`
- GET `/api/v1/transactions`, GET `/api/v1/transactions/:id`
- POST `/api/v1/transactions/:id/retry` (Bearer admin token)
- GET `/api/v1/dead-letter`, POST `/api/v1/dead-letter/:id/replay` (Bearer admin token for replay)
- GET `/api/v1/dashboard/stats`, GET `/api/v1/integrations/sap/health`

## Design notes and limits

- **Mock SAP** emulates a small OData-like JSON surface, not a certified SAP implementation. Real SAP requires destination credentials, CSRF handling, metadata-specific mapping, TLS and authorization.
- The transactional outbox prevents missing database events but publishing and marking as published is **at least once**, so duplicates are possible. The mock SAP is idempotent by order ID.
- Retries use bounded exponential delays. After three failed attempts, a database dead-letter record is created. This is a demo dead-letter registry, not a RabbitMQ DLX.
- Redis is provisioned as an extension point; it is **not used** by the current processing path. PostgreSQL transaction uniqueness handles order idempotency.
- Dashboard login is requested on retry. Other read endpoints are intentionally open for local demonstration and must be secured before any real deployment.
- `prisma db push` bootstraps a local schema. Use reviewed versioned migrations for production.
- Outbox polling is intentionally single-worker oriented. Multi-replica production deployment requires claim/lease coordination, stronger delivery semantics, observability and resilience testing.
- Docker Desktop is required to validate the full stack. No actual SAP instance is needed.

## Local checks

```bash
npm test
npm run build -w @sap/dashboard
npx prisma validate
```
