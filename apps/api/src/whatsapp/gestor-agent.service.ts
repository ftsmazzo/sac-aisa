import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReclamacoesService } from '../reclamacoes/reclamacoes.service';
import { QualidadeService } from '../qualidade/qualidade.service';
import { AlertasService } from '../alertas/alertas.service';

const MENU_GESTOR =
  '*Assistente do gestor — SAC AISA*\n' +
  'Período padrão: últimos 30 dias.\n\n' +
  '*KPI* — totais, tempo médio, meta\n' +
  '*CAUSAS* — principais motivos\n' +
  '*SETOR* <nome> — reclamações do setor resp.\n' +
  '*PPM* — qualidade / SKUs críticos\n' +
  '*ALERTAS* — alertas abertos\n' +
  '*MENU* — este texto\n\n' +
  'Somente leitura. Para o fluxo de cliente use outro número.';

@Injectable()
export class GestorAgentService {
  private readonly log = new Logger(GestorAgentService.name);

  constructor(
    private prisma: PrismaService,
    private reclamacoes: ReclamacoesService,
    private qualidade: QualidadeService,
    private alertas: AlertasService,
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
      // Só destinos explicitamente de gestor/master (evita liberar setor operacional)
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
    // BR: compara sufixo de 10–11 dígitos (DDD+número)
    const sa = a.slice(-11);
    const sb = b.slice(-11);
    return sa.length >= 10 && sb.length >= 10 && (sa.endsWith(sb) || sb.endsWith(sa));
  }

  private periodoPadrao() {
    const ate = new Date();
    const de = new Date(Date.now() - 30 * 864e5);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { de: iso(de), ate: iso(ate) };
  }

  async responder(texto: string): Promise<string> {
    const t = texto.trim();
    const lower = t.toLowerCase();
    const { de, ate } = this.periodoPadrao();

    if (
      !t ||
      ['menu', 'ajuda', 'help', 'oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(lower)
    ) {
      return MENU_GESTOR;
    }

    try {
      if (lower === 'kpi' || lower === 'kpis' || lower.startsWith('kpi ')) {
        return await this.cmdKpi(de, ate);
      }
      if (lower === 'causas' || lower.startsWith('causas ')) {
        return await this.cmdCausas(de, ate);
      }
      if (lower.startsWith('setor')) {
        const nome = t.replace(/^setor\s*/i, '').trim();
        return await this.cmdSetor(de, ate, nome);
      }
      if (lower === 'ppm' || lower.startsWith('ppm ') || lower === 'qualidade') {
        return await this.cmdPpm(de, ate);
      }
      if (lower === 'alertas' || lower.startsWith('alerta')) {
        return await this.cmdAlertas();
      }
    } catch (e) {
      this.log.warn(`Comando gestor falhou (${lower}): ${e}`);
      return 'Não consegui consultar agora. Tente de novo em instantes ou use o painel web.';
    }

    return `Não reconheci o comando.\n\n${MENU_GESTOR}`;
  }

  private async cmdKpi(de: string, ate: string) {
    const k = await this.reclamacoes.kpis({ de, ate });
    const t = k.totais;
    const tempo =
      t.tempoMedio == null ? '—' : `${t.tempoMedio.toFixed(1)} dias`;
    const meta = t.pctMeta == null ? '—' : `${t.pctMeta}% na meta (≤${t.metaDias}d)`;
    return (
      `*KPI* (${de} → ${ate})\n` +
      `Reclamações: *${t.n}*\n` +
      `Aguardando: ${t.aguardando} · Tratativa: ${t.tratativa} · Resolvidas: ${t.resolvida}\n` +
      `Tempo médio: *${tempo}*\n` +
      `Meta: ${meta}\n` +
      `Custo total: R$ ${t.custo.toFixed(0)}\n` +
      `Recorrência (≥3): ${t.pctRecorrentes}%`
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
    // Filtrar direcionamento fuzzy
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
      (causas.length
        ? `Top causas:\n${causas.map((c) => `· ${c.k} (${c.n})`).join('\n')}`
        : '')
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
