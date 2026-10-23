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
} from './firebase-cloud.js';

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

let staticBackendFallback = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dajusca_static_mode') === '1';

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
  const paneProjects = document.getElementById('tabContentProjects');
  const paneDemos = document.getElementById('tabContentDemos');

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
    rec = await api('GET', '/api/projects/' + id);
    clientsList = await api('GET', '/api/clients').catch(() => []);
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
    newType: 'drawer',
    cutSel: null,
    showMach: true,
  };
  state.project.settings = { ...DEFAULTS, ...state.project.settings };
  const undo = [];
  const redo = [];
  let layout = null;
  let saveTimer = null;

  $app.innerHTML = `<div class="editor">
    <div class="left">
      <div class="topbar">
        <div class="pill"><button id="back">←</button><input id="name" style="background:transparent;border:none;width:150px" value="${esc(state.name)}"><button id="cfg">⚙</button></div>
        <div class="pill"><button data-tab="design" class="on">Diseño</button><button data-tab="cutlist">Cutlist</button></div>
        <span class="price" id="price"></span>
        <div class="editor-user-badge" title="${esc(currentUser?.name || '')} (${esc(currentUser?.email || '')})">
          ${renderUserAvatar(currentUser, 28)}
        </div>
      </div>
      <div id="designPane" style="display:contents">
        <div class="canvas" id="canvas"></div>
        <div class="dock" id="dock"></div>
      </div>
      <div class="cutlist" id="cutlist" style="display:none"></div>
    </div>
    <div class="right">
      <div class="rtools">
        <label class="muted">Explosión</label><input type="range" id="explode" min="0" max="1" step="0.05" value="0.6">
        <label><input type="checkbox" id="hideF"> Ocultar frentes</label>
      </div>
      <div class="vwr" id="vwr"></div>
      <div class="cards" id="cards" style="display:none"></div>
    </div>
  </div>`;
  viewer = new Viewer(document.getElementById('vwr'));
  viewer.resize();
  const $ = (s) => document.querySelector(s);

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
            refresh();
          };

          const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle.classList.remove('dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (hasMoved) {
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
            refresh();
          };

          const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle.classList.remove('dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (hasMoved) {
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
          refresh();
        };

        const onMouseUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          handle.classList.remove('dragging');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          if (hasMoved) {
            pushUndo(initialSnapshot);
          }
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
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

  function pieceSvg(r, big) {
    // Caja oblicua (ancho x alto con espesor) escalada para caber en el recuadro
    const W = big ? 360 : 150;
    const Hh = big ? 220 : 90;
    const k = Math.min((W * 0.7) / r.w, (Hh * 0.7) / r.h);
    const w = r.w * k;
    const h = r.h * k;
    const d = Math.max(4, Math.min(r.thickness * k * 3, 24));
    const x0 = (W - w - d) / 2;
    const y0 = (Hh + h - d) / 2;
    const f = [[x0, y0], [x0 + w, y0], [x0 + w, y0 - h], [x0, y0 - h]];
    const b = f.map(([x, y]) => [x + d, y - d]);
    const pts = (a) => a.map((p) => p.join(',')).join(' ');
    return `<svg viewBox="0 0 ${W} ${Hh}" width="100%"><g fill="none" stroke="#ffb800" stroke-width="2.5" stroke-linejoin="round">
      <polygon points="${pts(f)}"/><polygon points="${pts(b)}" opacity=".6"/>
      ${f.map((p, i) => `<line x1="${p[0]}" y1="${p[1]}" x2="${b[i][0]}" y2="${b[i][1]}" opacity=".6"/>`).join('')}</g></svg>`;
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

      <div class="hardware-section">
        <h3>Desglose de herrajes</h3>
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

      <div class="machining-section" id="machiningSection" style="${state.showMach ? '' : 'display:none'}">
        <h3>Desglose de mecanizados y operaciones</h3>
        <p class="muted mach-note">rail-cut = ranura para encajar fondo o piso de gaveta · through-hole = perforación pasante para tiradores.</p>
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

    // tarjetas a la derecha
    $('#cards').innerHTML = selRow
      ? `<div class="pcard big sel">${pieceSvg(selRow, true)}<div class="pmeta"><span class="pid">${selRow.id}</span><span><b>${esc(selRow.name)}</b><br><span class="muted">${selRow.length} × ${selRow.width} × ${selRow.thickness} mm · ${fmtMoney(selRow.unitPrice)} c/u</span></span><span class="qty">×${selRow.qty}</span></div></div>
         <div class="pgrid">${cl.rows.filter((r) => r.id !== selRow.id).map(cardHtml).join('')}</div>`
      : `<div class="pgrid">${cl.rows.map(cardHtml).join('')}</div>`;

    const pick = (id) => {
      state.cutSel = state.cutSel === id ? null : id;
      drawCutlist();
    };

    $('#cutlist').querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => pick(tr.dataset.id)));
    $('#cards').querySelectorAll('.pcard[data-id]').forEach((c) => (c.onclick = () => pick(c.dataset.id)));
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
    const printBtn = $('#print');
    if (printBtn) {
      printBtn.onclick = () => window.print();
    }
    const pdfBtn = $('#pdfQuote');
    if (pdfBtn) {
      pdfBtn.onclick = async () => {
        try {
          pdfBtn.disabled = true;
          pdfBtn.textContent = 'Generando PDF...';
          await api('PUT', '/api/projects/' + id, { name: state.name, data: state.project, client_id: state.client_id });
          if (!staticBackendFallback) {
            const headers = {};
            const token = localStorage.getItem('madera_token');
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`/api/projects/${id}/pdf`, { headers, credentials: 'same-origin' });
            if (res.ok) {
              const quoteNum = res.headers.get('X-Quote-Number') || 'PRE-0001';
              const blob = await res.blob();
              const safeName = (state.name || 'mueble').trim().replace(/[/\\?%*:|"<>]/g, '_');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `cotizacion-${quoteNum}-${safeName}.pdf`;
              a.click();
              state.quotes = await api('GET', `/api/projects/${id}/quotes`).catch(() => state.quotes);
              drawCutlist();
              return;
            }
          }
          // Client-side PDF fallback using pdf-lib when hosted on a static server
          const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
          let quote = (state.quotes && state.quotes[0]) || null;
          if (!quote) {
            quote = await api('POST', `/api/projects/${id}/quotes`, { client_id: state.client_id });
            state.quotes = [quote, ...(state.quotes || [])];
          }
          const pdfDoc = await PDFDocument.create();
          const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
          const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
          const page = pdfDoc.addPage([595.28, 841.89]);
          let y = 795;
          page.drawText('DAJUSCA.APP - COTIZACION Y HOJA DE CORTE', { x: 40, y, size: 15, font: fontBold, color: rgb(0.12, 0.1, 0.09) });
          y -= 20;
          page.drawText(`Presupuesto N°: ${quote.quote_number}   |   Proyecto: ${state.name || 'Sin título'}`, { x: 40, y, size: 10, font: fontBold });
          y -= 16;
          const cli = state.client;
          page.drawText(`Cliente: ${cli ? cli.name : 'Consumidor Final'}${cli?.tax_id ? ' (' + cli.tax_id + ')' : ''}`, { x: 40, y, size: 9.5, font: fontReg });
          y -= 20;
          page.drawText(`Resumen Comercial: Tableros ${fmtMoney(cl.panelsTotal)} + Herrajes ${fmtMoney(cl.hardwareTotal)} = TOTAL ${fmtMoney(cl.total)}`, { x: 40, y, size: 10, font: fontBold });
          y -= 22;
          page.drawText('LISTA DE CORTES (mm):', { x: 40, y, size: 10, font: fontBold });
          y -= 14;
          for (const r of cl.rows.slice(0, 35)) {
            if (y < 50) break;
            page.drawText(`${r.id} | ${r.part} (${r.role}) | ${r.length} x ${r.width} x ${r.thickness} mm | Cant: ${r.qty} | ${fmtMoney(r.cost)}`, { x: 40, y, size: 8.5, font: fontReg });
            y -= 13;
          }
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const safeName = (state.name || 'mueble').trim().replace(/[/\\?%*:|"<>]/g, '_');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `cotizacion-${quote.quote_number}-${safeName}.pdf`;
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
  const cardHtml = (r) =>
    `<div class="pcard" data-id="${r.id}">${pieceSvg(r, false)}<div class="pmeta"><span class="pid">${r.id}</span><span class="qty">×${r.qty}</span></div></div>`;

  function refresh() {
    layout = computeLayout(state.project);
    $('#price').textContent = fmtMoney(layout.cutlist.total);
    viewer.update(layout, new Set(state.selected ? collectIds(state.selected) : []));
    drawCutlist();
    if (state.tab === 'design') {
      drawCanvas();
      drawDock();
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
      if (state.tab !== 'cutlist') viewer.resize();
      refresh();
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
    viewer?.destroy();
    viewer = null;
  };
  refresh();
}

if (typeof window !== 'undefined' && $app) route();
