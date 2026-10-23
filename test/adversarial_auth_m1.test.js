import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Accelerated scrypt for test suite
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_madera_adversarial.db');
process.env.DATABASE_PATH = testDbPath;

// Clean up any stale test database
try {
  fs.unlinkSync(testDbPath);
} catch {}

const { app, db } = await import('../server/server.js');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.unlinkSync(testDbPath);
  } catch {}
});

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

// ============================================================================
// 1. ADVERSARIAL BOUNDARY & INJECTION ATTACKS
// ============================================================================
test('Adversarial Boundary: Name field validation and sanitization', async () => {
  // Test 1: Name > 100 characters (101 and 1000 chars)
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'A'.repeat(101), email: 'len101@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400, 'Rejects 101-character name');

  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'X'.repeat(1000), email: 'len1000@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400, 'Rejects 1000-character name');

  // Test 2: Whitespace-only names (spaces, tabs, newlines)
  for (const ws of ['   ', '\t\t', '\n\r\n', ' \t \n ']) {
    res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: ws, email: 'ws@example.com', password: 'password123' }),
    });
    assert.equal(res.status, 400, `Rejects whitespace name: ${JSON.stringify(ws)}`);
  }

  // Test 3: Non-string types in name (objects, arrays, numbers, booleans)
  for (const invalidName of [12345, true, null, ['Alice'], { name: 'Alice' }]) {
    res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: invalidName, email: 'type@example.com', password: 'password123' }),
    });
    assert.equal(res.status, 400, `Rejects non-string name: ${typeof invalidName}`);
  }

  // Test 4: Unicode, accented, and multi-byte names (valid boundary)
  const unicodeNames = [
    'Élodie Müller',
    'José María Peña',
    'Александр Пушкин',
    '田中 太郎',
    'Ángel 🚀 Carpenter',
  ];
  for (let i = 0; i < unicodeNames.length; i++) {
    const uName = unicodeNames[i];
    res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: uName, email: `unicode_${i}@example.com`, password: 'password123' }),
    });
    assert.equal(res.status, 201, `Accepts valid Unicode name: ${uName}`);
    assert.equal(res.body.user.name, uName.trim());
  }

  // Test 5: Exact boundary lengths (2 chars valid, 100 chars valid, 1 char invalid)
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ab', email: 'boundary2@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 201, 'Accepts 2-character name');

  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Z'.repeat(100), email: 'boundary100@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 201, 'Accepts 100-character name');

  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Z', email: 'boundary1@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400, 'Rejects 1-character name');
});

test('Adversarial Boundary: SQL Injection payloads safely handled by SQLite parameterization', async () => {
  // Test SQL injection payloads in name
  const sqliPayloads = [
    "Robert'); DROP TABLE users;--",
    "' OR '1'='1",
    "admin' --",
    "1'; SELECT * FROM sessions; --",
  ];

  for (let i = 0; i < sqliPayloads.length; i++) {
    const payload = sqliPayloads[i];
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: payload, email: `sqli_name_${i}@example.com`, password: 'password123' }),
    });
    // Parameterized queries treat payload purely as literal text
    assert.equal(res.status, 201, 'SQL injection payload treated safely as literal text');
    assert.equal(res.body.user.name, payload.trim());

    // Verify database structure remains intact
    const usersTable = db.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='users'").get();
    assert.equal(usersTable.cnt, 1, 'Users table is intact and not dropped');
  }
});

test('Adversarial Boundary: Email validation and injection resistance', async () => {
  // Overly long email > 255 characters
  const longEmail = 'a'.repeat(250) + '@example.com';
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Long Email', email: longEmail, password: 'password123' }),
  });
  assert.equal(res.status, 400, 'Rejects email exceeding 255 chars');

  // Malformed emails & injection strings
  const badEmails = [
    'plainaddress',
    '@missingusername.com',
    'username@.com',
    'username@com',
    'user name@domain.com',
    'user\nname@domain.com',
    'user\r\nname@domain.com',
    "admin'--@domain.com",
    "admin' OR 1=1--@domain.com",
  ];

  for (const bad of badEmails) {
    res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad Email', email: bad, password: 'password123' }),
    });
    assert.equal(res.status, 400, `Rejects malformed email: ${bad}`);
  }
});

test('Adversarial Boundary: Password length limits and scrypt DoS mitigation', async () => {
  // Password > 128 characters (prevents CPU exhaustion DoS on scrypt)
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'DoS Test', email: 'dos@example.com', password: 'P'.repeat(129) }),
  });
  assert.equal(res.status, 400, 'Rejects password > 128 chars');

  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'DoS Test', email: 'dos2@example.com', password: 'P'.repeat(10000) }),
  });
  assert.equal(res.status, 400, 'Rejects 10,000 char password immediately without hashing');

  // Password < 6 characters
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Short Test', email: 'short@example.com', password: '12345' }),
  });
  assert.equal(res.status, 400, 'Rejects password < 6 chars');

  // Exact 6 characters (valid boundary)
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valid Min', email: 'min6@example.com', password: '123456' }),
  });
  assert.equal(res.status, 201, 'Accepts 6 char password');

  // Exact 128 characters (valid boundary)
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valid Max', email: 'max128@example.com', password: 'M'.repeat(128) }),
  });
  assert.equal(res.status, 201, 'Accepts 128 char password');
});

// ============================================================================
// 2. AUTHENTICATION BYPASS & SESSION HIJACKING CHALLENGES
// ============================================================================
test('Auth Bypass: Forged, tampered, and invalid session tokens are rejected with 401', async () => {
  const forgedTokens = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '../../etc/passwd',
    "' OR '1'='1",
    'null',
    'undefined',
    '',
    'token_does_not_exist',
  ];

  for (const token of forgedTokens) {
    // Via Bearer header
    let res = await api('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 401, `Rejects forged Bearer token: ${token}`);

    // Via Cookie header
    res = await api('/api/auth/me', {
      headers: { Cookie: `session=${token}` },
    });
    assert.equal(res.status, 401, `Rejects forged Cookie token: ${token}`);
  }
});

test('Auth Bypass: Expired session tokens cannot access protected resources and are pruned', async () => {
  // Create user
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Expiry Tester', email: 'expiry@example.com', password: 'password123' }),
  });
  const uid = reg.body.user.id;

  // Insert expired token
  const expiredToken = 'adversarial_expired_token_112233';
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    expiredToken,
    uid,
    Date.now() - 3600000,
    Date.now() - 1800000
  );

  // Attempt access
  const res = await api('/api/projects', {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(res.status, 401, 'Rejects expired session');
  assert.equal(res.body.error, 'Sesión expirada');

  // Verify DB pruning
  const check = db.prepare('SELECT * FROM sessions WHERE token = ?').get(expiredToken);
  assert.equal(check, undefined, 'Expired session was purged from sessions table');
});

test('Auth Bypass: Tampered cookie (appended or truncated hash) fails authentication', async () => {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tamper Tester', email: 'tamper@example.com', password: 'password123' }),
  });
  const validToken = reg.body.token;

  // Truncated token
  const truncated = validToken.slice(0, 16);
  let res = await api('/api/auth/me', {
    headers: { Cookie: `session=${truncated}` },
  });
  assert.equal(res.status, 401, 'Truncated session token is rejected');

  // Bit-flipped / modified token
  const modified = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');
  res = await api('/api/auth/me', {
    headers: { Cookie: `session=${modified}` },
  });
  assert.equal(res.status, 401, 'Modified session token is rejected');
});

test('Auth Bypass: Google OAuth account cannot be compromised via password login', async () => {
  // Create a user via Google mock
  const gRes = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Google User',
      email: 'oauth_only@example.com',
      google_id: 'google-sub-secure-999',
    }),
  });
  assert.equal(gRes.status, 200);

  // Attempt password login with empty password, random password, or null
  const attempts = ['password123', 'admin', 'null'];
  for (const pw of attempts) {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'oauth_only@example.com', password: pw }),
    });
    assert.equal(res.status, 401, `Rejects password login attempt: ${pw}`);
    if (pw) {
      assert.equal(res.body.error, 'Esta cuenta utiliza Google Sign-In');
    }
  }
  const emptyRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'oauth_only@example.com', password: '' }),
  });
  assert.ok(emptyRes.status === 400 || emptyRes.status === 401, 'Rejects empty password');
});

// ============================================================================
// 3. MULTI-USER ISOLATION & IDOR ADVERSARIAL CHALLENGES
// ============================================================================
test('Adversarial IDOR: Cross-user boundary violations strictly forbidden across all verbs', async () => {
  // Register User A (Alice)
  const aRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Alice Owner', email: 'alice@example.com', password: 'password123' }),
  });
  const aliceToken = aRes.body.token;

  // Register User B (Bob - Attacker)
  const bRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bob Attacker', email: 'bob@example.com', password: 'password123' }),
  });
  const bobToken = bRes.body.token;

  // Alice creates 2 projects
  const p1 = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}` },
    body: JSON.stringify({
      name: 'Alice Secret Wardrobe',
      description: 'Confidential blueprints',
      data: { blueprint: 'top-secret-specs-123' },
    }),
  });
  const projId = p1.body.id;

  // 1. Bob attempts unauthorized read (GET /api/projects/:id)
  let res = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(res.status, 404, 'Bob receives 404 on reading Alices project');

  // 2. Bob attempts unauthorized update (PUT /api/projects/:id)
  res = await api(`/api/projects/${projId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${bobToken}` },
    body: JSON.stringify({ name: 'Compromised Project', description: 'Hacked!' }),
  });
  assert.equal(res.status, 404, 'Bob receives 404 on updating Alices project');

  // Verify Alices project was untouched
  const aliceCheck = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.equal(aliceCheck.body.name, 'Alice Secret Wardrobe');
  assert.equal(aliceCheck.body.description, 'Confidential blueprints');

  // 3. Bob attempts unauthorized duplicate (POST /api/projects/:id/duplicate)
  res = await api(`/api/projects/${projId}/duplicate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(res.status, 404, 'Bob receives 404 on duplicating Alices project');

  // Verify Bob has 0 projects
  const bobList = await api('/api/projects', {
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(bobList.body.length, 0, 'Bob has 0 projects');

  // 4. Bob attempts unauthorized deletion (DELETE /api/projects/:id)
  res = await api(`/api/projects/${projId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bobToken}` },
  });
  assert.equal(res.status, 404, 'Bob receives 404 on deleting Alices project');

  // Alice verifies project still exists
  const aliceRecheck = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert.equal(aliceRecheck.status, 200, 'Alices project is still intact');

  // 5. Non-numeric and out-of-bounds project IDs return 404
  for (const badId of ['abc', 'NaN', '-1', '99999999', '0']) {
    res = await api(`/api/projects/${badId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(res.status, 404, `Invalid project ID ${badId} returns 404`);
  }
});

// ============================================================================
// 4. CONCURRENCY & COLLISION STRESS
// ============================================================================
test('Concurrency Stress: Concurrent registrations of same email maintain DB integrity', async () => {
  const email = 'concurrent_collision@example.com';
  const requests = Array.from({ length: 5 }, (_, i) =>
    api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `User ${i}`, email, password: 'password123' }),
    })
  );

  const results = await Promise.all(requests);
  const statusCounts = {};
  results.forEach((r) => {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  });

  // Exactly one registration must succeed (status 201)
  assert.equal(statusCounts[201], 1, 'Exactly one concurrent registration succeeds');
  // All other concurrent requests must fail (409 or 500 DB constraint error)
  assert.equal(results.filter((r) => r.status !== 201).length, 4, 'All duplicate requests rejected');

  // Verify only 1 user exists in SQLite
  const count = db.prepare('SELECT count(*) as cnt FROM users WHERE email = ?').get(email);
  assert.equal(count.cnt, 1, 'Only one user record exists in database');
});

test('Concurrency Stress: Multiple concurrent logins return independent valid session tokens', async () => {
  const email = 'concurrent_login@example.com';
  await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Multi Session', email, password: 'password123' }),
  });

  // Fire 10 simultaneous login requests
  const loginRequests = Array.from({ length: 10 }, () =>
    api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123' }),
    })
  );

  const responses = await Promise.all(loginRequests);
  const tokens = new Set();

  for (const r of responses) {
    assert.equal(r.status, 200, 'Login succeeded');
    assert.ok(r.body.token, 'Token present');
    tokens.add(r.body.token);
  }

  // All 10 tokens must be unique
  assert.equal(tokens.size, 10, 'All 10 session tokens are distinct');

  // Verify every token is valid and can access /api/auth/me
  for (const t of tokens) {
    const me = await api('/api/auth/me', {
      headers: { Authorization: `Bearer ${t}` },
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, email);
  }
});
