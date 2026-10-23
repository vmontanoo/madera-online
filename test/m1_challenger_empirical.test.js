import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Accelerated scrypt for test suite
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_madera_challenger_m1.db');
process.env.DATABASE_PATH = testDbPath;

// Clean up stale database if any
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

// Helper for test HTTP requests
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
// CHALLENGE 1: OFFLINE SIMULATED GOOGLE PROVIDER (Ana, Carlos & Custom)
// ============================================================================

test('CHALLENGE 1.1: GET /api/auth/google renders Google Account Picker with expected accounts', async () => {
  const res = await api('/api/auth/google');
  assert.equal(res.status, 200, 'Must return HTTP 200');
  assert.equal(res.headers.get('content-type')?.includes('text/html'), true, 'Must return text/html');
  
  const html = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  assert.ok(html.includes('Elegir una cuenta de Google'), 'Contains Google account picker header');
  assert.ok(html.includes('Ana García'), 'Lists Ana Garcia');
  assert.ok(html.includes('ana.garcia@gmail.com'), 'Lists Ana email');
  assert.ok(html.includes('Carlos Diseñador'), 'Lists Carlos Designer');
  assert.ok(html.includes('carlos.muebles@gmail.com'), 'Lists Carlos email');
  assert.ok(html.includes('action="/api/auth/google/callback"'), 'Has custom account form target');
});

test('CHALLENGE 1.2: GET /api/auth/google/callback handles simulated Ana account', async () => {
  const res = await api('/api/auth/google/callback?simulated=1&account=ana', {
    redirect: 'manual',
  });
  assert.equal(res.status, 302, 'Redirects after callback');
  assert.equal(res.headers.get('location'), '/#/', 'Redirects to /#/');
  
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Must set session cookie');
  assert.ok(setCookie.includes('session='), 'Cookie name is session');
  assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
  assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie SameSite=Lax');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('ana.garcia@gmail.com');
  assert.ok(user, 'User must exist in DB');
  assert.equal(user.name, 'Ana García');
  assert.equal(user.provider, 'google');
  assert.equal(user.google_id, 'mock-google-sub-ana-101');
  assert.equal(user.hash, '', 'Google-created user must have empty hash');
  assert.equal(user.salt, '', 'Google-created user must have empty salt');
});

test('CHALLENGE 1.3: GET /api/auth/google/callback handles simulated Carlos account', async () => {
  const res = await api('/api/auth/google/callback?simulated=1&account=carlos', {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('session='));

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('carlos.muebles@gmail.com');
  assert.ok(user);
  assert.equal(user.name, 'Carlos Diseñador');
  assert.equal(user.provider, 'google');
  assert.equal(user.google_id, 'mock-google-sub-carlos-102');
});

test('CHALLENGE 1.4: GET /api/auth/google/callback handles custom simulated account', async () => {
  const res = await api(
    '/api/auth/google/callback?simulated=1&name=Roberto+Modular&email=roberto.modular@taller.com&sub=google-sub-roberto-777',
    { redirect: 'manual' }
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('roberto.modular@taller.com');
  assert.ok(user);
  assert.equal(user.name, 'Roberto Modular');
  assert.equal(user.provider, 'google');
  assert.equal(user.google_id, 'google-sub-roberto-777');
});

test('CHALLENGE 1.5: GET /api/auth/google/callback with simulated flag but no account param defaults safely', async () => {
  const res = await api('/api/auth/google/callback?simulated=1', {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');
  assert.ok(res.headers.get('set-cookie')?.includes('session='));
});

test('CHALLENGE 1.6: GET /api/auth/google/callback redirects with error when error param is present', async () => {
  const res = await api('/api/auth/google/callback?error=access_denied', {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/login?error=access_denied');
});

// ============================================================================
// CHALLENGE 2: PROGRAMMATIC MOCK ENDPOINT (POST /api/auth/google/mock)
// ============================================================================

test('CHALLENGE 2.1: POST /api/auth/google/mock creates user, sets cookie, and returns session token', async () => {
  const res = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Sofia Arquitecta',
      email: 'sofia.arquitecta@madera.dev',
      google_id: 'mock-sub-sofia-555',
      avatar_url: 'https://images.example.com/sofia.jpg',
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.token, 'Token must be returned');
  assert.equal(res.body.user.name, 'Sofia Arquitecta');
  assert.equal(res.body.user.email, 'sofia.arquitecta@madera.dev');
  assert.equal(res.body.user.provider, 'google');
  assert.equal(res.body.user.avatar_url, 'https://images.example.com/sofia.jpg');

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('session='), 'Cookie is set');

  // Verify Bearer token authorization works with /api/auth/me
  const meRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${res.body.token}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, 'sofia.arquitecta@madera.dev');
  assert.equal(meRes.body.user.provider, 'google');
});

test('CHALLENGE 2.2: POST /api/auth/google/mock rejects invalid or missing email', async () => {
  let res = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({ name: 'Sin Email' }),
  });
  assert.equal(res.status, 400);

  res = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({ name: 'Email Invalido', email: 'no-at-sign' }),
  });
  assert.equal(res.status, 400);
});

test('CHALLENGE 2.3: POST /api/auth/google/mock auto-generates name and google_id when omitted', async () => {
  const res = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({ email: 'minimal.mock@example.com' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.name, 'Usuario Google');
  assert.ok(res.body.token);

  const u = db.prepare('SELECT * FROM users WHERE email = ?').get('minimal.mock@example.com');
  assert.ok(u);
  assert.ok(u.google_id && u.google_id.startsWith('mock-sub-'), 'Auto-generated deterministic sub');
});

// ============================================================================
// CHALLENGE 3: ACCOUNT LINKING (EXISTING LOCAL USER SIGNS IN WITH GOOGLE)
// ============================================================================

test('CHALLENGE 3.1: Existing local user signs in with Google links account without duplicating user row', async () => {
  // 1. Local user registers first
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Lucia Carpintera',
      email: 'lucia.carpintera@taller.org',
      password: 'StrongPassword123!',
    }),
  });
  assert.equal(regRes.status, 201);
  const localUserId = regRes.body.user.id;
  const localToken = regRes.body.token;

  // 2. User creates a project with local credentials
  const projRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localToken}` },
    body: JSON.stringify({
      name: 'Proyecto de Lucia',
      description: 'Mueble antes de linkear Google',
      data: { modules: [{ id: 1, type: 'closet' }] },
    }),
  });
  assert.equal(projRes.status, 201);
  const projId = projRes.body.id;

  // 3. User signs in with Google using the EXACT same email
  const googleRes = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Lucia Carpintera (Google)',
      email: 'lucia.carpintera@taller.org',
      google_id: 'google-sub-lucia-linked-888',
      avatar_url: 'https://lh3.googleusercontent.com/avatar-lucia',
    }),
  });
  assert.equal(googleRes.status, 200);
  assert.equal(googleRes.body.user.id, localUserId, 'User ID must remain the same (account linked)');

  // 4. Verify DB has exactly ONE user with this email
  const userRows = db.prepare('SELECT * FROM users WHERE email = ?').all('lucia.carpintera@taller.org');
  assert.equal(userRows.length, 1, 'Only one user record must exist in DB');
  assert.equal(userRows[0].id, localUserId);
  assert.equal(userRows[0].google_id, 'google-sub-lucia-linked-888');
  assert.equal(userRows[0].avatar_url, 'https://lh3.googleusercontent.com/avatar-lucia');
  assert.equal(userRows[0].provider, 'google');

  // 5. Verify the linked Google session can still access the project created originally
  const googleToken = googleRes.body.token;
  const accessProjRes = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  assert.equal(accessProjRes.status, 200, 'Linked Google account accesses original project');
  assert.equal(accessProjRes.body.name, 'Proyecto de Lucia');

  // 6. Dual-auth: user can still login with their original local password
  const pwdLoginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'lucia.carpintera@taller.org',
      password: 'StrongPassword123!',
    }),
  });
  assert.equal(pwdLoginRes.status, 200, 'Linked account retains password login capability');
  assert.equal(pwdLoginRes.body.user.id, localUserId);
});

// ============================================================================
// CHALLENGE 4: GOOGLE USER PASSWORD PROTECTION
// ============================================================================

test('CHALLENGE 4.1: Accounts created via Google reject password login attempts', async () => {
  // Create account purely via Google mock
  const gRes = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Google Pure User',
      email: 'google.pure.user@gmail.com',
      google_id: 'google-pure-sub-111',
    }),
  });
  assert.equal(gRes.status, 200);

  // Attempt login with random password
  const attempt1 = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'google.pure.user@gmail.com',
      password: 'SomeRandomPassword123',
    }),
  });
  assert.equal(attempt1.status, 401);
  assert.equal(attempt1.body.error, 'Esta cuenta utiliza Google Sign-In');

  // Attempt login with empty password -> rejected
  const attempt2 = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'google.pure.user@gmail.com',
      password: '',
    }),
  });
  assert.equal(attempt2.status, 400);

  // Attempt login with null password -> rejected
  const attempt3 = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'google.pure.user@gmail.com',
      password: null,
    }),
  });
  assert.equal(attempt3.status, 400);
});

// ============================================================================
// CHALLENGE 5: SESSION PERSISTENCE LIFECYCLE & MULTI-DEVICE SESSION INTEGRITY
// ============================================================================

test('CHALLENGE 5.1: Session persistence via Cookie and Bearer token priority', async () => {
  // Register two users
  const u1 = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'User Bearer', email: 'user.bearer@test.com', password: 'Password123' }),
  });
  const u2 = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'User Cookie', email: 'user.cookie@test.com', password: 'Password123' }),
  });

  const token1 = u1.body.token;
  const cookie2 = u2.headers.get('set-cookie').split(';')[0];

  // Request with Bearer
  const resBearer = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(resBearer.status, 200);
  assert.equal(resBearer.body.user.email, 'user.bearer@test.com');

  // Request with Cookie
  const resCookie = await api('/api/auth/me', {
    headers: { Cookie: cookie2 },
  });
  assert.equal(resCookie.status, 200);
  assert.equal(resCookie.body.user.email, 'user.cookie@test.com');

  // Request with BOTH Bearer token 1 and Cookie 2: Bearer must take precedence
  const resBoth = await api('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${token1}`,
      Cookie: cookie2,
    },
  });
  assert.equal(resBoth.status, 200);
  assert.equal(resBoth.body.user.email, 'user.bearer@test.com', 'Bearer token takes precedence over cookie');
});

test('CHALLENGE 5.2: Multi-device sessions remain independently valid until explicit logout', async () => {
  // User logs in on Device A
  const devA = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user.bearer@test.com', password: 'Password123' }),
  });
  const tokenA = devA.body.token;

  // User logs in on Device B
  const devB = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'user.bearer@test.com', password: 'Password123' }),
  });
  const tokenB = devB.body.token;

  assert.notEqual(tokenA, tokenB, 'Each login receives unique session token');

  // Both devices are authenticated
  const meA1 = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenA}` } });
  const meB1 = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(meA1.status, 200);
  assert.equal(meB1.status, 200);

  // Device A logs out
  const logoutA = await api('/api/auth/logout', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(logoutA.status, 200);

  // Device A is no longer authenticated
  const meA2 = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenA}` } });
  assert.equal(meA2.status, 401);

  // Device B remains authenticated!
  const meB2 = await api('/api/auth/me', { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(meB2.status, 200, 'Device B session persists after Device A logout');
});

// ============================================================================
// CHALLENGE 6: SQLITE CONSTRAINTS & UNIQUE GOOGLE_ID INDEX STRESS
// ============================================================================

test('CHALLENGE 6.1: Secondary unique index idx_users_google_id prevents duplicate google_id across distinct users', () => {
  // Direct DB insertion attempt with duplicated non-null google_id
  const gid = 'duplicate-unique-google-id-check-123';
  db.prepare("INSERT INTO users (email, name, google_id, provider) VALUES ('unique1@test.com', 'U1', ?, 'google')").run(gid);

  assert.throws(
    () => {
      db.prepare("INSERT INTO users (email, name, google_id, provider) VALUES ('unique2@test.com', 'U2', ?, 'google')").run(gid);
    },
    /UNIQUE constraint failed: users\.google_id/,
    'Must enforce unique constraint on google_id'
  );
});
