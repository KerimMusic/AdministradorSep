import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, updateDoc, addDoc, deleteDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ══════════════════════════════════════════════════════
   CONFIGURACIÓN FIREBASE (misma que OmegaBeats)
   ══════════════════════════════════════════════════════ */
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
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ══════════════════════════════════════════════════════
   ESTADO GLOBAL
   ══════════════════════════════════════════════════════ */
let adminActual = null;
let suscripciones = [];
let historial = [];
let actividad = [];
let configPagos = {};
let configPlanes = { mensual:{precio:399.90, meses:1}, anual:{precio:500.00, meses:12} };
let diasAvisoVencer = 7;

/* ══════════════════════════════════════════════════════
   UTILIDADES
   ══════════════════════════════════════════════════════ */
const aFecha = t => t?.toDate ? t.toDate() : (t ? new Date(t) : null);
const fmtFecha = f => f ? f.toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
const fmtFechaHora = f => f ? f.toLocaleString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDinero = n => '$' + Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' MXN';
const escapeHtml = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const diasRestantes = venc => venc ? Math.ceil((venc - new Date()) / 86400000) : 0;

function toast(msg, tipo='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'warn' ? ' warn' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

const openModal = id => document.getElementById(id)?.classList.add('open');
const closeModal = id => document.getElementById(id)?.classList.remove('open');

window.closeModal = closeModal;

document.querySelectorAll('[data-close]').forEach(el => {
  el.onclick = () => closeModal(el.dataset.close);
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

/* ══════════════════════════════════════════════════════
   LOGIN
   ══════════════════════════════════════════════════════ */
const loginBtn = document.getElementById('loginBtn');
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
    console.error(e);
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    loginError.textContent = 'Error: ' + e.message;
    loginError.classList.add('show');
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Iniciar sesión con Google';
  }
});

/* ══════════════════════════════════════════════════════
   AUTH STATE — Verifica admin
   ══════════════════════════════════════════════════════ */
onAuthStateChanged(auth, async user => {
  if (!user) {
    adminActual = null;
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').classList.remove('active');
    return;
  }

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

    adminActual = user;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').classList.add('active');
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('userPic').src = user.photoURL || '';

    await cargarConfigs();
    await cargarTodo();
  } catch (e) {
    console.error('Verificación admin:', e);
    loginError.textContent = 'Error verificando permisos: ' + e.message;
    loginError.classList.add('show');
    await signOut(auth);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  await signOut(auth);
});

/* ══════════════════════════════════════════════════════
   NAVEGACIÓN
   ══════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════
   CARGA DE DATOS
   ══════════════════════════════════════════════════════ */
async function cargarConfigs() {
  try {
    const snapP = await getDoc(doc(db, 'config', 'pagos'));
    configPagos = snapP.exists() ? snapP.data() : {};
    document.getElementById('cfgBanco').value = configPagos.banco || '';
    document.getElementById('cfgTitular').value = configPagos.titular || '';
    document.getElementById('cfgClabe').value = configPagos.clabe || '';
    document.getElementById('cfgCuenta').value = configPagos.cuenta || '';
    document.getElementById('cfgWhats').value = configPagos.whatsappSoporte || '';
    document.getElementById('cfgInstrucciones').value = configPagos.instrucciones || '';
  } catch (e) { console.error('config pagos:', e); }

  try {
    const snapPl = await getDoc(doc(db, 'config', 'planes'));
    if (snapPl.exists()) {
      const d = snapPl.data();
      configPlanes = {
        mensual: { precio: d.mensual?.precio ?? 399.90, meses: d.mensual?.meses ?? 1 },
        anual:   { precio: d.anual?.precio   ?? 500.00, meses: d.anual?.meses   ?? 12 }
      };
    }
    document.getElementById('cfgMensualPrecio').value = configPlanes.mensual.precio;
    document.getElementById('cfgMensualDur').value = configPlanes.mensual.meses;
    document.getElementById('cfgAnualPrecio').value = configPlanes.anual.precio;
    document.getElementById('cfgAnualDur').value = configPlanes.anual.meses;
  } catch (e) { console.error('config planes:', e); }
}

async function cargarTodo() {
  await Promise.all([cargarSuscripciones(), cargarHistorial(), cargarActividad()]);
}

async function cargarSuscripciones() {
  try {
    const snap = await getDocs(collection(db, 'suscripciones'));
    suscripciones = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    const ahora = new Date();
    suscripciones.forEach(s => {
      if (s.estado === 'activa') {
        const v = aFecha(s.fechaVencimiento);
        if (v && ahora >= v) s._estadoEfectivo = 'expirada';
        else s._estadoEfectivo = 'activa';
      } else {
        s._estadoEfectivo = s.estado;
      }
    });
    renderDashboard();
    renderSolicitudes();
    renderActivas();
    renderPorVencer();
    renderExpiradas();
    actualizarContadoresMenu();
  } catch (e) {
    console.error('cargarSuscripciones:', e);
    toast('Error al cargar suscripciones', 'error');
  }
}

async function cargarHistorial() {
  try {
    const snapSubs = await getDocs(collection(db, 'suscripciones'));
    const todos = [];
    for (const d of snapSubs.docs) {
      const pagosRef = collection(db, 'historial_pagos', d.id, 'pagos');
      const pagosSnap = await getDocs(pagosRef);
      pagosSnap.forEach(p => todos.push({ _uid: d.id, _pagoId: p.id, ...p.data() }));
    }
    todos.sort((a, b) => {
      const fa = aFecha(a.fechaAprobacion || a.fechaSolicitud)?.getTime() || 0;
      const fb = aFecha(b.fechaAprobacion || b.fechaSolicitud)?.getTime() || 0;
      return fb - fa;
    });
    historial = todos;
    renderHistorial();
  } catch (e) { console.error('cargarHistorial:', e); }
}

async function cargarActividad() {
  try {
    const snap = await getDocs(collection(db, 'actividad_admin'));
    actividad = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    actividad.sort((a, b) => {
      const fa = aFecha(a.fecha)?.getTime() || 0;
      const fb = aFecha(b.fecha)?.getTime() || 0;
      return fb - fa;
    });
    renderActividad();
  } catch (e) { console.error('cargarActividad:', e); }
}

/* ══════════════════════════════════════════════════════
   REGISTRAR ACTIVIDAD
   ══════════════════════════════════════════════════════ */
async function registrarActividad(accion, usuarioAfectado, detalles = {}) {
  try {
    await addDoc(collection(db, 'actividad_admin'), {
      adminUID: adminActual.uid,
      adminEmail: adminActual.email,
      adminNombre: adminActual.displayName || '',
      accion,
      usuarioAfectadoUID: usuarioAfectado?.uid || '',
      usuarioAfectadoNombre: usuarioAfectado?.nombre || '',
      usuarioAfectadoCorreo: usuarioAfectado?.correo || '',
      detalles,
      fecha: serverTimestamp()
    });
  } catch (e) { console.warn('No se pudo registrar actividad:', e); }
}

/* ══════════════════════════════════════════════════════
   RENDER — DASHBOARD
   ══════════════════════════════════════════════════════ */
function renderDashboard() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente');
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa');
  const porV = act.filter(s => {
    const d = diasRestantes(aFecha(s.fechaVencimiento));
    return d >= 0 && d <= diasAvisoVencer;
  });
  const exp  = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const apro = historial.filter(h => h.estado === 'activa').length;
  const rech = historial.filter(h => h.estado === 'rechazada').length;
  const mens = act.filter(s => s.plan === 'mensual').length;
  const anua = act.filter(s => s.plan === 'anual').length;

  document.getElementById('statPendientes').textContent = pend.length;
  document.getElementById('statActivas').textContent = act.length;
  document.getElementById('statPorVencer').textContent = porV.length;
  document.getElementById('statExpiradas').textContent = exp.length;
  document.getElementById('statAprobados').textContent = apro;
  document.getElementById('statRechazados').textContent = rech;
  document.getElementById('statMensuales').textContent = mens;
  document.getElementById('statAnuales').textContent = anua;

  const recientes = [...suscripciones].sort((a,b) => {
    const fa = aFecha(a.fechaSolicitud)?.getTime() || 0;
    const fb = aFecha(b.fechaSolicitud)?.getTime() || 0;
    return fb - fa;
  }).slice(0, 10);

  const tb = document.getElementById('dashUltimasSolicitudes');
  if (!recientes.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">No hay solicitudes registradas</td></tr>';
    return;
  }
  tb.innerHTML = recientes.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td><span class="badge ${s._estadoEfectivo}">${s._estadoEfectivo}</span></td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
    </tr>`).join('');
}

function actualizarContadoresMenu() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente').length;
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa').length;
  document.getElementById('cntPendientes').textContent = pend;
  document.getElementById('cntActivas').textContent = act;
}

/* ══════════════════════════════════════════════════════
   RENDER — SOLICITUDES
   ══════════════════════════════════════════════════════ */
function renderSolicitudes(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = suscripciones.filter(s => s._estadoEfectivo === 'pendiente');
  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || '').toLowerCase().includes(q) ||
      (s.telefono || '').toLowerCase().includes(q)
    );
  }
  lista.sort((a,b) => (aFecha(b.fechaSolicitud)?.getTime()||0) - (aFecha(a.fechaSolicitud)?.getTime()||0));

  const tb = document.getElementById('tablaSolicitudes');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="10" class="empty">No hay solicitudes pendientes</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td style="font-family:monospace;font-size:11px">${escapeHtml(s.uid || '—')}</td>
      <td>${escapeHtml(s.telefono || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtDinero(s.precio)}</td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
      <td><span class="badge ${s._estadoEfectivo}">${s._estadoEfectivo}</span></td>
      <td>${s.comprobanteURL
        ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(s.comprobanteURL)}')">Ver</button>`
        : '—'}</td>
      <td>
        <button class="btn btn-primary btn-xs" onclick="aprobarPago('${s.uid}')">✅ Aprobar</button>
        <button class="btn btn-danger btn-xs" onclick="rechazarPago('${s.uid}')">❌ Rechazar</button>
        <button class="btn btn-ghost btn-xs" onclick="verDetalle('${s.uid}')">👁️</button>
      </td>
    </tr>`).join('');
}

/* ══════════════════════════════════════════════════════
   RENDER — ACTIVAS
   ══════════════════════════════════════════════════════ */
function renderActivas(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = suscripciones.filter(s => s._estadoEfectivo === 'activa');
  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || '').toLowerCase().includes(q) ||
      (s.telefono || '').toLowerCase().includes(q)
    );
  }
  const tb = document.getElementById('tablaActivas');
  if (!lista.length) { tb.innerHTML = '<tr><td colspan="8" class="empty">No hay suscripciones activas</td></tr>'; return; }
  tb.innerHTML = lista.map(s => {
    const venc = aFecha(s.fechaVencimiento);
    const dias = diasRestantes(venc);
    const colorDias = dias <= 3 ? 'red' : dias <= 7 ? 'yellow' : 'green';
    return `
      <tr>
        <td>${escapeHtml(s.nombre || '—')}</td>
        <td>${escapeHtml(s.correo || '—')}</td>
        <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
        <td>${fmtFecha(aFecha(s.fechaInicio))}</td>
        <td>${fmtFecha(venc)}</td>
        <td><span class="stat-value ${colorDias}" style="font-size:14px;margin:0">${dias} días</span></td>
        <td><span class="badge activa">activa</span></td>
        <td>
          <button class="btn btn-ghost btn-xs" onclick="verDetalle('${s.uid}')">👁️ Ver</button>
          <button class="btn btn-ghost btn-xs" onclick="abrirRenovar('${s.uid}')">🔄 Renovar</button>
        </td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════
   RENDER — POR VENCER
   ══════════════════════════════════════════════════════ */
function renderPorVencer() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'activa')
    .filter(s => {
      const d = diasRestantes(aFecha(s.fechaVencimiento));
      return d >= 0 && d <= diasAvisoVencer;
    })
    .sort((a,b) => diasRestantes(aFecha(a.fechaVencimiento)) - diasRestantes(aFecha(b.fechaVencimiento)));

  const tb = document.getElementById('tablaPorVencer');
  if (!lista.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones próximas a vencer</td></tr>'; return; }
  tb.innerHTML = lista.map(s => {
    const venc = aFecha(s.fechaVencimiento);
    const d = diasRestantes(venc);
    return `
      <tr>
        <td>${escapeHtml(s.nombre || '—')}</td>
        <td>${escapeHtml(s.correo || '—')}</td>
        <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
        <td>${fmtFecha(venc)}</td>
        <td><span class="stat-value ${d <= 3 ? 'red' : 'yellow'}" style="font-size:14px;margin:0">${d} días</span></td>
        <td>
          <button class="btn btn-primary btn-xs" onclick="abrirRenovar('${s.uid}')">🔄 Renovar</button>
          <button class="btn btn-ghost btn-xs" onclick="verDetalle('${s.uid}')">👁️</button>
        </td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════
   RENDER — EXPIRADAS
   ══════════════════════════════════════════════════════ */
function renderExpiradas() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const tb = document.getElementById('tablaExpiradas');
  if (!lista.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones expiradas</td></tr>'; return; }
  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtFecha(aFecha(s.fechaInicio))}</td>
      <td>${fmtFecha(aFecha(s.fechaVencimiento))}</td>
      <td>
        <button class="btn btn-primary btn-xs" onclick="abrirRenovar('${s.uid}')">🔄 Renovar</button>
        <button class="btn btn-ghost btn-xs" onclick="verDetalle('${s.uid}')">👁️</button>
      </td>
    </tr>`).join('');
}

/* ══════════════════════════════════════════════════════
   RENDER — HISTORIAL
   ══════════════════════════════════════════════════════ */
function renderHistorial(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = historial;
  if (q) {
    lista = lista.filter(h =>
      (h.nombre || '').toLowerCase().includes(q) ||
      (h.correo || '').toLowerCase().includes(q) ||
      (h.uid || '').toLowerCase().includes(q) ||
      (h.telefono || '').toLowerCase().includes(q)
    );
  }
  const tb = document.getElementById('tablaHistorial');
  if (!lista.length) { tb.innerHTML = '<tr><td colspan="9" class="empty">No hay pagos en el historial</td></tr>'; return; }
  tb.innerHTML = lista.map(h => `
    <tr>
      <td>${escapeHtml(h.nombre || '—')}</td>
      <td>${escapeHtml(h.correo || '—')}</td>
      <td>${h.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtDinero(h.precio)}</td>
      <td>${fmtFecha(aFecha(h.fechaSolicitud))}</td>
      <td><span class="badge ${h.estado}">${h.estado}</span></td>
      <td>${escapeHtml(h.resueltoPor || '—')}</td>
      <td>${fmtFecha(aFecha(h.fechaAprobacion))}</td>
      <td>${h.comprobanteURL
        ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(h.comprobanteURL)}')">Ver</button>`
        : '—'}</td>
    </tr>`).join('');
}

/* ══════════════════════════════════════════════════════
   RENDER — ACTIVIDAD
   ══════════════════════════════════════════════════════ */
function renderActividad() {
  const tb = document.getElementById('tablaActividad');
  if (!actividad.length) { tb.innerHTML = '<tr><td colspan="5" class="empty">No hay actividad registrada</td></tr>'; return; }
  tb.innerHTML = actividad.slice(0, 200).map(a => `
    <tr>
      <td>${fmtFechaHora(aFecha(a.fecha))}</td>
      <td>${escapeHtml(a.adminEmail || a.adminNombre || '—')}</td>
      <td><strong>${escapeHtml(a.accion || '—')}</strong></td>
      <td>${escapeHtml(a.usuarioAfectadoNombre || a.usuarioAfectadoCorreo || '—')}</td>
      <td style="font-size:12px;color:var(--text2)">${escapeHtml(a.detalles?.motivo || a.detalles?.detalle || JSON.stringify(a.detalles || {}))}</td>
    </tr>`).join('');
}

/* ══════════════════════════════════════════════════════
   VER COMPROBANTE
   ══════════════════════════════════════════════════════ */
window.verComprobante = async (url) => {
  const cont = document.getElementById('imgViewer');
  cont.innerHTML = '<div class="loading-full">Cargando imagen...</div>';
  openModal('modalImg');
  const img = new Image();
  img.onload = () => { cont.innerHTML = ''; cont.appendChild(img); };
  img.onerror = () => { cont.innerHTML = '<div class="empty">❌ No se pudo cargar la imagen</div>'; };
  img.src = url;
  img.style.cssText = 'width:100%;border-radius:10px;display:block;background:#000';
};

/* ══════════════════════════════════════════════════════
   CONFIRMACIÓN GENÉRICA
   ══════════════════════════════════════════════════════ */
let _confirmCb = null;
function confirmar(titulo, texto, onOk, extraHTML = '', textoOk = 'Confirmar', tipoOk = 'primary') {
  document.getElementById('confirmTitle').textContent = titulo;
  document.getElementById('confirmText').innerHTML = texto;
  document.getElementById('confirmExtra').innerHTML = extraHTML;
  const btnOk = document.getElementById('confirmOk');
  btnOk.textContent = textoOk;
  btnOk.className = 'btn btn-' + (tipoOk === 'danger' ? 'danger' : 'primary');
  _confirmCb = onOk;
  openModal('modalConfirm');
}
document.getElementById('confirmCancel').onclick = () => { closeModal('modalConfirm'); _confirmCb = null; };
document.getElementById('confirmOk').onclick = async () => {
  if (_confirmCb) {
    const cb = _confirmCb;
    _confirmCb = null;
    closeModal('modalConfirm');
    await cb();
  }
};

/* ══════════════════════════════════════════════════════
   APROBAR PAGO
   ══════════════════════════════════════════════════════ */
window.aprobarPago = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return toast('No se encontró la suscripción', 'error');

  confirmar(
    '✅ Aprobar pago',
    `¿Estás seguro de que deseas aprobar este pago y activar la suscripción de <strong>${escapeHtml(s.nombre || s.correo)}</strong>?<br><br>
     Plan: <strong>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</strong> — ${fmtDinero(s.precio)}`,
    async () => {
      try {
        const ahora = new Date();
        const venc = new Date(ahora);
        const cfg = s.plan === 'anual' ? configPlanes.anual : configPlanes.mensual;
        venc.setMonth(venc.getMonth() + (cfg.meses || (s.plan === 'anual' ? 12 : 1)));

        await updateDoc(doc(db, 'suscripciones', uid), {
          estado: 'activa',
          fechaInicio: Timestamp.fromDate(ahora),
          fechaVencimiento: Timestamp.fromDate(venc),
          resueltoPor: adminActual.email,
          fechaResolucion: serverTimestamp()
        });

        await addDoc(collection(db, 'historial_pagos', uid, 'pagos'), {
          ...s,
          estado: 'activa',
          resueltoPor: adminActual.email,
          fechaAprobacion: serverTimestamp(),
          fechaInicio: Timestamp.fromDate(ahora),
          fechaVencimiento: Timestamp.fromDate(venc)
        });

        await registrarActividad('Aprobó un pago', s, {
          plan: s.plan, precio: s.precio,
          vencimiento: venc.toISOString()
        });

        toast('✅ Pago aprobado y suscripción activada');
        await cargarTodo();
      } catch (e) {
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    },
    '',
    'Sí, aprobar',
    'primary'
  );
};

/* ══════════════════════════════════════════════════════
   RECHAZAR PAGO
   ══════════════════════════════════════════════════════ */
window.rechazarPago = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return toast('No se encontró la suscripción', 'error');

  confirmar(
    '❌ Rechazar pago',
    `Rechazar la solicitud de <strong>${escapeHtml(s.nombre || s.correo)}</strong>?<br><br>
     Escribe el motivo (quedará guardado):`,
    async () => {
      const motivo = document.getElementById('motivoRechazo').value.trim() || 'Sin motivo especificado';
      try {
        await updateDoc(doc(db, 'suscripciones', uid), {
          estado: 'rechazada',
          motivoRechazo: motivo,
          resueltoPor: adminActual.email,
          fechaResolucion: serverTimestamp()
        });

        await addDoc(collection(db, 'historial_pagos', uid, 'pagos'), {
          ...s,
          estado: 'rechazada',
          motivoRechazo: motivo,
          resueltoPor: adminActual.email,
          fechaAprobacion: serverTimestamp()
        });

        await registrarActividad('Rechazó un pago', s, { motivo });
        toast('Pago rechazado');
        await cargarTodo();
      } catch (e) {
        console.error(e);
        toast('Error: ' + e.message, 'error');
      }
    },
    `<label class="cfg-label" style="margin-top:12px">Motivo del rechazo</label>
     <textarea id="motivoRechazo" class="cfg-textarea" placeholder="Ej: Comprobante no válido, monto incorrecto..."></textarea>`,
    'Sí, rechazar',
    'danger'
  );
};

/* ══════════════════════════════════════════════════════
   DETALLE
   ══════════════════════════════════════════════════════ */
window.verDetalle = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return toast('No se encontró', 'error');

  const venc = aFecha(s.fechaVencimiento);
  const dias = diasRestantes(venc);

  document.getElementById('detalleContenido').innerHTML = `
    <h3 style="margin-top:0">👤 Información del usuario</h3>
    <div class="info-grid">
      <div class="info-item"><label>Nombre</label><span>${escapeHtml(s.nombre || '—')}</span></div>
      <div class="info-item"><label>Correo</label><span>${escapeHtml(s.correo || '—')}</span></div>
      <div class="info-item"><label>UID</label><span style="font-family:monospace;font-size:12px">${escapeHtml(s.uid || '—')}</span></div>
      <div class="info-item"><label>Teléfono</label><span>${escapeHtml(s.telefono || '—')}</span></div>
    </div>
    <h3>💳 Información de suscripción</h3>
    <div class="info-grid">
      <div class="info-item"><label>Plan</label><span>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</span></div>
      <div class="info-item"><label>Precio</label><span>${fmtDinero(s.precio)}</span></div>
      <div class="info-item"><label>Estado</label><span class="badge ${s._estadoEfectivo}">${s._estadoEfectivo}</span></div>
      <div class="info-item"><label>Días restantes</label><span>${s._estadoEfectivo === 'activa' ? dias + ' días' : '—'}</span></div>
      <div class="info-item"><label>Fecha de inicio</label><span>${fmtFecha(aFecha(s.fechaInicio))}</span></div>
      <div class="info-item"><label>Fecha de vencimiento</label><span>${fmtFecha(venc)}</span></div>
      <div class="info-item"><label>Fecha solicitud</label><span>${fmtFecha(aFecha(s.fechaSolicitud))}</span></div>
      <div class="info-item"><label>Comprobante</label><span>${s.comprobanteURL ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(s.comprobanteURL)}')">Ver imagen</button>` : 'Sin comprobante'}</span></div>
    </div>
    ${s.motivoRechazo ? `<div style="background:#3a2a00;color:#ffd76a;border:1px solid #5a4b00;border-radius:10px;padding:12px;margin:10px 0;font-size:14px">Motivo rechazo: ${escapeHtml(s.motivoRechazo)}</div>` : ''}

    <h3>⚙️ Acciones administrativas</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${s._estadoEfectivo === 'pendiente' ? `
        <button class="btn btn-primary btn-sm" onclick="closeModal('modalDetalle');aprobarPago('${s.uid}')">✅ Aprobar pago</button>
        <button class="btn btn-danger btn-sm" onclick="closeModal('modalDetalle');rechazarPago('${s.uid}')">❌ Rechazar pago</button>
      ` : ''}
      <button class="btn btn-primary btn-sm" onclick="closeModal('modalDetalle');abrirActivar('${s.uid}')">🔓 Activar manualmente</button>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('modalDetalle');abrirRenovar('${s.uid}')">🔄 Renovar</button>
      <button class="btn btn-warn btn-sm" onclick="closeModal('modalDetalle');cambiarFecha('${s.uid}')">📅 Cambiar vencimiento</button>
      ${s._estadoEfectivo === 'activa' ? `
        <button class="btn btn-danger btn-sm" onclick="closeModal('modalDetalle');suspender('${s.uid}')">🚫 Suspender acceso</button>
      ` : ''}
    </div>
  `;
  openModal('modalDetalle');
};

/* ══════════════════════════════════════════════════════
   ACTIVAR MANUALMENTE
   ══════════════════════════════════════════════════════ */
window.abrirActivar = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return;
  document.getElementById('activarUser').innerHTML = `Activar suscripción de <strong>${escapeHtml(s.nombre || s.correo)}</strong>`;
  document.getElementById('activarPlan').value = s.plan || 'mensual';
  document.getElementById('activarMotivo').value = '';
  document.getElementById('activarOk').onclick = () => activarManual(s.uid);
  openModal('modalActivar');
};

async function activarManual(uid) {
  const motivo = document.getElementById('activarMotivo').value.trim();
  if (!motivo) return toast('Escribe el motivo de la activación', 'error');

  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  const plan = document.getElementById('activarPlan').value;
  const cfg = plan === 'anual' ? configPlanes.anual : configPlanes.mensual;

  try {
    const ahora = new Date();
    const venc = new Date(ahora);
    venc.setMonth(venc.getMonth() + (cfg.meses || (plan === 'anual' ? 12 : 1)));

    await updateDoc(doc(db, 'suscripciones', uid), {
      estado: 'activa',
      plan,
      precio: cfg.precio,
      fechaInicio: Timestamp.fromDate(ahora),
      fechaVencimiento: Timestamp.fromDate(venc),
      activacionManual: true,
      motivoActivacion: motivo,
      resueltoPor: adminActual.email,
      fechaResolucion: serverTimestamp()
    });

    await addDoc(collection(db, 'historial_pagos', uid, 'pagos'), {
      ...s, plan, precio: cfg.precio, estado: 'activa',
      activacionManual: true, motivoActivacion: motivo,
      resueltoPor: adminActual.email,
      fechaAprobacion: serverTimestamp(),
      fechaInicio: Timestamp.fromDate(ahora),
      fechaVencimiento: Timestamp.fromDate(venc)
    });

    await registrarActividad('Activó manualmente', s, { plan, motivo });
    closeModal('modalActivar');
    toast('✅ Suscripción activada manualmente');
    await cargarTodo();
  } catch (e) { console.error(e); toast('Error: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════════════════════
   RENOVAR
   ══════════════════════════════════════════════════════ */
window.abrirRenovar = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return;
  document.getElementById('renovarUser').innerHTML = `Renovar suscripción de <strong>${escapeHtml(s.nombre || s.correo)}</strong>`;
  document.getElementById('renovarPlan').value = s.plan || 'mensual';
  document.getElementById('renovarMotivo').value = '';
  document.getElementById('renovarOk').onclick = () => renovar(s.uid);
  openModal('modalRenovar');
};

async function renovar(uid) {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  const plan = document.getElementById('renovarPlan').value;
  const motivo = document.getElementById('renovarMotivo').value.trim() || 'Renovación manual';
  const cfg = plan === 'anual' ? configPlanes.anual : configPlanes.mensual;

  try {
    const baseActual = aFecha(s.fechaVencimiento);
    const base = (s._estadoEfectivo === 'activa' && baseActual && baseActual > new Date())
      ? new Date(baseActual) : new Date();

    const nuevoVenc = new Date(base);
    nuevoVenc.setMonth(nuevoVenc.getMonth() + (cfg.meses || (plan === 'anual' ? 12 : 1)));

    await updateDoc(doc(db, 'suscripciones', uid), {
      estado: 'activa',
      plan,
      precio: cfg.precio,
      fechaInicio: s.fechaInicio || Timestamp.fromDate(new Date()),
      fechaVencimiento: Timestamp.fromDate(nuevoVenc),
      resueltoPor: adminActual.email,
      fechaResolucion: serverTimestamp()
    });

    await addDoc(collection(db, 'historial_pagos', uid, 'pagos'), {
      ...s, plan, precio: cfg.precio, estado: 'activa',
      motivoRenovacion: motivo,
      resueltoPor: adminActual.email,
      fechaAprobacion: serverTimestamp(),
      fechaInicio: s.fechaInicio || Timestamp.fromDate(new Date()),
      fechaVencimiento: Timestamp.fromDate(nuevoVenc)
    });

    await registrarActividad('Renovó una suscripción', s, {
      plan, precio: cfg.precio, nuevoVencimiento: nuevoVenc.toISOString(), motivo
    });
    closeModal('modalRenovar');
    toast('✅ Suscripción renovada');
    await cargarTodo();
  } catch (e) { console.error(e); toast('Error: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════════════════════
   CAMBIAR FECHA
   ══════════════════════════════════════════════════════ */
window.cambiarFecha = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return;
  const actual = aFecha(s.fechaVencimiento);
  const actualStr = actual ? actual.toISOString().slice(0,10) : '';

  confirmar(
    '📅 Cambiar fecha de vencimiento',
    `Usuario: <strong>${escapeHtml(s.nombre || s.correo)}</strong><br>Fecha actual: <strong>${fmtFecha(actual)}</strong>`,
    async () => {
      const nueva = document.getElementById('fechaNueva').value;
      const motivo = document.getElementById('fechaMotivo').value.trim() || 'Ajuste manual';
      if (!nueva) return toast('Selecciona una fecha', 'error');
      try {
        const fechaObj = new Date(nueva + 'T23:59:59');
        await updateDoc(doc(db, 'suscripciones', uid), {
          fechaVencimiento: Timestamp.fromDate(fechaObj),
          resueltoPor: adminActual.email,
          fechaResolucion: serverTimestamp()
        });
        await registrarActividad('Cambió fecha de vencimiento', s, {
          nuevaFecha: fechaObj.toISOString(), motivo
        });
        toast('Fecha actualizada');
        await cargarTodo();
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    },
    `<label class="cfg-label" style="margin-top:12px">Nueva fecha</label>
     <input type="date" id="fechaNueva" class="cfg-input" value="${actualStr}">
     <label class="cfg-label">Motivo</label>
     <textarea id="fechaMotivo" class="cfg-textarea"></textarea>`,
    'Guardar'
  );
};

/* ══════════════════════════════════════════════════════
   SUSPENDER
   ══════════════════════════════════════════════════════ */
window.suspender = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return;
  confirmar(
    '🚫 Suspender acceso',
    `¿Suspender el acceso de <strong>${escapeHtml(s.nombre || s.correo)}</strong>?<br><br>El usuario dejará de tener acceso a las funciones premium.`,
    async () => {
      try {
        await updateDoc(doc(db, 'suscripciones', uid), {
          estado: 'expirada',
          motivoSuspension: 'Suspendida por administrador',
          resueltoPor: adminActual.email,
          fechaResolucion: serverTimestamp()
        });
        await registrarActividad('Suspendió una suscripción', s, {});
        toast('Suscripción suspendida');
        await cargarTodo();
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    },
    '',
    'Sí, suspender',
    'danger'
  );
};

/* ══════════════════════════════════════════════════════
   BUSCADOR DE USUARIOS
   ══════════════════════════════════════════════════════ */
document.getElementById('searchUsuarios').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const cont = document.getElementById('resultadoUsuarios');
  if (!q) { cont.className = 'empty'; cont.textContent = 'Escribe algo para buscar usuarios'; return; }

  const resultados = suscripciones.filter(s =>
    (s.nombre || '').toLowerCase().includes(q) ||
    (s.correo || '').toLowerCase().includes(q) ||
    (s.uid || '').toLowerCase().includes(q) ||
    (s.telefono || '').toLowerCase().includes(q)
  );

  if (!resultados.length) { cont.className = 'empty'; cont.textContent = 'No se encontraron usuarios'; return; }
  cont.className = '';
  cont.innerHTML = `<div class="table-wrap"><div class="table-scroll"><table>
    <thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Plan</th><th>Estado</th><th>Acciones</th></tr></thead>
    <tbody>${resultados.map(s => `
      <tr>
        <td>${escapeHtml(s.nombre || '—')}</td>
        <td>${escapeHtml(s.correo || '—')}</td>
        <td>${escapeHtml(s.telefono || '—')}</td>
        <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
        <td><span class="badge ${s._estadoEfectivo}">${s._estadoEfectivo}</span></td>
        <td><button class="btn btn-ghost btn-xs" onclick="verDetalle('${s.uid}')">👁️ Ver detalle</button></td>
      </tr>`).join('')}</tbody>
  </table></div></div>`;
});

/* ══════════════════════════════════════════════════════
   FILTROS
   ══════════════════════════════════════════════════════ */
document.getElementById('searchSolicitudes').addEventListener('input', e => renderSolicitudes(e.target.value));
document.getElementById('searchActivas').addEventListener('input', e => renderActivas(e.target.value));
document.getElementById('searchHistorial').addEventListener('input', e => renderHistorial(e.target.value));

/* ══════════════════════════════════════════════════════
   REFRESH
   ══════════════════════════════════════════════════════ */
['refreshDash','refreshSolicitudes','refreshActivas'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', async () => {
    toast('Actualizando...');
    await cargarTodo();
    toast('✅ Actualizado');
  });
});

/* ══════════════════════════════════════════════════════
   GUARDAR CONFIGS
   ══════════════════════════════════════════════════════ */
document.getElementById('saveConfigPagos').addEventListener('click', async () => {
  try {
    const datos = {
      banco: document.getElementById('cfgBanco').value.trim(),
      titular: document.getElementById('cfgTitular').value.trim(),
      clabe: document.getElementById('cfgClabe').value.trim(),
      cuenta: document.getElementById('cfgCuenta').value.trim(),
      whatsappSoporte: document.getElementById('cfgWhats').value.trim(),
      instrucciones: document.getElementById('cfgInstrucciones').value.trim()
    };
    await setDoc(doc(db, 'config', 'pagos'), datos, { merge: true });
    await registrarActividad('Modificó los datos de pago', null, datos);
    toast('✅ Datos de pago guardados');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
});

document.getElementById('saveConfigPlanes').addEventListener('click', async () => {
  try {
    const datos = {
      mensual: {
        precio: parseFloat(document.getElementById('cfgMensualPrecio').value) || 399.90,
        meses: parseInt(document.getElementById('cfgMensualDur').value) || 1
      },
      anual: {
        precio: parseFloat(document.getElementById('cfgAnualPrecio').value) || 500.00,
        meses: parseInt(document.getElementById('cfgAnualDur').value) || 12
      }
    };
    await setDoc(doc(db, 'config', 'planes'), datos, { merge: true });
    await registrarActividad('Modificó los planes', null, datos);
    toast('✅ Planes guardados');
    await cargarConfigs();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
});
