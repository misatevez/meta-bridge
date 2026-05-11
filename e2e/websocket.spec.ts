import { test, expect, request } from '@playwright/test';

const BRIDGE_URL = 'https://meta-bridge.moacrm.com';

test.describe('Test 4: WebSocket connectivity', () => {
  test('GET /ws-status -> ok', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BRIDGE_URL}/ws-status`);
    const body = await res.json().catch(() => null);
    console.log(`GET /ws-status: ${res.status()} - ${JSON.stringify(body)}`);
    expect(res.status()).toBe(200);
    expect(body?.status).toBe('ok');
  });

  test('GET /health -> ok', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BRIDGE_URL}/health`);
    const body = await res.json().catch(() => null);
    console.log(`GET /health: ${res.status()} - ${JSON.stringify(body)}`);
    expect(res.status()).toBe(200);
    expect(body?.status).toBe('ok');
  });
});
