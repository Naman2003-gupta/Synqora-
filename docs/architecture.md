# Architecture
Client -> Express API -> PostgreSQL (order + outbox in one transaction)
Outbox poller -> RabbitMQ durable queue -> Worker -> mock SAP OData
Worker -> PostgreSQL transaction status + dead-letter registry
React dashboard -> Express read APIs

Delivery guarantee: at-least-once. Downstream must be idempotent. See README for production limitations.
