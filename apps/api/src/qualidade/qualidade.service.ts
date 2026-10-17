import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanoOrigem, PlanoStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ReclamacoesService } from '../reclamacoes/reclamacoes.service';
import { AuditoriaService } from '../auditoria.service';
import { AuthUser } from '../auth/auth.types';

export type VendaLinhaParsed = {
  sku: string;
  descricao: string;
  data: string;
  qtde: number;
};

@Injectable()
export class QualidadeService {
  constructor(
    private prisma: PrismaService,
    private reclamacoes: ReclamacoesService,
    private auditoria: AuditoriaService,
  ) {}

  private normSku(s: string) {
    return String(s || '')
      .trim()
      .toUpperCase();
  }

  /** DD/MM/YYYY or YYYY-MM-DD → YYYY-MM-DD */
  parseDataBr(raw: string): string | null {
    const t = String(raw || '').trim();
    if (!t) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (!m) return null;
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }

  parseVendasTexto(texto: string): { linhas: VendaLinhaParsed[]; erros: string[] } {
    const erros: string[] = [];
    const linhas: VendaLinhaParsed[] = [];
    const raw = String(texto || '').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { linhas, erros: ['Arquivo vazio'] };

    let start = 0;
    const header = lines[0].toLowerCase();
    if (header.includes('cod') && (header.includes('qtde') || header.includes('quant'))) {
      start = 1;
    }

    const agg = new Map<string, VendaLinhaParsed>();
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.includes(';')
          ? line.split(';')
          : line.split(',');
      if (parts.length < 4) {
        erros.push(`Linha ${i + 1}: colunas insuficientes`);
        continue;
      }
      const sku = this.normSku(parts[0]);
      const descricao = String(parts[1] || '').trim();
      const data = this.parseDataBr(parts[2]);
      const qtde = Number(String(parts[3] || '').replace(',', '.').trim());
      if (!sku) {
        erros.push(`Linha ${i + 1}: COD vazio`);
        continue;
      }
      if (!data) {
        erros.push(`Linha ${i + 1}: data inválida (${parts[2]})`);
        continue;
      }
      if (!Number.isFinite(qtde) || qtde < 0) {
        erros.push(`Linha ${i + 1}: QTDE inválida`);
        continue;
      }
      const key = `${sku}|${data}`;
      const prev = agg.get(key);
      if (prev) {
        prev.qtde += Math.round(qtde);
        if (descricao) prev.descricao = descricao;
      } else {
        agg.set(key, { sku, descricao, data, qtde: Math.round(qtde) });
      }
    }
    return { linhas: [...agg.values()], erros };
  }

  async importarVendas(texto: string, user: AuthUser) {
    const { linhas, erros } = this.parseVendasTexto(texto);
    if (!linhas.length) throw new BadRequestException(erros[0] || 'Nenhuma linha válida');

    let upserts = 0;
    const batch = 50;
    for (let i = 0; i < linhas.length; i += batch) {
      const slice = linhas.slice(i, i + batch);
      await this.prisma.$transaction(
        slice.map((l) =>
          this.prisma.vendaDia.upsert({
            where: { sku_data: { sku: l.sku, data: l.data } },
            create: {
              sku: l.sku,
              descricao: l.descricao,
              data: l.data,
              qtde: l.qtde,
            },
            update: {
              descricao: l.descricao || undefined,
              qtde: l.qtde,
            },
          }),
        ),
      );
      upserts += slice.length;
    }

    const datas = linhas.map((l) => l.data).sort();
    const skus = new Set(linhas.map((l) => l.sku));
    const totalQtde = linhas.reduce((a, l) => a + l.qtde, 0);

    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'importou_vendas',
      alvo: `${upserts} linhas`,
      detalhe: `${skus.size} SKUs · ${totalQtde} un · ${datas[0]} a ${datas[datas.length - 1]}`,
    });

    return {
      ok: true,
      linhas: upserts,
      skus: skus.size,
      totalQtde,
      de: datas[0],
      ate: datas[datas.length - 1],
      avisos: erros.slice(0, 30),
      avisosTotal: erros.length,
    };
  }

  async vendasResumo(query: { de?: string; ate?: string }) {
    const where: Prisma.VendaDiaWhereInput = {};
    if (query.de || query.ate) {
      where.data = {};
      if (query.de) where.data.gte = query.de;
      if (query.ate) where.data.lte = query.ate;
    }
    const rows = await this.prisma.vendaDia.findMany({ where });
    const skus = new Set(rows.map((r) => r.sku));
    const totalQtde = rows.reduce((a, r) => a + r.qtde, 0);
    const datas = rows.map((r) => r.data).sort();
    return {
      linhas: rows.length,
      skus: skus.size,
      totalQtde,
      de: datas[0] || null,
      ate: datas[datas.length - 1] || null,
    };
  }

  async limitePpm() {
    const row = await this.prisma.config.findUnique({ where: { chave: 'limiteDefeitoPpm' } });
    const n = Number(row?.valor || 1000);
    return Number.isFinite(n) && n > 0 ? n : 1000;
  }

  async coeficientes(query: Record<string, string | undefined>) {
    const limite = await this.limitePpm();
    const vendaWhere: Prisma.VendaDiaWhereInput = {};
    if (query.de || query.ate) {
      vendaWhere.data = {};
      if (query.de) vendaWhere.data.gte = query.de;
      if (query.ate) vendaWhere.data.lte = query.ate;
    }
    const vendas = await this.prisma.vendaDia.findMany({ where: vendaWhere });
    const vendasPorSku = new Map<string, { qtde: number; descricao: string }>();
    for (const v of vendas) {
      const g = vendasPorSku.get(v.sku) || { qtde: 0, descricao: v.descricao };
      g.qtde += v.qtde;
      if (v.descricao) g.descricao = v.descricao;
      vendasPorSku.set(v.sku, g);
    }

    const recs = await this.reclamacoes.list({
      de: query.de,
      ate: query.ate,
      setor: query.setor,
      resp: query.resp,
      sku: query.sku,
    });

    // Se ≥30% das reclamações têm procedência classificada, contar só PROCEDE; senão todas
    const comProc = recs.filter((r) => r.procedencia === 'PROCEDE' || r.procedencia === 'NÃO PROCEDE');
    const usarSoProcede = comProc.length >= Math.max(1, Math.floor(recs.length * 0.3));
    const recsContagem = usarSoProcede
      ? recs.filter((r) => r.procedencia === 'PROCEDE')
      : recs;

    type SkuAgg = {
      sku: string;
      produto: string;
      vendas: number;
      reclamacoes: number;
      setorFab: string;
      setorResp: string;
      taxa: number | null;
      ppm: number | null;
      semVenda: boolean;
      acimaLimite: boolean;
    };

    const bySku = new Map<string, SkuAgg>();

    for (const [sku, v] of vendasPorSku) {
      if (query.sku && this.normSku(query.sku) !== sku) continue;
      bySku.set(sku, {
        sku,
        produto: v.descricao,
        vendas: v.qtde,
        reclamacoes: 0,
        setorFab: '',
        setorResp: '',
        taxa: 0,
        ppm: 0,
        semVenda: false,
        acimaLimite: false,
      });
    }

    for (const r of recsContagem) {
      const sku = this.normSku(r.sku);
      if (!sku) continue;
      if (query.sku && this.normSku(query.sku) !== sku) continue;
      let g = bySku.get(sku);
      if (!g) {
        g = {
          sku,
          produto: String(r.produto || ''),
          vendas: 0,
          reclamacoes: 0,
          setorFab: String(r.setor || ''),
          setorResp: String(r.setorResp || ''),
          taxa: null,
          ppm: null,
          semVenda: true,
          acimaLimite: false,
        };
        bySku.set(sku, g);
      }
      g.reclamacoes++;
      if (!g.produto && r.produto) g.produto = String(r.produto);
      if (!g.setorFab && r.setor) g.setorFab = String(r.setor);
      if (!g.setorResp && r.setorResp) g.setorResp = String(r.setorResp);
    }

    // enriquecer setor a partir de produtos cadastrados / reclamações
    const produtos = await this.prisma.produto.findMany({
      where: { cod: { in: [...bySku.keys()] } },
      select: { cod: true, produto: true, setor: true },
    });
    const prodMap = new Map(produtos.map((p) => [this.normSku(p.cod), p]));

    for (const g of bySku.values()) {
      const p = prodMap.get(g.sku);
      if (p) {
        if (!g.produto) g.produto = p.produto;
        if (!g.setorFab && p.setor) g.setorFab = p.setor;
      }
      if (g.vendas > 0) {
        g.semVenda = false;
        g.taxa = (g.reclamacoes / g.vendas) * 100;
        g.ppm = (g.reclamacoes / g.vendas) * 1_000_000;
        g.acimaLimite = g.ppm > limite;
      } else {
        g.semVenda = true;
        g.taxa = null;
        g.ppm = null;
        g.acimaLimite = g.reclamacoes > 0;
      }
    }

    let lista = [...bySku.values()];
    if (query.setor) {
      lista = lista.filter((g) => g.setorFab === query.setor || (query.setor === '(vazio)' && !g.setorFab));
    }
    if (query.resp) {
      lista = lista.filter((g) => g.setorResp === query.resp);
    }

    lista.sort((a, b) => {
      const pa = a.ppm ?? -1;
      const pb = b.ppm ?? -1;
      if (a.semVenda !== b.semVenda) return a.semVenda ? 1 : -1;
      return pb - pa || b.reclamacoes - a.reclamacoes;
    });

    const groupSetor = (key: 'setorFab' | 'setorResp') => {
      const m = new Map<
        string,
        { k: string; vendas: number; reclamacoes: number; skus: number; ppm: number | null }
      >();
      for (const g of lista) {
        const k = g[key] || '(vazio)';
        const row = m.get(k) || { k, vendas: 0, reclamacoes: 0, skus: 0, ppm: null };
        row.vendas += g.vendas;
        row.reclamacoes += g.reclamacoes;
        row.skus++;
        m.set(k, row);
      }
      return [...m.values()]
        .map((r) => ({
          ...r,
          ppm: r.vendas > 0 ? (r.reclamacoes / r.vendas) * 1_000_000 : null,
          taxa: r.vendas > 0 ? (r.reclamacoes / r.vendas) * 100 : null,
          acimaLimite: r.vendas > 0 ? (r.reclamacoes / r.vendas) * 1_000_000 > limite : r.reclamacoes > 0,
        }))
        .sort((a, b) => (b.ppm ?? -1) - (a.ppm ?? -1) || b.reclamacoes - a.reclamacoes);
    };

    const totVendas = lista.reduce((a, g) => a + g.vendas, 0);
    const totRec = lista.reduce((a, g) => a + g.reclamacoes, 0);
    const ppmGeral = totVendas > 0 ? (totRec / totVendas) * 1_000_000 : null;
    const comVenda = lista.filter((g) => !g.semVenda);
    const acima = comVenda.filter((g) => g.acimaLimite).length;

    return {
      limitePpm: limite,
      modoContagem: usarSoProcede ? 'procedentes' : 'todas',
      totais: {
        skus: lista.length,
        vendas: totVendas,
        reclamacoes: totRec,
        ppm: ppmGeral,
        taxa: totVendas > 0 ? (totRec / totVendas) * 100 : null,
        acimaLimite: acima,
        pctAcimaLimite: comVenda.length ? Math.round((acima / comVenda.length) * 100) : null,
        semVenda: lista.filter((g) => g.semVenda && g.reclamacoes > 0).length,
      },
      porSku: lista,
      porSetorFab: groupSetor('setorFab'),
      porSetorResp: groupSetor('setorResp'),
    };
  }

  async painel(query: Record<string, string | undefined>) {
    const coef = await this.coeficientes(query);
    const planosAbertos = await this.prisma.planoAcao.count({
      where: { status: { in: [PlanoStatus.aberto, PlanoStatus.em_andamento] } },
    });
    const planos = await this.prisma.planoAcao.findMany({
      where: { status: { in: [PlanoStatus.aberto, PlanoStatus.em_andamento] } },
      orderBy: [{ prazo: 'asc' }, { criadoEm: 'desc' }],
      take: 15,
    });
    const vendasResumo = await this.vendasResumo({ de: query.de, ate: query.ate });
    return {
      ...coef,
      topDefeitos: coef.porSku.filter((g) => g.reclamacoes > 0).slice(0, 15),
      setoresCriticos: coef.porSetorFab.filter((g) => g.reclamacoes > 0).slice(0, 10),
      planosAbertos,
      planos,
      vendasResumo,
    };
  }

  exportCsv(coef: Awaited<ReturnType<QualidadeService['coeficientes']>>) {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'sku',
      'produto',
      'setor_fabricacao',
      'setor_responsavel',
      'vendas',
      'reclamacoes',
      'taxa_pct',
      'ppm',
      'acima_limite',
      'sem_venda',
    ];
    const lines = [
      header.join(';'),
      ...coef.porSku.map((g) =>
        [
          g.sku,
          g.produto,
          g.setorFab,
          g.setorResp,
          g.vendas,
          g.reclamacoes,
          g.taxa == null ? '' : g.taxa.toFixed(4),
          g.ppm == null ? '' : Math.round(g.ppm),
          g.acimaLimite ? 'SIM' : 'NAO',
          g.semVenda ? 'SIM' : 'NAO',
        ]
          .map(esc)
          .join(';'),
      ),
    ];
    return '\ufeff' + lines.join('\n');
  }

  listPlanos(query: Record<string, string | undefined>) {
    const where: Prisma.PlanoAcaoWhereInput = {};
    if (query.status) where.status = query.status as PlanoStatus;
    if (query.sku) where.sku = this.normSku(query.sku);
    if (query.setor) where.setorFab = query.setor;
    if (query.resp) where.setorResp = query.resp;
    return this.prisma.planoAcao.findMany({
      where,
      orderBy: [{ status: 'asc' }, { prazo: 'asc' }, { criadoEm: 'desc' }],
    });
  }

  async criarPlano(body: Record<string, unknown>, user: AuthUser) {
    const titulo = String(body.titulo || '').trim();
    if (!titulo) throw new BadRequestException('Título obrigatório');
    const origem = (['kpi', 'manual', 'recorrencia'].includes(String(body.origem))
      ? body.origem
      : 'manual') as PlanoOrigem;
    const created = await this.prisma.planoAcao.create({
      data: {
        titulo,
        descricao: String(body.descricao || ''),
        sku: this.normSku(String(body.sku || '')),
        causaId: String(body.causaId || ''),
        setorFab: String(body.setorFab || body.setor || ''),
        setorResp: String(body.setorResp || body.resp || ''),
        status: PlanoStatus.aberto,
        prioridade: String(body.prioridade || 'media'),
        responsavel: String(body.responsavel || ''),
        prazo: body.prazo ? String(body.prazo) : null,
        origem,
        meta: (body.meta as Prisma.InputJsonValue) || undefined,
        criadoPor: user.login,
        alteradoPor: user.login,
      },
    });
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'criou_plano',
      alvo: created.titulo,
      detalhe: created.sku || created.setorFab,
    });
    return created;
  }

  async atualizarPlano(id: string, body: Record<string, unknown>, user: AuthUser) {
    const atual = await this.prisma.planoAcao.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Plano não encontrado');
    const data: Prisma.PlanoAcaoUpdateInput = { alteradoPor: user.login };
    if (body.titulo !== undefined) data.titulo = String(body.titulo);
    if (body.descricao !== undefined) data.descricao = String(body.descricao);
    if (body.sku !== undefined) data.sku = this.normSku(String(body.sku));
    if (body.causaId !== undefined) data.causaId = String(body.causaId);
    if (body.setorFab !== undefined) data.setorFab = String(body.setorFab);
    if (body.setorResp !== undefined) data.setorResp = String(body.setorResp);
    if (body.prioridade !== undefined) data.prioridade = String(body.prioridade);
    if (body.responsavel !== undefined) data.responsavel = String(body.responsavel);
    if (body.prazo !== undefined) data.prazo = body.prazo ? String(body.prazo) : null;
    if (body.status !== undefined) {
      const st = String(body.status);
      if (!['aberto', 'em_andamento', 'concluido', 'cancelado'].includes(st)) {
        throw new BadRequestException('Status inválido');
      }
      data.status = st as PlanoStatus;
    }
    const updated = await this.prisma.planoAcao.update({ where: { id }, data });
    await this.auditoria.registrar({
      user: user.login,
      nome: user.nome,
      perfil: user.perfil,
      acao: 'atualizou_plano',
      alvo: updated.titulo,
      detalhe: updated.status,
    });
    return updated;
  }
}
