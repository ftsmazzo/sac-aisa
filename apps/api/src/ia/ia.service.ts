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

export type LlmProvider = {
  key: string;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  nome: string;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

@Injectable()
export class IaService {
  private readonly log = new Logger(IaService.name);

  constructor(private politica: PoliticaService) {}

  /** True se OpenRouter ou OpenAI estiver configurado. */
  hasLlm(): boolean {
    return !!this.resolveProvider();
  }

  resolveProvider(modelOverride?: string): LlmProvider | null {
    const openrouter = process.env.OPENROUTER_API_KEY?.trim();
    if (openrouter) {
      return {
        key: openrouter,
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        model: modelOverride || process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
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
        model: modelOverride || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        nome: 'OpenAI',
        headers: {
          Authorization: `Bearer ${openai}`,
          'Content-Type': 'application/json',
        },
      };
    }
    return null;
  }

  /**
   * Chat com tool-calling (OpenAI-compatible).
   * `executeTool` roda cada tool e devolve JSON serializável.
   * Para ao receber texto final ou após `maxRounds` rodadas de tools.
   */
  async chatWithTools(opts: {
    system: string;
    user: string;
    tools: ChatToolDef[];
    executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    /** Turnos user/assistant anteriores (sem system). */
    history?: { role: 'user' | 'assistant'; content: string }[];
    maxRounds?: number;
    temperature?: number;
    modelOverride?: string;
    timeoutMs?: number;
  }): Promise<string> {
    const provider = this.resolveProvider(opts.modelOverride);
    if (!provider) throw new Error('LLM não configurado');

    const maxRounds = opts.maxRounds ?? 5;
    const history = (opts.history || []).slice(-12);
    const messages: ChatMessage[] = [
      { role: 'system', content: opts.system },
      ...history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
      { role: 'user', content: opts.user },
    ];

    const deadline = Date.now() + (opts.timeoutMs ?? 35_000);
    let usedTools = false;
    let stallNudges = 0;

    for (let round = 0; round < maxRounds; round++) {
      if (Date.now() > deadline) throw new Error('Timeout do orquestrador');

      const body = {
        model: provider.model,
        temperature: opts.temperature ?? 0.3,
        messages,
        tools: opts.tools,
        tool_choice: 'auto' as const,
      };

      const res = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: provider.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(3_000, deadline - Date.now())),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${provider.nome} ${res.status}: ${errText.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: ToolCall[];
          };
          finish_reason?: string;
        }[];
      };
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error('Resposta LLM vazia');

      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) {
        const content = (msg.content || '').trim();
        // Modelo enrolou (“aguarde”, pediu período de novo) sem chamar tool → força execução
        if (!usedTools && stallNudges < 2 && this.looksLikeStall(content, opts.user)) {
          stallNudges++;
          messages.push({ role: 'assistant', content: content || null });
          messages.push({
            role: 'user',
            content:
              'Não peça confirmação, não diga “aguarde” e não reinicie a conversa. ' +
              'Use o histórico. Chame periodo_resolver + a tool de dados agora e responda com os números/lista.',
          });
          continue;
        }
        return content || 'Não consegui montar uma resposta agora.';
      }

      usedTools = true;
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await opts.executeTool(tc.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(result).slice(0, 12_000),
        });
      }
    }

    // Última chamada sem tools para forçar síntese
    const resFinal = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify({
        model: provider.model,
        temperature: opts.temperature ?? 0.3,
        tool_choice: 'none',
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              'Com os dados das tools acima, responda agora ao gestor em português, curto e factual. Sem novas tools.',
          },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(3_000, deadline - Date.now())),
    });
    if (!resFinal.ok) throw new Error(`${provider.nome} síntese ${resFinal.status}`);
    const jsonFinal = (await resFinal.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return (
      (jsonFinal.choices?.[0]?.message?.content || '').trim() ||
      'Consultei os dados, mas não consegui resumir. Pode repetir o pedido?'
    );
  }

  /** Texto que enrola em vez de consultar dados. */
  private looksLikeStall(content: string, userMsg: string): boolean {
    const c = content.toLowerCase();
    const u = userMsg.toLowerCase().trim();
    // Cumprimento puro pode responder sem tool
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|eai|e aí)[\s!.?]*$/i.test(u) && c.length < 220) {
      return false;
    }
    if (!c) return true;
    if (
      /aguarde|um momento|um instante|já verifico|vou verificar|vamos verificar|pode confirmar|qual período|intervalo em mente|como posso ajudar|em que posso ajudar|olá!|ola!/.test(
        c,
      )
    ) {
      return true;
    }
    // Pediu dado e a resposta só faz pergunta sem cifra
    if (
      /(reclam|kit|setor|kpi|alerta|causa|ppm|status|hoje|semana|ano|dias)/i.test(u) &&
      c.includes('?') &&
      !/\d/.test(c)
    ) {
      return true;
    }
    return false;
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
