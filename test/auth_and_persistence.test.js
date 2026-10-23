import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Accelerated scrypt for test suite
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_madera_auth.db');
process.env.DATABASE_PATH = testDbPath;

// Remove any stale test database
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

// Helper for HTTP requests
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
// 1. SQLITE AUTO-MIGRATION & PRAGMA TESTS
// ============================================================================
test('SQLite Auto-Migration: enforces PRAGMA foreign_keys = ON', () => {
  const fk = db.prepare('PRAGMA foreign_keys').get();
  assert.equal(fk.foreign_keys, 1, 'Foreign keys must be enabled in SQLite');
});

test('SQLite Auto-Migration: users table contains all required columns', () => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(cols.includes('id'), 'users.id exists');
  assert.ok(cols.includes('email'), 'users.email exists');
  assert.ok(cols.includes('salt'), 'users.salt exists');
  assert.ok(cols.includes('hash'), 'users.hash exists');
  assert.ok(cols.includes('name'), 'users.name exists');
  assert.ok(cols.includes('google_id'), 'users.google_id exists');
  assert.ok(cols.includes('avatar_url'), 'users.avatar_url exists');
  assert.ok(cols.includes('provider'), 'users.provider exists');
  assert.ok(cols.includes('created_at'), 'users.created_at exists');
});

test('SQLite Auto-Migration: sessions table contains expires_at column', () => {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.ok(cols.includes('token'), 'sessions.token exists');
  assert.ok(cols.includes('user_id'), 'sessions.user_id exists');
  assert.ok(cols.includes('created_at'), 'sessions.created_at exists');
  assert.ok(cols.includes('expires_at'), 'sessions.expires_at exists');
});

test('SQLite Auto-Migration: projects table contains description, thumbnail, and created_at', () => {
  const cols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  assert.ok(cols.includes('id'), 'projects.id exists');
  assert.ok(cols.includes('user_id'), 'projects.user_id exists');
  assert.ok(cols.includes('name'), 'projects.name exists');
  assert.ok(cols.includes('data'), 'projects.data exists');
  assert.ok(cols.includes('description'), 'projects.description exists');
  assert.ok(cols.includes('thumbnail'), 'projects.thumbnail exists');
  assert.ok(cols.includes('created_at'), 'projects.created_at exists');
  assert.ok(cols.includes('updated_at'), 'projects.updated_at exists');
});

test('SQLite Foreign Key Cascade: deleting user cascades to sessions and projects', () => {
  // Insert test user directly
  const rUser = db
    .prepare("INSERT INTO users (email, name, salt, hash, provider) VALUES ('cascade@test.com', 'Cascade', '', '', 'local')")
    .run();
  const uid = Number(rUser.lastInsertRowid);

  // Insert session and project
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    'cascade_token_123',
    uid,
    Date.now(),
    Date.now() + 100000
  );
  db.prepare('INSERT INTO projects (user_id, name, data, updated_at) VALUES (?, ?, ?, ?)').run(
    uid,
    'Cascade Project',
    '{}',
    Date.now()
  );

  assert.ok(db.prepare('SELECT * FROM sessions WHERE token = ?').get('cascade_token_123'));
  assert.ok(db.prepare('SELECT * FROM projects WHERE user_id = ?').get(uid));

  // Delete user
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);

  // Verify cascade
  assert.equal(db.prepare('SELECT * FROM sessions WHERE token = ?').get('cascade_token_123'), undefined);
  assert.equal(db.prepare('SELECT * FROM projects WHERE user_id = ?').get(uid), undefined);
});

// ============================================================================
// 2. REGISTRATION VALIDATION & COMPATIBILITY
// ============================================================================
test('Registration: rejects missing or invalid name (<2 or >100 chars)', async () => {
  // Empty / whitespace
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: '   ', email: 'test_name1@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400);

  // Single letter
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'A', email: 'test_name2@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400);

  // Over 100 chars
  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'A'.repeat(101), email: 'test_name3@example.com', password: 'password123' }),
  });
  assert.equal(res.status, 400);
});

test('Registration: rejects malformed email address', async () => {
  const invalidEmails = ['notanemail', 'user@', '@domain.com', 'user@domain', 'user name@domain.com'];
  for (const email of invalidEmails) {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Valido', email, password: 'password123' }),
    });
    assert.equal(res.status, 400, `Should reject email: ${email}`);
  }
});

test('Registration: rejects passwords < 6 chars or > 128 chars', async () => {
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valido', email: 'shortpw@example.com', password: '12345' }),
  });
  assert.equal(res.status, 400);

  res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Valido', email: 'longpw@example.com', password: 'A'.repeat(129) }),
  });
  assert.equal(res.status, 400);
});

test('Registration: successfully registers user with valid inputs and sets HttpOnly cookie', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ana Garcia', email: 'Ana.Garcia@Example.COM', password: 'SecurePassword123!' }),
  });

  assert.equal(res.status, 201);
  assert.ok(res.body.user);
  assert.equal(res.body.user.name, 'Ana Garcia');
  assert.equal(res.body.user.email, 'ana.garcia@example.com', 'Email normalized to lowercase');
  assert.equal(res.body.user.provider, 'local');
  assert.ok(res.body.token, 'Token returned in response');
  assert.equal(res.body.email, 'ana.garcia@example.com', 'Top-level email present for backwards compatibility');

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie header present');
  assert.ok(setCookie.includes('session='), 'Session cookie set');
  assert.ok(setCookie.includes('HttpOnly'), 'Cookie is HttpOnly');
  assert.ok(setCookie.includes('Path=/'), 'Cookie path is /');
  assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie SameSite is Lax');
  assert.ok(setCookie.includes('Max-Age=7776000'), 'Cookie Max-Age is 90 days');
});

test('Registration: rejects duplicate email with HTTP 409 Conflict', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Duplicate User', email: 'ana.garcia@example.com', password: 'AnotherPassword123' }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Ese email ya está registrado');
});

test('Registration: backward compatibility alias POST /api/register works', async () => {
  const res = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Legacy User', email: 'legacy@example.com', password: 'Password123' }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'legacy@example.com');
  assert.ok(res.body.token);
});

// ============================================================================
// 3. SECURE LOGIN & TIMING-SAFE AUTH
// ============================================================================
test('Login: rejects non-existent email with HTTP 401', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'nonexistent@example.com', password: 'Password123' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Credenciales incorrectas');
});

test('Login: rejects incorrect password with HTTP 401', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana.garcia@example.com', password: 'WrongPassword' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Credenciales incorrectas');
});

test('Login: successfully logs in with correct credentials, sets cookie, and returns token', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ANA.GARCIA@EXAMPLE.COM', password: 'SecurePassword123!' }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'Ana Garcia');
  assert.equal(res.body.user.email, 'ana.garcia@example.com');
  assert.ok(res.body.token);

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(res.body.token);
  assert.ok(session, 'Session stored in DB');
  assert.ok(session.expires_at > Date.now(), 'Session expires in the future');
});

test('Login: backward compatibility alias POST /api/login works', async () => {
  const res = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'legacy@example.com', password: 'Password123' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'legacy@example.com');
  assert.ok(res.body.token);
});

// ============================================================================
// 4. AUTH MIDDLEWARE, PROFILE & LOGOUT
// ============================================================================
test('Auth Middleware: rejects requests without token with HTTP 401', async () => {
  const res = await api('/api/auth/me');
  assert.equal(res.status, 401);
});

test('Auth Middleware: accepts session cookie and returns user profile', async () => {
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana.garcia@example.com', password: 'SecurePassword123!' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  const meRes = await api('/api/auth/me', {
    headers: { Cookie: cookie },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, 'ana.garcia@example.com');
  assert.equal(meRes.body.user.name, 'Ana Garcia');
  assert.equal(meRes.body.email, 'ana.garcia@example.com');
});

test('Auth Middleware: accepts Bearer authorization header and returns user profile', async () => {
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana.garcia@example.com', password: 'SecurePassword123!' }),
  });
  const token = loginRes.body.token;

  const meRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, 'ana.garcia@example.com');
});

test('Auth Middleware: legacy GET /api/me works with Bearer and returns profile', async () => {
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana.garcia@example.com', password: 'SecurePassword123!' }),
  });
  const token = loginRes.body.token;

  const meRes = await api('/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.email, 'ana.garcia@example.com');
  assert.equal(meRes.body.user.email, 'ana.garcia@example.com');
});

test('Auth Middleware: rejects and prunes expired sessions', async () => {
  const expiredToken = 'expired_session_test_token_9999';
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get('ana.garcia@example.com');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    expiredToken,
    u.id,
    Date.now() - 100000,
    Date.now() - 50000
  );

  const res = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Sesión expirada');

  const check = db.prepare('SELECT * FROM sessions WHERE token = ?').get(expiredToken);
  assert.equal(check, undefined, 'Expired session was pruned from DB');
});

test('Logout: POST /api/auth/logout invalidates session and clears cookie', async () => {
  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana.garcia@example.com', password: 'SecurePassword123!' }),
  });
  const token = loginRes.body.token;

  const logoutRes = await api('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logoutRes.status, 200);
  assert.ok(logoutRes.headers.get('set-cookie').includes('Max-Age=0'));

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  assert.equal(session, undefined, 'Session removed from database');

  const meRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 401);
});

// ============================================================================
// 5. GOOGLE OAUTH SIMULATION & MOCK PROVIDER
// ============================================================================
test('Google Sign-In: GET /api/auth/google renders Account Picker HTML', async () => {
  const res = await api('/api/auth/google');
  assert.equal(res.status, 200);
  assert.ok(typeof res.body === 'string');
  assert.ok(res.body.includes('Elegir una cuenta de Google'));
  assert.ok(res.body.includes('Ana García'));
  assert.ok(res.body.includes('Carlos Diseñador'));
  assert.ok(res.body.includes('/api/auth/google/callback'));
});

test('Google Sign-In: GET /api/auth/google/callback with simulated account logs in and redirects', async () => {
  const res = await api('/api/auth/google/callback?simulated=1&account=ana', {
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');

  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie && cookie.includes('session='));

  // User Ana exists with google provider
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get('ana.garcia@gmail.com');
  assert.ok(u);
  assert.equal(u.provider, 'google');
  assert.equal(u.name, 'Ana García');
  assert.equal(u.google_id, 'mock-google-sub-ana-101');
});

test('Google Sign-In: GET /api/auth/google/callback with custom user creates profile', async () => {
  const res = await api(
    '/api/auth/google/callback?simulated=1&name=Maria+Robles&email=maria.robles@custom.com&sub=google-sub-maria-555',
    { redirect: 'manual' }
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#/');

  const u = db.prepare('SELECT * FROM users WHERE email = ?').get('maria.robles@custom.com');
  assert.ok(u);
  assert.equal(u.name, 'Maria Robles');
  assert.equal(u.provider, 'google');
  assert.equal(u.google_id, 'google-sub-maria-555');
});

test('Google Sign-In: POST /api/auth/google/mock programmatically creates session', async () => {
  const res = await api('/api/auth/google/mock', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Tester Google',
      email: 'tester.google@example.com',
      google_id: 'sub-test-999',
      avatar_url: 'https://lh3.googleusercontent.com/avatar999',
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.email, 'tester.google@example.com');
  assert.equal(res.body.user.provider, 'google');
  assert.ok(res.body.token);

  // Authenticate using the returned token
  const meRes = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${res.body.token}` },
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.email, 'tester.google@example.com');
  assert.equal(meRes.body.user.avatar_url, 'https://lh3.googleusercontent.com/avatar999');
});

test('Google Sign-In: Google accounts without password reject standard password login', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'tester.google@example.com', password: 'SomeRandomPassword' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Esta cuenta utiliza Google Sign-In');
});

// ============================================================================
// 6. IDOR & PROJECT PERSISTENCE ISOLATION
// ============================================================================
test('IDOR Project Protection: users cannot read, edit, duplicate, or delete others projects', async () => {
  // Create User 1
  const u1Res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'User One', email: 'user1@example.com', password: 'Password123!' }),
  });
  const token1 = u1Res.body.token;

  // Create User 2
  const u2Res = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'User Two', email: 'user2@example.com', password: 'Password123!' }),
  });
  const token2 = u2Res.body.token;

  // User 1 creates a project
  const createRes = await api('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token1}` },
    body: JSON.stringify({
      name: 'Proyecto Privado User 1',
      description: 'Mueble confidencial',
      data: { secret: 'user1-secret-design' },
    }),
  });
  assert.equal(createRes.status, 201);
  const projId = createRes.body.id;

  // 1. User 1 can view their project
  const view1 = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(view1.status, 200);
  assert.equal(view1.body.name, 'Proyecto Privado User 1');
  assert.equal(view1.body.description, 'Mueble confidencial');

  // 2. User 2 attempts IDOR Read -> 404 Not Found
  const view2 = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${token2}` },
  });
  assert.equal(view2.status, 404, 'User 2 cannot read User 1 project');

  // 3. User 2 attempts IDOR Update -> 404 Not Found
  const update2 = await api(`/api/projects/${projId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token2}` },
    body: JSON.stringify({ name: 'Hacked Project Name' }),
  });
  assert.equal(update2.status, 404, 'User 2 cannot update User 1 project');

  // Verify project was NOT modified
  const view1After = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(view1After.body.name, 'Proyecto Privado User 1');

  // 4. User 2 attempts IDOR Duplicate -> 404 Not Found
  const dup2 = await api(`/api/projects/${projId}/duplicate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token2}` },
  });
  assert.equal(dup2.status, 404, 'User 2 cannot duplicate User 1 project');

  // 5. User 2 attempts IDOR Delete -> 404 Not Found
  const del2 = await api(`/api/projects/${projId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token2}` },
  });
  assert.equal(del2.status, 404, 'User 2 cannot delete User 1 project');

  // 6. User 2 listing projects does NOT show User 1 project
  const list2 = await api('/api/projects', {
    headers: { Authorization: `Bearer ${token2}` },
  });
  assert.equal(list2.status, 200);
  assert.equal(list2.body.length, 0, 'User 2 project list must be empty');

  // 7. User 1 can successfully duplicate and delete their own project
  const dup1 = await api(`/api/projects/${projId}/duplicate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(dup1.status, 201);
  const dupId = dup1.body.id;

  const del1 = await api(`/api/projects/${projId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(del1.status, 200);

  // Deleted project is gone
  const viewDeleted = await api(`/api/projects/${projId}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(viewDeleted.status, 404);

  // Duplicated project remains
  const viewDup = await api(`/api/projects/${dupId}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  assert.equal(viewDup.status, 200);
  assert.equal(viewDup.body.name, 'Proyecto Privado User 1 copy');
});
