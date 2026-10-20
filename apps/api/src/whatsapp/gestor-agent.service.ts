import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReclamacoesService } from '../reclamacoes/reclamacoes.service';
import { QualidadeService } from '../qualidade/qualidade.service';
import { AlertasService } from '../alertas/alertas.service';
import { IaService } from '../ia/ia.service';
import { GestorToolsService, resolverPeriodo } from './gestor-tools';
import { GestorMemoryService, type GestorSlots } from './gestor-memory.service';

const SYSTEM_ORQUESTRADOR =
  'Você é o analista do gestor SAC AISA (pós-venda industrial). Orquestrador competente: decide tools, cruza dados e responde para decisão.\n' +
  'Formato WhatsApp (obrigatório):\n' +
  '- Use bullets com o caractere • (não use - nem * no início da linha).\n' +
  '- Negrito só assim: *texto* (um asterisco). NUNCA use **texto**, ## títulos, ``` ou markdown de site.\n' +
  '- Resposta curta, clara, com 1–3 insights úteis quando houver dados.\n' +
  'Regras de orquestração:\n' +
  '1) HISTÓRICO + slots persistentes: “ok”, “e esse?”, “este ano” continuam o tema — nunca reinicie com “como posso ajudar”.\n' +
  '2) SKU: se falarem g-156 / g156 / G 156, chame sku_resolver ou sku_analise. Nunca diga que não existe sem resolver fuzzy.\n' +
  '3) Pedido claro → tools na hora. Período padrão 30 dias; “este ano” → preset ano. Não pergunte período se der para assumir.\n' +
  '4) Análise / atenção / cruzar → analise_cruzada ou pontos_atencao + kpi. Use os insights da tool.\n' +
  '5) Kit faltando → reclamacoes_listar causa=kit. Setor “Embalagens” → fuzzy.\n' +
  '6) Nunca invente número. Tool {erro} ≠ zero reclamações.\n' +
  '7) Proibido: “aguarde”, “um momento”, menus, comandos KPI/MENU.\n' +
  '8) Só leitura. Fuso America/Sao_Paulo.';

@Injectable()
export class GestorAgentService {
  private readonly log = new Logger(GestorAgentService.name);

  constructor(
    private prisma: PrismaService,
    private reclamacoes: ReclamacoesService,
    private qualidade: QualidadeService,
    private alertas: AlertasService,
    private ia: IaService,
    private tools: GestorToolsService,
    private memory: GestorMemoryService,
  ) {}

  /** Telefone (ou LID) está autorizado a usar o ramo gestor? */
  async isGestor(telefone: string, lid?: string): Promise<{ ok: boolean; nome?: string }> {
    const digits = telefone.replace(/\D/g, '');
    const lidDigits = (lid || '').replace(/\D/g, '');
    if (!digits && !lidDigits) return { ok: false };

    const envList = (process.env.GESTOR_WHATSAPP_TELEFONES || '')
      .split(/[,;\s]+/)
      .map((t) => t.replace(/\D/g, ''))
      .filter(Boolean);
    if (envList.some((t) => this.phoneMatch(digits, t) || (lidDigits && this.phoneMatch(lidDigits, t)))) {
      return { ok: true, nome: 'Gestor (lista env)' };
    }

    const usuarios = await this.prisma.usuario.findMany({
      where: {
        ativo: true,
        perfil: { in: ['master', 'gestor'] },
        telefone: { not: null },
      },
      select: { telefone: true, nome: true, login: true },
    });
    for (const u of usuarios) {
      const t = String(u.telefone || '').replace(/\D/g, '');
      if (t && this.phoneMatch(digits, t)) {
        return { ok: true, nome: u.nome || u.login };
      }
    }

    const destinos = await this.prisma.alertaDestino.findMany({
      where: { ativo: true },
      select: { telefone: true, nome: true, perfil: true },
    });
    for (const d of destinos) {
      const perfil = (d.perfil || '').toLowerCase();
      if (!perfil.includes('gestor') && !perfil.includes('master')) continue;
      const t = String(d.telefone || '').replace(/\D/g, '');
      if (t && this.phoneMatch(digits, t)) {
        return { ok: true, nome: d.nome || 'Gestor' };
      }
    }

    return { ok: false };
  }

  private phoneMatch(a: string, b: string) {
    if (a === b) return true;
    const sa = a.slice(-11);
    const sb = b.slice(-11);
    return sa.length >= 10 && sb.length >= 10 && (sa.endsWith(sb) || sb.endsWith(sa));
  }

  /** Popula Redis a partir do Postgres se a memória estiver vazia (ex.: após redeploy). */
  async seedMemoryFromDb(telefone: string, conversaId: string) {
    const mem = await this.memory.load(telefone);
    if (mem.turns.length > 0) return;
    const recentes = await this.prisma.whatsappMensagem.findMany({
      where: { conversaId },
      orderBy: { criadoEm: 'asc' },
      take: 20,
      select: { direcao: true, texto: true },
    });
    for (const m of recentes) {
      if (!m.texto?.trim()) continue;
      await this.memory.appendTurn(
        telefone,
        m.direcao === 'inbound' ? 'user' : 'assistant',
        String(m.texto).slice(0, 1500),
      );
    }
  }

  async responder(
    texto: string,
    opts?: {
      telefone?: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    },
  ): Promise<string> {
    const t = texto.trim() || 'oi';
    const telefone = opts?.telefone || '';

    let history = opts?.history || [];
    let slotsHint = '';
    if (telefone) {
      const mem = await this.memory.load(telefone);
      history = this.memory.historyForLlm(mem); // sem a msg atual (vai no user)
      slotsHint = this.memory.slotsHint(mem.slots);
      await this.memory.appendTurn(telefone, 'user', t);
    }

    if (this.ia.hasLlm()) {
      try {
        const slotPatch: Partial<GestorSlots> = {};
        const system = slotsHint ? `${SYSTEM_ORQUESTRADOR}\n\n${slotsHint}` : SYSTEM_ORQUESTRADOR;

        const resposta = await this.ia.chatWithTools({
          system,
          user: t,
          history,
          tools: this.tools.defs(),
          executeTool: async (name, args) => {
            const result = await this.tools.execute(name, args);
            this.captureSlots(name, args, result, slotPatch);
            return result;
          },
          maxRounds: 6,
          temperature: 0.3,
          timeoutMs: 40_000,
          modelOverride: process.env.GESTOR_LLM_MODEL?.trim() || undefined,
        });

        const formatted = this.formatWhatsapp(resposta);
        if (telefone) {
          await this.memory.appendTurn(telefone, 'assistant', formatted, slotPatch);
        }
        return formatted;
      } catch (e) {
        this.log.warn(`Orquestrador gestor falhou: ${e}`);
        return 'Deu uma falha aqui agora. Manda de novo em instantes, por favor.';
      }
    }

    const lower = t.toLowerCase();
    const atalho = await this.tryAtalho(t, lower);
    if (atalho != null) {
      const formatted = this.formatWhatsapp(atalho);
      if (telefone) await this.memory.appendTurn(telefone, 'assistant', formatted);
      return formatted;
    }
    return 'Oi. Preciso da chave de IA na API pra conversar com você. Fala com o time pra ligar o OPENROUTER.';
  }

  private captureSlots(
    name: string,
    args: Record<string, unknown>,
    result: unknown,
    patch: Partial<GestorSlots>,
  ) {
    const r = result as Record<string, unknown>;
    if (name === 'periodo_resolver' && r.de && r.ate) {
      patch.ultimoPeriodo = {
        de: String(r.de),
        ate: String(r.ate),
        label: r.label != null ? String(r.label) : undefined,
      };
    }
    if (name === 'sku_resolver' || name === 'sku_analise') {
      const melhor = r.melhor as { sku?: string } | undefined;
      const canon = r.sku_canonico != null ? String(r.sku_canonico) : melhor?.sku;
      if (canon) patch.ultimoSku = canon;
    }
    if (name === 'reclamacoes_listar' && r.sku_canonico) {
      patch.ultimoSku = String(r.sku_canonico);
    }
    if (name === 'setor_resumo' && typeof args.nome === 'string' && args.nome) {
      const nomes = r.nomes_oficiais as string[] | undefined;
      patch.ultimoSetor = nomes?.[0] || args.nome;
    }
    if (typeof args.causa === 'string' && args.causa) patch.ultimaCausa = args.causa;
    if (name === 'analise_cruzada' || name === 'pontos_atencao') patch.ultimoTema = 'analise';
  }

  /** Limpa markdown de site e padroniza bullets WhatsApp. */
  formatWhatsapp(s: string): string {
    let t = (s || '').trim();
    t = t.replace(/```[\s\S]*?```/g, '');
    t = t.replace(/^#{1,6}\s+/gm, '');
    t = t.replace(/\*\*(.+?)\*\*/g, '*$1*');
    t = t.replace(/__(.+?)__/g, '*$1*');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/^(\s*)[-*]\s+/gm, '$1• ');
    t = t.replace(/\n{3,}/g, '\n\n');
    if (t.length <= 3500) return t;
    return t.slice(0, 3400) + '\n…';
  }

  private async tryAtalho(t: string, lower: string): Promise<string | null> {
    const { de, ate } = resolverPeriodo('30d');
    try {
      if (lower === 'kpi' || lower === 'kpis') return await this.cmdKpi(de, ate);
      if (lower === 'causas') return await this.cmdCausas(de, ate);
      if (lower === 'setor' || /^setor\s+\S+/i.test(t)) {
        const nome = t.replace(/^setor\s*/i, '').trim();
        if (nome && /\b(hoje|ontem|semana|dias?|mês|mes|kpi|alerta)\b/i.test(nome)) return null;
        return await this.cmdSetor(de, ate, nome);
      }
      if (lower === 'ppm' || lower === 'qualidade') return await this.cmdPpm(de, ate);
      if (lower === 'alertas' || lower === 'alerta') return await this.cmdAlertas();
    } catch (e) {
      this.log.warn(`Atalho gestor falhou (${lower}): ${e}`);
      return 'Não consegui consultar agora. Tente de novo em instantes ou use o painel web.';
    }
    return null;
  }

  private async cmdKpi(de: string, ate: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const tot = k.totais;
    const tempo = tot.tempoMedio == null ? '—' : `${tot.tempoMedio.toFixed(1)} dias`;
    const meta = tot.pctMeta == null ? '—' : `${tot.pctMeta}% na meta (≤${tot.metaDias}d)`;
    return (
      `*KPI* (${de} → ${ate})\n` +
      `• Reclamações: *${tot.n}*\n` +
      `• Aguardando: ${tot.aguardando} · Tratativa: ${tot.tratativa} · Resolvidas: ${tot.resolvida}\n` +
      `• Tempo médio: *${tempo}*\n` +
      `• Meta: ${meta}\n` +
      `• Custo: R$ ${tot.custo.toFixed(0)} · Recorrência: ${tot.pctRecorrentes}%`
    );
  }

  private async cmdCausas(de: string, ate: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const top = (k.porCausa || []).slice(0, 8);
    if (!top.length) return `Nenhuma causa no período ${de} → ${ate}.`;
    const linhas = top.map((g, i) => `• ${i + 1}. ${g.k} — *${g.n}* (R$ ${g.custo.toFixed(0)})`);
    return `*Principais causas* (${de} → ${ate})\n${linhas.join('\n')}`;
  }

  private async cmdSetor(de: string, ate: string, nome: string) {
    if (!nome) {
      const k = await this.reclamacoes.kpis({ de, ate });
      const top = (k.direcionamento || []).slice(0, 8);
      if (!top.length) return 'Nenhum setor responsável no período.';
      return `*Setores* (${de} → ${ate})\n${top.map((g, i) => `• ${i + 1}. ${g.k} — *${g.n}*`).join('\n')}`;
    }
    const k = await this.reclamacoes.kpis({ de, ate, resp: nome });
    const needle = nome.toLowerCase();
    const match = (k.direcionamento || []).filter((g) => g.k.toLowerCase().includes(needle));
    if (!match.length && k.totais.n === 0) {
      return `Nada para setor "*${nome}*" em ${de} → ${ate}.`;
    }
    const lista = match.length ? match : [{ k: nome, n: k.totais.n, custo: k.totais.custo }];
    const causas = (k.porCausa || []).slice(0, 5);
    return (
      `*Setor: ${lista[0].k}* (${de} → ${ate})\n` +
      `• Reclamações: *${k.totais.n}* · Aguardando: ${k.totais.aguardando} · Tratativa: ${k.totais.tratativa}\n` +
      (causas.length ? causas.map((c) => `• ${c.k} (${c.n})`).join('\n') : '')
    );
  }

  private async cmdPpm(de: string, ate: string) {
    const p = await this.qualidade.painel({ de, ate });
    const tot = p.totais;
    const ppm = tot.ppm == null ? '—' : `${Math.round(tot.ppm).toLocaleString('pt-BR')} ppm`;
    const criticos = (p.topDefeitos || []).filter((g) => g.acimaLimite).slice(0, 5);
    const linhas = criticos.length
      ? criticos
          .map(
            (g) =>
              `• ${g.sku} — ${g.reclamacoes} rec / ${g.vendas} vend · ${g.ppm == null ? '—' : Math.round(g.ppm) + ' ppm'}`,
          )
          .join('\n')
      : '• Nenhum SKU acima do limite no período.';
    return `*Qualidade / PPM* (${de} → ${ate})\n• PPM geral: *${ppm}* · Limite: ${p.limitePpm}\n• SKUs acima: ${tot.acimaLimite}\n${linhas}`;
  }

  private async cmdAlertas() {
    const lista = await this.alertas.list('aberto');
    if (!lista.length) return 'Nenhum alerta *aberto* agora.';
    const linhas = lista.slice(0, 8).map((a) => {
      const reg = a.reclamacao?.reg ? `#${a.reclamacao.reg}` : '';
      return `• ${a.tipo} ${reg} — ${(a.titulo || '').slice(0, 60)}`;
    });
    return `*Alertas abertos: ${lista.length}*\n${linhas.join('\n')}`;
  }
}
