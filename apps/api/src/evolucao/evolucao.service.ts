import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditoriaService } from '../auditoria.service';
import { QualidadeService } from '../qualidade/qualidade.service';
import { AuthUser } from '../auth/auth.types';
import { PoliticaService } from './politica.service';
import {
  ESTADOS_WHATSAPP_CLASSICOS,
  PONTO_DE_RETORNO,
  causaDe,
  sinalSeguranca,
} from '../domain-bridge';

export interface CartaoDecisao {
  id: string;
  tipo: 'atraso' | 'recorrencia' | 'ppm' | 'plano_sem_efeito' | 'custo' | 'outros' | 'seguranca' | 'rascunho';
  setorResp: string;
  titulo: string;
  fato: string;
  acaoSugerida: string;
  reclamacaoId?: string;
  sku?: string;
}

@Injectable()
export class EvolucaoService {
  constructor(
    private prisma: PrismaService,
    private politica: PoliticaService,
    private auditoria: AuditoriaService,
    private qualidade: QualidadeService,
  ) {}

  async estado() {
    const pol = await this.politica.get();
    return {
      ativa: pol.ativa,
      pontoDeRetorno: PONTO_DE_RETORNO,
      limiarDescartar: pol.limiarDescartar,
      limiarSobrepor: pol.limiarSobrepor,
      guardarDivergencia: pol.guardarDivergencia,
      comandosCliente: ['VOLTAR', 'CANCELAR', 'PONTO', 'RECOMECAR'],
    };
  }

  async ligar(user: AuthUser) {
    if (!process.env.EVOLUTION_WEBHOOK_SECRET?.trim()) {
      throw new BadRequestException(
        'Defina EVOLUTION_WEBHOOK_SECRET antes de sair do ponto de partida.',
      );
    }
    await this.prisma.config.upsert({
      where: { chave: 'evolucao.ativa' },
      create: { chave: 'evolucao.ativa', valor: '1' },
      update: { valor: '1' },
    });
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'ligou evolução',
      alvo: 'Config',
      detalhe: 'evolucao.ativa=1',
    });
    return this.estado();
  }

  async voltar(user: AuthUser) {
    await this.prisma.config.upsert({
      where: { chave: 'evolucao.ativa' },
      create: { chave: 'evolucao.ativa', valor: '0' },
      update: { valor: '0' },
    });
    const presas = await this.prisma.whatsappConversa.findMany({
      where: { estado: { notIn: [...ESTADOS_WHATSAPP_CLASSICOS] }, ativo: true },
    });
    if (presas.length) {
      await this.prisma.whatsappConversa.updateMany({
        where: { id: { in: presas.map((c) => c.id) } },
        data: { estado: 'inicio', contexto: {} },
      });
    }
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'voltou ao ponto de partida',
      alvo: 'Config',
      detalhe: `evolucao.ativa=0; conversas reiniciadas: ${presas.length}; commit ${PONTO_DE_RETORNO.commit}`,
    });
    return { ...(await this.estado()), conversasReiniciadas: presas.length };
  }

  async decisoes(setor?: string): Promise<{ ativa: boolean; cartoes: CartaoDecisao[] }> {
    const pol = await this.politica.get();
    if (!pol.ativa) return { ativa: false, cartoes: [] };

    const cartoes: CartaoDecisao[] = [];
    const alertas = await this.prisma.alerta.findMany({
      where: { status: { in: ['aberto', 'enviado'] } },
      include: { reclamacao: true },
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });

    for (const a of alertas) {
      const rec = a.reclamacao;
      const causa = rec ? causaDe(rec) : null;
      const setorResp = a.setorResp || causa?.setor || '';
      if (setor && setorResp !== setor) continue;
      cartoes.push({
        id: `alerta:${a.id}`,
        tipo: tipoDeAlerta(a.tipo),
        setorResp,
        titulo: a.titulo,
        fato: a.mensagem,
        acaoSugerida: causa?.acao || 'Confirmar no SAC antes de agir.',
        reclamacaoId: a.reclamacaoId || undefined,
        sku: rec?.sku || undefined,
      });
    }

    const abertas = await this.prisma.reclamacao.findMany({
      where: { OR: [{ dataAcao: null }, { dataAcao: '' }], rascunho: false },
      take: 500,
    });
    for (const r of abertas) {
      const causa = causaDe(r);
      if (!sinalSeguranca(causa.id)) continue;
      const setorResp = (r.setorRespManual || '').trim() || causa.setor;
      if (setor && setorResp !== setor) continue;
      if (cartoes.some((c) => c.tipo === 'seguranca' && c.reclamacaoId === r.id)) continue;
      cartoes.unshift({
        id: `seguranca:${r.id}`,
        tipo: 'seguranca',
        setorResp,
        titulo: `Sinal de segurança #${r.reg}`,
        fato: `${r.sku || 'sem SKU'} · ${causa.nome}. ${r.reclamacao || ''}`.slice(0, 280),
        acaoSugerida: causa.acao,
        reclamacaoId: r.id,
        sku: r.sku || undefined,
      });
    }

    const coef = await this.qualidade.coeficientes({});
    const acima = coef.porSku.filter((g) => g.acimaLimite && g.reclamacoes > 0).slice(0, 8);
    for (const g of acima) {
      if (setor && g.setorResp !== setor) continue;
      cartoes.push({
        id: `ppm:${g.sku}`,
        tipo: 'ppm',
        setorResp: g.setorResp,
        titulo: `PPM acima do limite · ${g.sku}`,
        fato: `${g.reclamacoes} reclamações em ${g.vendas} vendas. PPM ${g.ppm == null ? '—' : Math.round(g.ppm)}. Limite ${coef.limitePpm}.`,
        acaoSugerida: 'Abrir ou cobrar o plano de ação deste SKU.',
        sku: g.sku,
      });
    }

    const concluidos = await this.prisma.planoAcao.findMany({
      where: { status: 'concluido', sku: { not: '' } },
      orderBy: { alteradoEm: 'desc' },
      take: 40,
    });
    const acimaMap = new Map(coef.porSku.filter((g) => g.acimaLimite).map((g) => [g.sku, g]));
    for (const p of concluidos) {
      const g = acimaMap.get(p.sku.toUpperCase());
      if (!g) continue;
      if (setor && (p.setorResp || g.setorResp) !== setor) continue;
      cartoes.push({
        id: `plano:${p.id}`,
        tipo: 'plano_sem_efeito',
        setorResp: p.setorResp || g.setorResp,
        titulo: `Plano concluído sem queda de PPM · ${p.sku}`,
        fato: `${p.titulo}. O SKU segue acima do limite (${Math.round(g.ppm || 0)} PPM).`,
        acaoSugerida: 'Reabrir o plano ou registrar a evidência de por que o limite não se aplica.',
        sku: p.sku,
      });
    }

    return { ativa: true, cartoes };
  }
}

function tipoDeAlerta(tipo: string): CartaoDecisao['tipo'] {
  if (tipo === 'RECORRENCIA') return 'recorrencia';
  if (tipo === 'CUSTO_ALTO') return 'custo';
  if (tipo === 'CAUSA_OUTROS') return 'outros';
  if (tipo === 'RASCUNHO_WHATSAPP') return 'rascunho';
  return 'atraso';
}
