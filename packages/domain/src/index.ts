export type Devolucao = 'NA' | 'AGUARDANDO' | 'RECEBIDO';
export type Situacao = 'aguardando' | 'tratativa' | 'resolvida';
export type Perfil = 'master' | 'gestor' | 'operador';

export interface CustosLike {
  freteEnvio?: number | null;
  freteRetorno?: number | null;
  valorPeca?: number | null;
  estorno?: number | null;
  desconto?: number | null;
  guia?: number | null;
}

export interface ReclamacaoLike extends CustosLike {
  id?: string;
  data?: string | null;
  dataAcao?: string | null;
  dataRecebimento?: string | null;
  devolucao?: Devolucao | string | null;
  laudo?: string | null;
  reclamacao?: string | null;
  solucao?: string | null;
  causaId?: string | null;
  causaManual?: boolean | null;
  setorRespManual?: string | null;
  peca?: string | null;
  sku?: string | null;
  produto?: string | null;
  empresa?: string | null;
  origem?: string | null;
  canal?: string | null;
  setor?: string | null;
  uf?: string | null;
  procedencia?: string | null;
  cliente?: string | null;
  cidade?: string | null;
  protocolo?: string | null;
  familia?: string | null;
  obs?: string | null;
  obsCausa?: string | null;
  reg?: number | null;
}

export interface CausaDef {
  id: string;
  cat: string;
  nome: string;
  setor: string;
  acao: string;
}

export const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const U = (s: unknown) => clean(s).toUpperCase();
export const stripAcc = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

export const diasEntre = (a?: string | null, b?: string | null) =>
  a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null;

export const custoTotal = (r: CustosLike) =>
  Number(r.freteEnvio || 0) +
  Number(r.freteRetorno || 0) +
  Number(r.valorPeca || 0) +
  Number(r.estorno || 0) +
  Number(r.desconto || 0) +
  Number(r.guia || 0);

export const tempoDe = (r: ReclamacaoLike) => diasEntre(r.data, r.dataAcao);

export const DEV_LABEL: Record<Devolucao, string> = {
  NA: 'Sem devolução',
  AGUARDANDO: 'Aguardando chegada',
  RECEBIDO: 'Produto recebido',
};

export const devDe = (r: ReclamacaoLike): Devolucao => {
  const d = (r.devolucao || 'NA') as Devolucao;
  return d === 'AGUARDANDO' || d === 'RECEBIDO' ? d : 'NA';
};

/** Regra central: dataAcao => resolvida; AGUARDANDO => aguardando; senão tratativa */
export function situacao(r: ReclamacaoLike): Situacao {
  if (r.dataAcao) return 'resolvida';
  return devDe(r) === 'AGUARDANDO' ? 'aguardando' : 'tratativa';
}

export const SETORES_RESP = [
  'Embalagem / Expedição',
  'Montagem',
  'Solda',
  'Pintura / Acabamento',
  'Corte e Dobra',
  'Qualidade / Engenharia',
  'Compras',
  'Logística',
  'Comercial / Anúncios',
  'Comercial / Pedidos',
  'PCP',
  'SAC / Pós-venda',
] as const;

type MatchFn = (L: string, T: string) => boolean;

const R = {
  faltando: (L: string, T: string) =>
    /FALTANDO/.test(L) ||
    /FALTOU|FOI FALTANDO|NAO FOI ENVIADO|NAO FORAM ENVIADOS/.test(T),
  errado: (L: string) => /ERRADO/.test(L),
};

interface CausaInternal extends CausaDef {
  t: MatchFn;
}

export const CAUSAS: CausaInternal[] = [
  {
    id: 'prazo',
    cat: 'Prazo e entrega',
    nome: 'Prazo de produção / entrega',
    setor: 'PCP',
    acao: 'Comparar o prazo prometido no anúncio com a capacidade real de produção e avisar o cliente antes de vencer.',
    t: (L, T) =>
      /PRAZO|ATRASO/.test(L) ||
      /PRAZO|ATRASO NO ENVIO|TEMPO DE PRODUCAO|AGUARDAR/.test(T),
  },
  {
    id: 'entrega',
    cat: 'Prazo e entrega',
    nome: 'Extravio / entrega não realizada',
    setor: 'Logística',
    acao: 'Abrir ocorrência na transportadora, reenviar ou estornar rápido e avaliar troca de transportadora nas rotas com recorrência.',
    t: (L, T) =>
      /TRANSPORTE|ENTREGA/.test(L) ||
      /EXTRAVI|PERDEU A|NAO (QUIS )?(REALIZ|EFETU)\w* A ENTREGA|NAO REALIZOU A ENTREGA|NAO EFETUOU A ENTREGA|FILIAL DO DESTINO/.test(
        T,
      ),
  },
  {
    id: 'anuncio',
    cat: 'Venda e cadastro',
    nome: 'Anúncio / cadastro divergente',
    setor: 'Comercial / Anúncios',
    acao: 'Conferir título, fotos, variação e SKU do anúncio antes de publicar ou alterar.',
    t: (_L, T) => /ANUNCIO|ALTERADO SKU|SKU NO ML|SITE PUXOU|CODIGO DIFERENTE/.test(T),
  },
  {
    id: 'lancamento',
    cat: 'Venda e cadastro',
    nome: 'Erro de lançamento do pedido',
    setor: 'Comercial / Pedidos',
    acao: 'Dupla checagem de código × descrição na digitação do pedido.',
    t: (_L, T) => /LANCADO|LANCAMENTO/.test(T),
  },
  {
    id: 'arrepend',
    cat: 'Venda e cadastro',
    nome: 'Cliente desistiu / produto não atendeu',
    setor: 'Comercial / Anúncios',
    acao: 'Oferecer orientação ou troca antes do estorno e revisar o que o anúncio promete.',
    t: (L, T) =>
      /ARREPEN/.test(L) ||
      /DESIST|NAO ATENDEU|NAO CONSEGUE FAZER|ACHOU .*PEQUENO|NAO SUPORTA CORTAR|NAO COMPORTA|AGRADOU|OPTOU PELA/.test(
        T,
      ),
  },
  {
    id: 'pecas',
    cat: 'Venda e cadastro',
    nome: 'Compra de peça / assistência (não é falha)',
    setor: 'SAC / Pós-venda',
    acao: 'Tratar como venda de peça de reposição, fora do indicador de reclamações.',
    t: (L) => /ASSISTENCIA|REPOSICAO/.test(L),
  },
  {
    id: 'manipulo',
    cat: 'Produto',
    nome: 'Manípulo quebrado (máquinas de corte e vinco)',
    setor: 'Qualidade / Engenharia',
    acao: 'Avaliar reforço do manípulo ou da embalagem e acompanhar a recorrência por modelo.',
    t: (_L, T) => /MANIPULO|MANOPLA/.test(T) && /QUEBRAD|QUEBROU/.test(T),
  },
  {
    id: 'voltagem',
    cat: 'Envio errado',
    nome: 'Voltagem errada',
    setor: 'Montagem',
    acao: 'Conferir a voltagem na montagem e na expedição, com checklist e foto da etiqueta.',
    t: (L, T) =>
      R.errado(L) && /VOLTAGEM|\b(110|127|220) ?V?\b.*\b(110|127|220) ?V?\b/.test(T),
  },
  {
    id: 'cubas',
    cat: 'Envio errado',
    nome: 'Cubas trocadas (inox × acrílico)',
    setor: 'Montagem',
    acao: 'Conferir o material das cubas contra o pedido antes de fechar a condimentadora.',
    t: (L, T) => R.errado(L) && /CUBA/.test(T) && /ACRIL|ACRI\b|INOX/.test(T),
  },
  {
    id: 'erro_envio',
    cat: 'Envio errado',
    nome: 'Produto, modelo ou tamanho trocado',
    setor: 'Embalagem / Expedição',
    acao: 'Conferência por código na separação e na embalagem antes de fechar a caixa.',
    t: (L) => R.errado(L),
  },
  {
    id: 'kit',
    cat: 'Item faltando',
    nome: 'Kit de montagem faltando (parafusos, mãos francesas, pés)',
    setor: 'Embalagem / Expedição',
    acao: 'Padronizar o kit de montagem por produto e conferir por checklist na embalagem.',
    t: (L, T) =>
      R.faltando(L, T) &&
      /PARAFUSO|MAO(S)? FRANCESA|PEZINHO|KIT DE PE|\bPES\b|APOIO|ADESIVO|BORRACHA|MONTAGEM|COLUNA/.test(
        T,
      ),
  },
  {
    id: 'unidade',
    cat: 'Item faltando',
    nome: 'Unidade ou produto faltando no pedido',
    setor: 'Embalagem / Expedição',
    acao: 'Conferir quantidade de volumes e de unidades contra o pedido antes do despacho.',
    t: (L, T) =>
      R.faltando(L, T) &&
      (/COMPR(OU|ADO)S? ?(\d+|DOIS|TRES|QUATRO)\b.*\b(APENAS|SOMENTE|ENVIARAM? (1|UM)|SO FOI|CHEGOU (1|UM))\b/.test(
        T,
      ) ||
        /FALTOU (UM |UMA |O |A )?[GFABMK]\d+/.test(T) ||
        /NO PEDIDO DO CLIENTE/.test(T)),
  },
  {
    id: 'item',
    cat: 'Item faltando',
    nome: 'Acessório ou peça faltando (manivela, cubas, tampas...)',
    setor: 'Embalagem / Expedição',
    acao: 'Checklist de acessórios por produto na embalagem.',
    t: (L, T) => R.faltando(L, T),
  },
  {
    id: 'ferrugem',
    cat: 'Fabricação',
    nome: 'Ferrugem / oxidação',
    setor: 'Pintura / Acabamento',
    acao: 'Revisar tratamento, secagem e proteção contra umidade na embalagem.',
    t: (L, T) => /FERRUJ|FERRJ|OXID/.test(L + ' ' + T),
  },
  {
    id: 'solda',
    cat: 'Fabricação',
    nome: 'Solda soltando ou sem solda',
    setor: 'Solda',
    acao: 'Inspeção de solda no controle final e reforço dos pontos dos paneleiros e suportes.',
    t: (_L, T) =>
      /SOLDA|SOLDAD/.test(T) || (/PANEL(EI|IE)RO/.test(T) && /SOLT|PROBLEMA/.test(T)),
  },
  {
    id: 'cuba_furada',
    cat: 'Fabricação',
    nome: 'Cuba da manteigueira furada',
    setor: 'Solda',
    acao: 'Verificar chapa e solda da cuba e testar estanqueidade antes de embalar.',
    t: (_L, T) => /CUBA/.test(T) && /FURO|FUROU|FURAD/.test(T),
  },
  {
    id: 'pintura',
    cat: 'Fabricação',
    nome: 'Pintura / acabamento (riscado, arranhado)',
    setor: 'Pintura / Acabamento',
    acao: 'Inspeção visual final de pintura e acabamento.',
    t: (L, T) => !/AVARIA/.test(L) && /PINTURA|ACABAMENTO|RISCAD|ARRANHAD/.test(T),
  },
  {
    id: 'avaria',
    cat: 'Transporte',
    nome: 'Avaria no transporte / embalagem',
    setor: 'Logística',
    acao: 'Abrir sinistro na transportadora e reforçar proteção nos produtos mais avariados.',
    t: (L, T) =>
      /AVARIA/.test(L) || /AMASS|QUEBRAD|DANIFIC|TORT[AO]|RACHAD|PANCADA|AVARIA/.test(T),
  },
  {
    id: 'eletrico',
    cat: 'Produto',
    nome: 'Falha elétrica / componente',
    setor: 'Qualidade / Engenharia',
    acao: 'Teste elétrico final antes de embalar e avaliar o fornecedor do componente mais recorrente.',
    t: (_L, T) =>
      /NAO LIGA|NAO LIGOU|NAO ESQUENTA|NAO ESQUENTOU|NAO AQUECE|NAO ESTAVA ESQUENTANDO|QUEIM|FUSIVEL|LAMPADA|ESTALO|ESTOURO|CHOQUE|CURTO|FAISCA|TERMOSTATO|CONTROLADOR|RESISTENCIA|AQUECE DEMAIS|AQUECENDO|SUPERAQUEC|DERRETEU|PAROU DE FUNCIONAR|NAO FUNCIONA|MAU CONTATO|MAL CONTATO|SOQUETE|PISCA|NAO PEGOU|NAO PEGA/.test(
        T,
      ),
  },
  {
    id: 'furacao',
    cat: 'Fabricação',
    nome: 'Furação / encaixe / dimensão',
    setor: 'Corte e Dobra',
    acao: 'Conferir furação, dobra e encaixe com gabarito.',
    t: (_L, T) =>
      /FURAC|NAO BATE|NAO ENCAIXA|DESENCAIXAD|ENTORT|CILINDRO NAO|NAO SOBE/.test(T),
  },
  {
    id: 'defeito',
    cat: 'Produto',
    nome: 'Defeito de produto (outros)',
    setor: 'Qualidade / Engenharia',
    acao: 'Analisar caso a caso e registrar a causa raiz dos que se repetem.',
    t: (L) => /DEFEITO/.test(L),
  },
  {
    id: 'outros',
    cat: 'Outros',
    nome: 'Outros / a classificar',
    setor: 'SAC / Pós-venda',
    acao: 'Classificar manualmente.',
    t: () => true,
  },
];

export const CAUSA_POR_ID: Record<string, CausaDef> = Object.fromEntries(
  CAUSAS.map(({ t: _t, ...c }) => [c.id, c]),
);

export function classificar(r: ReclamacaoLike): string {
  return classificarTodas(r, 1)[0] || 'outros';
}

/**
 * Causas genéricas/catch-all: se alguma específica da família já entrou, omitir a genérica.
 * Ex.: kit + item → só kit; voltagem + erro_envio → só voltagem.
 * Não suprime pares legítimos (avaria + eletrico = amassado e falha elétrica).
 */
const GENERICA_SUPRIMIDA_POR: Record<string, readonly string[]> = {
  item: ['kit', 'unidade'],
  erro_envio: ['voltagem', 'cubas'],
  defeito: [
    'manipulo',
    'eletrico',
    'furacao',
    'cuba_furada',
    'solda',
    'ferrugem',
    'pintura',
    'avaria',
  ],
  // "quebrado" no texto do manípulo também dispara avaria; manípulo é o motivo certo
  avaria: ['manipulo'],
};

/** Todas as causas que batem no texto (máx. 5), sem genéricas redundantes. */
export function classificarTodas(r: ReclamacaoLike, max = 5): string[] {
  const L = stripAcc(U(r.laudo));
  const T = stripAcc(U(`${r.reclamacao || ''} ${r.solucao || ''}`));
  const brutos: string[] = [];
  for (const c of CAUSAS) {
    if (c.id === 'outros') continue;
    if (c.t(L, T)) brutos.push(c.id);
  }
  const ids = brutos.filter((id) => {
    const especificas = GENERICA_SUPRIMIDA_POR[id];
    if (!especificas) return true;
    return !especificas.some((esp) => brutos.includes(esp));
  });
  const cortados = ids.slice(0, max);
  return cortados.length ? cortados : ['outros'];
}

const PECAS: [string, RegExp][] = [
  ['Placa de gelo', /PLACAS? DE GELO|BOLSA DE GELO/],
  ['Kit de parafusos', /PARAFUSO/],
  ['Mão francesa', /MAOS? FRANCESA/],
  ['Fusível / porta-fusível', /FUSIVEL|FUSIVEIS/],
  ['Lâmpada', /LAMPADA/],
  ['Termostato', /TERMOSTATO/],
  ['Resistência', /RESISTENCIA|\bRESIS\b/],
  ['Manípulo', /MANIPULO|MANOPLA/],
  ['Manivela', /MANIVELA/],
  ['Rolo / eixo / rolamento', /ROLO|EIXO|ROLAMENTO|CILINDRO/],
  ['Cubas', /CUBA/],
  ['Tampa / tampo', /TAMPA|TAMPINHA|TAMPO/],
  ['Paneleiro', /PANEL(EI|IE)RO/],
  ['Pés / apoios', /\bPES?\b|PEZINHO|APOIO/],
  ['Adesivo', /ADESIVO/],
  ['Tensor / anilha / mola', /TENSOR|ANILHA|\bMOLA\b/],
  ['Molde', /MOLDE/],
  ['Espátulas', /ESPATULA/],
  ['Máquina de fuxico', /FUXICO/],
  ['Golfrador', /GOLFRADOR/],
  ['Laterais / base', /LATERA(L|IS)|\bBASE\b/],
  ['Placa / controlador', /PLACA|CONTROLADOR|SISTEMA ELETRICO/],
  ['Cabo / plugue', /\bCABO\b|\bFIO\b|PLUGUE/],
];

export function detectarPeca(r: ReclamacaoLike): string {
  const T = stripAcc(U(`${r.reclamacao || ''} ${r.solucao || ''}`));
  const m = PECAS.find((p) => p[1].test(T));
  return m ? m[0] : '';
}

export function causaDe(
  r: ReclamacaoLike,
  overrides: Record<string, Partial<CausaDef>> = {},
): CausaDef {
  let id = r.causaManual && r.causaId && CAUSA_POR_ID[r.causaId] ? r.causaId : classificar(r);
  const base = CAUSA_POR_ID[id] || CAUSA_POR_ID.outros;
  const o = overrides[base.id] || {};
  return { ...base, setor: o.setor || base.setor, acao: o.acao || base.acao };
}

export const setorResp = (
  r: ReclamacaoLike,
  overrides: Record<string, Partial<CausaDef>> = {},
) => clean(r.setorRespManual) || causaDe(r, overrides).setor;

export const pecaDe = (r: ReclamacaoLike) => clean(r.peca) || detectarPeca(r);

export function empresaDeCat(c?: string | null) {
  if (/AISA/.test(c || '')) return 'AISA';
  if (/ARAUCA/.test(c || '')) return 'ARAUCA';
  if (/ARTMAQ/.test(c || '')) return 'ARTMAQ';
  return '';
}

/** Igual ao HTML legado: "5" → "SETOR 05", "4.1" → "SETOR 04.1". */
export function setorLabel(s?: string | null) {
  const raw = clean(s);
  if (!raw) return '';
  if (/^SETOR\b/i.test(raw)) return raw.toUpperCase().replace(/^SETOR\s+/i, 'SETOR ');
  const [a, ...b] = raw.split('.');
  return (
    'SETOR ' +
    (/^\d+$/.test(a) ? a.padStart(2, '0') : a) +
    (b.length ? '.' + b.join('.') : '')
  );
}

export const CATS: Record<string, string> = {
  P: 'PRODUTO AISA',
  R: 'PRODUTO ARAUCA',
  T: 'PRODUTO ARTMAQ',
  C: 'COMPONENTE',
  X: 'PRODUTO INATIVO',
};

export function parseSeedProdutos(seedText: string) {
  return seedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [cod, setor, produto, st, cat, fam] = l.split('|');
      return {
        cod: cod.trim(),
        setor: setor?.trim() || '',
        produto: (produto || '').trim(),
        status: st === 'I' ? 'INATIVO' : 'ATIVO',
        categoria: CATS[cat] || '',
        familia: (fam || '').trim(),
      };
    });
}

export type AlertTipo =
  | 'AGUARDANDO_DIAS'
  | 'TRATATIVA_META'
  | 'RECORRENCIA'
  | 'CUSTO_ALTO'
  | 'CAUSA_OUTROS'
  | 'RASCUNHO_WHATSAPP';

export interface AlertConfig {
  aguardandoDias: number;
  metaDias: number;
  custoAlto: number;
  outrosDias: number;
  rascunhoWhatsappHoras: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  aguardandoDias: 7,
  metaDias: 2,
  custoAlto: 500,
  outrosDias: 3,
  rascunhoWhatsappHoras: 24,
};

export function avaliarAlertasReclamacao(
  r: ReclamacaoLike & { criadoEm?: string | Date | null; alteradoEm?: string | Date | null },
  cfg: AlertConfig = DEFAULT_ALERT_CONFIG,
  hoje = new Date().toISOString().slice(0, 10),
): AlertTipo[] {
  const out: AlertTipo[] = [];
  const sit = situacao(r);
  const diasAberto = r.data ? diasEntre(r.data, hoje) : null;

  if (sit === 'aguardando' && diasAberto !== null && diasAberto > cfg.aguardandoDias) {
    out.push('AGUARDANDO_DIAS');
  }
  if (sit === 'tratativa' && diasAberto !== null && diasAberto > cfg.metaDias) {
    out.push('TRATATIVA_META');
  }
  if (sit !== 'resolvida' && custoTotal(r) >= cfg.custoAlto) {
    out.push('CUSTO_ALTO');
  }
  const causa = causaDe(r);
  if (
    sit !== 'resolvida' &&
    causa.id === 'outros' &&
    diasAberto !== null &&
    diasAberto > cfg.outrosDias
  ) {
    out.push('CAUSA_OUTROS');
  }
  if (r.origem === 'whatsapp' && !r.dataAcao && sit === 'tratativa') {
    const criado = r.criadoEm ? new Date(r.criadoEm).getTime() : 0;
    if (criado && Date.now() - criado > cfg.rascunhoWhatsappHoras * 3600e3) {
      out.push('RASCUNHO_WHATSAPP');
    }
  }
  return out;
}

/** Commit e ramo que reproduzem o SAC antes da evolução. */
export const PONTO_DE_RETORNO = {
  commit: 'dcec3884d57cc20389ab4ce3a8f21174ad17c722',
  ramo: 'ponto-de-retorno',
} as const;

export const ESTADOS_WHATSAPP_CLASSICOS = [
  'inicio',
  'coletar_nome',
  'coletar_canal',
  'coletar_sku',
  'coletar_uf',
  'coletar_relato',
  'handoff',
] as const;

/** Palavras que devolvem o cliente ao menu, em qualquer passo. */
export const COMANDOS_RETORNO = [
  'voltar',
  'cancelar',
  'ponto',
  'recomecar',
  'recomeçar',
  'recomece',
  'recomeça',
] as const;

export function comandoRetorno(texto: string): boolean {
  const t = clean(texto).toLowerCase();
  return (COMANDOS_RETORNO as readonly string[]).includes(t);
}

export function evolucaoAtivaDe(valor?: string | null): boolean {
  const v = clean(valor).toLowerCase();
  return v === '1' || v === 'true' || v === 'sim';
}

export interface PoliticaEvolucao {
  ativa: boolean;
  limiarDescartar: number;
  limiarSobrepor: number;
  guardarDivergencia: boolean;
}

/** Desligada, os limiares são os mesmos números que já estavam no código. */
export function politicaDe(m: Record<string, string | undefined | null>): PoliticaEvolucao {
  const ativa = evolucaoAtivaDe(m['evolucao.ativa']);
  if (!ativa) {
    return { ativa: false, limiarDescartar: 0.55, limiarSobrepor: 0.8, guardarDivergencia: false };
  }
  const descartar = Number(m['ia.limiarDescartar']);
  const sobrepor = Number(m['ia.limiarSobrepor']);
  return {
    ativa: true,
    limiarDescartar: descartar > 0 && descartar < 1 ? descartar : 0.55,
    limiarSobrepor: sobrepor > 0 && sobrepor <= 1 ? sobrepor : 0.8,
    guardarDivergencia: m['ia.guardarDivergencia'] !== '0',
  };
}

export const CAUSAS_SEGURANCA = [
  'eletrico',
  'voltagem',
  'solda',
  'cuba_furada',
  'avaria',
  'manipulo',
] as const;

export function sinalSeguranca(causaId?: string | null): boolean {
  return (CAUSAS_SEGURANCA as readonly string[]).includes(String(causaId || ''));
}

/** Telas e ações do painel — chave = tela.acao */
export const PERMISSOES_CATALOGO = [
  { chave: 'triagem.ver', tela: 'Triagem', acao: 'Ver', grupo: 'triagem' },
  { chave: 'triagem.classificar', tela: 'Triagem', acao: 'Classificar', grupo: 'triagem' },
  { chave: 'kpis.ver', tela: 'KPIs', acao: 'Ver', grupo: 'kpis' },
  { chave: 'reclamacoes.ver', tela: 'Reclamações', acao: 'Ver', grupo: 'reclamacoes' },
  { chave: 'reclamacoes.criar', tela: 'Reclamações', acao: 'Criar', grupo: 'reclamacoes' },
  { chave: 'reclamacoes.editar', tela: 'Reclamações', acao: 'Editar', grupo: 'reclamacoes' },
  { chave: 'reclamacoes.excluir', tela: 'Reclamações', acao: 'Excluir', grupo: 'reclamacoes' },
  { chave: 'alertas.ver', tela: 'Alertas', acao: 'Ver', grupo: 'alertas' },
  { chave: 'alertas.gerir', tela: 'Alertas', acao: 'Gerir / varrer', grupo: 'alertas' },
  { chave: 'decisoes.ver', tela: 'Decidir hoje', acao: 'Ver', grupo: 'decisoes' },
  { chave: 'qualidade.ver', tela: 'Qualidade', acao: 'Ver', grupo: 'qualidade' },
  { chave: 'qualidade.importar', tela: 'Qualidade', acao: 'Importar vendas', grupo: 'qualidade' },
  { chave: 'qualidade.planos', tela: 'Qualidade', acao: 'Planos de ação', grupo: 'qualidade' },
  { chave: 'gestao.ver', tela: 'Gestão', acao: 'Ver', grupo: 'gestao' },
  { chave: 'gestao.usuarios', tela: 'Gestão', acao: 'Usuários', grupo: 'gestao' },
  { chave: 'gestao.produtos', tela: 'Gestão', acao: 'Produtos', grupo: 'gestao' },
  { chave: 'gestao.regras', tela: 'Gestão', acao: 'Regras', grupo: 'gestao' },
  { chave: 'gestao.config', tela: 'Gestão', acao: 'Configurações', grupo: 'gestao' },
  { chave: 'dados.ver', tela: 'Dados', acao: 'Ver', grupo: 'dados' },
  { chave: 'dados.importar', tela: 'Dados', acao: 'Importar backup', grupo: 'dados' },
  { chave: 'dados.exportar', tela: 'Dados', acao: 'Exportar backup', grupo: 'dados' },
  { chave: 'admin.ver', tela: 'Admin', acao: 'Ver', grupo: 'admin' },
  { chave: 'admin.permissoes', tela: 'Admin', acao: 'Editar permissões', grupo: 'admin' },
  { chave: 'admin.backup', tela: 'Admin', acao: 'Gerar e baixar dumps', grupo: 'admin' },
  { chave: 'evolucao.ligar', tela: 'Evolução', acao: 'Ligar / voltar', grupo: 'evolucao' },
] as const;

export type PermissaoChave = (typeof PERMISSOES_CATALOGO)[number]['chave'];

const ALL = PERMISSOES_CATALOGO.map((p) => p.chave);

const OPERADOR: PermissaoChave[] = [
  'triagem.ver',
  'triagem.classificar',
  'kpis.ver',
  'reclamacoes.ver',
  'reclamacoes.criar',
  'reclamacoes.editar',
  'alertas.ver',
  'qualidade.ver',
  'qualidade.planos',
];

const GESTOR: PermissaoChave[] = [
  ...OPERADOR,
  'reclamacoes.excluir',
  'alertas.gerir',
  'decisoes.ver',
  'qualidade.importar',
  'gestao.ver',
  'gestao.usuarios',
  'gestao.regras',
  'gestao.config',
  'dados.ver',
  'dados.importar',
  'dados.exportar',
];

/** Padrões que reproduzem o comportamento atual dos três perfis. */
export const PERMISSOES_PADRAO: Record<'master' | 'gestor' | 'operador', PermissaoChave[]> = {
  master: [...ALL],
  gestor: GESTOR,
  operador: OPERADOR,
};

export function mesclarPermissoes(
  perfil: 'master' | 'gestor' | 'operador',
  overrides: { chave: string; permitido: boolean }[],
): string[] {
  if (perfil === 'master') return [...ALL];
  const base = new Set<string>(PERMISSOES_PADRAO[perfil] || OPERADOR);
  for (const o of overrides) {
    if (o.permitido) base.add(o.chave);
    else base.delete(o.chave);
  }
  return [...base];
}

export function temPermissao(lista: string[] | undefined | null, chave: string): boolean {
  return !!lista?.includes(chave);
}
