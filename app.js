import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore, collection, doc, updateDoc,
  onSnapshot, query, orderBy, where, getDoc, setDoc, getDocs, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ═══════════════════════════════════════════════════════
   BARBOSAFOODS — app.js
═══════════════════════════════════════════════════════ */

/* ── Firebase ── */
const firebaseConfig = {
  apiKey: "AIzaSyD9m9ULOrqYswGlT0xwiUylgFTbZDwvMvw",
  authDomain: "barbosafoods-5bb86.firebaseapp.com",
  projectId: "barbosafoods-5bb86",
  storageBucket: "barbosafoods-5bb86.firebasestorage.app",
  messagingSenderId: "101534719657",
  appId: "1:101534719657:web:910493ca21a435b88713b8",
  measurementId: "G-VZRE9CSQS4"
};

const firebaseApp  = initializeApp(firebaseConfig);
const auth         = getAuth(firebaseApp);
const db           = getFirestore(firebaseApp);
const pedidosRef   = collection(db, "pedidos");
const usuariosRef  = collection(db, "usuarios");

/* ── E-mails com acesso ao admin ─────────────────────────
   Adicione aqui os e-mails que podem ver o painel admin.
   Qualquer outro e-mail autenticado vai para a tela de pedido.
────────────────────────────────────────────────────────── */
const ADMIN_EMAILS = [
  "vitorjoseg4@gmail.com"
];

/* ══════════════════════════════════════
   TURMAS — agrupadas por curso
══════════════════════════════════════ */
const TURMAS_GRUPOS = [
  {
    grupo: 'Ensino Médio',
    turmas: ['1°EM', '2°A EM', '2°B EM', '2°C EM', '3°A EM', '3°B EM']
  },
  {
    grupo: 'Desenvolvimento de Sistemas',
    turmas: ['1°DS', '2°DS', '3°DS']
  },
  {
    grupo: 'Finanças / Administração',
    turmas: ['1°FD', '2°FD', '3°FD']
  },
  {
    grupo: 'Estética',
    turmas: ['1°EST', '2°EST', '3°EST']
  }
];

/* ══════════════════════════════════════
   ESTADO
══════════════════════════════════════ */
const BREAD_PRICES    = { medio: 10, grande: 15 };
const SODA_PRICE      = 5.00;
const MAX_COMPS_MEDIO = 3;
const MAX_SODAS       = 3;
const MAX_SWEETS      = 10;
const MAX_ORDERS_PER_USER = 3;

const SWEETS = {
  canudo_frito: { name: 'Canudo frito', price: 1.00, icon: '🥐' },
  barrinha_cereal: { name: 'Barrinha de cereal', price: 3.00, icon: '🍫' },
  brownie_chocolate: { name: 'Brownie de chocolate', price: 5.00, icon: '🍩' }
};

const SODA_CUP_ICON = `
  <svg class="soda-cup-art" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path class="soda-cup-straw" d="M31 4l7-2 1.4 4.4-5.7 1.7-3 27.9h-4L31 4z"/>
    <path class="soda-cup-lid" d="M12 13h24l-1.5 5h-21L12 13z"/>
    <path class="soda-cup-body" d="M15 18h18l-2.2 24H17.2L15 18z"/>
    <circle class="soda-cup-bubble" cx="23" cy="27" r="2.2"/>
    <circle class="soda-cup-bubble" cx="28" cy="33" r="1.8"/>
  </svg>
`;

let selectedTurma   = null;
let selectedBread   = null;
let selectedPayment = null;
let selectedJuice   = null;   // suco grátis (string ou null)
let sodaCart        = [];     // array de strings, ex: ['Guaraná Zero', 'Coca Zero']
let sweetCart       = { canudo_frito: 0, barrinha_cereal: 0, brownie_chocolate: 0 };
let currentFilter   = 'todos';
let currentTurmaFilter = 'todas';
let allOrders       = [];
let currentUser     = null;
let currentProfile  = null;
let isAdmin         = false;
let unsubOrders     = null;

/* ══════════════════════════════════════
   UTILITÁRIOS
══════════════════════════════════════ */
function fmtBRL(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function isValidTurma(turma) {
  return TURMAS_GRUPOS.some(g => g.turmas.includes(turma));
}

function isValidName(nome) {
  return normalizeName(nome).length >= 3;
}

function getSelectedComps() {
  return Array.from(document.querySelectorAll('.comp-item.selected'));
}

function getSelectedSauces() {
  return Array.from(document.querySelectorAll('.sauce-item.selected')).map(el => el.dataset.sauce);
}

function getSweetEntries() {
  return Object.entries(sweetCart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty, ...SWEETS[id] }));
}

function getTotalSweets() {
  return Object.values(sweetCart).reduce((sum, qty) => sum + qty, 0);
}

function getProfileName() {
  return currentProfile && currentProfile.nome ? currentProfile.nome.trim() : '';
}

function isOrderOpen(o) {
  return o && o.status !== 'pago' && o.status !== 'cancelado';
}

function countValidOrders(orders) {
  // Conta todos os pedidos criados pelo usuário, inclusive cancelados.
  // Isso evita spam de criar/cancelar para burlar o limite de 3 pedidos.
  return orders.filter(Boolean).length;
}

function getOpenOrder(orders) {
  return orders.find(o => isOrderOpen(o));
}

function analyzeOrderPermission(orders) {
  const userOrders = orders.filter(Boolean);
  const openOrder = getOpenOrder(userOrders);

  if (openOrder) {
    return {
      podePedir: false,
      motivo: `Você tem um pedido aguardando pagamento (${fmtBRL(openOrder.total)}). Pague primeiro para fazer outro.`,
      pedidos: userOrders,
      openOrder
    };
  }

  if (userOrders.length >= MAX_ORDERS_PER_USER) {
    return {
      podePedir: false,
      motivo: `Você já atingiu o limite de ${MAX_ORDERS_PER_USER} pedidos nesta conta.`,
      pedidos: userOrders,
      openOrder: null
    };
  }

  return { podePedir: true, motivo: '', pedidos: userOrders, openOrder: null };
}

function pedidosDoAluno(nome, turma) {
  // Segurança/LGPD: na tela do aluno, allOrders só contém pedidos do UID logado.
  // Não cruzamos mais por nome+turma, porque isso permitiria exposição/bloqueio por identidade digitada.
  return allOrders.filter(o => currentUser && o.userUid === currentUser.uid);
}

function statusAluno(nome, turma) {
  return analyzeOrderPermission(pedidosDoAluno(nome, turma));
}

async function fetchMyOrdersOnce() {
  if (!currentUser) return [];
  const q = query(
    pedidosRef,
    where('userUid', '==', currentUser.uid)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}


/* ══════════════════════════════════════
   PERFIL DO USUÁRIO — Firestore /usuarios/{uid}
══════════════════════════════════════ */
async function loadUserProfile(user) {
  if (!user) { currentProfile = null; return; }

  const ref = doc(db, 'usuarios', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      currentProfile = { uid: user.uid, ...snap.data() };
      await setDoc(ref, {
        email: user.email || '',
        photoURL: user.photoURL || '',
        googleDisplayName: user.displayName || '',
        activeOrderId: currentProfile.activeOrderId || null,
        totalPedidosCriados: Number.isInteger(currentProfile.totalPedidosCriados) ? currentProfile.totalPedidosCriados : 0,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } else {
      currentProfile = {
        uid: user.uid,
        nome: '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        googleDisplayName: user.displayName || '',
        activeOrderId: null,
        totalPedidosCriados: 0
      };
      await setDoc(ref, {
        nome: '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        googleDisplayName: user.displayName || '',
        activeOrderId: null,
        totalPedidosCriados: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
    applyProfileNameToForm();
    renderProfileOrders();
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
  }
}

function applyProfileNameToForm() {
  const input = document.getElementById('customer-name');
  const hint = document.getElementById('locked-name-hint');
  if (!input) return;

  const savedName = getProfileName();
  if (savedName) {
    input.value = savedName;
    input.readOnly = true;
    input.classList.add('name-locked');
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'Nome salvo no seu perfil. Para alterar, toque na sua foto no topo.';
    }
  } else {
    input.readOnly = false;
    input.classList.remove('name-locked');
    if (hint) hint.style.display = 'none';
    if (currentUser && !input.value.trim()) input.value = currentUser.displayName || '';
  }
}

async function saveProfileName(nome) {
  if (!currentUser) return;
  const clean = normalizeName(nome);
  if (!isValidName(clean)) return;
  const ref = doc(db, 'usuarios', currentUser.uid);
  await setDoc(ref, {
    nome: clean,
    email: currentUser.email || '',
    photoURL: currentUser.photoURL || '',
    googleDisplayName: currentUser.displayName || '',
    updatedAt: new Date().toISOString()
  }, { merge: true });
  currentProfile = { ...(currentProfile || {}), uid: currentUser.uid, nome: clean };
  applyProfileNameToForm();
}

function openProfile() {
  if (!currentUser) return;
  const modal = document.getElementById('profile-modal');
  const photo = document.getElementById('profile-photo');
  const email = document.getElementById('profile-email');
  const nameInput = document.getElementById('profile-name-input');
  const savedName = getProfileName();

  if (photo) photo.src = currentUser.photoURL || 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_96x96dp.png';
  if (email) email.textContent = currentUser.email || '';
  if (nameInput) nameInput.value = savedName || currentUser.displayName || '';
  if (modal) modal.style.display = 'flex';
  renderProfileOrders();
}

function closeProfile() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
}

async function saveProfileFromModal() {
  const input = document.getElementById('profile-name-input');
  const status = document.getElementById('profile-save-status');
  const nome = input ? input.value.trim() : '';
  if (nome.length < 3) {
    if (status) { status.textContent = 'Digite um nome com pelo menos 3 letras.'; status.className = 'profile-status error'; }
    return;
  }
  try {
    await saveProfileName(nome);
    if (status) { status.textContent = 'Nome salvo com sucesso.'; status.className = 'profile-status ok'; }
    onNomeInput();
    renderProfileOrders();
  } catch (err) {
    if (status) { status.textContent = 'Erro ao salvar o nome.'; status.className = 'profile-status error'; }
    console.error(err);
  }
}

function renderProfileOrders() {
  const list = document.getElementById('profile-orders-list');
  if (!list || !currentUser) return;

  const pedidos = allOrders
    .filter(o => o.userUid === currentUser.uid)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!pedidos.length) {
    list.innerHTML = '<div class="empty-state small">Você ainda não fez nenhum pedido.</div>';
    return;
  }

  list.innerHTML = pedidos.map(o => {
    const doces = escapeHtml(formatSweets(o.sweets));
    const sauces = o.sauces && o.sauces.length ? `Molhos: ${escapeHtml(o.sauces.join(', '))}` : '';
    const comps = o.complements && o.complements.length ? escapeHtml(o.complements.join(', ')) : 'sem complementos extras';
    const drinks = [
      o.juice ? `${escapeHtml(o.juice)} grátis` : null,
      o.sodas && o.sodas.length ? `Refri: ${escapeHtml(o.sodas.join(', '))}` : null
    ].filter(Boolean).join(' · ');
    const canCancel = o.status !== 'pago' && o.status !== 'cancelado';
    const statusText = o.status === 'pago' ? 'Pago' : o.status === 'cancelado' ? 'Cancelado' : o.status === 'aguardando_pix' ? 'Aguardando Pix' : 'Pagar Pessoalmente';
    const fid = escapeHtml(o.firestoreId);
    const cancelBtn = canCancel ? `<button class="profile-cancel-btn" onclick="cancelMyOrder('${fid}')">Cancelar pedido</button>` : '';
    return `
      <div class="profile-order-card ${o.status === 'cancelado' ? 'canceled' : ''}">
        <div class="profile-order-top">
          <strong>${fmtBRL(o.total || 0)}</strong>
          <span>${statusText}</span>
        </div>
        <div class="profile-order-meta">${escapeHtml(o.dateStr || '')} · ${escapeHtml(o.timeStr || '')} · ${escapeHtml(o.turma || '')}</div>
        <div class="profile-order-detail">
          ${o.bread ? `Pão ${escapeHtml(o.bread)} · ${comps}` : 'Sem dogão'}<br>
          ${sauces ? `${sauces}<br>` : ''}
          ${drinks || 'sem bebida'}${doces ? `<br>Doces: ${doces}` : ''}
        </div>
        ${cancelBtn}
      </div>`;
  }).join('');
}

async function cancelMyOrder(fid) {
  const order = allOrders.find(o => o.firestoreId === fid && currentUser && o.userUid === currentUser.uid);
  if (!order) return;
  if (order.status === 'pago') { alert('Pedido pago não pode ser cancelado.'); return; }
  if (!confirm('Cancelar este pedido?')) return;
  try {
    const pedidoRef = doc(db, 'pedidos', fid);
    const userRef = doc(db, 'usuarios', currentUser.uid);
    const now = new Date().toISOString();

    await runTransaction(db, async transaction => {
      const pedidoSnap = await transaction.get(pedidoRef);
      const userSnap = await transaction.get(userRef);
      if (!pedidoSnap.exists()) throw new Error('Pedido não encontrado.');

      const pedido = pedidoSnap.data();
      if (pedido.userUid !== currentUser.uid) throw new Error('Pedido não pertence ao usuário logado.');
      if (pedido.status === 'pago') throw new Error('Pedido pago não pode ser cancelado.');

      transaction.update(pedidoRef, {
        status: 'cancelado',
        cancelado: true,
        oculto: true,
        canceledAt: now
      });

      if (userSnap.exists() && (userSnap.data().activeOrderId || null) === fid) {
        transaction.set(userRef, { activeOrderId: null, updatedAt: now }, { merge: true });
      }
    });
  } catch (err) {
    alert('Erro ao cancelar pedido: ' + err.message);
  }
}

/* ══════════════════════════════════════
   ROTEAMENTO POR URL
   /admin  → painel admin (só para ADMIN_EMAILS)
   /       → tela de pedido
══════════════════════════════════════ */
function normalizedPath() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path || '/';
}

function isAdminRoute() {
  const path = normalizedPath();
  return path === '/admin' || path === '/admin.html';
}

function routeUser(user) {
  resetOrdersSubscription();

  if (!user) {
    showOnlyView('view-login');
    return;
  }

  const email = (user.email || '').toLowerCase();
  isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email);

  if (isAdminRoute()) {
    if (isAdmin) {
      showOnlyView('view-admin');
      subscribeToAdminOrders();
    } else {
      window.history.replaceState({}, '', '/');
      showOnlyView('view-client');
      subscribeToClientOrders(user.uid);
    }
  } else {
    showOnlyView('view-client');
    subscribeToClientOrders(user.uid);
  }
}

function showOnlyView(id) {
  if (id === 'view-admin' && !isAdmin) id = 'view-client';
  document.querySelectorAll('.view').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    target.style.display = '';
  }
}

/* ══════════════════════════════════════
   TEMA
══════════════════════════════════════ */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('theme-icon').textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('bf_theme', next);
}

function loadTheme() {
  const saved = localStorage.getItem('bf_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-icon').textContent = saved === 'dark' ? '☀️' : '🌙';
}

/* ══════════════════════════════════════
   IDENTIFICAÇÃO — turmas agrupadas
══════════════════════════════════════ */
function initIdentificacao() {
  const wrap = document.getElementById('turma-chips-wrap');
  wrap.innerHTML = TURMAS_GRUPOS.map(g => `
    <div class="turma-grupo">
      <div class="turma-grupo-label">${g.grupo}</div>
      <div class="turma-chips">
        ${g.turmas.map(t =>
          `<div class="turma-chip" data-turma="${t}" onclick="selecionarTurma('${t}', this)">${t}</div>`
        ).join('')}
      </div>
    </div>
  `).join('');
}

function selecionarTurma(nome, el) {
  selectedTurma = nome;
  document.querySelectorAll('.turma-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  const nameInput = document.getElementById('customer-name');
  applyProfileNameToForm();
  if (!nameInput.value.trim() && currentUser) {
    nameInput.value = currentUser.displayName || '';
  }

  document.getElementById('student-status-box').innerHTML = '';
  document.getElementById('btn-continuar').style.display  = 'none';
  document.getElementById('id-error-box').style.display   = 'none';
  document.getElementById('nome-section').style.display   = 'block';

  onNomeInput();
  nameInput.focus();
}

function onNomeInput() {
  const nome     = document.getElementById('customer-name').value.trim();
  const statusEl = document.getElementById('student-status-box');
  const btnEl    = document.getElementById('btn-continuar');

  document.getElementById('id-error-box').style.display = 'none';

  if (!selectedTurma || nome.length < 3) {
    statusEl.innerHTML  = '';
    btnEl.style.display = 'none';
    return;
  }

  const st = statusAluno(nome, selectedTurma);

  if (!st.podePedir) {
    statusEl.innerHTML  = `<div class="student-status-card bloqueado">🔒 ${escapeHtml(st.motivo)}</div>`;
    btnEl.style.display = 'none';
  } else if (st.pedidos.length > 0) {
    const c = st.pedidos.length;
    statusEl.innerHTML  = `<div class="student-status-card ok">✅ ${c}/${MAX_ORDERS_PER_USER} pedido${c > 1 ? 's' : ''} anterior${c > 1 ? 'es' : ''} pago${c > 1 ? 's' : ''}. Pode fazer mais um!</div>`;
    btnEl.style.display = 'block';
  } else {
    statusEl.innerHTML  = '';
    btnEl.style.display = 'block';
  }
}

async function continuar() {
  const nome = normalizeName(document.getElementById('customer-name').value);
  if (!currentUser)    { showIdError('Faça login novamente antes de continuar.'); return; }
  if (!isValidTurma(selectedTurma))  { showIdError('Selecione uma turma válida.'); return; }
  if (!isValidName(nome)) { showIdError('Digite seu nome completo.'); return; }

  const st = statusAluno(nome, selectedTurma);
  if (!st.podePedir)   { showIdError(st.motivo); return; }

  if (currentUser && !getProfileName()) {
    try { await saveProfileName(nome); }
    catch (err) { showIdError('Não consegui salvar seu nome no perfil. Tente novamente.'); return; }
  }

  const finalName = normalizeName(getProfileName() || nome);
  document.getElementById('customer-name').value = finalName;

  document.getElementById('screen-identify').style.display = 'none';
  document.getElementById('screen-order').style.display    = 'block';
  document.getElementById('pill-name').textContent         = `🧑 ${finalName}  ·  ${selectedTurma}`;

  resetOrderForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showIdError(msg) {
  const el = document.getElementById('id-error-box');
  el.textContent   = msg;
  el.style.display = 'block';
}

function voltarIdentificacao() {
  document.getElementById('screen-order').style.display    = 'none';
  document.getElementById('screen-identify').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   PÃO (opcional)
══════════════════════════════════════ */
function selectBread(type) {
  // Toggle: clicar no mesmo pão desmarca
  if (selectedBread === type) {
    selectedBread = null;
    document.getElementById('bread-medio').classList.remove('selected');
    document.getElementById('bread-grande').classList.remove('selected');
    // Desabilita complementos
    document.querySelectorAll('.comp-item')
      .forEach(el => { el.classList.remove('selected'); el.classList.add('disabled'); });
    document.getElementById('comps-label').style.display  = 'none';
    document.getElementById('comps-grid').style.display   = 'none';
    document.getElementById('limit-warn').style.display   = 'none';
    hideSauces();
    // Trava suco
    updateJuiceLock();
    updateSummary();
    return;
  }

  selectedBread = type;
  document.getElementById('bread-medio').classList.toggle('selected', type === 'medio');
  document.getElementById('bread-grande').classList.toggle('selected', type === 'grande');

  // Mostra complementos
  document.getElementById('comps-label').style.display = 'block';
  document.getElementById('comps-grid').style.display  = 'grid';
  document.querySelectorAll('.comp-item').forEach(el => el.classList.remove('disabled'));
  if (type === 'medio') enforceLimit();
  showSauces(true);

  // Libera suco
  updateJuiceLock();
  updateSummary();
}

/* ══════════════════════════════════════
   COMPLEMENTOS
══════════════════════════════════════ */
function toggleComp(el) {
  if (el.classList.contains('disabled')) return;
  const isSelected = el.classList.contains('selected');
  if (!isSelected && selectedBread === 'medio' && getSelectedComps().length >= MAX_COMPS_MEDIO) return;
  el.classList.toggle('selected');
  enforceLimit();
  updateSummary();
}

function enforceLimit() {
  const warn = document.getElementById('limit-warn');
  if (selectedBread !== 'medio') { warn.style.display = 'none'; return; }
  const count = getSelectedComps().length;
  warn.style.display = count >= MAX_COMPS_MEDIO ? 'block' : 'none';
  document.querySelectorAll('.comp-item').forEach(el => {
    if (!el.classList.contains('selected') && count >= MAX_COMPS_MEDIO) el.classList.add('disabled');
    else el.classList.remove('disabled');
  });
}


/* ══════════════════════════════════════
   MOLHOS — grátis, padrão todos selecionados
══════════════════════════════════════ */
function showSauces(selectAll = false) {
  const label = document.getElementById('sauce-label');
  const note = document.getElementById('sauce-note');
  const grid = document.getElementById('sauce-grid');
  if (label) label.style.display = 'flex';
  if (note) note.style.display = 'block';
  if (grid) grid.style.display = 'grid';
  if (selectAll) document.querySelectorAll('.sauce-item').forEach(el => el.classList.add('selected'));
}

function hideSauces() {
  const label = document.getElementById('sauce-label');
  const note = document.getElementById('sauce-note');
  const grid = document.getElementById('sauce-grid');
  if (label) label.style.display = 'none';
  if (note) note.style.display = 'none';
  if (grid) grid.style.display = 'none';
  document.querySelectorAll('.sauce-item').forEach(el => el.classList.remove('selected'));
}

function toggleSauce(el) {
  if (!selectedBread) return;
  el.classList.toggle('selected');
  updateSummary();
}

/* ══════════════════════════════════════
   SUCO — só disponível com dogão
══════════════════════════════════════ */
function updateJuiceLock() {
  const hasBread = !!selectedBread;
  const juiceItems = document.querySelectorAll('.juice-item');
  const note  = document.getElementById('juice-locked-note');
  const tag   = document.getElementById('juice-tag');

  if (hasBread) {
    juiceItems.forEach(el => el.classList.remove('juice-locked'));
    note.style.display = 'none';
    tag.textContent    = 'incluso com o dogão';
  } else {
    juiceItems.forEach(el => {
      el.classList.add('juice-locked');
      el.classList.remove('selected');
    });
    selectedJuice      = null;
    note.style.display = 'block';
    tag.textContent    = '🔒 requer dogão';
  }
}

function selectJuice(el) {
  if (el.classList.contains('juice-locked')) return;
  document.querySelectorAll('.juice-item').forEach(j => j.classList.remove('selected'));
  el.classList.add('selected');
  selectedJuice = el.dataset.juice;
  updateSummary();
}

/* ══════════════════════════════════════
   REFRIGERANTES — múltipla escolha, máx 3
══════════════════════════════════════ */
function addSoda(flavor) {
  if (sodaCart.length >= MAX_SODAS) return;
  sodaCart.push(flavor);
  renderSodaCups();
  updateSummary();
}

function removeSoda(index) {
  sodaCart.splice(index, 1);
  renderSodaCups();
  updateSummary();
}

function renderSodaCups() {
  const wrap      = document.getElementById('soda-cups-wrap');
  const list      = document.getElementById('soda-cups-list');
  const badge     = document.getElementById('soda-count-badge');
  const limitWarn = document.getElementById('soda-limit-warn');
  const count     = sodaCart.length;

  badge.textContent = `${count}/${MAX_SODAS}`;
  wrap.style.display = count > 0 ? 'block' : 'none';
  limitWarn.style.display = count >= MAX_SODAS ? 'block' : 'none';

  // Greyed out flavor cards when at limit
  document.querySelectorAll('.soda-flavor-card').forEach(c => {
    c.classList.toggle('soda-disabled', count >= MAX_SODAS);
  });

  list.innerHTML = sodaCart.map((flavor, i) => `
    <div class="soda-cup-chip">
      <span class="soda-chip-icon">${SODA_CUP_ICON}</span>
      <span class="soda-chip-name">${flavor}</span>
      <button onclick="removeSoda(${i})" class="soda-cup-remove" title="Remover" aria-label="Remover ${flavor}">
        <svg class="remove-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M5.25 5.25L14.75 14.75M14.75 5.25L5.25 14.75"/>
        </svg>
      </button>
    </div>
  `).join('');
}


/* ══════════════════════════════════════
   DOCES — múltipla escolha, máx 10 unidades
══════════════════════════════════════ */
function addSweet(id) {
  if (!SWEETS[id]) return;
  if (getTotalSweets() >= MAX_SWEETS) return;
  sweetCart[id] += 1;
  renderSweets();
  updateSummary();
}

function removeSweet(id) {
  if (!SWEETS[id] || sweetCart[id] <= 0) return;
  sweetCart[id] -= 1;
  renderSweets();
  updateSummary();
}

function renderSweets() {
  const total = getTotalSweets();
  const badge = document.getElementById('sweet-count-badge');
  const warn = document.getElementById('sweet-limit-warn');
  const listWrap = document.getElementById('sweet-selected-wrap');
  const list = document.getElementById('sweet-selected-list');

  if (badge) badge.textContent = `${total}/${MAX_SWEETS}`;
  if (warn) warn.style.display = total >= MAX_SWEETS ? 'block' : 'none';
  document.querySelectorAll('.sweet-card').forEach(card => card.classList.toggle('sweet-disabled', total >= MAX_SWEETS));

  Object.keys(SWEETS).forEach(id => {
    const qty = document.getElementById(`sweet-qty-${id}`);
    const miniQty = document.getElementById(`sweet-mini-qty-${id}`);
    const card = document.querySelector(`.sweet-card[data-sweet="${id}"]`);
    if (qty) qty.textContent = sweetCart[id];
    if (miniQty) miniQty.textContent = sweetCart[id];
    if (card) card.classList.toggle('selected', sweetCart[id] > 0);
  });

  const entries = getSweetEntries();
  if (listWrap) listWrap.style.display = entries.length ? 'block' : 'none';
  if (list) {
    list.innerHTML = entries.map(item => `
      <div class="sweet-chip">
        <span class="sweet-chip-icon">${item.icon}</span>
        <span>${item.qty}x ${escapeHtml(item.name)}</span>
        <button class="sweet-chip-remove" onclick="removeSweet('${item.id}')" title="Remover 1 ${item.name}" aria-label="Remover 1 ${item.name}">
          <svg class="remove-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5.25 5.25L14.75 14.75M14.75 5.25L5.25 14.75"/></svg>
        </button>
      </div>
    `).join('');
  }
}

function formatSweets(sweets) {
  if (!sweets) return '';
  return Object.entries(sweets)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id, qty]) => `${qty}x ${(SWEETS[id] && SWEETS[id].name) || id}`)
    .join(', ');
}

/* ══════════════════════════════════════
   PAGAMENTO
══════════════════════════════════════ */
function selectPayment(type) {
  selectedPayment = type;
  document.getElementById('pay-pix').classList.toggle('selected', type === 'pix');
  document.getElementById('pay-dinheiro').classList.toggle('selected', type === 'dinheiro');
}

/* ══════════════════════════════════════
   TOTAL E RESUMO
══════════════════════════════════════ */
function calcTotal() {
  let total = 0;
  if (selectedBread) {
    total += BREAD_PRICES[selectedBread];
    getSelectedComps().forEach(el => { total += parseFloat(el.dataset.price); });
  }
  total += sodaCart.length * SODA_PRICE;
  getSweetEntries().forEach(item => { total += item.qty * item.price; });
  return total;
}

function updateSummary() {
  let html = '';

  if (selectedBread) {
    html += `<div class="sum-row"><span>Pão ${selectedBread}</span><span>${fmtBRL(BREAD_PRICES[selectedBread])}</span></div>`;
    getSelectedComps().forEach(el => {
      html += `<div class="sum-row"><span>${escapeHtml(el.dataset.name)}</span><span>+${fmtBRL(parseFloat(el.dataset.price))}</span></div>`;
    });
    const sauces = getSelectedSauces();
    if (sauces.length) {
      html += `<div class="sum-row"><span>Molhos: ${escapeHtml(sauces.join(', '))}</span><span class="sum-free">grátis</span></div>`;
    }
    if (selectedJuice) {
      html += `<div class="sum-row"><span>${escapeHtml(selectedJuice)}</span><span class="sum-free">grátis</span></div>`;
    }
  }

  sodaCart.forEach(flavor => {
    html += `<div class="sum-row"><span>${escapeHtml(flavor)}</span><span>+${fmtBRL(SODA_PRICE)}</span></div>`;
  });

  getSweetEntries().forEach(item => {
    html += `<div class="sum-row"><span>${item.qty}x ${escapeHtml(item.name)}</span><span>+${fmtBRL(item.qty * item.price)}</span></div>`;
  });

  document.getElementById('summary-lines').innerHTML   = html;
  document.getElementById('summary-total').textContent = fmtBRL(calcTotal());
}

/* ══════════════════════════════════════
   ENVIO DO PEDIDO → FIRESTORE
   FIX: só mostra sucesso APÓS confirmação do Firestore
══════════════════════════════════════ */
function showOrderError(msg) {
  const el = document.getElementById('order-error-box');
  el.textContent   = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitOrder() {
  document.getElementById('order-error-box').style.display = 'none';

  if (!currentUser) { showOrderError('Faça login novamente para enviar o pedido.'); return; }

  const nome  = normalizeName(getProfileName() || document.getElementById('customer-name').value);
  const turma = selectedTurma;

  if (!isValidTurma(turma)) { showOrderError('Turma inválida. Volte e selecione sua turma novamente.'); return; }
  if (!isValidName(nome)) { showOrderError('Nome inválido. Abra seu perfil e confirme seu nome.'); return; }

  const st = statusAluno(nome, turma);
  if (!st.podePedir) { showOrderError(st.motivo); return; }

  // Consulta fresca no servidor antes de salvar: evita enviar outro pedido
  // quando o listener local ainda não recebeu o pedido anterior.
  let freshOrders = [];
  try {
    freshOrders = await fetchMyOrdersOnce();
  } catch (err) {
    console.error('Erro ao validar pedidos anteriores:', err);
    showOrderError('Não consegui validar seus pedidos anteriores. Recarregue a página e tente novamente.');
    return;
  }

  const freshStatus = analyzeOrderPermission(freshOrders);
  if (!freshStatus.podePedir) {
    allOrders = freshOrders;
    renderProfileOrders();
    onNomeInput();
    showOrderError(freshStatus.motivo);
    return;
  }

  if (!selectedBread && sodaCart.length === 0 && getTotalSweets() === 0) {
    showOrderError('Escolha um cachorro quente, refrigerante ou doce.'); return;
  }
  if (selectedJuice && !selectedBread) {
    showOrderError('O suco grátis só acompanha o dogão.'); return;
  }
  if (!selectedPayment) {
    showOrderError('Selecione a forma de pagamento.'); return;
  }

  const btn = document.getElementById('btn-submit-order');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  const now   = new Date();
  const comps = getSelectedComps().map(el => el.dataset.name);
  const sauces = getSelectedSauces();
  const sweets = Object.fromEntries(getSweetEntries().map(item => [item.id, item.qty]));
  const total = calcTotal();

  const order = {
    name:        nome,
    turma,
    bread:       selectedBread || null,
    complements: comps,
    sauces,
    juice:       selectedJuice || null,
    sodas:       [...sodaCart],
    sweets,
    payment:     selectedPayment,
    total,
    status:      selectedPayment === 'pix' ? 'aguardando_pix' : 'pendente_dinheiro',
    oculto:      false,
    timestamp:   now.toISOString(),
    timeStr:     now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    dateStr:     fmtDate(now.toISOString()),
    userUid:     currentUser.uid
  };

  try {
    const newOrderRef = doc(pedidosRef);
    const userRef = doc(db, 'usuarios', currentUser.uid);

    await runTransaction(db, async transaction => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) throw new Error('Perfil do usuário não encontrado. Recarregue a página e tente novamente.');

      const userData = userSnap.data();
      const activeOrderId = userData.activeOrderId || null;
      const totalPedidosCriados = Number.isInteger(userData.totalPedidosCriados)
        ? userData.totalPedidosCriados
        : countValidOrders(freshOrders);

      if (activeOrderId) throw new Error('Você já possui um pedido aguardando pagamento.');
      if (totalPedidosCriados >= MAX_ORDERS_PER_USER) throw new Error(`Limite de ${MAX_ORDERS_PER_USER} pedidos atingido.`);

      transaction.set(newOrderRef, order);
      transaction.set(userRef, {
        activeOrderId: newOrderRef.id,
        totalPedidosCriados: totalPedidosCriados + 1,
        lastOrderId: newOrderRef.id,
        updatedAt: now.toISOString()
      }, { merge: true });
    });

    document.getElementById('screen-order').style.display   = 'none';
    document.getElementById('screen-success').style.display = 'block';

    const parts = [];
    if (selectedBread) {
      const compText = comps.length ? comps.join(', ') : 'sem complementos';
      const sauceText = sauces.length ? ` · molhos: ${sauces.join(', ')}` : '';
      parts.push(`Pão ${selectedBread} (${compText}${sauceText})`);
      if (selectedJuice) parts.push(selectedJuice);
    }
    if (sodaCart.length) parts.push(sodaCart.join(' + '));
    if (getSweetEntries().length) parts.push('Doces: ' + getSweetEntries().map(item => `${item.qty}x ${escapeHtml(item.name)}`).join(', '));

    document.getElementById('suc-title').textContent = `Pedido de ${nome} registrado! 🎉`;
    document.getElementById('suc-sub').textContent   = `Turma ${turma} · ${parts.join(' · ')}`;

    document.getElementById('pix-info').style.display = 'none';
    document.getElementById('din-info').style.display  = 'none';
    if (selectedPayment === 'pix') {
      document.getElementById('pix-info').style.display = 'block';
      document.getElementById('pix-total').textContent  = fmtBRL(total);
    } else {
      document.getElementById('din-info').style.display = 'block';
      document.getElementById('din-total').textContent  = fmtBRL(total);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    const msg = err && err.message ? err.message : 'Erro ao salvar o pedido.';
    showOrderError(msg.includes('Limite') || msg.includes('aguardando') ? msg : 'Erro ao salvar o pedido. Verifique sua conexão e tente novamente.');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Confirmar pedido →';
  }
}

/* ══════════════════════════════════════
   RESET
══════════════════════════════════════ */
function resetOrderForm() {
  selectedBread   = null;
  selectedPayment = null;
  selectedJuice   = null;
  sodaCart        = [];
  sweetCart       = { canudo_frito: 0, barrinha_cereal: 0, brownie_chocolate: 0 };

  document.querySelectorAll('.bread-card, .comp-item, .juice-item, .pay-card, .sauce-item, .sweet-card')
    .forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.comp-item')
    .forEach(el => el.classList.add('disabled'));

  document.getElementById('comps-label').style.display      = 'none';
  document.getElementById('comps-grid').style.display       = 'none';
  document.getElementById('limit-warn').style.display       = 'none';
  hideSauces();
  document.getElementById('order-error-box').style.display  = 'none';
  document.getElementById('soda-cups-wrap').style.display   = 'none';
  document.getElementById('soda-limit-warn').style.display  = 'none';
  document.getElementById('soda-cups-list').innerHTML       = '';
  document.getElementById('soda-count-badge').textContent   = `0/${MAX_SODAS}`;
  document.querySelectorAll('.soda-flavor-card').forEach(c => c.classList.remove('soda-disabled'));
  renderSweets();

  updateJuiceLock();
  updateSummary();
}

function voltarInicio() {
  document.getElementById('screen-success').style.display  = 'none';
  document.getElementById('screen-identify').style.display = 'block';
  document.getElementById('screen-order').style.display    = 'none';
  selectedTurma = null;
  document.querySelectorAll('.turma-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('customer-name').value          = '';
  applyProfileNameToForm();
  document.getElementById('nome-section').style.display   = 'none';
  document.getElementById('student-status-box').innerHTML = '';
  document.getElementById('btn-continuar').style.display  = 'none';
  document.getElementById('id-error-box').style.display   = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   LISTENER EM TEMPO REAL
══════════════════════════════════════ */
function resetOrdersSubscription() {
  if (unsubOrders) {
    unsubOrders();
    unsubOrders = null;
  }
  allOrders = [];
}

function handleOrdersSnapshot(snapshot) {
  allOrders = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

  if (document.getElementById('view-admin').classList.contains('active') && isAdmin) {
    renderAdmin();
  }

  renderProfileOrders();

  const nameInput = document.getElementById('customer-name');
  if (nameInput && nameInput.value.trim().length >= 3 && selectedTurma) {
    onNomeInput();
  }
}

function subscribeToClientOrders(userUid) {
  if (!userUid || unsubOrders) return;

  // Segurança/LGPD: aluno escuta somente os próprios pedidos.
  const q = query(
    pedidosRef,
    where('userUid', '==', userUid)
  );

  unsubOrders = onSnapshot(q, handleOrdersSnapshot, err => {
    console.error('Erro ao carregar seus pedidos:', err);
  });
}

function subscribeToAdminOrders() {
  if (!isAdmin || unsubOrders) return;

  const q = query(pedidosRef, orderBy('timestamp', 'desc'));
  unsubOrders = onSnapshot(q, handleOrdersSnapshot, err => {
    console.error('Erro ao carregar pedidos do admin:', err);
  });
}

// Compatibilidade com chamadas antigas internas: só admin pode assinar todos.
function subscribeToOrders() {
  if (isAdmin) subscribeToAdminOrders();
  else if (currentUser) subscribeToClientOrders(currentUser.uid);
}

/* ══════════════════════════════════════
   ADMIN — renderiza
══════════════════════════════════════ */
function refreshAdmin() { renderAdmin(); }

function renderAdmin() {
  const visiveis   = allOrders.filter(o => !o.oculto && o.status !== 'cancelado');
  const pago       = visiveis.filter(o => o.status === 'pago').length;
  const aguardando = visiveis.filter(o => o.status === 'aguardando_pix').length;
  const pendente   = visiveis.filter(o => o.status === 'pendente_dinheiro').length;
  const ocultos    = allOrders.filter(o => o.oculto).length;
  const arrecadado = allOrders.filter(o => o.status === 'pago').reduce((s, o) => s + o.total, 0);
  const aReceber   = allOrders.filter(o => isOrderOpen(o) && !o.oculto).reduce((s, o) => s + o.total, 0);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total de pedidos</div><div class="stat-val orange">${allOrders.length}</div></div>
    <div class="stat-card"><div class="stat-label">✅ Pagos</div><div class="stat-val green">${pago}</div></div>
    <div class="stat-card"><div class="stat-label">⏳ Aguardando Pix</div><div class="stat-val blue">${aguardando}</div></div>
    <div class="stat-card"><div class="stat-label">💵 Dinheiro</div><div class="stat-val amber">${pendente}</div></div>
    <div class="stat-card"><div class="stat-label">👁 Ocultos</div><div class="stat-val" style="color:var(--text-secondary)">${ocultos}</div></div>
    <div class="stat-card"><div class="stat-label">💰 Arrecadado</div><div class="stat-val green">${fmtBRL(arrecadado)}</div></div>
    <div class="stat-card"><div class="stat-label">⏳ A receber</div><div class="stat-val yellow">${fmtBRL(aReceber)}</div></div>
  `;

  const turmaCounts = {};
  visiveis.forEach(o => {
    const t = o.turma || 'Sem turma';
    turmaCounts[t] = (turmaCounts[t] || 0) + 1;
  });
  const turmasHtml = Object.entries(turmaCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, c]) => `<div class="turma-badge ${currentTurmaFilter === t ? 'active' : ''}" onclick="filterByTurma('${escapeHtml(t)}')">${escapeHtml(t)}<span>${c} pedido${c !== 1 ? 's' : ''}</span></div>`)
    .join('');
  document.getElementById('turmas-grid').innerHTML =
    turmasHtml || '<span style="color:var(--text-secondary);font-size:13px;">Nenhum pedido ainda.</span>';

  const select = document.getElementById('admin-turma-filter');
  if (select) {
    const turmas = [...new Set(allOrders.map(o => o.turma).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const current = currentTurmaFilter;
    select.innerHTML = '<option value="todas">Todas as turmas</option>' + turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    select.value = turmas.includes(current) ? current : 'todas';
    currentTurmaFilter = select.value;
  }

  renderOrders();
}

function filterByTurma(turma) {
  currentTurmaFilter = turma || 'todas';
  renderAdmin();
}

function filterOrders(status, btn) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOrders();
}

function renderOrders() {
  if (!isAdmin) return;

  let filtered;
  if (currentFilter === 'todos')   filtered = allOrders.filter(o => !o.oculto && o.status !== 'cancelado');
  else if (currentFilter === 'ocultos') filtered = allOrders.filter(o => o.oculto);
  else filtered = allOrders.filter(o => o.status === currentFilter && !o.oculto);

  if (currentTurmaFilter !== 'todas') {
    filtered = filtered.filter(o => o.turma === currentTurmaFilter);
  }

  const list = document.getElementById('order-list');
  if (!filtered.length) { list.innerHTML = '<div class="empty-state">Nenhum pedido aqui ainda.</div>'; return; }

  const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  list.innerHTML = sorted.map(o => {
    const fid         = escapeHtml(o.firestoreId);
    const isOculto    = o.oculto;
    const statusClass = isOculto ? 'oculto'
      : o.status === 'pago' ? 'pago'
      : o.status === 'aguardando_pix' ? 'aguardando' : 'pendente';

    const badge = isOculto
      ? '<span class="badge badge-oculto">👁 Oculto</span>'
      : o.status === 'pago'
      ? '<span class="badge badge-pago">✅ Pago</span>'
      : o.status === 'aguardando_pix'
      ? '<span class="badge badge-aguardando">⏳ Aguardando Pix</span>'
      : '<span class="badge badge-pendente">💵 Pagar Pessoalmente</span>';

    const confirmBtn = (!isOculto && o.status !== 'pago')
      ? `<button class="btn-confirm" onclick="confirmPayment('${fid}')">✓ Pago</button>` : '';
    const ocultarBtn = !isOculto
      ? `<button class="btn-action btn-hide" onclick="toggleOculto('${fid}')">👁 Ocultar</button>`
      : `<button class="btn-action btn-show" onclick="toggleOculto('${fid}')">↩ Mostrar</button>`;

    const compText = o.complements && o.complements.length ? escapeHtml(o.complements.join(', ')) : 'sem complementos extras';
    const sodaText = o.sodas && o.sodas.length ? escapeHtml(o.sodas.join(', ')) : null;
    const juiceText = o.juice ? escapeHtml(o.juice) : null;
    const sauceText = o.sauces && o.sauces.length ? `Molhos: ${escapeHtml(o.sauces.join(', '))}` : null;
    const sweetText = escapeHtml(formatSweets(o.sweets));

    const drinkLine = [
      juiceText ? `${juiceText} (grátis)` : null,
      sodaText  ? `Refri: ${sodaText}`    : null
    ].filter(Boolean).join(' · ') || 'sem bebida';

    return `
      <div class="order-card ${statusClass}" id="order-${fid}">
        <div class="order-header">
          <div>
            <div class="order-name">${escapeHtml(o.name || '')}</div>
            <div class="order-meta">
              <span class="order-turma">${escapeHtml(o.turma || '')}</span>
              <span class="order-date">📅 ${escapeHtml(o.dateStr || '')}</span>
              <span class="order-time">🕐 ${escapeHtml(o.timeStr || '')}</span>
            </div>
          </div>
          <div>${badge}</div>
        </div>
        <div class="order-detail">
          ${o.bread ? `Pão ${escapeHtml(o.bread)} · ${compText}` : 'Sem dogão'}${sauceText ? `<br>${sauceText}` : ''}<br>
          ${drinkLine}${sweetText ? `<br>Doces: ${sweetText}` : ''}<br>Pagamento: ${o.payment === 'pix' ? 'Pix' : 'Dinheiro'}
        </div>
        <div class="order-footer">
          <div class="order-total">${fmtBRL(o.total)}</div>
          <div class="order-actions">${confirmBtn}${ocultarBtn}</div>
        </div>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════
   ADMIN — AÇÕES FIREBASE
   FIX: usa firestoreId real do documento
══════════════════════════════════════ */
async function confirmPayment(fid) {
  if (!isAdmin) return;
  try {
    const pedidoRef = doc(db, 'pedidos', fid);
    const now = new Date().toISOString();

    await runTransaction(db, async transaction => {
      const pedidoSnap = await transaction.get(pedidoRef);
      if (!pedidoSnap.exists()) throw new Error('Pedido não encontrado.');

      const pedido = pedidoSnap.data();
      const userRef = pedido.userUid ? doc(db, 'usuarios', pedido.userUid) : null;
      const userSnap = userRef ? await transaction.get(userRef) : null;

      transaction.update(pedidoRef, { status: 'pago', paidAt: now });

      if (userRef && userSnap && userSnap.exists()) {
        transaction.set(userRef, {
          activeOrderId: null,
          lastPaidOrderId: fid,
          lastPaidAt: now,
          updatedAt: now
        }, { merge: true });
      }
    });
  }
  catch (e) { alert('Erro ao confirmar: ' + e.message); }
}

async function toggleOculto(fid) {
  if (!isAdmin) return;
  const o = allOrders.find(x => x.firestoreId === fid);
  if (!o) return;
  try { await updateDoc(doc(db, 'pedidos', fid), { oculto: !o.oculto }); }
  catch (e) { alert('Erro ao ocultar: ' + e.message); }
}

async function syncUserOrderLocks() {
  if (!isAdmin) return;
  if (!confirm('Sincronizar limites e travas de pedidos dos usuários com base nos pedidos atuais?')) return;

  const grouped = new Map();
  allOrders.forEach(o => {
    if (!o.userUid) return;
    if (!grouped.has(o.userUid)) grouped.set(o.userUid, []);
    grouped.get(o.userUid).push(o);
  });

  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    grouped.forEach((orders, uid) => {
      const openOrder = orders.find(o => isOrderOpen(o));
      batch.set(doc(db, 'usuarios', uid), {
        activeOrderId: openOrder ? openOrder.firestoreId : null,
        totalPedidosCriados: orders.length,
        lastSyncAt: now,
        updatedAt: now
      }, { merge: true });
    });

    await batch.commit();
    alert(`Sincronização concluída para ${grouped.size} usuário(s).`);
  } catch (e) {
    alert('Erro ao sincronizar usuários: ' + e.message);
  }
}


/* ══════════════════════════════════════
   AUTH
══════════════════════════════════════ */
const provider = new GoogleAuthProvider();

function loginWithGoogle() {
  signInWithPopup(auth, provider).catch(err => {
    alert('Erro ao fazer login com o Google:\n' + err.message + '\nCódigo: ' + err.code);
  });
}

function logout() {
  if (confirm('Deseja realmente sair?')) signOut(auth);
}

onAuthStateChanged(auth, async user => {
  currentUser = user;

  const badge = document.getElementById('user-profile-badge');
  if (user) {
    badge.style.display = 'flex';
    document.getElementById('user-photo').src =
      user.photoURL || 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_96x96dp.png';
    await loadUserProfile(user);
  } else {
    badge.style.display = 'none';
    resetOrdersSubscription();
    currentProfile = null;
  }

  routeUser(user);
});

/* ══════════════════════════════════════
   EXPOR PARA HTML (módulo ES)
══════════════════════════════════════ */
Object.assign(window, {
  toggleTheme, loginWithGoogle, logout,
  selecionarTurma, onNomeInput, continuar, voltarIdentificacao,
  selectBread, toggleComp, toggleSauce, selectJuice, selectPayment,
  addSoda, removeSoda, addSweet, removeSweet,
  submitOrder, voltarInicio,
  refreshAdmin, filterOrders, filterByTurma,
  confirmPayment, toggleOculto, syncUserOrderLocks,
  openProfile, closeProfile, saveProfileFromModal, cancelMyOrder
});

/* ══════════════════════════════════════
   INICIALIZAÇÃO
══════════════════════════════════════ */
loadTheme();
initIdentificacao();
renderSweets();
updateSummary();
