const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(root, 'data/sac_backup_ultimo.json'), 'utf8'));
const seedTxt = fs.readFileSync(path.join(root, 'packages/domain/src/seed-produtos.txt'), 'utf8');

const CATS = {
  P: 'PRODUTO AISA',
  R: 'PRODUTO ARAUCA',
  T: 'PRODUTO ARTMAQ',
  C: 'COMPONENTE',
  X: 'PRODUTO INATIVO',
};

function esc(s) {
  if (s === null || s === undefined || s === '') {
    if (s === '') return "''";
    return 'NULL';
  }
  return "'" + String(s).replace(/'/g, "''").replace(/\u0000/g, '') + "'";
}

function escNum(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? String(x) : '0';
}

function bool(v) {
  return v ? 'true' : 'false';
}

function escTs(s) {
  if (s === null || s === undefined || s === '') return 'CURRENT_TIMESTAMP';
  const t = String(s).replace(/Z$/i, '').replace('T', ' ');
  return `'${t.replace(/'/g, "''")}'::timestamp`;
}

function situacao(r) {
  if (r.dataAcao) return 'resolvida';
  return r.devolucao === 'AGUARDANDO' ? 'aguardando' : 'tratativa';
}

function devolucao(d) {
  if (d === 'AGUARDANDO' || d === 'RECEBIDO') return d;
  return 'NA';
}

const lines = [];
const now = 'CURRENT_TIMESTAMP';

lines.push('-- Seed completo: produtos (HTML), causas, config, usuarios, reclamacoes, auditoria (JSON)');
lines.push('-- Gerado por scripts/generate-seed-migration.js');
lines.push('');

const causas = [
  ['prazo', 'Prazo e entrega', 'Prazo de produção / entrega', 'PCP', 'Comparar o prazo prometido no anúncio com a capacidade real de produção e avisar o cliente antes de vencer.', 0],
  ['entrega', 'Prazo e entrega', 'Extravio / entrega não realizada', 'Logística', 'Abrir ocorrência na transportadora, reenviar ou estornar rápido e avaliar troca de transportadora nas rotas com recorrência.', 1],
  ['anuncio', 'Venda e cadastro', 'Anúncio / cadastro divergente', 'Comercial / Anúncios', 'Conferir título, fotos, variação e SKU do anúncio antes de publicar ou alterar.', 2],
  ['lancamento', 'Venda e cadastro', 'Erro de lançamento do pedido', 'Comercial / Pedidos', 'Dupla checagem de código × descrição na digitação do pedido.', 3],
  ['arrepend', 'Venda e cadastro', 'Cliente desistiu / produto não atendeu', 'Comercial / Anúncios', 'Oferecer orientação ou troca antes do estorno e revisar o que o anúncio promete.', 4],
  ['pecas', 'Venda e cadastro', 'Compra de peça / assistência (não é falha)', 'SAC / Pós-venda', 'Tratar como venda de peça de reposição, fora do indicador de reclamações.', 5],
  ['manipulo', 'Produto', 'Manípulo quebrado (máquinas de corte e vinco)', 'Qualidade / Engenharia', 'Avaliar reforço do manípulo ou da embalagem e acompanhar a recorrência por modelo.', 6],
  ['voltagem', 'Envio errado', 'Voltagem errada', 'Montagem', 'Conferir a voltagem na montagem e na expedição, com checklist e foto da etiqueta.', 7],
  ['cubas', 'Envio errado', 'Cubas trocadas (inox × acrílico)', 'Montagem', 'Conferir o material das cubas contra o pedido antes de fechar a condimentadora.', 8],
  ['erro_envio', 'Envio errado', 'Produto, modelo ou tamanho trocado', 'Embalagem / Expedição', 'Conferência por código na separação e na embalagem antes de fechar a caixa.', 9],
  ['kit', 'Item faltando', 'Kit de montagem faltando (parafusos, mãos francesas, pés)', 'Embalagem / Expedição', 'Padronizar o kit de montagem por produto e conferir por checklist na embalagem.', 10],
  ['unidade', 'Item faltando', 'Unidade ou produto faltando no pedido', 'Embalagem / Expedição', 'Conferir quantidade de volumes e de unidades contra o pedido antes do despacho.', 11],
  ['item', 'Item faltando', 'Acessório ou peça faltando (manivela, cubas, tampas...)', 'Embalagem / Expedição', 'Checklist de acessórios por produto na embalagem.', 12],
  ['ferrugem', 'Fabricação', 'Ferrugem / oxidação', 'Pintura / Acabamento', 'Revisar tratamento, secagem e proteção contra umidade na embalagem.', 13],
  ['solda', 'Fabricação', 'Solda soltando ou sem solda', 'Solda', 'Inspeção de solda no controle final e reforço dos pontos dos paneleiros e suportes.', 14],
  ['cuba_furada', 'Fabricação', 'Cuba da manteigueira furada', 'Solda', 'Verificar chapa e solda da cuba e testar estanqueidade antes de embalar.', 15],
  ['pintura', 'Fabricação', 'Pintura / acabamento (riscado, arranhado)', 'Pintura / Acabamento', 'Inspeção visual final de pintura e acabamento.', 16],
  ['avaria', 'Transporte', 'Avaria no transporte / embalagem', 'Logística', 'Abrir sinistro na transportadora e reforçar proteção nos produtos mais avariados.', 17],
  ['eletrico', 'Produto', 'Falha elétrica / componente', 'Qualidade / Engenharia', 'Teste elétrico final antes de embalar e avaliar o fornecedor do componente mais recorrente.', 18],
  ['furacao', 'Fabricação', 'Furação / encaixe / dimensão', 'Corte e Dobra', 'Conferir furação, dobra e encaixe com gabarito.', 19],
  ['defeito', 'Produto', 'Defeito de produto (outros)', 'Qualidade / Engenharia', 'Analisar caso a caso e registrar a causa raiz dos que se repetem.', 20],
  ['outros', 'Outros', 'Outros / a classificar', 'SAC / Pós-venda', 'Classificar manualmente.', 21],
];

lines.push('INSERT INTO causas (id, cat, nome, setor, acao, ordem) VALUES');
lines.push(
  causas
    .map((c) => `(${[c[0], c[1], c[2], c[3], c[4]].map(esc).join(',')},${c[5]})`)
    .join(',\n') + ';',
);
lines.push('');

const configs = [
  ['metaDias', '2'],
  ['ALERT_AGUARDANDO_DIAS', '7'],
  ['ALERT_CUSTO_ALTO', '500'],
  ['ALERT_OUTROS_DIAS', '3'],
  ['ALERT_RASCUNHO_WHATSAPP_HORAS', '24'],
];
lines.push('INSERT INTO config (chave, valor) VALUES');
lines.push(configs.map(([k, v]) => `(${esc(k)},${esc(v)})`).join(',\n') + ';');
lines.push('');

const produtosRaw = seedTxt
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [cod, setor, produto, st, cat, fam] = l.split('|');
    return {
      cod: cod.trim(),
      setor: (setor || '').trim(),
      produto: (produto || '').trim(),
      status: st === 'I' ? 'INATIVO' : 'ATIVO',
      categoria: CATS[cat] || '',
      familia: (fam || '').trim(),
    };
  });
const produtos = [];
const seenCod = new Set();
for (const p of produtosRaw) {
  const key = p.cod.toUpperCase();
  if (seenCod.has(key)) continue;
  seenCod.add(key);
  produtos.push(p);
}

lines.push(`-- produtos do HTML SEED: ${produtos.length}`);
for (let i = 0; i < produtos.length; i += 50) {
  const chunk = produtos.slice(i, i + 50);
  lines.push(
    'INSERT INTO produtos (id, cod, produto, setor, status, categoria, familia, "criadoEm", "alteradoEm") VALUES',
  );
  lines.push(
    chunk
      .map((p) => {
        const id = 'prod_' + p.cod.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return `(${[id, p.cod, p.produto, p.setor].map(esc).join(',')},'${p.status}',${[p.categoria, p.familia].map(esc).join(',')},${now},${now})`;
      })
      .join(',\n') + ';',
  );
  lines.push('');
}

const users = j.usuarios || [];
lines.push(`-- usuarios: ${users.length}`);
if (users.length) {
  lines.push(
    'INSERT INTO usuarios (id, login, nome, perfil, salt, hash, ativo, telefone, "criadoEm", "criadoPor", "alteradoEm") VALUES',
  );
  lines.push(
    users
      .map((u) => {
        const id = 'user_' + String(u.login).toLowerCase().replace(/[^a-z0-9]/g, '_');
        const criado = u.criadoEm ? escTs(u.criadoEm) : now;
        return `(${[id, String(u.login).toLowerCase(), u.nome, u.perfil, u.salt, u.hash].map(esc).join(',')},${bool(u.ativo !== false)},NULL,${criado},${esc(u.criadoPor || 'seed')},${now})`;
      })
      .join(',\n') + ';',
  );
  lines.push('');
}

const regs = j.regs || [];
lines.push(`-- reclamacoes: ${regs.length}`);
for (let i = 0; i < regs.length; i += 25) {
  const chunk = regs.slice(i, i + 25);
  lines.push(
    'INSERT INTO reclamacoes (id, reg, data, empresa, setor, sku, produto, familia, garantia, canal, protocolo, cliente, cidade, uf, reclamacao, laudo, procedencia, solucao, "dataAcao", obs, transp, "freteEnvio", "freteRetorno", "valorPeca", estorno, desconto, guia, devolucao, "dataRecebimento", "causaId", "causaManual", "obsCausa", "setorRespManual", peca, situacao, origem, "whatsappTelefone", rascunho, "criadoEm", "criadoPor", "alteradoEm", "alteradoPor") VALUES',
  );
  lines.push(
    chunk
      .map((r) => {
        const id = String(r.id || 'reg_' + r.reg);
        const vals = [
          esc(id),
          String(Number(r.reg) || 0),
          esc(r.data || null),
          esc(r.empresa || ''),
          esc(r.setor || ''),
          esc(r.sku || ''),
          esc(r.produto || ''),
          esc(r.familia || ''),
          esc(r.garantia || ''),
          esc(r.canal || ''),
          esc(r.protocolo || ''),
          esc(r.cliente || ''),
          esc(r.cidade || ''),
          esc(r.uf || ''),
          esc(r.reclamacao || ''),
          esc(r.laudo || ''),
          esc(r.procedencia || ''),
          esc(r.solucao || ''),
          esc(r.dataAcao || null),
          esc(r.obs || ''),
          esc(r.transp || ''),
          escNum(r.freteEnvio),
          escNum(r.freteRetorno),
          escNum(r.valorPeca),
          escNum(r.estorno),
          escNum(r.desconto),
          escNum(r.guia),
          `'${devolucao(r.devolucao)}'`,
          esc(r.dataRecebimento || null),
          esc(r.causaId || ''),
          bool(!!r.causaManual),
          esc(r.obsCausa || ''),
          esc(r.setorRespManual || ''),
          esc(r.peca || ''),
          `'${situacao(r)}'`,
          esc('import'),
          'NULL',
          'false',
          r.criadoEm ? escTs(r.criadoEm) : now,
          esc(r.criadoPor || 'seed'),
          r.alteradoEm ? escTs(r.alteradoEm) : now,
          esc(r.alteradoPor || 'seed'),
        ];
        return `(${vals.join(',')})`;
      })
      .join(',\n') + ';',
  );
  lines.push('');
}

const aud = j.auditoria || [];
lines.push(`-- auditoria: ${aud.length}`);
for (let i = 0; i < aud.length; i += 50) {
  const chunk = aud.slice(i, i + 50);
  lines.push(
    'INSERT INTO auditoria (id, ts, "user", nome, perfil, acao, alvo, detalhe, "recId", extra) VALUES',
  );
  lines.push(
    chunk
      .map((a, idx) => {
        const id = String(a.id || `aud_${i + idx}`);
        return `(${[
          esc(id),
          a.ts ? escTs(a.ts) : now,
          esc(a.user || ''),
          esc(a.nome || ''),
          esc(a.perfil || ''),
          esc(a.acao || ''),
          esc(a.alvo || ''),
          esc(a.detalhe || ''),
          a.recId ? esc(a.recId) : 'NULL',
          'NULL',
        ].join(',')})`;
      })
      .join(',\n') + ';',
  );
  lines.push('');
}

if (j.regras && Object.keys(j.regras).length) {
  const entries = Object.entries(j.regras);
  lines.push('INSERT INTO regras_direcionamento (id, "causaId", setor, acao) VALUES');
  lines.push(
    entries
      .map(([id, r]) => `(${esc('regra_' + id)},${esc(id)},${esc(r.setor || null)},${esc(r.acao || null)})`)
      .join(',\n') + ';',
  );
  lines.push('');
}

if (j.depara && Object.keys(j.depara).length) {
  const entries = Object.entries(j.depara);
  lines.push('INSERT INTO sku_depara (id, "skuOrigem", "skuDestino", "criadoEm") VALUES');
  lines.push(
    entries
      .map(
        ([o, d]) =>
          `(${esc('dp_' + o)},${esc(String(o).toUpperCase())},${esc(String(d).toUpperCase())},${now})`,
      )
      .join(',\n') + ';',
  );
  lines.push('');
}

const outDir = path.join(root, 'apps/api/prisma/migrations/20261017000000_seed_dados_iniciais');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'migration.sql');
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');

console.log('OK', outFile);
console.log({
  produtos: produtos.length,
  regs: regs.length,
  users: users.length,
  auditoria: aud.length,
  bytes: fs.statSync(outFile).size,
});
