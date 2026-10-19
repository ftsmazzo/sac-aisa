import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  situacao,
  custoTotal,
  tempoDe,
  classificar,
  detectarPeca,
  avaliarAlertasReclamacao,
  comandoRetorno,
  evolucaoAtivaDe,
  politicaDe,
  sinalSeguranca,
} from './index';

test('situacao: resolvida quando há dataAcao', () => {
  assert.equal(situacao({ dataAcao: '2026-01-10', devolucao: 'AGUARDANDO' }), 'resolvida');
});

test('situacao: aguardando quando produto não voltou', () => {
  assert.equal(situacao({ devolucao: 'AGUARDANDO' }), 'aguardando');
});

test('situacao: tratativa sem devolução ou recebido', () => {
  assert.equal(situacao({ devolucao: 'NA' }), 'tratativa');
  assert.equal(situacao({ devolucao: 'RECEBIDO' }), 'tratativa');
  assert.equal(situacao({}), 'tratativa');
});

test('custoTotal soma componentes', () => {
  assert.equal(
    custoTotal({
      freteEnvio: 10,
      freteRetorno: 5,
      valorPeca: 20,
      estorno: 0,
      desconto: 3,
      guia: 2,
    }),
    40,
  );
});

test('tempoDe calcula dias', () => {
  assert.equal(tempoDe({ data: '2026-01-01', dataAcao: '2026-01-04' }), 3);
});

test('classificar detecta peça faltando', () => {
  assert.equal(
    classificar({
      laudo: 'FALTANDO PEÇAS/ACESSÓRIOS',
      reclamacao: 'FALTOU OS PARAFUSOS',
    }),
    'kit',
  );
});

test('detectarPeca encontra parafusos', () => {
  assert.equal(detectarPeca({ reclamacao: 'faltou kit de parafuso' }), 'Kit de parafusos');
});

test('alerta aguardando dias', () => {
  const tipos = avaliarAlertasReclamacao(
    { data: '2026-01-01', devolucao: 'AGUARDANDO' },
    { aguardandoDias: 7, metaDias: 2, custoAlto: 500, outrosDias: 3, rascunhoWhatsappHoras: 24 },
    '2026-01-15',
  );
  assert.ok(tipos.includes('AGUARDANDO_DIAS'));
});

test('comando de retorno reconhece voltar e ignora texto livre', () => {
  assert.equal(comandoRetorno(' VOLTAR '), true);
  assert.equal(comandoRetorno('recomeçar'), true);
  assert.equal(comandoRetorno('quero voltar o produto'), false);
});

test('evolução desligada reproduz a política clássica', () => {
  const p = politicaDe({});
  assert.equal(p.ativa, false);
  assert.equal(p.limiarDescartar, 0.55);
  assert.equal(p.limiarSobrepor, 0.8);
  assert.equal(p.guardarDivergencia, false);
  assert.equal(evolucaoAtivaDe('0'), false);
  assert.equal(evolucaoAtivaDe('1'), true);
});

test('sinal de segurança usa só causas do catálogo', () => {
  assert.equal(sinalSeguranca('voltagem'), true);
  assert.equal(sinalSeguranca('prazo'), false);
});
