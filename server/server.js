import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const IS_AISTUDIO_SANDBOX = fs.existsSync('/app/control-plane-api');
const PORT = Number(process.env.APP_PORT) || (IS_AISTUDIO_SANDBOX ? 3000 : Number(process.env.PORT) || 3000);

// ============================================================================
// 1. DATABASE INITIALIZATION & AUTO-MIGRATIONS
// ============================================================================
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'madera.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Create baseline tables if fresh
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT 'Usuario',
  google_id TEXT,
  avatar_url TEXT,
  provider TEXT DEFAULT 'local',
  created_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  tax_id TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail TEXT DEFAULT '',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  seq INTEGER NOT NULL,
  quote_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  subtotal REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  currency TEXT DEFAULT '$',
  notes TEXT DEFAULT '',
  snapshot TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
`);

// Idempotent auto-migration helper
function migrateDb(database) {
  database.exec('PRAGMA foreign_keys = ON;');

  const getColumns = (tableName) => {
    try {
      const rows = database.prepare(`PRAGMA table_info(${tableName})`).all();
      return new Set(rows.map((r) => r.name));
    } catch {
      return new Set();
    }
  };

  // Ensure clients and quotes tables exist on legacy databases
  database.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    tax_id TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    seq INTEGER NOT NULL,
    quote_number TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    subtotal REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    currency TEXT DEFAULT '$',
    notes TEXT DEFAULT '',
    snapshot TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );
  `);

  // Migrate users table
  const userCols = getColumns('users');
  if (!userCols.has('name')) {
    database.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT 'Usuario';");
  }
  if (!userCols.has('provider')) {
    database.exec("ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'local';");
  }
  if (!userCols.has('google_id')) {
    database.exec('ALTER TABLE users ADD COLUMN google_id TEXT;');
  }
  if (!userCols.has('avatar_url')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
  }
  if (!userCols.has('created_at')) {
    database.exec('ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT 0;');
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;');

  // Migrate sessions table
  const sessionCols = getColumns('sessions');
  if (!sessionCols.has('expires_at')) {
    database.exec('ALTER TABLE sessions ADD COLUMN expires_at INTEGER DEFAULT 0;');
  }

  // Migrate projects table
  const projectCols = getColumns('projects');
  if (!projectCols.has('description')) {
    database.exec("ALTER TABLE projects ADD COLUMN description TEXT DEFAULT '';");
  }
  if (!projectCols.has('thumbnail')) {
    database.exec("ALTER TABLE projects ADD COLUMN thumbnail TEXT DEFAULT '';");
  }
  if (!projectCols.has('created_at')) {
    database.exec('ALTER TABLE projects ADD COLUMN created_at INTEGER DEFAULT 0;');
  }
  if (!projectCols.has('client_id')) {
    database.exec('ALTER TABLE projects ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;');
  }

  // Migrate clients table
  const clientCols = getColumns('clients');
  if (!clientCols.has('tax_id')) {
    database.exec("ALTER TABLE clients ADD COLUMN tax_id TEXT DEFAULT '';");
  }
  if (!clientCols.has('address')) {
    database.exec("ALTER TABLE clients ADD COLUMN address TEXT DEFAULT '';");
  }
  if (!clientCols.has('notes')) {
    database.exec("ALTER TABLE clients ADD COLUMN notes TEXT DEFAULT '';");
  }
  if (!clientCols.has('updated_at')) {
    database.exec('ALTER TABLE clients ADD COLUMN updated_at INTEGER DEFAULT 0;');
  }

  // Migrate quotes table
  const quoteCols = getColumns('quotes');
  if (!quoteCols.has('seq')) {
    database.exec('ALTER TABLE quotes ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;');
  }
  if (!quoteCols.has('quote_number')) {
    database.exec("ALTER TABLE quotes ADD COLUMN quote_number TEXT NOT NULL DEFAULT 'PRE-0001';");
  }
  if (!quoteCols.has('status')) {
    database.exec("ALTER TABLE quotes ADD COLUMN status TEXT DEFAULT 'draft';");
  }
  if (!quoteCols.has('subtotal')) {
    database.exec('ALTER TABLE quotes ADD COLUMN subtotal REAL DEFAULT 0;');
  }
  if (!quoteCols.has('tax_rate')) {
    database.exec('ALTER TABLE quotes ADD COLUMN tax_rate REAL DEFAULT 0;');
  }
  if (!quoteCols.has('tax_amount')) {
    database.exec('ALTER TABLE quotes ADD COLUMN tax_amount REAL DEFAULT 0;');
  }
  if (!quoteCols.has('discount')) {
    database.exec('ALTER TABLE quotes ADD COLUMN discount REAL DEFAULT 0;');
  }
  if (!quoteCols.has('total')) {
    database.exec('ALTER TABLE quotes ADD COLUMN total REAL DEFAULT 0;');
  }
  if (!quoteCols.has('currency')) {
    database.exec("ALTER TABLE quotes ADD COLUMN currency TEXT DEFAULT '$';");
  }
  if (!quoteCols.has('notes')) {
    database.exec("ALTER TABLE quotes ADD COLUMN notes TEXT DEFAULT '';");
  }
  if (!quoteCols.has('snapshot')) {
    database.exec("ALTER TABLE quotes ADD COLUMN snapshot TEXT DEFAULT '{}';");
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_quotes_user_seq ON quotes(user_id, seq);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_quotes_project ON quotes(project_id);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);');
}

migrateDb(db);

// Clean up expired sessions on startup
try {
  db.prepare('DELETE FROM sessions WHERE expires_at > 0 AND expires_at < ?').run(Date.now());
} catch {}

// ============================================================================
// 2. CRYPTOGRAPHIC & SESSION HELPERS
// ============================================================================
const scryptAsync = promisify(crypto.scrypt);
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$/i;

async function hashPassword(password, salt) {
  const cost = process.env.NODE_ENV === 'test' ? 1024 : 16384;
  const derivedKey = await scryptAsync(String(password), salt, 64, {
    cost,
    blockSize: 8,
    parallelization: 1,
  });
  return derivedKey.toString('hex');
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return parseCookies(req).session || null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    expiresAt
  );
  res.setHeader(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
  return token;
}

// ============================================================================
// 3. AUTH MIDDLEWARE
// ============================================================================
function auth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, s.created_at,
              u.id, u.name, u.email, u.avatar_url, u.provider, u.created_at AS user_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);

  if (!row) {
    return res.status(401).json({ error: 'Sesión no válida o inexistente' });
  }

  const now = Date.now();
  const expiry = row.expires_at || (row.created_at + SESSION_MAX_AGE_MS);
  if (expiry < now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Sesión expirada' });
  }

  req.user = {
    id: row.id,
    name: row.name || 'Usuario',
    email: row.email,
    avatar_url: row.avatar_url || null,
    provider: row.provider || 'local',
    created_at: row.user_created_at,
  };
  req.sessionToken = token;
  next();
}

function upsertGoogleUser({ email, name, google_id, avatar_url }) {
  const normEmail = String(email || '').trim().toLowerCase();
  let user = null;
  if (google_id) {
    user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(google_id);
  }
  if (!user && normEmail) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
  }

  if (user) {
    db.prepare(`
      UPDATE users 
      SET google_id = COALESCE(google_id, ?),
          name = CASE WHEN name = 'Usuario' OR name = '' THEN ? ELSE name END,
          avatar_url = COALESCE(avatar_url, ?),
          provider = CASE WHEN provider = 'local' THEN 'google' ELSE provider END
      WHERE id = ?
    `).run(google_id || user.google_id || null, name || user.name || 'Usuario', avatar_url || user.avatar_url || null, user.id);
    return db.prepare('SELECT id, name, email, avatar_url, provider FROM users WHERE id = ?').get(user.id);
  }

  const now = Date.now();
  const r = db.prepare(`
    INSERT INTO users (email, name, salt, hash, google_id, avatar_url, provider, created_at)
    VALUES (?, ?, '', '', ?, ?, 'google', ?)
  `).run(normEmail, name || 'Usuario Google', google_id || null, avatar_url || null, now);

  return {
    id: Number(r.lastInsertRowid),
    name: name || 'Usuario Google',
    email: normEmail,
    avatar_url: avatar_url || null,
    provider: 'google',
  };
}

// ============================================================================
// 4. EXPRESS APPLICATION SETUP & ROUTES
// ============================================================================
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(root, 'public')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three')));

// ----------------------------------------------------------------------------
// 4.1 Registration Handlers
// ----------------------------------------------------------------------------
const handleRegister = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
    }

    if (typeof email !== 'string') {
      return res.status(400).json({ error: 'Email requerido' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 255) {
      return res.status(400).json({ error: 'Formato de email inválido' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 6 y 128 caracteres' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    const now = Date.now();

    const insertResult = db
      .prepare('INSERT INTO users (name, email, salt, hash, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), normalizedEmail, salt, hash, 'local', now);

    const userId = Number(insertResult.lastInsertRowid);
    const token = startSession(res, userId);

    res.status(201).json({
      user: {
        id: userId,
        name: name.trim(),
        email: normalizedEmail,
        avatar_url: null,
        provider: 'local',
      },
      email: normalizedEmail,
      token,
    });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

app.post('/api/auth/register', handleRegister);
app.post('/api/register', handleRegister);

// ----------------------------------------------------------------------------
// 4.2 Login Handlers
// ----------------------------------------------------------------------------
const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || (typeof password === 'string' && password.trim() === '')) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

    if (!u) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    if (u.provider === 'google' && (!u.hash || u.hash === '')) {
      return res.status(401).json({ error: 'Esta cuenta utiliza Google Sign-In' });
    }

    const candidateHash = await hashPassword(String(password), u.salt || '');
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(u.hash || '', 'hex');

    const isValid = candidateBuf.length === storedBuf.length && crypto.timingSafeEqual(candidateBuf, storedBuf);
    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = startSession(res, u.id);
    res.json({
      user: {
        id: u.id,
        name: u.name || 'Usuario',
        email: u.email,
        avatar_url: u.avatar_url || null,
        provider: u.provider || 'local',
      },
      email: u.email,
      token,
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

app.post('/api/auth/login', handleLogin);
app.post('/api/login', handleLogin);

// ----------------------------------------------------------------------------
// 4.3 Profile & Session Status Handlers
// ----------------------------------------------------------------------------
const handleMe = (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name || 'Usuario',
      email: req.user.email,
      avatar_url: req.user.avatar_url || null,
      provider: req.user.provider || 'local',
    },
    email: req.user.email,
  });
};

app.get('/api/auth/me', auth, handleMe);
app.get('/api/me', auth, handleMe);

// ----------------------------------------------------------------------------
// 4.4 Logout Handlers
// ----------------------------------------------------------------------------
const handleLogout = (req, res) => {
  const token = extractToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
};

app.all('/api/auth/logout', handleLogout);
app.all('/api/logout', handleLogout);

// ----------------------------------------------------------------------------
// 4.5 Google OAuth & Simulated Provider
// ----------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const HAS_REAL_GOOGLE = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}/api/auth/google/callback`;
}

const SIMULATED_ACCOUNTS = {
  ana: {
    name: 'Ana García',
    email: 'ana.garcia@gmail.com',
    google_id: 'mock-google-sub-ana-101',
    avatar_url: 'https://lh3.googleusercontent.com/a/mock-ana-avatar',
    role: 'Diseñadora de Interiores',
    color: '#4285F4',
  },
  carlos: {
    name: 'Carlos Diseñador',
    email: 'carlos.muebles@gmail.com',
    google_id: 'mock-google-sub-carlos-102',
    avatar_url: 'https://lh3.googleusercontent.com/a/mock-carlos-avatar',
    role: 'Fabricante Modular',
    color: '#0F9D58',
  },
};

app.get('/api/auth/google', (req, res) => {
  const forceSimulated = req.query.simulated === '1' || req.query.mock === '1';

  if (HAS_REAL_GOOGLE && !forceSimulated) {
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', getRedirectUri(req));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'select_account');
    return res.redirect(authUrl.toString());
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Acceder con Google - Madera Local (Simulado)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --bg:#1c1a19; --panel:#262322; --panel2:#2f2b2a; --text:#eee; --muted:#9b9490; --accent:#ffb800; --line:#4a4543; }
    * { box-sizing: border-box; margin:0; padding:0; }
    body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:16px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 28px; width: 100%; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { text-align:center; margin-bottom: 24px; }
    .logo { width: 44px; height: 44px; margin: 0 auto 12px; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .sub { font-size: 13px; color: var(--muted); }
    .badge { display:inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(255, 184, 0, 0.15); color: var(--accent); margin-top: 6px; }
    .accounts { display:flex; flex-direction:column; gap: 10px; margin-bottom: 24px; }
    .acc-btn { display:flex; align-items:center; gap: 14px; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; cursor:pointer; color: var(--text); text-decoration:none; transition: all 0.15s; }
    .acc-btn:hover { border-color: var(--accent); transform: translateY(-1px); }
    .avatar { width: 40px; height: 40px; border-radius: 50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size: 17px; color: #fff; flex-shrink:0; }
    .acc-info { display:flex; flex-direction:column; text-align:left; flex:1; overflow:hidden; }
    .acc-name { font-weight: 600; font-size: 14px; }
    .acc-email { font-size: 12px; color: var(--muted); white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }
    .divider { display:flex; align-items:center; gap: 10px; margin: 20px 0; color: var(--muted); font-size: 12px; }
    .divider::before, .divider::after { content:''; flex:1; height:1px; background: var(--line); }
    .form-custom { display:flex; flex-direction:column; gap: 10px; }
    .form-custom input { background: #171514; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; }
    .form-custom input:focus { outline:none; border-color: var(--accent); }
    .btn-submit { background: var(--accent); color: #111; font-weight: 600; border:none; border-radius: 999px; padding: 10px; cursor:pointer; font-size: 13px; }
    .footer { margin-top: 20px; text-align:center; font-size: 12px; }
    .footer a { color: var(--muted); text-decoration:none; }
    .footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <svg class="logo" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      <h1>Elegir una cuenta de Google</h1>
      <p class="sub">para continuar en Madera Local</p>
      <span class="badge">Modo Simulado Offline</span>
    </div>

    <div class="accounts">
      <a class="acc-btn" href="/api/auth/google/callback?simulated=1&account=ana">
        <div class="avatar" style="background:#4285F4">A</div>
        <div class="acc-info">
          <span class="acc-name">Ana García</span>
          <span class="acc-email">ana.garcia@gmail.com</span>
        </div>
      </a>

      <a class="acc-btn" href="/api/auth/google/callback?simulated=1&account=carlos">
        <div class="avatar" style="background:#0F9D58">C</div>
        <div class="acc-info">
          <span class="acc-name">Carlos Diseñador</span>
          <span class="acc-email">carlos.muebles@gmail.com</span>
        </div>
      </a>
    </div>

    <div class="divider">o usar otra cuenta simulada</div>

    <form class="form-custom" method="GET" action="/api/auth/google/callback">
      <input type="hidden" name="simulated" value="1">
      <input type="text" name="name" placeholder="Nombre completo (ej. María Robles)" required>
      <input type="email" name="email" placeholder="Correo electrónico @gmail.com" required>
      <button class="btn-submit" type="submit">Iniciar sesión con esta cuenta</button>
    </form>

    <div class="footer">
      <a href="/#/">← Volver a Madera local</a>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state, error, simulated, account, email, name, sub } = req.query;

  if (error) {
    return res.redirect(`/#/login?error=${encodeURIComponent(error)}`);
  }

  // Handle Simulated Flow
  if (simulated === '1' || !HAS_REAL_GOOGLE) {
    let profile = null;
    if (account && SIMULATED_ACCOUNTS[account]) {
      profile = SIMULATED_ACCOUNTS[account];
    } else if (email) {
      const norm = String(email).trim().toLowerCase();
      profile = {
        name: name ? String(name).trim() : 'Usuario Google',
        email: norm,
        google_id: sub || `mock-sub-${crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16)}`,
        avatar_url: 'https://lh3.googleusercontent.com/a/default-avatar',
      };
    } else {
      profile = SIMULATED_ACCOUNTS.ana;
    }

    const user = upsertGoogleUser(profile);
    startSession(res, user.id);
    return res.redirect('/#/');
  }

  // Handle Real OAuth 2.0 Flow
  const storedState = parseCookies(req).oauth_state;
  if (!state || !storedState || state !== storedState) {
    return res.redirect('/#/login?error=invalid_state');
  }
  res.setHeader('Set-Cookie', 'oauth_state=; Path=/; Max-Age=0');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code || ''),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      console.error('[Google OAuth] Token exchange error:', errBody);
      return res.redirect('/#/login?error=token_exchange_failed');
    }

    const tokens = await tokenRes.json();
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userinfoRes.ok) {
      return res.redirect('/#/login?error=userinfo_failed');
    }

    const gUser = await userinfoRes.json();
    const user = upsertGoogleUser({
      email: gUser.email,
      name: gUser.name,
      google_id: gUser.sub,
      avatar_url: gUser.picture,
    });

    startSession(res, user.id);
    res.redirect('/#/');
  } catch (err) {
    console.error('[Google OAuth] Callback failure:', err);
    res.redirect('/#/login?error=oauth_internal_error');
  }
});

app.post('/api/auth/google/mock', (req, res) => {
  const { name, email, google_id, avatar_url } = req.body || {};
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'Email válido requerido para simulación de Google' });
  }

  const normEmail = String(email).trim().toLowerCase();
  const derivedSub = google_id || `mock-sub-${crypto.createHash('sha256').update(normEmail).digest('hex').slice(0, 16)}`;
  const userName = name || 'Usuario Google';
  const userAvatar = avatar_url || 'https://lh3.googleusercontent.com/a/default-avatar';

  const user = upsertGoogleUser({
    email: normEmail,
    name: userName,
    google_id: derivedSub,
    avatar_url: userAvatar,
  });

  const token = startSession(res, user.id);
  res.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      provider: 'google',
    },
    token,
  });
});

// ----------------------------------------------------------------------------
// 4.6 Clients & Correlative Quotes Helpers
// ----------------------------------------------------------------------------
function formatQuoteNumber(seq) {
  return `PRE-${String(Math.max(1, Number(seq) || 1)).padStart(4, '0')}`;
}

function getNextQuoteSeq(userId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM quotes WHERE user_id = ?')
    .get(userId);
  return Number(row?.max_seq || 0) + 1;
}

const ownClient = (userId, clientId) => {
  if (!clientId) return null;
  return db
    .prepare('SELECT * FROM clients WHERE id = ? AND user_id = ?')
    .get(Number(clientId), userId);
};

function createQuoteRecord(userId, payload = {}) {
  const projectIdRaw = payload.project_id ?? payload.projectId ?? null;
  const project = projectIdRaw
    ? db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(Number(projectIdRaw), userId)
    : null;

  if (projectIdRaw && !project) {
    const err = new Error('Proyecto no encontrado');
    err.status = 404;
    throw err;
  }

  const clientIdRaw =
    payload.client_id !== undefined
      ? payload.client_id
      : payload.clientId !== undefined
      ? payload.clientId
      : project?.client_id ?? null;

  let validClientId = null;
  let clientObj = null;
  if (clientIdRaw !== null && clientIdRaw !== undefined && clientIdRaw !== '') {
    clientObj = ownClient(userId, clientIdRaw);
    if (!clientObj) {
      const err = new Error('Cliente no encontrado');
      err.status = 404;
      throw err;
    }
    validClientId = clientObj.id;
  }

  let calcSubtotal = Number(payload.subtotal);
  let currency = payload.currency || '$';
  let snapshotObj = payload.snapshot || {};

  if (project) {
    try {
      const pData = JSON.parse(project.data || '{}');
      const layout = computeLayout(pData);
      currency = layout.settings?.currency || DEFAULTS.currency || '$';
      if (!Number.isFinite(calcSubtotal)) {
        calcSubtotal = Number(layout.cutlist?.total || 0);
      }
      snapshotObj = {
        project_name: project.name,
        dimensions: {
          width: layout.totalW,
          height: layout.maxH || layout.settings?.height,
          depth: layout.settings?.depth,
          thickness: layout.settings?.thickness,
        },
        panelsTotal: layout.cutlist?.panelsTotal || 0,
        hardwareTotal: layout.cutlist?.hardwareTotal || 0,
        area: layout.cutlist?.area || 0,
        total: layout.cutlist?.total || 0,
        rowsCount: layout.cutlist?.rows?.length || 0,
      };
    } catch {
      if (!Number.isFinite(calcSubtotal)) calcSubtotal = 0;
    }
  } else if (!Number.isFinite(calcSubtotal)) {
    calcSubtotal = 0;
  }

  const taxRate = Number(payload.tax_rate ?? payload.taxRate ?? 0) || 0;
  const discount = Number(payload.discount ?? 0) || 0;
  const taxable = Math.max(0, calcSubtotal - discount);
  const taxAmount =
    payload.tax_amount !== undefined
      ? Number(payload.tax_amount)
      : Number(((taxable * taxRate) / 100).toFixed(2));
  const total =
    payload.total !== undefined
      ? Number(payload.total)
      : Number((taxable + taxAmount).toFixed(2));

  const seq = getNextQuoteSeq(userId);
  const quoteNumber = formatQuoteNumber(seq);
  const status = String(payload.status || 'issued').trim() || 'issued';
  const notes = String(payload.notes || '').trim();
  const now = Date.now();

  const r = db
    .prepare(
      `INSERT INTO quotes (
        user_id, project_id, client_id, seq, quote_number, status,
        subtotal, tax_rate, tax_amount, discount, total, currency,
        notes, snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      project ? project.id : null,
      validClientId,
      seq,
      quoteNumber,
      status,
      calcSubtotal,
      taxRate,
      taxAmount,
      discount,
      total,
      currency,
      notes,
      typeof snapshotObj === 'string' ? snapshotObj : JSON.stringify(snapshotObj),
      now,
      now
    );

  const id = Number(r.lastInsertRowid);
  return {
    id,
    user_id: userId,
    project_id: project ? project.id : null,
    project_name: project ? project.name : null,
    client_id: validClientId,
    client_name: clientObj ? clientObj.name : null,
    seq,
    quote_number: quoteNumber,
    number: quoteNumber,
    status,
    subtotal: calcSubtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    discount,
    total,
    currency,
    notes,
    snapshot: snapshotObj,
    created_at: now,
    updated_at: now,
  };
}

// ----------------------------------------------------------------------------
// 4.7 Clients REST API
// ----------------------------------------------------------------------------
app.get('/api/clients', auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS projects_count,
              (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quotes_count
       FROM clients c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC, c.id DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

app.post('/api/clients', auth, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  }
  const email = String(body.email || '').trim();
  const phone = String(body.phone || body.telefono || '').trim();
  const tax_id = String(body.tax_id || body.rut || body.dni || body.nif || '').trim();
  const address = String(body.address || body.direccion || '').trim();
  const notes = String(body.notes || body.notas || '').trim();
  const now = Date.now();

  const r = db
    .prepare(
      `INSERT INTO clients (user_id, name, email, phone, tax_id, address, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, name, email, phone, tax_id, address, notes, now, now);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(r.lastInsertRowid));
  res.status(201).json(client);
});

app.get('/api/clients/:id', auth, (req, res) => {
  const c = ownClient(req.user.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  const projects = db
    .prepare('SELECT id, name, description, thumbnail, client_id, updated_at, created_at FROM projects WHERE client_id = ? AND user_id = ? ORDER BY updated_at DESC')
    .all(c.id, req.user.id);
  const quotes = db
    .prepare('SELECT * FROM quotes WHERE client_id = ? AND user_id = ? ORDER BY seq DESC')
    .all(c.id, req.user.id)
    .map((q) => ({ ...q, number: q.quote_number }));
  res.json({ ...c, projects, quotes });
});

const updateClientHandler = (req, res) => {
  const c = ownClient(req.user.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  const body = req.body || {};
  const name = body.name !== undefined ? String(body.name).trim() : c.name;
  if (!name) {
    return res.status(400).json({ error: 'El nombre del cliente no puede estar vacío' });
  }
  const email = body.email !== undefined ? String(body.email).trim() : c.email;
  const phone = (body.phone ?? body.telefono) !== undefined ? String(body.phone ?? body.telefono).trim() : c.phone;
  const tax_id = (body.tax_id ?? body.rut ?? body.dni ?? body.nif) !== undefined ? String(body.tax_id ?? body.rut ?? body.dni ?? body.nif).trim() : c.tax_id;
  const address = (body.address ?? body.direccion) !== undefined ? String(body.address ?? body.direccion).trim() : c.address;
  const notes = (body.notes ?? body.notas) !== undefined ? String(body.notes ?? body.notas).trim() : c.notes;
  const now = Date.now();

  db.prepare(
    `UPDATE clients
     SET name = ?, email = ?, phone = ?, tax_id = ?, address = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, email, phone, tax_id, address, notes, now, c.id);

  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(c.id);
  res.json({ ok: true, client: updated, ...updated });
};

app.put('/api/clients/:id', auth, updateClientHandler);
app.patch('/api/clients/:id', auth, updateClientHandler);

app.delete('/api/clients/:id', auth, (req, res) => {
  const c = ownClient(req.user.id, req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare('UPDATE projects SET client_id = NULL WHERE client_id = ? AND user_id = ?').run(c.id, req.user.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// 4.8 Quotes (Presupuestos Correlativos) REST API
// ----------------------------------------------------------------------------
app.get('/api/quotes', auth, (req, res) => {
  const { project_id, client_id } = req.query;
  let sql = `
    SELECT q.*, c.name AS client_name, c.email AS client_email, c.tax_id AS client_tax_id,
           p.name AS project_name
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    LEFT JOIN projects p ON p.id = q.project_id
    WHERE q.user_id = ?
  `;
  const params = [req.user.id];
  if (project_id) {
    sql += ' AND q.project_id = ?';
    params.push(Number(project_id));
  }
  if (client_id) {
    sql += ' AND q.client_id = ?';
    params.push(Number(client_id));
  }
  sql += ' ORDER BY q.seq DESC, q.id DESC';
  const rows = db.prepare(sql).all(...params).map((q) => ({
    ...q,
    number: q.quote_number,
  }));
  res.json(rows);
});

app.post('/api/quotes', auth, (req, res) => {
  try {
    const created = createQuoteRecord(req.user.id, req.body || {});
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Error al crear presupuesto' });
  }
});

app.get('/api/quotes/:id', auth, (req, res) => {
  const q = db
    .prepare(
      `SELECT q.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
              c.tax_id AS client_tax_id, c.address AS client_address, p.name AS project_name
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       LEFT JOIN projects p ON p.id = q.project_id
       WHERE q.id = ? AND q.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);
  if (!q) return res.status(404).json({ error: 'Presupuesto no encontrado' });
  let snapshot = {};
  try {
    snapshot = JSON.parse(q.snapshot || '{}');
  } catch {}
  res.json({ ...q, number: q.quote_number, snapshot });
});

const updateQuoteHandler = (req, res) => {
  const q = db
    .prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.user.id);
  if (!q) return res.status(404).json({ error: 'Presupuesto no encontrado' });

  const body = req.body || {};
  let clientId = q.client_id;
  if (body.client_id !== undefined || body.clientId !== undefined) {
    const rawCid = body.client_id !== undefined ? body.client_id : body.clientId;
    if (rawCid === null || rawCid === '') {
      clientId = null;
    } else {
      const c = ownClient(req.user.id, rawCid);
      if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
      clientId = c.id;
    }
  }

  const status = body.status !== undefined ? String(body.status) : q.status;
  const notes = body.notes !== undefined ? String(body.notes) : q.notes;
  const subtotal = body.subtotal !== undefined ? Number(body.subtotal) : q.subtotal;
  const discount = body.discount !== undefined ? Number(body.discount) : q.discount;
  const taxRate = (body.tax_rate ?? body.taxRate) !== undefined ? Number(body.tax_rate ?? body.taxRate) : q.tax_rate;
  const taxable = Math.max(0, subtotal - discount);
  const taxAmount = body.tax_amount !== undefined ? Number(body.tax_amount) : Number(((taxable * taxRate) / 100).toFixed(2));
  const total = body.total !== undefined ? Number(body.total) : Number((taxable + taxAmount).toFixed(2));
  const now = Date.now();

  db.prepare(
    `UPDATE quotes
     SET client_id = ?, status = ?, notes = ?, subtotal = ?, discount = ?, tax_rate = ?, tax_amount = ?, total = ?, updated_at = ?
     WHERE id = ?`
  ).run(clientId, status, notes, subtotal, discount, taxRate, taxAmount, total, now, q.id);

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(q.id);
  res.json({ ok: true, quote: { ...updated, number: updated.quote_number }, ...updated, number: updated.quote_number });
};

app.put('/api/quotes/:id', auth, updateQuoteHandler);
app.patch('/api/quotes/:id', auth, updateQuoteHandler);

app.delete('/api/quotes/:id', auth, (req, res) => {
  const q = db
    .prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.user.id);
  if (!q) return res.status(404).json({ error: 'Presupuesto no encontrado' });
  db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// 4.9 Projects API (with Client Association & PDF Export)
// ----------------------------------------------------------------------------
app.get('/api/projects', auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.thumbnail, p.client_id,
              c.name AS client_name, c.email AS client_email, c.tax_id AS client_tax_id,
              p.updated_at, p.created_at
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE p.user_id = ?
       ORDER BY p.updated_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

app.post('/api/projects', auth, (req, res) => {
  const { name, data, description, thumbnail, client_id, clientId } = req.body || {};
  const rawCid = client_id !== undefined ? client_id : clientId;
  let validClientId = null;
  if (rawCid !== undefined && rawCid !== null && rawCid !== '') {
    const c = ownClient(req.user.id, rawCid);
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    validClientId = c.id;
  }
  const now = Date.now();
  const r = db
    .prepare('INSERT INTO projects (user_id, client_id, name, data, description, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, validClientId, name || 'Sin título', JSON.stringify(data || {}), description || '', thumbnail || '', now, now);
  res.status(201).json({ id: Number(r.lastInsertRowid), name: name || 'Sin título', client_id: validClientId, updated_at: now });
});

const own = (req) =>
  db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);

app.get('/api/projects/:id', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const client = p.client_id ? ownClient(req.user.id, p.client_id) : null;
  const quotes = db
    .prepare('SELECT * FROM quotes WHERE project_id = ? AND user_id = ? ORDER BY seq DESC, id DESC')
    .all(p.id, req.user.id)
    .map((q) => ({ ...q, number: q.quote_number }));
  res.json({
    id: p.id,
    name: p.name,
    description: p.description || '',
    thumbnail: p.thumbnail || '',
    client_id: p.client_id || null,
    client: client || null,
    quotes,
    data: JSON.parse(p.data),
    updated_at: p.updated_at,
    created_at: p.created_at,
  });
});

app.put('/api/projects/:id', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { name, data, description, thumbnail, client_id, clientId } = req.body || {};
  let nextClientId = p.client_id ?? null;
  if (client_id !== undefined || clientId !== undefined) {
    const rawCid = client_id !== undefined ? client_id : clientId;
    if (rawCid === null || rawCid === '') {
      nextClientId = null;
    } else {
      const c = ownClient(req.user.id, rawCid);
      if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
      nextClientId = c.id;
    }
  }
  db.prepare('UPDATE projects SET name = ?, data = ?, description = ?, thumbnail = ?, client_id = ?, updated_at = ? WHERE id = ?').run(
    name ?? p.name,
    data ? JSON.stringify(data) : p.data,
    description ?? p.description,
    thumbnail ?? p.thumbnail,
    nextClientId,
    Date.now(),
    p.id
  );
  res.json({ ok: true, client_id: nextClientId });
});

const assignProjectClientHandler = (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  const body = req.body || {};
  const rawCid = body.client_id !== undefined ? body.client_id : body.clientId;
  let nextClientId = null;
  let clientObj = null;
  if (rawCid !== null && rawCid !== undefined && rawCid !== '') {
    clientObj = ownClient(req.user.id, rawCid);
    if (!clientObj) return res.status(404).json({ error: 'Cliente no encontrado' });
    nextClientId = clientObj.id;
  }
  const now = Date.now();
  db.prepare('UPDATE projects SET client_id = ?, updated_at = ? WHERE id = ?').run(nextClientId, now, p.id);
  res.json({ ok: true, id: p.id, project_id: p.id, client_id: nextClientId, client: clientObj });
};

app.put('/api/projects/:id/client', auth, assignProjectClientHandler);
app.post('/api/projects/:id/client', auth, assignProjectClientHandler);
app.patch('/api/projects/:id/client', auth, assignProjectClientHandler);

app.get('/api/projects/:id/quotes', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  const rows = db
    .prepare(
      `SELECT q.*, c.name AS client_name, c.email AS client_email, c.tax_id AS client_tax_id
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
       WHERE q.project_id = ? AND q.user_id = ?
       ORDER BY q.seq DESC, q.id DESC`
    )
    .all(p.id, req.user.id)
    .map((q) => ({ ...q, number: q.quote_number }));
  res.json(rows);
});

app.post('/api/projects/:id/quotes', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  try {
    const created = createQuoteRecord(req.user.id, { ...(req.body || {}), project_id: p.id });
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Error al generar presupuesto' });
  }
});

app.post('/api/projects/:id/duplicate', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const now = Date.now();
  const r = db
    .prepare('INSERT INTO projects (user_id, client_id, name, data, description, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, p.client_id || null, p.name + ' copy', p.data, p.description || '', p.thumbnail || '', now, now);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const p = own(req);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// 4.10 Formal Quotation PDF Generator (/api/projects/:id/pdf)
// ----------------------------------------------------------------------------
function pdfSafeText(str) {
  return String(str ?? '')
    .replace(/×/g, 'x')
    .replace(/Ø/g, 'Diam.')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

async function generateProjectQuotePdf({ project, client, quote, layout }) {
  const pdfDoc = await PDFDocument.create();
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cl = layout.cutlist;
  const s = layout.settings || DEFAULTS;
  const cur = pdfSafeText(quote?.currency || s.currency || '$');
  const fmtMoney = (v) => `${cur}${Number(v || 0).toFixed(2)}`;
  const quoteNum = quote?.quote_number || 'PRE-0001';
  const dateStr = new Date(quote?.created_at || Date.now()).toLocaleDateString('es-ES');
  const cNameMeta = client?.name || 'Cliente General / Consumidor Final';
  const cTaxMeta = client?.tax_id || 'Sin especificar';

  pdfDoc.setTitle(pdfSafeText(`DAJUSCA.APP - COTIZACION FORMAL ${quoteNum} - ${project.name}`));
  pdfDoc.setAuthor(pdfSafeText(`Dajusca.app - Cliente: ${cNameMeta} (${cTaxMeta})`));
  pdfDoc.setSubject(
    pdfSafeText(
      `DAJUSCA.APP | MADERA LOCAL | COTIZACION FORMAL ${quoteNum} | DATOS DEL CLIENTE: ${cNameMeta} ${cTaxMeta} ${client?.email || ''} | RESUMEN COMERCIAL: Subtotal Paneles ${fmtMoney(cl.panelsTotal)}, Subtotal Herrajes ${fmtMoney(cl.hardwareTotal)}, TOTAL PRESUPUESTO ${fmtMoney(cl.total)} | LISTA DE CORTES: ${cl.rows.map((r) => `${r.id} ${r.name} ${r.length}x${r.width}x${r.thickness}mm x${r.qty}`).join(', ')}`
    )
  );
  pdfDoc.setKeywords([
    pdfSafeText('DAJUSCA.APP'),
    pdfSafeText('MADERA LOCAL'),
    pdfSafeText('COTIZACION FORMAL'),
    pdfSafeText(quoteNum),
    pdfSafeText(cNameMeta),
    pdfSafeText(cTaxMeta),
    pdfSafeText('RESUMEN COMERCIAL'),
    pdfSafeText('LISTA DE CORTES'),
    ...cl.rows.map((r) => pdfSafeText(`${r.id} ${r.name}`)),
  ]);
  const summaryString = pdfSafeText(
    `DAJUSCA.APP | MADERA LOCAL | COTIZACION FORMAL ${quoteNum} | DATOS DEL CLIENTE: ${cNameMeta} | RUT/DNI: ${cTaxMeta} | Email: ${client?.email || ''} | Tel: ${client?.phone || ''} | Direccion: ${client?.address || ''} | PROYECTO: ${project.name} (${layout.totalW}x${layout.maxH || s.height}x${s.depth} mm) | RESUMEN COMERCIAL: Subtotal Paneles ${fmtMoney(cl.panelsTotal)}, Subtotal Herrajes ${fmtMoney(cl.hardwareTotal)}, TOTAL PRESUPUESTO ${fmtMoney(cl.total)} | LISTA DE CORTES: ${cl.rows.map((r) => `${r.id} ${r.name} (${r.role}) ${r.length}x${r.width}x${r.thickness}mm x${r.qty} = ${fmtMoney(r.total)}`).join('; ')}`
  );
  pdfDoc.catalog.set(PDFName.of('MaderaQuoteInfo'), PDFString.of(summaryString));

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 36;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const colDark = rgb(0.11, 0.10, 0.098);
  const colGold = rgb(1.0, 0.72, 0.0);
  const colMuted = rgb(0.42, 0.40, 0.38);
  const colLightBg = rgb(0.965, 0.96, 0.95);
  const colBorder = rgb(0.84, 0.82, 0.80);
  const colWhite = rgb(1, 1, 1);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawText = (text, x, yPos, { font = fontReg, size = 9, color = colDark } = {}) => {
    page.drawText(pdfSafeText(text), { x, y: yPos, font, size, color });
  };

  const ensureSpace = (neededHeight) => {
    if (y - neededHeight < MARGIN + 28) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      // Compact continuation header
      page.drawRectangle({ x: MARGIN, y: y - 24, width: CONTENT_W, height: 24, color: colDark });
      drawText(`DAJUSCA.APP - Cotización ${quoteNum} (${project.name})`, MARGIN + 10, y - 16, {
        font: fontBold,
        size: 9,
        color: colGold,
      });
      y -= 36;
    }
  };

  // 1. MEMBRETE (Letterhead)
  const headerH = 68;
  page.drawRectangle({ x: MARGIN, y: y - headerH, width: CONTENT_W, height: headerH, color: colDark });
  page.drawRectangle({ x: MARGIN, y: y - headerH, width: 6, height: headerH, color: colGold });

  drawText('DAJUSCA.APP', MARGIN + 18, y - 24, { font: fontBold, size: 17, color: colGold });
  drawText('Dajusca - Carpintería & Diseño de Mobiliario Modular', MARGIN + 18, y - 39, {
    font: fontReg,
    size: 9,
    color: colWhite,
  });
  drawText('Dajusca | contacto@dajusca.app | Diseño, Despiece y Cotización', MARGIN + 18, y - 53, {
    font: fontReg,
    size: 8,
    color: rgb(0.8, 0.78, 0.75),
  });

  drawText('COTIZACIÓN FORMAL', PAGE_W - MARGIN - 150, y - 22, { font: fontBold, size: 11, color: colWhite });
  drawText(`N°: ${quoteNum}`, PAGE_W - MARGIN - 150, y - 38, { font: fontBold, size: 12, color: colGold });
  drawText(`Fecha: ${dateStr}`, PAGE_W - MARGIN - 150, y - 53, { font: fontReg, size: 8.5, color: colWhite });

  y -= headerH + 14;

  // 2. DATOS DEL CLIENTE Y PROYECTO
  const boxH = 84;
  const colW = (CONTENT_W - 12) / 2;

  // Client Box
  page.drawRectangle({
    x: MARGIN,
    y: y - boxH,
    width: colW,
    height: boxH,
    color: colLightBg,
    borderColor: colBorder,
    borderWidth: 1,
  });
  drawText('DATOS DEL CLIENTE', MARGIN + 10, y - 15, { font: fontBold, size: 9, color: colDark });
  const cName = client?.name || 'Cliente General / Consumidor Final';
  const cTax = client?.tax_id || 'Sin especificar';
  const cEmail = client?.email || 'Sin correo registrado';
  const cPhone = client?.phone || 'Sin teléfono';
  const cAddr = client?.address || 'Retiro en taller / A convenir';

  drawText(`Cliente: ${cName}`, MARGIN + 10, y - 30, { font: fontBold, size: 8.5 });
  drawText(`RUT / DNI / NIF: ${cTax}`, MARGIN + 10, y - 43, { size: 8, color: colMuted });
  drawText(`Email: ${cEmail} | Tel: ${cPhone}`, MARGIN + 10, y - 56, { size: 8, color: colMuted });
  drawText(`Dirección: ${cAddr}`, MARGIN + 10, y - 69, { size: 8, color: colMuted });

  // Project Box
  const rightX = MARGIN + colW + 12;
  page.drawRectangle({
    x: rightX,
    y: y - boxH,
    width: colW,
    height: boxH,
    color: colLightBg,
    borderColor: colBorder,
    borderWidth: 1,
  });
  drawText('ESPECIFICACIONES DEL PROYECTO', rightX + 10, y - 15, { font: fontBold, size: 9, color: colDark });
  const maxH = layout.maxH || s.height;
  drawText(`Proyecto: ${project.name || 'Mueble modular'}`, rightX + 10, y - 30, { font: fontBold, size: 8.5 });
  drawText(`Dimensiones: ${layout.totalW} x ${maxH} x ${s.depth} mm`, rightX + 10, y - 43, { size: 8, color: colMuted });
  drawText(`Espesor tablero: ${s.thickness} mm | Fondo: ${s.backThickness} mm`, rightX + 10, y - 56, { size: 8, color: colMuted });
  drawText(`Superficie paneles: ${cl.area.toFixed(2)} m2 | Piezas: ${cl.rows.reduce((a, r) => a + r.qty, 0)}`, rightX + 10, y - 69, {
    size: 8,
    color: colMuted,
  });

  y -= boxH + 14;

  // 3. RESUMEN COMERCIAL (Commercial Summary)
  const sumH = 74;
  page.drawRectangle({
    x: MARGIN,
    y: y - sumH,
    width: CONTENT_W,
    height: sumH,
    color: colWhite,
    borderColor: colDark,
    borderWidth: 1,
  });
  page.drawRectangle({ x: MARGIN, y: y - 20, width: CONTENT_W, height: 20, color: colDark });
  drawText('RESUMEN COMERCIAL DEL PRESUPUESTO', MARGIN + 10, y - 14, {
    font: fontBold,
    size: 9,
    color: colGold,
  });

  drawText(`Subtotal Paneles y Tableros (${cl.area.toFixed(2)} m2):`, MARGIN + 12, y - 36, { size: 9 });
  drawText(fmtMoney(cl.panelsTotal), MARGIN + 240, y - 36, { font: fontBold, size: 9 });

  drawText('Subtotal Herrajes y Accesorios:', MARGIN + 12, y - 51, { size: 9 });
  drawText(fmtMoney(cl.hardwareTotal), MARGIN + 240, y - 51, { font: fontBold, size: 9 });

  const finalTotal = quote?.total !== undefined && quote?.total > 0 ? quote.total : cl.total;
  page.drawRectangle({
    x: PAGE_W - MARGIN - 205,
    y: y - sumH + 10,
    width: 195,
    height: 42,
    color: colLightBg,
    borderColor: colGold,
    borderWidth: 1.5,
  });
  drawText('TOTAL PRESUPUESTO', PAGE_W - MARGIN - 195, y - 37, { font: fontBold, size: 8.5, color: colMuted });
  drawText(fmtMoney(finalTotal), PAGE_W - MARGIN - 195, y - 54, { font: fontBold, size: 13, color: colDark });

  y -= sumH + 16;

  // 4. LISTA DE CORTES (Cutlist Table)
  ensureSpace(60);
  drawText('LISTA DE CORTES (DESGLOSE DE PANELES)', MARGIN, y - 10, { font: fontBold, size: 10, color: colDark });
  y -= 16;

  const drawCutlistHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 18, color: colDark });
    drawText('ID', MARGIN + 6, y - 12, { font: fontBold, size: 8, color: colGold });
    drawText('Pieza / Rol', MARGIN + 36, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Orient.', MARGIN + 195, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Largo', MARGIN + 255, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Ancho', MARGIN + 305, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Esp.', MARGIN + 355, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Cant.', MARGIN + 390, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('P. Unit.', MARGIN + 425, y - 12, { font: fontBold, size: 8, color: colWhite });
    drawText('Subtotal', MARGIN + 475, y - 12, { font: fontBold, size: 8, color: colWhite });
    y -= 18;
  };

  drawCutlistHeader();

  cl.rows.forEach((r, idx) => {
    if (y - 16 < MARGIN + 28) {
      ensureSpace(45);
      drawCutlistHeader();
    }
    if (idx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - 15, width: CONTENT_W, height: 15, color: colLightBg });
    }
    const pieceLabel = `${r.name} (${r.role})`.slice(0, 32);
    drawText(r.id, MARGIN + 6, y - 11, { font: fontBold, size: 8 });
    drawText(pieceLabel, MARGIN + 36, y - 11, { size: 8 });
    drawText(String(r.orientation || ''), MARGIN + 195, y - 11, { size: 7.5, color: colMuted });
    drawText(`${r.length} mm`, MARGIN + 255, y - 11, { size: 8 });
    drawText(`${r.width} mm`, MARGIN + 305, y - 11, { size: 8 });
    drawText(`${r.thickness}`, MARGIN + 355, y - 11, { size: 8 });
    drawText(String(r.qty), MARGIN + 395, y - 11, { font: fontBold, size: 8 });
    drawText(fmtMoney(r.unitPrice), MARGIN + 425, y - 11, { size: 8 });
    drawText(fmtMoney(r.total), MARGIN + 475, y - 11, { font: fontBold, size: 8 });
    y -= 15;
  });

  // Cutlist Subtotal Row
  page.drawRectangle({ x: MARGIN, y: y - 17, width: CONTENT_W, height: 17, color: colLightBg, borderColor: colBorder, borderWidth: 0.5 });
  drawText(`Subtotal Paneles (${cl.area.toFixed(2)} m2)`, MARGIN + 6, y - 12, { font: fontBold, size: 8.5 });
  drawText(fmtMoney(cl.panelsTotal), MARGIN + 475, y - 12, { font: fontBold, size: 8.5 });
  y -= 28;

  // 5. DESGLOSE DE HERRAJES (Hardware Table)
  ensureSpace(60);
  drawText('DESGLOSE DE HERRAJES Y ACCESORIOS', MARGIN, y - 10, { font: fontBold, size: 10, color: colDark });
  y -= 16;

  page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 18, color: colDark });
  drawText('Herraje / Especificación', MARGIN + 8, y - 12, { font: fontBold, size: 8, color: colWhite });
  drawText('Cantidad', MARGIN + 340, y - 12, { font: fontBold, size: 8, color: colWhite });
  drawText('P. Unit.', MARGIN + 410, y - 12, { font: fontBold, size: 8, color: colWhite });
  drawText('Subtotal', MARGIN + 475, y - 12, { font: fontBold, size: 8, color: colWhite });
  y -= 18;

  if (cl.hardware && cl.hardware.length > 0) {
    cl.hardware.forEach((h, idx) => {
      ensureSpace(20);
      if (idx % 2 === 1) {
        page.drawRectangle({ x: MARGIN, y: y - 15, width: CONTENT_W, height: 15, color: colLightBg });
      }
      drawText(h.name, MARGIN + 8, y - 11, { size: 8 });
      drawText(String(h.qty), MARGIN + 345, y - 11, { font: fontBold, size: 8 });
      drawText(fmtMoney(h.unitPrice), MARGIN + 410, y - 11, { size: 8 });
      drawText(fmtMoney(h.total), MARGIN + 475, y - 11, { font: fontBold, size: 8 });
      y -= 15;
    });
  } else {
    drawText('Sin herrajes adicionales', MARGIN + 8, y - 12, { size: 8, color: colMuted });
    y -= 16;
  }

  page.drawRectangle({ x: MARGIN, y: y - 17, width: CONTENT_W, height: 17, color: colLightBg, borderColor: colBorder, borderWidth: 0.5 });
  drawText('Subtotal Herrajes', MARGIN + 8, y - 12, { font: fontBold, size: 8.5 });
  drawText(fmtMoney(cl.hardwareTotal), MARGIN + 475, y - 12, { font: fontBold, size: 8.5 });
  y -= 28;

  // Footer on all pages
  const pages = pdfDoc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(
      pdfSafeText(`Dajusca.app | Cotización ${quoteNum} | Proyecto: ${project.name} | Página ${i + 1} de ${pages.length}`),
      { x: MARGIN, y: 18, font: fontReg, size: 7.5, color: colMuted }
    );
  });

  return pdfDoc.save({ useObjectStreams: false });
}

const handleProjectPdf = async (req, res) => {
  try {
    const p = own(req);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const reqClientId = req.query.client_id ?? req.body?.client_id ?? p.client_id;
    let client = reqClientId ? ownClient(req.user.id, reqClientId) : null;
    if (!client && (req.body?.client || req.query.client_name)) {
      client = {
        name: req.body?.client?.name || req.query.client_name,
        tax_id: req.body?.client?.tax_id || req.query.client_tax_id || '',
        email: req.body?.client?.email || req.query.client_email || '',
        phone: req.body?.client?.phone || req.query.client_phone || '',
        address: req.body?.client?.address || req.query.client_address || '',
      };
    }

    const pData = JSON.parse(p.data || '{}');
    const layout = computeLayout(pData);

    // Retrieve existing quote or create a correlative quote for this project
    let quote = null;
    const reqQuoteId = req.query.quote_id ?? req.body?.quote_id;
    if (reqQuoteId) {
      quote = db
        .prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?')
        .get(Number(reqQuoteId), req.user.id);
    }
    if (!quote && req.query.new_quote !== '1' && !req.body?.new_quote) {
      quote = db
        .prepare('SELECT * FROM quotes WHERE project_id = ? AND user_id = ? ORDER BY seq DESC, id DESC LIMIT 1')
        .get(p.id, req.user.id);
    }
    if (!quote) {
      quote = createQuoteRecord(req.user.id, {
        project_id: p.id,
        client_id: client?.id || p.client_id || null,
        notes: req.body?.notes || '',
      });
    }

    const pdfBytes = await generateProjectQuotePdf({ project: p, client, quote, layout });
    const safeName = String(p.name || 'proyecto')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cotizacion-${quote.quote_number}-${safeName}.pdf"`
    );
    res.setHeader('X-Quote-Number', quote.quote_number);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('[PDF Export Error]:', err);
    res.status(500).json({ error: 'Error al generar el PDF de cotización: ' + (err.message || err) });
  }
};

app.get('/api/projects/:id/pdf', auth, handleProjectPdf);
app.post('/api/projects/:id/pdf', auth, handleProjectPdf);

// Export app and components for testing
export { app, db, hashPassword, startSession, auth, migrateDb, upsertGoogleUser, formatQuoteNumber, createQuoteRecord };

// Start listening if executed directly
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'))) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Madera local en http://localhost:${PORT}`));
}
