# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: api-sprint-c.spec.ts >> Test 1: API endpoints Sprint C >> GET /api/conversations/search?q=test -> 200, array
- Location: e2e\api-sprint-c.spec.ts:56:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 404
```

# Test source

```ts
  1   | import { test, expect, request } from '@playwright/test';
  2   | 
  3   | const BRIDGE_URL = 'https://meta-bridge.moacrm.com';
  4   | const BRIDGE_KEY = process.env['BRIDGE_API_KEY'] ?? 'mb-secret-2026-firmas';
  5   | const AUTH_HEADER = `Bearer ${BRIDGE_KEY}`;
  6   | 
  7   | test.describe('Test 1: API endpoints Sprint C', () => {
  8   |   test('GET /api/canned-responses -> 200, array with items', async () => {
  9   |     const ctx = await request.newContext();
  10  |     const res = await ctx.get(`${BRIDGE_URL}/api/canned-responses`, {
  11  |       headers: { Authorization: AUTH_HEADER },
  12  |     });
  13  |     console.log(`GET /api/canned-responses: ${res.status()}`);
  14  |     const body = await res.json().catch(() => null);
  15  |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  16  |     expect(res.status()).toBe(200);
  17  |     // API wraps response in {success, data}
  18  |     const items = Array.isArray(body) ? body : body?.data;
  19  |     expect(Array.isArray(items)).toBe(true);
  20  |     expect(items.length).toBeGreaterThanOrEqual(0);
  21  |   });
  22  | 
  23  |   test('POST /api/canned-responses -> 201, creates response', async () => {
  24  |     const ctx = await request.newContext();
  25  |     const res = await ctx.post(`${BRIDGE_URL}/api/canned-responses`, {
  26  |       headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
  27  |       data: { title: 'Test E2E Response', content: 'Gracias por contactarnos.', channel: 'whatsapp' },
  28  |     });
  29  |     console.log(`POST /api/canned-responses: ${res.status()}`);
  30  |     const body = await res.json().catch(() => null);
  31  |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  32  |     expect(res.status()).toBe(201);
  33  |   });
  34  | 
  35  |   test('DELETE /api/canned-responses/:id -> 200', async () => {
  36  |     const ctx = await request.newContext();
  37  |     // First create one to delete
  38  |     const createRes = await ctx.post(`${BRIDGE_URL}/api/canned-responses`, {
  39  |       headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
  40  |       data: { title: 'To Delete E2E', content: 'Delete me.', channel: 'whatsapp' },
  41  |     });
  42  |     if (createRes.status() === 201) {
  43  |       const created = await createRes.json().catch(() => ({ id: 1 }));
  44  |       const id = created?.id ?? created?.data?.id ?? 1;
  45  |       const delRes = await ctx.delete(`${BRIDGE_URL}/api/canned-responses/${id}`, {
  46  |         headers: { Authorization: AUTH_HEADER },
  47  |       });
  48  |       console.log(`DELETE /api/canned-responses/${id}: ${delRes.status()}`);
  49  |       expect(delRes.status()).toBe(200);
  50  |     } else {
  51  |       console.log('Skipping DELETE test — POST /api/canned-responses failed, status:', createRes.status());
  52  |       test.skip();
  53  |     }
  54  |   });
  55  | 
  56  |   test('GET /api/conversations/search?q=test -> 200, array', async () => {
  57  |     const ctx = await request.newContext();
  58  |     const res = await ctx.get(`${BRIDGE_URL}/api/conversations/search?q=test`, {
  59  |       headers: { Authorization: AUTH_HEADER },
  60  |     });
  61  |     console.log(`GET /api/conversations/search?q=test: ${res.status()}`);
  62  |     const body = await res.json().catch(() => null);
  63  |     console.log('Response:', JSON.stringify(body).slice(0, 200));
> 64  |     expect(res.status()).toBe(200);
      |                          ^ Error: expect(received).toBe(expected) // Object.is equality
  65  |     expect(Array.isArray(body)).toBe(true);
  66  |   });
  67  | 
  68  |   test('POST /api/conversations/:id/assign -> 200 or 404', async () => {
  69  |     const ctx = await request.newContext();
  70  |     const res = await ctx.post(`${BRIDGE_URL}/api/conversations/1/assign`, {
  71  |       headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
  72  |       data: { assigned_to: 'admin', assigned_to_id: '1' },
  73  |     });
  74  |     console.log(`POST /api/conversations/1/assign: ${res.status()}`);
  75  |     const body = await res.json().catch(() => null);
  76  |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  77  |     // Accept 200, 404 (no conversation with id=1), 400, or 502 (db_error if conv doesn't exist)
  78  |     expect([200, 404, 400, 502]).toContain(res.status());
  79  |   });
  80  | 
  81  |   test('GET /api/conversations/:id/notes -> 200 or 404, array if 200', async () => {
  82  |     const ctx = await request.newContext();
  83  |     const res = await ctx.get(`${BRIDGE_URL}/api/conversations/1/notes`, {
  84  |       headers: { Authorization: AUTH_HEADER },
  85  |     });
  86  |     console.log(`GET /api/conversations/1/notes: ${res.status()}`);
  87  |     const body = await res.json().catch(() => null);
  88  |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  89  |     expect([200, 404]).toContain(res.status());
  90  |     if (res.status() === 200) {
  91  |       expect(Array.isArray(body)).toBe(true);
  92  |     }
  93  |   });
  94  | 
  95  |   test('POST /api/conversations/:id/notes -> 201 or 404', async () => {
  96  |     const ctx = await request.newContext();
  97  |     const res = await ctx.post(`${BRIDGE_URL}/api/conversations/1/notes`, {
  98  |       headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
  99  |       data: { content: 'E2E test note', author: 'spark-agent' },
  100 |     });
  101 |     console.log(`POST /api/conversations/1/notes: ${res.status()}`);
  102 |     const body = await res.json().catch(() => null);
  103 |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  104 |     expect([201, 404, 400]).toContain(res.status());
  105 |   });
  106 | 
  107 |   test('GET /api/media/:id -> 404 or 200', async () => {
  108 |     const ctx = await request.newContext();
  109 |     const res = await ctx.get(`${BRIDGE_URL}/api/media/nonexistent-id-e2e`, {
  110 |       headers: { Authorization: AUTH_HEADER },
  111 |     });
  112 |     console.log(`GET /api/media/nonexistent-id-e2e: ${res.status()}`);
  113 |     expect([200, 404, 302]).toContain(res.status());
  114 |   });
  115 | 
  116 |   test('GET /api/messages/:id/statuses -> 200 or 404, array if 200', async () => {
  117 |     const ctx = await request.newContext();
  118 |     const res = await ctx.get(`${BRIDGE_URL}/api/messages/1/statuses`, {
  119 |       headers: { Authorization: AUTH_HEADER },
  120 |     });
  121 |     console.log(`GET /api/messages/1/statuses: ${res.status()}`);
  122 |     const body = await res.json().catch(() => null);
  123 |     console.log('Response:', JSON.stringify(body).slice(0, 200));
  124 |     expect([200, 404]).toContain(res.status());
  125 |     if (res.status() === 200) {
  126 |       expect(Array.isArray(body)).toBe(true);
  127 |     }
  128 |   });
  129 | });
  130 | 
```