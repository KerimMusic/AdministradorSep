import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, setDoc,
  updateDoc, addDoc, serverTimestamp, Timestamp, onSnapshot
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
   ESTADO GLOBAL
   ═══════════════════════════════════════════════════════════ */
let adminActual = null;
let unsubscribeSusc = null;
let suscripciones = [];
let filtroSolicitudes = 'pendiente';

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
const aFecha = t => t?.toDate ? t.toDate() : (t ? new Date(t) : null);
const fmtFecha = f => f ? f.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtDinero = n => '$' + Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}) + ' MXN';
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const diasRestantes = venc => venc ? Math.ceil((venc - new Date()) / 86400000) : 0;

/* Mapeo estado → label visual */
const ESTADOS_UI = {
  pendiente: { label: '🟡 Pago en revisión', badge: 'pendiente' },
  activa:    { label: '🟢 Pago aprobado',    badge: 'activa' },
  rechazada: { label: '🔴 Pago rechazado',   badge: 'rechazada' }
};

/* Normaliza cualquier variante de estado a los 3 valores internos */
function normalizarEstado(estado) {
  const e = String(estado || 'pendiente').toLowerCase().trim();
  if (['activa','activo','aprobada','aprobado','pago aprobado'].includes(e)) return 'activa';
  if (['rechazada','rechazado','pago rechazado'].includes(e)) return 'rechazada';
  return 'pendiente';
}

function labelEstado(estado) {
  return ESTADOS_UI[normalizarEstado(estado)].label;
}

function dropboxDirecto(url) {
  if (!url) return '';
  return url.trim()
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('?dl=0', '').replace('?dl=1', '')
    .replace('&dl=0', '').replace('&dl=1', '')
    .replace('?raw=1', '');
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
window.closeModal = closeModal;

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
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').classList.remove('active');
    return;
  }

  // ✅ VERIFICACIÓN: solo admins pueden entrar
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    if (!snap.exists()) {
      await signOut(auth);
      loginError.textContent = '🚫 Esta cuenta no tiene permisos de administrador.';
      loginError.classList.add('show');
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'Iniciar sesión con Google';
      return;
    }
  } catch (e) {
    console.error('Verificación admin:', e);
    await signOut(auth);
    loginError.textContent = 'Error verificando permisos: ' + e.message;
    loginError.classList.add('show');
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Iniciar sesión con Google';
    return;
  }

  // ✅ Admin confirmado
  adminActual = user;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').classList.add('active');
  document.getElementById('userEmail').textContent = user.email || '';
  document.getElementById('userPic').src = user.photoURL || '';

  escucharSuscripciones();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  await signOut(auth);
});

/* ═══════════════════════════════════════════════════════════
   NAVEGACIÓN
   ═══════════════════════════════════════════════════════════ */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view)?.classList.add('active');
    document.getElementById('sidebar').classList.remove('open');
  };
});

document.getElementById('menuToggle').onclick = () => {
  document.getElementById('sidebar').classList.toggle('open');
};

/* ═══════════════════════════════════════════════════════════
   ESCUCHAR SUSCRIPCIONES EN TIEMPO REAL
   ═══════════════════════════════════════════════════════════ */
function escucharSuscripciones() {
  if (unsubscribeSusc) unsubscribeSusc();

  const ref = collection(db, 'suscripciones');
  unsubscribeSusc = onSnapshot(ref, (snap) => {
    suscripciones = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    const ahora = new Date();
    suscripciones.forEach(s => {
      const est = normalizarEstado(s.estado);
      if (est === 'activa') {
        // Usar fechaVencimiento si existe; si no, fechaLimiteValidacion como respaldo
        const v = aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion);
        s._estadoEfectivo = (v && ahora >= v) ? 'expirada' : 'activa';
      } else {
        s._estadoEfectivo = est;
      }
    });

    renderTodo();
  }, (err) => {
    console.error('onSnapshot suscripciones:', err);
    toast('Error al escuchar suscripciones', 'error');
  });
}

/* ═══════════════════════════════════════════════════════════
   RENDER PRINCIPAL
   ═══════════════════════════════════════════════════════════ */
function renderTodo() {
  renderDashboard();
  renderSolicitudes(document.getElementById('searchSolicitudes')?.value || '');
  renderActivas();
  renderPorVencer();
  renderExpiradas();
  renderHistorial();
  actualizarContadoresMenu();
}

function actualizarContadoresMenu() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente').length;
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa').length;
  const elP = document.getElementById('cntPendientes');
  const elA = document.getElementById('cntActivas');
  if (elP) elP.textContent = pend;
  if (elA) elA.textContent = act;
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════ */
function renderDashboard() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente');
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa');
  const porV = act.filter(s => {
    const d = diasRestantes(aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion));
    return d >= 0 && d <= 7;
  });
  const exp  = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const apro = suscripciones.filter(s => normalizarEstado(s.estado) === 'activa').length;
  const rech = suscripciones.filter(s => normalizarEstado(s.estado) === 'rechazada').length;
  const mens = act.filter(s => s.plan === 'mensual').length;
  const anua = act.filter(s => s.plan === 'anual').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statPendientes', pend.length);
  set('statActivas', act.length);
  set('statPorVencer', porV.length);
  set('statExpiradas', exp.length);
  set('statAprobados', apro);
  set('statRechazados', rech);
  set('statMensuales', mens);
  set('statAnuales', anua);

  const recientes = [...suscripciones].sort((a, b) => {
    const fa = aFecha(a.fechaSolicitud)?.getTime() || 0;
    const fb = aFecha(b.fechaSolicitud)?.getTime() || 0;
    return fb - fa;
  }).slice(0, 10);

  const tb = document.getElementById('dashUltimasSolicitudes');
  if (!tb) return;
  if (!recientes.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">No hay solicitudes registradas</td></tr>';
    return;
  }
  tb.innerHTML = recientes.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td><span class="badge ${s._estadoEfectivo}">${labelEstado(s.estado)}</span></td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   SOLICITUDES (formato tarjeta con comprobante + botones)
   ═══════════════════════════════════════════════════════════ */
function renderSolicitudes(filtro = '') {
  const q = String(filtro || '').toLowerCase().trim();
  let lista = [...suscripciones];

  if (filtroSolicitudes !== 'todas') {
    lista = lista.filter(s => normalizarEstado(s.estado) === filtroSolicitudes);
  }

  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || s._id || '').toLowerCase().includes(q)
    );
  }

  lista.sort((a, b) => {
    const fa = aFecha(a.fechaSolicitud)?.getTime() || 0;
    const fb = aFecha(b.fechaSolicitud)?.getTime() || 0;
    return fb - fa;
  });

  const cont = document.getElementById('listaSolicitudes');
  if (!cont) return;

  actualizarContadoresFiltros();

  if (!lista.length) {
    cont.innerHTML = '<div class="empty">No hay solicitudes para mostrar con este filtro</div>';
    return;
  }

  cont.innerHTML = lista.map(renderSolicitudCard).join('');

  // Bind "Ver comprobante"
  cont.querySelectorAll('[data-action="ver"]').forEach(btn => {
    btn.onclick = () => window.verComprobante(btn.dataset.uid);
  });

  // Bind botones de estado
  cont.querySelectorAll('[data-estado-btn]').forEach(btn => {
    btn.onclick = () => cambiarEstado(btn.dataset.uid, btn.dataset.estadoBtn);
  });
}

/* Construye el HTML de una tarjeta a partir de un doc real de Firebase */
function renderSolicitudCard(s) {
  const eNorm = normalizarEstado(s.estado);
  const eUI   = ESTADOS_UI[eNorm];
  const docId = s._id; // ID real del documento en Firestore

  const fechaSol  = fmtFecha(aFecha(s.fechaSolicitud));
  const fechaPago = s.fechaPago
    ? (s.fechaPago?.toDate ? fmtFecha(s.fechaPago.toDate())
       : fmtFecha(new Date(s.fechaPago)))
    : '—';

  const precio  = fmtDinero(s.monto ?? s.precio);
  const planTxt = s.plan === 'anual'   ? '📆 Anual'
                : s.plan === 'mensual' ? '📅 Mensual'
                : (s.plan || '—');
  const comp = s.comprobante || s.comprobanteURL;

  return `
    <article class="solicitud-card estado-${eNorm}">
      <header class="sol-header">
        <div class="sol-user">
          <h3>${escapeHtml(s.nombre || 'Sin nombre')}</h3>
          <span class="sol-correo">${escapeHtml(s.correo || '—')}</span>
        </div>
        <span class="badge ${eUI.badge}">${eUI.label}</span>
      </header>

      <div class="sol-info">
        <div class="sol-item">
          <label>UID</label>
          <span class="mono">${escapeHtml(s.uid || docId || '—')}</span>
        </div>
        <div class="sol-item">
          <label>Plan</label>
          <span>${planTxt}</span>
        </div>
        <div class="sol-item">
          <label>Precio</label>
          <span class="precio">${precio}</span>
        </div>
        <div class="sol-item">
          <label>Banco</label>
          <span>${escapeHtml(s.banco || '—')}</span>
        </div>
        <div class="sol-item">
          <label>Titular</label>
          <span>${escapeHtml(s.nombreTitular || '—')}</span>
        </div>
        <div class="sol-item">
          <label>Fecha de pago</label>
          <span>${fechaPago}</span>
        </div>
        <div class="sol-item">
          <label>Fecha de solicitud</label>
          <span>${fechaSol}</span>
        </div>
      </div>

      <div class="sol-footer">
        <div class="sol-comp">
          ${comp
            ? `<button class="btn btn-ghost btn-sm" data-action="ver" data-uid="${escapeHtml(docId)}">
                 👁️ Ver comprobante
               </button>`
            : `<span class="sin-comp">Sin comprobante registrado</span>`}
        </div>

        <div class="sol-estados">
          ${['pendiente','activa','rechazada'].map(k => `
            <button class="estado-btn ${k} ${eNorm === k ? 'active' : ''}"
                    data-estado-btn="${k}"
                    data-uid="${escapeHtml(docId)}">
              ${ESTADOS_UI[k].label}
            </button>
          `).join('')}
        </div>
      </div>
    </article>
  `;
}

/* Contadores en las pestañas de filtro */
function actualizarContadoresFiltros() {
  const counts = { pendiente: 0, activa: 0, rechazada: 0, todas: suscripciones.length };
  suscripciones.forEach(s => { counts[normalizarEstado(s.estado)]++; });
  document.querySelectorAll('.filter-count').forEach(el => {
    const k = el.dataset.count;
    if (k in counts) el.textContent = counts[k];
  });
}

/* ═══════════════════════════════════════════════════════════
   ACTIVAS / POR VENCER / EXPIRADAS
   ═══════════════════════════════════════════════════════════ */
function renderActivas(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = suscripciones.filter(s => s._estadoEfectivo === 'activa');
  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || '').toLowerCase().includes(q)
    );
  }
  const tb = document.getElementById('tablaActivas');
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">No hay suscripciones activas</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => {
    const venc = aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion);
    const dias = diasRestantes(venc);
    const colorDias = dias <= 3 ? 'red' : dias <= 7 ? 'yellow' : 'green';
    return `
      <tr>
        <td>${escapeHtml(s.nombre || '—')}</td>
        <td>${escapeHtml(s.correo || '—')}</td>
        <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
        <td>${fmtFecha(aFecha(s.fechaInicio) || aFecha(s.fechaPago))}</td>
        <td>${fmtFecha(venc)}</td>
        <td><span class="stat-value ${colorDias}" style="font-size:14px;margin:0">${dias} días</span></td>
        <td><span class="badge activa">🟢 Pago aprobado</span></td>
      </tr>`;
  }).join('');
}

function renderPorVencer() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'activa')
    .filter(s => {
      const d = diasRestantes(aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion));
      return d >= 0 && d <= 7;
    })
    .sort((a, b) => {
      const da = diasRestantes(aFecha(a.fechaVencimiento) || aFecha(a.fechaLimiteValidacion));
      const db = diasRestantes(aFecha(b.fechaVencimiento) || aFecha(b.fechaLimiteValidacion));
      return da - db;
    });

  const tb = document.getElementById('tablaPorVencer');
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones próximas a vencer</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => {
    const venc = aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion);
    const d = diasRestantes(venc);
    return `
      <tr>
        <td>${escapeHtml(s.nombre || '—')}</td>
        <td>${escapeHtml(s.correo || '—')}</td>
        <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
        <td>${fmtFecha(venc)}</td>
        <td><span class="stat-value ${d <= 3 ? 'red' : 'yellow'}" style="font-size:14px;margin:0">${d} días</span></td>
        <td><span class="badge activa">🟢 Pago aprobado</span></td>
      </tr>`;
  }).join('');
}

function renderExpiradas() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const tb = document.getElementById('tablaExpiradas');
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones expiradas</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtFecha(aFecha(s.fechaInicio) || aFecha(s.fechaPago))}</td>
      <td>${fmtFecha(aFecha(s.fechaVencimiento) || aFecha(s.fechaLimiteValidacion))}</td>
      <td><span class="badge expirada">⚫ Expirada</span></td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   HISTORIAL
   ═══════════════════════════════════════════════════════════ */
function renderHistorial(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = [...suscripciones];
  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || '').toLowerCase().includes(q)
    );
  }
  const tb = document.getElementById('tablaHistorial');
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">No hay pagos en el historial</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => {
    const eNorm = normalizarEstado(s.estado);
    return `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtDinero(s.monto ?? s.precio)}</td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
      <td><span class="badge ${ESTADOS_UI[eNorm].badge}">${ESTADOS_UI[eNorm].label}</span></td>
      <td>${s.comprobante
        ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(s._id)}')">👁️ Ver</button>`
        : '—'}</td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   VER COMPROBANTE (Dropbox)
   ═══════════════════════════════════════════════════════════ */
window.verComprobante = (docId) => {
  const s = suscripciones.find(x => x._id === docId || x.uid === docId);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const urlOriginal = s.comprobante || s.comprobanteURL;
  if (!urlOriginal) {
    toast('Esta suscripción no tiene comprobante registrado', 'warn');
    return;
  }

  const cont = document.getElementById('imgViewer');
  if (!cont) return;
  cont.innerHTML = '<div class="loading-full">Cargando comprobante...</div>';
  openModal('modalImg');

  const urlDirecta = dropboxDirecto(urlOriginal);

  const img = new Image();
  img.onload = () => {
    cont.innerHTML = '';
    cont.appendChild(img);
  };
  img.onerror = () => {
    cont.innerHTML = `
      <div style="padding:24px;text-align:center">
        <p style="color:var(--danger);font-weight:700;margin-bottom:12px">
          ⚠️ No se puede visualizar el comprobante.
        </p>
        <p style="color:var(--text2);font-size:14px;margin-bottom:16px">
          Verifica que el enlace de Dropbox sea público o permita su visualización.
        </p>
        <a href="${escapeHtml(urlOriginal)}" target="_blank" rel="noopener"
           class="btn btn-primary btn-sm">🔗 Abrir enlace original</a>
        <p style="color:var(--text2);font-size:11px;margin-top:16px;word-break:break-all">
          ${escapeHtml(urlOriginal)}
        </p>
      </div>`;
  };
  img.src = urlDirecta;
  img.style.cssText = 'width:100%;border-radius:10px;display:block;background:#000';
  img.alt = 'Comprobante de pago';
};

/* ═══════════════════════════════════════════════════════════
   CAMBIAR ESTADO (ÚNICO CAMPO EDITABLE)
   ═══════════════════════════════════════════════════════════ */
async function cambiarEstado(docId, nuevoEstado) {
  const s = suscripciones.find(x => x._id === docId || x.uid === docId);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const estadoAnterior = normalizarEstado(s.estado);
  if (estadoAnterior === nuevoEstado) {
    return toast('El estado ya es ese', 'warn');
  }

  const eAnt = ESTADOS_UI[estadoAnterior];
  const eNew = ESTADOS_UI[nuevoEstado];

  const ok = confirm(
    `¿Cambiar el estado de "${s.nombre || s.correo}"?\n\n` +
    `De:  ${eAnt.label}\n` +
    `A:   ${eNew.label}\n\n` +
    `⚠️ Solo se modificará el campo "estado".`
  );
  if (!ok) return;

  // Deshabilitar todos los botones de esa tarjeta mientras se guarda
  const card = document.querySelector(`.solicitud-card .estado-btn[data-uid="${docId}"]`)
                ?.closest('.solicitud-card');
  card?.querySelectorAll('.estado-btn').forEach(b => b.disabled = true);

  try {
    // ✅ Se actualiza SOLO el campo estado (+ auditoría)
    await updateDoc(doc(db, 'suscripciones', s._id), {
      estado: nuevoEstado,
      fechaUltimaActualizacion: serverTimestamp(),
      resueltoPor: adminActual.email,
      fechaResolucion: serverTimestamp()
    });

    // Registro en actividad_admin
    try {
      await addDoc(collection(db, 'actividad_admin'), {
        adminUID: adminActual.uid,
        adminEmail: adminActual.email,
        adminNombre: adminActual.displayName || '',
        accion: 'Cambió estado de suscripción',
        usuarioAfectadoUID: s.uid || s._id || '',
        usuarioAfectadoNombre: s.nombre || '',
        usuarioAfectadoCorreo: s.correo || '',
        detalles: {
          estadoAnterior,
          estadoNuevo: nuevoEstado,
          etiqueta: eNew.label,
          docId: s._id
        },
        fecha: serverTimestamp()
      });
    } catch (e) { console.warn('No se pudo registrar actividad:', e); }

    toast(`✅ Estado actualizado: ${eNew.label}`);
    // onSnapshot refresca la lista automáticamente

  } catch (e) {
    console.error('Error al cambiar estado:', e);
    toast('Error: ' + e.message, 'error');
    card?.querySelectorAll('.estado-btn').forEach(b => b.disabled = false);
  }
}

/* ═══════════════════════════════════════════════════════════
   BUSCADORES
   ═══════════════════════════════════════════════════════════ */
document.getElementById('searchSolicitudes')?.addEventListener('input', e => renderSolicitudes(e.target.value));
document.getElementById('searchActivas')?.addEventListener('input', e => renderActivas(e.target.value));
document.getElementById('searchHistorial')?.addEventListener('input', e => renderHistorial(e.target.value));

/* ═══════════════════════════════════════════════════════════
   FILTROS DE SOLICITUDES
   ═══════════════════════════════════════════════════════════ */
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filtroSolicitudes = tab.dataset.filter;
    renderSolicitudes(document.getElementById('searchSolicitudes')?.value || '');
  };
});

/* ═══════════════════════════════════════════════════════════
   REFRESH
   ═══════════════════════════════════════════════════════════ */
document.getElementById('refreshDash')?.addEventListener('click', () => {
  toast('✅ Datos actualizados en tiempo real');
});
document.getElementById('refreshSolicitudes')?.addEventListener('click', () => {
  toast('✅ Datos actualizados en tiempo real');
});
document.getElementById('refreshActivas')?.addEventListener('click', () => {
  toast('✅ Datos actualizados en tiempo real');
});
