import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/api/client.ts';

test('client request triggers onUnauthorized on 401 for protected endpoints', async () => {
  let unauthorizedCalled = false;
  const mockFetch = async () =>
    new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  const client = createApiClient({
    baseUrl: 'http://test',
    fetchImpl: mockFetch as any,
    onUnauthorized: () => {
      unauthorizedCalled = true;
    },
  });

  await assert.rejects(
    () => client.listMedications(),
    (err: any) => err instanceof ApiError && err.status === 401,
  );

  assert.equal(unauthorizedCalled, true, 'onUnauthorized callback was invoked');
});

test('client request does NOT trigger onUnauthorized on 401 for /auth/login', async () => {
  let unauthorizedCalled = false;
  const mockFetch = async () =>
    new Response(JSON.stringify({ error: 'Invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  const client = createApiClient({
    baseUrl: 'http://test',
    fetchImpl: mockFetch as any,
    onUnauthorized: () => {
      unauthorizedCalled = true;
    },
  });

  await assert.rejects(
    () => client.login({ identifier: 'wrong', password: 'bad' }),
    (err: any) => err instanceof ApiError && err.status === 401,
  );

  assert.equal(unauthorizedCalled, false, 'onUnauthorized should not be called for login failures');
});
