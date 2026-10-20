/** Helpers de impressão (ficha individual + relatório por setor). */

export type PrintCausa = { id: string; nome: string; setor: string; acao: string };

export type PrintRec = {
  id: string;
  reg: number;
  data?: string | null;
  empresa?: string | null;
  setor?: string | null;
  sku?: string | null;
  produto?: string | null;
  reclamacao?: string | null;
  cliente?: string | null;
  cidade?: string | null;
  uf?: string | null;
  canal?: string | null;
  protocolo?: string | null;
  procedencia?: string | null;
  devolucao?: string | null;
  situacao?: string | null;
  dataAcao?: string | null;
  dataRecebimento?: string | null;
  laudo?: string | null;
  solucao?: string | null;
  obs?: string | null;
  obsCausa?: string | null;
  peca?: string | null;
  custoTotal?: number | null;
  setorResp?: string | null;
  causa?: PrintCausa | null;
  causas?: PrintCausa[] | null;
};

export type PrintOpts = {
  cliente?: boolean;
  custos?: boolean;
  agrupar?: boolean;
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtData = (d?: string | null) => {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

const fmtBRL = (n: number) =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const sitLabel = (s?: string | null) =>
  ({ resolvida: 'RESOLVIDA', aguardando: 'AGUARDANDO PRODUTO', tratativa: 'EM TRATATIVA' } as Record<
    string,
    string
  >)[s || ''] || 'EM TRATATIVA';

function causasDe(r: PrintRec): PrintCausa[] {
  if (r.causas?.length) return r.causas;
  if (r.causa) return [r.causa];
  return [];
}

function campo(rot: string, val: unknown, cls = '') {
  const v = String(val ?? '').trim();
  if (!v) return '';
  return `<div class="cp ${cls}"><small>${esc(rot)}</small><span>${esc(v)}</span></div>`;
}

function rotuloProd(r: PrintRec) {
  return [r.sku, r.produto].filter(Boolean).join(' — ') || '—';
}

export function fichaHTML(r: PrintRec, o: PrintOpts = {}) {
  const cs = causasDe(r);
  const d = r.devolucao || 'NA';
  const banner =
    d === 'AGUARDANDO' && !r.dataAcao
      ? '<div class="dev-b aguard">Produto ainda não chegou — iniciar a tratativa somente após a entrega</div>'
      : d === 'RECEBIDO'
        ? `<div class="dev-b ok">Produto recebido${r.dataRecebimento ? ' em ' + fmtData(r.dataRecebimento) : ''}${r.dataAcao ? '' : ' — tratativa liberada'}</div>`
        : '';
  const cli = [r.cliente, [r.cidade, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
  const causasTxt = cs.map((c) => c.nome).join(' · ') || '—';
  const acoesTxt = cs.map((c) => `• ${c.nome}: ${c.acao}`).join('\n');
  const setoresTxt = [...new Set(cs.map((c) => c.setor).filter(Boolean))].join(' · ') || r.setorResp || '';

  return `<div class="ficha">
    <div class="f-h"><b>Reclamação #${r.reg ?? ''}</b><span>${fmtData(r.data)}</span><span class="sit">${sitLabel(r.situacao)}</span></div>${banner}
    <div class="f-g">
      ${campo('Produto', rotuloProd(r), 'full')}
      ${campo('Setor · Empresa', [r.setor, r.empresa].filter(Boolean).join(' · '))}
      ${campo('Setor responsável', setoresTxt || r.setorResp)}
      ${campo('Causa(s) do problema', causasTxt + (r.peca ? ' · ' + r.peca : ''), 'full')}
      ${campo('Observação sobre a causa', r.obsCausa, 'full')}
      ${campo('Reclamação', r.reclamacao, 'full')}
      ${campo('Laudo · Procedência', [r.laudo, r.procedencia].filter(Boolean).join(' · '))}
      ${campo('Canal · Protocolo', [r.canal, r.protocolo].filter(Boolean).join(' · '))}
      ${campo('Pedido / observação', r.obs, 'full')}
      ${campo('Solução / tratativa', (r.solucao || '') + (r.dataAcao ? ` (${fmtData(r.dataAcao)})` : ''), 'full')}
      ${campo('Ação(ões) sugerida(s) ao setor', acoesTxt, 'full')}
      ${o.cliente ? campo('Cliente', cli, 'full') : ''}
      ${o.custos && r.custoTotal ? campo('Custo total', fmtBRL(Number(r.custoTotal))) : ''}
    </div>
    <div class="f-r"><b>Retorno do setor</b><div class="ln"></div><div class="ln"></div><div class="as">Responsável: ______________________________ &nbsp;&nbsp; Data: ____/____/________</div></div>
  </div>`;
}

function cabecalho(titulo: string, sub: string) {
  return `<div class="sec-h"><div class="logo">AISA</div><div><h2>${titulo}</h2><small>${sub}</small></div></div>`;
}

export function montarFichas(lista: PrintRec[], o: PrintOpts = {}, quem = '') {
  const quando = new Date().toLocaleString('pt-BR');
  const grupos = new Map<string, PrintRec[]>();
  for (const r of lista) {
    const k = o.agrupar ? r.setorResp || r.setor || '(sem setor)' : 'Reclamações';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  const ord = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  const linhas = ord
    .map(([nome, items], i) => {
      const cab = cabecalho(
        o.agrupar ? `Setor responsável: ${esc(nome)}` : esc(nome),
        `${items.length} reclamação(ões) · impresso em ${quando}${quem ? ' por ' + esc(quem) : ''}`,
      );
      return (
        `<tr class="${i ? 'novo-setor' : ''}"><td>${cab}</td></tr>` +
        items.map((r) => `<tr><td>${fichaHTML(r, o)}</td></tr>`).join('')
      );
    })
    .join('');
  return `<table class="prt"><thead><tr><td class="sp"></td></tr></thead><tfoot><tr><td class="sp"></td></tr></tfoot><tbody>${linhas}</tbody></table>`;
}

export function montarRelSetor(lista: PrintRec[], o: PrintOpts = {}, quem = '') {
  const quando = new Date().toLocaleString('pt-BR');
  const cnt = (arr: PrintRec[], st: string) => arr.filter((r) => r.situacao === st).length;
  const grupos = new Map<string, PrintRec[]>();
  for (const r of lista) {
    const k = r.setor || '(sem setor)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  const ord = [...grupos.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'),
  );
  const kp = (n: number, t: string) => `<div><b>${n}</b><small>${t}</small></div>`;
  const capa =
    cabecalho(
      'Reclamações — resumo por setor',
      `Filtro atual · impresso em ${quando}${quem ? ' por ' + esc(quem) : ''}`,
    ) +
    `<div class="rs-kpis">${kp(lista.length, 'Reclamações')}${kp(cnt(lista, 'tratativa'), 'Em tratativa')}${kp(cnt(lista, 'aguardando'), 'Aguardando produto')}${kp(cnt(lista, 'resolvida'), 'Resolvidas')}</div>` +
    `<table class="resumo"><thead><tr><th>Setor</th><th class="num">Total</th><th class="num">Em tratativa</th><th class="num">Aguardando</th><th class="num">Resolvidas</th>${o.custos ? '<th class="num">Custo</th>' : ''}</tr></thead><tbody>` +
    ord
      .map(([nome, items]) => {
        const custo = items.reduce((a, r) => a + Number(r.custoTotal || 0), 0);
        return `<tr><td><b>${esc(nome)}</b></td><td class="num">${items.length}</td><td class="num">${cnt(items, 'tratativa')}</td><td class="num">${cnt(items, 'aguardando')}</td><td class="num">${cnt(items, 'resolvida')}</td>${o.custos ? `<td class="num">${fmtBRL(custo)}</td>` : ''}</tr>`;
      })
      .join('') +
    `</tbody></table>`;

  const ORDEM: Record<string, number> = { tratativa: 0, aguardando: 1, resolvida: 2 };
  const setorHTML = (nome: string, items: PrintRec[]) => {
    const linhas = [...items].sort(
      (a, b) =>
        (ORDEM[a.situacao || ''] ?? 9) - (ORDEM[b.situacao || ''] ?? 9) || (a.reg || 0) - (b.reg || 0),
    );
    const ncol = 5 + (o.custos ? 1 : 0);
    const tab =
      `<table class="resumo rs"><thead><tr><th class="rs-t" colspan="${ncol}">Setor: ${esc(nome)}</th></tr><tr><th>Nº / Data</th><th>Produto</th><th>Reclamação · causa</th><th>Situação</th>${o.custos ? '<th>Custo</th>' : ''}<th class="ret">Tratativa</th></tr></thead><tbody>` +
      linhas
        .map((r) => {
          const cs = causasDe(r)
            .map((c) => c.nome)
            .join(' · ');
          const cli = [r.cliente, [r.cidade, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
          return `<tr><td>#${r.reg}<br>${fmtData(r.data)}</td><td>${esc(rotuloProd(r))}${o.cliente && cli ? `<br><small>${esc(cli)}</small>` : ''}</td><td>${esc((r.reclamacao || '').slice(0, 220))}<br><small>Causa: ${esc(cs || '—')}</small></td><td>${sitLabel(r.situacao)}</td>${o.custos ? `<td>${r.custoTotal ? fmtBRL(Number(r.custoTotal)) : '—'}</td>` : ''}<td class="ret"></td></tr>`;
        })
        .join('') +
      '</tbody></table>';
    return `<tr class="novo-setor"><td>${cabecalho('Setor: ' + esc(nome), `${items.length} reclamação(ões)`)}${tab}</td></tr>`;
  };

  const corpo =
    `<tr><td>${capa}</td></tr>` + ord.map(([nome, items]) => setorHTML(nome, items)).join('');
  return `<table class="prt"><thead><tr><td class="sp"></td></tr></thead><tfoot><tr><td class="sp"></td></tr></tfoot><tbody>${corpo}</tbody></table>`;
}

export function imprimirHtml(html: string) {
  // Precisa ser filho direto de body: o CSS de print esconde body > *:not(#printArea)
  let area = document.getElementById('printArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'printArea';
    document.body.appendChild(area);
  } else if (area.parentElement !== document.body) {
    document.body.appendChild(area);
  }
  area.innerHTML = html;
  const limpar = () => {
    area!.innerHTML = '';
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);
  setTimeout(() => window.print(), 150);
}
