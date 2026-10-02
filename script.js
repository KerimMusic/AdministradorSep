import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDMabE70hIApcNU5RY3_WEEIF-BWUzO0K4",
  authDomain: "kerim-music-a9c46.firebaseapp.com",
  projectId: "kerim-music-a9c46",
  storageBucket: "kerim-music-a9c46.firebasestorage.app",
  messagingSenderId: "470731440209",
  appId: "1:470731440209:web:f6eba4784027a5d8c57870",
  measurementId: "G-LBHTKL8KDK"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ═══════════════════════════════════════════════════════════
   🔒 SEGURIDAD — Lista blanca de administradores
   ═══════════════════════════════════════════════════════════ */
const ADMINS_UID = [
  // 'pega_aqui_el_uid_del_admin_1',
  // 'pega_aqui_el_uid_del_admin_2',
];

const ADMINS_EMAIL = [
  // 'admin1@tudominio.com',
  // 'admin2@tudominio.com',
];

/* Modo "libre" = true → cualquier Google entra (para pruebas).
   Ponlo en false cuando ya tengas los UID/emails arriba. */
const ACCESO_LIBRE = true;

function esAdminAutorizado(user) {
  if (!user) return false;
  if (ACCESO_LIBRE) return true;
  return ADMINS_UID.includes(user.uid) ||
         ADMINS_EMAIL.includes((user.email || '').toLowerCase());
}

/* ═══════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ═══════════════════════════════════════════════════════════ */
let adminActual = null;
let unsubscribeSusc = null;
let suscripciones = [];
let seleccionadaId = null;

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
const aFecha = t => {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate();
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
};

const fmtFecha = f => {
  if (!f) return '—';
  return f.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' })
    + ' ' + f.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
};

const fmtFechaCorta = f => f
  ? f.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' })
  : '—';

const fmtDinero = n => '$' + Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}) + ' MXN';

const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

/* Normaliza variantes del campo `estado` a 3 valores canónicos */
function normalizarEstado(estado) {
  const e = String(estado || 'pendiente').toLowerCase().trim();
  if (['aprobado','aprobada','activa','activo','aceptado','aceptada','pago aprobado'].includes(e)) return 'aprobado';
  if (['rechazado','rechazada','pago rechazado'].includes(e)) return 'rechazado';
  return 'pendiente';
}

function etiquetaEstado(estado) {
  const n = normalizarEstado(estado);
  if (n === 'aprobado')  return '🟢 Pago aprobado';
  if (n === 'rechazado') return '🔴 Pago rechazado';
  return '🟡 Pago en revisión';
}

/* Convierte enlaces de Dropbox a enlaces de descarga directa */
function dropboxDirecto(url) {
  if (!url) return '';
  let u = url.trim();
  if (u.includes('dropbox.com')) {
    u = u.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
         .replace('?dl=0', '').replace('?dl=1', '')
         .replace('&dl=0', '').replace('&dl=1', '')
         .replace('?raw=1', '').replace('&raw=1', '');
  }
  return u;
}

function toast(msg, tipo = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'warn' ? ' warn' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

const openModal  = id => document.getElementById(id)?.classList.add('open');
const closeModal = id => document.getElementById(id)?.classList.remove('open');

document.querySelectorAll('[data-close]').forEach(el => {
  el.onclick = () => closeModal(el.dataset.close);
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

/* ═══════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════ */
const loginBtn   = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn  = document.getElementById('btnLogout');

getRedirectResult(auth).catch(err => {
  if (err?.code && err.code !== 'auth/no-auth-event') console.warn('Redirect:', err);
});

loginBtn.addEventListener('click', async () => {
  try {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="loader"></span> Iniciando sesión...';
    loginError.classList.remove('show');
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' ||
        e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    loginError.textContent = 'Error: ' + e.message;
    loginError.classList.add('show');
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Iniciar sesión con Google';
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    adminActual = null;
    if (unsubscribeSusc) { unsubscribeSusc(); unsubscribeSusc = null; }
    suscripciones = [];
    seleccionadaId = null;
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').classList.remove('active');
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Iniciar sesión con Google';
    return;
  }

  // 🔒 Verificación de admin autorizado
  if (!esAdminAutorizado(user)) {
    await signOut(auth);
    loginError.textContent = '⛔ Esta cuenta no tiene permisos de administrador.';
    loginError.classList.add('show');
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Iniciar sesión con Google';
    return;
  }

  adminActual = user;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').classList.add('active');
  document.getElementById('userPic').src = user.photoURL || '';

  escucharSuscripciones();
});

/* ═══════════════════════════════════════════════════════════
   CERRAR SESIÓN
   ═══════════════════════════════════════════════════════════ */
logoutBtn?.addEventListener('click', async () => {
  const ok = confirm('¿Cerrar sesión del panel administrativo?');
  if (!ok) return;

  try {
    logoutBtn.disabled = true;

    if (unsubscribeSusc) { unsubscribeSusc(); unsubscribeSusc = null; }
    seleccionadaId = null;
    suscripciones = [];

    await signOut(auth);
    toast('Sesión cerrada correctamente');
  } catch (e) {
    console.error('signOut:', e);
    toast('Error al cerrar sesión: ' + e.message, 'error');
  } finally {
    logoutBtn.disabled = false;
  }
});

/* ═══════════════════════════════════════════════════════════
   FIRESTORE — TIEMPO REAL
   ═══════════════════════════════════════════════════════════ */
function escucharSuscripciones() {
  if (unsubscribeSusc) unsubscribeSusc();

  unsubscribeSusc = onSnapshot(collection(db, 'suscripciones'), (snap) => {
    suscripciones = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderThumbs();

    if (seleccionadaId) {
      const s = suscripciones.find(x => x._id === seleccionadaId);
      if (s) pintarFicha(s);
      else seleccionadaId = null;
    }
  }, (err) => {
    console.error('onSnapshot:', err);
    toast('Error al escuchar suscripciones: ' + err.message, 'error');
  });
}

/* ═══════════════════════════════════════════════════════════
   RENDER DE MINIATURAS
   ═══════════════════════════════════════════════════════════ */
function renderThumbs() {
  const aceptadas  = [];
  const espera     = [];
  const rechazadas = [];

  suscripciones.forEach(s => {
    const est = normalizarEstado(s.estado);
    if (est === 'aprobado')       aceptadas.push(s);
    else if (est === 'rechazado') rechazadas.push(s);
    else                          espera.push(s);
  });

  pintarThumbs('thumbsAceptadas',  aceptadas,  'No hay cuentas aceptadas');
  pintarThumbs('thumbsEspera',     espera,     'No hay cuentas en espera');
  pintarThumbs('thumbsRechazadas', rechazadas, 'No hay cuentas rechazadas');
}

function pintarThumbs(contId, lista, msgVacio) {
  const cont = document.getElementById(contId);
  if (!cont) return;

  if (!lista.length) {
    cont.innerHTML = `<div class="empty-thumbs">${msgVacio}</div>`;
    return;
  }

  cont.innerHTML = lista.map(s => {
    const inicial = (s.nombre || s.correo || '?').trim().charAt(0).toUpperCase();
    const sel = s._id === seleccionadaId ? ' selected' : '';
    const pic = s.foto || s.photoURL || s.fotoPerfil;
    return `
      <div class="thumb${sel}" data-id="${escapeHtml(s._id)}"
           title="${escapeHtml(s.nombre || s.correo || '')}">
        ${pic
          ? `<img src="${escapeHtml(pic)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="initial" style="display:none">${escapeHtml(inicial)}</span>`
          : `<span class="initial">${escapeHtml(inicial)}</span>`}
      </div>
    `;
  }).join('');

  cont.querySelectorAll('.thumb').forEach(t => {
    t.onclick = () => seleccionar(t.dataset.id);
  });
}

/* ═══════════════════════════════════════════════════════════
   SELECCIÓN Y FICHA
   ═══════════════════════════════════════════════════════════ */
function seleccionar(docId) {
  seleccionadaId = docId;
  renderThumbs();
  const s = suscripciones.find(x => x._id === docId);
  if (!s) {
    document.getElementById('ficha').style.display = 'none';
    document.getElementById('fichaVacia').style.display = 'flex';
    return;
  }
  pintarFicha(s);
}

function pintarFicha(s) {
  document.getElementById('fichaVacia').style.display = 'none';
  document.getElementById('ficha').style.display = 'flex';

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = (val === undefined || val === null || val === '') ? '—' : val;
  };

  const fechaPago      = aFecha(s.fechaPago);
  const fechaSolicitud = aFecha(s.fechaSolicitud);
  const fechaActualiz  = aFecha(s.fechaUltimaActualizacion);
  const fechaLimite    = aFecha(s.fechaLimiteValidacion);

  set('fNombre',        s.nombre);
  set('fCorreo',        s.correo);
  set('fUid',           s.uid || s._id);
  set('fSolicitudId',   s.solicitudId || s._id);
  set('fEstado',        etiquetaEstado(s.estado));
  set('fPlan',          s.plan === 'anual' ? 'Anual'
                      : s.plan === 'mensual' ? 'Mensual'
                      : (s.plan || '—'));
  set('fPrecio',        s.precio != null ? fmtDinero(s.precio) : '—');
  set('fMonto',         s.monto  != null ? fmtDinero(s.monto)  : '—');
  set('fTitular',       s.nombreTitular);
  set('fBanco',         s.banco);
  set('fReferencia',    s.referencia || s.folio);
  set('fFechaPago',     fmtFechaCorta(fechaPago));
  set('fFechaSolicitud',fmtFecha(fechaSolicitud));
  set('fFechaActualizacion', fmtFecha(fechaActualiz));
  set('fFechaLimite',   fmtFechaCorta(fechaLimite));

  const btnTick = document.getElementById('btnVerTickque');
  const url = s.comprobante || s.comprobanteURL;
  btnTick.disabled = !url;
  btnTick.textContent = url ? '👁️ Ver ticket' : 'Sin comprobante';
  btnTick.onclick = () => url ? window.verComprobante(s._id) : null;
}

/* ═══════════════════════════════════════════════════════════
   VER COMPROBANTE
   ═══════════════════════════════════════════════════════════ */
window.verComprobante = (docId) => {
  const s = suscripciones.find(x => x._id === docId);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const urlOriginal = s.comprobante || s.comprobanteURL;
  if (!urlOriginal) return toast('Sin comprobante registrado', 'warn');

  const cont = document.getElementById('imgViewer');
  cont.innerHTML = '<div class="loading-full">Cargando comprobante...</div>';
  openModal('modalImg');

  const urlDirecta = dropboxDirecto(urlOriginal);
  const img = new Image();
  img.onload = () => { cont.innerHTML = ''; cont.appendChild(img); };
  img.onerror = () => {
    cont.innerHTML = `
      <div style="padding:24px;text-align:center">
        <p style="color:#ff8a8a;font-weight:700;margin-bottom:12px">
          ⚠️ No se puede visualizar el comprobante.
        </p>
        <p style="color:#aaa;font-size:14px;margin-bottom:16px">
          Verifica que el enlace de Dropbox sea público.
        </p>
        <a href="${escapeHtml(urlOriginal)}" target="_blank" rel="noopener"
           style="display:inline-block;background:#e63946;color:#fff;padding:10px 20px;
                  border-radius:999px;text-decoration:none;font-weight:600">
          🔗 Abrir enlace original
        </a>
        <p style="color:#666;font-size:11px;margin-top:16px;word-break:break-all">
          ${escapeHtml(urlOriginal)}
        </p>
      </div>`;
  };
  img.src = urlDirecta;
  img.style.cssText = 'width:100%;border-radius:10px;display:block;background:#000';
  img.alt = 'Comprobante';
};

/* ═══════════════════════════════════════════════════════════
   ACCIONES: SOLO MODIFICA EL CAMPO `estado`
   ═══════════════════════════════════════════════════════════ */
async function cambiarEstadoSeleccionado(nuevoEstado, etiqueta) {
  if (!seleccionadaId) return toast('Selecciona una cuenta primero', 'warn');

  const s = suscripciones.find(x => x._id === seleccionadaId);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const estadoAnterior = normalizarEstado(s.estado);
  if (estadoAnterior === nuevoEstado) {
    return toast(`Ya está en estado "${etiqueta}"`, 'warn');
  }

  const ok = confirm(
    `¿Marcar "${s.nombre || s.correo}" como "${etiqueta}"?\n\n` +
    `Solo se modificará el campo "estado".`
  );
  if (!ok) return;

  const btns = document.querySelectorAll('.btn-accion');
  btns.forEach(b => b.disabled = true);

  try {
    await updateDoc(doc(db, 'suscripciones', s._id), {
      estado: nuevoEstado
    });

    toast(`✅ Estado actualizado: ${etiqueta}`);

  } catch (e) {
    console.error(e);
    toast('Error: ' + e.message, 'error');
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

document.getElementById('btnEspera').onclick   = () => cambiarEstadoSeleccionado('pendiente', '🟡 Pago en revisión');
document.getElementById('btnAceptar').onclick  = () => cambiarEstadoSeleccionado('aprobado',  '🟢 Pago aprobado');
document.getElementById('btnRechazar').onclick = () => cambiarEstadoSeleccionado('rechazado', '🔴 Pago rechazado');

/* ═══════════════════════════════════════════════════════════
   BUSCADOR
   ═══════════════════════════════════════════════════════════ */
function buscar() {
  const q = (document.getElementById('buscador').value || '').toLowerCase().trim();
  if (!q) {
    seleccionadaId = null;
    document.getElementById('ficha').style.display = 'none';
    document.getElementById('fichaVacia').style.display = 'flex';
    renderThumbs();
    return;
  }

  const match = suscripciones.find(s =>
    (s.nombre         || '').toLowerCase().includes(q) ||
    (s.correo         || '').toLowerCase().includes(q) ||
    (s.uid            || '').toLowerCase().includes(q) ||
    (s._id            || '').toLowerCase().includes(q) ||
    (s.solicitudId    || '').toLowerCase().includes(q) ||
    (s.nombreTitular  || '').toLowerCase().includes(q) ||
    (s.referencia     || '').toLowerCase().includes(q)
  );

  if (!match) {
    toast('No se encontró ninguna cuenta con ese criterio', 'warn');
    return;
  }

  seleccionar(match._id);
}

document.getElementById('btnBuscar').onclick = buscar;
document.getElementById('buscador').addEventListener('keydown', e => {
  if (e.key === 'Enter') buscar();
});
document.getElementById('buscador').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  if (q.length >= 2) buscar();
});
