import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { U, clean, empresaDeCat, setorLabel } from '../domain-bridge';

export type ProdutoLookup = {
  encontrado: boolean;
  cod?: string;
  produto?: string;
  /** Ex.: SETOR 05 / SETOR 04.1 */
  setor?: string;
  setorRaw?: string;
  familia?: string;
  categoria?: string;
  empresa?: string;
};

type ProdutoIdx = {
  cod: string;
  produto: string;
  setor: string;
  familia: string;
  categoria: string;
};

export { setorLabel };

/** Resolve SKU contra índice (depara já aplicado no chamador). */
export function resolverSkuNoIndice(
  idx: Map<string, ProdutoIdx>,
  sku: string,
): ProdutoIdx | null {
  const toks = U(sku)
    .split(/[\/+,;\s]+/)
    .filter(Boolean);
  for (const t of toks) {
    if (idx.has(t)) return idx.get(t)!;
    const t2 = t.replace(/^\d+(?=[A-Z])/, '');
    if (idx.has(t2)) return idx.get(t2)!;
  }
  return null;
}

@Injectable()
export class ProdutoLookupService implements OnModuleInit {
  private readonly log = new Logger(ProdutoLookupService.name);
  private backfillRodou = false;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Preenche reclamações antigas sem setor fab. (ex.: digitadas após a migração).
    void this.backfillSetoresVazios()
      .then((r) => {
        if (r.atualizados > 0) {
          this.log.log(`Backfill setor fab.: ${r.atualizados} reclamação(ões) atualizada(s).`);
        }
      })
      .catch((e) => this.log.warn(`Backfill setor fab. falhou: ${e}`));
  }

  private async carregarIndice(): Promise<{
    idx: Map<string, ProdutoIdx>;
    depara: Map<string, string>;
  }> {
    const [produtos, deparas] = await Promise.all([
      this.prisma.produto.findMany({
        select: { cod: true, produto: true, setor: true, familia: true, categoria: true },
      }),
      this.prisma.skuDepara.findMany({ select: { skuOrigem: true, skuDestino: true } }),
    ]);
    const idx = new Map<string, ProdutoIdx>();
    for (const p of produtos) {
      idx.set(U(p.cod), {
        cod: p.cod,
        produto: p.produto,
        setor: p.setor || '',
        familia: p.familia || '',
        categoria: p.categoria || '',
      });
    }
    const depara = new Map<string, string>();
    for (const d of deparas) {
      depara.set(U(d.skuOrigem), d.skuDestino);
    }
    return { idx, depara };
  }

  async lookup(skuRaw: string): Promise<ProdutoLookup> {
    const sku = U(skuRaw);
    if (!sku) return { encontrado: false };

    const { idx, depara } = await this.carregarIndice();
    const viaDepara = depara.get(sku);
    let p: ProdutoIdx | null = null;
    if (viaDepara && idx.has(U(viaDepara))) {
      p = idx.get(U(viaDepara))!;
    } else {
      p = resolverSkuNoIndice(idx, sku);
    }
    if (!p) return { encontrado: false };

    const setor = setorLabel(p.setor);
    return {
      encontrado: true,
      cod: p.cod,
      produto: p.produto,
      setor,
      setorRaw: p.setor,
      familia: U(p.familia) || p.familia || '',
      categoria: p.categoria,
      empresa: empresaDeCat(p.categoria),
    };
  }

  /**
   * Completa setor/produto/família/empresa a partir do cadastro de produtos.
   * Não sobrescreve campos já preenchidos (exceto setor se `forceSetor`).
   */
  async completarCampos<T extends Record<string, unknown>>(
    data: T,
    opts: { forceSetor?: boolean } = {},
  ): Promise<T> {
    const sku = String(data.sku ?? '');
    if (!sku.trim()) return data;
    const hit = await this.lookup(sku);
    if (!hit.encontrado) return data;

    const out: Record<string, unknown> = { ...data };
    const vazio = (k: string) => !clean(out[k]);

    if (opts.forceSetor || vazio('setor')) {
      if (hit.setor) out.setor = hit.setor;
    }
    if (vazio('produto') && hit.produto) out.produto = hit.produto;
    if (vazio('familia') && hit.familia) out.familia = hit.familia;
    if (vazio('empresa') && hit.empresa) out.empresa = hit.empresa;
    return out as T;
  }

  async backfillSetoresVazios(): Promise<{ atualizados: number; analisados: number }> {
    if (this.backfillRodou) return { atualizados: 0, analisados: 0 };
    this.backfillRodou = true;

    const vazias = await this.prisma.reclamacao.findMany({
      where: { setor: '', NOT: { sku: '' } },
      select: { id: true, sku: true, produto: true, familia: true, empresa: true },
      take: 5000,
    });
    if (!vazias.length) return { atualizados: 0, analisados: 0 };

    const { idx, depara } = await this.carregarIndice();
    let atualizados = 0;
    for (const r of vazias) {
      const sku = U(r.sku);
      const via = depara.get(sku);
      const p =
        (via && idx.get(U(via))) || resolverSkuNoIndice(idx, sku) || null;
      if (!p) continue;
      const setor = setorLabel(p.setor);
      if (!setor) continue;
      await this.prisma.reclamacao.update({
        where: { id: r.id },
        data: {
          setor,
          ...(clean(r.produto) ? {} : { produto: p.produto }),
          ...(clean(r.familia) ? {} : { familia: U(p.familia) || p.familia || '' }),
          ...(clean(r.empresa)
            ? {}
            : { empresa: empresaDeCat(p.categoria) || r.empresa || '' }),
        },
      });
      atualizados++;
    }
    return { atualizados, analisados: vazias.length };
  }
}
