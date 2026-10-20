import { Injectable, Logger } from '@nestjs/common';
import { ReclamacoesService } from '../reclamacoes/reclamacoes.service';
import { QualidadeService } from '../qualidade/qualidade.service';
import { AlertasService } from '../alertas/alertas.service';
import { PrismaService } from '../prisma.service';
import { situacao, causaDe } from '../domain-bridge';

/** Definição OpenAI-compatible de uma tool do gestor. */
export type GestorToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

const TZ = 'America/Sao_Paulo';

function isoHojeBr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Normaliza texto p/ match de setor (sem acento, minúsculo). */
export function normTxt(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** g-156 / G 156 / g156 → G156 (comparação). */
export function normSku(s: string): string {
  return String(s || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

/** Stem grosseiro PT: embalagens→embalagem, expedicoes→expedicao. */
function stemPt(t: string): string {
  let x = normTxt(t);
  if (x.endsWith('agens')) return x.slice(0, -5) + 'agem';
  if (x.endsWith('acoes')) return x.slice(0, -5) + 'acao';
  if (x.endsWith('coes')) return x.slice(0, -4) + 'cao';
  if (x.endsWith('oes')) return x.slice(0, -3) + 'ao';
  if (x.endsWith('ais')) return x.slice(0, -3) + 'al';
  if (x.endsWith('ns') && x.length > 4) return x.slice(0, -1);
  if (x.endsWith('s') && x.length > 4) return x.slice(0, -1);
  return x;
}

/** “Embalagens” casa com “Embalagem / Expedição”. */
export function setorFuzzyMatch(nomeSetor: string, query: string): boolean {
  const a = normTxt(nomeSetor);
  const b = normTxt(query);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const tokensA = a.split(/[\s/]+/).map(stemPt).filter((t) => t.length >= 3);
  const tokensB = b.split(/[\s/]+/).map(stemPt).filter((t) => t.length >= 3);
  if (!tokensB.length) return false;
  // ignora ruído (“setor”, “de”, “da”)
  const stop = new Set(['setor', 'de', 'da', 'do', 'dos', 'das', 'e', 'ou']);
  const q = tokensB.filter((t) => !stop.has(t));
  if (!q.length) return false;
  return q.every((tb) =>
    tokensA.some((ta) => {
      if (ta === tb) return true;
      if (ta.includes(tb) || tb.includes(ta)) return true;
      const n = Math.min(6, ta.length, tb.length);
      return n >= 5 && ta.slice(0, n) === tb.slice(0, n);
    }),
  );
}

/**
 * Converte preset / N dias / de-até em datas YYYY-MM-DD (fuso BR).
 * Aceita: hoje, ontem, semana, 15d, 30d, 45d, "últimos 45 dias", dias=45.
 */
export function resolverPeriodo(
  preset?: string,
  de?: string,
  ate?: string,
  dias?: number,
): { de: string; ate: string; label: string } {
  const hoje = isoHojeBr();
  if (de || ate) {
    const d0 = de || ate || hoje;
    const d1 = ate || de || hoje;
    return { de: d0, ate: d1, label: `${d0} → ${d1}` };
  }

  const clampDias = (n: number) => Math.min(Math.max(Math.floor(n), 1), 365);

  if (Number.isFinite(dias) && (dias as number) > 0) {
    const n = clampDias(dias as number);
    return { de: addDaysIso(hoje, -(n - 1)), ate: hoje, label: `últimos ${n} dias` };
  }

  const p = (preset || 'hoje').toLowerCase().trim();

  // "45d", "45dias", "ultimos 45 dias", "últimos 45 dias"
  const m =
    p.match(/^(\d+)\s*d(?:ias)?$/) ||
    p.match(/^(?:ultimos|últimos)\s+(\d+)\s*d(?:ias)?$/) ||
    p.match(/^(\d+)\s*dias?$/);
  if (m) {
    const n = clampDias(Number(m[1]));
    return { de: addDaysIso(hoje, -(n - 1)), ate: hoje, label: `últimos ${n} dias` };
  }

  if (p === 'hoje' || p === 'today') return { de: hoje, ate: hoje, label: 'hoje' };
  if (p === 'ontem' || p === 'yesterday') {
    const o = addDaysIso(hoje, -1);
    return { de: o, ate: o, label: 'ontem' };
  }
  if (p === 'semana' || p === '7d' || p === '7dias' || p.includes('7 dia')) {
    return { de: addDaysIso(hoje, -6), ate: hoje, label: 'últimos 7 dias' };
  }
  if (p === '15d' || p === '15dias' || p.includes('15 dia')) {
    return { de: addDaysIso(hoje, -14), ate: hoje, label: 'últimos 15 dias' };
  }
  if (
    p === '30d' ||
    p === '30dias' ||
    p === 'mes' ||
    p === 'mês' ||
    p.includes('30 dia') ||
    p.includes('esse mes') ||
    p.includes('este mes') ||
    p.includes('esse mês') ||
    p.includes('este mês')
  ) {
    return { de: addDaysIso(hoje, -29), ate: hoje, label: 'últimos 30 dias' };
  }
  if (
    p === 'ano' ||
    p === 'este ano' ||
    p === 'esse ano' ||
    p === 'ytd' ||
    p === 'ano atual' ||
    p.includes('este ano') ||
    p.includes('esse ano')
  ) {
    const year = hoje.slice(0, 4);
    return { de: `${year}-01-01`, ate: hoje, label: `ano ${year} (até hoje)` };
  }
  // preset desconhecido: NÃO cair em "hoje" (gera alucinação de “não há dados”)
  return { de: addDaysIso(hoje, -29), ate: hoje, label: 'últimos 30 dias (padrão)' };
}

export const GESTOR_TOOL_DEFS: GestorToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'catalogo',
      description:
        'Use quando o gestor perguntar o que você faz / o que cobre. Não devolve cifra. Explique em prosa na resposta final — sem listar comandos ou menus. Sem parâmetros.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'periodo_resolver',
      description:
        'Converte período em {de, ate} (America/Sao_Paulo). Use ANTES de listar/KPI. Aceita hoje, ontem, semana, 15d, 30d, 45d, ano/este ano, “últimos N dias”, ou dias=N. NÃO invente datas.',
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            description: 'hoje | ontem | semana | 15d | 30d | 45d | ano | este ano | ultimos 45 dias',
          },
          dias: {
            type: 'number',
            description: 'N últimos dias (1–365). Ex.: 45.',
          },
          de: { type: 'string', description: 'YYYY-MM-DD início (opcional)' },
          ate: { type: 'string', description: 'YYYY-MM-DD fim (opcional)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reclamacoes_listar',
      description:
        'Lista resumida de reclamações no período (máx. 15) + total. Kit: causa=kit. SKU: passe sku cru (g-156) — a tool normaliza. Sempre de/ate.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string', description: 'YYYY-MM-DD início' },
          ate: { type: 'string', description: 'YYYY-MM-DD fim' },
          status: {
            type: 'string',
            description: 'aguardando | tratativa | resolvida (opcional)',
          },
          setor: { type: 'string', description: 'Setor responsável (fuzzy ok)' },
          sku: {
            type: 'string',
            description: 'SKU como o gestor escreveu (g-156, G 156). Match fuzzy automático.',
          },
          causa: {
            type: 'string',
            description: 'Id da causa: kit | item | voltagem | erro_envio | avaria | ...',
          },
          q: { type: 'string', description: 'Busca livre cliente/produto/texto (opcional)' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sku_resolver',
      description:
        'Resolve SKU digitado de qualquer jeito (g-156, g156, G-156) para o código canônico no cadastro/reclamações. USE SEMPRE antes de negar que um SKU não existe. Devolve candidatos e melhor match.',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Texto do SKU como o gestor falou' },
        },
        required: ['sku'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sku_analise',
      description:
        'Análise de um SKU no período: volume de reclamações, causas, PPM se houver vendas, amostra. Use quando pedirem “como está o G-156”, “SKU g-156”. Chama resolução fuzzy internamente.',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
          de: { type: 'string' },
          ate: { type: 'string' },
        },
        required: ['sku', 'de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analise_cruzada',
      description:
        'Cruza KPI + top causas + setores + PPM/alertas no período e devolve insights factuais para decisão. Use para “o que precisa atenção”, “análise da semana”, “cruzar dados”. Não inventa — só sintetiza o JSON.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
          setor: { type: 'string', description: 'Opcional — restringe ao setor (fuzzy)' },
          sku: { type: 'string', description: 'Opcional — restringe ao SKU (fuzzy)' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reclamacao_status',
      description:
        'Status de UMA reclamação por nº de registro (reg) ou protocolo. Use para “status da 402”, “como está o protocolo X”. Não lista o período.',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Número do registro ou protocolo',
          },
        },
        required: ['token'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kpi_resumo',
      description:
        'Totais no período: quantidade, aguardando/tratativa/resolvida, tempo médio, meta, custo, recorrência. Use para “resumo”, “KPI”, “como estamos”. Não lista cada reclamação (use reclamacoes_listar).',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'causas_top',
      description:
        'Ranking das principais causas/motivos no período. Use para “quais motivos”, “top causas”. Não é PPM (use ppm_qualidade).',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
          limite: { type: 'number', description: '1–12, padrão 8' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setor_resumo',
      description:
        'Resumo por setor responsável (match fuzzy: “Embalagens” = “Embalagem / Expedição”). Sem nome: ranking. Com nome: detalhe + candidatos se ambíguo. Nunca diga que o setor não existe sem olhar setores_disponiveis no retorno.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
          nome: { type: 'string', description: 'Nome parcial do setor (ex.: Embalagens)' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pontos_atencao',
      description:
        'Síntese factual de riscos: alertas abertos, aguardando antigos, SKUs acima do PPM, recorrência. Use para “pontos de atenção”, “o que está crítico”, “onde olhar”. Prefira esta tool em vez de inventar priorização.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string', description: 'Período para PPM/KPI (padrão últimos 15 dias se omitir)' },
          ate: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'alertas_abertos',
      description:
        'Lista alertas com status aberto agora. Use para “alertas”, “pendências de alerta”. Não calcula PPM.',
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: '1–20, padrão 10' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ppm_qualidade',
      description:
        'PPM geral e SKUs acima do limite no período. Use para qualidade, taxa de defeito, SKU crítico. Não lista todas as reclamações.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
        },
        required: ['de', 'ate'],
        additionalProperties: false,
      },
    },
  },
];

@Injectable()
export class GestorToolsService {
  private readonly log = new Logger(GestorToolsService.name);

  constructor(
    private reclamacoes: ReclamacoesService,
    private qualidade: QualidadeService,
    private alertas: AlertasService,
    private prisma: PrismaService,
  ) {}

  defs() {
    return GESTOR_TOOL_DEFS;
  }

  private dataOk(v: unknown): v is string {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  }

  private datasOuErro(args: Record<string, unknown>): { de: string; ate: string } | { erro: string } {
    if (!this.dataOk(args.de) || !this.dataOk(args.ate)) {
      return {
        erro: 'Informe de e ate no formato YYYY-MM-DD (chame periodo_resolver antes).',
      };
    }
    return { de: args.de, ate: args.ate };
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'catalogo':
          return this.catalogo();
        case 'periodo_resolver':
          return resolverPeriodo(
            typeof args.preset === 'string' ? args.preset : undefined,
            this.dataOk(args.de) ? args.de : undefined,
            this.dataOk(args.ate) ? args.ate : undefined,
            typeof args.dias === 'number'
              ? args.dias
              : typeof args.dias === 'string' && args.dias.trim()
                ? Number(args.dias)
                : undefined,
          );
        case 'reclamacoes_listar': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.reclamacoesListar({ ...args, ...d });
        }
        case 'sku_resolver':
          return this.skuResolver(typeof args.sku === 'string' ? args.sku : '');
        case 'sku_analise': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.skuAnalise(typeof args.sku === 'string' ? args.sku : '', d.de, d.ate);
        }
        case 'analise_cruzada': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.analiseCruzada(
            d.de,
            d.ate,
            typeof args.setor === 'string' ? args.setor : undefined,
            typeof args.sku === 'string' ? args.sku : undefined,
          );
        }
        case 'reclamacao_status':
          return this.reclamacaoStatus(typeof args.token === 'string' ? args.token : '');
        case 'kpi_resumo': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.kpiResumo(d.de, d.ate);
        }
        case 'causas_top': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.causasTop(d.de, d.ate, Number(args.limite) || 8);
        }
        case 'setor_resumo': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.setorResumo(d.de, d.ate, typeof args.nome === 'string' ? args.nome : '');
        }
        case 'pontos_atencao':
          return this.pontosAtencao(
            this.dataOk(args.de) ? args.de : undefined,
            this.dataOk(args.ate) ? args.ate : undefined,
          );
        case 'alertas_abertos':
          return this.alertasAbertos(Number(args.limite) || 10);
        case 'ppm_qualidade': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.ppmQualidade(d.de, d.ate);
        }
        default:
          return { erro: `Tool desconhecida: ${name}` };
      }
    } catch (e) {
      this.log.warn(`Tool ${name} falhou: ${e}`);
      return { erro: String(e) };
    }
  }

  private catalogo() {
    return {
      escopo: 'Assistente do gestor SAC AISA — conversa natural, somente leitura',
      cobre: [
        'Reclamações por período / setor / causa / SKU (fuzzy: g-156 = G-156)',
        'Status de registro/protocolo',
        'KPI, causas, setores, PPM, alertas, análise cruzada',
        'Pontos de atenção e decisão',
      ],
      nao_cobre: ['Alterar reclamação', 'Fluxo de cliente', 'Promessas financeiras'],
      tom: 'Resposta WhatsApp: bullets com • , negrito só com *texto*, sem ## nem **.',
    };
  }

  private async skuResolver(raw: string) {
    const input = String(raw || '').trim();
    if (!input) return { erro: 'Informe o SKU' };
    const needle = normSku(input);
    if (!needle) return { erro: 'SKU inválido', input };

    // Depara oficial
    const depara = await this.prisma.skuDepara.findMany({ take: 500 });
    for (const d of depara) {
      if (normSku(d.skuOrigem) === needle || normSku(d.skuDestino) === needle) {
        const dest = d.skuDestino;
        const prod = await this.prisma.produto.findFirst({
          where: { cod: { equals: dest, mode: 'insensitive' } },
        });
        return {
          input,
          encontrado: true,
          melhor: { sku: dest, produto: prod?.produto || '', via: 'depara' },
          candidatos: [{ sku: dest, produto: prod?.produto || '', score: 100 }],
        };
      }
    }

    const produtos = await this.prisma.produto.findMany({
      where: { status: 'ATIVO' },
      select: { cod: true, produto: true },
      take: 3000,
    });
    const candProd = produtos
      .map((p) => {
        const n = normSku(p.cod);
        let score = 0;
        if (n === needle) score = 100;
        else if (n.startsWith(needle) || needle.startsWith(n)) score = 80;
        else if (n.includes(needle) || needle.includes(n)) score = 60;
        return { sku: p.cod, produto: p.produto, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // Também busca em SKUs que já apareceram em reclamações
    const recent = await this.prisma.reclamacao.findMany({
      select: { sku: true, produto: true },
      orderBy: { data: 'desc' },
      take: 800,
    });
    const seen = new Map<string, string>();
    for (const r of recent) {
      const k = normSku(r.sku);
      if (!k || seen.has(k)) continue;
      seen.set(k, r.sku);
      if (candProd.some((c) => normSku(c.sku) === k)) continue;
      let score = 0;
      if (k === needle) score = 95;
      else if (k.startsWith(needle) || needle.startsWith(k)) score = 75;
      else if (k.includes(needle) || needle.includes(k)) score = 55;
      if (score > 0) {
        candProd.push({ sku: r.sku, produto: r.produto || '', score });
      }
    }
    candProd.sort((a, b) => b.score - a.score);
    const uniq: { sku: string; produto: string; score: number }[] = [];
    const used = new Set<string>();
    for (const c of candProd) {
      const k = normSku(c.sku);
      if (used.has(k)) continue;
      used.add(k);
      uniq.push(c);
      if (uniq.length >= 8) break;
    }

    if (!uniq.length) {
      return {
        input,
        encontrado: false,
        mensagem: `Nenhum SKU parecido com "${input}" (normalizado ${needle}). Não diga que o produto não existe sem sugerir verificação no cadastro.`,
        candidatos: [],
      };
    }
    return {
      input,
      encontrado: true,
      melhor: { sku: uniq[0].sku, produto: uniq[0].produto, via: 'fuzzy' },
      candidatos: uniq,
    };
  }

  private async skuAnalise(raw: string, de: string, ate: string) {
    const resolved = await this.skuResolver(raw);
    if (!resolved.encontrado || !('melhor' in resolved) || !resolved.melhor) {
      return resolved;
    }
    const sku = resolved.melhor.sku;
    const lista = await this.reclamacoesListar({ de, ate, sku });
    const painel = await this.qualidade.painel({ de, ate });
    const porSku = (
      painel as {
        porSku?: {
          sku: string;
          reclamacoes: number;
          vendas: number;
          ppm: number | null;
          acimaLimite: boolean;
        }[];
      }
    ).porSku;
    const g = (porSku || []).find((x) => normSku(x.sku) === normSku(sku));

    const itens = (lista as { itens?: { causa?: string }[]; total?: number }).itens || [];
    const porCausa = new Map<string, number>();
    for (const i of itens) {
      const c = i.causa || '(sem causa)';
      porCausa.set(c, (porCausa.get(c) || 0) + 1);
    }

    return {
      de,
      ate,
      input: raw,
      sku_canonico: sku,
      produto: resolved.melhor.produto,
      total_reclamacoes: (lista as { total?: number }).total ?? itens.length,
      causas: [...porCausa.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n),
      ppm: g
        ? { reclamacoes: g.reclamacoes, vendas: g.vendas, ppm: g.ppm, acimaLimite: g.acimaLimite }
        : null,
      amostra: itens.slice(0, 10),
      insight:
        ((lista as { total?: number }).total || 0) === 0
          ? `SKU ${sku} sem reclamações no período ${de}→${ate}.`
          : `SKU ${sku}: ${(lista as { total?: number }).total} reclamação(ões) no período. Top causa: ${[...porCausa.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—'}.`,
    };
  }

  private async analiseCruzada(de: string, ate: string, setor?: string, sku?: string) {
    let skuCanon: string | undefined;
    if (sku) {
      const r = await this.skuResolver(sku);
      if (r.encontrado && 'melhor' in r && r.melhor) skuCanon = r.melhor.sku;
    }
    const [kpis, pontos, lista] = await Promise.all([
      this.reclamacoes.kpis({
        de,
        ate,
        ...(skuCanon ? { sku: skuCanon } : {}),
        ...(setor ? { resp: setor } : {}),
      }),
      this.pontosAtencao(de, ate),
      this.reclamacoesListar({
        de,
        ate,
        ...(skuCanon ? { sku: skuCanon } : {}),
        ...(setor ? { setor } : {}),
      }),
    ]);

    // Se setor fuzzy zerou kpis por match exato, usa ranking fuzzy
    let setorInfo: unknown = null;
    if (setor) {
      setorInfo = await this.setorResumo(de, ate, setor);
    }

    const tot = kpis.totais;
    const topCausas = (kpis.porCausa || []).slice(0, 5);
    const topSetores = (kpis.direcionamento || []).slice(0, 5);
    const insights: string[] = [];
    if (tot.n === 0) {
      insights.push('Sem reclamações no recorte — confirme período/SKU/setor antes de concluir ausência.');
    } else {
      if (tot.aguardando > 0) insights.push(`${tot.aguardando} aguardando produto — risco de fila.`);
      if (tot.pctMeta != null && tot.pctMeta < 70)
        insights.push(`Só ${tot.pctMeta}% na meta de prazo — tratativa lenta.`);
      if (tot.pctRecorrentes >= 15) insights.push(`Recorrência alta (${tot.pctRecorrentes}%) — padrão repetindo.`);
      if (topCausas[0]) insights.push(`Causa dominante: ${topCausas[0].k} (${topCausas[0].n}).`);
      if (topSetores[0]) insights.push(`Setor com mais volume: ${topSetores[0].k} (${topSetores[0].n}).`);
      const ppm = (pontos as { ppm?: { skusAcima?: number; geral?: number | null; limite?: number } }).ppm;
      if (ppm && (ppm.skusAcima || 0) > 0)
        insights.push(`${ppm.skusAcima} SKU(s) acima do limite PPM (${ppm.limite}).`);
    }

    return {
      de,
      ate,
      filtros: { setor: setor || null, sku: skuCanon || sku || null },
      kpi: tot,
      top_causas: topCausas.map((g) => ({ nome: g.k, n: g.n, custo: g.custo })),
      top_setores: topSetores.map((g) => ({ nome: g.k, n: g.n })),
      setor_detalhe: setorInfo,
      alertas_abertos: (pontos as { alertas_abertos?: number }).alertas_abertos,
      ppm: (pontos as { ppm?: unknown }).ppm,
      amostra: (lista as { itens?: unknown[] }).itens?.slice(0, 8) || [],
      insights,
    };
  }

  private async reclamacoesListar(args: Record<string, unknown>) {
    const de = String(args.de);
    const ate = String(args.ate);
    const causaId =
      typeof args.causa === 'string' && args.causa.trim() ? args.causa.trim().toLowerCase() : '';
    const causaNorm =
      causaId === 'kits' || causaId === 'kit_montagem' || causaId === 'faltando_kit' ? 'kit' : causaId;

    let skuCanon: string | undefined;
    let skuInput: string | undefined;
    if (typeof args.sku === 'string' && args.sku.trim()) {
      skuInput = args.sku.trim();
      const resolved = await this.skuResolver(skuInput);
      if (resolved.encontrado && 'melhor' in resolved && resolved.melhor) {
        skuCanon = resolved.melhor.sku;
      }
    }

    const baseQuery: Record<string, string | undefined> = {
      de,
      ate,
      limit: '200',
      ordem: 'data_desc',
    };
    if (args.status) baseQuery.status = String(args.status);
    if (args.q) baseQuery.q = String(args.q);
    if (causaNorm) baseQuery.causa = causaNorm;

    let rows = await this.reclamacoes.list({
      ...baseQuery,
      ...(skuCanon ? { sku: skuCanon } : {}),
    });

    // Fuzzy SKU se equals falhou (cadastro com hífen/espaço diferente)
    if (skuInput && rows.length === 0) {
      const all = await this.reclamacoes.list({ ...baseQuery });
      const needle = normSku(skuInput);
      rows = all.filter((r) => {
        const n = normSku(r.sku);
        return n === needle || n.includes(needle) || needle.includes(n);
      });
    } else if (skuInput && skuCanon) {
      // reforça: mesma família normalizada
      const needle = normSku(skuCanon);
      rows = rows.filter((r) => normSku(r.sku) === needle || normSku(r.sku).includes(needle));
    }

    if (args.setor) {
      const needle = String(args.setor);
      if (!rows.length) {
        rows = await this.reclamacoes.list({ ...baseQuery, ...(skuCanon ? { sku: skuCanon } : {}) });
      }
      rows = rows.filter((r) =>
        setorFuzzyMatch(String((r as { setorResp?: string }).setorResp || ''), needle),
      );
    }

    if (causaNorm === 'kit' && rows.length === 0) {
      rows = await this.reclamacoes.list({
        de,
        ate,
        limit: '200',
        ordem: 'data_desc',
        q: 'kit',
        ...(skuCanon ? { sku: skuCanon } : {}),
      });
      rows = rows.filter((r) => {
        const c = String((r as { causa?: { id?: string } }).causa?.id || causaDe(r).id);
        const nome = String((r as { causa?: { nome?: string } }).causa?.nome || '');
        const txt = `${r.reclamacao || ''} ${r.laudo || ''} ${nome}`.toLowerCase();
        return c === 'kit' || /kit/.test(txt);
      });
    }

    const total = rows.length;
    const itens = rows.slice(0, 15).map((r) => {
      const en = r as {
        reg: number;
        data: string;
        sku: string;
        produto?: string;
        situacao?: string;
        causa?: { nome?: string };
        setorResp?: string;
        cliente?: string;
      };
      return {
        reg: en.reg,
        data: en.data,
        sku: en.sku,
        produto: (en.produto || '').slice(0, 50),
        situacao: en.situacao || situacao(r),
        causa: en.causa?.nome || causaDe(r).nome,
        setor: en.setorResp || '',
        cliente: (en.cliente || '').slice(0, 30),
      };
    });
    return {
      de,
      ate,
      filtro_causa: causaNorm || null,
      sku_input: skuInput || null,
      sku_canonico: skuCanon || null,
      total,
      total_retornado: itens.length,
      truncado: total > itens.length,
      itens,
    };
  }

  private async reclamacaoStatus(token: string) {
    const t = token.trim();
    if (!t) return { erro: 'Informe reg ou protocolo' };
    const digits = t.replace(/\D/g, '');
    const regNum = Number(digits);
    const byReg =
      Number.isFinite(regNum) && digits.length > 0
        ? await this.prisma.reclamacao.findFirst({
            where: { reg: regNum },
            include: { causas: { orderBy: { ordem: 'asc' as const } } },
          })
        : null;
    const r =
      byReg ||
      (t.length >= 4
        ? await this.prisma.reclamacao.findFirst({
            where: { protocolo: { equals: t, mode: 'insensitive' } },
            include: { causas: { orderBy: { ordem: 'asc' as const } } },
          })
        : null) ||
      (t.length >= 6
        ? await this.prisma.reclamacao.findFirst({
            where: { protocolo: { contains: t, mode: 'insensitive' } },
            include: { causas: { orderBy: { ordem: 'asc' as const } } },
          })
        : null);
    if (!r) return { encontrado: false, token: t };
    const sit = situacao(r);
    const causa = causaDe(r);
    return {
      encontrado: true,
      reg: r.reg,
      protocolo: r.protocolo,
      data: r.data,
      situacao: sit,
      sku: r.sku,
      produto: r.produto,
      cliente: r.cliente,
      causa: causa.nome,
      setor: r.setorRespManual || causa.setor,
      devolucao: r.devolucao,
      dataAcao: r.dataAcao || null,
    };
  }

  private async kpiResumo(de: string, ate: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    return { de, ate, totais: k.totais };
  }

  private async causasTop(de: string, ate: string, limite: number) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const lim = Math.min(Math.max(limite || 8, 1), 12);
    return {
      de,
      ate,
      causas: (k.porCausa || []).slice(0, lim).map((g) => ({ nome: g.k, n: g.n, custo: g.custo })),
    };
  }

  private async setorResumo(de: string, ate: string, nome: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const ranking = (k.direcionamento || []).map((g) => ({ nome: g.k, n: g.n, custo: g.custo }));
    if (!nome) {
      return { de, ate, setores: ranking.slice(0, 10) };
    }

    const match = ranking.filter((g) => setorFuzzyMatch(g.nome, nome));
    if (!match.length) {
      return {
        de,
        ate,
        filtro: nome,
        encontrado: false,
        mensagem:
          `Nenhum setor casou com "${nome}". Use um dos nomes oficiais abaixo (não diga que não há reclamações no período).`,
        setores_disponiveis: ranking.slice(0, 12),
      };
    }

    // Agrega matches fuzzy (pode haver 1+ nomes oficiais)
    const nomesOficiais = match.map((m) => m.nome);
    const n = match.reduce((a, m) => a + m.n, 0);
    const custo = match.reduce((a, m) => a + m.custo, 0);

    // Amostra + causas no recorte fuzzy (sem exigir match exato de resp)
    const amostra = await this.reclamacoesListar({ de, ate, setor: nome, limit: '10' });
    const detalhePrimario = await this.reclamacoes.kpis({ de, ate, resp: nomesOficiais[0] });

    return {
      de,
      ate,
      filtro: nome,
      encontrado: true,
      nomes_oficiais: nomesOficiais,
      totais: {
        n,
        custo,
        // detalhe do principal (se um só match); se vários, n agregado acima
        aguardando: match.length === 1 ? detalhePrimario.totais.aguardando : undefined,
        tratativa: match.length === 1 ? detalhePrimario.totais.tratativa : undefined,
        resolvida: match.length === 1 ? detalhePrimario.totais.resolvida : undefined,
        tempoMedio: match.length === 1 ? detalhePrimario.totais.tempoMedio : undefined,
      },
      por_nome: match,
      top_causas: (detalhePrimario.porCausa || []).slice(0, 5).map((g) => ({ nome: g.k, n: g.n })),
      amostra: (amostra as { itens?: unknown[] }).itens || [],
    };
  }

  private async pontosAtencao(de?: string, ate?: string) {
    const periodo = resolverPeriodo(de || ate ? undefined : '15d', de, ate);
    const [alertas, kpis, painel] = await Promise.all([
      this.alertas.list('aberto'),
      this.reclamacoes.kpis({ de: periodo.de, ate: periodo.ate }),
      this.qualidade.painel({ de: periodo.de, ate: periodo.ate }),
    ]);
    const aguardando = (await this.reclamacoes.list({
      de: periodo.de,
      ate: periodo.ate,
      status: 'aguardando',
      limit: '10',
      ordem: 'data_asc',
    })).slice(0, 8);

    return {
      periodo,
      alertas_abertos: alertas.length,
      alertas_amostra: alertas.slice(0, 6).map((a) => ({
        tipo: a.tipo,
        titulo: (a.titulo || '').slice(0, 80),
        reg: a.reclamacao?.reg ?? null,
      })),
      kpi: {
        n: kpis.totais.n,
        aguardando: kpis.totais.aguardando,
        tratativa: kpis.totais.tratativa,
        tempoMedio: kpis.totais.tempoMedio,
        pctMeta: kpis.totais.pctMeta,
        pctRecorrentes: kpis.totais.pctRecorrentes,
      },
      ppm: {
        geral: painel.totais.ppm,
        limite: painel.limitePpm,
        skusAcima: painel.totais.acimaLimite,
        criticos: (painel.topDefeitos || [])
          .filter((g) => g.acimaLimite)
          .slice(0, 5)
          .map((g) => ({ sku: g.sku, reclamacoes: g.reclamacoes, ppm: g.ppm })),
      },
      aguardando_amostra: aguardando.map((r) => ({
        reg: r.reg,
        data: r.data,
        sku: r.sku,
        cliente: (r.cliente || '').slice(0, 30),
      })),
    };
  }

  private async alertasAbertos(limite: number) {
    const lista = await this.alertas.list('aberto');
    const lim = Math.min(Math.max(limite || 10, 1), 20);
    return {
      total: lista.length,
      itens: lista.slice(0, lim).map((a) => ({
        tipo: a.tipo,
        titulo: a.titulo,
        reg: a.reclamacao?.reg ?? null,
        criadoEm: a.criadoEm,
      })),
    };
  }

  private async ppmQualidade(de: string, ate: string) {
    const p = await this.qualidade.painel({ de, ate });
    return {
      de,
      ate,
      limitePpm: p.limitePpm,
      totais: p.totais,
      planosAbertos: p.planosAbertos,
      criticos: (p.topDefeitos || [])
        .filter((g) => g.acimaLimite)
        .slice(0, 8)
        .map((g) => ({
          sku: g.sku,
          produto: g.produto,
          reclamacoes: g.reclamacoes,
          vendas: g.vendas,
          ppm: g.ppm,
        })),
    };
  }
}
