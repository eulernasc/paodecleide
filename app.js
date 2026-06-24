/* ============================================================
   PÃO DE CLEIDE — Sistema de Gestão
   ============================================================ */

const { db, collection, doc, addDoc, updateDoc, deleteDoc,
        onSnapshot, query, orderBy, serverTimestamp, setDoc, getDoc } = window.__firebase;

/* ====== ESTADO GLOBAL ====== */
const state = {
  config: {
    ingredientes: [
      { nome: "Polvilho", qtd: 1, unidade: "kg", custoUn: 12.00 },
      { nome: "Ovos", qtd: 8, unidade: "un", custoUn: 1.00 },
      { nome: "Peito de Frango", qtd: 1, unidade: "kg", custoUn: 23.00 },
      { nome: "Queijo", qtd: 0.2, unidade: "kg", custoUn: 11.50 },
      { nome: "Gás (uso do forno)", qtd: 1, unidade: "uso", custoUn: 2.50 },
      { nome: "Sal / Tempero", qtd: 1, unidade: "porção", custoUn: 1.00 }
    ],
    paesPerFornada: 30,
    precoVenda: 6.00,
    precoPromo2: 10.00,
    metaMensal: 1000.00
  },
  producao: [],
  estoqueIngredientes: [
    { nome: "Polvilho", qtd: 2, unidade: "kg", minimo: 0.5, consumoFornada: 1 },
    { nome: "Ovos", qtd: 16, unidade: "un", minimo: 8, consumoFornada: 8 },
    { nome: "Frango", qtd: 1, unidade: "kg", minimo: 0.5, consumoFornada: 1 },
    { nome: "Queijo", qtd: 200, unidade: "g", minimo: 50, consumoFornada: 200 },
    { nome: "Sal", qtd: 0.5, unidade: "kg", minimo: 0.1, consumoFornada: 0.05 },
    { nome: "Gás (uso)", qtd: 10, unidade: "usos", minimo: 2, consumoFornada: 1 }
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

/* ====== CUSTO CALCULADO ====== */
function custoFornada(){
  return state.config.ingredientes.reduce((sum, i) => sum + (i.qtd * i.custoUn), 0);
}
function custoPorPao(){
  const c = custoFornada();
  const n = state.config.paesPerFornada || 1;
  return c / n;
}
function lucroPorPao(){
  return state.config.precoVenda - custoPorPao();
}

/* ============================================================
   FIREBASE — LISTENERS EM TEMPO REAL
   ============================================================ */

function initFirebaseListeners(){
  setSyncStatus('syncing');

  // CONFIG (documento único)
  const configRef = doc(db, 'config', 'principal');
  onSnapshot(configRef, (snap) => {
    if (snap.exists()){
      const data = snap.data();
      state.config = { ...state.config, ...data };
    } else {
      // primeira vez — grava o padrão
      setDoc(configRef, state.config).catch(console.error);
    }
    state.configLoaded = true;
    checkInitialLoad();
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  // ESTOQUE INGREDIENTES (documento único com array)
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

  // PRODUÇÃO (coleção)
  const producaoQuery = query(collection(db, 'producao'), orderBy('data', 'desc'));
  onSnapshot(producaoQuery, (snap) => {
    state.producao = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setSyncStatus('online');
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  // VENDAS (coleção)
  const vendasQuery = query(collection(db, 'vendas'), orderBy('data', 'desc'));
  onSnapshot(vendasQuery, (snap) => {
    state.vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  // COMPRAS / REPOSIÇÃO (coleção)
  const comprasQuery = query(collection(db, 'compras'), orderBy('data', 'desc'));
  onSnapshot(comprasQuery, (snap) => {
    state.compras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });

  // FLUXO DE CAIXA (coleção)
  const caixaQuery = query(collection(db, 'caixa'), orderBy('data', 'desc'));
  onSnapshot(caixaQuery, (snap) => {
    state.caixa = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderView(getCurrentView());
  }, (err) => { console.error(err); setSyncStatus('offline'); });
}

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

/* ====== CRUD HELPERS ====== */
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
        <div class="left"><span class="dot"></span>Meta do mês</div>
        <span class="text-soft text-sm">${fmtBRL(faturamentoMes)} de ${fmtBRL(state.config.metaMensal)}</span>
      </div>
      <div class="progress-bar"><div class="fill" style="width:${Math.min(100,metaPct).toFixed(0)}%"></div></div>
      <div class="text-faint text-sm" style="margin-top:8px;">${metaPct.toFixed(0)}% da meta mensal atingida · ${fornadasMes} fornadas · ${paesProduzidosMes} pães produzidos este mês</div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title">
          <div class="left"><span class="dot"></span>Últimas vendas</div>
          <button class="btn sm" id="btnNovaVendaDash">+ Nova venda</button>
        </div>
        ${ultimasVendas.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Data</th><th>Cliente</th><th>Qtd</th><th>Total</th><th>Lucro</th></tr></thead>
              <tbody>
                ${ultimasVendas.map(v => `
                  <tr>
                    <td>${fmtDate(v.data)}</td>
                    <td>${v.cliente || '—'}</td>
                    <td>${v.qtd}</td>
                    <td>${fmtBRL(v.totalRecebido)}</td>
                    <td class="text-soft">${fmtBRL(v.lucro)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma venda registrada ainda</div>`}
      </div>

      <div class="card">
        <div class="section-title"><div class="left"><span class="dot"></span>Estoque de ingredientes</div></div>
        ${state.estoqueIngredientes.map(i => {
          const baixo = Number(i.qtd) < Number(i.minimo);
          return `
            <div class="flex between center" style="padding:8px 0; border-bottom:1px solid var(--line);">
              <div>
                <div style="font-weight:500; font-size:13px;">${i.nome}</div>
                <div class="text-faint text-sm">${fmtNum(i.qtd, i.unidade==='kg'?2:0)} ${i.unidade}</div>
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
   PRODUÇÃO
   ============================================================ */

function renderProducao(){
  const container = $('#view-producao');
  const cf = custoFornada();
  const cp = custoPorPao();

  const totalProduzido = state.producao.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);
  const totalVendido = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const estoquePaes = Math.max(0, totalProduzido - totalVendido);
  const custoTotalGasto = state.producao.reduce((s,p) => s + (Number(p.custoTotal)||0), 0);

  const producaoOrdenada = [...state.producao].sort((a,b) => (b.data||'').localeCompare(a.data||''));

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="label">Custo por fornada</div>
        <div class="value">${fmtBRL(cf)}</div>
        <div class="sub">${state.config.paesPerFornada} pães por fornada</div>
      </div>
      <div class="kpi-card accent">
        <div class="label">Custo por pão</div>
        <div class="value">${fmtBRL(cp)}</div>
        <div class="sub">baseado na receita atual</div>
      </div>
      <div class="kpi-card">
        <div class="label">Total produzido</div>
        <div class="value">${fmtNum(totalProduzido)}</div>
        <div class="sub">desde o início</div>
      </div>
      <div class="kpi-card oliva">
        <div class="label">Em estoque agora</div>
        <div class="value">${fmtNum(estoquePaes)}</div>
        <div class="sub">prontos para venda</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title">
          <div class="left"><span class="dot"></span>Registro de fornadas</div>
          <button class="btn sm" id="btnNovaFornada">+ Nova fornada</button>
        </div>
        ${producaoOrdenada.length ? `
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Data</th><th>Fornadas</th><th>Pães</th><th>Custo</th><th></th></tr></thead>
              <tbody>
                ${producaoOrdenada.map(p => `
                  <tr>
                    <td>${fmtDate(p.data)}</td>
                    <td>${p.fornadas}</td>
                    <td>${p.paesProduzidos}</td>
                    <td>${fmtBRL(p.custoTotal)}</td>
                    <td>
                      <button class="btn-icon" data-edit-prod="${p.id}" title="Editar">✎</button>
                      <button class="btn-icon danger" data-del-prod="${p.id}" title="Excluir">✕</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div class="empty-state"><div class="ic">○</div>Nenhuma fornada registrada ainda</div>`}
      </div>

      <div class="card">
        <div class="section-title"><div class="left"><span class="dot"></span>Receita base (custo)</div></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Ingrediente</th><th>Qtd</th><th>Custo</th></tr></thead>
            <tbody>
              ${state.config.ingredientes.map((i, idx) => `
                <tr>
                  <td>${i.nome}</td>
                  <td>${i.qtd} ${i.unidade}</td>
                  <td>${fmtBRL(i.qtd * i.custoUn)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex between" style="margin-top:14px; padding-top:14px; border-top:1px solid var(--line);">
          <strong>Total da fornada</strong>
          <strong class="text-soft">${fmtBRL(cf)}</strong>
        </div>
        <button class="btn outline full" id="btnEditarReceita" style="margin-top:14px;">Editar receita e custos</button>
      </div>
    </div>
  `;

  $('#btnNovaFornada')?.addEventListener('click', () => openProducaoModal());
  $('#btnEditarReceita')?.addEventListener('click', () => openReceitaModal());
  $$('[data-edit-prod]').forEach(b => b.addEventListener('click', () => openProducaoModal(b.dataset.editProd)));
  $$('[data-del-prod]').forEach(b => b.addEventListener('click', () => confirmarExclusao('producao', b.dataset.delProd)));
}

function openProducaoModal(id=null){
  editingId = id;
  editingType = 'producao';
  const item = id ? state.producao.find(p => p.id === id) : null;

  openModal(`
    <h3>${item ? 'Editar fornada' : 'Nova fornada'}</h3>
    <form id="formProducao">
      <div class="field">
        <label>Data da produção</label>
        <input type="date" name="data" value="${item?.data || todayISO()}" required>
      </div>
      <div class="field">
        <label>Quantidade de fornadas</label>
        <input type="number" name="fornadas" min="0.5" step="0.5" value="${item?.fornadas || 1}" required>
      </div>
      <div class="text-faint text-sm" style="margin-bottom: 14px;">
        Custo estimado: <strong id="custoPreview">${fmtBRL(custoFornada())}</strong> ·
        Pães estimados: <strong id="paesPreview">${state.config.paesPerFornada}</strong>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarProd">Cancelar</button>
        <button type="submit" class="btn">${item ? 'Salvar' : 'Registrar'}</button>
      </div>
    </form>
  `);

  const fornadasInput = $('input[name="fornadas"]');
  const updatePreview = () => {
    const f = Number(fornadasInput.value) || 0;
    $('#custoPreview').textContent = fmtBRL(custoFornada() * f);
    $('#paesPreview').textContent = fmtNum(state.config.paesPerFornada * f);
  };
  fornadasInput.addEventListener('input', updatePreview);
  updatePreview();

  $('#btnCancelarProd').addEventListener('click', closeModal);
  $('#formProducao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fornadas = Number(fd.get('fornadas'));
    const payload = {
      data: fd.get('data'),
      fornadas: fornadas,
      paesProduzidos: Math.round(fornadas * state.config.paesPerFornada),
      custoTotal: Math.round(fornadas * custoFornada() * 100) / 100,
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
        await descontarEstoquePorFornada(fornadas);
      }
      closeModal();
    } catch(err){ console.error(err); toast('Erro ao salvar', 'error'); }
  });
}

async function descontarEstoquePorFornada(fornadas){
  const novoEstoque = state.estoqueIngredientes.map(i => ({
    ...i,
    qtd: Math.max(0, Number(i.qtd) - (Number(i.consumoFornada)||0) * fornadas)
  }));
  state.estoqueIngredientes = novoEstoque;
  await salvarEstoqueIngredientes();
}

function openReceitaModal(){
  openModal(`
    <h3>Receita e custos base</h3>
    <form id="formReceita">
      ${state.config.ingredientes.map((ing, idx) => `
        <div class="field-row three" style="margin-bottom:6px; align-items:end;">
          <div class="field" style="margin-bottom:0;">
            <label>${idx===0?'Ingrediente':''}</label>
            <input type="text" data-ing-nome="${idx}" value="${ing.nome}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>${idx===0?'Quantidade':''}</label>
            <input type="number" step="0.01" data-ing-qtd="${idx}" value="${ing.qtd}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>${idx===0?'Custo (R$)':''}</label>
            <input type="number" step="0.01" data-ing-custo="${idx}" value="${ing.custoUn}">
          </div>
        </div>
      `).join('')}

      <div class="field" style="margin-top:14px;">
        <label>Pães por fornada</label>
        <input type="number" name="paesPerFornada" value="${state.config.paesPerFornada}" required>
      </div>
      <div class="field">
        <label>Preço de venda unitário (R$)</label>
        <input type="number" step="0.01" name="precoVenda" value="${state.config.precoVenda}" required>
      </div>
      <div class="field">
        <label>Preço promoção "2 por" (R$)</label>
        <input type="number" step="0.01" name="precoPromo2" value="${state.config.precoPromo2}">
      </div>
      <div class="field">
        <label>Meta de faturamento mensal (R$)</label>
        <input type="number" step="0.01" name="metaMensal" value="${state.config.metaMensal}">
      </div>

      <div class="modal-actions">
        <button type="button" class="btn outline" id="btnCancelarReceita">Cancelar</button>
        <button type="submit" class="btn">Salvar</button>
      </div>
    </form>
  `);

  $('#btnCancelarReceita').addEventListener('click', closeModal);
  $('#formReceita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const novosIngredientes = state.config.ingredientes.map((ing, idx) => ({
      nome: $(`[data-ing-nome="${idx}"]`).value || ing.nome,
      qtd: Number($(`[data-ing-qtd="${idx}"]`).value) || 0,
      unidade: ing.unidade,
      custoUn: Number($(`[data-ing-custo="${idx}"]`).value) || 0
    }));

    state.config = {
      ...state.config,
      ingredientes: novosIngredientes,
      paesPerFornada: Number(fd.get('paesPerFornada')),
      precoVenda: Number(fd.get('precoVenda')),
      precoPromo2: Number(fd.get('precoPromo2')),
      metaMensal: Number(fd.get('metaMensal'))
    };

    await salvarConfig();
    closeModal();
  });
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
   ESTOQUE DE INGREDIENTES
   ============================================================ */

function renderEstoque(){
  const container = $('#view-estoque');
  const itensBaixo = state.estoqueIngredientes.filter(i => Number(i.qtd) < Number(i.minimo));
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
      <div class="kpi-card">
        <div class="label">Gasto em compras (mês)</div>
        <div class="value">${fmtBRL(totalComprasMes)}</div>
        <div class="sub">${monthLabel(monthKey(todayISO()))}</div>
      </div>
      <div class="kpi-card">
        <div class="label">Itens cadastrados</div>
        <div class="value">${state.estoqueIngredientes.length}</div>
        <div class="sub">ingredientes monitorados</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span>Ingredientes em estoque</div>
        <button class="btn sm" id="btnAjustarEstoque">Ajustar quantidades</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Ingrediente</th><th>Qtd. atual</th><th>Mínimo</th><th>Consumo/fornada</th><th>Status</th></tr></thead>
          <tbody>
            ${state.estoqueIngredientes.map((i, idx) => {
              const baixo = Number(i.qtd) < Number(i.minimo);
              return `
                <tr>
                  <td>${i.nome}</td>
                  <td>${fmtNum(i.qtd, i.unidade==='kg'?2:0)} ${i.unidade}</td>
                  <td>${fmtNum(i.minimo, i.unidade==='kg'?2:0)} ${i.unidade}</td>
                  <td>${fmtNum(i.consumoFornada, i.unidade==='kg'?2:0)} ${i.unidade}</td>
                  <td><span class="tag ${baixo ? 'low' : 'ok'}">${baixo ? 'Repor' : 'OK'}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        <div class="left"><span class="dot"></span>Histórico de compras / reposição</div>
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
  $('#btnNovaCompra')?.addEventListener('click', () => openCompraModal());
  $$('[data-del-compra]').forEach(b => b.addEventListener('click', () => confirmarExclusao('compras', b.dataset.delCompra)));
}

function openAjustarEstoqueModal(){
  openModal(`
    <h3>Ajustar quantidades em estoque</h3>
    <form id="formEstoque">
      ${state.estoqueIngredientes.map((i, idx) => `
        <div class="field">
          <label>${i.nome} (${i.unidade})</label>
          <input type="number" step="0.01" data-estoque-qtd="${idx}" value="${i.qtd}">
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
      qtd: Number($(`[data-estoque-qtd="${idx}"]`).value) || 0
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

      // soma no estoque
      const idx = state.estoqueIngredientes.findIndex(i => i.nome === payload.ingrediente);
      if (idx >= 0){
        state.estoqueIngredientes[idx].qtd = Number(state.estoqueIngredientes[idx].qtd) + qtd;
        await salvarEstoqueIngredientes();
      }

      // registra saída de caixa automaticamente
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
   VENDAS
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
        <div class="left"><span class="dot"></span>Registro de vendas</div>
        <button class="btn sm" id="btnNovaVenda">+ Nova venda</button>
      </div>
      ${vendasOrdenadas.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Data</th><th>Cliente</th><th>Qtd</th><th>Preço un.</th><th>Total</th><th>Lucro</th><th></th></tr></thead>
            <tbody>
              ${vendasOrdenadas.map(v => `
                <tr>
                  <td>${fmtDate(v.data)}</td>
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
              `).join('')}
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

  const totalProduzido = state.producao.reduce((s,p) => s + (Number(p.paesProduzidos)||0), 0);
  const totalVendido = state.vendas.reduce((s,v) => s + (Number(v.qtd)||0), 0);
  const estoquePaes = Math.max(0, totalProduzido - totalVendido) + (item ? Number(item.qtd) : 0);

  openModal(`
    <h3>${item ? 'Editar venda' : 'Nova venda'}</h3>
    <div class="text-faint text-sm" style="margin-bottom:14px;">Estoque disponível: <strong>${fmtNum(estoquePaes)} pães</strong></div>
    <form id="formVenda">
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
          <input type="number" step="0.01" name="totalRecebido" value="${item?.totalRecebido || ''}" placeholder="${(state.config.precoVenda).toFixed(2)}" required>
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
  const totalInput = $('input[name="totalRecebido"]');
  const updatePreview = () => {
    const qtd = Number(qtdInput.value) || 0;
    const total = Number(totalInput.value) || 0;
    const precoUnit = qtd ? total / qtd : 0;
    const lucro = total - (qtd * custoPorPao());
    $('#precoUnitPreview').textContent = fmtBRL(precoUnit);
    $('#lucroPreview').textContent = fmtBRL(lucro);
  };
  qtdInput.addEventListener('input', updatePreview);
  totalInput.addEventListener('input', updatePreview);
  updatePreview();

  $('#btnCancelarVenda').addEventListener('click', closeModal);
  $('#formVenda').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qtd = Number(fd.get('qtd'));
    const totalRecebido = Number(fd.get('totalRecebido'));
    const precoUnit = qtd ? totalRecebido / qtd : 0;
    const lucro = Math.round((totalRecebido - (qtd * custoPorPao())) * 100) / 100;

    const payload = {
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

        // registra entrada de caixa automaticamente
        await addDoc(collection(db, 'caixa'), {
          data: payload.data,
          tipo: 'entrada',
          descricao: `Venda${payload.cliente ? ' — ' + payload.cliente : ''} (${qtd} pães)`,
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

  // resumo mensal (últimos 6 meses com dados)
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
      <div class="section-title"><div class="left"><span class="dot"></span>Resumo mensal</div></div>
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
        <div class="left"><span class="dot"></span>Fluxo de caixa</div>
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
