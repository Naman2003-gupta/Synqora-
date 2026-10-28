import request from 'supertest';
import { app } from './app';

describe('API health and order validation', () => {
  test('health responds', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api' });
  });

  test('rejects invalid order input before accessing the database', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .send({ customerId: '', items: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  test('requires an idempotency key for valid orders', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .send({
        customerId: 'ACME',
        items: [{ productId: 'SKU-1', quantity: 2, unitPrice: 50 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Idempotency-Key/);
  });
});
