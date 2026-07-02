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
const PIX_CHAVE = "12356473661";
const PIX_NOME = "EULER DA CRUZ NASCIMENTO";
const PIX_CIDADE = "RIBEIRAO VERMELHO";

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

/* ====== PIX — gera código copia e cola (padrão EMV) ====== */
function crc16(payload){
  let result = 0xFFFF;
  for (let i = 0; i < payload.length; i++){
    result ^= (payload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++){
      result = (result & 0x8000) ? ((result << 1) ^ 0x1021) : (result << 1);
      result &= 0xFFFF;
    }
  }
  return result.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value){
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function gerarPayloadPix(valor){
  const merchantAccount = emvField('00','br.gov.bcb.pix') + emvField('01', PIX_CHAVE);
  let payload =
    emvField('00','01') +
    emvField('26', merchantAccount) +
    emvField('52','0000') +
    emvField('53','986') +
    emvField('54', valor.toFixed(2)) +
    emvField('58','BR') +
    emvField('59', PIX_NOME.slice(0,25)) +
    emvField('60', PIX_CIDADE.slice(0,15)) +
    emvField('62', emvField('05','***'));
  payload += '6304';
  return payload + crc16(payload);
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
    const fotos = Array.isArray(r.fotos) ? r.fotos : (r.foto ? [r.foto] : []);
    const thumbSrc = fotos.length ? fotos[0] : null;

    const thumbHtml = thumbSrc
      ? `<img src="${thumbSrc}" alt="${r.nome}" class="produto-thumb-img">`
      : `<div class="produto-thumb-icon">${iconePorReceita(r)}</div>`;

    return `
      <div class="produto-card" data-open-produto="${r.id}" role="button" tabindex="0">
        <div class="produto-thumb-wrap">
          ${thumbHtml}
        </div>
        <div class="produto-info">
          <div class="nome">${r.nome}</div>
          <div class="preco">${fmtBRL(r.precoVenda)}</div>
        </div>
        ${qtdCarrinho > 0 ? `<div class="produto-badge">${qtdCarrinho}</div>` : ''}
      </div>
    `;
  }).join('');

  $$('[data-open-produto]').forEach(card => {
    card.addEventListener('click', () => openProdutoModal(card.dataset.openProduto));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openProdutoModal(card.dataset.openProduto);
    });
  });

  updateCarrinhoBar();
}

function openProdutoModal(receitaId){
  const r = state.receitas.find(x => x.id === receitaId);
  if (!r) return;

  const fotos = Array.isArray(r.fotos) ? r.fotos : (r.foto ? [r.foto] : []);
  const qtdAtual = state.carrinho[receitaId] || 0;

  openModal(`
    <div class="produto-modal">
      ${fotos.length ? `
        <div class="foto-galeria">
          <div class="foto-galeria-track" id="galeriaTrack">
            ${fotos.map((f, i) => `<img src="${f}" alt="${r.nome}" class="foto-galeria-img" data-idx="${i}">`).join('')}
          </div>
          ${fotos.length > 1 ? `
            <div class="foto-dots" id="fotoDots">
              ${fotos.map((_, i) => `<span class="foto-dot ${i===0?'active':''}" data-dot="${i}"></span>`).join('')}
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="foto-placeholder">${iconePorReceita(r)}</div>
      `}

      <div class="produto-modal-body">
        <button class="produto-modal-close" id="btnFecharProduto">✕</button>
        <div class="produto-modal-nome">${r.nome}</div>
        <div class="produto-modal-preco">${fmtBRL(r.precoVenda)} <span class="produto-modal-un">por unidade</span></div>

        <div class="produto-modal-qtd">
          <button class="qtd-btn" id="modalDecr" ${qtdAtual<=0?'disabled':''}>−</button>
          <span class="qtd-valor" id="modalQtd">${qtdAtual}</span>
          <button class="qtd-btn" id="modalIncr">+</button>
        </div>

        <button class="btn" id="btnAdicionarModal">
          ${qtdAtual > 0 ? `Atualizar · ${fmtBRL(qtdAtual * r.precoVenda)}` : 'Adicionar ao pedido'}
        </button>
      </div>
    </div>
  `);

  let qtd = qtdAtual;

  const updateModal = () => {
    $('#modalQtd').textContent = qtd;
    $('#modalDecr').disabled = qtd <= 0;
    $('#btnAdicionarModal').textContent = qtd > 0
      ? `Atualizar · ${fmtBRL(qtd * r.precoVenda)}`
      : 'Adicionar ao pedido';
    const valEl = $('#modalQtd');
    valEl.classList.add('bump');
    setTimeout(() => valEl.classList.remove('bump'), 350);
  };

  $('#modalIncr').addEventListener('click', () => { qtd++; updateModal(); });
  $('#modalDecr').addEventListener('click', () => { if (qtd > 0) { qtd--; updateModal(); }});

  $('#btnAdicionarModal').addEventListener('click', () => {
    if (qtd > 0){
      state.carrinho[receitaId] = qtd;
    } else {
      delete state.carrinho[receitaId];
    }
    closeModal();
    renderCardapio();
  });

  $('#btnFecharProduto').addEventListener('click', closeModal);

  // Galeria — swipe e dots
  if (fotos.length > 1){
    const track = $('#galeriaTrack');
    let current = 0;

    const goTo = (idx) => {
      current = Math.max(0, Math.min(fotos.length - 1, idx));
      track.scrollTo({ left: current * track.offsetWidth, behavior: 'smooth' });
      $$('.foto-dot').forEach((d, i) => d.classList.toggle('active', i === current));
    };

    $$('[data-dot]').forEach(d => d.addEventListener('click', () => goTo(Number(d.dataset.dot))));

    let touchStartX = 0;
    track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
    track.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) goTo(diff > 0 ? current + 1 : current - 1);
    });

    track.addEventListener('scroll', () => {
      const idx = Math.round(track.scrollLeft / track.offsetWidth);
      if (idx !== current){
        current = idx;
        $$('.foto-dot').forEach((d, i) => d.classList.toggle('active', i === current));
      }
    });
  }
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
        <label>Forma de pagamento</label>
        <div class="pagamento-opcoes">
          <label class="pagamento-opcao">
            <input type="radio" name="pagamento" value="dinheiro" checked>
            <span>Dinheiro</span>
          </label>
          <label class="pagamento-opcao">
            <input type="radio" name="pagamento" value="pix">
            <span>Pix</span>
          </label>
        </div>
      </div>
      <div id="pixArea" style="display:none;"></div>
      <div class="field">
        <label>Observações (opcional)</label>
        <textarea name="obs" rows="2" placeholder="Endereço, horário, alguma preferência..."></textarea>
      </div>
      <button type="submit" class="btn">Enviar pedido pelo WhatsApp</button>
      <button type="button" class="btn-outline" id="btnVoltarCardapio">Voltar ao cardápio</button>
    </form>
  `);

  const pixArea = $('#pixArea');
  const payloadPix = gerarPayloadPix(totalValor);

  $$('input[name="pagamento"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'pix' && radio.checked){
        pixArea.style.display = '';
        pixArea.innerHTML = `
          <div class="pix-box">
            <div class="text-sm text-soft" style="margin-bottom:8px;">Copie o código abaixo e pague no app do seu banco:</div>
            <div class="pix-codigo" id="pixCodigo">${payloadPix}</div>
            <button type="button" class="btn-outline" id="btnCopiarPix" style="margin-top:8px;">Copiar código Pix</button>
          </div>
        `;
        $('#btnCopiarPix').addEventListener('click', () => {
          navigator.clipboard.writeText(payloadPix).then(() => {
            toast('Código Pix copiado!');
          }).catch(() => {
            toast('Não foi possível copiar automaticamente');
          });
        });
      } else if (radio.value === 'dinheiro' && radio.checked){
        pixArea.style.display = 'none';
        pixArea.innerHTML = '';
      }
    });
  });

  $('#btnVoltarCardapio').addEventListener('click', closeModal);
  $('#formCheckout').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = fd.get('nome');
    const telefone = fd.get('telefone');
    const obs = fd.get('obs') || '';
    const pagamento = fd.get('pagamento') || 'dinheiro';

    const itensPedido = itens.map(([id,q]) => {
      const r = state.receitas.find(x => x.id === id);
      return { receitaId: id, nome: r?.nome || '', qtd: q, precoUnit: r?.precoVenda || 0 };
    });

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    const mensagem = montarMensagemWhatsapp(nome, itensPedido, totalValor, obs, pagamento);
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
        pagamento: pagamento,
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

function montarMensagemWhatsapp(nome, itens, total, obs, pagamento){
  let msg = `Olá! Meu nome é ${nome} e quero fazer um pedido:\n\n`;
  itens.forEach(i => {
    msg += `• ${i.qtd}x ${i.nome} — ${fmtBRL(i.precoUnit * i.qtd)}\n`;
  });
  msg += `\nTotal: ${fmtBRL(total)}`;
  msg += `\nPagamento: ${pagamento === 'pix' ? 'Pix' : 'Dinheiro'}`;
  if (obs) msg += `\n\nObservações: ${obs}`;
  return msg;
}

init();
