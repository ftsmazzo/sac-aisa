import { Injectable, Logger } from '@nestjs/common';
import { PoliticaService } from '../evolucao/politica.service';
import {
  CAUSA_POR_ID,
  CAUSAS,
  classificar,
  classificarTodas,
  detectarPeca,
  causaDe,
  type ReclamacaoLike,
} from '../domain-bridge';

export interface ClassificacaoResult {
  causaId: string;
  causaNome: string;
  setor: string;
  acao: string;
  peca: string;
  confianca: number;
  fonte: 'legado' | 'llm' | 'manual';
  laudoSugerido?: string;
  solucaoRascunho?: string;
  explicacao?: string;
  /** Motivos adicionais detectados no texto (além da causa principal). */
  causasIds?: string[];
  acoes?: { causaId: string; nome: string; setor: string; acao: string }[];
}

type LlmProvider = {
  key: string;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  nome: string;
};

@Injectable()
export class IaService {
  private readonly log = new Logger(IaService.name);

  constructor(private politica: PoliticaService) {}

  private resolveProvider(): LlmProvider | null {
    const openrouter = process.env.OPENROUTER_API_KEY?.trim();
    if (openrouter) {
      return {
        key: openrouter,
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        model: process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
        nome: 'OpenRouter',
        headers: {
          Authorization: `Bearer ${openrouter}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.PUBLIC_API_URL || 'https://sac-aisa.local',
          'X-Title': 'SAC AISA',
        },
      };
    }
    const openai = process.env.OPENAI_API_KEY?.trim();
    if (openai) {
      return {
        key: openai,
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        nome: 'OpenAI',
        headers: {
          Authorization: `Bearer ${openai}`,
          'Content-Type': 'application/json',
        },
      };
    }
    return null;
  }

  classificarLegado(r: ReclamacaoLike): ClassificacaoResult {
    const ids =
      r.causaManual && r.causaId ? [String(r.causaId)] : classificarTodas(r, 5);
    const causaId = ids[0] || classificar(r);
    const causa = causaDe({ ...r, causaId, causaManual: !!r.causaManual });
    const peca = detectarPeca(r);
    const causasIds = [...new Set(ids.filter((id) => !!CAUSA_POR_ID[id]))].slice(0, 5);
    const acoes = causasIds.map((id) => {
      const c = causaDe({ ...r, causaId: id, causaManual: true });
      return { causaId: c.id, nome: c.nome, setor: c.setor, acao: c.acao };
    });
    return {
      causaId: causa.id,
      causaNome: causa.nome,
      setor: causa.setor,
      acao: causa.acao,
      peca,
      confianca: causa.id === 'outros' ? 0.35 : 0.78,
      fonte: 'legado',
      explicacao:
        causasIds.length > 1
          ? `Regras do SAC detectaram ${causasIds.length} motivos. Cada um traz a própria ação sugerida.`
          : 'Sugestão pelas regras do SAC (palavras-chave no laudo/reclamação/solução).',
      causasIds,
      acoes,
    };
  }

  async classificar(r: ReclamacaoLike): Promise<ClassificacaoResult> {
    if (r.causaManual && r.causaId && CAUSA_POR_ID[r.causaId]) {
      const c = CAUSA_POR_ID[r.causaId];
      return {
        causaId: c.id,
        causaNome: c.nome,
        setor: c.setor,
        acao: c.acao,
        peca: r.peca || detectarPeca(r),
        confianca: 1,
        fonte: 'manual',
        explicacao: 'Causa definida manualmente pelo operador.',
      };
    }

    const legado = this.classificarLegado(r);
    const provider = this.resolveProvider();
    if (!provider) return legado;
    const pol = await this.politica.get();

    try {
      const llm = await this.classificarLlm(r, provider);
      if (!llm || llm.confianca < pol.limiarDescartar) {
        return {
          ...legado,
          explicacao: `${legado.explicacao} ${provider.nome} abaixo do limiar; mantido regras do SAC.`,
        };
      }
      if (legado.causaId !== 'outros' && llm.causaId !== legado.causaId && llm.confianca < pol.limiarSobrepor) {
        return {
          ...legado,
          explicacao: `Regras sugeriram "${legado.causaNome}"; ${provider.nome} sugeriu "${llm.causaNome}" (${Math.round(llm.confianca * 100)}%). Mantido regras.`,
        };
      }
      const causasIds = [
        ...new Set([llm.causaId, ...(legado.causasIds || [])].filter((id) => !!CAUSA_POR_ID[id])),
      ].slice(0, 5);
      const acoes = causasIds.map((id) => {
        const c = causaDe({ ...r, causaId: id, causaManual: true });
        return { causaId: c.id, nome: c.nome, setor: c.setor, acao: c.acao };
      });
      return {
        ...llm,
        causasIds,
        acoes,
        explicacao: llm.explicacao || `Classificado via ${provider.nome} (${provider.model}).`,
      };
    } catch (e) {
      this.log.warn(`LLM falhou (${provider.nome}): ${e}`);
      return {
        ...legado,
        explicacao: `${legado.explicacao} ${provider.nome} indisponível; mantido regras do SAC.`,
      };
    }
  }

  private async classificarLlm(
    r: ReclamacaoLike,
    provider: LlmProvider,
  ): Promise<ClassificacaoResult | null> {
    const catalogo = CAUSAS.map(({ t: _t, ...c }) => c);
    const prompt = {
      model: provider.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Você classifica reclamações de pós-venda industrial. Responda JSON: {causaId, peca, confianca, laudoSugerido, solucaoRascunho, explicacao}. causaId deve ser um dos ids do catálogo. Não invente procedência financeira nem prometa estorno.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            catalogo,
            laudo: r.laudo,
            reclamacao: r.reclamacao,
            solucao: r.solucao,
            sku: r.sku,
            produto: r.produto,
          }),
        },
      ],
    };

    const res = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify(prompt),
    });
    if (!res.ok) throw new Error(`${provider.nome} ${res.status}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as {
      causaId?: string;
      peca?: string;
      confianca?: number;
      laudoSugerido?: string;
      solucaoRascunho?: string;
      explicacao?: string;
    };
    const causa = CAUSA_POR_ID[parsed.causaId || ''] || CAUSA_POR_ID.outros;
    return {
      causaId: causa.id,
      causaNome: causa.nome,
      setor: causa.setor,
      acao: causa.acao,
      peca: parsed.peca || detectarPeca(r),
      confianca: Math.max(0, Math.min(1, Number(parsed.confianca) || 0.5)),
      fonte: 'llm',
      laudoSugerido: parsed.laudoSugerido,
      solucaoRascunho: parsed.solucaoRascunho,
      explicacao: parsed.explicacao,
    };
  }

  async descreverFoto(base64: string, mime = 'image/jpeg'): Promise<string> {
    const provider = this.resolveProvider();
    if (!provider) return 'Descrição de foto indisponível (configure OPENROUTER_API_KEY ou OPENAI_API_KEY).';
    const res = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Descreva objetivamente evidências desta foto de reclamação (avaria, peça faltando, etiqueta). Não diga se procede.',
              },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider.nome} vision ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content || '';
  }
}
