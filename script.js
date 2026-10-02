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

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
const aFecha = t => t?.toDate ? t.toDate() : (t ? new Date(t) : null);
const fmtFecha = f => f ? f.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtFechaHora = f => f ? f.toLocaleString('es-MX', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '—';
const fmtDinero = n => '$' + Number(n || 0).toLocaleString('es-MX', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}) + ' MXN';
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const diasRestantes = venc => venc ? Math.ceil((venc - new Date()) / 86400000) : 0;

/* Mapeo estado → label visual */
const ESTADOS = {
  pendiente: { label: '🟡 Pago en revisión', badge: 'pendiente' },
  activa:    { label: '🟢 Pago aprobado',    badge: 'activa' },
  rechazada: { label: '🔴 Pago rechazado',   badge: 'rechazada' }
};

function labelEstado(estado) {
  return ESTADOS[estado]?.label || '🟡 Pago en revisión';
}

/* Convierte link de Dropbox a modo directo */
function dropboxDirecto(url) {
  if (!url) return '';
  return url.trim()
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('?dl=0', '').replace('?dl=1', '')
    .replace('&dl=0', '').replace('&dl=1', '')
    .replace('?raw=1', '');
}

/* Toast */
function toast(msg, tipo = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (tipo === 'error' ? ' error' : tipo === 'warn' ? ' warn' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

/* Modales */
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

  // ⚠️ SIN verificación de admin — cualquier cuenta Google entra
  adminActual = user;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').classList.add('active');
  document.getElementById('userEmail').textContent = user.email || '';
  document.getElementById('userPic').src = user.photoURL || '';

  // Escuchar suscripciones en tiempo real
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

    // Calcular estado efectivo (si está activa pero vencida → expirada visual)
    const ahora = new Date();
    suscripciones.forEach(s => {
      if (s.estado === 'activa') {
        const v = aFecha(s.fechaVencimiento);
        s._estadoEfectivo = (v && ahora >= v) ? 'expirada' : 'activa';
      } else {
        s._estadoEfectivo = s.estado || 'pendiente';
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
  renderSolicitudes();
  renderActivas();
  renderPorVencer();
  renderExpiradas();
  renderHistorial();
  actualizarContadoresMenu();
}

function actualizarContadoresMenu() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente').length;
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa').length;
  document.getElementById('cntPendientes').textContent = pend;
  document.getElementById('cntActivas').textContent = act;
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════ */
function renderDashboard() {
  const pend = suscripciones.filter(s => s._estadoEfectivo === 'pendiente');
  const act  = suscripciones.filter(s => s._estadoEfectivo === 'activa');
  const porV = act.filter(s => {
    const d = diasRestantes(aFecha(s.fechaVencimiento));
    return d >= 0 && d <= 7;
  });
  const exp  = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const apro = suscripciones.filter(s => s.estado === 'activa').length;
  const rech = suscripciones.filter(s => s.estado === 'rechazada').length;
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

  const recientes = [...suscripciones].sort((a, b) => {
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

/* ═══════════════════════════════════════════════════════════
   SOLICITUDES (pendientes + todas)
   ═══════════════════════════════════════════════════════════ */
function renderSolicitudes(filtro = '') {
  const q = filtro.toLowerCase().trim();
  let lista = suscripciones;

  if (q) {
    lista = lista.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.correo || '').toLowerCase().includes(q) ||
      (s.uid || '').toLowerCase().includes(q)
    );
  }

  lista.sort((a, b) => {
    const fa = aFecha(b.fechaSolicitud)?.getTime() || 0;
    const fb = aFecha(a.fechaSolicitud)?.getTime() || 0;
    return fa - fb;
  });

  const tb = document.getElementById('tablaSolicitudes');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">No hay solicitudes registradas</td></tr>';
    return;
  }

  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td style="font-family:monospace;font-size:11px">${escapeHtml(s.uid || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtDinero(s.precio)}</td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
      <td>
        <select class="estado-select" data-uid="${escapeHtml(s.uid)}" data-estado="${escapeHtml(s.estado || 'pendiente')}">
          <option value="pendiente" ${s.estado === 'pendiente' ? 'selected' : ''}>🟡 Pago en revisión</option>
          <option value="activa" ${s.estado === 'activa' ? 'selected' : ''}>🟢 Pago aprobado</option>
          <option value="rechazada" ${s.estado === 'rechazada' ? 'selected' : ''}>🔴 Pago rechazado</option>
        </select>
      </td>
      <td>
        ${s.comprobante
          ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(s.uid)}')">👁️ Ver</button>`
          : '<span style="color:var(--text2);font-size:11px">Sin comprobante</span>'}
      </td>
    </tr>
  `).join('');

  tb.querySelectorAll('.estado-select').forEach(sel => {
    sel.addEventListener('change', () => {
      cambiarEstado(sel.dataset.uid, sel.value, sel);
    });
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
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">No hay suscripciones activas</td></tr>';
    return;
  }
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
        <td><span class="badge activa">🟢 Pago aprobado</span></td>
        <td>
          <select class="estado-select" data-uid="${escapeHtml(s.uid)}" data-estado="${escapeHtml(s.estado)}">
            <option value="pendiente" ${s.estado === 'pendiente' ? 'selected' : ''}>🟡 Pago en revisión</option>
            <option value="activa" ${s.estado === 'activa' ? 'selected' : ''}>🟢 Pago aprobado</option>
            <option value="rechazada" ${s.estado === 'rechazada' ? 'selected' : ''}>🔴 Pago rechazado</option>
          </select>
        </td>
      </tr>`;
  }).join('');
  tb.querySelectorAll('.estado-select').forEach(sel => {
    sel.addEventListener('change', () => cambiarEstado(sel.dataset.uid, sel.value, sel));
  });
}

function renderPorVencer() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'activa')
    .filter(s => {
      const d = diasRestantes(aFecha(s.fechaVencimiento));
      return d >= 0 && d <= 7;
    })
    .sort((a, b) => diasRestantes(aFecha(a.fechaVencimiento)) - diasRestantes(aFecha(b.fechaVencimiento)));

  const tb = document.getElementById('tablaPorVencer');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones próximas a vencer</td></tr>';
    return;
  }
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
          <select class="estado-select" data-uid="${escapeHtml(s.uid)}" data-estado="${escapeHtml(s.estado)}">
            <option value="pendiente" ${s.estado === 'pendiente' ? 'selected' : ''}>🟡 Pago en revisión</option>
            <option value="activa" ${s.estado === 'activa' ? 'selected' : ''}>🟢 Pago aprobado</option>
            <option value="rechazada" ${s.estado === 'rechazada' ? 'selected' : ''}>🔴 Pago rechazado</option>
          </select>
        </td>
      </tr>`;
  }).join('');
  tb.querySelectorAll('.estado-select').forEach(sel => {
    sel.addEventListener('change', () => cambiarEstado(sel.dataset.uid, sel.value, sel));
  });
}

function renderExpiradas() {
  const lista = suscripciones.filter(s => s._estadoEfectivo === 'expirada');
  const tb = document.getElementById('tablaExpiradas');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">No hay suscripciones expiradas</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtFecha(aFecha(s.fechaInicio))}</td>
      <td>${fmtFecha(aFecha(s.fechaVencimiento))}</td>
      <td>
        <select class="estado-select" data-uid="${escapeHtml(s.uid)}" data-estado="${escapeHtml(s.estado)}">
          <option value="pendiente" ${s.estado === 'pendiente' ? 'selected' : ''}>🟡 Pago en revisión</option>
          <option value="activa" ${s.estado === 'activa' ? 'selected' : ''}>🟢 Pago aprobado</option>
          <option value="rechazada" ${s.estado === 'rechazada' ? 'selected' : ''}>🔴 Pago rechazado</option>
        </select>
      </td>
    </tr>`).join('');
  tb.querySelectorAll('.estado-select').forEach(sel => {
    sel.addEventListener('change', () => cambiarEstado(sel.dataset.uid, sel.value, sel));
  });
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
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">No hay pagos en el historial</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(s => `
    <tr>
      <td>${escapeHtml(s.nombre || '—')}</td>
      <td>${escapeHtml(s.correo || '—')}</td>
      <td>${s.plan === 'anual' ? 'Anual' : 'Mensual'}</td>
      <td>${fmtDinero(s.precio)}</td>
      <td>${fmtFecha(aFecha(s.fechaSolicitud))}</td>
      <td><span class="badge ${s.estado}">${labelEstado(s.estado)}</span></td>
      <td>${escapeHtml(s.resueltoPor || '—')}</td>
      <td>${fmtFecha(aFecha(s.fechaResolucion || s.fechaAprobacion))}</td>
      <td>${s.comprobante
        ? `<button class="btn btn-ghost btn-xs" onclick="verComprobante('${escapeHtml(s.uid)}')">👁️ Ver</button>`
        : '—'}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   VER COMPROBANTE (Dropbox)
   ═══════════════════════════════════════════════════════════ */
window.verComprobante = (uid) => {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const urlOriginal = s.comprobante || s.comprobanteURL;
  if (!urlOriginal) {
    toast('Esta suscripción no tiene comprobante registrado', 'warn');
    return;
  }

  const cont = document.getElementById('imgViewer');
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
   CAMBIAR ESTADO (ÚNICA ACCIÓN PERMITIDA)
   ═══════════════════════════════════════════════════════════ */
async function cambiarEstado(uid, nuevoEstado, selElement) {
  const s = suscripciones.find(x => x.uid === uid || x._id === uid);
  if (!s) return toast('No se encontró la suscripción', 'error');

  const estadoAnterior = s.estado || 'pendiente';
  if (estadoAnterior === nuevoEstado) return;

  const etiquetaNuevo = labelEstado(nuevoEstado);
  const etiquetaAnterior = labelEstado(estadoAnterior);

  const ok = confirm(
    `¿Cambiar el estado de "${s.nombre || s.correo}"?\n\n` +
    `De: ${etiquetaAnterior}\n` +
    `A:  ${etiquetaNuevo}`
  );

  if (!ok) {
    if (selElement) selElement.value = estadoAnterior;
    return;
  }

  try {
    if (selElement) selElement.disabled = true;

    await updateDoc(doc(db, 'suscripciones', uid), {
      estado: nuevoEstado,
      resueltoPor: adminActual.email,
      fechaResolucion: serverTimestamp()
    });

    try {
      await addDoc(collection(db, 'actividad_admin'), {
        adminUID: adminActual.uid,
        adminEmail: adminActual.email,
        adminNombre: adminActual.displayName || '',
        accion: 'Cambió estado',
        usuarioAfectadoUID: s.uid || '',
        usuarioAfectadoNombre: s.nombre || '',
        usuarioAfectadoCorreo: s.correo || '',
        detalles: {
          estadoAnterior,
          estadoNuevo: nuevoEstado,
          etiqueta: etiquetaNuevo
        },
        fecha: serverTimestamp()
      });
    } catch (e) { console.warn('No se pudo registrar actividad:', e); }

    toast(`✅ Estado actualizado: ${etiquetaNuevo}`);

  } catch (e) {
    console.error('Error al cambiar estado:', e);
    toast('Error: ' + e.message, 'error');
    if (selElement) selElement.value = estadoAnterior;
  } finally {
    if (selElement) selElement.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════
   BUSCADORES
   ═══════════════════════════════════════════════════════════ */
document.getElementById('searchSolicitudes')?.addEventListener('input', e => renderSolicitudes(e.target.value));
document.getElementById('searchActivas')?.addEventListener('input', e => renderActivas(e.target.value));
document.getElementById('searchHistorial')?.addEventListener('input', e => renderHistorial(e.target.value));

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
