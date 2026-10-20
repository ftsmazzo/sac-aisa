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
    const { telefone, destinoEnvio, texto, nome, lid } = msg;
    if (!texto) return { ignored: true };

    this.log.log(
      `WA inbound telefone=${telefone}${lid ? ` lid=${lid}` : ''} destino=${destinoEnvio} texto=${texto.slice(0, 40)}`,
    );

    // Ramo gestor (allowlist) — não mistura com fluxo de cliente
    const gestor = await this.gestorAgent.isGestor(telefone, lid);
    if (gestor.ok) {
      return this.handleGestor(telefone, destinoEnvio, texto, nome, gestor.nome);
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
      await this.reply(conversa.id, destinoEnvio, `Voltamos ao início.\n\n${MENU}`);
      return { retorno: true };
    }

    if (['atendente', 'humano', 'operador'].some((k) => lower.includes(k))) {
      const reply =
        'Certo! Encaminhei para um atendente do SAC. Em horário comercial alguém retoma por aqui.';
      await this.reply(conversa.id, destinoEnvio, reply);
      await this.prisma.whatsappConversa.update({
        where: { id: conversa.id },
        data: { estado: 'handoff' },
      });
      return { handoff: true };
    }

    if (lower.startsWith('status') || lower.startsWith('protocolo') || /^\d{1,6}$/.test(lower)) {
      return this.consultarStatus(conversa.id, destinoEnvio, texto);
    }

    if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'menu', 'inicio', 'início'].includes(lower)) {
      await this.prisma.whatsappConversa.update({
        where: { id: conversa.id },
        data: { estado: 'coletar_nome', contexto: {} },
      });
      await this.reply(conversa.id, destinoEnvio, MENU);
      return { ok: true };
    }

    if (
      lower === 'nova' ||
      conversa.estado.startsWith('coletar') ||
      conversa.estado === 'confirmar_sku' ||
      conversa.estado === 'inicio'
    ) {
      return this.fluxoNova(conversa.id, destinoEnvio, texto, conversa.estado, (conversa.contexto || {}) as Ctx);
    }

    await this.reply(
      conversa.id,
      destinoEnvio,
      'Não entendi. Digite *MENU*, *NOVA*, *STATUS 123* ou *ATENDENTE*.',
    );
    return { ok: true };
  }

  private async handleGestor(
    telefone: string,
    destinoEnvio: string,
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
    await this.reply(conversa.id, destinoEnvio, resposta);
    return { ok: true, gestor: true };
  }

  /**
   * Evolution v2+ manda remoteJid como `@lid` e o telefone real em `remoteJidAlt`
   * (ex.: 5511…@s.whatsapp.net). Sem isso o SAC “ouve” e não consegue responder.
   */
  private extractMessage(payload: unknown): {
    telefone: string;
    destinoEnvio: string;
    texto: string;
    nome?: string;
    lid?: string;
  } | null {
    const p = payload as Record<string, unknown>;
    let data = (p.data || p) as Record<string, unknown>;
    if (Array.isArray(data)) data = (data[0] || {}) as Record<string, unknown>;
    // alguns payloads: data.message / data.messages
    if (!data.key && Array.isArray(data.messages)) {
      data = (data.messages[0] || {}) as Record<string, unknown>;
    }

    const key = (data.key || {}) as Record<string, unknown>;
    if (key.fromMe) return null;

    const remoteJid = String(key.remoteJid || data.remoteJid || '');
    if (!remoteJid) {
      this.log.warn('Webhook sem remoteJid — ignorado');
      return null;
    }
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return null;

    const remoteJidAlt = String(
      key.remoteJidAlt || key.senderPn || data.senderPn || key.participantAlt || '',
    );
    const isLid = remoteJid.includes('@lid');
    const lid = isLid ? remoteJid.replace(/@.*/, '').replace(/\D/g, '') || undefined : undefined;

    // Telefone real: preferir Alt (5511…@s.whatsapp.net). Nunca tratar @lid como telefone.
    let telefone = '';
    if (remoteJidAlt && !remoteJidAlt.includes('@lid')) {
      telefone = remoteJidAlt.replace(/@.*/, '').replace(/\D/g, '');
    }
    if (!telefone && !isLid) {
      telefone = remoteJid.replace(/@.*/, '').replace(/\D/g, '');
    }
    // Fallback: só LID — chave interna = LID (allowlist pode listar o LID também)
    if (!telefone && lid) telefone = lid;

    if (!telefone) {
      this.log.warn(`Webhook sem telefone resolvível jid=${remoteJid} alt=${remoteJidAlt}`);
      return null;
    }

    // Destino de envio: telefone resolvido; se só LID, manda JID completo (Evolution aceita @lid)
    const telefoneResolvido = Boolean(remoteJidAlt && !remoteJidAlt.includes('@lid'));
    const destinoEnvio = telefoneResolvido
      ? telefone
      : remoteJid.includes('@')
        ? remoteJid
        : lid
          ? `${lid}@lid`
          : telefone;

    const message = (data.message || {}) as Record<string, unknown>;
    const texto = String(
      message.conversation ||
        (message.extendedTextMessage as { text?: string } | undefined)?.text ||
        (message.imageMessage as { caption?: string } | undefined)?.caption ||
        (message.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)
          ?.selectedDisplayText ||
        (message.listResponseMessage as { title?: string } | undefined)?.title ||
        data.body ||
        '',
    ).trim();
    const nome = String(data.pushName || '');
    return { telefone, destinoEnvio, texto, nome, lid };
  }

  private async reply(conversaId: string, destinoEnvio: string, texto: string) {
    await this.prisma.whatsappMensagem.create({
      data: { conversaId, direcao: 'outbound', texto },
    });
    try {
      await this.evolution.sendText(destinoEnvio, texto);
    } catch (e) {
      this.log.warn(`Falha envio Evolution (destino=${destinoEnvio}): ${e}`);
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
