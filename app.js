import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDocs, collection, query, onSnapshot, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ═══════════════════════════════════════════════════════
   BARBOSA DOG — app.js
   ═══════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyD9m9ULOrqYswGlT0xwiUylgFTbZDwvMvw",
  authDomain: "barbosafoods-5bb86.firebaseapp.com",
  projectId: "barbosafoods-5bb86",
  storageBucket: "barbosafoods-5bb86.firebasestorage.app",
  messagingSenderId: "101534719657",
  appId: "1:101534719657:web:910493ca21a435b88713b8",
  measurementId: "G-VZRE9CSQS4"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ══════════════════════════════════════
   TURMAS
   → Adicione ou remova turmas aqui.
   ══════════════════════════════════════ */
const TURMAS = [
  '1°EM', '1°DS', '1°FD',
  '2°EM', '2°DS', '2°FD',
  '3°A EM', '3°B EM', '3°DS', '3°FD'
];

/* ══════════════════════════════════════
   CONSTANTES E ESTADO
   ══════════════════════════════════════ */
const BREAD_PRICES = { medio: 10, grande: 15 };
const MAX_COMPS_MEDIO = 3;

let selectedTurma = null;
let selectedBread = null;
let selectedPayment = null;
let selectedJuice = null;
let currentFilter = 'todos';
let allOrders = []; // Pedidos locais atualizados em tempo real pelo Firestore
let unsubscribeOrders = null;

/* ══════════════════════════════════════
   UTILITÁRIOS
   ══════════════════════════════════════ */
function getOrders() {
  return allOrders;
}

function fmtBRL(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getSelectedComps() {
  return Array.from(document.querySelectorAll('.comp-item.selected'));
}

/* Pedidos de um aluno (por nome + turma, ignorando ocultos na lógica de bloqueio) */
function pedidosDoAluno(nome, turma) {
  return getOrders().filter(o =>
    o.name.trim().toLowerCase() === nome.trim().toLowerCase() &&
    o.turma === turma
  );
}

/* Regra: pode fazer novo pedido se não tiver nenhum pedido ATIVO não pago */
function statusAluno(nome, turma) {
  const pedidos = pedidosDoAluno(nome, turma);
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
   TEMA
══════════════════════════════════════ */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('theme-icon').textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('barbosa_dog_theme', next);
}

function loadTheme() {
  const saved = localStorage.getItem('barbosa_dog_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-icon').textContent = saved === 'dark' ? '☀️' : '🌙';
}

/* ══════════════════════════════════════
   NAVEGAÇÃO
══════════════════════════════════════ */
function showView(viewId, btn) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
  if (btn) btn.classList.add('active');
  if (viewId === 'admin') refreshAdmin();
}

/* ══════════════════════════════════════
   IDENTIFICAÇÃO
══════════════════════════════════════ */
function initIdentificacao() {
  const el = document.getElementById('turma-chips');
  el.innerHTML = TURMAS.map(t =>
    `<div class="turma-chip" onclick="selecionarTurma('${t}', this)">${t}</div>`
  ).join('');
}

function selecionarTurma(nome, el) {
  selectedTurma = nome;

  document.querySelectorAll('.turma-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  // Mantém o nome se já estiver preenchido, ou preenche com o do Google se logado
  const nameInput = document.getElementById('customer-name');
  if (!nameInput.value.trim() && auth.currentUser) {
    nameInput.value = auth.currentUser.displayName || '';
  }

  document.getElementById('student-status-box').innerHTML = '';
  document.getElementById('btn-continuar').style.display = 'none';
  document.getElementById('id-error-box').style.display = 'none';
  document.getElementById('nome-section').style.display = 'block';
  
  // Executa validação imediatamente para exibir o botão se válido
  onNomeInput();
  nameInput.focus();
}

function onNomeInput() {
  const nome = document.getElementById('customer-name').value.trim();
  const statusEl = document.getElementById('student-status-box');
  const btnEl = document.getElementById('btn-continuar');

  document.getElementById('id-error-box').style.display = 'none';

  if (!selectedTurma || nome.length < 3) {
    statusEl.innerHTML = '';
    btnEl.style.display = 'none';
    return;
  }

  const st = statusAluno(nome, selectedTurma);

  if (!st.podePedir) {
    statusEl.innerHTML = `<div class="student-status-card bloqueado">🔒 ${st.motivo}</div>`;
    btnEl.style.display = 'none';
  } else if (st.pedidos.length > 0) {
    const count = st.pedidos.length;
    statusEl.innerHTML = `<div class="student-status-card ok">✅ ${count} pedido${count > 1 ? 's' : ''} anterior${count > 1 ? 'es' : ''} pago${count > 1 ? 's' : ''}. Pode fazer mais um!</div>`;
    btnEl.style.display = 'block';
  } else {
    statusEl.innerHTML = '';
    btnEl.style.display = 'block';
  }
}

function continuar() {
  const nome = document.getElementById('customer-name').value.trim();

  if (!selectedTurma) { showIdError('Selecione sua turma primeiro.'); return; }
  if (nome.length < 3) { showIdError('Digite seu nome completo.'); return; }

  const st = statusAluno(nome, selectedTurma);
  if (!st.podePedir) { showIdError(st.motivo); return; }

  // Vai para tela de pedido
  document.getElementById('screen-identify').style.display = 'none';
  document.getElementById('screen-order').style.display = 'block';

  document.getElementById('pill-name').textContent =
    `🧑 ${nome}  ·  ${selectedTurma}`;

  resetOrderForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showIdError(msg) {
  const el = document.getElementById('id-error-box');
  el.textContent = msg;
  el.style.display = 'block';
}

function voltarIdentificacao() {
  document.getElementById('screen-order').style.display = 'none';
  document.getElementById('screen-identify').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   PÃO
══════════════════════════════════════ */
function selectBread(type) {
  selectedBread = type;
  document.getElementById('bread-medio').classList.toggle('selected', type === 'medio');
  document.getElementById('bread-grande').classList.toggle('selected', type === 'grande');
  document.querySelectorAll('.comp-item').forEach(el => el.classList.remove('disabled'));
  if (type === 'medio') enforceLimit();
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
   SUCO
══════════════════════════════════════ */
function selectJuice(el) {
  document.querySelectorAll('.juice-item').forEach(j => j.classList.remove('selected'));
  el.classList.add('selected');
  selectedJuice = el.dataset.juice;
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
  if (!selectedBread) return 0;
  let total = BREAD_PRICES[selectedBread];
  getSelectedComps().forEach(el => { total += parseFloat(el.dataset.price); });
  return total;
}

function updateSummary() {
  let html = '';
  if (selectedBread) html += `<div class="sum-row"><span>Pão ${selectedBread}</span><span>${fmtBRL(BREAD_PRICES[selectedBread])}</span></div>`;
  getSelectedComps().forEach(el => {
    html += `<div class="sum-row"><span>${el.dataset.name}</span><span>+${fmtBRL(parseFloat(el.dataset.price))}</span></div>`;
  });
  if (selectedJuice) html += `<div class="sum-row"><span>Suco de ${selectedJuice}</span><span>incluso</span></div>`;
  document.getElementById('summary-lines').innerHTML = html;
  document.getElementById('summary-total').textContent = fmtBRL(calcTotal());
}

/* ══════════════════════════════════════
   ENVIO DO PEDIDO
══════════════════════════════════════ */
function showOrderError(msg) {
  const el = document.getElementById('order-error-box');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitOrder() {
  document.getElementById('order-error-box').style.display = 'none';

  const nome = document.getElementById('customer-name').value.trim();
  const turma = selectedTurma;

  // Proteção dupla: re-verifica bloqueio
  const st = statusAluno(nome, turma);
  if (!st.podePedir) { showOrderError(st.motivo); return; }

  if (!selectedBread) { showOrderError('Selecione o tamanho do pão.'); return; }
  if (!selectedJuice) { showOrderError('Escolha o sabor do suco.'); return; }
  if (!selectedPayment) { showOrderError('Selecione a forma de pagamento.'); return; }

  const total = calcTotal();
  const comps = getSelectedComps().map(el => el.dataset.name);
  const now = new Date();

  const order = {
    id: Date.now(),
    name: nome,
    turma,
    bread: selectedBread,
    complements: comps,
    juice: selectedJuice,
    payment: selectedPayment,
    total,
    status: selectedPayment === 'pix' ? 'aguardando_pix' : 'pendente_dinheiro',
    oculto: false,
    timestamp: now.toISOString(),
    timeStr: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    dateStr: fmtDate(now.toISOString())
  };

  // Adiciona informações do usuário autenticado no pedido
  if (auth.currentUser) {
    order.userUid = auth.currentUser.uid;
    order.userEmail = auth.currentUser.email;
  }

  // Salva no Firestore
  setDoc(doc(db, "pedidos", String(order.id)), order)
    .catch(err => {
      console.error("Erro ao salvar pedido:", err);
      showOrderError("Erro ao salvar o pedido no banco de dados. Tente novamente.");
    });

  // Sucesso
  document.getElementById('screen-order').style.display = 'none';
  document.getElementById('screen-success').style.display = 'block';

  const compText = comps.length ? comps.join(', ') : 'sem complementos extras';
  document.getElementById('suc-title').textContent = `Pedido de ${nome} registrado! 🎉`;
  document.getElementById('suc-sub').textContent = `Turma ${turma} · Pão ${selectedBread} · ${compText} · Suco de ${selectedJuice}`;

  document.getElementById('pix-info').style.display = 'none';
  document.getElementById('din-info').style.display = 'none';

  if (selectedPayment === 'pix') {
    document.getElementById('pix-info').style.display = 'block';
    document.getElementById('pix-total').textContent = fmtBRL(total);
  } else {
    document.getElementById('din-info').style.display = 'block';
    document.getElementById('din-total').textContent = fmtBRL(total);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   RESET FORMULÁRIO DE PEDIDO
══════════════════════════════════════ */
function resetOrderForm() {
  selectedBread = null;
  selectedPayment = null;
  selectedJuice = null;

  document.querySelectorAll('.bread-card, .comp-item, .juice-item, .pay-card')
    .forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.comp-item')
    .forEach(el => el.classList.add('disabled'));

  document.getElementById('limit-warn').style.display = 'none';
  document.getElementById('order-error-box').style.display = 'none';
  updateSummary();
}

function voltarInicio() {
  document.getElementById('screen-success').style.display = 'none';
  document.getElementById('screen-identify').style.display = 'block';
  document.getElementById('screen-order').style.display = 'none';

  // Reseta identificação
  selectedTurma = null;
  document.querySelectorAll('.turma-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('customer-name').value = '';
  document.getElementById('nome-section').style.display = 'none';
  document.getElementById('student-status-box').innerHTML = '';
  document.getElementById('btn-continuar').style.display = 'none';
  document.getElementById('id-error-box').style.display = 'none';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════
   ADMIN — STATS
══════════════════════════════════════ */
function refreshAdmin() {
  const orders = getOrders();
  const visiveis = orders.filter(o => !o.oculto);

  const pago = visiveis.filter(o => o.status === 'pago').length;
  const aguardando = visiveis.filter(o => o.status === 'aguardando_pix').length;
  const pendente = visiveis.filter(o => o.status === 'pendente_dinheiro').length;
  const ocultos = orders.filter(o => o.oculto).length;
  const arrecadado = orders.filter(o => o.status === 'pago').reduce((s, o) => s + o.total, 0);
  const aReceber = orders.filter(o => o.status !== 'pago' && !o.oculto).reduce((s, o) => s + o.total, 0);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total de pedidos</div><div class="stat-val orange">${orders.length}</div></div>
    <div class="stat-card"><div class="stat-label">✅ Pagos</div><div class="stat-val green">${pago}</div></div>
    <div class="stat-card"><div class="stat-label">⏳ Aguardando Pix</div><div class="stat-val blue">${aguardando}</div></div>
    <div class="stat-card"><div class="stat-label">💵 Dinheiro (retirada)</div><div class="stat-val amber">${pendente}</div></div>
    <div class="stat-card"><div class="stat-label">👁 Ocultos</div><div class="stat-val" style="color:var(--text-secondary)">${ocultos}</div></div>
    <div class="stat-card"><div class="stat-label">💰 Arrecadado</div><div class="stat-val green">${fmtBRL(arrecadado)}</div></div>
    <div class="stat-card"><div class="stat-label">⏳ A receber</div><div class="stat-val yellow">${fmtBRL(aReceber)}</div></div>
  `;

  // Turmas (só pedidos visíveis)
  const turmaCounts = {};
  visiveis.forEach(o => {
    const t = o.turma || 'Sem turma';
    turmaCounts[t] = (turmaCounts[t] || 0) + 1;
  });

  const turmasHtml = Object.entries(turmaCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, c]) => `<div class="turma-badge">${t}<span>${c} pedido${c !== 1 ? 's' : ''}</span></div>`)
    .join('');

  document.getElementById('turmas-grid').innerHTML =
    turmasHtml || '<span style="color:var(--text-secondary);font-size:13px;">Nenhum pedido ainda.</span>';

  renderOrders(orders);
}

/* ══════════════════════════════════════
   ADMIN — FILTROS E LISTA
══════════════════════════════════════ */
function filterOrders(status, btn) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOrders(getOrders());
}

function renderOrders(orders) {
  let filtered;

  if (currentFilter === 'todos') {
    filtered = orders.filter(o => !o.oculto);
  } else if (currentFilter === 'ocultos') {
    filtered = orders.filter(o => o.oculto);
  } else {
    filtered = orders.filter(o => o.status === currentFilter && !o.oculto);
  }

  const list = document.getElementById('order-list');

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pedido aqui ainda.</div>';
    return;
  }

  // Pedidos visíveis/ativos primeiro (mais recentes), ocultos sempre no fim
  const sorted = [...filtered].sort((a, b) => b.id - a.id);

  list.innerHTML = sorted.map(o => {
    const isOculto = o.oculto;
    const statusClass = isOculto ? 'oculto'
      : o.status === 'pago' ? 'pago'
        : o.status === 'aguardando_pix' ? 'aguardando'
          : 'pendente';

    const badge = isOculto
      ? '<span class="badge badge-oculto">👁 Oculto</span>'
      : o.status === 'pago'
        ? '<span class="badge badge-pago">✅ Pago</span>'
        : o.status === 'aguardando_pix'
          ? '<span class="badge badge-aguardando">⏳ Aguardando Pix</span>'
          : '<span class="badge badge-pendente">💵 Pagar na retirada</span>';

    const confirmBtn = (!isOculto && o.status !== 'pago')
      ? `<button class="btn-confirm" onclick="confirmPayment(${o.id})">✓ Pago</button>`
      : '';

    const ocultarBtn = !isOculto
      ? `<button class="btn-action btn-hide" onclick="toggleOculto(${o.id})" title="Ocultar pedido">👁 Ocultar</button>`
      : `<button class="btn-action btn-show" onclick="toggleOculto(${o.id})" title="Mostrar pedido">↩ Mostrar</button>`;

    const compText = o.complements && o.complements.length
      ? o.complements.join(', ')
      : 'sem complementos extras';

    return `
      <div class="order-card ${statusClass}" id="order-${o.id}">
        <div class="order-header">
          <div>
            <div class="order-name">${o.name}</div>
            <div class="order-meta">
              <span class="order-turma">${o.turma || ''}</span>
              <span class="order-date">📅 ${o.dateStr || ''}</span>
              <span class="order-time">🕐 ${o.timeStr || ''}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${badge}
          </div>
        </div>
        <div class="order-detail">
          Pão ${o.bread} · ${compText}<br>
          Suco de ${o.juice} · Pagamento: ${o.payment === 'pix' ? 'Pix' : 'Dinheiro'}
        </div>
        <div class="order-footer">
          <div class="order-total">${fmtBRL(o.total)}</div>
          <div class="order-actions">
            ${confirmBtn}
            ${ocultarBtn}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════
   ADMIN — AÇÕES
══════════════════════════════════════ */
function confirmPayment(id) {
  updateDoc(doc(db, "pedidos", String(id)), { status: 'pago' })
    .catch(err => console.error("Erro ao confirmar pagamento:", err));
}

function toggleOculto(id) {
  const orders = getOrders();
  const order = orders.find(o => o.id === id);
  if (!order) return;
  updateDoc(doc(db, "pedidos", String(id)), { oculto: !order.oculto })
    .catch(err => console.error("Erro ao alternar visibilidade:", err));
}

// Operações de exclusão removidas por segurança (deletar somente via painel do Firebase)

/* ══════════════════════════════════════
   AUTENTICAÇÃO & FIREBASE REALTIME
   ══════════════════════════════════════ */
const provider = new GoogleAuthProvider();

function loginWithGoogle() {
  signInWithPopup(auth, provider)
    .then(() => {
      window.location.reload();
    })
    .catch((error) => {
      console.error("Erro no login com Google:", error);
      alert("Erro ao fazer login com o Google:\n" + error.message + "\nCódigo: " + error.code);
    });
}

function logout() {
  if (confirm("Deseja realmente sair?")) {
    signOut(auth).catch((error) => {
      console.error("Erro ao deslogar:", error);
    });
  }
}

function subscribeToOrders() {
  if (unsubscribeOrders) unsubscribeOrders();

  const q = collection(db, "pedidos");
  unsubscribeOrders = onSnapshot(q, (snapshot) => {
    allOrders = [];
    snapshot.forEach((docSnap) => {
      allOrders.push(docSnap.data());
    });
    
    // Atualiza o painel admin em tempo real incondicionalmente
    refreshAdmin();
    
    // Também atualiza o status do formulário de identificação em tempo real
    const nameInput = document.getElementById('customer-name');
    if (nameInput && nameInput.value.trim() && selectedTurma) {
      onNomeInput();
    }
  }, (error) => {
    console.error("Erro na escuta dos pedidos do Firestore:", error);
  });
}

// Configura o observador de autenticação do Firebase
onAuthStateChanged(auth, (user) => {
  const navTabs = document.querySelector('.nav-tabs');
  const userProfile = document.getElementById('user-profile-badge');
  const viewLogin = document.getElementById('view-login');
  
  if (user) {
    // Usuário autenticado
    if (navTabs) navTabs.style.display = 'flex';
    if (userProfile) {
      userProfile.style.display = 'flex';
      const userPhoto = document.getElementById('user-photo');
      if (userPhoto) userPhoto.src = user.photoURL || 'https://www.gstatic.com/images/branding/product/2x/avatar_anonymous_96x96dp.png';
    }
    if (viewLogin) viewLogin.style.display = 'none';
    
    // Assinar atualizações de pedidos em tempo real
    subscribeToOrders();
    
    // Preenche o nome do aluno se vazio
    const nameInput = document.getElementById('customer-name');
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = user.displayName || '';
    }
    
    // Exibe a tela de identificação por padrão
    showView('client');
  } else {
    // Usuário deslogado
    if (navTabs) navTabs.style.display = 'none';
    if (userProfile) userProfile.style.display = 'none';
    
    // Limpa escuta em tempo real do Firestore
    if (unsubscribeOrders) {
      unsubscribeOrders();
      unsubscribeOrders = null;
    }
    allOrders = [];
    
    // Exibe apenas a tela de login
    document.querySelectorAll('.view').forEach(el => {
      if (el.id === 'view-login') {
        el.classList.add('active');
        el.style.display = 'flex';
      } else {
        el.classList.remove('active');
        el.style.display = 'none';
      }
    });
  }
});

/* ══════════════════════════════════════
   EXPOR FUNÇÕES PARA O HTML (MÓDULO ES)
   ══════════════════════════════════════ */
Object.assign(window, {
  showView,
  toggleTheme,
  selecionarTurma,
  onNomeInput,
  continuar,
  voltarIdentificacao,
  selectBread,
  toggleComp,
  selectJuice,
  selectPayment,
  submitOrder,
  voltarInicio,
  refreshAdmin,
  filterOrders,
  confirmPayment,
  toggleOculto,
  loginWithGoogle,
  logout
});

/* ══════════════════════════════════════
   INICIALIZAÇÃO
══════════════════════════════════════ */
loadTheme();
initIdentificacao();
updateSummary();