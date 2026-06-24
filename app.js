/* ============================================================
   PÃO DE CLEIDE — Sistema de Gestão
   ============================================================ */

function waitForFirebase(){
  return new Promise((resolve) => {
    if (window.__firebase) { resolve(window.__firebase); return; }
    const check = setInterval(() => {
      if (window.__firebase) { clearInterval(check); resolve(window.__firebase); }
    }, 30);
  });
}

const { db, collection, doc, addDoc, updateDoc, deleteDoc,
        onSnapshot, query, orderBy, serverTimestamp, setDoc, getDoc } = await waitForFirebase();

/* ====== ESTADO GLOBAL ====== */
const state = {
  config: {
    receitas: [
      {
        id: "frango",
        nome: "Pão de Queijo com Frango",
        ingredientes: [
          { nome: "Polvilho", qtd: 1, unidade: "kg" },
          { nome: "Ovos", qtd: 8, unidade: "un" },
          { nome: "Peito de Frango", qtd: 1, unidade: "kg" },
          { nome: "Queijo", qtd: 0.2, unidade: "kg" },
          { nome: "Gás (uso do forno)", qtd: 1, unidade: "uso" },
          { nome: "Sal / Tempero", qtd: 1, unidade: "porção" }
        ],
        paesPerFornada: 30,
        precoVenda: 6.00
      }
    ],
    metaMensal: 1000.00
  },
  producao: [],
  estoqueIngredientes: [
    { nome: "Polvilho", qtd: 0, unidade: "kg", minimo: 0.5, custoUn: 0 },
    { nome: "Ovos", qtd: 0, unidade: "un", minimo: 8, custoUn: 0 },
    { nome: "Peito de Frango", qtd: 0, unidade: "kg", minimo: 0.5, custoUn: 0 },
    { nome: "Queijo", qtd: 0, unidade: "kg", minimo: 0.05, custoUn: 0 },
    { nome: "Gás (uso do forno)", qtd: 0, unidade: "uso", minimo: 2, custoUn: 0 },
    { nome: "Sal / Tempero", qtd: 0, unidade: "porção", minimo: 0.1, custoUn: 0 }
  ],
  compras: [],
  vendas: [],
  caixa: [],
  configLoaded: false,
  estoqueLoaded: false
};

let editingId = null;
let editingType = null;

/* ====== HELPERS ====== */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

function fmtBRL(n){
  n = Number(n) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtNum(n, dec=0){
  n = Number(n) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtDate(d){
  if (!d) return '—';
  let date = d;
  if (d?.toDate) date = d.toDate();
  else if (typeof d === 'string') date = new Date(d + 'T00:00:00');
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('pt-BR');
}
function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function monthKey(dateStr){
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function monthLabel(key){
  if (!key) return '';
  const [y,m] = key.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return meses[parseInt(m)-1] + '/' + y;
}
function uid(){ return Math.random().toString(36).slice(2, 10); }
function slugify(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || uid();
}

/* ====== TOAST ====== */
function toast(msg, type='default'){
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'default' ? ' ' + type : '');
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '•';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity 0.3s'; setTimeout(()=>el.remove(), 300); }, 3200);
}

/* ====== MODAL ====== */
function openModal(html){
  $('#modalContent').innerHTML = html;
  $('#modalOverlay').classList.add('active');
}
function closeModal(){
  $('#modalOverlay').classList.remove('active');
  $('#modalContent').innerHTML = '';
  editingId = null;
  editingType = null;
}
$('#modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ====== SYNC INDICATOR ====== */
function setSyncStatus(status){
  const dot = $('#syncDot');
  const label = $('#syncLabel');
  dot.className = 'sync-dot';
  if (status === 'syncing'){ dot.classList.add('syncing'); label.textContent = 'Sincronizando...'; }
  else if (status === 'offline'){ dot.classList.add('offline'); label.textContent = 'Sem conexão'; }
  else { label.textContent = 'Sincronizado'; }
}

window.addEventListener('online', () => setSyncStatus('online'));
window.addEventListener('offline', () => setSyncStatus('offline'));

/* ====== NAVEGAÇÃO ====== */
function switchView(viewName){
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + viewName).classList.add('active');
  $$('#navTabs button').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  localStorage.setItem('pdc_lastView', viewName);
  renderView(viewName);
}

$('#navTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  switchView(btn.dataset.view);
});

function renderView(viewName){
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'producao') renderProducao();
  if (viewName === 'estoque') renderEstoque();
  if (viewName === 'vendas') renderVendas();
  if (viewName === 'financeiro') renderFinanceiro();
}

/* ====== RECEITAS — HELPERS ====== */
function getReceita(id){
  return state.config.receitas.find(r => r.id === id) || state.config.receitas[0];
}
function custoFornada(receita){
  if (!receita) return 0;
  return receita.ingredientes.reduce((sum, i) => {
    const estoqueItem = state.estoqueIngredientes.find(e => e.nome === i.nome);
    const custoUn = estoqueItem ? Number(estoqueItem.custoUn)||0 : 0;
    return sum + (i.qtd * custoUn);
  }, 0);
}
function custoPorPao(receita){
  if (!receita) return 0;
  const c = custoFornada(receita);
  const n = receita.paesPerFornada || 1;
  return c / n;
}
function lucroPorPao(receita){
  if (!receita) return 0;
  return receita.precoVenda - custoPorPao(receita);
}

/* ============================================================
   FIREBASE — LISTENERS EM TEMPO REAL
   ============================================================ */

let initialLoadDone = false;
function checkInitialLoad(){
  if (state.configLoaded && state.estoqueLoaded && !initialLoadDone){
    initialLoadDone = true;
    $('#loadingScreen').style.display = 'none';
    $('#app').style.display = 'block';
  }
}

function getCurrentView(){
  const active = $('.view.active');
  return active ? active.id.replace('view-', '') : 'dashboard';
}

function initFirebaseListeners(){
  setSyncStatus('syncing');

  const configRef = doc(db, 'config', 'principal');
  onSnapshot(configRef, (snap) => {
    if (snap.exists()){
      const data = snap.data();
      if (data.receitas && data.receitas.length){
        state.config = { ...state.config, ...data };
      } else {
        state.config = { ...state.config, metaMensal: data.metaMensal ?? state.config.metaMensal };
      }
    } else {
      setDoc(configRef, state.config).catch(console.error);
    }
    state.configLoaded = true;
    checkInitialLoad();
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  const estoqueRef = doc(db, 'estoque', 'ingredientes');
  onSnapshot(estoqueRef, (snap) => {
    if (snap.exists()){
      state.estoqueIngredientes = snap.data().itens || state.estoqueIngredientes;
    } else {
      setDoc(estoqueRef, { itens: state.estoqueIngredientes }).catch(console.error);
    }
    state.estoqueLoaded = true;
    checkInitialLoad();
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  const producaoQuery = query(collection(db, 'producao'), orderBy('data', 'desc'));
  onSnapshot(producaoQuery, (snap) => {
    state.producao = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setSyncStatus('online');
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  const vendasQuery = query(collection(db, 'vendas'), orderBy('data', 'desc'));
  onSnapshot(vendasQuery, (snap) => {
    state.vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  const comprasQuery = query(collection(db, 'compras'), orderBy('data', 'desc'));
  onSnapshot(comprasQuery, (snap) => {
    state.compras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  const caixaQuery = query(collection(db, 'caixa'), orderBy('data', 'desc'));
  onSnapshot(caixaQuery, (snap) => {
    state.caixa = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });
}

async function salvarConfig(){
  setSyncStatus('syncing');
  try{
    await setDoc(doc(db, 'config', 'principal'), state.config);
    toast('Configurações salvas', 'success');
  } catch(e){ console.error(e); toast('Erro ao salvar', 'error'); }
}

async function salvarEstoqueIngredientes(){
  setSyncStatus('syncing');
  try{
    await setDoc(doc(db, 'estoque', 'ingredientes'), { itens: state.estoqueIngredientes });
  } catch(e){ console.error(e); toast('Erro ao salvar estoque', 'error'); }
}

async function confirmarExclusao(colecao, id){
  openModal(`
    <h3>Confirmar exclusão</h3>
    <p class="text-soft">Tem certeza que deseja excluir este registro? Essa ação não pode ser desfeita.</p>
    <div class="modal-actions">
      <button class="btn outline" id="btnCancelarDel">Cancelar</button>
      <button class="btn danger" id="btnConfirmarDel">Excluir</button>
    </div>
  `);
  $('#btnCancelarDel').addEventListener('click', closeModal);
  $('#btnConfirmarDel').addEventListener('click', async () => {
    setSyncStatus('syncing');
    try{
      await deleteDoc(doc(db, colecao, id));
      toast('Registro excluído', 'success');
    } catch(e){ console.error(e); toast('Erro ao excluir', 'error'); }
    closeModal();
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard(){
  const container = $('#view-dashboard');
  const curMonth = monthKey(todayISO());

  const vendasMes = state.vendas.filter(v => monthKey(v.data) === curMonth);
  const faturamentoMes = vendasMes.reduce((s,v) => s + (Number(v.totalRecebido)||0), 0);
  const lucroMes = vendasMes.reduce((s,v) => s + (Number(v.lucro)||0), 0);
  const paesVendidosMes = vendasMes.reduce((s,v) => s + (Number(v.qtd)||0), 0);

  const producaoMes = state.producao.filter(p => monthKey(p.data) === curMonth);
  const fornadasMes = producaoMes.reduce((s,p) => s + (Number(p.fornadas)||0), 0);
  const paesProduzidosMes = producaoMes.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);

  const totalProduzido = state.producao.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);
  const totalVendido = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const estoquePaes = Math.max(0, totalProduzido - totalVendido);

  const metaPct = state.config.metaMensal > 0 ? (faturamentoMes / state.config.metaMensal) * 100 : 0;

  const itensBaixo = state.estoqueIngredientes.filter(i => Number(i.qtd) < Number(i.minimo));

  const ultimasVendas = [...state.vendas].sort((a,b) => (b.data||'').localeCompare(a.data||'')).slice(0, 6);

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card accent">
        <div class="label">Faturamento do mês</div>
        <div class="value">${fmtBRL(faturamentoMes)}</div>
        <div class="sub">${monthLabel(curMonth)}</div>
      </div>
      <div class="kpi-card oliva">
        <div class="label">Lucro do mês</div>
        <div class="value">${fmtBRL(lucroMes)}</div>
        <div class="sub">${paesVendidosMes} pães vendidos</div>
      </div>
      <div class="kpi-card">
        <div class="label">Pães em estoque</div>
        <div class="value">${fmtNum(estoquePaes)}</div>
        <div class="sub">prontos para venda</div>
      </div>
      <div class="kpi-card${itensBaixo.length ? ' alert' : ''}">
        <div class="label">Ingredientes baixos</div>
        <div class="value">${itensBaixo.length}</div>
        <div class="sub">${itensBaixo.length ? itensBaixo.map(i=>i.nome).join(', ') : 'tudo certo'}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span><span>Meta do mês</span></div>
        <span class="text-soft text-sm">${fmtBRL(faturamentoMes)} de ${fmtBRL(state.config.metaMensal)}</span>
      </div>
      <div class="progress-bar"><div class="fill" style="width:${Math.min(100,metaPct).toFixed(0)}%"></div></div>
      <div class="text-faint text-sm" style="margin-top:8px;">${metaPct.toFixed(0)}% da meta mensal atingida · ${fornadasMes} fornadas · ${paesProduzidosMes} pães produzidos este mês</div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title">
          <div class="left"><span class="dot"></span><span>Últimas vendas</span></div>
          <button class="btn sm" id="btnNovaVendaDash">+ Nova venda</button>
        </div>
        ${ultimasVendas.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Data</th><th>Receita</th><th>Cliente</th><th>Qtd</th><th>Total</th><th>Lucro</th></tr></thead>
              <tbody>
                ${ultimasVendas.map(v => {
                  const r = getReceita(v.receitaId);
                  return `
                  <tr>
                    <td>${fmtDate(v.data)}</td>
                    <td>${r ? r.nome : '—'}</td>
                    <td>${v.cliente || '—'}</td>
                    <td>${v.qtd}</td>
                    <td>${fmtBRL(v.totalRecebido)}</td>
                    <td class="text-soft">${fmtBRL(v.lucro)}</td>
                  </tr>
                `;}).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma venda registrada ainda</div>`}
      </div>

      <div class="card">
        <div class="section-title"><div class="left"><span class="dot"></span><span>Estoque de ingredientes</span></div></div>
        ${state.estoqueIngredientes.map(i => {
          const baixo = Number(i.qtd) < Number(i.minimo);
          return `
            <div class="flex between center" style="padding:8px 0; border-bottom:1px solid var(--line);">
              <div>
                <div style="font-weight:500; font-size:13px;">${i.nome}</div>
                <div class="text-faint text-sm">${fmtNum(i.qtd, 2)} ${i.unidade}</div>
              </div>
              <span class="tag ${baixo ? 'low' : 'ok'}">${baixo ? 'Repor' : 'OK'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="flex gap wrap" style="margin-top: 4px;">
      <button class="btn" id="btnDashNovaVenda2">Registrar venda</button>
      <button class="btn outline" id="btnDashNovaFornada">Registrar fornada</button>
      <button class="btn outline" id="btnDashVerEstoque">Ver estoque</button>
    </div>
  `;

  $('#btnNovaVendaDash')?.addEventListener('click', () => openVendaModal());
  $('#btnDashNovaVenda2')?.addEventListener('click', () => openVendaModal());
  $('#btnDashNovaFornada')?.addEventListener('click', () => openProducaoModal());
  $('#btnDashVerEstoque')?.addEventListener('click', () => switchView('estoque'));
}

/* ============================================================
   PRODUÇÃO — com múltiplas receitas
   ============================================================ */

function renderProducao(){
  const container = $('#view-producao');

  const totalProduzido = state.producao.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);
  const totalVendido = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const estoquePaes = Math.max(0, totalProduzido - totalVendido);
  const custoTotalGasto = state.producao.reduce((s,p) => s + (Number(p.custoTotal)||0), 0);

  const producaoOrdenada = [...state.producao].sort((a,b) => (b.data||'').localeCompare(a.data||''));

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="label">Receitas cadastradas</div>
        <div class="value">${state.config.receitas.length}</div>
        <div class="sub">sabores diferentes</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">Total produzido</div>
        <div class="value">${fmtNum(totalProduzido)}</div>
        <div class="sub">desde o início</div>
      </div>
      <div class="kpi-card oliva">
        <div class="label">Em estoque agora</div>
        <div class="value">${fmtNum(estoquePaes)}</div>
        <div class="sub">prontos para venda</div>
      </div>
      <div class="kpi-card">
        <div class="label">Gasto em produção</div>
        <div class="value">${fmtBRL(custoTotalGasto)}</div>
        <div class="sub">total acumulado</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title">
          <div class="left"><span class="dot"></span><span>Registro de fornadas</span></div>
          <button class="btn sm" id="btnNovaFornada">+ Nova fornada</button>
        </div>
        ${producaoOrdenada.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Data</th><th>Receita</th><th>Fornadas</th><th>Pães</th><th>Custo</th><th></th></tr></thead>
              <tbody>
                ${producaoOrdenada.map(p => {
                  const r = getReceita(p.receitaId);
                  return `
                  <tr>
                    <td>${fmtDate(p.data)}</td>
                    <td>${r ? r.nome : '—'}</td>
                    <td>${p.fornadas}</td>
                    <td>${p.paesProduzidos}</td>
                    <td>${fmtBRL(p.custoTotal)}</td>
                    <td>
                      <button class="btn-icon" data-edit-prod="${p.id}" title="Editar">✎</button>
                      <button class="btn-icon danger" data-del-prod="${p.id}" title="Excluir">✕</button>
                    </td>
                  </tr>
                `;}).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma fornada registrada ainda</div>`}
      </div>

      <div class="card">
        <div class="section-title">
          <div class="left"><span class="dot"></span><span>Receitas</span></div>
          <button class="btn sm" id="btnNovaReceita">+ Nova receita</button>
        </div>
        ${state.config.receitas.map(r => {
          const cf = custoFornada(r);
          const cp = custoPorPao(r);
          const lp = lucroPorPao(r);
          return `
            <div style="padding:14px 0; border-bottom:1px solid var(--line);">
              <div class="flex between center" style="margin-bottom:6px;">
                <strong style="font-family:'Fraunces',serif; font-size:15px;">${r.nome}</strong>
                <div class="flex gap">
                  <button class="btn-icon" data-edit-receita="${r.id}" title="Editar">✎</button>
                  ${state.config.receitas.length > 1 ? `<button class="btn-icon danger" data-del-receita="${r.id}" title="Excluir">✕</button>` : ''}
                </div>
              </div>
              <div class="text-faint text-sm">
                ${r.paesPerFornada} pães/fornada · custo fornada ${fmtBRL(cf)} · custo/pão ${fmtBRL(cp)} ·
                venda ${fmtBRL(r.precoVenda)} · lucro/pão <span style="color:var(--oliva-dark); font-weight:600;">${fmtBRL(lp)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  $('#btnNovaFornada')?.addEventListener('click', () => openProducaoModal());
  $('#btnNovaReceita')?.addEventListener('click', () => openReceitaModal());
  $$('[data-edit-prod]').forEach(b => b.addEventListener('click', () => openProducaoModal(b.dataset.editProd)));
  $$('[data-del-prod]').forEach(b => b.addEventListener('click', () => confirmarExclusao('producao', b.dataset.delProd)));
  $$('[data-edit-receita]').forEach(b => b.addEventListener('click', () => openReceitaModal(b.dataset.editReceita)));
  $$('[data-del-receita]').forEach(b => b.addEventListener('click', () => excluirReceita(b.dataset.delReceita)));
}

function openProducaoModal(id=null){
  editingId = id;
  editingType = 'producao';
  const item = id ? state.producao.find(p => p.id === id) : null;
  const receitaInicial = item ? item.receitaId : state.config.receitas[0]?.id;

  openModal(`
    <h3>${item ? 'Editar fornada' : 'Nova fornada'}</h3>
    <form id="formProducao">
      <div class="field">
        <label>Receita / sabor</label>
        <select name="receitaId" id="selectReceitaProd" required>
          ${state.config.receitas.map(r => `<option value="${r.id}" ${r.id===receitaInicial?'selected':''}>${r.nome}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Data da produção</label>
        <input type="date" name="data" value="${item?.data || todayISO()}" required>
      </div>
      <div class="field">
        <label>Quantidade de fornadas</label>
        <input type="number" name="fornadas" min="0.5" step="0.5" value="${item?.fornadas || 1}" required>
      </div>
      <div class="text-faint text-sm" style="margin-bottom: 14px;">
        Custo estimado: <strong id="custoPreview">—</strong> ·
        Pães estimados: <strong id="paesPreview">—</strong>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarProd">Cancelar</button>
        <button type="submit" class="btn">${item ? 'Salvar' : 'Registrar'}</button>
      </div>
    </form>
  `);

  const fornadasInput = $('input[name="fornadas"]');
  const receitaSelect = $('#selectReceitaProd');
  const updatePreview = () => {
    const receita = getReceita(receitaSelect.value);
    const f = Number(fornadasInput.value) || 0;
    $('#custoPreview').textContent = fmtBRL(custoFornada(receita) * f);
    $('#paesPreview').textContent = fmtNum((receita?.paesPerFornada||0) * f);
  };
  fornadasInput.addEventListener('input', updatePreview);
  receitaSelect.addEventListener('change', updatePreview);
  updatePreview();

  $('#btnCancelarProd').addEventListener('click', closeModal);
  $('#formProducao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const receitaId = fd.get('receitaId');
    const receita = getReceita(receitaId);
    const fornadas = Number(fd.get('fornadas'));
    const payload = {
      receitaId: receitaId,
      data: fd.get('data'),
      fornadas: fornadas,
      paesProduzidos: Math.round(fornadas * (receita?.paesPerFornada||0)),
      custoTotal: Math.round(fornadas * custoFornada(receita) * 100) / 100,
      atualizadoEm: serverTimestamp()
    };

    setSyncStatus('syncing');
    try{
      if (item){
        await updateDoc(doc(db, 'producao', item.id), payload);
        toast('Fornada atualizada', 'success');
      } else {
        payload.criadoEm = serverTimestamp();
        await addDoc(collection(db, 'producao'), payload);
        toast('Fornada registrada', 'success');
        await descontarEstoquePorFornada(receita, fornadas);
      }
      closeModal();
    } catch(err){ console.error(err); toast('Erro ao salvar', 'error'); }
  });
}

async function descontarEstoquePorFornada(receita, fornadas){
  if (!receita) return;
  const novoEstoque = state.estoqueIngredientes.map(item => {
    const ingredienteReceita = receita.ingredientes.find(i => i.nome === item.nome);
    if (!ingredienteReceita) return item;
    return { ...item, qtd: Math.max(0, Number(item.qtd) - (Number(ingredienteReceita.qtd)||0) * fornadas) };
  });
  state.estoqueIngredientes = novoEstoque;
  await salvarEstoqueIngredientes();
}

/* ====== RECEITAS — CRUD ====== */
function openReceitaModal(id=null){
  const receita = id ? getReceita(id) : null;
  const nomesEstoque = state.estoqueIngredientes.map(i => i.nome);

  const ingredientesIniciais = receita ? receita.ingredientes : [
    { nome: nomesEstoque[0] || '', qtd: 1, unidade: state.estoqueIngredientes[0]?.unidade || 'kg' }
  ];

  const renderLinhasIngredientes = (lista) => lista.map((ing, idx) => `
    <div class="field-row" style="grid-template-columns: 2fr 1fr 1fr auto; margin-bottom:6px; align-items:end;" data-ing-row="${idx}">
      <div class="field" style="margin-bottom:0;">
        ${idx===0?'<label>Ingrediente</label>':''}
        <select data-ing-nome="${idx}">
          ${nomesEstoque.map(n => `<option value="${n}" ${n===ing.nome?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin-bottom:0;">
        ${idx===0?'<label>Qtd</label>':''}
        <input type="number" step="0.01" data-ing-qtd="${idx}" value="${ing.qtd}">
      </div>
      <div class="field" style="margin-bottom:0;">
        ${idx===0?'<label>Unidade</label>':''}
        <input type="text" data-ing-unidade="${idx}" value="${ing.unidade}">
      </div>
      <button type="button" class="btn-icon danger" data-remove-ing="${idx}" title="Remover" style="margin-bottom:${idx===0?'0':'0'};">✕</button>
    </div>
  `).join('');

  openModal(`
    <h3>${receita ? 'Editar receita' : 'Nova receita'}</h3>
    <form id="formReceita">
      <div class="field">
        <label>Nome da receita</label>
        <input type="text" name="nome" value="${receita?.nome || ''}" placeholder="Ex: Pão de Queijo com Bacon" required>
      </div>

      <div class="field">
        <label>Ingredientes</label>
        <div id="ingredientesWrap">${renderLinhasIngredientes(ingredientesIniciais)}</div>
        <button type="button" class="btn outline sm" id="btnAddIngrediente" style="margin-top:6px; align-self:flex-start;">+ Adicionar ingrediente</button>
      </div>

      <div class="field-row" style="margin-top:14px;">
        <div class="field">
          <label>Pães por fornada</label>
          <input type="number" name="paesPerFornada" value="${receita?.paesPerFornada || 30}" required>
        </div>
        <div class="field">
          <label>Preço de venda unitário (R$)</label>
          <input type="number" step="0.01" name="precoVenda" value="${receita?.precoVenda || ''}" required>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarReceita">Cancelar</button>
        <button type="submit" class="btn">Salvar receita</button>
      </div>
    </form>
  `);

  let ingredientesState = [...ingredientesIniciais];

  function rebindRemoveButtons(){
    $$('[data-remove-ing]').forEach(b => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.removeIng);
        ingredientesState.splice(idx, 1);
        if (ingredientesState.length === 0) ingredientesState.push({ nome: nomesEstoque[0]||'', qtd: 1, unidade: 'kg' });
        $('#ingredientesWrap').innerHTML = renderLinhasIngredientes(ingredientesState);
        rebindRemoveButtons();
      });
    });
  }
  rebindRemoveButtons();

  $('#btnAddIngrediente').addEventListener('click', () => {
    syncIngredientesFromDOM();
    ingredientesState.push({ nome: nomesEstoque[0]||'', qtd: 1, unidade: state.estoqueIngredientes[0]?.unidade||'kg' });
    $('#ingredientesWrap').innerHTML = renderLinhasIngredientes(ingredientesState);
    rebindRemoveButtons();
  });

  function syncIngredientesFromDOM(){
    const rows = $$('[data-ing-row]');
    ingredientesState = rows.map((row, idx) => ({
      nome: $(`[data-ing-nome="${idx}"]`)?.value || '',
      qtd: Number($(`[data-ing-qtd="${idx}"]`)?.value) || 0,
      unidade: $(`[data-ing-unidade="${idx}"]`)?.value || ''
    }));
  }

  $('#btnCancelarReceita').addEventListener('click', closeModal);
  $('#formReceita').addEventListener('submit', async (e) => {
    e.preventDefault();
    syncIngredientesFromDOM();
    const fd = new FormData(e.target);

    const novaReceita = {
      id: receita ? receita.id : slugify(fd.get('nome')) + '-' + uid().slice(0,4),
      nome: fd.get('nome'),
      ingredientes: ingredientesState.filter(i => i.nome),
      paesPerFornada: Number(fd.get('paesPerFornada')),
      precoVenda: Number(fd.get('precoVenda'))
    };

    if (receita){
      state.config.receitas = state.config.receitas.map(r => r.id === receita.id ? novaReceita : r);
    } else {
      state.config.receitas = [...state.config.receitas, novaReceita];
    }

    await salvarConfig();
    closeModal();
  });
}

async function excluirReceita(id){
  if (state.config.receitas.length <= 1){
    toast('Você precisa manter ao menos uma receita', 'error');
    return;
  }
  openModal(`
    <h3>Excluir receita</h3>
    <p class="text-soft">Tem certeza? Vendas e produções antigas dessa receita continuam no histórico, mas ela não aparecerá mais para novos registros.</p>
    <div class="modal-actions">
      <button class="btn outline" id="btnCancelarDelReceita">Cancelar</button>
      <button class="btn danger" id="btnConfirmarDelReceita">Excluir</button>
    </div>
  `);
  $('#btnCancelarDelReceita').addEventListener('click', closeModal);
  $('#btnConfirmarDelReceita').addEventListener('click', async () => {
    state.config.receitas = state.config.receitas.filter(r => r.id !== id);
    await salvarConfig();
    closeModal();
  });
}

/* ============================================================
   ESTOQUE DE INGREDIENTES — com preço por unidade
   ============================================================ */

function renderEstoque(){
  const container = $('#view-estoque');
  const itensBaixo = state.estoqueIngredientes.filter(i => Number(i.qtd) < Number(i.minimo));
  const valorTotalEstoque = state.estoqueIngredientes.reduce((s,i) => s + (Number(i.qtd)||0) * (Number(i.custoUn)||0), 0);
  const comprasOrdenadas = [...state.compras].sort((a,b) => (b.data||'').localeCompare(a.data||''));
  const totalComprasMes = state.compras
    .filter(c => monthKey(c.data) === monthKey(todayISO()))
    .reduce((s,c) => s + (Number(c.total)||0), 0);

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card${itensBaixo.length ? ' alert' : ' oliva'}">
        <div class="label">Status geral</div>
        <div class="value">${itensBaixo.length ? itensBaixo.length + ' baixo(s)' : 'Tudo OK'}</div>
        <div class="sub">${itensBaixo.length ? itensBaixo.map(i=>i.nome).join(', ') : 'estoque saudável'}</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">Valor em estoque</div>
        <div class="value">${fmtBRL(valorTotalEstoque)}</div>
        <div class="sub">ingredientes parados</div>
      </div>
      <div class="kpi-card">
        <div class="label">Gasto em compras (mês)</div>
        <div class="value">${fmtBRL(totalComprasMes)}</div>
        <div class="sub">${monthLabel(monthKey(todayISO()))}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span><span>Ingredientes em estoque</span></div>
        <div class="flex gap">
          <button class="btn outline sm" id="btnNovoIngrediente">+ Novo ingrediente</button>
          <button class="btn sm" id="btnAjustarEstoque">Ajustar quantidades e preços</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Ingrediente</th><th>Qtd. atual</th><th>Mínimo</th><th>Preço/unid.</th><th>Valor total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${state.estoqueIngredientes.map((i, idx) => {
              const baixo = Number(i.qtd) < Number(i.minimo);
              const valorItem = (Number(i.qtd)||0) * (Number(i.custoUn)||0);
              return `
                <tr>
                  <td>${i.nome}</td>
                  <td>${fmtNum(i.qtd, 2)} ${i.unidade}</td>
                  <td>${fmtNum(i.minimo, 2)} ${i.unidade}</td>
                  <td>${fmtBRL(i.custoUn)}</td>
                  <td>${fmtBRL(valorItem)}</td>
                  <td><span class="tag ${baixo ? 'low' : 'ok'}">${baixo ? 'Repor' : 'OK'}</span></td>
                  <td><button class="btn-icon danger" data-del-ingrediente="${idx}" title="Remover ingrediente">✕</button></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span><span>Histórico de compras / reposição</span></div>
        <button class="btn sm" id="btnNovaCompra">+ Registrar compra</button>
      </div>
      ${comprasOrdenadas.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Data</th><th>Ingrediente</th><th>Qtd</th><th>Total</th><th>Fornecedor</th><th></th></tr></thead>
            <tbody>
              ${comprasOrdenadas.map(c => `
                <tr>
                  <td>${fmtDate(c.data)}</td>
                  <td>${c.ingrediente}</td>
                  <td>${c.qtd} ${c.unidade||''}</td>
                  <td>${fmtBRL(c.total)}</td>
                  <td>${c.fornecedor || '—'}</td>
                  <td><button class="btn-icon danger" data-del-compra="${c.id}" title="Excluir">✕</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma compra registrada ainda</div>`}
    </div>
  `;

  $('#btnAjustarEstoque')?.addEventListener('click', () => openAjustarEstoqueModal());
  $('#btnNovoIngrediente')?.addEventListener('click', () => openNovoIngredienteModal());
  $('#btnNovaCompra')?.addEventListener('click', () => openCompraModal());
  $$('[data-del-compra]').forEach(b => b.addEventListener('click', () => confirmarExclusao('compras', b.dataset.delCompra)));
  $$('[data-del-ingrediente]').forEach(b => b.addEventListener('click', () => removerIngredienteEstoque(Number(b.dataset.delIngrediente))));
}

function openNovoIngredienteModal(){
  openModal(`
    <h3>Novo ingrediente</h3>
    <form id="formNovoIngrediente">
      <div class="field">
        <label>Nome do ingrediente</label>
        <input type="text" name="nome" placeholder="Ex: Bacon" required>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Unidade</label>
          <input type="text" name="unidade" placeholder="kg, un, g..." required>
        </div>
        <div class="field">
          <label>Preço por unidade (R$)</label>
          <input type="number" step="0.01" name="custoUn" placeholder="0,00">
        </div>
      </div>
      <div class="field">
        <label>Estoque mínimo (alerta)</label>
        <input type="number" step="0.01" name="minimo" placeholder="0">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarNovoIng">Cancelar</button>
        <button type="submit" class="btn">Adicionar</button>
      </div>
    </form>
  `);

  $('#btnCancelarNovoIng').addEventListener('click', closeModal);
  $('#formNovoIngrediente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = fd.get('nome').trim();
    if (state.estoqueIngredientes.find(i => i.nome.toLowerCase() === nome.toLowerCase())){
      toast('Esse ingrediente já existe', 'error');
      return;
    }
    state.estoqueIngredientes.push({
      nome: nome,
      qtd: 0,
      unidade: fd.get('unidade') || 'un',
      minimo: Number(fd.get('minimo')) || 0,
      custoUn: Number(fd.get('custoUn')) || 0
    });
    await salvarEstoqueIngredientes();
    toast('Ingrediente adicionado', 'success');
    closeModal();
  });
}

async function removerIngredienteEstoque(idx){
  const item = state.estoqueIngredientes[idx];
  const emUso = state.config.receitas.some(r => r.ingredientes.some(i => i.nome === item.nome));
  if (emUso){
    toast('Esse ingrediente está em uso em alguma receita. Remova-o da receita primeiro.', 'error');
    return;
  }
  state.estoqueIngredientes = state.estoqueIngredientes.filter((_, i) => i !== idx);
  await salvarEstoqueIngredientes();
  toast('Ingrediente removido', 'success');
}

function openAjustarEstoqueModal(){
  openModal(`
    <h3>Ajustar quantidades e preços</h3>
    <form id="formEstoque">
      ${state.estoqueIngredientes.map((i, idx) => `
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field" style="margin-bottom:0;">
            <label>${i.nome} — Qtd (${i.unidade})</label>
            <input type="number" step="0.01" data-estoque-qtd="${idx}" value="${i.qtd}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Preço/unid. (R$)</label>
            <input type="number" step="0.01" data-estoque-preco="${idx}" value="${i.custoUn}">
          </div>
        </div>
      `).join('')}
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarEstoque">Cancelar</button>
        <button type="submit" class="btn">Salvar</button>
      </div>
    </form>
  `);

  $('#btnCancelarEstoque').addEventListener('click', closeModal);
  $('#formEstoque').addEventListener('submit', async (e) => {
    e.preventDefault();
    state.estoqueIngredientes = state.estoqueIngredientes.map((ing, idx) => ({
      ...ing,
      qtd: Number($(`[data-estoque-qtd="${idx}"]`).value) || 0,
      custoUn: Number($(`[data-estoque-preco="${idx}"]`).value) || 0
    }));
    await salvarEstoqueIngredientes();
    toast('Estoque atualizado', 'success');
    closeModal();
  });
}

function openCompraModal(){
  openModal(`
    <h3>Registrar compra / reposição</h3>
    <form id="formCompra">
      <div class="field">
        <label>Data</label>
        <input type="date" name="data" value="${todayISO()}" required>
      </div>
      <div class="field">
        <label>Ingrediente</label>
        <select name="ingrediente" required>
          ${state.estoqueIngredientes.map(i => `<option value="${i.nome}">${i.nome}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Quantidade comprada</label>
          <input type="number" step="0.01" name="qtd" required>
        </div>
        <div class="field">
          <label>Unidade</label>
          <input type="text" name="unidade" placeholder="kg, un, g...">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Preço unitário (R$)</label>
          <input type="number" step="0.01" name="precoUnit" required>
        </div>
        <div class="field">
          <label>Total (R$)</label>
          <input type="text" id="totalCompraPreview" readonly value="R$ 0,00">
        </div>
      </div>
      <div class="field">
        <label>Fornecedor (opcional)</label>
        <input type="text" name="fornecedor">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarCompra">Cancelar</button>
        <button type="submit" class="btn">Registrar</button>
      </div>
    </form>
  `);

  const qtdInput = $('input[name="qtd"]');
  const precoInput = $('input[name="precoUnit"]');
  const updateTotal = () => {
    const total = (Number(qtdInput.value)||0) * (Number(precoInput.value)||0);
    $('#totalCompraPreview').value = fmtBRL(total);
  };
  qtdInput.addEventListener('input', updateTotal);
  precoInput.addEventListener('input', updateTotal);

  $('#btnCancelarCompra').addEventListener('click', closeModal);
  $('#formCompra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qtd = Number(fd.get('qtd'));
    const precoUnit = Number(fd.get('precoUnit'));
    const payload = {
      data: fd.get('data'),
      ingrediente: fd.get('ingrediente'),
      qtd: qtd,
      unidade: fd.get('unidade') || '',
      precoUnit: precoUnit,
      total: Math.round(qtd * precoUnit * 100) / 100,
      fornecedor: fd.get('fornecedor') || '',
      criadoEm: serverTimestamp()
    };

    setSyncStatus('syncing');
    try{
      await addDoc(collection(db, 'compras'), payload);

      const idx = state.estoqueIngredientes.findIndex(i => i.nome === payload.ingrediente);
      if (idx >= 0){
        state.estoqueIngredientes[idx].qtd = Number(state.estoqueIngredientes[idx].qtd) + qtd;
        state.estoqueIngredientes[idx].custoUn = precoUnit;
        await salvarEstoqueIngredientes();
      }

      await addDoc(collection(db, 'caixa'), {
        data: payload.data,
        tipo: 'saida',
        descricao: `Compra: ${payload.ingrediente}`,
        valor: payload.total,
        categoria: 'Insumos',
        criadoEm: serverTimestamp()
      });

      toast('Compra registrada', 'success');
      closeModal();
    } catch(err){ console.error(err); toast('Erro ao registrar', 'error'); }
  });
}

/* ============================================================
   VENDAS — com seleção de receita/sabor
   ============================================================ */

function renderVendas(){
  const container = $('#view-vendas');
  const vendasOrdenadas = [...state.vendas].sort((a,b) => (b.data||'').localeCompare(a.data||''));

  const totalFaturado = state.vendas.reduce((s,v) => s + (Number(v.totalRecebido)||0), 0);
  const totalLucro = state.vendas.reduce((s,v) => s + (Number(v.lucro)||0), 0);
  const totalPaesVendidos = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const ticketMedio = state.vendas.length ? totalFaturado / state.vendas.length : 0;

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card accent">
        <div class="label">Faturamento total</div>
        <div class="value">${fmtBRL(totalFaturado)}</div>
      </div>
      <div class="kpi-card oliva">
        <div class="label">Lucro total</div>
        <div class="value">${fmtBRL(totalLucro)}</div>
      </div>
      <div class="kpi-card">
        <div class="label">Pães vendidos</div>
        <div class="value">${fmtNum(totalPaesVendidos)}</div>
      </div>
      <div class="kpi-card">
        <div class="label">Ticket médio</div>
        <div class="value">${fmtBRL(ticketMedio)}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span><span>Registro de vendas</span></div>
        <button class="btn sm" id="btnNovaVenda">+ Nova venda</button>
      </div>
      ${vendasOrdenadas.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Data</th><th>Receita</th><th>Cliente</th><th>Qtd</th><th>Preço un.</th><th>Total</th><th>Lucro</th><th></th></tr></thead>
            <tbody>
              ${vendasOrdenadas.map(v => {
                const r = getReceita(v.receitaId);
                return `
                <tr>
                  <td>${fmtDate(v.data)}</td>
                  <td>${r ? r.nome : '—'}</td>
                  <td>${v.cliente || '—'}</td>
                  <td>${v.qtd}</td>
                  <td>${fmtBRL(v.precoUnit)}</td>
                  <td>${fmtBRL(v.totalRecebido)}</td>
                  <td class="text-soft">${fmtBRL(v.lucro)}</td>
                  <td>
                    <button class="btn-icon" data-edit-venda="${v.id}" title="Editar">✎</button>
                    <button class="btn-icon danger" data-del-venda="${v.id}" title="Excluir">✕</button>
                  </td>
                </tr>
              `;}).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma venda registrada ainda</div>`}
    </div>
  `;

  $('#btnNovaVenda')?.addEventListener('click', () => openVendaModal());
  $$('[data-edit-venda]').forEach(b => b.addEventListener('click', () => openVendaModal(b.dataset.editVenda)));
  $$('[data-del-venda]').forEach(b => b.addEventListener('click', () => confirmarExclusao('vendas', b.dataset.delVenda)));
}

function openVendaModal(id=null){
  editingId = id;
  editingType = 'venda';
  const item = id ? state.vendas.find(v => v.id === id) : null;
  const receitaInicial = item ? item.receitaId : state.config.receitas[0]?.id;

  const totalProduzido = state.producao.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);
  const totalVendido = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const estoquePaes = Math.max(0, totalProduzido - totalVendido) + (item ? Number(item.qtd) : 0);

  openModal(`
    <h3>${item ? 'Editar venda' : 'Nova venda'}</h3>
    <div class="text-faint text-sm" style="margin-bottom:14px;">Estoque disponível (todas receitas): <strong>${fmtNum(estoquePaes)} pães</strong></div>
    <form id="formVenda">
      <div class="field">
        <label>Receita / sabor vendido</label>
        <select name="receitaId" id="selectReceitaVenda" required>
          ${state.config.receitas.map(r => `<option value="${r.id}" ${r.id===receitaInicial?'selected':''}>${r.nome}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Data da venda</label>
        <input type="date" name="data" value="${item?.data || todayISO()}" required>
      </div>
      <div class="field">
        <label>Cliente (opcional)</label>
        <input type="text" name="cliente" value="${item?.cliente || ''}" placeholder="Nome do cliente">
      </div>
      <div class="field-row">
        <div class="field">
          <label>Quantidade vendida</label>
          <input type="number" name="qtd" min="1" value="${item?.qtd || 1}" required>
        </div>
        <div class="field">
          <label>Valor total recebido (R$)</label>
          <input type="number" step="0.01" name="totalRecebido" id="totalRecebidoInput" value="${item?.totalRecebido || ''}" required>
        </div>
      </div>
      <div class="text-faint text-sm" style="margin-bottom:14px;">
        Preço unitário: <strong id="precoUnitPreview">—</strong> ·
        Lucro estimado: <strong id="lucroPreview">—</strong>
      </div>
      <div class="field">
        <label>Observações</label>
        <input type="text" name="obs" value="${item?.obs || ''}">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarVenda">Cancelar</button>
        <button type="submit" class="btn">${item ? 'Salvar' : 'Registrar'}</button>
      </div>
    </form>
  `);

  const qtdInput = $('input[name="qtd"]');
  const totalInput = $('#totalRecebidoInput');
  const receitaSelect = $('#selectReceitaVenda');

  const updatePreview = () => {
    const receita = getReceita(receitaSelect.value);
    const qtd = Number(qtdInput.value) || 0;
    if (!totalInput.value && receita){
      totalInput.placeholder = (qtd * receita.precoVenda).toFixed(2);
    }
    const total = Number(totalInput.value) || 0;
    const precoUnit = qtd ? total / qtd : 0;
    const lucro = total - (qtd * custoPorPao(receita));
    $('#precoUnitPreview').textContent = fmtBRL(precoUnit);
    $('#lucroPreview').textContent = fmtBRL(lucro);
  };
  qtdInput.addEventListener('input', updatePreview);
  totalInput.addEventListener('input', updatePreview);
  receitaSelect.addEventListener('change', updatePreview);
  updatePreview();

  $('#btnCancelarVenda').addEventListener('click', closeModal);
  $('#formVenda').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const receitaId = fd.get('receitaId');
    const receita = getReceita(receitaId);
    const qtd = Number(fd.get('qtd'));
    const totalRecebido = Number(fd.get('totalRecebido'));
    const precoUnit = qtd ? totalRecebido / qtd : 0;
    const lucro = Math.round((totalRecebido - (qtd * custoPorPao(receita))) * 100) / 100;

    const payload = {
      receitaId: receitaId,
      data: fd.get('data'),
      cliente: fd.get('cliente') || '',
      qtd: qtd,
      totalRecebido: totalRecebido,
      precoUnit: Math.round(precoUnit*100)/100,
      lucro: lucro,
      obs: fd.get('obs') || '',
      atualizadoEm: serverTimestamp()
    };

    setSyncStatus('syncing');
    try{
      if (item){
        await updateDoc(doc(db, 'vendas', item.id), payload);
        toast('Venda atualizada', 'success');
      } else {
        payload.criadoEm = serverTimestamp();
        await addDoc(collection(db, 'vendas'), payload);

        await addDoc(collection(db, 'caixa'), {
          data: payload.data,
          tipo: 'entrada',
          descricao: `Venda${payload.cliente ? ' — ' + payload.cliente : ''} (${qtd}x ${receita?.nome||''})`,
          valor: totalRecebido,
          categoria: 'Vendas',
          criadoEm: serverTimestamp()
        });

        toast('Venda registrada', 'success');
      }
      closeModal();
    } catch(err){ console.error(err); toast('Erro ao salvar', 'error'); }
  });
}

/* ============================================================
   FINANCEIRO — FLUXO DE CAIXA
   ============================================================ */

function renderFinanceiro(){
  const container = $('#view-financeiro');
  const caixaOrdenado = [...state.caixa].sort((a,b) => (a.data||'').localeCompare(b.data||''));

  let saldo = 0;
  const linhasComSaldo = caixaOrdenado.map(c => {
    saldo += c.tipo === 'entrada' ? Number(c.valor||0) : -Number(c.valor||0);
    return { ...c, saldoAcumulado: saldo };
  });
  const linhasExibidas = [...linhasComSaldo].reverse();

  const totalEntradas = state.caixa.filter(c => c.tipo === 'entrada').reduce((s,c) => s + Number(c.valor||0), 0);
  const totalSaidas = state.caixa.filter(c => c.tipo === 'saida').reduce((s,c) => s + Number(c.valor||0), 0);
  const saldoFinal = totalEntradas - totalSaidas;

  const mesesSet = new Set();
  [...state.vendas, ...state.producao].forEach(item => { const mk = monthKey(item.data); if (mk) mesesSet.add(mk); });
  const mesesOrdenados = [...mesesSet].sort().reverse().slice(0, 6);

  const resumoMensal = mesesOrdenados.map(mk => {
    const vendasM = state.vendas.filter(v => monthKey(v.data) === mk);
    const producaoM = state.producao.filter(p => monthKey(p.data) === mk);
    const faturamento = vendasM.reduce((s,v) => s + (Number(v.totalRecebido)||0), 0);
    const custo = producaoM.reduce((s,p) => s + (Number(p.custoTotal)||0), 0);
    const lucro = faturamento - custo;
    return { mk, faturamento, custo, lucro, margem: faturamento ? (lucro/faturamento*100) : 0 };
  });

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card oliva">
        <div class="label">Total entradas</div>
        <div class="value">${fmtBRL(totalEntradas)}</div>
      </div>
      <div class="kpi-card alert">
        <div class="label">Total saídas</div>
        <div class="value">${fmtBRL(totalSaidas)}</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">Saldo em caixa</div>
        <div class="value">${fmtBRL(saldoFinal)}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title"><div class="left"><span class="dot"></span><span>Resumo mensal</span></div></div>
      ${resumoMensal.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Mês</th><th>Faturamento</th><th>Custo produção</th><th>Lucro</th><th>Margem</th></tr></thead>
            <tbody>
              ${resumoMensal.map(r => `
                <tr>
                  <td>${monthLabel(r.mk)}</td>
                  <td>${fmtBRL(r.faturamento)}</td>
                  <td>${fmtBRL(r.custo)}</td>
                  <td class="text-soft">${fmtBRL(r.lucro)}</td>
                  <td>${r.margem.toFixed(0)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state"><div class="ic">○</div>Ainda sem dados suficientes</div>`}
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span><span>Fluxo de caixa</span></div>
        <div class="flex gap">
          <button class="btn outline sm" id="btnNovaEntrada">+ Entrada</button>
          <button class="btn outline sm" id="btnNovaSaida">+ Saída</button>
        </div>
      </div>
      ${linhasExibidas.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Entrada</th><th>Saída</th><th>Saldo</th><th></th></tr></thead>
            <tbody>
              ${linhasExibidas.map(c => `
                <tr>
                  <td>${fmtDate(c.data)}</td>
                  <td>${c.descricao || '—'}</td>
                  <td><span class="tag neutral">${c.categoria || '—'}</span></td>
                  <td class="text-soft">${c.tipo === 'entrada' ? fmtBRL(c.valor) : '—'}</td>
                  <td style="color:var(--vermelho);">${c.tipo === 'saida' ? fmtBRL(c.valor) : '—'}</td>
                  <td><strong>${fmtBRL(c.saldoAcumulado)}</strong></td>
                  <td><button class="btn-icon danger" data-del-caixa="${c.id}" title="Excluir">✕</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty-state"><div class="ic">○</div>Nenhum lançamento ainda</div>`}
    </div>
  `;

  $('#btnNovaEntrada')?.addEventListener('click', () => openCaixaModal('entrada'));
  $('#btnNovaSaida')?.addEventListener('click', () => openCaixaModal('saida'));
  $$('[data-del-caixa]').forEach(b => b.addEventListener('click', () => confirmarExclusao('caixa', b.dataset.delCaixa)));
}

function openCaixaModal(tipo){
  openModal(`
    <h3>${tipo === 'entrada' ? 'Nova entrada' : 'Nova saída'}</h3>
    <form id="formCaixa">
      <div class="field">
        <label>Data</label>
        <input type="date" name="data" value="${todayISO()}" required>
      </div>
      <div class="field">
        <label>Descrição</label>
        <input type="text" name="descricao" placeholder="${tipo === 'entrada' ? 'Ex: Venda avulsa' : 'Ex: Compra de embalagens'}" required>
      </div>
      <div class="field">
        <label>Valor (R$)</label>
        <input type="number" step="0.01" name="valor" required>
      </div>
      <div class="field">
        <label>Categoria</label>
        <select name="categoria">
          ${tipo === 'entrada'
            ? `<option>Vendas</option><option>Outros</option>`
            : `<option>Insumos</option><option>Gás</option><option>Embalagens</option><option>Transporte</option><option>Outros</option>`}
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarCaixa">Cancelar</button>
        <button type="submit" class="btn">Registrar</button>
      </div>
    </form>
  `);

  $('#btnCancelarCaixa').addEventListener('click', closeModal);
  $('#formCaixa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      data: fd.get('data'),
      tipo: tipo,
      descricao: fd.get('descricao'),
      valor: Number(fd.get('valor')),
      categoria: fd.get('categoria'),
      criadoEm: serverTimestamp()
    };
    setSyncStatus('syncing');
    try{
      await addDoc(collection(db, 'caixa'), payload);
      toast('Lançamento registrado', 'success');
      closeModal();
    } catch(err){ console.error(err); toast('Erro ao registrar', 'error'); }
  });
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

function init(){
  initFirebaseListeners();
  const lastView = localStorage.getItem('pdc_lastView') || 'dashboard';
  setTimeout(() => {
    if ($('#view-' + lastView)) switchView(lastView);
  }, 50);
}

init();
