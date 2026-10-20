import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Devolucao, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  situacao,
  causaDe,
  enrichReclamacao,
  CAUSA_POR_ID,
  type CausaDef,
} from '../domain-bridge';
import { AuditoriaService } from '../auditoria.service';
import { AuthUser } from '../auth/auth.types';
import { PoliticaService } from '../evolucao/politica.service';
import { ProdutoLookupService } from '../produtos/produto-lookup.service';
import { AlertasService } from '../alertas/alertas.service';

@Injectable()
export class ReclamacoesService {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
    private politica: PoliticaService,
    private produtos: ProdutoLookupService,
    private alertas: AlertasService,
  ) {}

  async overrides(): Promise<Record<string, Partial<CausaDef>>> {
    const rows = await this.prisma.regraDirecionamento.findMany();
    return Object.fromEntries(
      rows.map((r) => [r.causaId, { setor: r.setor || undefined, acao: r.acao || undefined }]),
    );
  }

  async list(query: Record<string, string | undefined>) {
    const where: Prisma.ReclamacaoWhereInput = {};
    if (query.de || query.ate) {
      where.data = {};
      if (query.de) where.data.gte = query.de;
      if (query.ate) where.data.lte = query.ate;
    }
    if (query.empresa) where.empresa = query.empresa;
    if (query.setor === '(vazio)') where.setor = '';
    else if (query.setor) where.setor = query.setor;
    if (query.laudo) where.laudo = query.laudo;
    if (query.canal) where.canal = query.canal;
    if (query.uf) where.uf = query.uf;
    if (query.proc) where.procedencia = query.proc;
    if (query.dev) where.devolucao = query.dev as Devolucao;
    if (query.origem) where.origem = query.origem;
    if (query.rascunho === '1') where.rascunho = true;
    if (query.rascunho === '0') where.rascunho = false;
    if (query.sku) {
      where.sku = { equals: query.sku.trim(), mode: 'insensitive' };
    }
    if (query.q) {
      const q = query.q.trim();
      const asNum = Number(q);
      where.OR = [
        { sku: { contains: q, mode: 'insensitive' } },
        { produto: { contains: q, mode: 'insensitive' } },
        { cliente: { contains: q, mode: 'insensitive' } },
        { cidade: { contains: q, mode: 'insensitive' } },
        { protocolo: { contains: q, mode: 'insensitive' } },
        { reclamacao: { contains: q, mode: 'insensitive' } },
        { solucao: { contains: q, mode: 'insensitive' } },
        { laudo: { contains: q, mode: 'insensitive' } },
        { obs: { contains: q, mode: 'insensitive' } },
        { obsCausa: { contains: q, mode: 'insensitive' } },
        { familia: { contains: q, mode: 'insensitive' } },
        { peca: { contains: q, mode: 'insensitive' } },
        ...(Number.isFinite(asNum) && String(asNum) === q ? [{ reg: asNum }] : []),
      ];
    }

    // Situação é derivada: traduz filtros comuns para SQL
    if (query.status === 'resolvida') {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { NOT: { OR: [{ dataAcao: null }, { dataAcao: '' }] } }];
    } else if (query.status === 'aguardando') {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ dataAcao: null }, { dataAcao: '' }] },
        { devolucao: 'AGUARDANDO' },
      ];
    } else if (query.status === 'tratativa') {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ dataAcao: null }, { dataAcao: '' }] },
        { NOT: { devolucao: 'AGUARDANDO' } },
      ];
    }

    const ordem = query.ordem || 'data_desc';
    const orderByDb = this.orderByFromOrdem(ordem);
    // Campos derivados (custo, dias, situação, causa, setor resp.) ordenam depois do enrich
    const ordemDerivada = [
      'custo_asc',
      'custo_desc',
      'dias_asc',
      'dias_desc',
      'situacao_asc',
      'situacao_desc',
      'causa_asc',
      'causa_desc',
      'resp_asc',
      'resp_desc',
      'dev_asc',
      'dev_desc',
      'aguard_first',
    ].includes(ordem);

    const unbounded = query.todos === '1';
    const pageSize = unbounded
      ? 50_000
      : Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
    const page = Math.max(Number(query.page) || 1, 1);
    const skip = unbounded ? 0 : (page - 1) * pageSize;
    const precisaFiltroDerivado = !!(query.causa || query.resp || ordemDerivada);

    const overrides = await this.overrides();
    // Lista não carrega fotos (anexos vêm em GET /reclamacoes/:id/anexos)
    // Filtros derivados (causa/resp) precisam carregar candidates; ainda assim respeitam o teto.
    const takeSql = precisaFiltroDerivado ? Math.min(pageSize * 20, 50_000) : pageSize;
    let rows = await this.prisma.reclamacao.findMany({
      where,
      orderBy: orderByDb,
      take: takeSql,
      skip: precisaFiltroDerivado ? 0 : skip,
      include: { causas: { orderBy: { ordem: 'asc' } } },
    });

    rows = rows.map((r) => ({ ...r, situacao: situacao(r) }));

    if (query.causa) {
      rows = rows.filter((r) => {
        const ids = r.causas?.length
          ? r.causas.map((c) => c.causaId)
          : [causaDe(r, overrides).id];
        return ids.includes(query.causa!);
      });
    }
    if (query.resp) {
      rows = rows.filter((r) => {
        const manual = (r.setorRespManual || '').trim();
        return (manual || causaDe(r, overrides).setor) === query.resp;
      });
    }

    let enriched = rows.map((r) => enrichReclamacao(r, overrides));
    enriched = this.sortLista(enriched, ordem);

    if (precisaFiltroDerivado) {
      enriched = enriched.slice(skip, skip + pageSize);
    } else if (enriched.length > pageSize) {
      enriched = enriched.slice(0, pageSize);
    }

    return enriched;
  }

  private orderByFromOrdem(
    ordem: string,
  ): Prisma.ReclamacaoOrderByWithRelationInput[] {
    switch (ordem) {
      case 'reg_asc':
        return [{ reg: 'asc' }];
      case 'reg_desc':
        return [{ reg: 'desc' }];
      case 'data_asc':
        return [{ data: 'asc' }, { reg: 'asc' }];
      case 'sku_asc':
        return [{ sku: 'asc' }, { reg: 'desc' }];
      case 'sku_desc':
        return [{ sku: 'desc' }, { reg: 'desc' }];
      case 'empresa_asc':
        return [{ empresa: 'asc' }, { reg: 'desc' }];
      case 'empresa_desc':
        return [{ empresa: 'desc' }, { reg: 'desc' }];
      case 'cliente_asc':
        return [{ cliente: 'asc' }, { reg: 'desc' }];
      case 'cliente_desc':
        return [{ cliente: 'desc' }, { reg: 'desc' }];
      case 'setor_asc':
        return [{ setor: 'asc' }, { reg: 'desc' }];
      case 'setor_desc':
        return [{ setor: 'desc' }, { reg: 'desc' }];
      case 'data_desc':
      default:
        return [{ data: 'desc' }, { reg: 'desc' }];
    }
  }

  private sortLista<T>(rows: T[], ordem: string): T[] {
    type Row = T & {
      reg?: number;
      data?: string | null;
      situacao?: string;
      custoTotal?: number;
      tempoDias?: number | null;
      causa?: { nome?: string };
      setorResp?: string;
      devolucao?: string;
    };
    const list = rows as Row[];
    const cmpStr = (a: string, b: string) => (a || '').localeCompare(b || '', 'pt-BR', { sensitivity: 'base' });
    const mul = ordem.endsWith('_asc') ? 1 : -1;
    let sorted: Row[];
    if (ordem === 'aguard_first') {
      sorted = [...list].sort(
        (a, b) =>
          (a.situacao === 'aguardando' ? 0 : 1) - (b.situacao === 'aguardando' ? 0 : 1) ||
          String(b.data || '').localeCompare(String(a.data || '')) ||
          (b.reg || 0) - (a.reg || 0),
      );
    } else if (ordem.startsWith('custo_')) {
      sorted = [...list].sort((a, b) => mul * (Number(a.custoTotal || 0) - Number(b.custoTotal || 0)));
    } else if (ordem.startsWith('dias_')) {
      sorted = [...list].sort((a, b) => mul * ((a.tempoDias ?? -1) - (b.tempoDias ?? -1)));
    } else if (ordem.startsWith('situacao_')) {
      sorted = [...list].sort((a, b) => mul * cmpStr(String(a.situacao), String(b.situacao)));
    } else if (ordem.startsWith('causa_')) {
      sorted = [...list].sort((a, b) => mul * cmpStr(String(a.causa?.nome), String(b.causa?.nome)));
    } else if (ordem.startsWith('resp_')) {
      sorted = [...list].sort((a, b) => mul * cmpStr(String(a.setorResp), String(b.setorResp)));
    } else if (ordem.startsWith('dev_')) {
      sorted = [...list].sort((a, b) => mul * cmpStr(String(a.devolucao), String(b.devolucao)));
    } else {
      return rows;
    }
    return sorted as T[];
  }

  async get(id: string) {
    const r = await this.prisma.reclamacao.findUnique({
      where: { id },
      include: { fotos: true, causas: { orderBy: { ordem: 'asc' } } },
    });
    if (!r) throw new NotFoundException('Reclamação não encontrada');
    const overrides = await this.overrides();
    return enrichReclamacao({ ...r, situacao: situacao(r) }, overrides);
  }

  /** Sincroniza motivos (máx. 5). Mantém causaId = primária. */
  private async syncCausas(reclamacaoId: string, body: Record<string, unknown>, fallbackCausaId?: string) {
    let ids: string[] = [];
    if (Array.isArray(body.causasIds) && body.causasIds.length > 0) {
      ids = body.causasIds.map((x) => String(x || '').trim()).filter(Boolean);
    } else if (body.causaId !== undefined && String(body.causaId || '').trim()) {
      ids = [String(body.causaId).trim()];
    } else if (fallbackCausaId) {
      ids = [fallbackCausaId];
    } else {
      return; // nada a sincronizar
    }
    ids = [...new Set(ids.filter((id) => !!CAUSA_POR_ID[id]))].slice(0, 5);
    if (!ids.length) return;
    const primaria =
      (typeof body.causaId === 'string' && ids.includes(body.causaId) && body.causaId) ||
      ids[0];
    const causaManual =
      body.causaManual !== undefined ? !!body.causaManual : true;

    await this.prisma.$transaction([
      this.prisma.reclamacaoCausa.deleteMany({ where: { reclamacaoId } }),
      this.prisma.reclamacaoCausa.createMany({
        data: ids.map((causaId, ordem) => ({
          reclamacaoId,
          causaId,
          primaria: causaId === primaria,
          ordem,
        })),
      }),
      this.prisma.reclamacao.update({
        where: { id: reclamacaoId },
        data: { causaId: primaria, causaManual },
      }),
    ]);
  }

  private mapBody(body: Record<string, unknown>, partial = false) {
    const num = (k: string) => Number(body[k] || 0) || 0;
    const str = (k: string) => String(body[k] ?? (partial ? undefined : '') ?? '');
    const data: Prisma.ReclamacaoUncheckedCreateInput | Prisma.ReclamacaoUncheckedUpdateInput = {};
    const fields = [
      'data',
      'empresa',
      'setor',
      'sku',
      'produto',
      'familia',
      'garantia',
      'canal',
      'protocolo',
      'cliente',
      'cidade',
      'uf',
      'reclamacao',
      'laudo',
      'procedencia',
      'solucao',
      'dataAcao',
      'obs',
      'transp',
      'dataRecebimento',
      'causaId',
      'obsCausa',
      'setorRespManual',
      'peca',
      'origem',
      'whatsappTelefone',
    ] as const;
    for (const f of fields) {
      if (body[f] !== undefined) (data as Record<string, unknown>)[f] = str(f);
    }
    for (const f of ['freteEnvio', 'freteRetorno', 'valorPeca', 'estorno', 'desconto', 'guia']) {
      if (body[f] !== undefined) (data as Record<string, unknown>)[f] = num(f);
    }
    if (body.devolucao !== undefined) {
      const d = String(body.devolucao || 'NA');
      data.devolucao =
        d === 'AGUARDANDO' || d === 'RECEBIDO' ? (d as Devolucao) : Devolucao.NA;
    }
    if (body.causaManual !== undefined) data.causaManual = !!body.causaManual;
    if (body.rascunho !== undefined) data.rascunho = !!body.rascunho;
    if (body.dataAcao === '') data.dataAcao = null;
    if (body.dataRecebimento === '') data.dataRecebimento = null;
    return data;
  }

  async create(body: Record<string, unknown>, user: AuthUser) {
    const max = await this.prisma.reclamacao.aggregate({ _max: { reg: true } });
    const reg = Number(body.reg) || (max._max.reg || 0) + 1;
    let mapped = this.mapBody(body) as Prisma.ReclamacaoUncheckedCreateInput;
    mapped = (await this.produtos.completarCampos(
      mapped as Record<string, unknown>,
    )) as Prisma.ReclamacaoUncheckedCreateInput;
    if (!mapped.causaManual && !mapped.causaId) {
      mapped.causaId = causaDe(mapped as never).id;
    }
    if (mapped.causaId && !CAUSA_POR_ID[String(mapped.causaId)]) {
      throw new BadRequestException('Causa inválida');
    }
    const draft = {
      ...mapped,
      reg,
      criadoPor: user.login,
      alteradoPor: user.login,
    };
    draft.situacao = situacao(draft as never);
    const created = await this.prisma.reclamacao.create({ data: draft });
    await this.syncCausas(created.id, body, String(created.causaId || ''));
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'criou',
      alvo: `Reclamação #${created.reg}`,
      recId: created.id,
    });
    return this.get(created.id);
  }

  async update(id: string, body: Record<string, unknown>, user: AuthUser) {
    const atual = await this.prisma.reclamacao.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Reclamação não encontrada');
    let mapped = this.mapBody(body, true) as Prisma.ReclamacaoUncheckedUpdateInput;
    const merged = { ...atual, ...mapped };
    // Se SKU veio no body (ou já existia) e setor fab. está vazio, completa do cadastro
    const preenchido = await this.produtos.completarCampos({
      sku: merged.sku,
      setor: merged.setor,
      produto: merged.produto,
      familia: merged.familia,
      empresa: merged.empresa,
    });
    if (!String(atual.setor || mapped.setor || '').trim() && preenchido.setor) {
      mapped.setor = preenchido.setor;
    }
    if (!String(atual.produto || mapped.produto || '').trim() && preenchido.produto) {
      mapped.produto = preenchido.produto;
    }
    if (!String(atual.familia || mapped.familia || '').trim() && preenchido.familia) {
      mapped.familia = preenchido.familia;
    }
    if (!String(atual.empresa || mapped.empresa || '').trim() && preenchido.empresa) {
      mapped.empresa = preenchido.empresa;
    }
    // SKU alterado: atualiza setor fab. a partir do novo produto
    if (
      mapped.sku !== undefined &&
      String(mapped.sku) !== String(atual.sku || '') &&
      preenchido.setor
    ) {
      mapped.setor = preenchido.setor;
      if (preenchido.familia) mapped.familia = preenchido.familia;
      if (preenchido.produto && (!mapped.produto || mapped.produto === atual.produto)) {
        mapped.produto = preenchido.produto;
      }
      if (preenchido.empresa && (!mapped.empresa || mapped.empresa === atual.empresa)) {
        mapped.empresa = preenchido.empresa;
      }
    }
    const finalMerged = { ...atual, ...mapped };
    mapped.situacao = situacao(finalMerged as never);
    mapped.alteradoPor = user.login;
    const updated = await this.prisma.reclamacao.update({ where: { id }, data: mapped });
    if (body.causasIds !== undefined || body.causaId !== undefined) {
      await this.syncCausas(updated.id, body, String(updated.causaId || ''));
    }
    const pol = await this.politica.get();
    const causaMudou =
      pol.ativa &&
      pol.guardarDivergencia &&
      mapped.causaId !== undefined &&
      String(mapped.causaId) !== String(atual.causaId || '');
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'editou',
      alvo: `Reclamação #${updated.reg}`,
      recId: updated.id,
      extra: causaMudou
        ? { causaSugerida: atual.causaId, causaFinal: String(mapped.causaId), fonte: 'correcao_humana' }
        : undefined,
    });

    // Produto chegou → cartão de revisão para o setor (Decidir hoje / Alertas)
    const virouRecebido =
      String(atual.devolucao) !== 'RECEBIDO' && String(updated.devolucao) === 'RECEBIDO';
    if (virouRecebido) {
      await this.alertas.criarRevisaoRecebido(updated);
    }
    // Caso resolvido → fecha o cartão de revisão
    const resolveu =
      !String(atual.dataAcao || '').trim() && !!String(updated.dataAcao || '').trim();
    if (resolveu) {
      await this.alertas.resolverRevisaoDaReclamacao(updated.id);
    }

    return this.get(updated.id);
  }

  async marcarRecebido(id: string, user: AuthUser) {
    const hoje = new Date().toISOString().slice(0, 10);
    return this.update(
      id,
      { devolucao: 'RECEBIDO', dataRecebimento: hoje, rascunho: false },
      user,
    );
  }

  async remove(id: string, user: AuthUser) {
    if (user.perfil === 'operador') throw new BadRequestException('Sem permissão');
    const r = await this.prisma.reclamacao.delete({ where: { id } });
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'excluiu',
      alvo: `Reclamação #${r.reg}`,
      recId: r.id,
    });
    return { ok: true };
  }

  async kpis(query: Record<string, string | undefined>) {
    const lista = await this.list({ ...query, todos: '1' });
    const n = lista.length;
    const cnt = (s: string) => lista.filter((r) => r.situacao === s).length;
    const custo = lista.reduce((a, r) => a + Number(r.custoTotal || 0), 0);
    const tempos = lista.map((r) => r.tempoDias).filter((t): t is number => t !== null);
    const tmed = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
    const meta = Number(
      (await this.prisma.config.findUnique({ where: { chave: 'metaDias' } }))?.valor || 2,
    );
    const resolvidas = lista.filter((r) => r.dataAcao && r.tempoDias !== null);
    const dentro = resolvidas.filter((r) => (r.tempoDias as number) <= meta).length;
    const pro = lista.filter((r) => r.procedencia === 'PROCEDE').length;
    const npro = lista.filter((r) => r.procedencia === 'NÃO PROCEDE').length;

    const gr = new Map<string, { cod: string; causaId: string; n: number; custo: number }>();
    for (const r of lista) {
      const key = `${r.sku}|${r.causa.id}`;
      const g = gr.get(key) || { cod: String(r.sku), causaId: r.causa.id, n: 0, custo: 0 };
      g.n++;
      g.custo += Number(r.custoTotal || 0);
      gr.set(key, g);
    }
    const recorrencias = [...gr.values()]
      .filter((g) => g.n >= 2)
      .sort((a, b) => b.n - a.n || b.custo - a.custo);
    const emRec = recorrencias.filter((g) => g.n >= 3).reduce((a, g) => a + g.n, 0);

    const group = (fn: (r: (typeof lista)[0]) => string) => {
      const m = new Map<string, { k: string; n: number; custo: number }>();
      for (const r of lista) {
        const k = fn(r) || '(vazio)';
        const g = m.get(k) || { k, n: 0, custo: 0 };
        g.n++;
        g.custo += Number(r.custoTotal || 0);
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.n - a.n);
    };

    return {
      totais: {
        n,
        aguardando: cnt('aguardando'),
        tratativa: cnt('tratativa'),
        resolvida: cnt('resolvida'),
        custo,
        custoMedio: n ? custo / n : 0,
        tempoMedio: tmed,
        metaDias: meta,
        pctMeta: resolvidas.length ? Math.round((dentro / resolvidas.length) * 100) : null,
        pctProcedentes: pro + npro ? Math.round((pro / (pro + npro)) * 100) : null,
        pctRecorrentes: n ? Math.round((emRec / n) * 100) : 0,
        emRecorrencia: emRec,
      },
      porCausa: group((r) => r.causa.nome),
      porEmpresa: group((r) => String(r.empresa)),
      porCanal: group((r) => String(r.canal)),
      porLaudo: group((r) => String(r.laudo)),
      porSetor: group((r) => String(r.setor)),
      porDev: group((r) => String(r.devolucao)),
      porUF: group((r) => String(r.uf)).slice(0, 10),
      recorrencias: recorrencias.slice(0, 20),
      direcionamento: group((r) => String(r.setorResp)),
    };
  }

  async parecidos(id: string) {
    const pol = await this.politica.get();
    if (!pol.ativa) return [];
    const atual = await this.prisma.reclamacao.findUnique({ where: { id } });
    if (!atual?.sku) return [];
    const causaId = causaDe(atual).id;
    const rows = await this.prisma.reclamacao.findMany({
      where: { sku: { equals: atual.sku, mode: 'insensitive' }, id: { not: id } },
      orderBy: [{ data: 'desc' }, { reg: 'desc' }],
      take: 40,
    });
    return rows
      .filter((r) => causaDe(r).id === causaId)
      .slice(0, 3)
      .map((r) => ({
        id: r.id,
        reg: r.reg,
        data: r.data,
        sku: r.sku,
        causa: causaDe(r).nome,
        solucao: r.solucao,
      }));
  }
}
