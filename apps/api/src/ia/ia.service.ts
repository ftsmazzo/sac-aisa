import { Injectable, Logger } from '@nestjs/common';
import {
  CAUSA_POR_ID,
  CAUSAS,
  classificar,
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
}

@Injectable()
export class IaService {
  private readonly log = new Logger(IaService.name);

  classificarLegado(r: ReclamacaoLike): ClassificacaoResult {
    const causaId = r.causaManual && r.causaId ? r.causaId : classificar(r);
    const causa = causaDe({ ...r, causaId, causaManual: !!r.causaManual });
    const peca = detectarPeca(r);
    return {
      causaId: causa.id,
      causaNome: causa.nome,
      setor: causa.setor,
      acao: causa.acao,
      peca,
      confianca: causa.id === 'outros' ? 0.35 : 0.78,
      fonte: 'legado',
      explicacao: 'Classificador operacional legado (regras do SAC atual).',
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
    const key = process.env.OPENAI_API_KEY;
    if (!key) return legado;

    try {
      const llm = await this.classificarLlm(r);
      if (!llm || llm.confianca < 0.55) {
        return { ...legado, explicacao: `${legado.explicacao} LLM abaixo do limiar; mantido legado.` };
      }
      // se LLM discorda muito e legado não é outros, preferir legado com nota
      if (legado.causaId !== 'outros' && llm.causaId !== legado.causaId && llm.confianca < 0.8) {
        return {
          ...legado,
          explicacao: `Legado sugeriu ${legado.causaId}; LLM sugeriu ${llm.causaId} com confiança ${llm.confianca}.`,
        };
      }
      return llm;
    } catch (e) {
      this.log.warn(`LLM falhou: ${e}`);
      return legado;
    }
  }

  private async classificarLlm(r: ReclamacaoLike): Promise<ClassificacaoResult | null> {
    const catalogo = CAUSAS.map(({ t: _t, ...c }) => c);
    const prompt = {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prompt),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
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
    const key = process.env.OPENAI_API_KEY;
    if (!key) return 'Descrição de foto indisponível (OPENAI_API_KEY não configurada).';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
    if (!res.ok) throw new Error(`OpenAI vision ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content || '';
  }
}
