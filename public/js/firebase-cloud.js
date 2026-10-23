import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { computeLayout, DEFAULTS } from './layout.js';
import * as M from './model.js';

export const firebaseConfig = {
  projectId: 'pure-plating-51ttq',
  appId: '1:276580007062:web:820c5f21a829a2688cd6b7',
  apiKey: 'AIzaSyB6YU7CAQqhWcsxJZtZdIrT4YGFaSrwdpk',
  authDomain: 'pure-plating-51ttq.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-maderalocal-a4429d1a-03c9-46c1-8091-cb2f4352dd1a',
  storageBucket: 'pure-plating-51ttq.firebasestorage.app',
  messagingSenderId: '276580007062',
};

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

export const app = isBrowser ? initializeApp(firebaseConfig) : null;
export const db = isBrowser ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : null;
export const auth = isBrowser ? getAuth(app) : null;

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified ?? null,
      isAnonymous: auth?.currentUser?.isAnonymous ?? null,
      tenantId: auth?.currentUser?.tenantId || null,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

let authReadyPromise = null;
if (isBrowser && auth) {
  testConnection();
  authReadyPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function waitForFirebaseAuth() {
  if (!authReadyPromise) return null;
  return authReadyPromise;
}

function makeDocId(prefix = 'doc') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function clampStr(val, maxLen, fallback = '') {
  const s = String(val ?? fallback).trim();
  return s.slice(0, maxLen);
}

function tsToMs(ts) {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return Date.now();
}

export async function ensureUserProfileInFirestore(fbUser, providerType = 'google') {
  if (!db || !fbUser || !fbUser.emailVerified) return;
  const uid = fbUser.uid;
  const userPath = `users/${uid}`;
  const privPath = `users/${uid}/private/info`;
  const userRef = doc(db, 'users', uid);
  const privRef = doc(db, 'users', uid, 'private', 'info');

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  const safeName = clampStr(fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuario', 100, 'Usuario');
  const safeEmail = clampStr(fbUser.email || 'usuario@dajusca.app', 254, 'usuario@dajusca.app');
  const safeProvider = ['google', 'password', 'local'].includes(providerType) ? providerType : 'google';

  if (!snap || !snap.exists()) {
    try {
      const batch = writeBatch(db);
      batch.set(userRef, {
        uid,
        name: safeName,
        provider: safeProvider,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privRef, {
        uid,
        email: safeEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  }
}

export function formatFirebaseUser(fbUser) {
  if (!fbUser) return null;
  return {
    id: fbUser.uid,
    uid: fbUser.uid,
    name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuario',
    email: fbUser.email || '',
    avatar_url: fbUser.photoURL || null,
    provider: fbUser.providerData?.[0]?.providerId === 'google.com' ? 'google' : 'firebase',
    emailVerified: fbUser.emailVerified,
  };
}

export async function signInWithGooglePopup() {
  if (!auth) throw new Error('Firebase Auth no está disponible en este entorno.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfileInFirestore(cred.user, 'google');
  return formatFirebaseUser(cred.user);
}

export async function registerWithEmailFirebase(name, email, password) {
  if (!auth) throw new Error('Firebase Auth no está disponible.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) {
      await updateProfile(cred.user, { displayName: clampStr(name, 100, 'Usuario') });
    }
    if (!cred.user.emailVerified) {
      await sendEmailVerification(cred.user).catch(() => {});
    }
    return formatFirebaseUser(cred.user);
  } catch (err) {
    if (err?.code === 'auth/operation-not-allowed') {
      throw new Error(
        'Para registrarte con correo y contraseña en la nube, habilita el proveedor "Correo electrónico/contraseña" en tu consola de Firebase (Authentication > Sign-in method), o inicia sesión directamente con el botón de Google.'
      );
    }
    if (err?.code === 'auth/email-already-in-use') {
      throw new Error('Ese correo electrónico ya está registrado en Firebase. Inicia sesión.');
    }
    if (err?.code === 'auth/weak-password') {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }
    throw new Error(err?.message || 'Error al crear la cuenta en Firebase');
  }
}

export async function loginWithEmailFirebase(email, password) {
  if (!auth) throw new Error('Firebase Auth no está disponible.');
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.emailVerified) {
      await ensureUserProfileInFirestore(cred.user, 'password');
    }
    return formatFirebaseUser(cred.user);
  } catch (err) {
    if (err?.code === 'auth/operation-not-allowed') {
      throw new Error(
        'El inicio con correo/contraseña aún no está habilitado en tu consola de Firebase (Authentication > Sign-in method). Usa "Iniciar sesión con Google" o actívalo en Firebase Console.'
      );
    }
    if (
      err?.code === 'auth/invalid-credential' ||
      err?.code === 'auth/user-not-found' ||
      err?.code === 'auth/wrong-password'
    ) {
      throw new Error('Credenciales incorrectas. Verifica tu correo y contraseña o regístrate primero.');
    }
    throw new Error(err?.message || 'Error al iniciar sesión en Firebase');
  }
}

export async function signOutFirebase() {
  if (auth?.currentUser) {
    await signOut(auth);
  }
}

export async function handleFirestoreApi(method, url, body) {
  const fbUser = auth?.currentUser;
  if (!fbUser) {
    throw Object.assign(new Error('No autenticado en Firebase'), { status: 401 });
  }
  const uid = fbUser.uid;
  const path = url.split('?')[0];

  if (method === 'GET' && (path === '/api/auth/me' || path === '/api/me')) {
    const u = formatFirebaseUser(fbUser);
    return { user: u, email: u.email };
  }

  if (path === '/api/auth/logout' || path === '/api/logout') {
    await signOutFirebase();
    return { ok: true };
  }

  // Projects collection (/projects)
  if (method === 'GET' && path === '/api/projects') {
    const q = query(collection(db, 'projects'), where('ownerId', '==', uid));
    try {
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name,
          client_id: data.clientId || null,
          data: { settings: data.settings || { ...DEFAULTS }, columns: data.columns || [] },
          created_at: tsToMs(data.createdAt),
          updated_at: tsToMs(data.updatedAt),
        };
      });
      return list.sort((a, b) => b.updated_at - a.updated_at);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }
  }

  if (method === 'POST' && path === '/api/projects') {
    const projectId = makeDocId('proj');
    const rawData = body?.data || M.defaultProject();
    const safeName = clampStr(body?.name || 'Sin título', 150, 'Sin título') || 'Sin título';
    const safeClientId = clampStr(body?.client_id || '', 128, '');
    const safeSettings = rawData?.settings && typeof rawData.settings === 'object' ? rawData.settings : { ...DEFAULTS };
    const safeColumns = Array.isArray(rawData?.columns) && rawData.columns.length > 0 ? rawData.columns.slice(0, 20) : M.defaultProject().columns;

    const docPath = `projects/${projectId}`;
    try {
      await setDoc(doc(db, 'projects', projectId), {
        ownerId: uid,
        name: safeName,
        clientId: safeClientId,
        settings: safeSettings,
        columns: safeColumns,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {
        id: projectId,
        name: safeName,
        client_id: safeClientId || null,
        data: { settings: safeSettings, columns: safeColumns },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }
  }

  const projDupMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/duplicate$/);
  if (method === 'POST' && projDupMatch) {
    const origId = projDupMatch[1];
    const origPath = `projects/${origId}`;
    let snap;
    try {
      snap = await getDoc(doc(db, 'projects', origId));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, origPath);
    }
    if (!snap || !snap.exists()) throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
    const orig = snap.data();
    const newId = makeDocId('proj');
    const newName = clampStr(`${orig.name} (copia)`, 150, 'Copia');
    try {
      await setDoc(doc(db, 'projects', newId), {
        ownerId: uid,
        name: newName,
        clientId: orig.clientId || '',
        settings: orig.settings,
        columns: orig.columns,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {
        id: newId,
        name: newName,
        client_id: orig.clientId || null,
        data: { settings: orig.settings, columns: orig.columns },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${newId}`);
    }
  }

  const projClientMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/client$/);
  if (method === 'PUT' && projClientMatch) {
    const pid = projClientMatch[1];
    const docPath = `projects/${pid}`;
    const safeClientId = clampStr(body?.client_id || '', 128, '');
    try {
      await updateDoc(doc(db, 'projects', pid), {
        clientId: safeClientId,
        updatedAt: serverTimestamp(),
      });
      return { id: pid, client_id: safeClientId || null };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
  }

  const projQuotesMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/quotes$/);
  if (projQuotesMatch) {
    const pid = projQuotesMatch[1];
    if (method === 'GET') {
      const q = query(collection(db, 'quotes'), where('ownerId', '==', uid));
      try {
        const snap = await getDocs(q);
        return snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              project_id: x.projectId,
              client_id: x.clientId || null,
              seq: x.seq,
              quote_number: x.quoteNumber,
              total: x.total,
              currency: x.currency,
              status: x.status,
              created_at: tsToMs(x.createdAt),
            };
          })
          .filter((x) => x.project_id === pid)
          .sort((a, b) => b.seq - a.seq);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'quotes');
      }
    }
    if (method === 'POST') {
      // Get existing quotes for user to compute next correlative seq
      const qAll = query(collection(db, 'quotes'), where('ownerId', '==', uid));
      let maxSeq = 0;
      try {
        const snapAll = await getDocs(qAll);
        snapAll.docs.forEach((d) => {
          const s = Number(d.data().seq) || 0;
          if (s > maxSeq) maxSeq = s;
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'quotes');
      }

      let projSnap;
      try {
        projSnap = await getDoc(doc(db, 'projects', pid));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `projects/${pid}`);
      }
      if (!projSnap || !projSnap.exists()) {
        throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
      }
      const pData = projSnap.data();
      const layout = computeLayout({ settings: pData.settings, columns: pData.columns });
      const seq = maxSeq + 1;
      const quoteNumber = `PRE-${String(seq).padStart(4, '0')}`;
      const quoteId = makeDocId('quote');
      const clientId = clampStr(body?.client_id || pData.clientId || '', 128, '');
      const currency = clampStr(pData.settings?.currency || '$', 10, '$');
      const total = Number(layout.cutlist.total) || 0;

      try {
        await setDoc(doc(db, 'quotes', quoteId), {
          ownerId: uid,
          projectId: pid,
          clientId,
          seq,
          quoteNumber,
          total,
          currency,
          status: 'issued',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return {
          id: quoteId,
          project_id: pid,
          client_id: clientId || null,
          seq,
          quote_number: quoteNumber,
          total,
          currency,
          status: 'issued',
          created_at: Date.now(),
        };
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `quotes/${quoteId}`);
      }
    }
  }

  const projIdMatch = path.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
  if (projIdMatch) {
    const pid = projIdMatch[1];
    const docPath = `projects/${pid}`;
    if (method === 'GET') {
      let snap;
      try {
        snap = await getDoc(doc(db, 'projects', pid));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
      if (!snap || !snap.exists()) throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
      const d = snap.data();
      let client = null;
      if (d.clientId) {
        try {
          const cSnap = await getDoc(doc(db, 'clients', d.clientId));
          if (cSnap.exists()) {
            const cd = cSnap.data();
            client = {
              id: cSnap.id,
              name: cd.name,
              tax_id: cd.taxId,
              email: cd.email,
              phone: cd.phone,
              address: cd.address,
            };
          }
        } catch {}
      }
      const quotes = await handleFirestoreApi('GET', `/api/projects/${pid}/quotes`);
      return {
        id: snap.id,
        name: d.name,
        client_id: d.clientId || null,
        client,
        quotes,
        data: { settings: d.settings, columns: d.columns },
        created_at: tsToMs(d.createdAt),
        updated_at: tsToMs(d.updatedAt),
      };
    }

    if (method === 'PUT') {
      let existingSnap;
      try {
        existingSnap = await getDoc(doc(db, 'projects', pid));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, docPath);
      }
      if (!existingSnap || !existingSnap.exists()) {
        throw Object.assign(new Error('Proyecto no encontrado'), { status: 404 });
      }
      const cur = existingSnap.data();
      const nextName = body?.name !== undefined ? clampStr(body.name, 150, 'Sin título') || 'Sin título' : cur.name;
      const nextSettings = body?.data?.settings && typeof body.data.settings === 'object' ? body.data.settings : cur.settings;
      const nextColumns =
        Array.isArray(body?.data?.columns) && body.data.columns.length > 0
          ? body.data.columns.slice(0, 20)
          : cur.columns;
      const nextClientId =
        body?.client_id !== undefined ? clampStr(body.client_id || '', 128, '') : cur.clientId || '';

      try {
        await updateDoc(doc(db, 'projects', pid), {
          name: nextName,
          settings: nextSettings,
          columns: nextColumns,
          clientId: nextClientId,
          updatedAt: serverTimestamp(),
        });
        return {
          id: pid,
          name: nextName,
          client_id: nextClientId || null,
          data: { settings: nextSettings, columns: nextColumns },
          updated_at: Date.now(),
        };
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, docPath);
      }
    }

    if (method === 'DELETE') {
      try {
        await deleteDoc(doc(db, 'projects', pid));
        return { ok: true };
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, docPath);
      }
    }
  }

  // Clients collection (/clients)
  if (method === 'GET' && path === '/api/clients') {
    const q = query(collection(db, 'clients'), where('ownerId', '==', uid));
    try {
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const c = d.data();
        return {
          id: d.id,
          name: c.name,
          tax_id: c.taxId || '',
          email: c.email || '',
          phone: c.phone || '',
          address: c.address || '',
          created_at: tsToMs(c.createdAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    }
  }

  if (method === 'POST' && path === '/api/clients') {
    const clientId = makeDocId('cli');
    const safeName = clampStr(body?.name, 150, '');
    if (!safeName) throw Object.assign(new Error('El nombre del cliente es obligatorio'), { status: 400 });
    const safeTaxId = clampStr(body?.tax_id || '', 60, '');
    const safeEmail = clampStr(body?.email || '', 254, '');
    const safePhone = clampStr(body?.phone || '', 60, '');
    const safeAddress = clampStr(body?.address || '', 300, '');

    try {
      await setDoc(doc(db, 'clients', clientId), {
        ownerId: uid,
        name: safeName,
        taxId: safeTaxId,
        email: safeEmail,
        phone: safePhone,
        address: safeAddress,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {
        id: clientId,
        name: safeName,
        tax_id: safeTaxId,
        email: safeEmail,
        phone: safePhone,
        address: safeAddress,
        created_at: Date.now(),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `clients/${clientId}`);
    }
  }

  return {};
}
