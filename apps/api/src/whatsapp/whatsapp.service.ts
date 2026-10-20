import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EvolutionService } from './evolution.service';
import { IaService } from '../ia/ia.service';
import { situacao, DEV_LABEL, devDe, comandoRetorno } from '../domain-bridge';
import { PoliticaService } from '../evolucao/politica.service';
import { AuditoriaService } from '../auditoria.service';
import { GestorAgentService } from './gestor-agent.service';

type Ctx = {
  passo?: string;
  nome?: string;
  canal?: string;
  sku?: string;
  produto?: string;
  uf?: string;
  relato?: string;
  protocolo?: string;
};

const MENU =
  'Olá! Sou o assistente do SAC AISA.\n\nDigite *STATUS* + nº do registro/protocolo para consultar.\nOu envie *NOVA* para abrir uma reclamação.\nPara falar com humano, digite *ATENDENTE*.\nSe a conversa sair do rumo, digite *VOLTAR*.';

@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    private prisma: PrismaService,
    private evolution: EvolutionService,
    private ia: IaService,
    private auditoria: AuditoriaService,
    private politica: PoliticaService,
    private gestorAgent: GestorAgentService,
  ) {}

  async handleWebhook(payload: unknown) {
    const msg = this.extractMessage(payload);
    if (!msg) return { ignored: true };
    const { telefone, texto, nome } = msg;
    if (!texto) return { ignored: true };

    // Ramo gestor (allowlist) — não mistura com fluxo de cliente
    const gestor = await this.gestorAgent.isGestor(telefone);
    if (gestor.ok) {
      return this.handleGestor(telefone, texto, nome, gestor.nome);
    }

    let conversa = await this.prisma.whatsappConversa.findFirst({
      where: { telefone, ativo: true, papel: 'cliente' },
      orderBy: { alteradoEm: 'desc' },
    });
    if (!conversa) {
      conversa = await this.prisma.whatsappConversa.create({
        data: { telefone, nome: nome || '', papel: 'cliente', estado: 'inicio', contexto: {} },
      });
    }

    await this.prisma.whatsappMensagem.create({
      data: { conversaId: conversa.id, direcao: 'inbound', texto, payload: payload as object },
    });

    const lower = texto.trim().toLowerCase();
    if (comandoRetorno(lower)) {
      await this.prisma.whatsappConversa.update({
        where: { id: conversa.id },
        data: { estado: 'inicio', contexto: {} },
      });
      await this.reply(conversa.id, telefone, `Voltamos ao início.\n\n${MENU}`);
      return { retorno: true };
    }

    if (['atendente', 'humano', 'operador'].some((k) => lower.includes(k))) {
      const reply =
        'Certo! Encaminhei para um atendente do SAC. Em horário comercial alguém retoma por aqui.';
      await this.reply(conversa.id, telefone, reply);
      await this.prisma.whatsappConversa.update({
        where: { id: conversa.id },
        data: { estado: 'handoff' },
      });
      return { handoff: true };
    }

    if (lower.startsWith('status') || lower.startsWith('protocolo') || /^\d{1,6}$/.test(lower)) {
      return this.consultarStatus(conversa.id, telefone, texto);
    }

    if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'menu', 'inicio', 'início'].includes(lower)) {
      await this.prisma.whatsappConversa.update({
        where: { id: conversa.id },
        data: { estado: 'coletar_nome', contexto: {} },
      });
      await this.reply(conversa.id, telefone, MENU);
      return { ok: true };
    }

    if (
      lower === 'nova' ||
      conversa.estado.startsWith('coletar') ||
      conversa.estado === 'confirmar_sku' ||
      conversa.estado === 'inicio'
    ) {
      return this.fluxoNova(conversa.id, telefone, texto, conversa.estado, (conversa.contexto || {}) as Ctx);
    }

    await this.reply(
      conversa.id,
      telefone,
      'Não entendi. Digite *MENU*, *NOVA*, *STATUS 123* ou *ATENDENTE*.',
    );
    return { ok: true };
  }

  private async handleGestor(
    telefone: string,
    texto: string,
    nomePush?: string,
    nomeGestor?: string,
  ) {
    let conversa = await this.prisma.whatsappConversa.findFirst({
      where: { telefone, ativo: true, papel: 'interno' },
      orderBy: { alteradoEm: 'desc' },
    });
    if (!conversa) {
      conversa = await this.prisma.whatsappConversa.create({
        data: {
          telefone,
          nome: nomeGestor || nomePush || '',
          papel: 'interno',
          estado: 'gestor',
          contexto: {},
        },
      });
    }
    await this.prisma.whatsappMensagem.create({
      data: { conversaId: conversa.id, direcao: 'inbound', texto },
    });
    const resposta = await this.gestorAgent.responder(texto);
    await this.reply(conversa.id, telefone, resposta);
    return { ok: true, gestor: true };
  }

  private extractMessage(payload: unknown): { telefone: string; texto: string; nome?: string } | null {
    const p = payload as Record<string, unknown>;
    const data = (p.data || p) as Record<string, unknown>;
    const key = data.key as Record<string, unknown> | undefined;
    const message = data.message as Record<string, unknown> | undefined;
    const remote = String(key?.remoteJid || data.remoteJid || '').replace(/@.*/, '');
    if (!remote || key?.fromMe) return null;
    const texto =
      String(
        message?.conversation ||
          (message?.extendedTextMessage as { text?: string } | undefined)?.text ||
          data.body ||
          '',
      ).trim();
    const nome = String(data.pushName || '');
    return { telefone: remote, texto, nome };
  }

  private async reply(conversaId: string, telefone: string, texto: string) {
    await this.prisma.whatsappMensagem.create({
      data: { conversaId, direcao: 'outbound', texto },
    });
    try {
      await this.evolution.sendText(telefone, texto);
    } catch (e) {
      this.log.warn(`Falha envio Evolution: ${e}`);
    }
  }

  private async consultarStatus(conversaId: string, telefone: string, texto: string) {
    const token = texto.replace(/status|protocolo/gi, '').trim();
    if (!token) {
      await this.reply(conversaId, telefone, 'Informe o nº do registro ou protocolo. Ex: STATUS 402');
      return { ok: true };
    }
    const regNum = Number(token);
    const r = await this.prisma.reclamacao.findFirst({
      where: {
        OR: [
          ...(Number.isFinite(regNum) ? [{ reg: regNum }] : []),
          { protocolo: { contains: token, mode: 'insensitive' as const } },
        ],
      },
    });
    if (!r) {
      await this.reply(conversaId, telefone, `Não encontrei reclamação com "${token}".`);
      return { ok: true };
    }
    const sit = situacao(r);
    const sitLabel =
      sit === 'resolvida'
        ? 'Resolvida'
        : sit === 'aguardando'
          ? 'Aguardando produto (a tratativa começa após a chegada)'
          : 'Em tratativa';
    const dev = DEV_LABEL[devDe(r)];
    await this.reply(
      conversaId,
      telefone,
      `Reclamação *#${r.reg}*\nSituação: *${sitLabel}*\nDevolução: ${dev}\nProduto: ${r.sku} ${r.produto}\n${r.dataAcao ? `Resolvida em ${r.dataAcao}` : 'Ainda em andamento.'}`,
    );
    return { ok: true, reg: r.reg };
  }

  private async fluxoNova(
    conversaId: string,
    telefone: string,
    texto: string,
    estado: string,
    ctx: Ctx,
  ) {
    const t = texto.trim();
    if (t.toLowerCase() === 'nova' || estado === 'inicio') {
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'coletar_nome', contexto: {} },
      });
      await this.reply(conversaId, telefone, 'Vamos abrir um rascunho. Qual o *nome do cliente*?');
      return { ok: true };
    }

    if (estado === 'coletar_nome') {
      ctx.nome = t;
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'coletar_canal', contexto: ctx },
      });
      await this.reply(conversaId, telefone, 'Qual o *canal*? (SITE, MERCADO LIVRE, SHOPEE, MAGALU…)');
      return { ok: true };
    }
    if (estado === 'coletar_canal') {
      ctx.canal = t.toUpperCase();
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'coletar_sku', contexto: ctx },
      });
      await this.reply(conversaId, telefone, 'Informe o *SKU* ou nome do produto.');
      return { ok: true };
    }
    if (estado === 'coletar_sku' || estado === 'confirmar_sku') {
      const pol = await this.politica.get();
      if (!pol.ativa) {
        ctx.sku = t.toUpperCase();
        ctx.produto = ctx.sku;
      } else if (estado === 'confirmar_sku' && t.toLowerCase() === 'confirma') {
        ctx.produto = ctx.sku;
      } else {
        const cod = t.toUpperCase();
        const prod = await this.prisma.produto.findFirst({
          where: { cod: { equals: cod, mode: 'insensitive' } },
        });
        if (!prod) {
          ctx.sku = cod;
          await this.prisma.whatsappConversa.update({
            where: { id: conversaId },
            data: { estado: 'confirmar_sku', contexto: ctx },
          });
          await this.reply(
            conversaId,
            telefone,
            `Não achei *${cod}* no cadastro. Digite outro código ou *CONFIRMA* para o SAC conferir. *VOLTAR* reinicia.`,
          );
          return { ok: true, skuLivre: true };
        }
        ctx.sku = prod.cod;
        ctx.produto = prod.produto;
      }
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'coletar_uf', contexto: ctx },
      });
      await this.reply(conversaId, telefone, 'Qual a *UF* (2 letras)?');
      return { ok: true };
    }
    if (estado === 'coletar_uf') {
      ctx.uf = t.toUpperCase().slice(0, 2);
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'coletar_relato', contexto: ctx },
      });
      await this.reply(conversaId, telefone, 'Descreva a *reclamação* do cliente.');
      return { ok: true };
    }
    if (estado === 'coletar_relato') {
      ctx.relato = t;
      const pol = await this.politica.get();
      if (pol.ativa) {
        await this.prisma.whatsappConversa.update({
          where: { id: conversaId },
          data: { estado: 'coletar_foto', contexto: ctx },
        });
        await this.reply(
          conversaId,
          telefone,
          'Se tiver foto da avaria, envie agora. Se não tiver, digite *PULAR*. *VOLTAR* reinicia.',
        );
        return { ok: true };
      }
      return this.abrirRascunho(conversaId, telefone, ctx);
    }
    if (estado === 'coletar_foto') {
      return this.abrirRascunho(conversaId, telefone, ctx);
    }

    await this.reply(conversaId, telefone, 'Digite *NOVA* para recomeçar ou *VOLTAR* para o início.');
    return { ok: true };
  }

  private async abrirRascunho(conversaId: string, telefone: string, ctx: Ctx) {
      const classif = await this.ia.classificar({
        reclamacao: ctx.relato,
        sku: ctx.sku,
        laudo: '',
      });
      const max = await this.prisma.reclamacao.aggregate({ _max: { reg: true } });
      const reg = (max._max.reg || 0) + 1;
      const hoje = new Date().toISOString().slice(0, 10);
      const created = await this.prisma.reclamacao.create({
        data: {
          reg,
          data: hoje,
          cliente: ctx.nome || '',
          canal: ctx.canal || 'WHATSAPP',
          sku: ctx.sku || '',
          produto: ctx.produto || ctx.sku || '',
          uf: ctx.uf || '',
          reclamacao: ctx.relato || '',
          causaId: classif.causaId,
          causaManual: false,
          peca: classif.peca,
          origem: 'whatsapp',
          whatsappTelefone: telefone,
          rascunho: true,
          situacao: 'tratativa',
          criadoPor: 'whatsapp',
          alteradoPor: 'whatsapp',
        },
      });
      await this.auditoria.registrar({
        user: 'whatsapp',
        nome: 'Agente WhatsApp',
        perfil: 'sistema',
        acao: 'criou',
        alvo: `Reclamação #${created.reg}`,
        detalhe: 'Rascunho via Evolution API',
        recId: created.id,
      });
      await this.prisma.whatsappConversa.update({
        where: { id: conversaId },
        data: { estado: 'inicio', contexto: {} },
      });
      await this.reply(
        conversaId,
        telefone,
        `Rascunho *#${created.reg}* criado para o SAC confirmar.\nCausa sugerida: ${classif.causaNome} (${classif.fonte}).\nSetor: ${classif.setor}.\n\nDigite *STATUS ${created.reg}* para acompanhar.`,
      );
      return { ok: true, reg: created.reg };
  }
}
