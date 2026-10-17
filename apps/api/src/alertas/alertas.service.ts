import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertStatus, AlertTipo } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  avaliarAlertasReclamacao,
  causaDe,
  DEFAULT_ALERT_CONFIG,
  situacao,
  type AlertConfig,
} from '../domain-bridge';
import { EvolutionService } from '../whatsapp/evolution.service';

@Injectable()
export class AlertasService {
  private readonly log = new Logger(AlertasService.name);

  constructor(
    private prisma: PrismaService,
    private evolution: EvolutionService,
  ) {}

  async getConfig(): Promise<AlertConfig> {
    const rows = await this.prisma.config.findMany();
    const m = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    return {
      aguardandoDias: Number(m.ALERT_AGUARDANDO_DIAS || process.env.ALERT_AGUARDANDO_DIAS) || DEFAULT_ALERT_CONFIG.aguardandoDias,
      metaDias: Number(m.metaDias || m.ALERT_META_DIAS || process.env.ALERT_META_DIAS) || DEFAULT_ALERT_CONFIG.metaDias,
      custoAlto: Number(m.ALERT_CUSTO_ALTO || process.env.ALERT_CUSTO_ALTO) || DEFAULT_ALERT_CONFIG.custoAlto,
      outrosDias: Number(m.ALERT_OUTROS_DIAS || process.env.ALERT_OUTROS_DIAS) || DEFAULT_ALERT_CONFIG.outrosDias,
      rascunhoWhatsappHoras:
        Number(m.ALERT_RASCUNHO_WHATSAPP_HORAS || process.env.ALERT_RASCUNHO_WHATSAPP_HORAS) ||
        DEFAULT_ALERT_CONFIG.rascunhoWhatsappHoras,
    };
  }

  async list(status?: string) {
    return this.prisma.alerta.findMany({
      where: status ? { status: status as AlertStatus } : undefined,
      include: { reclamacao: { select: { id: true, reg: true, cliente: true, sku: true } } },
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
  }

  async countAbertos() {
    return this.prisma.alerta.count({ where: { status: 'aberto' } });
  }

  private titulo(tipo: AlertTipo, reg?: number) {
    const map: Record<AlertTipo, string> = {
      AGUARDANDO_DIAS: `Produto aguardando há muitos dias (#${reg ?? '?'})`,
      TRATATIVA_META: `Tratativa acima da meta (#${reg ?? '?'})`,
      RECORRENCIA: `Problema recorrente detectado`,
      CUSTO_ALTO: `Custo alto em aberto (#${reg ?? '?'})`,
      CAUSA_OUTROS: `Causa sem classificação (#${reg ?? '?'})`,
      RASCUNHO_WHATSAPP: `Rascunho WhatsApp sem confirmação (#${reg ?? '?'})`,
    };
    return map[tipo];
  }

  async upsertAlerta(params: {
    tipo: AlertTipo;
    chaveDedupe: string;
    mensagem: string;
    reclamacaoId?: string;
    setorResp?: string;
    reg?: number;
    meta?: object;
  }) {
    const existing = await this.prisma.alerta.findUnique({
      where: { chaveDedupe: params.chaveDedupe },
    });
    if (existing && existing.status !== 'resolvido') return existing;

    const alerta = await this.prisma.alerta.upsert({
      where: { chaveDedupe: params.chaveDedupe },
      create: {
        tipo: params.tipo,
        titulo: this.titulo(params.tipo, params.reg),
        mensagem: params.mensagem,
        reclamacaoId: params.reclamacaoId,
        chaveDedupe: params.chaveDedupe,
        setorResp: params.setorResp,
        meta: params.meta,
        status: 'aberto',
      },
      update: {
        status: 'aberto',
        mensagem: params.mensagem,
        resolvidoEm: null,
      },
    });

    await this.notificarInterno(alerta.id);
    return alerta;
  }

  async notificarInterno(alertaId: string) {
    const alerta = await this.prisma.alerta.findUnique({ where: { id: alertaId } });
    if (!alerta || alerta.status === 'enviado') return;

    const destinos = await this.prisma.alertaDestino.findMany({
      where: {
        ativo: true,
        OR: [
          { setor: alerta.setorResp || '' },
          { setor: '' },
          { perfil: 'gestor' },
        ],
      },
    });

    const texto = `*[SAC AISA]* ${alerta.titulo}\n${alerta.mensagem}`;
    for (const d of destinos) {
      try {
        await this.evolution.sendText(d.telefone, texto);
      } catch (e) {
        this.log.warn(`Falha WhatsApp interno ${d.telefone}: ${e}`);
      }
    }
    if (destinos.length) {
      await this.prisma.alerta.update({
        where: { id: alertaId },
        data: { status: 'enviado', enviadoEm: new Date() },
      });
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async varrer() {
    this.log.log('Varrendo alertas inteligentes…');
    await this.executarVarredura();
  }

  async executarVarredura() {
    const cfg = await this.getConfig();
    const regs = await this.prisma.reclamacao.findMany({
      where: { OR: [{ dataAcao: null }, { dataAcao: '' }], rascunho: false },
    });
    const hoje = new Date().toISOString().slice(0, 10);
    const semana = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

    for (const r of regs) {
      const tipos = avaliarAlertasReclamacao(r, cfg, hoje);
      const setor = (r.setorRespManual || '').trim() || causaDe(r).setor;
      for (const tipo of tipos) {
        await this.upsertAlerta({
          tipo: tipo as AlertTipo,
          chaveDedupe: `${tipo}:${r.id}:${hoje.slice(0, 7)}`,
          mensagem: `#${r.reg} ${r.sku} — ${r.cliente || 'cliente'} — situação ${situacao(r)}`,
          reclamacaoId: r.id,
          setorResp: setor,
          reg: r.reg,
        });
      }
    }

    // recorrência: mesmo sku + causa >= 3 nos últimos 30 dias
    const recentes = await this.prisma.reclamacao.findMany({
      where: { data: { gte: semana } },
    });
    const gr = new Map<string, typeof recentes>();
    for (const r of recentes) {
      const key = `${r.sku}|${causaDe(r).id}`;
      const arr = gr.get(key) || [];
      arr.push(r);
      gr.set(key, arr);
    }
    for (const [key, arr] of gr) {
      if (arr.length < 3) continue;
      const [sku, causaId] = key.split('|');
      await this.upsertAlerta({
        tipo: 'RECORRENCIA',
        chaveDedupe: `RECORRENCIA:${key}:${hoje.slice(0, 7)}`,
        mensagem: `${arr.length} casos do SKU ${sku} com causa ${causaId} nos últimos 30 dias.`,
        setorResp: causaDe(arr[0]).setor,
        meta: { sku, causaId, n: arr.length, ids: arr.map((x) => x.id) },
      });
    }

    // rascunhos whatsapp
    const rascunhos = await this.prisma.reclamacao.findMany({
      where: { origem: 'whatsapp', rascunho: true },
    });
    for (const r of rascunhos) {
      const tipos = avaliarAlertasReclamacao({ ...r, origem: 'whatsapp' }, cfg, hoje);
      if (tipos.includes('RASCUNHO_WHATSAPP')) {
        await this.upsertAlerta({
          tipo: 'RASCUNHO_WHATSAPP',
          chaveDedupe: `RASCUNHO_WHATSAPP:${r.id}`,
          mensagem: `Rascunho WhatsApp #${r.reg} sem confirmação do SAC.`,
          reclamacaoId: r.id,
          reg: r.reg,
        });
      }
    }

    return { ok: true, abertos: await this.countAbertos() };
  }

  async resolver(id: string) {
    return this.prisma.alerta.update({
      where: { id },
      data: { status: 'resolvido', resolvidoEm: new Date() },
    });
  }

  async ignorar(id: string) {
    return this.prisma.alerta.update({
      where: { id },
      data: { status: 'ignorado', resolvidoEm: new Date() },
    });
  }

  destinos() {
    return this.prisma.alertaDestino.findMany({ orderBy: { nome: 'asc' } });
  }

  async salvarDestino(body: {
    id?: string;
    setor?: string;
    perfil?: string;
    telefone: string;
    nome?: string;
    ativo?: boolean;
  }) {
    if (body.id) {
      return this.prisma.alertaDestino.update({
        where: { id: body.id },
        data: {
          setor: body.setor ?? '',
          perfil: body.perfil ?? '',
          telefone: body.telefone,
          nome: body.nome ?? '',
          ativo: body.ativo !== false,
        },
      });
    }
    return this.prisma.alertaDestino.create({
      data: {
        setor: body.setor ?? '',
        perfil: body.perfil ?? '',
        telefone: body.telefone,
        nome: body.nome ?? '',
        ativo: body.ativo !== false,
      },
    });
  }
}
