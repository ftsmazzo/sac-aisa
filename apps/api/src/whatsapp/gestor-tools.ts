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

/** Converte preset de período em { de, ate } (datas YYYY-MM-DD, fuso BR). */
export function resolverPeriodo(preset?: string, de?: string, ate?: string): { de: string; ate: string; label: string } {
  const hoje = isoHojeBr();
  if (de || ate) {
    return { de: de || ate || hoje, ate: ate || de || hoje, label: `${de || '?'} → ${ate || '?'}` };
  }
  const p = (preset || 'hoje').toLowerCase().trim();
  if (p === 'hoje' || p === 'today') return { de: hoje, ate: hoje, label: 'hoje' };
  if (p === 'ontem' || p === 'yesterday') {
    const o = addDaysIso(hoje, -1);
    return { de: o, ate: o, label: 'ontem' };
  }
  if (p === 'semana' || p === '7d' || p === '7dias' || p === 'últimos 7 dias' || p === 'ultimos 7 dias') {
    return { de: addDaysIso(hoje, -6), ate: hoje, label: 'últimos 7 dias' };
  }
  if (p === '15d' || p === '15dias' || p === 'últimos 15 dias' || p === 'ultimos 15 dias') {
    return { de: addDaysIso(hoje, -14), ate: hoje, label: 'últimos 15 dias' };
  }
  if (p === '30d' || p === '30dias' || p === 'mes' || p === 'mês' || p === 'ultimos 30 dias' || p === 'últimos 30 dias') {
    return { de: addDaysIso(hoje, -29), ate: hoje, label: 'últimos 30 dias' };
  }
  return { de: hoje, ate: hoje, label: 'hoje (padrão)' };
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
        'Converte linguagem de período em datas {de, ate} no fuso America/Sao_Paulo. Use ANTES de listar/KPI quando o gestor disser hoje, ontem, semana, 15 dias, 30 dias. Não invente datas: use preset ou de/ate explícitos. Não lista reclamações.',
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            description: 'hoje | ontem | semana | 15d | 30d',
          },
          de: { type: 'string', description: 'Data início YYYY-MM-DD (opcional se tiver preset)' },
          ate: { type: 'string', description: 'Data fim YYYY-MM-DD (opcional se tiver preset)' },
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
        'Lista resumida de reclamações no período (máx. 15). Use para “reclamações de hoje/semana/15 dias”, filtros por status/setor/sku. Não use para KPI agregado (use kpi_resumo) nem para um único protocolo (use reclamacao_status). Sempre passe de/ate (chame periodo_resolver antes se preciso).',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string', description: 'YYYY-MM-DD início' },
          ate: { type: 'string', description: 'YYYY-MM-DD fim' },
          status: {
            type: 'string',
            description: 'aguardando | tratativa | resolvida (opcional)',
          },
          setor: { type: 'string', description: 'Setor responsável (opcional, match exato/fuzzy via resp)' },
          sku: { type: 'string', description: 'SKU (opcional)' },
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
        'Resumo por setor responsável. Sem nome: ranking de setores. Com nome: detalhe daquele setor (fuzzy). Use para “embalagem”, “setores críticos”.',
      parameters: {
        type: 'object',
        properties: {
          de: { type: 'string' },
          ate: { type: 'string' },
          nome: { type: 'string', description: 'Nome parcial do setor (opcional)' },
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
          );
        case 'reclamacoes_listar': {
          const d = this.datasOuErro(args);
          if ('erro' in d) return d;
          return this.reclamacoesListar({ ...args, ...d });
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
        'Reclamações por período (hoje, semana, 15/30 dias)',
        'Status de um registro ou protocolo',
        'Resumo (volumes, tempo, meta), causas, setores, PPM, alertas',
        'Pontos de atenção / o que está crítico',
      ],
      nao_cobre: ['Alterar reclamação', 'Fluxo de cliente', 'Promessas financeiras'],
      tom: 'Responda em prosa; não cite menus nem palavras-comando.',
    };
  }

  private async reclamacoesListar(args: Record<string, unknown>) {
    const de = String(args.de);
    const ate = String(args.ate);
    const query: Record<string, string | undefined> = {
      de,
      ate,
      limit: '15',
      ordem: 'data_desc',
    };
    if (args.status) query.status = String(args.status);
    if (args.sku) query.sku = String(args.sku);
    if (args.q) query.q = String(args.q);
    if (args.setor) query.resp = String(args.setor);

    let rows = await this.reclamacoes.list(query);
    // Se resp exige match exato e veio vazio com setor fuzzy, tenta filtrar por includes
    if (args.setor && rows.length === 0) {
      const all = await this.reclamacoes.list({ de, ate, limit: '80', ordem: 'data_desc' });
      const needle = String(args.setor).toLowerCase();
      rows = all
        .filter((r) => String((r as { setorResp?: string }).setorResp || '').toLowerCase().includes(needle))
        .slice(0, 15);
    }

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
        produto: (en.produto || '').slice(0, 40),
        situacao: en.situacao || situacao(r),
        causa: en.causa?.nome || causaDe(r).nome,
        setor: en.setorResp || '',
        cliente: (en.cliente || '').slice(0, 30),
      };
    });
    return { de, ate, total_retornado: itens.length, itens };
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
    if (!nome) {
      return {
        de,
        ate,
        setores: (k.direcionamento || []).slice(0, 10).map((g) => ({ nome: g.k, n: g.n, custo: g.custo })),
      };
    }
    const needle = nome.toLowerCase();
    const match = (k.direcionamento || []).filter((g) => g.k.toLowerCase().includes(needle));
    const detalhe = await this.reclamacoes.kpis({ de, ate, resp: match[0]?.k || nome });
    return {
      de,
      ate,
      filtro: nome,
      matches: match.slice(0, 5),
      totais: detalhe.totais,
      top_causas: (detalhe.porCausa || []).slice(0, 5).map((g) => ({ nome: g.k, n: g.n })),
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
