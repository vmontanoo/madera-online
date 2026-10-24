import { computeLayout, SETTING_META, DEFAULTS, TYPES, FRONTS, LABELS, PULLS, cutlistCSV, uid } from './layout.js';
import * as M from './model.js';
import { Viewer } from './viewer.js';
import { DEMOS, cloneDemoProject } from './demos.js';
import {
  auth as fbAuth,
  waitForFirebaseAuth,
  signInWithGooglePopup,
  registerWithEmailFirebase,
  loginWithEmailFirebase,
  formatFirebaseUser,
  handleFirestoreApi,
  ADMIN_EMAILS,
  isAuthorizedAdmin,
} from './firebase-cloud.js';

export { ADMIN_EMAILS, isAuthorizedAdmin };

export const VALID_NEW_TYPES = ['shelf', 'drawer', 'rail'];

export const FRONT_OPTIONS = [
  { id: 'none', label: 'Sin puertas / Abierto' },
  { id: 'doors', label: 'Dos puertas batientes' },
  { id: 'left-door', label: 'Puerta batiente izquierda' },
  { id: 'right-door', label: 'Puerta batiente derecha' },
  { id: 'sliding', label: 'Puertas corredizas con riel' },
  { id: 'bifold', label: 'Puerta plegable / acordeón' },
  { id: 'lift-up', label: 'Puerta abatible hacia arriba' },
];

const $app = typeof document !== 'undefined' ? document.getElementById('app') : null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const isStaticCloudHost =
  typeof location !== 'undefined' &&
  /\.(workers\.dev|pages\.dev|github\.io|netlify\.app|vercel\.app|web\.app|firebaseapp\.com)$/i.test(
    location.hostname || ''
  );

let staticBackendFallback =
  isStaticCloudHost ||
  (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dajusca_static_mode') === '1');

function loadLocalStore() {
  try {
    const raw = localStorage.getItem('dajusca_local_db');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { users: [], projects: [], clients: [], quotes: [], nextId: 1 };
}

function saveLocalStore(store) {
  try {
    localStorage.setItem('dajusca_local_db', JSON.stringify(store));
  } catch {}
}

function getLocalUser(store) {
  const token = localStorage.getItem('madera_token') || '';
  const m = token.match(/^local-token-(\d+)$/);
  if (!m) return null;
  const uidNum = Number(m[1]);
  return store.users.find((u) => u.id === uidNum) || null;
}

function handleLocalApi(method, url, body) {
  const store = loadLocalStore();
  const nextId = () => {
    store.nextId = (store.nextId || 1) + 1;
    return store.nextId;
  };
  const path = url.split('?')[0];
  const user = getLocalUser(store);

  // Auth routes
  if (method === 'GET' && (path === '/api/auth/me' || path === '/api/me')) {
    if (!user) throw Object.assign(new Error('No autenticado'), { status: 401 });
    return { user, email: user.email };
  }
  if (path === '/api/auth/logout' || path === '/api/logout') {
    localStorage.removeItem('madera_token');
    return { ok: true };
  }
  if (method === 'POST' && (path === '/api/auth/register' || path === '/api/register')) {
    const email = String(body?.email || '').trim().toLowerCase();
    const name = String(body?.name || '').trim();
    const password = String(body?.password || '');
    if (name.length < 2 || name.length > 100) {
      throw Object.assign(new Error('El nombre debe tener entre 2 y 100 caracteres'), { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error('Formato de email inválido'), { status: 400 });
    }
    if (password.length < 6 || password.length > 128) {
      throw Object.assign(new Error('La contraseña debe tener entre 6 y 128 caracteres'), { status: 400 });
    }
    if (store.users.some((u) => u.email === email)) {
      throw Object.assign(new Error('Ese email ya está registrado'), { status: 409 });
    }
    const newUser = { id: nextId(), name, email, password, provider: 'local', avatar_url: null, created_at: Date.now() };
    store.users.push(newUser);
    saveLocalStore(store);
    const token = `local-token-${newUser.id}`;
    localStorage.setItem('madera_token', token);
    return { user: newUser, email: newUser.email, token };
  }
  if (method === 'POST' && (path === '/api/auth/login' || path === '/api/login')) {
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) {
      throw Object.assign(new Error('Email y contraseña requeridos'), { status: 400 });
    }
    const u = store.users.find((x) => x.email === email);
    if (!u) {
      throw Object.assign(new Error('Credenciales incorrectas. Si no tienes cuenta, regístrate primero en "Crear cuenta".'), { status: 401 });
    }
    if (u.provider === 'google' && !u.password) {
      throw Object.assign(new Error('Esta cuenta fue creada con Google Sign-In. Usa el botón "Iniciar sesión con Google".'), { status: 401 });
    }
    if (u.password !== password) {
      throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });
    }
    const token = `local-token-${u.id}`;
    localStorage.setItem('madera_token', token);
    return { user: u, email: u.email, token };
  }

  const activeUser = user || { id: 1, name: 'Usuario Dajusca', email: 'usuario@dajusca.app' };

  // Projects routes
  if (method === 'GET' && path === '/api/projects') {
    return store.projects
      .filter((p) => p.user_id === activeUser.id)
      .sort((a, b) => b.updated_at - a.updated_at);
  }
  if (method === 'POST' && path === '/api/projects') {
    const p = {
      id: nextId(),
      user_id: activeUser.id,
      client_id: body?.client_id || null,
      name: String(body?.name || 'Sin título').trim(),
      data: body?.data || M.defaultProject(),
      description: body?.description || '',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    store.projects.push(p);
    saveLocalStore(store);
    return p;
  }
  const projDupMatch = path.match(/^\/api\/projects\/(\d+)\/duplicate$/);
  if (method === 'POST' && projDupMatch) {
    const orig = store.projects.find((p) => p.id === Number(projDupMatch[1]));
    if (!orig) throw Object.assign(new Error('No encontrado'), { status: 404 });
    const copy = {
      ...JSON.parse(JSON.stringify(orig)),
      id: nextId(),
      name: `${orig.name} (copia)`,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    store.projects.push(copy);
    saveLocalStore(store);
    return copy;
  }
  const projClientMatch = path.match(/^\/api\/projects\/(\d+)\/client$/);
  if (method === 'PUT' && projClientMatch) {
    const p = store.projects.find((x) => x.id === Number(projClientMatch[1]));
    if (!p) throw Object.assign(new Error('No encontrado'), { status: 404 });
    p.client_id = body?.client_id ? Number(body.client_id) : null;
    p.updated_at = Date.now();
    saveLocalStore(store);
    const client = store.clients.find((c) => c.id === p.client_id) || null;
    return { ...p, client };
  }
  const projQuotesMatch = path.match(/^\/api\/projects\/(\d+)\/quotes$/);
  if (projQuotesMatch) {
    const pid = Number(projQuotesMatch[1]);
    if (method === 'GET') {
      return store.quotes.filter((q) => q.project_id === pid).sort((a, b) => b.seq - a.seq);
    }
    if (method === 'POST') {
      const p = store.projects.find((x) => x.id === pid);
      const maxSeq = store.quotes.reduce((m, q) => Math.max(m, q.seq || 0), 0);
      const seq = maxSeq + 1;
      const quote_number = `PRE-${String(seq).padStart(4, '0')}`;
      const layout = p ? computeLayout(p.data) : { cutlist: { total: 0 } };
      const q = {
        id: nextId(),
        user_id: activeUser.id,
        project_id: pid,
        client_id: body?.client_id || p?.client_id || null,
        seq,
        quote_number,
        total: layout.cutlist.total || 0,
        currency: p?.data?.settings?.currency || '$',
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      store.quotes.push(q);
      saveLocalStore(store);
      return q;
    }
  }
  const projIdMatch = path.match(/^\/api\/projects\/(\d+)$/);
  if (projIdMatch) {
    const pid = Number(projIdMatch[1]);
    const idx = store.projects.findIndex((x) => x.id === pid);
    if (idx === -1) throw Object.assign(new Error('No encontrado'), { status: 404 });
    const p = store.projects[idx];
    if (method === 'GET') {
      const client = store.clients.find((c) => c.id === p.client_id) || null;
      const quotes = store.quotes.filter((q) => q.project_id === pid).sort((a, b) => b.seq - a.seq);
      return { ...p, client, quotes };
    }
    if (method === 'PUT') {
      if (body?.name !== undefined) p.name = String(body.name).trim() || 'Sin título';
      if (body?.data !== undefined) p.data = body.data;
      if (body?.client_id !== undefined) p.client_id = body.client_id ? Number(body.client_id) : null;
      p.updated_at = Date.now();
      saveLocalStore(store);
      return p;
    }
    if (method === 'DELETE') {
      store.projects.splice(idx, 1);
      saveLocalStore(store);
      return { ok: true };
    }
  }

  // Clients routes
  if (method === 'GET' && path === '/api/clients') {
    return store.clients.filter((c) => c.user_id === activeUser.id);
  }
  if (method === 'POST' && path === '/api/clients') {
    const c = {
      id: nextId(),
      user_id: activeUser.id,
      name: String(body?.name || '').trim(),
      tax_id: String(body?.tax_id || '').trim(),
      email: String(body?.email || '').trim(),
      phone: String(body?.phone || '').trim(),
      address: String(body?.address || '').trim(),
      notes: String(body?.notes || '').trim(),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    store.clients.unshift(c);
    saveLocalStore(store);
    return c;
  }

  // Admin Pricing Catalog routes
  if (path === '/api/admin/pricing') {
    if (method === 'GET') {
      return {
        prices: { ...DEFAULTS, ...(store.catalogPricing?.prices || {}) },
        updatedByEmail: store.catalogPricing?.updatedByEmail || '',
        updatedAt: store.catalogPricing?.updatedAt || null,
      };
    }
    if (method === 'PUT' || method === 'POST') {
      if (!isAuthorizedAdmin(activeUser)) {
        throw Object.assign(new Error('No tienes permisos de administrador para modificar los costos.'), {
          status: 403,
        });
      }
      const incomingPrices = body?.prices && typeof body.prices === 'object' ? body.prices : {};
      const sanitized = {};
      Object.keys(DEFAULTS).forEach((k) => {
        if (incomingPrices[k] !== undefined) {
          if (typeof DEFAULTS[k] === 'string') {
            sanitized[k] = String(incomingPrices[k]).trim() || DEFAULTS[k];
          } else {
            const num = Number(incomingPrices[k]);
            if (Number.isFinite(num) && num >= 0) sanitized[k] = num;
          }
        }
      });
      if (sanitized.slidePrice !== undefined) sanitized.priceSlide = sanitized.slidePrice;
      if (sanitized.hingePrice !== undefined) sanitized.priceHinge = sanitized.hingePrice;
      store.catalogPricing = {
        prices: { ...DEFAULTS, ...sanitized },
        updatedByEmail: activeUser.email || '',
        updatedAt: Date.now(),
      };
      saveLocalStore(store);
      return store.catalogPricing;
    }
  }

  return {};
}

async function api(method, url, body) {
  // If user is authenticated via Firebase Cloud Auth, persist directly in Cloud Firestore
  if (fbAuth?.currentUser) {
    return handleFirestoreApi(method, url, body);
  }
  if (staticBackendFallback) {
    return handleLocalApi(method, url, body);
  }
  const token = localStorage.getItem('madera_token');
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let r;
  try {
    r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    staticBackendFallback = true;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('dajusca_static_mode', '1');
    return handleLocalApi(method, url, body);
  }
  const ct = r.headers?.get?.('content-type') || '';
  const j = await r.json().catch(() => ({}));
  // If static hosting returns HTML 404/405 for /api/* routes, switch to LocalStorage fallback
  if ((r.status === 404 || r.status === 405) && (!ct.includes('application/json') || !j.error)) {
    staticBackendFallback = true;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('dajusca_static_mode', '1');
    return handleLocalApi(method, url, body);
  }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { status: r.status });
  return j;
}

let viewer = null;
let cleanup = null;
let currentUser = null;
let activeDashboardTab = 'projects'; // 'projects' | 'demos'

function validateProjectData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('El contenido del proyecto no es un objeto válido.');
  }
  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    throw new Error('El proyecto debe contener un arreglo "columns" con al menos una columna.');
  }

  // Validate settings if provided
  if (data.settings && typeof data.settings === 'object') {
    const requiredPositive = ['height', 'depth', 'thickness'];
    for (const key of requiredPositive) {
      if (data.settings[key] !== undefined) {
        const val = data.settings[key];
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
          throw new Error(`Ajuste inválido: "settings.${key}" (${val}) debe ser un número positivo mayor que cero.`);
        }
      }
    }
    const nonNegative = ['overhang', 'backThickness', 'frontClearance'];
    for (const key of nonNegative) {
      if (data.settings[key] !== undefined) {
        const val = data.settings[key];
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
          throw new Error(`Ajuste inválido: "settings.${key}" (${val}) debe ser un número mayor o igual a cero.`);
        }
      }
    }
  }

  // Validate columns and nodes
  data.columns.forEach((col, idx) => {
    if (!col || typeof col !== 'object') {
      throw new Error(`La columna #${idx + 1} no es un objeto válido.`);
    }
    if (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width <= 0) {
      throw new Error(`Ancho inválido en columna #${idx + 1}: ${col.width}. Debe ser un número positivo.`);
    }
    if (!col.root || typeof col.root !== 'object') {
      throw new Error(`Estructura incompleta en columna #${idx + 1}: falta el nodo "root".`);
    }

    const checkNode = (node, path) => {
      if (!node || typeof node !== 'object') {
        throw new Error(`Nodo inválido en ${path}.`);
      }
      if (node.size !== undefined) {
        if (typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size <= 0) {
          throw new Error(`Medida (size) inválida en ${path}: ${node.size}. Debe ser un número positivo.`);
        }
      }
      if (node.type === 'drawer' && node.count !== undefined) {
        if (typeof node.count !== 'number' || !Number.isFinite(node.count) || node.count < 1) {
          throw new Error(`Cantidad de gavetas (count) inválida en ${path}: ${node.count}. Debe ser un número mayor o igual a 1.`);
        }
      }
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
          throw new Error(`"children" en ${path} debe ser un arreglo.`);
        }
        node.children.forEach((child, childIdx) => {
          checkNode(child, `${path} > hijo #${childIdx + 1}`);
        });
      }
    };

    checkNode(col.root, `Columna #${idx + 1}`);
  });
}

async function fetchSession() {
  try {
    const fbUser = await waitForFirebaseAuth();
    if (fbUser || fbAuth?.currentUser) {
      currentUser = formatFirebaseUser(fbAuth.currentUser || fbUser);
      return currentUser;
    }
    const res = await api('GET', '/api/auth/me').catch(() => api('GET', '/api/me'));
    currentUser = res.user || res;
    return currentUser;
  } catch {
    currentUser = null;
    return null;
  }
}

async function route() {
  if (!$app) return;
  if (cleanup) cleanup();
  cleanup = null;
  const user = await fetchSession();
  if (!user) {
    return authView();
  }
  if (location.hash === '#/admin') {
    return adminView();
  }
  const m = location.hash.match(/^#\/p\/([a-zA-Z0-9_-]+)/);
  if (m) return editorView(m[1]);
  return listView();
}
if (typeof window !== 'undefined') window.addEventListener('hashchange', route);

function renderUserAvatar(user, size = 32) {
  if (user?.avatar_url) {
    return `<img class="user-avatar" src="${esc(user.avatar_url)}" alt="${esc(user.name || 'Avatar')}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;">`;
  }
  const name = user?.name || user?.email || 'U';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('') || 'U';
  return `<div class="user-avatar user-initials" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:${Math.round(size * 0.42)}px;">${esc(initials)}</div>`;
}

/* ---------------- Auth ---------------- */
function authView() {
  let authMode = 'login'; // 'login' | 'register'

  $app.innerHTML = `
  <div class="center auth-wrapper">
    <div class="auth-card">
      <div class="auth-header">
        <h2 class="auth-title">Dajusca.app</h2>
        <span class="auth-subtitle" id="authSubtitle">Inicia sesión en tu cuenta para acceder a tus muebles</span>
      </div>

      <!-- Google Sign-In Button (Official Branding) -->
      <button type="button" class="btn-google" id="btnGoogle">
        <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Iniciar sesión con Google</span>
      </button>

      <div class="auth-divider"><span>o bien con correo</span></div>

      <!-- Mode Selector Tabs -->
      <div class="auth-tabs">
        <button type="button" class="auth-tab on" id="tabLogin" data-m="login">Iniciar sesión</button>
        <button type="button" class="auth-tab" id="tabRegister" data-m="register">Crear cuenta</button>
      </div>

      <!-- Error Banner -->
      <div class="auth-err" id="authErr" style="display:none" role="alert">
        <span class="auth-err-icon">⚠️</span>
        <span class="auth-err-text" id="authErrText"></span>
      </div>

      <!-- Local Credentials Form -->
      <form class="auth-form" id="authForm" novalidate>
        <div class="form-group" id="nameGroup" style="display:none">
          <label class="form-label" for="inpName">Nombre completo</label>
          <input class="form-input" id="inpName" name="name" type="text" autocomplete="name" placeholder="Ej. Ana García">
          <span class="form-hint">Mínimo 2 caracteres</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="inpEmail">Correo electrónico</label>
          <input class="form-input" id="inpEmail" name="email" type="email" autocomplete="email" placeholder="tu@email.com" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="inpPass">Contraseña</label>
          <input class="form-input" id="inpPass" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
          <span class="form-hint" id="passHint" style="display:none">Mínimo 6 caracteres</span>
        </div>

        <button class="primary btn-submit" id="btnSubmit" type="submit">Iniciar sesión</button>
      </form>

      <div class="auth-footer">
        <span id="footerPrompt">¿No tienes una cuenta?</span>
        <a href="javascript:void(0)" class="auth-toggle-link" id="authToggleLink">Regístrate aquí</a>
      </div>
    </div>
  </div>`;

  const form = document.getElementById('authForm');
  const errBox = document.getElementById('authErr');
  const errText = document.getElementById('authErrText');
  const nameGroup = document.getElementById('nameGroup');
  const passHint = document.getElementById('passHint');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const btnSubmit = document.getElementById('btnSubmit');
  const subtitle = document.getElementById('authSubtitle');
  const footerPrompt = document.getElementById('footerPrompt');
  const toggleLink = document.getElementById('authToggleLink');

  const showErr = (msg) => {
    if (!msg) {
      errBox.style.display = 'none';
      errText.textContent = '';
    } else {
      errText.textContent = msg;
      errBox.style.display = 'flex';
    }
  };

  const setMode = (mode) => {
    authMode = mode;
    showErr('');
    if (mode === 'login') {
      tabLogin.classList.add('on');
      tabRegister.classList.remove('on');
      nameGroup.style.display = 'none';
      passHint.style.display = 'none';
      btnSubmit.textContent = 'Iniciar sesión';
      subtitle.textContent = 'Inicia sesión en tu cuenta para acceder a tus muebles';
      footerPrompt.textContent = '¿No tienes una cuenta?';
      toggleLink.textContent = 'Regístrate aquí';
      form.password.autocomplete = 'current-password';
    } else {
      tabLogin.classList.remove('on');
      tabRegister.classList.add('on');
      nameGroup.style.display = 'flex';
      passHint.style.display = 'block';
      btnSubmit.textContent = 'Crear cuenta';
      subtitle.textContent = 'Crea tu cuenta para diseñar y guardar muebles modulares';
      footerPrompt.textContent = '¿Ya tienes una cuenta?';
      toggleLink.textContent = 'Inicia sesión';
      form.password.autocomplete = 'new-password';
    }
  };

  tabLogin.onclick = () => setMode('login');
  tabRegister.onclick = () => setMode('register');
  toggleLink.onclick = () => setMode(authMode === 'login' ? 'register' : 'login');

  // Clear errors on typing
  form.addEventListener('input', () => showErr(''));

  // Real Firebase Google Sign-In Popup (asks which Google account to sign in with across any device)
  document.getElementById('btnGoogle').onclick = async () => {
    showErr('');
    try {
      const fbUser = await signInWithGooglePopup();
      if (fbUser) {
        currentUser = fbUser;
        route();
        return;
      }
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        return;
      }
      if (err?.code === 'auth/unauthorized-domain') {
        showErr(
          `Agrega el dominio "${location.hostname}" en tu Consola de Firebase (Authentication > Settings > Authorized domains) para usar el popup oficial de Google en este dominio.`
        );
        return;
      }
      showErr(err?.message || 'No se pudo iniciar sesión con Google.');
    }
  };

  // Submit Handler with Client-Side Validation
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    const name = form.name.value.trim();

    // Client-side validations
    if (authMode === 'register') {
      if (!name || name.length < 2) {
        showErr('Por favor, ingresa tu nombre completo (mínimo 2 caracteres).');
        form.name.focus();
        return;
      }
      if (name.length > 100) {
        showErr('El nombre no debe superar los 100 caracteres.');
        form.name.focus();
        return;
      }
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      showErr('Por favor, ingresa un correo electrónico válido.');
      form.email.focus();
      return;
    }

    if (!password || (authMode === 'register' && password.length < 6)) {
      showErr(
        authMode === 'register'
          ? 'La contraseña debe tener al menos 6 caracteres.'
          : 'Por favor, ingresa tu contraseña.'
      );
      form.password.focus();
      return;
    }

    // Submit API request (uses Firebase Auth on static/cloud hosts or Backend API when running locally)
    try {
      if (staticBackendFallback) {
        const fbUser =
          authMode === 'register'
            ? await registerWithEmailFirebase(name, email, password)
            : await loginWithEmailFirebase(email, password);
        currentUser = fbUser;
        route();
        return;
      }
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const legacyEndpoint = authMode === 'register' ? '/api/register' : '/api/login';
      const body = authMode === 'register' ? { name, email, password } : { email, password };

      const res = await api('POST', endpoint, body).catch(() => api('POST', legacyEndpoint, body));
      if (res.token) {
        localStorage.setItem('madera_token', res.token);
      }
      currentUser = res.user || { email };
      route();
    } catch (err) {
      showErr(err.message || 'Error al autenticar. Revisa tus credenciales.');
    }
  });
}

/* ---------------- Dashboard / Lista de proyectos ---------------- */
async function listView() {
  const projects = await api('GET', '/api/projects').catch(() => []);

  // HTML Rendering Helpers
  function renderProjectsHTML(list) {
    if (!list || list.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">🪵</div>
          <h3>Aún no tienes proyectos guardados</h3>
          <p class="muted">Comienza diseñando un mueble desde cero con el botón <b>"+ Nuevo mueble"</b> o explora las plantillas prediseñadas en la pestaña <b>"Galería de Demos"</b>.</p>
        </div>
      `;
    }
    return `
      <div class="proj-list">
        ${list
          .map(
            (p) => `
          <div class="proj" data-id="${p.id}">
            <div class="proj-info">
              <span class="name" data-a="open" title="Abrir en el editor">${esc(p.name)}</span>
              <span class="proj-date muted">${new Date(p.updated_at).toLocaleString()}</span>
            </div>
            <div class="proj-actions">
              <button class="btn-action" data-a="open" title="Abrir en el editor">Abrir</button>
              <button class="btn-action" data-a="rename" title="Cambiar nombre">Renombrar</button>
              <button class="btn-action" data-a="dup" title="Crear copia">Duplicar</button>
              <button class="btn-action danger" data-a="del" title="Eliminar proyecto">Eliminar</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderDemosHTML() {
    return `
      <div class="demos-grid">
        ${(DEMOS || [])
          .map(
            (d) => `
          <div class="demo-card" data-demo-id="${esc(d.id)}">
            <div class="demo-card-header">
              <span class="demo-badge">${esc(d.category)}</span>
              <span class="demo-dim">${esc(d.dimensions)}</span>
            </div>
            <h3 class="demo-title">${esc(d.name)}</h3>
            <p class="demo-desc">${esc(d.description)}</p>
            <div class="demo-tags">
              ${(d.tags || []).map((t) => `<span class="demo-tag">${esc(t)}</span>`).join('')}
            </div>
            <div class="demo-actions">
              <button class="primary btn-open-demo" data-a="use-demo" data-id="${esc(d.id)}">
                Abrir plantilla
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  const isAdminUser = isAuthorizedAdmin(currentUser);
  // Preload catalog pricing in background so new projects inherit admin costs
  api('GET', '/api/admin/pricing').catch(() => {});

  // Mount Dashboard Shell with DOM-Preserved Tab Panes
  $app.innerHTML = `
    <div class="list">
      <header class="list-header">
        <div class="brand-row">
          <h2 style="margin:0">Dajusca.app</h2>
        </div>
        <div class="header-actions">
          <button class="primary" id="new">+ Nuevo mueble</button>
          <button id="importBtn" class="btn-action">Importar archivo</button>
          ${isAdminUser ? `<button id="adminBtn" class="btn-action btn-admin-nav" title="Panel de costos de materiales y herrajes">⚙ Costos (Admin)</button>` : ''}
          <input type="file" id="importInput" accept=".json,application/json" style="display:none">
          <div class="user-profile-chip" id="userProfileChip">
            ${renderUserAvatar(currentUser, 32)}
            <div class="user-profile-info">
              <span class="user-name">${esc(currentUser?.name || currentUser?.email?.split('@')[0] || 'Usuario')}</span>
              <span class="user-email muted">${esc(currentUser?.email || '')}</span>
            </div>
            <button id="out" class="btn-logout" title="Cerrar sesión">Salir</button>
          </div>
        </div>
      </header>

      <!-- Navigation Tabs with Active/Shaded Styling and Counter Badges -->
      <div class="dash-tabs" role="tablist">
        <button 
          class="dash-tab ${activeDashboardTab === 'projects' ? 'active' : ''}" 
          id="tabProjects" 
          role="tab" 
          aria-selected="${activeDashboardTab === 'projects'}"
          aria-controls="tabContentProjects"
        >
          Mis Proyectos
          <span class="tab-badge" id="badgeProjects">${projects.length}</span>
        </button>
        <button 
          class="dash-tab ${activeDashboardTab === 'demos' ? 'active' : ''}" 
          id="tabDemos" 
          role="tab" 
          aria-selected="${activeDashboardTab === 'demos'}"
          aria-controls="tabContentDemos"
        >
          Galería de Demos
          <span class="tab-badge" id="badgeDemos">${(DEMOS || []).length}</span>
        </button>
        ${isAdminUser ? `
        <button 
          class="dash-tab" 
          id="tabAdmin" 
          role="tab"
          title="Configurar costos globales de materiales y herrajes"
        >
          Panel Administrador
          <span class="tab-badge">⚙</span>
        </button>` : ''}
      </div>

      <!-- Tab Panes (Both preserved in DOM) -->
      <div id="tabContentProjects" class="tab-pane" style="${activeDashboardTab === 'projects' ? '' : 'display:none'}">
        ${renderProjectsHTML(projects)}
      </div>

      <div id="tabContentDemos" class="tab-pane" style="${activeDashboardTab === 'demos' ? '' : 'display:none'}">
        ${renderDemosHTML()}
      </div>
    </div>
  `;

  // References
  const tabProjects = document.getElementById('tabProjects');
  const tabDemos = document.getElementById('tabDemos');
  const tabAdmin = document.getElementById('tabAdmin');
  const adminBtn = document.getElementById('adminBtn');
  const paneProjects = document.getElementById('tabContentProjects');
  const paneDemos = document.getElementById('tabContentDemos');
  if (tabAdmin) tabAdmin.onclick = () => (location.hash = '#/admin');
  if (adminBtn) adminBtn.onclick = () => (location.hash = '#/admin');

  // Tab Switching Handler (Instantaneous DOM Preservation)
  function switchTab(target) {
    activeDashboardTab = target;
    const isProjects = target === 'projects';
    if (tabProjects) {
      tabProjects.classList.toggle('active', isProjects);
      tabProjects.setAttribute('aria-selected', isProjects);
    }
    if (tabDemos) {
      tabDemos.classList.toggle('active', !isProjects);
      tabDemos.setAttribute('aria-selected', !isProjects);
    }
    if (paneProjects) paneProjects.style.display = isProjects ? '' : 'none';
    if (paneDemos) paneDemos.style.display = isProjects ? 'none' : '';
  }

  if (tabProjects) tabProjects.onclick = () => switchTab('projects');
  if (tabDemos) tabDemos.onclick = () => switchTab('demos');

  // Targeted Refresh Helper for Projects Mutation
  async function refreshProjectsList() {
    const updated = await api('GET', '/api/projects').catch(() => []);
    const badge = document.getElementById('badgeProjects');
    if (badge) badge.textContent = String(updated.length);
    if (paneProjects) {
      paneProjects.innerHTML = renderProjectsHTML(updated);
      bindProjectActions(paneProjects);
    }
  }

  // Bind Project Actions: Open, Rename, Duplicate, Delete
  function bindProjectActions(scope) {
    if (!scope) return;
    scope.querySelectorAll('.proj').forEach((el) => {
      const id = el.dataset.id;

      // 1. Open
      el.querySelectorAll('[data-a=open]').forEach((btn) => {
        btn.onclick = () => (location.hash = '#/p/' + id);
      });

      // 2. Rename
      const btnRename = el.querySelector('[data-a=rename]');
      if (btnRename) {
        btnRename.onclick = async () => {
          const nameEl = el.querySelector('.name');
          const curName = nameEl ? nameEl.textContent.trim() : '';
          const newName = prompt('Nuevo nombre del proyecto:', curName);
          if (newName && newName.trim() && newName.trim() !== curName) {
            try {
              await api('PUT', '/api/projects/' + id, { name: newName.trim() });
              await refreshProjectsList();
            } catch (err) {
              alert('Error al renombrar el proyecto: ' + (err.message || err));
            }
          }
        };
      }

      // 3. Duplicate
      const btnDup = el.querySelector('[data-a=dup]');
      if (btnDup) {
        btnDup.onclick = async () => {
          try {
            await api('POST', `/api/projects/${id}/duplicate`);
            await refreshProjectsList();
          } catch (err) {
            alert('Error al duplicar el proyecto: ' + (err.message || err));
          }
        };
      }

      // 4. Delete
      const btnDel = el.querySelector('[data-a=del]');
      if (btnDel) {
        btnDel.onclick = async () => {
          if (confirm('¿Eliminar este proyecto?')) {
            try {
              await api('DELETE', '/api/projects/' + id);
              await refreshProjectsList();
            } catch (err) {
              alert('Error al eliminar el proyecto: ' + (err.message || err));
            }
          }
        };
      }
    });
  }

  // Bind Demo Gallery Actions
  function bindDemoActions(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-a=use-demo]').forEach((btn) => {
      btn.onclick = async () => {
        const demoId = btn.dataset.id;
        const demoProject = cloneDemoProject(demoId);
        if (!demoProject) {
          alert('Error: Plantilla no disponible.');
          return;
        }
        try {
          btn.disabled = true;
          btn.textContent = 'Creando mueble...';
          const res = await api('POST', '/api/projects', demoProject);
          location.hash = '#/p/' + res.id;
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Abrir plantilla';
          alert('Error al abrir la plantilla: ' + (err.message || err));
        }
      };
    });
  }

  // Attach Handlers
  bindProjectActions(paneProjects);
  bindDemoActions(paneDemos);

  // Header Actions
  const btnNew = document.getElementById('new');
  if (btnNew) {
    btnNew.onclick = async () => {
      try {
        btnNew.disabled = true;
        const r = await api('POST', '/api/projects', { name: 'Sin título', data: M.defaultProject() });
        location.hash = '#/p/' + r.id;
      } catch (err) {
        alert('Error al crear nuevo mueble: ' + (err.message || err));
        btnNew.disabled = false;
      }
    };
  }

  const importBtn = document.getElementById('importBtn');
  const importInput = document.getElementById('importInput');
  if (importBtn && importInput) {
    importBtn.onclick = () => {
      importInput.value = '';
      importInput.click();
    };

    importInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onerror = () => alert('Error al leer el archivo desde el disco.');
      reader.onload = async (evt) => {
        try {
          const text = evt.target.result;
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (jsonErr) {
            throw new Error('El archivo no contiene un JSON válido.\nDetalle: ' + jsonErr.message);
          }

          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('El archivo JSON debe contener un objeto con la definición del proyecto.');
          }

          // Format detection: envelope vs direct project
          let name = (typeof parsed.name === 'string' && parsed.name.trim())
            ? parsed.name.trim()
            : file.name.replace(/\.[^/.]+$/, '').trim() || 'Proyecto importado';

          let data = null;
          if (Array.isArray(parsed.columns)) {
            data = parsed;
          } else if (parsed.data && typeof parsed.data === 'object' && Array.isArray(parsed.data.columns)) {
            data = parsed.data;
          } else if (typeof parsed.data === 'string') {
            try {
              const nested = JSON.parse(parsed.data);
              if (nested && Array.isArray(nested.columns)) data = nested;
            } catch {}
          }

          if (!data || !Array.isArray(data.columns)) {
            throw new Error('Estructura inválida: debe contener el arreglo de columnas ("columns") o un objeto "{ name, data: { columns } }".');
          }

          // Structural and numeric validation
          validateProjectData(data);

          // Normalization & ID sanitation
          const normalized = M.normalizeProject(data);

          // Save via POST /api/projects
          const res = await api('POST', '/api/projects', { name, data: normalized });
          if (!res || !res.id) {
            throw new Error('La respuesta del servidor no incluyó un ID de proyecto válido.');
          }

          // Redirect directly to editor
          location.hash = '#/p/' + res.id;
        } catch (err) {
          alert('Error al importar archivo:\n' + err.message);
        } finally {
          importInput.value = '';
        }
      };
      reader.readAsText(file);
    };
  }

  const btnOut = document.getElementById('out');
  if (btnOut) {
    btnOut.onclick = async () => {
      try {
        await api('POST', '/api/auth/logout').catch(() => api('POST', '/api/logout'));
      } catch {}
      localStorage.removeItem('madera_token');
      currentUser = null;
      route();
    };
  }
}

/* ---------------- Panel de Administrador (Costos de Materiales y Herrajes) ---------------- */
async function adminView() {
  const isAdmin = isAuthorizedAdmin(currentUser);
  if (!isAdmin) {
    $app.innerHTML = `
      <div class="list">
        <header class="list-header">
          <div class="brand-row">
            <h2 style="margin:0">Dajusca.app · Administración</h2>
          </div>
          <div class="header-actions">
            <button id="backDash" class="btn-action">← Volver a Mis Proyectos</button>
          </div>
        </header>
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <h3>Acceso restringido a Administradores</h3>
          <p class="muted">La cuenta actual (<b>${esc(currentUser?.email || 'sin correo')}</b>) no tiene permisos de administrador. Solo las cuentas autorizadas (<b>vicentemontano59@gmail.com</b> y <b>dajuscamuebles@gmail.com</b>) pueden modificar el catálogo global de costos de materiales y herrajes.</p>
          <div style="margin-top:16px">
            <button id="backDashBtn" class="primary">Volver al Panel Principal</button>
          </div>
        </div>
      </div>
    `;
    const goBack = () => (location.hash = '#/');
    document.getElementById('backDash')?.addEventListener('click', goBack);
    document.getElementById('backDashBtn')?.addEventListener('click', goBack);
    return;
  }

  let catalogRes = { prices: { ...DEFAULTS }, updatedByEmail: '', updatedAt: null };
  try {
    const fetched = await api('GET', '/api/admin/pricing');
    if (fetched && fetched.prices) catalogRes = fetched;
  } catch {}

  const p = { ...DEFAULTS, ...(catalogRes.prices || {}) };
  const lastUpdatedText = catalogRes.updatedAt
    ? `Última actualización: ${new Date(catalogRes.updatedAt).toLocaleString()}${catalogRes.updatedByEmail ? ` por ${esc(catalogRes.updatedByEmail)}` : ''}`
    : 'Mostrando costos base por defecto';

  const MATERIAL_FIELDS = [
    ['currency', 'Moneda del sistema', '', 'Símbolo monetario (ej. $, USD, Bs, €)', 'text'],
    ['priceCarcass', 'Tablero Carcasa / Estructura', '/ m²', 'Laterales, divisiones internas, piso y techo', 'number'],
    ['priceFront', 'Tablero Frentes y Puertas', '/ m²', 'Puertas batientes, corredizas, plegables y frentes de gaveta', 'number'],
    ['priceBack', 'Tablero de Fondo (Trasera)', '/ m²', 'Panel trasero del mueble', 'number'],
    ['priceDrawer', 'Tablero Caja de Gaveta', '/ m²', 'Costados, frente interno, trasera y piso de gavetas', 'number'],
    ['thickness', 'Espesor estándar de paneles', 'mm', 'Espesor por defecto para estructura y puertas', 'number'],
    ['backThickness', 'Espesor estándar del fondo', 'mm', 'Espesor por defecto del panel trasero', 'number'],
    ['drawerThickness', 'Espesor caja de gaveta', 'mm', 'Espesor de laterales internos de gaveta', 'number'],
    ['drawerBottomThickness', 'Espesor fondo de gaveta', 'mm', 'Espesor del piso de gaveta', 'number'],
  ];

  const HARDWARE_FIELDS = [
    ['hingePrice', 'Bisagra estándar (cazoleta)', '/ unidad', 'Para puertas batientes y abatibles', 'number'],
    ['slidePrice', 'Corredera telescópica (par)', '/ par', 'Un par por cada gaveta', 'number'],
    ['pricePullBar', 'Manilla de barra', '/ unidad', 'Tirador metálico de 2 perforaciones', 'number'],
    ['pricePullKnob', 'Pomo tirador', '/ unidad', 'Tirador puntual de 1 perforación', 'number'],
    ['pricePullProfile', 'Perfil tirador / Gola aluminio', '/ unidad', 'Perfil continuo sin perforación', 'number'],
    ['priceRail', 'Tubo / Barra de perchero', '/ metro lineal', 'Barra cromada o aluminio para colgar ropa', 'number'],
    ['priceRailBracket', 'Soporte lateral de perchero', '/ unidad', '2 soportes por cada barra de perchero', 'number'],
    ['slidingTrackPrice', 'Kit de rieles puertas corredizas', '/ juego', 'Riel superior/inferior y carros rodantes', 'number'],
    ['bifoldHingePrice', 'Bisagra para puerta plegable', '/ unidad', 'Bisagras articuladas para puerta acordeón', 'number'],
    ['bifoldGuidePrice', 'Guía corrediza puerta plegable', '/ unidad', 'Carro y guía superior para puerta plegable', 'number'],
    ['gasStrutPrice', 'Pistón amortiguador a gas', '/ unidad', 'Para puertas abatibles superiores (2 por puerta)', 'number'],
  ];

  const renderFieldCard = ([key, label, unit, desc, type]) => `
    <div class="admin-field-card">
      <div class="admin-field-info">
        <label class="admin-field-label" for="adm_${key}">${esc(label)}</label>
        <span class="admin-field-desc muted">${esc(desc)}</span>
      </div>
      <div class="admin-field-input-wrap">
        <input
          id="adm_${key}"
          data-admin-key="${key}"
          type="${type}"
          ${type === 'number' ? 'step="0.01" min="0"' : ''}
          value="${esc(p[key] ?? DEFAULTS[key])}"
          class="admin-input"
        >
        ${unit ? `<span class="admin-unit">${esc(unit)}</span>` : ''}
      </div>
    </div>
  `;

  $app.innerHTML = `
    <div class="list admin-page">
      <header class="list-header">
        <div class="brand-row">
          <h2 style="margin:0">Dajusca · Panel de Administrador</h2>
          <span class="muted" style="font-size:12px">${lastUpdatedText}</span>
        </div>
        <div class="header-actions">
          <button id="backToProjects" class="btn-action">← Volver a Proyectos</button>
          <div class="user-profile-chip">
            ${renderUserAvatar(currentUser, 30)}
            <div class="user-profile-info">
              <span class="user-name">${esc(currentUser?.name || 'Admin')}</span>
              <span class="user-email muted">${esc(currentUser?.email || '')}</span>
            </div>
          </div>
        </div>
      </header>

      <div class="admin-banner">
        <div>
          <strong>Catálogo Maestro de Costos de Materiales y Herrajes</strong>
          <p class="muted" style="margin:4px 0 0 0;font-size:13px">
            Los valores guardados aquí se sincronizan en la nube (Firebase) y se aplican automáticamente a los nuevos muebles y presupuestos PDF de Dajusca.
            Administradores autorizados: <code>vicentemontano59@gmail.com</code> · <code>dajuscamuebles@gmail.com</code>
          </p>
        </div>
      </div>

      <div id="adminStatusMsg" class="admin-status-msg" style="display:none"></div>

      <div class="admin-sections-grid">
        <section class="admin-section-card">
          <div class="admin-section-header">
            <h3>1. Tableros, Melamina y Espesores</h3>
            <span class="muted">Costos por metro cuadrado (m²) y espesores base</span>
          </div>
          <div class="admin-fields-list">
            ${MATERIAL_FIELDS.map(renderFieldCard).join('')}
          </div>
        </section>

        <section class="admin-section-card">
          <div class="admin-section-header">
            <h3>2. Herrajes, Tiradores y Sistemas</h3>
            <span class="muted">Costos unitarios de accesorios para cotizaciones</span>
          </div>
          <div class="admin-fields-list">
            ${HARDWARE_FIELDS.map(renderFieldCard).join('')}
          </div>
        </section>
      </div>

      <div class="admin-footer-actions">
        <button id="btnResetDefaults" type="button" class="btn-action">Restaurar valores por defecto</button>
        <div class="admin-primary-btns">
          <button id="btnSaveAndApplyAll" type="button" class="btn-action" title="Guarda el catálogo y actualiza también los costos en tus proyectos ya creados">
            Guardar y aplicar a mis proyectos actuales
          </button>
          <button id="btnSaveCatalog" type="button" class="primary">
            Guardar Costos en el Catálogo
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('backToProjects').onclick = () => (location.hash = '#/');

  const statusBox = document.getElementById('adminStatusMsg');
  const showStatus = (msg, isError = false) => {
    if (!statusBox) return;
    statusBox.style.display = 'block';
    statusBox.className = `admin-status-msg ${isError ? 'err-box' : 'ok-box'}`;
    statusBox.textContent = msg;
  };

  const collectPricesFromInputs = () => {
    const out = {};
    document.querySelectorAll('input[data-admin-key]').forEach((inp) => {
      const k = inp.dataset.adminKey;
      if (typeof DEFAULTS[k] === 'string') {
        out[k] = inp.value.trim() || DEFAULTS[k];
      } else {
        const val = parseFloat(inp.value);
        out[k] = Number.isFinite(val) && val >= 0 ? val : DEFAULTS[k];
      }
    });
    if (out.slidePrice !== undefined) out.priceSlide = out.slidePrice;
    if (out.hingePrice !== undefined) out.priceHinge = out.hingePrice;
    return out;
  };

  document.getElementById('btnResetDefaults').onclick = () => {
    document.querySelectorAll('input[data-admin-key]').forEach((inp) => {
      const k = inp.dataset.adminKey;
      inp.value = DEFAULTS[k];
    });
    showStatus('Valores restaurados en pantalla. Pulsa "Guardar Costos en el Catálogo" para confirmar.');
  };

  document.getElementById('btnSaveCatalog').onclick = async () => {
    const btn = document.getElementById('btnSaveCatalog');
    try {
      btn.disabled = true;
      btn.textContent = 'Guardando en la nube...';
      const prices = collectPricesFromInputs();
      await api('PUT', '/api/admin/pricing', { prices });
      Object.assign(DEFAULTS, prices);
      showStatus('Costos de materiales y herrajes guardados correctamente en el catálogo.');
    } catch (err) {
      showStatus(err.message || 'Error al guardar los costos.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Costos en el Catálogo';
    }
  };

  document.getElementById('btnSaveAndApplyAll').onclick = async () => {
    const btn = document.getElementById('btnSaveAndApplyAll');
    try {
      btn.disabled = true;
      btn.textContent = 'Actualizando proyectos...';
      const prices = collectPricesFromInputs();
      await api('PUT', '/api/admin/pricing', { prices });
      Object.assign(DEFAULTS, prices);

      const projectsList = await api('GET', '/api/projects').catch(() => []);
      await Promise.all(
        projectsList.map((proj) => {
          const updatedData = {
            ...proj.data,
            settings: {
              ...(proj.data?.settings || {}),
              ...prices,
            },
          };
          return api('PUT', `/api/projects/${proj.id}`, { name: proj.name, data: updatedData });
        })
      );
      showStatus(`Catálogo guardado y costos actualizados en ${projectsList.length} proyecto(s).`);
    } catch (err) {
      showStatus(err.message || 'Error al actualizar los proyectos.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar y aplicar a mis proyectos actuales';
    }
  };
}

/* ---------------- 2D Canvas & Editor Math Helpers ---------------- */
export function calculateTopBorderDrag(startH, deltaH, thickness = 18, childCount = 1) {
  const childMin = 2 * thickness + childCount * 50 + (childCount - 1) * thickness;
  const minH = Math.max(200, 2 * thickness + 50, childMin);
  const maxH = 4000;
  return Math.round(Math.min(maxH, Math.max(minH, startH + deltaH)));
}

export function simulateTopBorderDrag(project, colIdx, deltaH) {
  const col = project.columns[colIdx];
  if (!col) return null;
  const t = project.settings?.thickness || 18;
  const startH = (typeof col.height === 'number' && col.height > 0) ? col.height : (project.settings?.height || 1400);
  const childCount = col.root?.type === 'multiple' && col.root?.dir === 'v' ? (col.root.children?.length || 1) : 1;
  const newH = calculateTopBorderDrag(startH, deltaH, t, childCount);
  col.height = newH;
  return newH;
}

export function buildCanvasSvg(project, layout, selected = null) {
  const s = layout.settings;
  const maxH = layout.maxH || Math.max(...project.columns.map((c) => (typeof c.height === 'number' && c.height > 0 ? c.height : s.height)), s.height);
  const ov = s.overhang;
  const top = maxH + ov;
  const Y = (y, sy) => top - (y + sy);
  const sel = selected;
  const selCell = sel && layout.cells[sel];
  let svg = `<svg viewBox="${-120} ${-110} ${layout.totalW + 240} ${maxH + 2 * ov + 200}" preserveAspectRatio="xMidYMid meet">
    <defs><pattern id="hatch" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="60" height="60" fill="#ffb800"/><rect width="30" height="60" fill="#111"/></pattern></defs>`;
  // celdas hoja (clic)
  Object.values(layout.cells).forEach((c) => {
    const isLeaf = c.type !== 'multiple' || !M.find(project, c.id)?.node?.children?.length;
    if (isLeaf) svg += `<rect class="cell" data-id="${c.id}" x="${c.x}" y="${Y(c.y, c.h)}" width="${c.w}" height="${c.h}" fill="#151312" style="fill:#151312"/>`;
  });
  // piezas frontales
  layout.pieces.forEach((p) => {
    if (p.kind === 'drawer' || p.kind === 'back') return;
    const isF = p.kind === 'front' || p.kind === 'door-front';
    const fill = isF ? '#ffb800' : p.kind === 'rail' ? '#d4d7dc' : '#6e6763';
    svg += `<rect x="${p.x}" y="${Y(p.y, p.sy)}" width="${p.sx}" height="${p.sy}" fill="${fill}" pointer-events="none"/>`;
    if (isF) {
      const r = s.pullDia / 2;
      const top0 = Y(p.y, p.sy);
      const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#222" pointer-events="none"/>`;
      const edgeX = p.side === 'right' ? p.x + p.sx - s.pullInset : p.x + s.pullInset;
      if (p.pull === 'profile') {
        svg += `<rect x="${p.x}" y="${top0}" width="${p.sx}" height="14" fill="#222" pointer-events="none"/>`;
      } else if (p.holeLayout === 'v') {
        const midY = top0 + p.sy / 2;
        if (p.holes === 2) svg += dot(edgeX, midY - s.pullGap / 2) + dot(edgeX, midY + s.pullGap / 2);
        else if (p.holes === 1) svg += dot(edgeX, midY);
      } else {
        const cx = p.x + p.sx / 2;
        const cy = top0 + s.pullInset;
        if (p.holes === 2) svg += dot(cx - s.pullGap / 2, cy) + dot(cx + s.pullGap / 2, cy);
        else if (p.holes === 1) svg += dot(cx, cy);
      }
    }
  });
  // transparentes para clic sobre frentes
  Object.values(layout.cells).forEach((c) => {
    const isLeaf = c.type !== 'multiple' || !M.find(project, c.id)?.node?.children?.length;
    if (isLeaf) svg += `<rect class="cell" data-id="${c.id}" x="${c.x}" y="${Y(c.y, c.h)}" width="${c.w}" height="${c.h}" style="fill:transparent"/>`;
  });
  if (selCell) svg += `<rect x="${selCell.x}" y="${Y(selCell.y, selCell.h)}" width="${selCell.w}" height="${selCell.h}" fill="url(#hatch)" opacity="0.85" pointer-events="none"/>`;
  // Divisores arrastrables para cambiar tamaño interactivamente
  (layout.dividers || []).forEach((d, idx) => {
    const isV = d.axis === 'v'; // divisor horizontal que se arrastra en vertical Y
    const cursor = d.cursor || (isV ? 'ns-resize' : 'ew-resize');
    const pad = 8;
    const rx = isV ? d.x : d.x - pad;
    const ry = isV ? Y(d.y, d.h) - pad : Y(d.y, d.h);
    const rw = isV ? d.w : d.w + 2 * pad;
    const rh = isV ? d.h + 2 * pad : d.h;
    const extraClass = d.type === 'col-top' ? ' col-top-handle' : '';
    svg += `<rect class="drag-handle${extraClass}" data-didx="${idx}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="transparent" style="cursor:${cursor};pointer-events:all;"/>`;
  });
  // botones +
  const plus = (cx, cy, act, data) =>
    `<g class="plus" data-act="${act}" ${data}><circle cx="${cx}" cy="${cy}" r="30" fill="#ffb800"/><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="44" font-weight="700" fill="#111">+</text></g>`;
  let colX = 0;
  const cols = project.columns;
  const colHeights = layout.colHeights || cols.map((c) => (typeof c.height === 'number' && c.height > 0 ? c.height : s.height));
  cols.forEach((c, idx) => {
    colX += s.thickness;
    const colH = colHeights[idx] || (typeof c.height === 'number' && c.height > 0 ? c.height : s.height);
    const cy = top - colH - 50;
    svg += plus(colX + c.width / 2, cy, 'top', `data-col="${c.id}"`);
    colX += c.width;
  });
  const col0H = colHeights[0] || (typeof cols[0]?.height === 'number' && cols[0].height > 0 ? cols[0].height : s.height);
  const lastColH = colHeights[cols.length - 1] || (typeof cols[cols.length - 1]?.height === 'number' && cols[cols.length - 1].height > 0 ? cols[cols.length - 1].height : s.height);
  svg += plus(-70, top - col0H / 2, 'colLeft', '');
  svg += plus(layout.totalW + 70, top - lastColH / 2, 'colRight', '');
  svg += '</svg>';
  return svg;
}

/* ---------------- Editor ---------------- */
async function editorView(id) {
  let rec;
  let clientsList = [];
  try {
    [rec, clientsList] = await Promise.all([
      api('GET', '/api/projects/' + id),
      api('GET', '/api/clients').catch(() => []),
    ]);
  } catch {
    location.hash = '#/';
    return;
  }
  const state = {
    name: rec.name,
    client_id: rec.client_id || null,
    client: rec.client || null,
    quotes: Array.isArray(rec.quotes) ? rec.quotes : [],
    clients: Array.isArray(clientsList) ? clientsList : [],
    project: M.normalizeProject(rec.data.columns ? rec.data : M.defaultProject()),
    selected: null,
    tab: 'design',
    mobilePane: 'split', // 'split' | '2d' | '3d'
    newType: 'drawer',
    cutSel: null,
    showMach: true,
    pieceAngles: {},
  };
  state.project.settings = { ...DEFAULTS, ...state.project.settings };
  const undo = [];
  const redo = [];
  let layout = null;
  let saveTimer = null;

  $app.innerHTML = `<div class="editor" data-mobile-pane="split">
    <div class="left" id="leftPane">
      <div class="topbar">
        <div class="pill topbar-nav-pill"><button id="back" title="Volver">←</button><input id="name" style="background:transparent;border:none;width:150px" value="${esc(state.name)}"><button id="cfg" title="Ajustes del proyecto">⚙</button></div>
        <div class="pill"><button data-tab="design" class="on">Diseño</button><button data-tab="cutlist">Cutlist</button></div>
        <div class="pill mobile-view-switch" id="mobileViewSwitch" title="Cambiar vista en pantallas móviles">
          <button type="button" data-mpane="split" class="on">2D+3D</button>
          <button type="button" data-mpane="2d">2D</button>
          <button type="button" data-mpane="3d">3D</button>
        </div>
        <span class="price" id="price"></span>
        <div class="editor-user-badge" title="${esc(currentUser?.name || '')} (${esc(currentUser?.email || '')})">
          ${renderUserAvatar(currentUser, 28)}
        </div>
      </div>
      <div id="designPane" style="display:contents">
        <div class="canvas" id="canvas"></div>
        <div class="dock-splitter" id="dockSplitter" title="Arrastra para ajustar el alto del lienzo 2D y el panel inferior (doble clic para restablecer)"><span class="splitter-grip"></span></div>
        <div class="dock" id="dock"></div>
      </div>
      <div class="cutlist" id="cutlist" style="display:none"></div>
    </div>
    <div class="pane-splitter" id="paneSplitter" title="Arrastra para ajustar el ancho de los paneles 2D / 3D / Cutlist (doble clic para restablecer)"><span class="splitter-grip"></span></div>
    <div class="right" id="rightPane">
      <div class="rtools">
        <label class="muted">Explosión</label><input type="range" id="explode" min="0" max="1" step="0.05" value="0.6">
        <label><input type="checkbox" id="hideF"> Ocultar frentes</label>
      </div>
      <div class="vwr" id="vwr"></div>
      <div class="cards" id="cards" style="display:none"></div>
    </div>
  </div>`;
  const vwrEl = document.getElementById('vwr');
  viewer = new Viewer(vwrEl);
  viewer.resize();
  let vwrResizeObserver = null;
  if (typeof ResizeObserver !== 'undefined' && vwrEl) {
    vwrResizeObserver = new ResizeObserver(() => {
      if (viewer && state.tab !== 'cutlist') viewer.resize();
    });
    vwrResizeObserver.observe(vwrEl);
  }
  const $ = (s) => document.querySelector(s);

  // Resizable Splitters: Left/Right (2D <-> 3D / Cutlist <-> Cards) and Canvas/Dock
  const paneSplitter = document.getElementById('paneSplitter');
  const leftPaneEl = document.getElementById('leftPane');
  const editorEl = document.querySelector('.editor');
  if (paneSplitter && leftPaneEl && editorEl) {
    const startPaneResize = (startClientX) => {
      const rect = editorEl.getBoundingClientRect();
      if (!rect.width) return;
      paneSplitter.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      const applyX = (clientX) => {
        const pct = Math.max(24, Math.min(76, ((clientX - rect.left) / rect.width) * 100));
        leftPaneEl.style.width = `${pct.toFixed(2)}%`;
        leftPaneEl.style.flex = `0 0 ${pct.toFixed(2)}%`;
        if (viewer && state.tab !== 'cutlist') viewer.resize();
      };
      const onMove = (ev) => applyX(ev.clientX);
      const onUp = () => {
        paneSplitter.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (viewer && state.tab !== 'cutlist') viewer.resize();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    paneSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startPaneResize(e.clientX);
    });
    paneSplitter.addEventListener(
      'touchstart',
      (e) => {
        if (!e.touches || !e.touches[0]) return;
        e.preventDefault();
        const rect = editorEl.getBoundingClientRect();
        if (!rect.width) return;
        paneSplitter.classList.add('dragging');
        const onTouchMove = (ev) => {
          if (!ev.touches || !ev.touches[0]) return;
          const isStacked = window.innerWidth <= 960;
          if (isStacked) {
            const pctH = Math.max(25, Math.min(75, ((ev.touches[0].clientY - rect.top) / rect.height) * 100));
            leftPaneEl.style.height = `${pctH.toFixed(2)}%`;
            leftPaneEl.style.flex = `0 0 ${pctH.toFixed(2)}%`;
          } else {
            const pctW = Math.max(24, Math.min(76, ((ev.touches[0].clientX - rect.left) / rect.width) * 100));
            leftPaneEl.style.width = `${pctW.toFixed(2)}%`;
            leftPaneEl.style.flex = `0 0 ${pctW.toFixed(2)}%`;
          }
          if (viewer && state.tab !== 'cutlist') viewer.resize();
        };
        const onTouchEnd = () => {
          paneSplitter.classList.remove('dragging');
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
          if (viewer && state.tab !== 'cutlist') viewer.resize();
        };
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
      },
      { passive: false }
    );
    paneSplitter.addEventListener('dblclick', () => {
      leftPaneEl.style.width = '';
      leftPaneEl.style.height = '';
      leftPaneEl.style.flex = '';
      if (viewer && state.tab !== 'cutlist') viewer.resize();
    });
  }

  const dockSplitter = document.getElementById('dockSplitter');
  const dockEl = document.getElementById('dock');
  if (dockSplitter && dockEl && leftPaneEl) {
    const startDockResize = (startY) => {
      const startH = dockEl.getBoundingClientRect().height;
      const paneH = leftPaneEl.getBoundingClientRect().height || 700;
      dockSplitter.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      const applyY = (clientY) => {
        const delta = startY - clientY;
        const nextH = Math.max(120, Math.min(Math.round(paneH * 0.68), Math.round(startH + delta)));
        dockEl.style.height = `${nextH}px`;
        dockEl.style.maxHeight = `${nextH}px`;
        dockEl.style.flex = `0 0 ${nextH}px`;
        dockEl.style.overflowY = 'auto';
      };
      const onMove = (ev) => applyY(ev.clientY);
      const onUp = () => {
        dockSplitter.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    dockSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startDockResize(e.clientY);
    });
    dockSplitter.addEventListener(
      'touchstart',
      (e) => {
        if (!e.touches || !e.touches[0]) return;
        e.preventDefault();
        const startY = e.touches[0].clientY;
        const startH = dockEl.getBoundingClientRect().height;
        const paneH = leftPaneEl.getBoundingClientRect().height || 700;
        dockSplitter.classList.add('dragging');
        const onTouchMove = (ev) => {
          if (!ev.touches || !ev.touches[0]) return;
          const delta = startY - ev.touches[0].clientY;
          const nextH = Math.max(120, Math.min(Math.round(paneH * 0.68), Math.round(startH + delta)));
          dockEl.style.height = `${nextH}px`;
          dockEl.style.maxHeight = `${nextH}px`;
          dockEl.style.flex = `0 0 ${nextH}px`;
          dockEl.style.overflowY = 'auto';
        };
        const onTouchEnd = () => {
          dockSplitter.classList.remove('dragging');
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
        };
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
      },
      { passive: false }
    );
    dockSplitter.addEventListener('dblclick', () => {
      dockEl.style.height = '';
      dockEl.style.maxHeight = '';
      dockEl.style.flex = '';
      dockEl.style.overflowY = '';
    });
  }

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api('PUT', '/api/projects/' + id, { name: state.name, data: state.project }).catch(() => {}), 500);
  };
  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
      save();
    }
  };
  const commit = (fn, keepSel = true) => {
    undo.push(snapshot());
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    fn();
    if (!keepSel || (state.selected && !M.find(state.project, state.selected))) state.selected = state.selected && M.find(state.project, state.selected) ? state.selected : null;
    refresh();
    save();
  };
  const restore = (from, to) => {
    if (!from.length) return;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    if (state.selected && !M.find(state.project, state.selected)) state.selected = null;
    refresh();
    save();
  };

  const fmtMoney = (v) => (state.project?.settings?.currency || DEFAULTS.currency || '$') + Number(v || 0).toFixed(2);
  const m3 = (mm) => (mm / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';


  function drawCanvas() {
    const s = layout.settings;
    const svg = buildCanvasSvg(state.project, layout, state.selected);
    const el = $('#canvas');
    el.innerHTML = svg;
    el.querySelectorAll('.cell').forEach((r) => (r.onclick = () => select(r.dataset.id)));
    el.querySelectorAll('.plus').forEach((g) => {
      g.onclick = () => {
        const a = g.dataset.act;
        commit(() => {
          let newNode;
          if (a === 'top') newNode = M.addOnTop(state.project, g.dataset.col, state.newType, 350, false);
          else if (a === 'colLeft') newNode = M.addColumn(state.project, 0);
          else if (a === 'colRight') newNode = M.addColumn(state.project, state.project.columns.length);
          if (newNode) state.selected = newNode.id;
        });
      };
    });

    // Control de arrastre (drag to resize) sobre divisiones internas y bordes de columna
    el.querySelectorAll('.drag-handle').forEach((handle) => {
      handle.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = layout.dividers[parseInt(handle.dataset.didx, 10)];
        if (!d) return;
        const svgEl = el.querySelector('svg');
        const pt = svgEl.createSVGPoint ? svgEl.createSVGPoint() : new DOMPoint();
        const initialCTM = svgEl.getScreenCTM();
        const invCTM = initialCTM ? initialCTM.inverse() : null;
        const getSvgCoords = (evt) => {
          pt.x = evt.clientX;
          pt.y = evt.clientY;
          if (invCTM) return pt.matrixTransform(invCTM);
          const curSvg = el.querySelector('svg');
          const curCtm = curSvg?.getScreenCTM();
          return curCtm ? pt.matrixTransform(curCtm.inverse()) : { x: evt.clientX, y: evt.clientY };
        };
        const startPt = getSvgCoords(e);
        const isV = d.axis === 'v';
        const cursor = isV ? 'ns-resize' : 'ew-resize';
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';
        handle.classList.add('dragging');
        const initialSnapshot = snapshot();
        let hasMoved = false;

        // Arrastre del borde superior de una columna (col-top)
        if (d.type === 'col-top') {
          const colIdx = d.colIdx;
          const col = state.project.columns[colIdx];
          if (!col) return;
          const t = state.project.settings.thickness;
          const startH = (typeof col.height === 'number' && col.height > 0) ? col.height : state.project.settings.height;
          const childCount = col.root?.type === 'multiple' && col.root?.dir === 'v' ? (col.root.children?.length || 1) : 1;
          const minH = Math.max(200, 2 * t + 50, 2 * t + childCount * 50 + (childCount - 1) * t);
          const maxH = 4000;
          document.body.style.cursor = 'ns-resize';

          const onMouseMove = (moveEvt) => {
            hasMoved = true;
            const curPt = getSvgCoords(moveEvt);
            // En SVG, mover hacia arriba disminuye curPt.y, lo que aumenta la altura del mueble
            const deltaH = startPt.y - curPt.y;
            const newH = calculateTopBorderDrag(startH, deltaH, t, childCount);
            col.height = newH;
            refresh(true);
          };

          const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle.classList.remove('dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (hasMoved) {
              refresh(false);
              pushUndo(initialSnapshot);
              save();
            }
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          return;
        }

        // Arrastre de divisor de columna o borde exterior
        if (d.type === 'col' || d.type === 'col-outer') {
          const colIdx = d.colIdx;
          const startLeftW = state.project.columns[colIdx].width;
          const startRightW = d.type === 'col' ? state.project.columns[colIdx + 1]?.width : 0;
          const totalPair = startLeftW + startRightW;
          const minW = 150;

          const onMouseMove = (moveEvt) => {
            hasMoved = true;
            const curPt = getSvgCoords(moveEvt);
            const deltaX = curPt.x - startPt.x;
            if (d.type === 'col') {
              let newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, startLeftW + deltaX)));
              let newRight = totalPair - newLeft;
              state.project.columns[colIdx].width = newLeft;
              state.project.columns[colIdx + 1].width = newRight;
            } else if (d.type === 'col-outer') {
              state.project.columns[colIdx].width = Math.round(Math.max(minW, startLeftW + deltaX));
            }
            refresh(true);
          };

          const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle.classList.remove('dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (hasMoved) {
              refresh(false);
              pushUndo(initialSnapshot);
            }
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
          return;
        }

        const parent = M.find(state.project, d.parentId);
        if (!parent) return;
        const prevNode = M.find(state.project, d.prevId)?.node;
        const nextNode = M.find(state.project, d.nextId)?.node;
        if (!prevNode || !nextNode) return;

        // Normalización diferida: no mutar hermanos hasta que se produzca movimiento de arrastre
        let normalized = false;
        let startPrevSize = prevNode.size;
        let startNextSize = nextNode.size;
        let totalPair = startPrevSize + startNextSize;

        const onMouseMove = (moveEvt) => {
          if (!normalized) {
            if (parent.node.children) {
              parent.node.children.forEach((ch) => {
                const cell = layout.cells[ch.id];
                if (cell) ch.size = isV ? cell.h : cell.w;
              });
            }
            startPrevSize = prevNode.size;
            startNextSize = nextNode.size;
            totalPair = startPrevSize + startNextSize;
            normalized = true;
          }
          hasMoved = true;
          const curPt = getSvgCoords(moveEvt);
          // Arrastrar hacia abajo en SVG (curPt.y > startPt.y) expande el módulo superior (delta > 0)
          const delta = isV ? (curPt.y - startPt.y) : (curPt.x - startPt.x);
          const minSize = 50;
          const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));
          let newPrev = startPrevSize + delta;
          if (newPrev < effectiveMin) {
            newPrev = effectiveMin;
          } else if (newPrev > totalPair - effectiveMin) {
            newPrev = totalPair - effectiveMin;
          }
          const roundedPrev = Math.round(newPrev);
          const roundedNext = totalPair - roundedPrev;
          prevNode.size = roundedPrev;
          nextNode.size = roundedNext;
          refresh(true);
        };

        const onMouseUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          handle.classList.remove('dragging');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          if (hasMoved) {
            refresh(false);
            pushUndo(initialSnapshot);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };

      // Soporte táctil (Touch) para pantallas móviles y tablets
      handle.ontouchstart = (te) => {
        if (!te.touches || !te.touches[0]) return;
        const t0 = te.touches[0];
        handle.onmousedown({
          clientX: t0.clientX,
          clientY: t0.clientY,
          preventDefault: () => te.preventDefault(),
          stopPropagation: () => te.stopPropagation(),
        });
        const onTouchMove = (tm) => {
          if (!tm.touches || !tm.touches[0]) return;
          const t = tm.touches[0];
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
        };
        const onTouchEnd = () => {
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
          window.removeEventListener('touchcancel', onTouchEnd);
          window.dispatchEvent(new MouseEvent('mouseup'));
        };
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        window.addEventListener('touchcancel', onTouchEnd);
      };
    });
  }

  function select(id) {
    state.selected = state.selected === id ? null : id;
    refresh();
  }

  function drawDock() {
    const s = state.project.settings;
    const dock = $('#dock');
    if (!state.selected) {
      dock.innerHTML = `<div class="stats">
        <div class="stat"><label>Fondo (m)</label><input data-s="depth" data-m="1" value="${m3(s.depth)}"></div>
        <div class="stat"><label>Alto (m)</label><input data-s="height" data-m="1" value="${m3(s.height)}"></div>
        <div class="stat"><label>Espesor (mm)</label><input data-s="thickness" value="${s.thickness}"></div>
        <div class="stat"><label>Voladizo (mm)</label><input data-s="overhang" value="${s.overhang}"></div></div>
        <span class="muted">Haz clic en un módulo para editarlo. Usa + para añadir columnas o módulos.</span>`;
      dock.querySelectorAll('input[data-s]').forEach((i) => {
        i.onchange = () => {
          const v = parseFloat(i.value);
          if (!(v > 0)) return refresh();
          commit(() => (state.project.settings[i.dataset.s] = i.dataset.m ? v * 1000 : v));
        };
      });
      return;
    }
    const f = M.find(state.project, state.selected);
    if (!f) {
      state.selected = null;
      refresh();
      return;
    }
    const c = layout.cells[state.selected] || { w: 600, h: 400 };
    const node = f.node;
    const hasFront = node.type !== 'drawer';
    const showPull = node.type === 'drawer' || (node.front && node.front !== 'none');

    const typeOpts = (cur, list) =>
      list.map((t) => `<option value="${t.id || t}" ${(t.id || t) === cur ? 'selected' : ''}>${t.label || LABELS[t] || PULLS[t]?.label || t}</option>`).join('');

    dock.innerHTML = `
      <div class="dock-header">
        <div class="dock-title">
          <span class="dock-badge">Módulo</span>
          <span class="dock-id muted">${node.id}</span>
        </div>
        ${f.parent ? '<button id="up" class="btn-dock-nav" title="Seleccionar módulo contenedor">↑ Contenedor padre</button>' : ''}
      </div>

      <!-- TIER 1: Primary Controls & Geometry -->
      <div class="dock-tier dock-tier-primary">
        <div class="tier-label">Geometría y Tipo</div>

        <div class="dock-grid-2">
          <div class="dock-field">
            <label for="w">Ancho</label>
            <div class="input-with-unit">
              <input id="w" type="number" step="0.001" min="0.05" value="${m3(c.w)}">
              <span class="unit">m</span>
            </div>
          </div>
          <div class="dock-field">
            <label for="h">Alto</label>
            <div class="input-with-unit">
              <input id="h" type="number" step="0.001" min="0.05" value="${m3(c.h)}">
              <span class="unit">m</span>
            </div>
          </div>
        </div>

        <div class="dock-grid-2">
          <div class="dock-field">
            <label for="type">Contenido</label>
            <select id="type">
              <option value="shelf" ${node.type === 'shelf' ? 'selected' : ''}>Estante abierto</option>
              <option value="rail" ${node.type === 'rail' ? 'selected' : ''}>Barra perchero</option>
              <option value="drawer" ${node.type === 'drawer' ? 'selected' : ''}>Gaveta(s)</option>
              <option value="multiple" ${node.type === 'multiple' ? 'selected' : ''}>Contenedor (subdividido)</option>
            </select>
          </div>

          ${hasFront ? `
          <div class="dock-field">
            <label for="frontSelect">Apertura / Frente</label>
            <select id="frontSelect" name="front">
              ${FRONT_OPTIONS.map((fo) => `<option value="${fo.id}" ${(node.front || 'none') === fo.id ? 'selected' : ''}>${fo.label}</option>`).join('')}
            </select>
            <select id="front" style="display:none" aria-hidden="true">
              ${FRONT_OPTIONS.map((fo) => `<option value="${fo.id}" ${(node.front || 'none') === fo.id ? 'selected' : ''}>${fo.label}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>

        ${showPull || node.type === 'drawer' || node.type === 'multiple' ? `
        <div class="dock-grid-2 contextual-row">
          ${showPull ? `
          <div class="dock-field">
            <label for="pull">Tirador / Manilla</label>
            <select id="pull">
              ${typeOpts(node.pull || 'default', ['default', ...Object.keys(PULLS)])}
            </select>
          </div>` : ''}

          ${node.type === 'drawer' ? `
          <div class="dock-field">
            <label for="cnt">Cantidad de gavetas</label>
            <input id="cnt" type="number" min="1" max="10" value="${node.count || 1}">
          </div>` : ''}

          ${node.type === 'multiple' ? `
          <div class="dock-field">
            <label for="dir">Orientación división</label>
            <select id="dir">
              <option value="v" ${node.dir === 'v' ? 'selected' : ''}>Vertical (apilados)</option>
              <option value="h" ${node.dir === 'h' ? 'selected' : ''}>Horizontal (lado a lado)</option>
            </select>
          </div>` : ''}
        </div>` : ''}

        <!-- Subdivision Controls -->
        <div class="dock-subdiv-group">
          <div class="subdiv-header">
            <label for="newType">Subdividir con:</label>
            <select id="newType" class="subdiv-select">
              ${typeOpts(state.newType || 'shelf', VALID_NEW_TYPES)}
            </select>
          </div>
          <div class="subdiv-buttons">
            <button id="inV" class="btn-subdiv" title="Dividir internamente en estantes apilados">⬍ Dividir altura</button>
            <button id="inH" class="btn-subdiv" title="Dividir internamente con partición vertical">⬌ Dividir ancho</button>
            <button id="sibAdd" class="btn-subdiv" title="Añadir módulo hermano">＋ Añadir adyacente</button>
          </div>
        </div>
      </div>

      <!-- TIER 2: Actions & Deletion -->
      <div class="dock-tier dock-tier-actions">
        <div class="tier-label">Acciones</div>
        <div class="tier-2-actions">
          <button id="dupMod" class="btn-tier2" title="Duplicar este módulo con su configuración">⎘ Duplicar</button>
          <button id="clearSel" class="btn-tier2" title="Deseleccionar módulo actual">✕ Deseleccionar</button>
          <button id="del" class="btn-tier2 btn-danger" title="Eliminar este módulo de la estructura">🗑 Eliminar</button>
          <button id="none" style="display:none" aria-hidden="true">Deseleccionar</button>
        </div>
      </div>
    `;

    const sid = state.selected;
    const bind = (q, ev, fn) => dock.querySelector(q) && (dock.querySelector(q)[ev] = fn);

    // Tier 1 Bindings
    bind('#type', 'onchange', (e) => commit(() => M.setType(state.project, sid, e.target.value)));

    const handleFront = (e) => {
      commit(() => M.setFront(state.project, sid, e.target.value));
      const f1 = dock.querySelector('#frontSelect');
      const f2 = dock.querySelector('#front');
      if (f1 && f1 !== e.target) f1.value = e.target.value;
      if (f2 && f2 !== e.target) f2.value = e.target.value;
    };
    bind('#frontSelect', 'onchange', handleFront);
    bind('#front', 'onchange', handleFront);

    bind('#pull', 'onchange', (e) => commit(() => M.setPull(state.project, sid, e.target.value)));
    bind('#dir', 'onchange', (e) => commit(() => (M.find(state.project, sid).node.dir = e.target.value)));
    bind('#cnt', 'onchange', (e) => commit(() => (M.find(state.project, sid).node.count = Math.max(1, parseInt(e.target.value) || 1))));
    bind('#newType', 'onchange', (e) => (state.newType = e.target.value));

    const size = (axis) => (e) => {
      const v = parseFloat(e.target.value);
      if (!(v > 0)) return refresh();
      commit(() => M.setSize(state.project, layout.cells, sid, axis, v * 1000, state.project.settings));
    };
    bind('#w', 'onchange', size('w'));
    bind('#h', 'onchange', size('h'));

    // Subdivision Bindings
    bind('#inV', 'onclick', () => {
      let nn;
      commit(() => (nn = M.addInside(state.project, sid, 'v', state.newType)));
      if (nn) state.selected = nn.id;
      refresh();
    });
    bind('#inH', 'onclick', () => {
      let nn;
      commit(() => (nn = M.addInside(state.project, sid, 'h', state.newType)));
      if (nn) state.selected = nn.id;
      refresh();
    });
    bind('#sibAdd', 'onclick', () => {
      let nn;
      const targetDir = f.parent ? f.parent.node.dir : 'v';
      commit(() => (nn = M.addSibling(state.project, sid, targetDir, state.newType)));
      if (nn) state.selected = nn.id;
      refresh();
    });

    // Navigation Binding
    bind('#up', 'onclick', () => {
      if (f.parent) {
        state.selected = f.parent.id;
        refresh();
      }
    });

    // Tier 2 Actions Bindings
    bind('#dupMod', 'onclick', () => {
      let nn;
      commit(() => {
        nn = M.duplicateModule(state.project, sid);
      });
      if (nn) state.selected = nn.id;
      refresh();
    });

    const handleClear = () => {
      state.selected = null;
      refresh();
    };
    bind('#clearSel', 'onclick', handleClear);
    bind('#none', 'onclick', handleClear);

    bind('#del', 'onclick', () => {
      commit(() => M.deleteModule(state.project, sid));
      state.selected = M.find(state.project, sid) ? sid : null;
      refresh();
    });
  }

  function getPieceAngle(pieceId) {
    if (!state.pieceAngles[pieceId]) {
      state.pieceAngles[pieceId] = { yaw: -0.52, pitch: 0.36 };
    }
    return state.pieceAngles[pieceId];
  }

  function pieceSvg(r, big, customAngle) {
    // Proyección 3D interactiva (rotación yaw/pitch con arrastrar cursor) + visualización de mecanizados
    const W = big ? 380 : 156;
    const Hh = big ? 230 : 96;
    const ang = customAngle || getPieceAngle(r.id);
    const yaw = ang.yaw ?? -0.52;
    const pitch = ang.pitch ?? 0.36;

    const maxSpan = Math.max(r.w || 100, r.h || 100, 1);
    const fitScale = (Math.min(W, Hh) * (big ? 0.64 : 0.66)) / maxSpan;
    const w = Math.max(18, (r.w || 100) * fitScale);
    const h = Math.max(18, (r.h || 100) * fitScale);
    const d = Math.max(big ? 10 : 6, Math.min((r.thickness || 18) * fitScale * 3.4, big ? 28 : 18));

    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cx = W / 2;
    const cy = Hh / 2;

    const proj = (x, y, z) => {
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y2 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;
      return [cx + x1, cy - y2, z2];
    };

    const pts = (arr) => arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

    // 8 vértices del tablero 3D
    const v = [
      proj(-hx, -hy, hz),  // 0: front-bottom-left
      proj(hx, -hy, hz),   // 1: front-bottom-right
      proj(hx, hy, hz),    // 2: front-top-right
      proj(-hx, hy, hz),   // 3: front-top-left
      proj(-hx, -hy, -hz), // 4: back-bottom-left
      proj(hx, -hy, -hz),  // 5: back-bottom-right
      proj(hx, hy, -hz),   // 6: back-top-right
      proj(-hx, hy, -hz),  // 7: back-top-left
    ];

    const faces = [
      { idx: [0, 1, 2, 3], fill: 'rgba(255, 184, 0, 0.14)', name: 'front' },
      { idx: [4, 5, 6, 7], fill: 'rgba(255, 184, 0, 0.07)', name: 'back' },
      { idx: [3, 2, 6, 7], fill: 'rgba(255, 205, 60, 0.20)', name: 'top' },
      { idx: [0, 1, 5, 4], fill: 'rgba(180, 125, 0, 0.14)', name: 'bottom' },
      { idx: [1, 5, 6, 2], fill: 'rgba(230, 160, 0, 0.18)', name: 'right' },
      { idx: [0, 4, 7, 3], fill: 'rgba(200, 140, 0, 0.12)', name: 'left' },
    ].map((f) => {
      const zAvg = f.idx.reduce((acc, idx) => acc + v[idx][2], 0) / 4;
      return { ...f, zAvg };
    });

    faces.sort((a, b) => a.zAvg - b.zAvg);

    let machSvg = '';
    const s = layout?.settings || DEFAULTS;

    // 1. Mecanizado de Ranura (rail-cut):
    // - En laterales verticales ('side') y tapas/pisos ('h'): ranura trasera para encajar el fondo.
    // - En laterales de gaveta ('Lateral de gaveta') y frente/trasera interna ('Frente/trasera de gaveta'):
    //   ranura inferior interna para el fondo de gaveta (y guía de riel en el costado de gaveta, NUNCA en la tapa frontal).
    if (r.hasGroove) {
      const strokeW = big ? 2.2 : 1.5;
      if (r.grooveFace === 'bottom') {
        const gy1 = -hy + Math.max(3, h * 0.12);
        const gy2 = gy1 + Math.max(2.5, Math.min(6, h * 0.08));
        const gzSurface = hz;
        const gzDepth = hz - d * 0.45;
        const gFront = [
          proj(-hx, gy1, gzSurface),
          proj(hx, gy1, gzSurface),
          proj(hx, gy2, gzSurface),
          proj(-hx, gy2, gzSurface),
        ];
        const gInner = [
          proj(-hx, gy1, gzDepth),
          proj(hx, gy1, gzDepth),
          proj(hx, gy2, gzDepth),
          proj(-hx, gy2, gzDepth),
        ];
        machSvg += `<g class="mach-groove" stroke="#00e5ff" stroke-width="${strokeW}" fill="rgba(0, 229, 255, 0.28)">
          <polygon points="${pts(gInner)}" opacity="0.65"/>
          <polygon points="${pts(gFront)}"/>
          <line x1="${gFront[0][0].toFixed(1)}" y1="${gFront[0][1].toFixed(1)}" x2="${gInner[0][0].toFixed(1)}" y2="${gInner[0][1].toFixed(1)}"/>
          <line x1="${gFront[1][0].toFixed(1)}" y1="${gFront[1][1].toFixed(1)}" x2="${gInner[1][0].toFixed(1)}" y2="${gInner[1][1].toFixed(1)}"/>
        </g>`;

        if (r.role === 'Lateral de gaveta') {
          const r1 = proj(-hx, 0, -hz);
          const r2 = proj(hx, 0, -hz);
          const r3 = proj(-hx, -hy * 0.18, -hz);
          const r4 = proj(hx, -hy * 0.18, -hz);
          machSvg += `<g class="mach-slide-ref" stroke="#ff9100" stroke-width="${big ? 1.8 : 1.2}" stroke-dasharray="4 3" fill="rgba(255, 145, 0, 0.15)">
            <polygon points="${pts([r1, r2, r4, r3])}"/>
          </g>`;
        }
      } else {
        const isVert = r.h >= r.w;
        const grooveW = Math.max(2.5, Math.min(big ? 7 : 4.5, (isVert ? w : h) * 0.09));
        const inset = Math.max(3, (isVert ? w : h) * 0.1);
        const gzSurface = -hz;
        const gzDepth = -hz + d * 0.42;
        let gOuter, gBottom;
        if (isVert) {
          const gx1 = hx - inset - grooveW;
          const gx2 = hx - inset;
          gOuter = [
            proj(gx1, -hy, gzSurface),
            proj(gx2, -hy, gzSurface),
            proj(gx2, hy, gzSurface),
            proj(gx1, hy, gzSurface),
          ];
          gBottom = [
            proj(gx1, -hy, gzDepth),
            proj(gx2, -hy, gzDepth),
            proj(gx2, hy, gzDepth),
            proj(gx1, hy, gzDepth),
          ];
        } else {
          const gy1 = hy - inset - grooveW;
          const gy2 = hy - inset;
          gOuter = [
            proj(-hx, gy1, gzSurface),
            proj(hx, gy1, gzSurface),
            proj(hx, gy2, gzSurface),
            proj(-hx, gy2, gzSurface),
          ];
          gBottom = [
            proj(-hx, gy1, gzDepth),
            proj(hx, gy1, gzDepth),
            proj(hx, gy2, gzDepth),
            proj(-hx, gy2, gzDepth),
          ];
        }
        machSvg += `<g class="mach-groove" stroke="#00e5ff" stroke-width="${strokeW}" fill="rgba(0, 229, 255, 0.26)">
          <polygon points="${pts(gBottom)}" opacity="0.65"/>
          <polygon points="${pts(gOuter)}"/>
          <line x1="${gOuter[0][0].toFixed(1)}" y1="${gOuter[0][1].toFixed(1)}" x2="${gBottom[0][0].toFixed(1)}" y2="${gBottom[0][1].toFixed(1)}"/>
          <line x1="${gOuter[2][0].toFixed(1)}" y1="${gOuter[2][1].toFixed(1)}" x2="${gBottom[2][0].toFixed(1)}" y2="${gBottom[2][1].toFixed(1)}"/>
        </g>`;
      }
    }

    // 2. Mecanizado de Perforación pasante (through-hole) en Puertas y Frentes de gaveta:
    if (r.holes > 0) {
      const holeR = Math.max(big ? 4.2 : 2.6, Math.min((s.pullDia || 5) * fitScale * 1.4, big ? 7.5 : 4.5));
      const insetScaled = Math.min(
        Math.max(big ? 12 : 6, (s.pullInset || 40) * fitScale),
        Math.min(hx * 0.75, hy * 0.75)
      );
      const gapScaled = Math.min(
        Math.max(big ? 18 : 10, (s.pullGap || 128) * fitScale),
        (r.holeLayout === 'v' ? h : w) * 0.62
      );

      const holeCoords = [];
      if (r.holeLayout === 'v') {
        const hxPos = r.side === 'right' ? hx - insetScaled : -hx + insetScaled;
        if (r.holes === 2) {
          holeCoords.push([hxPos, gapScaled / 2], [hxPos, -gapScaled / 2]);
        } else {
          holeCoords.push([hxPos, 0]);
        }
      } else {
        const hyPos = hy - insetScaled;
        if (r.holes === 2) {
          holeCoords.push([-gapScaled / 2, hyPos], [gapScaled / 2, hyPos]);
        } else {
          holeCoords.push([0, hyPos]);
        }
      }

      holeCoords.forEach(([px, py]) => {
        const pFront = proj(px, py, hz);
        const pBack = proj(px, py, -hz);
        const cross = holeR * 1.45;
        machSvg += `<g class="mach-hole">
          <line x1="${pFront[0].toFixed(1)}" y1="${pFront[1].toFixed(1)}" x2="${pBack[0].toFixed(1)}" y2="${pBack[1].toFixed(1)}" stroke="#ff5252" stroke-width="${big ? 2.4 : 1.6}" stroke-dasharray="2.5 2"/>
          <circle cx="${pBack[0].toFixed(1)}" cy="${pBack[1].toFixed(1)}" r="${(holeR * 0.85).toFixed(1)}" fill="rgba(255, 82, 82, 0.2)" stroke="#ff5252" stroke-width="${big ? 1.5 : 1.1}" opacity="0.75"/>
          <circle cx="${pFront[0].toFixed(1)}" cy="${pFront[1].toFixed(1)}" r="${holeR.toFixed(1)}" fill="#171514" stroke="#ff5252" stroke-width="${big ? 2.2 : 1.5}"/>
          <line x1="${(pFront[0] - cross).toFixed(1)}" y1="${pFront[1].toFixed(1)}" x2="${(pFront[0] + cross).toFixed(1)}" y2="${pFront[1].toFixed(1)}" stroke="#ff5252" stroke-width="1" opacity="0.8"/>
          <line x1="${pFront[0].toFixed(1)}" y1="${(pFront[1] - cross).toFixed(1)}" x2="${pFront[0].toFixed(1)}" y2="${(pFront[1] + cross).toFixed(1)}" stroke="#ff5252" stroke-width="1" opacity="0.8"/>
        </g>`;
      });
    }

    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%">
      <g stroke="#ffb800" stroke-width="${big ? 2.2 : 1.8}" stroke-linejoin="round">
        ${faces.map((f) => `<polygon points="${pts(f.idx.map((i) => v[i]))}" fill="${f.fill}"/>`).join('')}
      </g>
      ${machSvg}
    </svg>`;
  }

  function drawCutlist() {
    const cl = layout.cutlist;
    const s = layout.settings;
    const cur = s.currency || '$';
    const selRow = cl.rows.find((r) => r.id === state.cutSel);
    const dateStr = new Date().toLocaleDateString();
    const latestQuote = state.quotes && state.quotes[0];
    const activeClient = state.clients.find((c) => String(c.id) === String(state.client_id)) || state.client;

    $('#cutlist').innerHTML = `
      <div class="print-header">
        <div class="print-header-top">
          <h1 class="print-title">${esc(state.name || 'Mueble modular')} — Hoja de Corte</h1>
          <div class="print-header-total">
            <span class="print-total-label">PRECIO TOTAL:</span>
            <span class="print-total-val">${fmtMoney(cl.total)}</span>
          </div>
        </div>
        <div class="print-meta">
          <span><b>Dimensiones generales:</b> ${layout.totalW} × ${layout.maxH || s.height} × ${s.depth} mm</span>
          <span class="sep">·</span>
          <span><b>Fecha:</b> ${dateStr}</span>
          ${latestQuote ? `<span class="sep">·</span><span><b>Presupuesto:</b> ${esc(latestQuote.quote_number)}</span>` : ''}
          ${activeClient ? `<span class="sep">·</span><span><b>Cliente:</b> ${esc(activeClient.name)}</span>` : ''}
        </div>
      </div>

      <div class="btns" style="margin-bottom:12px;flex-wrap:wrap;gap:8px;align-items:center">
        <button id="csv">Exportar CSV</button>
        <button id="print">Imprimir / PDF</button>
        <button id="pdfQuote" class="primary">Descargar Cotización PDF</button>
        <button id="genQuote" title="Generar nuevo número de presupuesto correlativo">+ Emitir Presupuesto${latestQuote ? ` (${esc(latestQuote.quote_number)})` : ''}</button>
        <select id="clientSelect" title="Asociar cliente al proyecto" style="max-width:200px">
          <option value="">— Sin cliente asignado —</option>
          ${state.clients.map((c) => `<option value="${esc(c.id)}" ${String(state.client_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}${c.tax_id ? ` (${esc(c.tax_id)})` : ''}</option>`).join('')}
        </select>
        <button id="newClientBtn" title="Registrar nuevo cliente">+ Cliente</button>
        <label class="muted"><input type="checkbox" id="mach" ${state.showMach ? 'checked' : ''}> Mostrar operaciones de mecanizado</label>
      </div>

      <div class="cutlist-section">
        <h3>Tabla de cortes (Desglose de paneles)</h3>
        <div class="table-scroll">
        <table class="cutlist-table" id="cutlistTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Pieza / Rol</th>
              <th>Orientación</th>
              <th class="n">Largo (mm)</th>
              <th class="n">Ancho (mm)</th>
              <th class="n">Espesor (mm)</th>
              <th class="n">Cant.</th>
              <th class="n">Precio unit.</th>
              <th class="n">Precio total</th>
            </tr>
          </thead>
          <tbody>
            ${cl.rows.map((r) => `
              <tr data-id="${r.id}" style="cursor:pointer;${r.id === state.cutSel ? 'background:#ffb800;color:#111' : ''}">
                <td><b>${r.id}</b></td>
                <td><b>${esc(r.name)}</b> <span class="muted">(${esc(r.role)})</span></td>
                <td>${esc(r.orientation)}</td>
                <td class="n">${r.length}</td>
                <td class="n">${r.width}</td>
                <td class="n">${r.thickness}</td>
                <td class="n">${r.qty}</td>
                <td class="n">${fmtMoney(r.unitPrice)}</td>
                <td class="n">${fmtMoney(r.total)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">Subtotal Paneles (${cl.area.toFixed(2)} m²)</td>
              <td colspan="2" class="n">${fmtMoney(cl.panelsTotal)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div class="hardware-section">
        <h3>Desglose de herrajes</h3>
        <div class="table-scroll">
        <table class="hardware-table" id="hardwareTable">
          <thead>
            <tr>
              <th>Herraje</th>
              <th class="n">Cantidad</th>
              <th class="n">Precio unit.</th>
              <th class="n">Precio total</th>
            </tr>
          </thead>
          <tbody>
            ${cl.hardware.map((r) => `
              <tr>
                <td><b>${esc(r.name)}</b></td>
                <td class="n">${r.qty}</td>
                <td class="n">${fmtMoney(r.unitPrice)}</td>
                <td class="n">${fmtMoney(r.total)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="muted">Sin herrajes</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Subtotal Herrajes</td>
              <td class="n">${fmtMoney(cl.hardwareTotal)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div class="machining-section" id="machiningSection" style="${state.showMach ? '' : 'display:none'}">
        <h3>Desglose de mecanizados y operaciones</h3>
        <p class="muted mach-note">rail-cut = ranura para encajar fondo o piso de gaveta · through-hole = perforación pasante para tiradores.</p>
        <div class="table-scroll">
        <table class="machining-table" id="machiningTable">
          <thead>
            <tr>
              <th>Operación / Mecanizado</th>
              <th>Pieza / Cara</th>
              <th>Especificación</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${cl.machining.map((o) => `
              <tr>
                <td><b>${o.op === 'rail-cut' ? 'Ranura (rail-cut)' : o.op === 'through-hole' ? 'Perforación pasante (through-hole)' : esc(o.op)}</b></td>
                <td><b>${esc(o.role)}</b> · Cara ${esc(o.face)}</td>
                <td>${o.op === 'rail-cut' ? `Ranura ${o.width || 21} × ${o.depth} mm (Largo: ${o.length} mm)` : `Ø ${o.diameter} mm × ${o.depth} mm prof.`}</td>
                <td>${o.qty} ${o.qty === 1 ? 'operación' : 'operaciones'} (${o.op === 'rail-cut' ? 'Encaje de fondo / gaveta' : 'Fijación de tirador'})</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="muted">Sin operaciones de mecanizado</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Total Operaciones</td>
              <td class="n">${cl.machining.reduce((a, o) => a + o.qty, 0)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div class="print-grand-total">
        <div class="grand-total-row">
          <span>Subtotal Paneles / Piezas (${cl.area.toFixed(2)} m²):</span>
          <b>${fmtMoney(cl.panelsTotal)}</b>
        </div>
        <div class="grand-total-row">
          <span>Subtotal Herrajes y Accesorios:</span>
          <b>${fmtMoney(cl.hardwareTotal)}</b>
        </div>
        <div class="grand-total-banner">
          <span>PRECIO TOTAL DEL PROYECTO:</span>
          <span>${fmtMoney(cl.total)}</span>
        </div>
      </div>
      <p class="muted print-note" style="margin-top:10px;font-size:11px">Los precios unitarios de materiales y herrajes se configuran en los ajustes del proyecto (⚙).</p>
    `;

    const pieceMachBadges = (r) => {
      const badges = [];
      if (r.hasGroove) {
        badges.push(
          `<span class="pcard-mach-tag groove" title="Ranura mecanizada (rail-cut) en cara ${r.grooveFace === 'bottom' ? 'inferior interna para fondo de gaveta' : 'trasera para encaje de fondo'}">Ranura ${r.grooveFace === 'bottom' ? 'piso gaveta' : 'fondo'}</span>`
        );
      }
      if (r.role === 'Lateral de gaveta') {
        badges.push(`<span class="pcard-mach-tag slide" title="En los costados de la gaveta se instala el riel telescópico">Riel lateral</span>`);
      }
      if (r.holes > 0) {
        badges.push(
          `<span class="pcard-mach-tag hole" title="Perforación pasante para tirador (${r.holes} × Ø${s.pullDia || 5}mm)">${r.holes}× Perf. Ø${s.pullDia || 5}mm</span>`
        );
      }
      return badges.length ? `<div class="pcard-mach-row">${badges.join('')}</div>` : '';
    };

    // tarjetas a la derecha
    $('#cards').innerHTML = `
      <div class="cards-hint-bar">
        <span>Arrastra cualquier pieza con el cursor para girarla en 3D y ver sus ranuras y perforaciones</span>
      </div>
      ${
        selRow
          ? `<div class="pcard big sel" data-id="${selRow.id}">
              <div class="pcard-rot-toolbar">
                <span class="pcard-rot-hint">↻ Arrastra la pieza para rotar en 3D</span>
                <div class="pcard-rot-btns">
                  <button type="button" data-rot-preset="iso" title="Vista isométrica">Isométrica</button>
                  <button type="button" data-rot-preset="front" title="Vista cara frontal">Frente</button>
                  <button type="button" data-rot-preset="back" title="Vista cara trasera / ranura">Trasera / Ranura</button>
                  <button type="button" data-rot-preset="side" title="Vista canto / perfil">Canto</button>
                </div>
              </div>
              <div class="piece-svg-wrap">${pieceSvg(selRow, true)}</div>
              ${pieceMachBadges(selRow)}
              <div class="pmeta">
                <span class="pid">${selRow.id}</span>
                <span><b>${esc(selRow.name)}</b> <span class="muted">(${esc(selRow.role)})</span><br><span class="muted">${selRow.length} × ${selRow.width} × ${selRow.thickness} mm · ${fmtMoney(selRow.unitPrice)} c/u</span></span>
                <span class="qty">×${selRow.qty}</span>
              </div>
            </div>
            <div class="pgrid">${cl.rows.filter((r) => r.id !== selRow.id).map((r) => cardHtml(r, pieceMachBadges(r))).join('')}</div>`
          : `<div class="pgrid">${cl.rows.map((r) => cardHtml(r, pieceMachBadges(r))).join('')}</div>`
      }
    `;

    const pick = (id) => {
      state.cutSel = state.cutSel === id ? null : id;
      drawCutlist();
    };

    $('#cutlist').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => pick(tr.dataset.id)));

    // Botones de vista rápida en la tarjeta grande seleccionada
    $('#cards').querySelectorAll('button[data-rot-preset]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (!selRow) return;
        const preset = btn.dataset.rotPreset;
        if (preset === 'front') state.pieceAngles[selRow.id] = { yaw: 0, pitch: 0 };
        else if (preset === 'back') state.pieceAngles[selRow.id] = { yaw: Math.PI - 0.35, pitch: -0.28 };
        else if (preset === 'side') state.pieceAngles[selRow.id] = { yaw: Math.PI / 2 - 0.18, pitch: 0.22 };
        else state.pieceAngles[selRow.id] = { yaw: -0.52, pitch: 0.36 };
        const wrap = $('#cards').querySelector('.pcard.big .piece-svg-wrap');
        if (wrap) wrap.innerHTML = pieceSvg(selRow, true);
      };
    });

    // Interacción: arrastrar con mouse o dedo sobre cualquier tarjeta .pcard gira la pieza 3D en tiempo real;
    // un clic corto (sin arrastrar) selecciona o deselecciona la pieza.
    $('#cards').querySelectorAll('.pcard[data-id]').forEach((card) => {
      const pid = card.dataset.id;
      const rowObj = cl.rows.find((r) => r.id === pid);
      if (!rowObj) return;
      const isBig = card.classList.contains('big');
      const svgWrap = card.querySelector('.piece-svg-wrap');

      const attachDragRotate = (startX, startY, isTouch) => {
        const ang = getPieceAngle(pid);
        const startYaw = ang.yaw;
        const startPitch = ang.pitch;
        let moved = false;
        card.classList.add('rotating');

        const updateAngle = (cx, cy) => {
          const dx = cx - startX;
          const dy = cy - startY;
          if (!moved && Math.hypot(dx, dy) > 4) {
            moved = true;
          }
          if (moved) {
            state.pieceAngles[pid] = {
              yaw: startYaw + dx * 0.015,
              pitch: Math.max(-1.45, Math.min(1.45, startPitch - dy * 0.015)),
            };
            if (svgWrap) {
              svgWrap.innerHTML = pieceSvg(rowObj, isBig, state.pieceAngles[pid]);
            }
          }
        };

        if (!isTouch) {
          const onMove = (ev) => updateAngle(ev.clientX, ev.clientY);
          const onUp = () => {
            card.classList.remove('rotating');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!moved) pick(pid);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        } else {
          const onTouchMove = (ev) => {
            if (!ev.touches || !ev.touches[0]) return;
            updateAngle(ev.touches[0].clientX, ev.touches[0].clientY);
            if (moved && ev.cancelable) ev.preventDefault();
          };
          const onTouchEnd = () => {
            card.classList.remove('rotating');
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            if (!moved) pick(pid);
          };
          window.addEventListener('touchmove', onTouchMove, { passive: false });
          window.addEventListener('touchend', onTouchEnd);
        }
      };

      card.onmousedown = (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        attachDragRotate(e.clientX, e.clientY, false);
      };
      card.ontouchstart = (e) => {
        if (e.target.closest('button') || !e.touches || !e.touches[0]) return;
        attachDragRotate(e.touches[0].clientX, e.touches[0].clientY, true);
      };
    });
    const machBox = $('#mach');
    if (machBox) {
      machBox.onchange = (e) => {
        state.showMach = e.target.checked;
        const sec = $('#machiningSection');
        if (sec) sec.style.display = state.showMach ? '' : 'none';
      };
    }
    const csvBtn = $('#csv');
    if (csvBtn) {
      csvBtn.onclick = () => {
        const blob = new Blob(['\uFEFF' + cutlistCSV(cl, cur)], { type: 'text/csv;charset=utf-8;' });
        const safeName = (state.name || 'mueble').trim().replace(/[/\\?%*:|"<>]/g, '_');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeName + '-cutlist.csv';
        a.click();
      };
    }
    const buildFormalQuotePdfBlob = async () => {
      await api('PUT', '/api/projects/' + id, { name: state.name, data: state.project, client_id: state.client_id });
      const activeCli =
        state.clients.find((c) => String(c.id) === String(state.client_id)) || state.client || null;

      if (!staticBackendFallback && !fbAuth?.currentUser) {
        const headers = {};
        const token = localStorage.getItem('madera_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/projects/${id}/pdf`, { headers, credentials: 'same-origin' });
        if (res.ok) {
          const quoteNum = res.headers.get('X-Quote-Number') || 'PRE-0001';
          const blob = await res.blob();
          state.quotes = await api('GET', `/api/projects/${id}/quotes`).catch(() => state.quotes);
          return { blob, quoteNum };
        }
      }

      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      let quote = (state.quotes && state.quotes[0]) || null;
      if (!quote) {
        quote = await api('POST', `/api/projects/${id}/quotes`, { client_id: state.client_id });
        state.quotes = [quote, ...(state.quotes || [])];
      }

      const pdfSafeText = (str) =>
        String(str ?? '')
          .replace(/×/g, 'x')
          .replace(/Ø/g, 'Diam.')
          .replace(/[—–]/g, '-')
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .replace(/•/g, '-')
          .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

      const pdfDoc = await PDFDocument.create();
      const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const quoteNum = quote?.quote_number || 'PRE-0001';
      const dateStr = new Date(quote?.created_at || Date.now()).toLocaleDateString('es-ES');
      const cNameMeta = activeCli?.name || 'Cliente General / Consumidor Final';
      const cTaxMeta = activeCli?.tax_id || 'Sin especificar';

      pdfDoc.setTitle(pdfSafeText(`DAJUSCA - COTIZACION FORMAL ${quoteNum} - ${state.name || 'Mueble modular'}`));
      pdfDoc.setAuthor(pdfSafeText(`Dajusca - Cliente: ${cNameMeta} (${cTaxMeta})`));

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
          page.drawRectangle({ x: MARGIN, y: y - 24, width: CONTENT_W, height: 24, color: colDark });
          drawText(`DAJUSCA - Cotización ${quoteNum} (${state.name || 'Mueble modular'})`, MARGIN + 10, y - 16, {
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

      drawText('DAJUSCA', MARGIN + 18, y - 24, { font: fontBold, size: 17, color: colGold });
      drawText('Servicios de carpintería y remodelación', MARGIN + 18, y - 39, {
        font: fontReg,
        size: 9,
        color: colWhite,
      });
      drawText('dajuscamuebles@gmail.com | Tel: +58 4249290826', MARGIN + 18, y - 53, {
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
      const cName = activeCli?.name || 'Cliente General / Consumidor Final';
      const cTax = activeCli?.tax_id || 'Sin especificar';
      const cEmail = activeCli?.email || 'Sin correo registrado';
      const cPhone = activeCli?.phone || 'Sin teléfono';
      const cAddr = activeCli?.address || 'Retiro en taller / A convenir';

      drawText(`Cliente: ${cName}`, MARGIN + 10, y - 30, { font: fontBold, size: 8.5 });
      drawText(`RUT / DNI / NIF: ${cTax}`, MARGIN + 10, y - 43, { size: 8, color: colMuted });
      drawText(`Email: ${cEmail} | Tel: ${cPhone}`, MARGIN + 10, y - 56, { size: 8, color: colMuted });
      drawText(`Dirección: ${cAddr}`, MARGIN + 10, y - 69, { size: 8, color: colMuted });

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
      drawText(`Proyecto: ${state.name || 'Mueble modular'}`, rightX + 10, y - 30, { font: fontBold, size: 8.5 });
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
          pdfSafeText(`Dajusca | Cotización ${quoteNum} | Proyecto: ${state.name || 'Mueble modular'} | Página ${i + 1} de ${pages.length}`),
          { x: MARGIN, y: 18, font: fontReg, size: 7.5, color: colMuted }
        );
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      return { blob, quoteNum };
    };

    const printBtn = $('#print');
    if (printBtn) {
      printBtn.onclick = async () => {
        try {
          printBtn.disabled = true;
          printBtn.textContent = 'Preparando impresión...';
          const { blob } = await buildFormalQuotePdfBlob();
          const url = URL.createObjectURL(blob);
          const printFrame = document.createElement('iframe');
          printFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
          printFrame.src = url;
          printFrame.onload = () => {
            try {
              printFrame.contentWindow.focus();
              printFrame.contentWindow.print();
            } catch {
              window.print();
            }
          };
          document.body.appendChild(printFrame);
          drawCutlist();
        } catch {
          window.print();
        } finally {
          printBtn.disabled = false;
          printBtn.textContent = 'Imprimir / PDF';
        }
      };
    }
    const pdfBtn = $('#pdfQuote');
    if (pdfBtn) {
      pdfBtn.onclick = async () => {
        try {
          pdfBtn.disabled = true;
          pdfBtn.textContent = 'Generando PDF...';
          const { blob, quoteNum } = await buildFormalQuotePdfBlob();
          const safeName = (state.name || 'mueble').trim().replace(/[/\\?%*:|"<>]/g, '_');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `cotizacion-${quoteNum}-${safeName}.pdf`;
          a.click();
          drawCutlist();
        } catch (err) {
          console.error(err);
        } finally {
          pdfBtn.disabled = false;
          pdfBtn.textContent = 'Descargar Cotización PDF';
        }
      };
    }
    const genQuoteBtn = $('#genQuote');
    if (genQuoteBtn) {
      genQuoteBtn.onclick = async () => {
        try {
          genQuoteBtn.disabled = true;
          const q = await api('POST', `/api/projects/${id}/quotes`, { client_id: state.client_id });
          state.quotes = [q, ...(state.quotes || [])];
          drawCutlist();
        } catch (err) {
          console.error(err);
        } finally {
          genQuoteBtn.disabled = false;
        }
      };
    }
    const clientSel = $('#clientSelect');
    if (clientSel) {
      clientSel.onchange = async (e) => {
        const cid = e.target.value ? e.target.value : null;
        state.client_id = cid;
        state.client = state.clients.find((c) => String(c.id) === String(cid)) || null;
        await api('PUT', `/api/projects/${id}/client`, { client_id: cid }).catch(() => {});
        drawCutlist();
      };
    }
    const newClientBtn = $('#newClientBtn');
    if (newClientBtn) {
      newClientBtn.onclick = () => {
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        bg.innerHTML = `<div class="modal">
          <div class="row"><b style="flex:1;font-size:16px">Nuevo Cliente</b><button id="xc">✕</button></div>
          <div class="body" style="display:flex;flex-direction:column;gap:8px;margin:10px 0">
            <input id="cName" placeholder="Nombre o Razón Social *" required>
            <input id="cTax" placeholder="RUT / DNI / NIF">
            <input id="cEmail" type="email" placeholder="Correo electrónico">
            <input id="cPhone" placeholder="Teléfono">
            <input id="cAddr" placeholder="Dirección">
          </div>
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button id="cancelC">Cancelar</button>
            <button id="saveC" class="primary">Guardar Cliente</button>
          </div>
        </div>`;
        document.body.appendChild(bg);
        bg.querySelector('#xc').onclick = bg.querySelector('#cancelC').onclick = () => bg.remove();
        bg.querySelector('#saveC').onclick = async () => {
          const name = bg.querySelector('#cName').value.trim();
          if (!name) return;
          try {
            const c = await api('POST', '/api/clients', {
              name,
              tax_id: bg.querySelector('#cTax').value.trim(),
              email: bg.querySelector('#cEmail').value.trim(),
              phone: bg.querySelector('#cPhone').value.trim(),
              address: bg.querySelector('#cAddr').value.trim(),
            });
            state.clients.unshift(c);
            state.client_id = c.id;
            state.client = c;
            await api('PUT', `/api/projects/${id}/client`, { client_id: c.id });
            bg.remove();
            drawCutlist();
          } catch (err) {
            console.error(err);
          }
        };
      };
    }
  }
  const cardHtml = (r, badgesHtml = '') =>
    `<div class="pcard" data-id="${r.id}" title="Arrastra para rotar en 3D · Clic para ampliar"><div class="piece-svg-wrap">${pieceSvg(r, false)}</div>${badgesHtml}<div class="pmeta"><span class="pid">${r.id}</span><span class="pcard-name-mini">${esc(r.name)}</span><span class="qty">×${r.qty}</span></div></div>`;

  function refresh() {
    layout = computeLayout(state.project);
    $('#price').textContent = fmtMoney(layout.cutlist.total);
    viewer.update(layout, new Set(state.selected ? collectIds(state.selected) : []));
    if (!arguments[0] || state.tab === 'cutlist') drawCutlist();
    if (state.tab === 'design') {
      drawCanvas();
      if (!arguments[0]) drawDock();
    }
  }
  function collectIds(id) {
    const f = M.find(state.project, id);
    const ids = [];
    const walk = (n) => {
      ids.push(n.id);
      (n.children || []).forEach(walk);
    };
    if (f) walk(f.node);
    return ids;
  }

  function showSettings() {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const body = () =>
      SETTING_META.map(([k, label, unit, tip]) => {
        const v = state.project.settings[k];
        if (k === 'pullStyle') {
          return `<div class="row" title="${esc(tip)}"><label>${label}</label><select data-k="${k}" style="flex:0 0 190px">${Object.entries(PULLS).map(([id, p]) => `<option value="${id}" ${id === v ? 'selected' : ''}>${p.label}</option>`).join('')}</select><span class="unit"></span></div>`;
        }
        return `<div class="row" title="${esc(tip)}"><label>${label}</label><input data-k="${k}" ${typeof DEFAULTS[k] === 'string' ? '' : 'type="number" step="any"'} value="${esc(v)}"><span class="unit">${unit}</span></div>`;
      }).join('');
    const render = () => {
      bg.innerHTML = `<div class="modal"><div class="row"><b style="flex:1;font-size:16px">Ajustes del proyecto</b><button id="x">✕</button></div>
        <span class="muted">Los valores afectan a la vista 3D, la cutlist y los precios.</span>
        <div class="row"><button id="reset">Restablecer</button><button id="copy">Copiar JSON</button></div>
        <div class="body">${body()}</div><button id="done" class="primary">Listo</button></div>`;
      bg.querySelectorAll('input[data-k]').forEach((i) => {
        i.onchange = () => {
          const k = i.dataset.k;
          const v = typeof DEFAULTS[k] === 'string' ? i.value : parseFloat(i.value);
          if (typeof v === 'number' && Number.isNaN(v)) return;
          commit(() => (state.project.settings[k] = v));
        };
      });
      bg.querySelector('#x').onclick = bg.querySelector('#done').onclick = () => bg.remove();
      bg.querySelector('#reset').onclick = () => {
        commit(() => (state.project.settings = { ...DEFAULTS }));
        render();
      };
      bg.querySelector('#copy').onclick = () => navigator.clipboard?.writeText(JSON.stringify(state.project, null, 2));
    };
    render();
    document.body.appendChild(bg);
  }

  $('#back').onclick = () => (location.hash = '#/');
  $('#cfg').onclick = showSettings;
  $('#name').oninput = (e) => {
    state.name = e.target.value || 'Sin título';
    refresh();
    save();
  };
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      $('#designPane').style.display = state.tab === 'design' ? 'contents' : 'none';
      $('#cutlist').style.display = state.tab === 'cutlist' ? 'block' : 'none';
      $('#cards').style.display = state.tab === 'cutlist' ? 'block' : 'none';
      $('#vwr').style.display = state.tab === 'cutlist' ? 'none' : 'block';
      document.querySelector('.rtools').style.display = state.tab === 'cutlist' ? 'none' : 'flex';
      const mSwitch = $('#mobileViewSwitch');
      if (mSwitch) mSwitch.style.display = state.tab === 'cutlist' ? 'none' : '';
      const ed = document.querySelector('.editor');
      if (ed) ed.dataset.mobilePane = state.tab === 'cutlist' ? 'cutlist' : state.mobilePane;
      if (state.tab !== 'cutlist') viewer.resize();
      refresh();
    };
  });
  document.querySelectorAll('[data-mpane]').forEach((btn) => {
    btn.onclick = () => {
      state.mobilePane = btn.dataset.mpane;
      document.querySelectorAll('[data-mpane]').forEach((x) => x.classList.toggle('on', x === btn));
      const ed = document.querySelector('.editor');
      if (ed && state.tab === 'design') ed.dataset.mobilePane = state.mobilePane;
      setTimeout(() => viewer?.resize(), 50);
    };
  });
  $('#explode').oninput = (e) => viewer.setExplode(parseFloat(e.target.value));
  $('#hideF').onchange = (e) => viewer.setHideFronts(e.target.checked);
  const onKey = (e) => {
    const tag = document.activeElement?.tagName;
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || document.activeElement?.isContentEditable) return;

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) {
      if (e.key === 'Delete' && state.selected) $('#del')?.click();
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        restore(redo, undo);
      } else {
        restore(undo, redo);
      }
    } else if (key === 'y' && !e.shiftKey) {
      e.preventDefault();
      restore(redo, undo);
    }
  };
  window.addEventListener('keydown', onKey);
  cleanup = () => {
    window.removeEventListener('keydown', onKey);
    clearTimeout(saveTimer);
    vwrResizeObserver?.disconnect();
    viewer?.destroy();
    viewer = null;
  };
  refresh();
}

if (typeof window !== 'undefined' && $app) route();
