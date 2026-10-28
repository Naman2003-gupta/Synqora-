# Interview talking points
1. Why asynchronous? SAP outages should not block order acceptance.
2. Why outbox? Avoid database write succeeding while publish is lost.
3. Why idempotency? Client retries and message redelivery must not create duplicate orders.
4. Why retries and DLQ? Transient errors recover automatically; permanent failures need operator intervention.
5. Tradeoff: eventual consistency. Order is PENDING before SAP confirms.
6. Limitations: local mock OData, single poller, no distributed tracing or production RBAC.
