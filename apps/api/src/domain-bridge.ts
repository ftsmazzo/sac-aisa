import {
  situacao,
  custoTotal,
  tempoDe,
  causaDe,
  setorResp,
  pecaDe,
  classificar,
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
  type AlertConfig,
  type CausaDef,
  type ReclamacaoLike,
  type PoliticaEvolucao,
} from '@sac-aisa/domain';

export {
  situacao,
  custoTotal,
  tempoDe,
  causaDe,
  setorResp,
  pecaDe,
  classificar,
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
};

export type { AlertConfig, CausaDef, ReclamacaoLike, PoliticaEvolucao };

export function enrichReclamacao<T extends ReclamacaoLike>(
  r: T,
  overrides: Record<string, Partial<CausaDef>> = {},
) {
  const causa = causaDe(r, overrides);
  return {
    ...r,
    situacao: situacao(r),
    custoTotal: custoTotal(r),
    tempoDias: tempoDe(r),
    causa,
    setorResp: setorResp(r, overrides),
    pecaDetectada: pecaDe(r),
  };
}
