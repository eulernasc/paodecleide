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
  carrinho: {},
  loaded: { config: false }
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

/* ====== FIREBASE LISTENERS (somente leitura do cardápio) ====== */
function checkInitialLoad(){
  if (state.loaded.config){
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
}

/* ====== ÍCONES DE PRODUTO ====== */
const ICON_PAO_QUEIJO = `<svg viewBox="0 0 56 56" width="32" height="32"><circle cx="28" cy="30" r="20" fill="#D9925E"/><circle cx="28" cy="28" r="20" fill="#C9824F"/><circle cx="18" cy="22" r="2" fill="#8A5028" opacity="0.6"/><circle cx="32" cy="18" r="1.8" fill="#8A5028" opacity="0.6"/><circle cx="38" cy="28" r="2.2" fill="#8A5028" opacity="0.6"/><circle cx="22" cy="36" r="1.6" fill="#8A5028" opacity="0.6"/><circle cx="34" cy="38" r="1.8" fill="#8A5028" opacity="0.6"/></svg>`;

const ICON_COXINHA = `<svg viewBox="0 0 56 56" width="32" height="32"><path d="M28 12 Q36 12 39 26 Q42 40 28 46 Q14 40 17 26 Q20 12 28 12 Z" fill="#D9924F"/><path d="M28 12 Q36 12 39 26 Q42 40 28 46 Q14 40 17 26 Q20 12 28 12 Z" fill="none" stroke="#8A5028" stroke-width="1" opacity="0.5"/><path d="M21 24 Q28 18 35 24" stroke="#8A5028" stroke-width="1.2" fill="none" opacity="0.5"/><path d="M19 33 Q28 27 37 33" stroke="#8A5028" stroke-width="1.2" fill="none" opacity="0.5"/></svg>`;
const ICON_GENERICO = `<svg viewBox="0 0 56 56" width="32" height="32"><circle cx="28" cy="28" r="20" fill="#D9925E"/></svg>`;

function iconePorReceita(receita){
  if (receita.foto) return `<img src="${receita.foto}" alt="${receita.nome}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  const nome = (receita.nome || '').toLowerCase();
  if (nome.includes('coxinha')) return ICON_COXINHA;
  if (nome.includes('queijo') || nome.includes('pão')) return ICON_PAO_QUEIJO;
  return ICON_GENERICO;
}

/* ====== CARDÁPIO ====== */
function renderCardapio(){
  const container = $('#cardapioList');
  if (!container) return;

  if (!state.receitas.length){
    container.innerHTML = `<div class="empty-cardapio">Cardápio em preparação, volte em breve!</div>`;
    return;
  }

  container.innerHTML = state.receitas.map(r => {
    const qtdCarrinho = state.carrinho[r.id] || 0;
    return `
      <div class="produto-card">
        <div class="produto-thumb">${iconePorReceita(r)}</div>
        <div class="produto-info">
          <div class="nome">${r.nome}</div>
          <div class="preco">${fmtBRL(r.precoVenda)}</div>
        </div>
        <div class="qtd-control">
          <button class="qtd-btn" data-decr="${r.id}" ${qtdCarrinho<=0?'disabled':''}>−</button>
          <span class="qtd-valor">${qtdCarrinho}</span>
          <button class="qtd-btn" data-incr="${r.id}">+</button>
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

    const mensagem = montarMensagemWhatsapp(nome, itensPedido, totalValor, obs);
    const url = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensagem)}`;

    const novaJanela = window.open(url, '_blank');

    state.carrinho = {};
    closeModal();
    renderCardapio();
    toast('Pedido enviado! Abrindo WhatsApp...');

    try{
      await addDoc(collection(db, 'pedidos'), {
        cliente: nome,
        telefone: telefone,
        obs: obs,
        itens: itensPedido,
        total: totalValor,
        status: 'novo',
        pago: false,
        criadoEm: serverTimestamp()
      });
    } catch(err){
      console.error(err);
    }

    if (!novaJanela){
      window.location.href = url;
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
