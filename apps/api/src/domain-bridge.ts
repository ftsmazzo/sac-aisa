import {
  situacao,
  custoTotal,
  tempoDe,
  causaDe,
  setorResp,
  pecaDe,
  classificar,
  classificarTodas,
  detectarPeca,
  CAUSAS,
  CAUSA_POR_ID,
  SETORES_RESP,
  avaliarAlertasReclamacao,
  DEFAULT_ALERT_CONFIG,
  DEV_LABEL,
  devDe,
  comandoRetorno,
  politicaDe,
  sinalSeguranca,
  PONTO_DE_RETORNO,
  ESTADOS_WHATSAPP_CLASSICOS,
  PERMISSOES_CATALOGO,
  PERMISSOES_PADRAO,
  mesclarPermissoes,
  temPermissao,
  type AlertConfig,
  type CausaDef,
  type ReclamacaoLike,
  type PoliticaEvolucao,
  type PermissaoChave,
} from '@sac-aisa/domain';

export {
  situacao,
  custoTotal,
  tempoDe,
  causaDe,
  setorResp,
  pecaDe,
  classificar,
  classificarTodas,
  detectarPeca,
  CAUSAS,
  CAUSA_POR_ID,
  SETORES_RESP,
  avaliarAlertasReclamacao,
  DEFAULT_ALERT_CONFIG,
  DEV_LABEL,
  devDe,
  comandoRetorno,
  politicaDe,
  sinalSeguranca,
  PONTO_DE_RETORNO,
  ESTADOS_WHATSAPP_CLASSICOS,
  PERMISSOES_CATALOGO,
  PERMISSOES_PADRAO,
  mesclarPermissoes,
  temPermissao,
};

export type { AlertConfig, CausaDef, ReclamacaoLike, PoliticaEvolucao, PermissaoChave };

type ComCausasRel = ReclamacaoLike & {
  causas?: { causaId: string; primaria?: boolean; ordem?: number }[];
};

function resolverCausa(
  id: string,
  overrides: Record<string, Partial<CausaDef>>,
): CausaDef {
  const base = CAUSA_POR_ID[id] || CAUSA_POR_ID.outros;
  const o = overrides[base.id] || {};
  return { ...base, setor: o.setor || base.setor, acao: o.acao || base.acao };
}

export function enrichReclamacao<T extends ComCausasRel>(
  r: T,
  overrides: Record<string, Partial<CausaDef>> = {},
) {
  const causa = causaDe(r, overrides);
  const rel = [...(r.causas || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const ids =
    rel.length > 0
      ? rel.map((c) => c.causaId)
      : r.causaId
        ? [String(r.causaId)]
        : [causa.id];
  const causas = [...new Set(ids)].slice(0, 5).map((id) => resolverCausa(id, overrides));
  return {
    ...r,
    situacao: situacao(r),
    custoTotal: custoTotal(r),
    tempoDias: tempoDe(r),
    causa,
    causas,
    acoes: causas.map((c) => ({ causaId: c.id, nome: c.nome, setor: c.setor, acao: c.acao })),
    setorResp: setorResp(r, overrides),
    pecaDetectada: pecaDe(r),
  };
}
