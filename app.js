import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc,
  onSnapshot, query, orderBy
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
const MAX_SAUCES      = 3;

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
let selectedSauces  = [];      // molhos grátis escolhidos
let sodaCart        = [];     // array de strings, ex: ['Guaraná Zero', 'Coca Zero']
let currentFilter   = 'todos';
let currentTurmaFilter = 'todas';
let allOrders       = [];
let currentUser     = null;
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

function getSelectedComps() {
  return Array.from(document.querySelectorAll('.comp-item.selected'));
}

function pedidosDoAluno(nome, turma) {
  return allOrders.filter(o =>
    o.name && o.name.trim().toLowerCase() === nome.trim().toLowerCase() &&
    o.turma === turma
  );
}

function statusAluno(nome, turma) {
  const pedidos   = pedidosDoAluno(nome, turma);
  const nao_pagos = pedidos.filter(o => o.status !== 'pago');
  if (nao_pagos.length > 0) {
    const p = nao_pagos[0];
    return {
      podePedir: false,
      motivo: `Você tem um pedido aguardando pagamento (${fmtBRL(p.total)}). Pague primeiro para fazer outro.`,
      pedidos
    };
  }
  return { podePedir: true, motivo: '', pedidos };
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
  if (!user) {
    showOnlyView('view-login');
    return;
  }

  const email = (user.email || '').toLowerCase();
  isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email);

  if (isAdminRoute()) {
    if (isAdmin) {
      showOnlyView('view-admin');
      subscribeToOrders();
    } else {
      // Não é admin — manda para a tela de pedido
      window.history.replaceState({}, '', '/');
      showOnlyView('view-client');
      subscribeToOrders();
    }
  } else {
    showOnlyView('view-client');
    subscribeToOrders();
  }
}

function showOnlyView(id) {
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
    statusEl.innerHTML  = `<div class="student-status-card bloqueado">🔒 ${st.motivo}</div>`;
    btnEl.style.display = 'none';
  } else if (st.pedidos.length > 0) {
    const c = st.pedidos.length;
    statusEl.innerHTML  = `<div class="student-status-card ok">✅ ${c} pedido${c > 1 ? 's' : ''} anterior${c > 1 ? 'es' : ''} pago${c > 1 ? 's' : ''}. Pode fazer mais um!</div>`;
    btnEl.style.display = 'block';
  } else {
    statusEl.innerHTML  = '';
    btnEl.style.display = 'block';
  }
}

function continuar() {
  const nome = document.getElementById('customer-name').value.trim();
  if (!selectedTurma)  { showIdError('Selecione sua turma primeiro.'); return; }
  if (nome.length < 3) { showIdError('Digite seu nome completo.'); return; }

  const st = statusAluno(nome, selectedTurma);
  if (!st.podePedir)   { showIdError(st.motivo); return; }

  document.getElementById('screen-identify').style.display = 'none';
  document.getElementById('screen-order').style.display    = 'block';
  document.getElementById('pill-name').textContent         = `🧑 ${nome}  ·  ${selectedTurma}`;

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
    document.getElementById('sauce-label').style.display = 'none';
    document.getElementById('sauce-note').style.display  = 'none';
    document.getElementById('sauce-grid').style.display  = 'none';
    document.getElementById('sauce-warn').style.display  = 'none';
    selectedSauces = [];
    document.querySelectorAll('.sauce-item').forEach(el => el.classList.remove('selected'));
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
  document.getElementById('sauce-label').style.display = 'block';
  document.getElementById('sauce-note').style.display  = 'block';
  document.getElementById('sauce-grid').style.display  = 'grid';
  if (type === 'medio') enforceLimit();

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
   MOLHOS — grátis, escolha de 0 a 3
══════════════════════════════════════ */
function toggleSauce(el) {
  if (!selectedBread) return;
  const name = el.dataset.sauce;
  const isSelected = el.classList.contains('selected');

  if (isSelected) {
    el.classList.remove('selected');
    selectedSauces = selectedSauces.filter(s => s !== name);
  } else {
    if (selectedSauces.length >= MAX_SAUCES) return;
    el.classList.add('selected');
    selectedSauces.push(name);
  }

  document.getElementById('sauce-warn').style.display = selectedSauces.length >= MAX_SAUCES ? 'block' : 'none';
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
  return total;
}

function updateSummary() {
  let html = '';

  if (selectedBread) {
    html += `<div class="sum-row"><span>Pão ${selectedBread}</span><span>${fmtBRL(BREAD_PRICES[selectedBread])}</span></div>`;
    getSelectedComps().forEach(el => {
      html += `<div class="sum-row"><span>${el.dataset.name}</span><span>+${fmtBRL(parseFloat(el.dataset.price))}</span></div>`;
    });
    selectedSauces.forEach(sauce => {
      html += `<div class="sum-row"><span>Molho: ${sauce}</span><span class="sum-free">grátis</span></div>`;
    });
    if (selectedJuice) {
      html += `<div class="sum-row"><span>${selectedJuice}</span><span class="sum-free">grátis</span></div>`;
    }
  }

  sodaCart.forEach(flavor => {
    html += `<div class="sum-row"><span>${flavor}</span><span>+${fmtBRL(SODA_PRICE)}</span></div>`;
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

  const nome  = document.getElementById('customer-name').value.trim();
  const turma = selectedTurma;

  const st = statusAluno(nome, turma);
  if (!st.podePedir) { showOrderError(st.motivo); return; }

  if (!selectedBread && sodaCart.length === 0) {
    showOrderError('Escolha um cachorro quente ou pelo menos um refrigerante.'); return;
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
  const sauces = [...selectedSauces];
  const total = calcTotal();

  const order = {
    name:        nome,
    turma,
    bread:       selectedBread || null,
    complements: comps,
    sauces,
    juice:       selectedJuice || null,
    sodas:       [...sodaCart],
    payment:     selectedPayment,
    total,
    status:      selectedPayment === 'pix' ? 'aguardando_pix' : 'pendente_dinheiro',
    oculto:      false,
    timestamp:   now.toISOString(),
    timeStr:     now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    dateStr:     fmtDate(now.toISOString()),
    userUid:     currentUser ? currentUser.uid : null
  };

  try {
    await addDoc(pedidosRef, order);

    document.getElementById('screen-order').style.display   = 'none';
    document.getElementById('screen-success').style.display = 'block';

    const parts = [];
    if (selectedBread) {
      const compText = comps.length ? comps.join(', ') : 'sem complementos extras';
      const sauceText = sauces.length ? ` · molhos: ${sauces.join(', ')}` : '';
      parts.push(`Pão ${selectedBread} (${compText}${sauceText})`);
      if (selectedJuice) parts.push(selectedJuice);
    }
    if (sodaCart.length) parts.push(sodaCart.join(' + '));

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
    showOrderError('Erro ao salvar o pedido. Verifique sua conexão e tente novamente.');
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
  selectedSauces  = [];
  sodaCart        = [];

  document.querySelectorAll('.bread-card, .comp-item, .sauce-item, .juice-item, .pay-card')
    .forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.comp-item')
    .forEach(el => el.classList.add('disabled'));

  document.getElementById('comps-label').style.display      = 'none';
  document.getElementById('comps-grid').style.display       = 'none';
  document.getElementById('limit-warn').style.display       = 'none';
  document.getElementById('sauce-label').style.display     = 'none';
  document.getElementById('sauce-note').style.display      = 'none';
  document.getElementById('sauce-grid').style.display      = 'none';
  document.getElementById('sauce-warn').style.display      = 'none';
  document.getElementById('order-error-box').style.display  = 'none';
  document.getElementById('soda-cups-wrap').style.display   = 'none';
  document.getElementById('soda-limit-warn').style.display  = 'none';
  document.getElementById('soda-cups-list').innerHTML       = '';
  document.getElementById('soda-count-badge').textContent   = `0/${MAX_SODAS}`;
  document.querySelectorAll('.soda-flavor-card').forEach(c => c.classList.remove('soda-disabled'));

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
  document.getElementById('nome-section').style.display   = 'none';
  document.getElementById('student-status-box').innerHTML = '';
  document.getElementById('btn-continuar').style.display  = 'none';
  document.getElementById('id-error-box').style.display   = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   LISTENER EM TEMPO REAL
══════════════════════════════════════ */
function subscribeToOrders() {
  if (unsubOrders) return; // já inscrito

  const q = query(pedidosRef, orderBy('timestamp', 'desc'));
  unsubOrders = onSnapshot(q, snapshot => {
    allOrders = snapshot.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

    // Atualiza admin só se estiver na view-admin
    if (document.getElementById('view-admin').classList.contains('active')) {
      renderAdmin();
    }

    // Atualiza status do formulário de identificação se estiver preenchido
    const nameInput = document.getElementById('customer-name');
    if (nameInput && nameInput.value.trim().length >= 3 && selectedTurma) {
      onNomeInput();
    }
  }, err => console.error('onSnapshot error:', err));
}

/* ══════════════════════════════════════
   ADMIN — renderiza
══════════════════════════════════════ */
function refreshAdmin() { renderAdmin(); }

function renderAdmin() {
  const visiveis   = allOrders.filter(o => !o.oculto);
  const pago       = visiveis.filter(o => o.status === 'pago').length;
  const aguardando = visiveis.filter(o => o.status === 'aguardando_pix').length;
  const pendente   = visiveis.filter(o => o.status === 'pendente_dinheiro').length;
  const ocultos    = allOrders.filter(o => o.oculto).length;
  const arrecadado = allOrders.filter(o => o.status === 'pago').reduce((s, o) => s + o.total, 0);
  const aReceber   = allOrders.filter(o => o.status !== 'pago' && !o.oculto).reduce((s, o) => s + o.total, 0);

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
  const turmaEntries = Object.entries(turmaCounts).sort(([a], [b]) => a.localeCompare(b));
  const turmasHtml = turmaEntries
    .map(([t, c]) => `<button class="turma-badge ${currentTurmaFilter === t ? 'active' : ''}" onclick="filterByTurma(decodeURIComponent('${encodeURIComponent(t)}'))">${t}<span>${c} pedido${c !== 1 ? 's' : ''}</span></button>`)
    .join('');
  document.getElementById('turmas-grid').innerHTML =
    turmasHtml || '<span style="color:var(--text-secondary);font-size:13px;">Nenhum pedido ainda.</span>';

  const turmaSelect = document.getElementById('admin-turma-filter');
  if (turmaSelect) {
    const previous = currentTurmaFilter;
    turmaSelect.innerHTML = '<option value="todas">Todas as turmas</option>' +
      turmaEntries.map(([t]) => `<option value="${t}">${t}</option>`).join('');
    turmaSelect.value = turmaEntries.some(([t]) => t === previous) ? previous : 'todas';
    currentTurmaFilter = turmaSelect.value;
  }

  renderOrders();
}

function filterOrders(status, btn) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOrders();
}

function filterByTurma(turma) {
  currentTurmaFilter = turma || 'todas';
  const select = document.getElementById('admin-turma-filter');
  if (select) select.value = currentTurmaFilter;
  renderAdmin();
}

function renderOrders() {
  let filtered;
  if (currentFilter === 'todos')   filtered = allOrders.filter(o => !o.oculto);
  else if (currentFilter === 'ocultos') filtered = allOrders.filter(o => o.oculto);
  else filtered = allOrders.filter(o => o.status === currentFilter && !o.oculto);

  if (currentTurmaFilter !== 'todas') {
    filtered = filtered.filter(o => (o.turma || 'Sem turma') === currentTurmaFilter);
  }

  const list = document.getElementById('order-list');
  if (!filtered.length) { list.innerHTML = '<div class="empty-state">Nenhum pedido aqui ainda.</div>'; return; }

  const sorted = [...filtered].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  list.innerHTML = sorted.map(o => {
    const fid         = o.firestoreId;
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
    const compText = o.complements && o.complements.length ? o.complements.join(', ') : 'sem complementos extras';
    const sauceText = o.sauces && o.sauces.length ? `Molhos: ${o.sauces.join(', ')}` : 'sem molhos';
    const sodaText = o.sodas && o.sodas.length ? o.sodas.join(', ') : null;
    const juiceText = o.juice || null;

    const drinkLine = [
      juiceText ? `${juiceText} (grátis)` : null,
      sodaText  ? `Refri: ${sodaText}`    : null
    ].filter(Boolean).join(' · ') || 'sem bebida';

    return `
      <div class="order-card ${statusClass}" id="order-${fid}">
        <div class="order-header">
          <div>
            <div class="order-name">${o.name}</div>
            <div class="order-meta">
              <span class="order-turma">${o.turma || ''}</span>
              <span class="order-date">📅 ${o.dateStr || ''}</span>
              <span class="order-time">🕐 ${o.timeStr || ''}</span>
            </div>
          </div>
          <div>${badge}</div>
        </div>
        <div class="order-detail">
          ${o.bread ? `Pão ${o.bread} · ${compText} · ${sauceText}` : 'Sem dogão'}<br>
          ${drinkLine} · Pagamento: ${o.payment === 'pix' ? 'Pix' : 'Dinheiro'}
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
  try { await updateDoc(doc(db, 'pedidos', fid), { status: 'pago' }); }
  catch (e) { alert('Erro ao confirmar: ' + e.message); }
}

async function toggleOculto(fid) {
  const o = allOrders.find(x => x.firestoreId === fid);
  if (!o) return;
  try { await updateDoc(doc(db, 'pedidos', fid), { oculto: !o.oculto }); }
  catch (e) { alert('Erro ao ocultar: ' + e.message); }
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

onAuthStateChanged(auth, user => {
  currentUser = user;

  const badge = document.getElementById('user-profile-badge');
  if (user) {
    badge.style.display = 'flex';
    document.getElementById('user-photo').src =
      user.photoURL || 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_96x96dp.png';
  } else {
    badge.style.display = 'none';
    if (unsubOrders) { unsubOrders(); unsubOrders = null; }
    allOrders = [];
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
  addSoda, removeSoda,
  submitOrder, voltarInicio,
  refreshAdmin, filterOrders, filterByTurma,
  confirmPayment, toggleOculto
});

/* ══════════════════════════════════════
   INICIALIZAÇÃO
══════════════════════════════════════ */
loadTheme();
initIdentificacao();
updateSummary();
