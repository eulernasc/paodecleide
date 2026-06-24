/* ============================================================
   PÃO DE CLEIDE — Loja do cliente
   ============================================================ */

function waitForFirebase(){
  return new Promise((resolve) => {
    if (window.__firebase) { resolve(window.__firebase); return; }
    const check = setInterval(() => {
      if (window.__firebase) { clearInterval(check); resolve(window.__firebase); }
    }, 30);
  });
}

const { db, collection, doc, addDoc, onSnapshot, query, orderBy, serverTimestamp, setDoc } = await waitForFirebase();

/* ====== CONFIGURAÇÃO DA LOJA ====== */
const WHATSAPP_NUMERO = "5535997490869"; // Número da Cleide

const state = {
  receitas: [],
  producao: [],
  vendas: [],
  carrinho: {},
  loaded: { config: false, producao: false, vendas: false }
};

/* ====== HELPERS ====== */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

function fmtBRL(n){
  n = Number(n) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toast(msg){
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity 0.3s'; setTimeout(()=>el.remove(), 300); }, 3000);
}

function openModal(html){
  $('#modalContent').innerHTML = html;
  $('#modalOverlay').classList.add('active');
}
function closeModal(){
  $('#modalOverlay').classList.remove('active');
  $('#modalContent').innerHTML = '';
}
$('#modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});

/* ====== ESTOQUE POR RECEITA (mesma lógica do painel) ====== */
function estoquePorReceita(){
  const mapa = {};
  state.receitas.forEach(r => { mapa[r.id] = 0; });
  state.producao.forEach(p => {
    if (mapa[p.receitaId] === undefined) mapa[p.receitaId] = 0;
    mapa[p.receitaId] += Number(p.paesProduzidos) || 0;
  });
  state.vendas.forEach(v => {
    if (mapa[v.receitaId] === undefined) mapa[v.receitaId] = 0;
    mapa[v.receitaId] -= Number(v.qtd) || 0;
  });
  Object.keys(mapa).forEach(k => { mapa[k] = Math.max(0, mapa[k]); });
  return mapa;
}

/* ====== FIREBASE LISTENERS (somente leitura do cardápio) ====== */
function checkInitialLoad(){
  if (state.loaded.config && state.loaded.producao && state.loaded.vendas){
    $('#loadingScreen').style.display = 'none';
    $('#app').style.display = 'block';
    renderCardapio();
  }
}

function init(){
  const configRef = doc(db, 'config', 'principal');
  onSnapshot(configRef, (snap) => {
    if (snap.exists()){
      state.receitas = snap.data().receitas || [];
    }
    state.loaded.config = true;
    checkInitialLoad();
    renderCardapio();
  });

  const producaoQuery = query(collection(db, 'producao'));
  onSnapshot(producaoQuery, (snap) => {
    state.producao = snap.docs.map(d => d.data());
    state.loaded.producao = true;
    checkInitialLoad();
    renderCardapio();
  });

  const vendasQuery = query(collection(db, 'vendas'));
  onSnapshot(vendasQuery, (snap) => {
    state.vendas = snap.docs.map(d => d.data());
    state.loaded.vendas = true;
    checkInitialLoad();
    renderCardapio();
  });
}

/* ====== CARDÁPIO ====== */
function renderCardapio(){
  const container = $('#cardapioList');
  if (!container) return;

  if (!state.receitas.length){
    container.innerHTML = `<div class="empty-cardapio">Cardápio em preparação, volte em breve!</div>`;
    return;
  }

  const estoque = estoquePorReceita();

  container.innerHTML = state.receitas.map(r => {
    const disponivel = estoque[r.id] || 0;
    const qtdCarrinho = state.carrinho[r.id] || 0;
    const semEstoque = disponivel <= 0;
    return `
      <div class="produto-card">
        <div class="produto-thumb">🧀</div>
        <div class="produto-info">
          <div class="nome">${r.nome}</div>
          <div class="preco">${fmtBRL(r.precoVenda)}</div>
          <div class="estoque-info">${semEstoque ? 'Sem estoque no momento' : disponivel + ' disponíveis'}</div>
        </div>
        <div class="qtd-control">
          <button class="qtd-btn" data-decr="${r.id}" ${qtdCarrinho<=0?'disabled':''}>−</button>
          <span class="qtd-valor">${qtdCarrinho}</span>
          <button class="qtd-btn" data-incr="${r.id}" ${semEstoque || qtdCarrinho>=disponivel?'disabled':''}>+</button>
        </div>
      </div>
    `;
  }).join('');

  $$('[data-incr]').forEach(b => b.addEventListener('click', () => alterarQtd(b.dataset.incr, 1)));
  $$('[data-decr]').forEach(b => b.addEventListener('click', () => alterarQtd(b.dataset.decr, -1)));

  updateCarrinhoBar();
}

function alterarQtd(receitaId, delta){
  const atual = state.carrinho[receitaId] || 0;
  const novo = Math.max(0, atual + delta);
  if (novo === 0){
    delete state.carrinho[receitaId];
  } else {
    state.carrinho[receitaId] = novo;
  }
  renderCardapio();
}

function updateCarrinhoBar(){
  const bar = $('#carrinhoBar');
  const itens = Object.entries(state.carrinho);
  const totalQtd = itens.reduce((s,[,q]) => s+q, 0);

  if (totalQtd === 0){
    bar.classList.add('hidden');
    return;
  }

  const totalValor = itens.reduce((s,[id,q]) => {
    const r = state.receitas.find(x => x.id === id);
    return s + (r ? r.precoVenda * q : 0);
  }, 0);

  $('#carrinhoInfo').textContent = totalQtd + (totalQtd === 1 ? ' item' : ' itens');
  $('#carrinhoTotal').textContent = fmtBRL(totalValor);
  bar.classList.remove('hidden');
}

$('#carrinhoBar').addEventListener('click', () => openCheckoutModal());

/* ====== CHECKOUT ====== */
function openCheckoutModal(){
  const itens = Object.entries(state.carrinho);
  if (!itens.length) return;

  const totalValor = itens.reduce((s,[id,q]) => {
    const r = state.receitas.find(x => x.id === id);
    return s + (r ? r.precoVenda * q : 0);
  }, 0);

  openModal(`
    <h3>Finalizar pedido</h3>
    <div class="resumo-pedido">
      ${itens.map(([id,q]) => {
        const r = state.receitas.find(x => x.id === id);
        return `<div class="resumo-item"><span>${q}x ${r?.nome || ''}</span><span>${fmtBRL((r?.precoVenda||0)*q)}</span></div>`;
      }).join('')}
      <div class="resumo-total"><span>Total</span><span>${fmtBRL(totalValor)}</span></div>
    </div>
    <form id="formCheckout">
      <div class="field">
        <label>Seu nome</label>
        <input type="text" name="nome" required placeholder="Como podemos te chamar?">
      </div>
      <div class="field">
        <label>Telefone (WhatsApp)</label>
        <input type="tel" name="telefone" required placeholder="(00) 00000-0000">
      </div>
      <div class="field">
        <label>Observações (opcional)</label>
        <textarea name="obs" rows="2" placeholder="Endereço, horário, alguma preferência..."></textarea>
      </div>
      <button type="submit" class="btn">Enviar pedido pelo WhatsApp</button>
      <button type="button" class="btn-outline" id="btnVoltarCardapio">Voltar ao cardápio</button>
    </form>
  `);

  $('#btnVoltarCardapio').addEventListener('click', closeModal);
  $('#formCheckout').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = fd.get('nome');
    const telefone = fd.get('telefone');
    const obs = fd.get('obs') || '';

    const itensPedido = itens.map(([id,q]) => {
      const r = state.receitas.find(x => x.id === id);
      return { receitaId: id, nome: r?.nome || '', qtd: q, precoUnit: r?.precoVenda || 0 };
    });

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try{
      await addDoc(collection(db, 'pedidos'), {
        cliente: nome,
        telefone: telefone,
        obs: obs,
        itens: itensPedido,
        total: totalValor,
        status: 'novo',
        criadoEm: serverTimestamp()
      });

      const mensagem = montarMensagemWhatsapp(nome, itensPedido, totalValor, obs);
      const url = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`;

      state.carrinho = {};
      closeModal();
      renderCardapio();
      toast('Pedido enviado! Abrindo WhatsApp...');

      setTimeout(() => { window.open(url, '_blank'); }, 600);
    } catch(err){
      console.error(err);
      toast('Erro ao enviar pedido, tente novamente');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar pedido pelo WhatsApp';
    }
  });
}

function montarMensagemWhatsapp(nome, itens, total, obs){
  let msg = `Olá! Meu nome é ${nome} e quero fazer um pedido:\n\n`;
  itens.forEach(i => {
    msg += `• ${i.qtd}x ${i.nome} — ${fmtBRL(i.precoUnit * i.qtd)}\n`;
  });
  msg += `\nTotal: ${fmtBRL(total)}`;
  if (obs) msg += `\n\nObservações: ${obs}`;
  return msg;
}

init();
