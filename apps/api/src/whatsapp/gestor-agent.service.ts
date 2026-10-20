import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReclamacoesService } from '../reclamacoes/reclamacoes.service';
import { QualidadeService } from '../qualidade/qualidade.service';
import { AlertasService } from '../alertas/alertas.service';
import { IaService } from '../ia/ia.service';
import { GestorToolsService, resolverPeriodo } from './gestor-tools';

const SYSTEM_ORQUESTRADOR =
  'Você é o assistente do gestor do SAC AISA (pós-venda industrial). ' +
  'Conversa natural no WhatsApp — como um analista experiente, não como um bot de menu.\n' +
  'Regras:\n' +
  '1) Nunca invente números, registros ou status. Use só o que as tools devolverem.\n' +
  '2) Se faltar período, use periodo_resolver (hoje / semana / 15d / 30d conforme o pedido; se não disser, “hoje”).\n' +
  '3) Respostas curtas e humanas. Bullets só quando listar. Máx. ~1500 caracteres.\n' +
  '4) Só leitura. Não prometa estorno, prazo ou alteração de reclamação.\n' +
  '5) Riscos → pontos_atencao. Uma reclamação → reclamacao_status.\n' +
  '6) Tool vazia → diga que não há dados; não chute.\n' +
  '7) Fuso America/Sao_Paulo.\n' +
  '8) NÃO liste menus, comandos, atalhos (KPI/CAUSAS/MENU) nem “digite X”. ' +
  'Se cumprimentarem, responda em 1–2 frases e pergunte o que quer ver (hoje, semana, um registro, pontos de atenção) — sem cardápio.\n' +
  '9) Se pedirem “o que você faz”, use catalogo e explique em prosa, sem lista de comandos.';

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

  async responder(texto: string): Promise<string> {
    const t = texto.trim() || 'oi';

    // Com IA: tudo é conversa (interpretar → tools → resposta humana). Sem menu/atalho.
    if (this.ia.hasLlm()) {
      try {
        const resposta = await this.ia.chatWithTools({
          system: SYSTEM_ORQUESTRADOR,
          user: t,
          tools: this.tools.defs(),
          executeTool: (name, args) => this.tools.execute(name, args),
          maxRounds: 4,
          temperature: 0.45,
          timeoutMs: 25_000,
          modelOverride: process.env.GESTOR_LLM_MODEL?.trim() || undefined,
        });
        return this.clampWhatsapp(resposta);
      } catch (e) {
        this.log.warn(`Orquestrador gestor falhou: ${e}`);
        return 'Deu uma falha aqui agora. Manda de novo em instantes, por favor.';
      }
    }

    // Sem OPENROUTER: fallback mínimo (só se a chave sumir)
    const lower = t.toLowerCase();
    const atalho = await this.tryAtalho(t, lower);
    if (atalho != null) return atalho;
    return 'Oi. Preciso da chave de IA na API pra conversar com você. Fala com o time pra ligar o OPENROUTER.';
  }

  private clampWhatsapp(s: string) {
    const t = s.trim();
    if (t.length <= 3500) return t;
    return t.slice(0, 3400) + '\n…';
  }

  /** Só tokens exatos (ou SETOR + nome). Frases com período vão para o LLM. */
  private async tryAtalho(t: string, lower: string): Promise<string | null> {
    const { de, ate } = resolverPeriodo('30d');
    try {
      if (lower === 'kpi' || lower === 'kpis') {
        return await this.cmdKpi(de, ate);
      }
      if (lower === 'causas') {
        return await this.cmdCausas(de, ate);
      }
      if (lower === 'setor' || /^setor\s+\S+/i.test(t)) {
        const nome = t.replace(/^setor\s*/i, '').trim();
        // "setor da semana" → LLM; "setor embalagem" → atalho
        if (nome && /\b(hoje|ontem|semana|dias?|mês|mes|kpi|alerta)\b/i.test(nome)) {
          return null;
        }
        return await this.cmdSetor(de, ate, nome);
      }
      if (lower === 'ppm' || lower === 'qualidade') {
        return await this.cmdPpm(de, ate);
      }
      if (lower === 'alertas' || lower === 'alerta') {
        return await this.cmdAlertas();
      }
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
      `Reclamações: *${tot.n}*\n` +
      `Aguardando: ${tot.aguardando} · Tratativa: ${tot.tratativa} · Resolvidas: ${tot.resolvida}\n` +
      `Tempo médio: *${tempo}*\n` +
      `Meta: ${meta}\n` +
      `Custo total: R$ ${tot.custo.toFixed(0)}\n` +
      `Recorrência (≥3): ${tot.pctRecorrentes}%`
    );
  }

  private async cmdCausas(de: string, ate: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const top = (k.porCausa || []).slice(0, 8);
    if (!top.length) return `Nenhuma causa no período ${de} → ${ate}.`;
    const linhas = top.map((g, i) => `${i + 1}. ${g.k} — *${g.n}* (R$ ${g.custo.toFixed(0)})`);
    return `*Principais causas* (${de} → ${ate})\n${linhas.join('\n')}`;
  }

  private async cmdSetor(de: string, ate: string, nome: string) {
    if (!nome) {
      const k = await this.reclamacoes.kpis({ de, ate });
      const top = (k.direcionamento || []).slice(0, 8);
      if (!top.length) return 'Nenhum setor responsável no período.';
      const linhas = top.map((g, i) => `${i + 1}. ${g.k} — *${g.n}*`);
      return (
        `*Setores responsáveis* (${de} → ${ate})\n${linhas.join('\n')}\n\n` +
        `Detalhe: *SETOR Embalagem* (ou outro nome).`
      );
    }
    const k = await this.reclamacoes.kpis({ de, ate, resp: nome });
    const needle = nome.toLowerCase();
    const match = (k.direcionamento || []).filter((g) => g.k.toLowerCase().includes(needle));
    if (!match.length && k.totais.n === 0) {
      return `Nada para setor "*${nome}*" em ${de} → ${ate}. Tente *SETOR* sem nome para ver a lista.`;
    }
    const lista = match.length ? match : [{ k: nome, n: k.totais.n, custo: k.totais.custo }];
    const causas = (k.porCausa || []).slice(0, 5);
    return (
      `*Setor: ${lista[0].k}* (${de} → ${ate})\n` +
      `Reclamações: *${k.totais.n}* · Aguardando: ${k.totais.aguardando} · Tratativa: ${k.totais.tratativa}\n` +
      `Tempo médio: ${k.totais.tempoMedio == null ? '—' : k.totais.tempoMedio.toFixed(1) + 'd'}\n` +
      (causas.length ? `Top causas:\n${causas.map((c) => `· ${c.k} (${c.n})`).join('\n')}` : '')
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
              `· ${g.sku} — ${g.reclamacoes} rec / ${g.vendas} vend · ${g.ppm == null ? '—' : Math.round(g.ppm) + ' ppm'}`,
          )
          .join('\n')
      : 'Nenhum SKU acima do limite no período.';
    return (
      `*Qualidade / PPM* (${de} → ${ate})\n` +
      `PPM geral: *${ppm}* · Limite: ${p.limitePpm}\n` +
      `SKUs acima: ${tot.acimaLimite} · Planos abertos: ${p.planosAbertos}\n` +
      `Críticos:\n${linhas}`
    );
  }

  private async cmdAlertas() {
    const lista = await this.alertas.list('aberto');
    const n = lista.length;
    if (!n) return 'Nenhum alerta *aberto* agora.';
    const top = lista.slice(0, 8);
    const linhas = top.map((a) => {
      const reg = a.reclamacao?.reg ? `#${a.reclamacao.reg}` : '';
      return `· ${a.tipo} ${reg} — ${(a.titulo || '').slice(0, 60)}`;
    });
    return `*Alertas abertos: ${n}*\n${linhas.join('\n')}${n > 8 ? `\n… +${n - 8}` : ''}`;
  }
}
