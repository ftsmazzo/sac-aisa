const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const U = s => clean(s).toUpperCase();
const stripAcc = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function iso(y, mo, d){
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if(dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function parseDate(s){
  s = clean(s); if(!s) return '';
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){ let y = +m[3]; if(y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? iso(+m[1], +m[2], +m[3]) : '';
}
const diasEntre = (a, b) => (a && b) ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null;
function parseMoney(s){
  s = clean(s).replace(/R\$/gi, '').replace(/\s/g, '');
  if(!s || s === '-') return 0;
  if(s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const custoTotal = r => (r.freteEnvio || 0) + (r.freteRetorno || 0) + (r.valorPeca || 0) + (r.estorno || 0) + (r.desconto || 0) + (r.guia || 0);
const tempoDe = r => diasEntre(r.data, r.dataAcao);

/* normalizações (a planilha tem variações de digitação) */
function normSetor(s){
  s = U(s); if(!s) return '';
  if(s.includes('ADMIN')) return 'ADMIN';
  if(s.includes('USINAG')) return 'USINAGEM';
  const m = s.match(/(\d+)/);
  return m ? 'SETOR ' + String(+m[1]).padStart(2, '0') : s;
}
const EMPRESAS = {ARTAMQ:'ARTMAQ'};
function normEmpresa(s){ s = U(s); return EMPRESAS[s] || s; }
const CANAIS = {SHOPPE:'SHOPEE', SHOPE:'SHOPEE', STE:'SITE', 'MERCAO LIVRE':'MERCADO LIVRE', ZAP:'WHATSAPP'};
function normCanal(s){ s = U(s); return CANAIS[s] || s; }
function normTransp(s){
  s = U(s); if(!s) return '';
  if(/^CORR+EIO/.test(s)) return 'CORREIOS';
  if(s.includes('DIA E NOITE')) return 'DIA E NOITE';
  if(s.startsWith('RODONAVES')) return 'RODONAVES';
  return s;
}
function normLaudo(s){
  s = U(s); if(!s) return '';
  const t = stripAcc(s);
  if(/FALTANDO/.test(t)) return 'FALTANDO PEÇAS/ACESSÓRIOS';
  if(/ERRADO/.test(t)) return 'PRODUTO/ENVIO ERRADO';
  if(/AVARIA/.test(t)) return 'AVARIA';
  if(/DEFEITO|MAL FUNCION|QUEBRAD/.test(t)) return 'PRODUTO COM DEFEITO';
  if(/ARREPEND/.test(t)) return 'ARREPENDIMENTO';
  if(/TRANSPORTE|ENTREGA/.test(t)) return 'TRANSPORTE/ENTREGA';
  return s;
}
function normProc(s){
  const t = stripAcc(U(s));
  if(!t) return '';
  if(/^N/.test(t) && /PROCEDE/.test(t)) return 'NÃO PROCEDE';
  return /PROCEDE/.test(t) ? 'PROCEDE' : U(s);
}
function normGarantia(s){ const t = stripAcc(U(s)); return /^S/.test(t) ? 'SIM' : /^N/.test(t) ? 'NÃO' : ''; }
function normUF(s){ const m = stripAcc(U(s)).match(/[A-Z]{2}/); return m ? m[0] : ''; }

/* leitura da planilha colada / CSV */
function detectarDelim(l){
  const t = (l.match(/\t/g) || []).length, s = (l.match(/;/g) || []).length, c = (l.match(/,/g) || []).length;
  return (t > 0 && t >= s && t >= c) ? '\t' : (s >= c && s > 0 ? ';' : ',');
}
function splitLinha(linha, delim){
  const raw = linha.split(delim), out = [];
  for(let i = 0; i < raw.length; i++){
    let c = raw[i];
    if(c.startsWith('"') && !(c.length > 1 && c.endsWith('"'))){
      let acc = c, j = i;
      while(j + 1 < raw.length && j - i < 3){ j++; acc += ' ' + raw[j]; if(raw[j].endsWith('"')) break; }
      if(acc.endsWith('"')){ c = acc; i = j; }
    }
    out.push(c.replace(/^"+|"+$/g, ''));
  }
  return out;
}
const CAMPOS = {
  reg:k => k.includes('REGISTRO'), data:k => k.startsWith('DATADARECLAMA'), empresa:k => k === 'EMPRESA', setor:k => k === 'SETOR',
  sku:k => k === 'SKU', produto:k => k === 'PRODUTO', familia:k => k === 'FAMILIA', garantia:k => k === 'GARANTIA',
  canal:k => k.startsWith('CANAL'), protocolo:k => k.includes('PROTOCOLO'), cliente:k => k.includes('NOMEDOCLIENTE') || k === 'CLIENTE',
  cidade:k => k === 'CIDADE', uf:k => k === 'UF', reclamacao:k => k.startsWith('RECLAMACAO'), laudo:k => k === 'LAUDO',
  procedencia:k => k.startsWith('ANALISE'), solucao:k => k === 'SOLUCAO', dataAcao:k => k.startsWith('DATADAACAO'),
  tempo:k => k.startsWith('TEMPO'), obs:k => k.startsWith('OBSERVACAO'), transp:k => k === 'TRANSPORTADORA',
  freteEnvio:k => k === 'FRETEENVIO', freteRetorno:k => k === 'FRETERETORNO', valorPeca:k => k === 'VALORPECA',
  estorno:k => k === 'ESTORNO', desconto:k => k === 'DESCONTO', guia:k => k === 'GUIA', custo:k => k === 'CUSTOTOTAL'
};
const chaveCol = h => stripAcc(h).toUpperCase().replace(/[^A-Z0-9]/g, '');

function parsePlanilha(texto){
  const avisos = [], regs = [];
  const linhas = String(texto || '').split(/\r?\n/).filter(l => l.trim() !== '');
  const hi = linhas.findIndex(l => /SKU/i.test(l) && /LAUDO/i.test(stripAcc(l)));
  if(hi < 0) return {regs, avisos:['Não encontrei a linha de títulos (precisa ter as colunas SKU e LAUDO).'], lidas:0, ok:false};
  const delim = detectarDelim(linhas[hi]);
  const keys = splitLinha(linhas[hi], delim).map(chaveCol);
  const idx = {};
  Object.keys(CAMPOS).forEach(f => { idx[f] = keys.findIndex(CAMPOS[f]); });
  const faltam = ['data', 'sku', 'reclamacao', 'laudo'].filter(f => idx[f] < 0);
  if(faltam.length) avisos.push('Colunas não encontradas: ' + faltam.join(', '));
  let lidas = 0;
  linhas.slice(hi + 1).forEach((l, n) => {
    const cells = splitLinha(l, delim);
    if(cells.filter(c => clean(c)).length < 3) return;
    lidas++;
    const g = f => idx[f] >= 0 ? (cells[idx[f]] ?? '') : '';
    const r = {
      id: uid(), reg: parseInt(clean(g('reg')), 10) || null, data: parseDate(g('data')), empresa: normEmpresa(g('empresa')),
      setor: normSetor(g('setor')), sku: U(g('sku')), produto: clean(g('produto')), familia: U(g('familia')),
      garantia: normGarantia(g('garantia')), canal: normCanal(g('canal')), protocolo: clean(g('protocolo')),
      cliente: clean(g('cliente')), cidade: clean(g('cidade')), uf: normUF(g('uf')), reclamacao: clean(g('reclamacao')),
      laudo: normLaudo(g('laudo')), procedencia: normProc(g('procedencia')), solucao: clean(g('solucao')),
      dataAcao: parseDate(g('dataAcao')), obs: clean(g('obs')), transp: normTransp(g('transp')),
      freteEnvio: parseMoney(g('freteEnvio')), freteRetorno: parseMoney(g('freteRetorno')), valorPeca: parseMoney(g('valorPeca')),
      estorno: parseMoney(g('estorno')), desconto: parseMoney(g('desconto')), guia: parseMoney(g('guia'))
    };
    const rot = r.reg ? '#' + r.reg : 'linha ' + (n + 1);
    if(!r.data) avisos.push(`${rot}: data da reclamação vazia ou inválida`);
    const custoPlan = parseMoney(g('custo')), custoCalc = custoTotal(r);
    if(Math.abs(custoPlan - custoCalc) > 0.009) avisos.push(`${rot}: custo total da planilha (${custoPlan.toFixed(2)}) difere da soma das colunas (${custoCalc.toFixed(2)})`);
    if(/ESTORN/.test(stripAcc(U(r.solucao))) && !r.estorno && custoCalc > 0) avisos.push(`${rot}: a solução fala em estorno, mas o valor está em outra coluna (frete/peça) — confira`);
    const tPlan = clean(g('tempo')), tCalc = tempoDe(r);
    if(tPlan !== '' && tCalc !== null && +tPlan !== tCalc) avisos.push(`${rot}: tempo da planilha (${tPlan}) difere das datas (${tCalc})`);
    regs.push(r);
  });
  return {regs, avisos, lidas, ok:true};
}

/* vínculo com a base de produtos */
function montarIndice(base){
  const m = new Map();
  base.forEach(p => {
    const k = U(p.cod);
    if(k && (!m.has(k) || (m.get(k).status !== 'ATIVO' && p.status === 'ATIVO'))) m.set(k, p);
  });
  return m;
}
function resolverSku(idx, sku){
  const toks = U(sku).split(/[\/+,;\s]+/).filter(Boolean);
  for(const t of toks){
    if(idx.has(t)) return idx.get(t);
    const t2 = t.replace(/^\d+(?=[A-Z])/, '');
    if(idx.has(t2)) return idx.get(t2);
  }
  return null;
}
const empresaDeCat = c => /AISA/.test(c || '') ? 'AISA' : /ARAUCA/.test(c || '') ? 'ARAUCA' : /ARTMAQ/.test(c || '') ? 'ARTMAQ' : '';

/* ===== Classificação do problema → causa → setor responsável ===== */
const SETORES_RESP = ['Embalagem / Expedição', 'Montagem', 'Solda', 'Pintura / Acabamento', 'Corte e Dobra', 'Qualidade / Engenharia', 'Compras', 'Logística', 'Comercial / Anúncios', 'Comercial / Pedidos', 'PCP', 'SAC / Pós-venda'];
const R = {
  faltando: (L, T) => /FALTANDO/.test(L) || /FALTOU|FOI FALTANDO|NAO FOI ENVIADO|NAO FORAM ENVIADOS/.test(T),
  errado: L => /ERRADO/.test(L)
};
const CAUSAS = [
  {id:'prazo', cat:'Prazo e entrega', nome:'Prazo de produção / entrega', setor:'PCP',
    acao:'Comparar o prazo prometido no anúncio com a capacidade real de produção e avisar o cliente antes de vencer.',
    t:(L, T) => /PRAZO|ATRASO/.test(L) || /PRAZO|ATRASO NO ENVIO|TEMPO DE PRODUCAO|AGUARDAR/.test(T)},
  {id:'entrega', cat:'Prazo e entrega', nome:'Extravio / entrega não realizada', setor:'Logística',
    acao:'Abrir ocorrência na transportadora, reenviar ou estornar rápido e avaliar troca de transportadora nas rotas com recorrência.',
    t:(L, T) => /TRANSPORTE|ENTREGA/.test(L) || /EXTRAVI|PERDEU A|NAO (QUIS )?(REALIZ|EFETU)\w* A ENTREGA|NAO REALIZOU A ENTREGA|NAO EFETUOU A ENTREGA|FILIAL DO DESTINO/.test(T)},
  {id:'anuncio', cat:'Venda e cadastro', nome:'Anúncio / cadastro divergente', setor:'Comercial / Anúncios',
    acao:'Conferir título, fotos, variação e SKU do anúncio (refrigerada ou não, nº de cubas, modelo) antes de publicar ou alterar.',
    t:(L, T) => /ANUNCIO|ALTERADO SKU|SKU NO ML|SITE PUXOU|CODIGO DIFERENTE/.test(T)},
  {id:'lancamento', cat:'Venda e cadastro', nome:'Erro de lançamento do pedido', setor:'Comercial / Pedidos',
    acao:'Dupla checagem de código × descrição na digitação do pedido.',
    t:(L, T) => /LANCADO|LANCAMENTO/.test(T)},
  {id:'arrepend', cat:'Venda e cadastro', nome:'Cliente desistiu / produto não atendeu', setor:'Comercial / Anúncios',
    acao:'Oferecer orientação ou troca antes do estorno e revisar o que o anúncio promete (tamanho, capacidade, uso).',
    t:(L, T) => /ARREPEN/.test(L) || /DESIST|NAO ATENDEU|NAO CONSEGUE FAZER|ACHOU .*PEQUENO|NAO SUPORTA CORTAR|NAO COMPORTA|AGRADOU|OPTOU PELA/.test(T)},
  {id:'pecas', cat:'Venda e cadastro', nome:'Compra de peça / assistência (não é falha)', setor:'SAC / Pós-venda',
    acao:'Tratar como venda de peça de reposição, fora do indicador de reclamações.',
    t:(L, T) => /ASSISTENCIA|REPOSICAO/.test(L)},
  {id:'manipulo', cat:'Produto', nome:'Manípulo quebrado (máquinas de corte e vinco)', setor:'Qualidade / Engenharia',
    acao:'Avaliar reforço do manípulo ou da embalagem e acompanhar a recorrência por modelo de máquina.',
    t:(L, T) => /MANIPULO|MANOPLA/.test(T) && /QUEBRAD|QUEBROU/.test(T)},
  {id:'voltagem', cat:'Envio errado', nome:'Voltagem errada', setor:'Montagem',
    acao:'Conferir a voltagem na montagem e na expedição, com checklist e foto da etiqueta.',
    t:(L, T) => R.errado(L) && /VOLTAGEM|\b(110|127|220) ?V?\b.*\b(110|127|220) ?V?\b/.test(T)},
  {id:'cubas', cat:'Envio errado', nome:'Cubas trocadas (inox × acrílico)', setor:'Montagem',
    acao:'Conferir o material das cubas contra o pedido antes de fechar a condimentadora.',
    t:(L, T) => R.errado(L) && /CUBA/.test(T) && /ACRIL|ACRI\b|INOX/.test(T)},
  {id:'erro_envio', cat:'Envio errado', nome:'Produto, modelo ou tamanho trocado', setor:'Embalagem / Expedição',
    acao:'Conferência por código na separação e na embalagem antes de fechar a caixa.',
    t:(L, T) => R.errado(L)},
  {id:'kit', cat:'Item faltando', nome:'Kit de montagem faltando (parafusos, mãos francesas, pés)', setor:'Embalagem / Expedição',
    acao:'Padronizar o kit de montagem por produto e conferir por checklist na embalagem.',
    t:(L, T) => R.faltando(L, T) && /PARAFUSO|MAO(S)? FRANCESA|PEZINHO|KIT DE PE|\bPES\b|APOIO|ADESIVO|BORRACHA|MONTAGEM|COLUNA/.test(T)},
  {id:'unidade', cat:'Item faltando', nome:'Unidade ou produto faltando no pedido', setor:'Embalagem / Expedição',
    acao:'Conferir quantidade de volumes e de unidades contra o pedido antes do despacho.',
    t:(L, T) => R.faltando(L, T) && (/COMPR(OU|ADO)S? ?(\d+|DOIS|TRES|QUATRO)\b.*\b(APENAS|SOMENTE|ENVIARAM? (1|UM)|SO FOI|CHEGOU (1|UM))\b/.test(T) || /FALTOU (UM |UMA |O |A )?[GFABMK]\d+/.test(T) || /NO PEDIDO DO CLIENTE/.test(T))},
  {id:'item', cat:'Item faltando', nome:'Acessório ou peça faltando (manivela, cubas, tampas...)', setor:'Embalagem / Expedição',
    acao:'Checklist de acessórios por produto (manivela, manípulo, cubas, tampas, moldes) na embalagem.',
    t:(L, T) => R.faltando(L, T)},
  {id:'ferrugem', cat:'Fabricação', nome:'Ferrugem / oxidação', setor:'Pintura / Acabamento',
    acao:'Revisar tratamento, secagem e proteção contra umidade na embalagem dos itens que enferrujam.',
    t:(L, T) => /FERRUJ|FERRJ|OXID/.test(L + ' ' + T)},
  {id:'solda', cat:'Fabricação', nome:'Solda soltando ou sem solda', setor:'Solda',
    acao:'Inspeção de solda no controle final e reforço dos pontos dos paneleiros e suportes.',
    t:(L, T) => /SOLDA|SOLDAD/.test(T) || (/PANEL(EI|IE)RO/.test(T) && /SOLT|PROBLEMA/.test(T))},
  {id:'cuba_furada', cat:'Fabricação', nome:'Cuba da manteigueira furada', setor:'Solda',
    acao:'Verificar chapa e solda da cuba do G10 e testar estanqueidade antes de embalar.',
    t:(L, T) => /CUBA/.test(T) && /FURO|FUROU|FURAD/.test(T)},
  {id:'pintura', cat:'Fabricação', nome:'Pintura / acabamento (riscado, arranhado)', setor:'Pintura / Acabamento',
    acao:'Inspeção visual final de pintura e acabamento e proteção de superfície na embalagem.',
    t:(L, T) => !/AVARIA/.test(L) && /PINTURA|ACABAMENTO|RISCAD|ARRANHAD/.test(T)},
  {id:'avaria', cat:'Transporte', nome:'Avaria no transporte / embalagem', setor:'Logística',
    acao:'Abrir sinistro na transportadora e reforçar cantos e proteção nos produtos mais avariados.',
    t:(L, T) => /AVARIA/.test(L) || /AMASS|QUEBRAD|DANIFIC|TORT[AO]|RACHAD|PANCADA|AVARIA/.test(T)},
  {id:'eletrico', cat:'Produto', nome:'Falha elétrica / componente', setor:'Qualidade / Engenharia',
    acao:'Teste elétrico final (liga, aquece, estabiliza) antes de embalar e avaliar o fornecedor do componente mais recorrente.',
    t:(L, T) => /NAO LIGA|NAO LIGOU|NAO ESQUENTA|NAO ESQUENTOU|NAO AQUECE|NAO ESTAVA ESQUENTANDO|QUEIM|FUSIVEL|LAMPADA|ESTALO|ESTOURO|CHOQUE|CURTO|FAISCA|TERMOSTATO|CONTROLADOR|RESISTENCIA|AQUECE DEMAIS|AQUECENDO|SUPERAQUEC|DERRETEU|PAROU DE FUNCIONAR|NAO FUNCIONA|MAU CONTATO|MAL CONTATO|SOQUETE|PISCA|NAO PEGOU|NAO PEGA/.test(T)},
  {id:'furacao', cat:'Fabricação', nome:'Furação / encaixe / dimensão', setor:'Corte e Dobra',
    acao:'Conferir furação, dobra e encaixe com gabarito e liberar o primeiro lote já conferido.',
    t:(L, T) => /FURAC|NAO BATE|NAO ENCAIXA|DESENCAIXAD|ENTORT|CILINDRO NAO|NAO SOBE/.test(T)},
  {id:'defeito', cat:'Produto', nome:'Defeito de produto (outros)', setor:'Qualidade / Engenharia',
    acao:'Analisar caso a caso e registrar a causa raiz dos que se repetem.',
    t:(L, T) => /DEFEITO/.test(L)},
  {id:'outros', cat:'Outros', nome:'Outros / a classificar', setor:'SAC / Pós-venda',
    acao:'Classificar manualmente.', t:() => true}
];
const CAUSA_POR_ID = Object.fromEntries(CAUSAS.map(c => [c.id, c]));
function classificar(r){
  const L = stripAcc(U(r.laudo)), T = stripAcc(U((r.reclamacao || '') + ' ' + (r.solucao || '')));
  for(const c of CAUSAS) if(c.t(L, T)) return c.id;
  return 'outros';
}
const PECAS = [
  ['Placa de gelo', /PLACAS? DE GELO|BOLSA DE GELO/], ['Kit de parafusos', /PARAFUSO/], ['Mão francesa', /MAOS? FRANCESA/],
  ['Fusível / porta-fusível', /FUSIVEL|FUSIVEIS/], ['Lâmpada', /LAMPADA/], ['Termostato', /TERMOSTATO/], ['Resistência', /RESISTENCIA|\bRESIS\b/],
  ['Manípulo', /MANIPULO|MANOPLA/], ['Manivela', /MANIVELA/], ['Rolo / eixo / rolamento', /ROLO|EIXO|ROLAMENTO|CILINDRO/], ['Cubas', /CUBA/],
  ['Tampa / tampo', /TAMPA|TAMPINHA|TAMPO/], ['Paneleiro', /PANEL(EI|IE)RO/], ['Pés / apoios', /\bPES?\b|PEZINHO|APOIO/], ['Adesivo', /ADESIVO/],
  ['Tensor / anilha / mola', /TENSOR|ANILHA|\bMOLA\b/], ['Molde', /MOLDE/], ['Espátulas', /ESPATULA/], ['Máquina de fuxico', /FUXICO/], ['Golfrador', /GOLFRADOR/],
  ['Laterais / base', /LATERA(L|IS)|\bBASE\b/], ['Placa / controlador', /PLACA|CONTROLADOR|SISTEMA ELETRICO/], ['Cabo / plugue', /\bCABO\b|\bFIO\b|PLUGUE/]
];
function detectarPeca(r){
  const T = stripAcc(U((r.reclamacao || '') + ' ' + (r.solucao || '')));
  const m = PECAS.find(p => p[1].test(T));
  return m ? m[0] : '';
}
