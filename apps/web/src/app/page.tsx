'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, getUser } from '@/lib/api';

type Tab = 'kpis' | 'lista' | 'alertas' | 'gestao' | 'dados';

type Rec = {
  id: string;
  reg: number;
  data?: string;
  empresa?: string;
  setor?: string;
  sku?: string;
  produto?: string;
  reclamacao?: string;
  cliente?: string;
  cidade?: string;
  uf?: string;
  canal?: string;
  procedencia?: string;
  devolucao?: string;
  situacao?: string;
  dataAcao?: string;
  dataRecebimento?: string;
  laudo?: string;
  solucao?: string;
  garantia?: string;
  protocolo?: string;
  obs?: string;
  transp?: string;
  freteEnvio?: number;
  freteRetorno?: number;
  valorPeca?: number;
  estorno?: number;
  desconto?: number;
  guia?: number;
  causaId?: string;
  causaManual?: boolean;
  obsCausa?: string;
  peca?: string;
  rascunho?: boolean;
  origem?: string;
  custoTotal?: number;
  tempoDias?: number | null;
  setorResp?: string;
  causa?: { id: string; nome: string; setor: string; acao: string };
};

type Kpis = {
  totais: {
    n: number;
    aguardando: number;
    tratativa: number;
    resolvida: number;
    custo: number;
    tempoMedio: number | null;
    metaDias: number;
    pctMeta: number | null;
    pctRecorrentes: number;
  };
  direcionamento: { k: string; n: number; custo: number }[];
  recorrencias: { cod: string; causaId: string; n: number; custo: number }[];
};

type Alerta = { id: string; tipo: string; titulo: string; mensagem: string };
type Causa = { id: string; nome: string; cat: string; setor: string };
type UsuarioRow = {
  id: string;
  login: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  telefone?: string | null;
  criadoEm?: string;
  criadoPor?: string | null;
};
type RegraRow = {
  id: string;
  nome: string;
  cat: string;
  setor: string;
  acao: string;
  customizado?: boolean;
};
type ProdutoRow = {
  id: string;
  cod: string;
  produto: string;
  setor: string;
  status: string;
  categoria: string;
  familia: string;
};
type AuditoriaRow = {
  id: string;
  ts: string;
  user: string;
  nome?: string;
  perfil?: string;
  acao: string;
  alvo?: string;
  detalhe?: string;
};

const emptyForm = {
  data: '',
  empresa: '',
  setor: '',
  sku: '',
  produto: '',
  garantia: 'SIM',
  canal: '',
  protocolo: '',
  cliente: '',
  cidade: '',
  uf: '',
  reclamacao: '',
  laudo: '',
  procedencia: '',
  solucao: '',
  dataAcao: '',
  obs: '',
  transp: '',
  freteEnvio: 0,
  freteRetorno: 0,
  valorPeca: 0,
  estorno: 0,
  desconto: 0,
  guia: 0,
  devolucao: 'NA',
  dataRecebimento: '',
  causaId: '',
  causaManual: false,
  obsCausa: '',
  peca: '',
  rascunho: false,
};

function brl(n: number) {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function tagSit(s?: string) {
  if (s === 'resolvida') return <span className="tag ok">Resolvida</span>;
  if (s === 'aguardando') return <span className="tag aguard">Aguardando produto</span>;
  return <span className="tag trat">Em tratativa</span>;
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<{ login: string; nome: string; perfil: string } | null>(null);
  const [tab, setTab] = useState<Tab>('kpis');
  const [filtros, setFiltros] = useState({ de: '', ate: '', status: '', dev: '', busca: '' });
  const [lista, setLista] = useState<Rec[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [causas, setCausas] = useState<Causa[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [sugestao, setSugestao] = useState<{
    causaNome: string;
    setor: string;
    peca: string;
    confianca: number;
    fonte: string;
    explicacao?: string;
    acao?: string;
  } | null>(null);
  const [msg, setMsg] = useState('');
  const [gestaoSub, setGestaoSub] = useState<'usuarios' | 'regras' | 'produtos' | 'auditoria'>('usuarios');
  const [gestaoData, setGestaoData] = useState<unknown[]>([]);
  const [novoUser, setNovoUser] = useState({ login: '', nome: '', senha: '', perfil: 'operador' });
  const [produtoQ, setProdutoQ] = useState('');
  const [produtoBusca, setProdutoBusca] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filtros.de) p.set('de', filtros.de);
    if (filtros.ate) p.set('ate', filtros.ate);
    if (filtros.status) p.set('status', filtros.status);
    if (filtros.dev) p.set('dev', filtros.dev);
    if (filtros.busca) p.set('q', filtros.busca);
    return p.toString();
  }, [filtros]);

  const refresh = useCallback(async () => {
    const [l, k, a, c] = await Promise.all([
      api<Rec[]>(`/reclamacoes?${qs}`),
      api<Kpis>(`/kpis?${qs}`),
      api<Alerta[]>('/alertas?status=aberto'),
      api<{ abertos: number }>('/alertas/count'),
    ]);
    setLista(l);
    setKpis(k);
    setAlertas(a);
    setAlertCount(c.abertos);
  }, [qs]);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
    api<Causa[]>('/gestao/causas').then(setCausas).catch(() => undefined);
    refresh().catch((e) => setMsg(e.message));
  }, [router, refresh]);

  const loadGestao = useCallback(async () => {
    if (tab !== 'gestao') return;
    const path =
      gestaoSub === 'usuarios'
        ? '/gestao/usuarios'
        : gestaoSub === 'regras'
          ? '/gestao/regras'
          : gestaoSub === 'produtos'
            ? `/gestao/produtos${produtoBusca ? `?q=${encodeURIComponent(produtoBusca)}` : ''}`
            : '/gestao/auditoria?limit=100';
    const data = await api<unknown[]>(path);
    setGestaoData(data);
  }, [tab, gestaoSub, produtoBusca]);

  useEffect(() => {
    loadGestao().catch((e) => setMsg(e.message));
  }, [loadGestao]);

  function openNew() {
    setEditId(null);
    setForm({ ...emptyForm, data: new Date().toISOString().slice(0, 10) });
    setSugestao(null);
    setModal(true);
  }

  function openEdit(r: Rec) {
    setEditId(r.id);
    setForm({
      ...emptyForm,
      data: r.data || '',
      empresa: r.empresa || '',
      setor: r.setor || '',
      sku: r.sku || '',
      produto: r.produto || '',
      garantia: r.garantia || '',
      canal: r.canal || '',
      protocolo: r.protocolo || '',
      cliente: r.cliente || '',
      cidade: r.cidade || '',
      uf: r.uf || '',
      reclamacao: r.reclamacao || '',
      laudo: r.laudo || '',
      procedencia: r.procedencia || '',
      solucao: r.solucao || '',
      dataAcao: r.dataAcao || '',
      obs: r.obs || '',
      transp: r.transp || '',
      freteEnvio: r.freteEnvio || 0,
      freteRetorno: r.freteRetorno || 0,
      valorPeca: r.valorPeca || 0,
      estorno: r.estorno || 0,
      desconto: r.desconto || 0,
      guia: r.guia || 0,
      devolucao: r.devolucao || 'NA',
      dataRecebimento: r.dataRecebimento || '',
      causaId: r.causaId || r.causa?.id || '',
      causaManual: !!r.causaManual,
      obsCausa: r.obsCausa || '',
      peca: r.peca || '',
      rascunho: !!r.rascunho,
    });
    setSugestao(null);
    setModal(true);
  }

  async function classificarIa() {
    if (!form.reclamacao && !form.laudo && !form.solucao) {
      setMsg('Preencha reclamação, laudo ou solução antes de pedir a sugestão.');
      return;
    }
    const s = await api<{
      causaId: string;
      causaNome: string;
      setor: string;
      peca: string;
      confianca: number;
      fonte: string;
      explicacao?: string;
      acao?: string;
      laudoSugerido?: string;
    }>('/ia/classificar', {
      method: 'POST',
      json: {
        laudo: form.laudo,
        reclamacao: form.reclamacao,
        solucao: form.solucao,
        sku: form.sku,
        produto: form.produto,
      },
    });
    setForm((f) => ({
      ...f,
      causaId: s.causaId,
      causaManual: false,
      peca: s.peca || f.peca,
      laudo: f.laudo || s.laudoSugerido || '',
    }));
    setSugestao({
      causaNome: s.causaNome,
      setor: s.setor,
      peca: s.peca || '',
      confianca: s.confianca,
      fonte: s.fonte,
      explicacao: s.explicacao,
      acao: s.acao,
    });
  }

  function nomeCausa(id: string) {
    return causas.find((c) => c.id === id)?.nome || id;
  }

  function fonteLabel(fonte: string) {
    if (fonte === 'llm') return 'ChatGPT';
    if (fonte === 'manual') return 'Escolha manual';
    return 'Regras do SAC';
  }

  async function salvar() {
    const payload = {
      ...form,
      causaManual: !!form.causaId,
      freteEnvio: Number(form.freteEnvio) || 0,
      freteRetorno: Number(form.freteRetorno) || 0,
      valorPeca: Number(form.valorPeca) || 0,
      estorno: Number(form.estorno) || 0,
      desconto: Number(form.desconto) || 0,
      guia: Number(form.guia) || 0,
      rascunho: false,
    };
    if (editId) await api(`/reclamacoes/${editId}`, { method: 'PATCH', json: payload });
    else await api('/reclamacoes', { method: 'POST', json: payload });
    setModal(false);
    setMsg('Salvo.');
    await refresh();
  }

  async function receber(id: string) {
    await api(`/reclamacoes/${id}/receber`, { method: 'POST' });
    await refresh();
  }

  if (!user) return null;
  const ehGestor = user.perfil === 'gestor' || user.perfil === 'master';
  const setF = (k: string, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <header className="top">
        <span className="titulo">SAC</span>
        <span className="muted">AISA em nuvem · Evolution + Postgres</span>
        <span className="spacer" />
        <span>
          <b>{user.nome}</b> · {user.perfil}
        </span>
        <button
          className="small"
          onClick={() => {
            clearSession();
            router.push('/login');
          }}
        >
          Sair
        </button>
      </header>

      <nav className="tabs">
        {(
          [
            ['kpis', 'KPIs'],
            ['lista', 'Reclamações'],
            ['alertas', 'Alertas'],
            ['gestao', 'Gestão'],
            ['dados', 'Dados'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'alertas' && alertCount > 0 ? <span className="badge">{alertCount}</span> : null}
          </button>
        ))}
      </nav>

      <div className="filtros">
        <label>
          De
          <input type="date" value={filtros.de} onChange={(e) => setFiltros({ ...filtros, de: e.target.value })} />
        </label>
        <label>
          Até
          <input type="date" value={filtros.ate} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })} />
        </label>
        <label>
          Situação
          <select value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
            <option value="">Todas</option>
            <option value="aguardando">Aguardando produto</option>
            <option value="tratativa">Em tratativa</option>
            <option value="resolvida">Resolvidas</option>
          </select>
        </label>
        <label>
          Devolução
          <select value={filtros.dev} onChange={(e) => setFiltros({ ...filtros, dev: e.target.value })}>
            <option value="">Todas</option>
            <option value="AGUARDANDO">Aguardando chegada</option>
            <option value="RECEBIDO">Produto recebido</option>
            <option value="NA">Sem devolução</option>
          </select>
        </label>
        <label>
          Buscar
          <input
            value={filtros.busca}
            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
            placeholder="SKU, cliente, texto…"
          />
        </label>
        <button onClick={() => setFiltros({ de: '', ate: '', status: '', dev: '', busca: '' })}>Limpar</button>
      </div>

      <main>
        {msg ? (
          <div className="card" style={{ background: 'var(--ok-bg)' }}>
            {msg}{' '}
            <button className="small" onClick={() => setMsg('')}>
              ok
            </button>
          </div>
        ) : null}

        {tab === 'kpis' && kpis ? (
          <>
            <div className="kpi-hero">
              <div className="kpi-panel">
                <h3>Situação no período</h3>
                <div className="kpi-big">{kpis.totais.n}</div>
                <div className="kpi-big-label">reclamações filtradas</div>
                {(() => {
                  const tot = Math.max(kpis.totais.n, 1);
                  const pctA = (kpis.totais.aguardando / tot) * 100;
                  const pctT = (kpis.totais.tratativa / tot) * 100;
                  const pctR = (kpis.totais.resolvida / tot) * 100;
                  return (
                    <>
                      <div className="kpi-stack" aria-hidden>
                        <i className="s-aguard" style={{ width: `${pctA}%` }} />
                        <i className="s-trat" style={{ width: `${pctT}%` }} />
                        <i className="s-ok" style={{ width: `${pctR}%` }} />
                      </div>
                      <div className="kpi-legend">
                        <span>
                          Aguardando <b>{kpis.totais.aguardando}</b>
                        </span>
                        <span>
                          Tratativa <b>{kpis.totais.tratativa}</b>
                        </span>
                        <span>
                          Resolvidas <b>{kpis.totais.resolvida}</b>
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="kpi-panel">
                <div className="kpi-metric">
                  <h3>Custo total</h3>
                  <div className="kpi-big" style={{ fontSize: 26 }}>
                    {brl(kpis.totais.custo)}
                  </div>
                  <div className="kpi-big-label">
                    tempo médio {kpis.totais.tempoMedio == null ? '—' : `${kpis.totais.tempoMedio.toFixed(1)} dias`}
                  </div>
                </div>
              </div>
              <div className="kpi-panel">
                <div className="kpi-metric">
                  <h3>Na meta (≤{kpis.totais.metaDias}d)</h3>
                  <div className="kpi-big">{kpis.totais.pctMeta == null ? '—' : `${kpis.totais.pctMeta}%`}</div>
                  <div
                    className={`kpi-meter ${kpis.totais.pctMeta != null && kpis.totais.pctMeta < 70 ? 'warn' : ''}`}
                  >
                    <i style={{ width: `${Math.min(100, kpis.totais.pctMeta || 0)}%` }} />
                  </div>
                  <div className="kpi-big-label">{kpis.totais.pctRecorrentes}% com causa recorrente no SKU</div>
                </div>
              </div>
            </div>

            <div className="kpis">
              <div className={`kpi ${kpis.totais.aguardando ? 'alerta' : ''}`}>
                <span>Aguardando produto</span>
                <b>{kpis.totais.aguardando}</b>
              </div>
              <div className="kpi">
                <span>Em tratativa</span>
                <b>{kpis.totais.tratativa}</b>
              </div>
              <div className="kpi">
                <span>Resolvidas</span>
                <b>{kpis.totais.resolvida}</b>
              </div>
              <div className="kpi">
                <span>Recorrentes</span>
                <b>{kpis.totais.pctRecorrentes}%</b>
              </div>
            </div>

            <div className="grid2">
              <div className="card">
                <h3>Para onde direcionar</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Volume de reclamações por setor responsável (causa → setor).
                </p>
                <div className="bar-list">
                  {kpis.direcionamento.slice(0, 10).map((g) => {
                    const max = kpis.direcionamento[0]?.n || 1;
                    return (
                      <div className="bar-row" key={g.k}>
                        <div className="name" title={g.k}>
                          {g.k}
                        </div>
                        <div className="bar-track">
                          <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                        </div>
                        <div className="bar-meta">
                          {g.n} · {brl(g.custo)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card">
                <h3>Problemas que se repetem</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Mesmo SKU + mesma causa, mais de uma vez no período.
                </p>
                {!kpis.recorrencias.length ? (
                  <p className="muted">Nenhuma repetição no período.</p>
                ) : (
                  <div className="bar-list">
                    {kpis.recorrencias.slice(0, 10).map((g) => {
                      const max = kpis.recorrencias[0]?.n || 1;
                      return (
                        <div className="bar-row" key={`${g.cod}-${g.causaId}`}>
                          <div className="name" title={`${g.cod} — ${nomeCausa(g.causaId)}`}>
                            <b>{g.cod}</b> · {nomeCausa(g.causaId)}
                          </div>
                          <div className="bar-track cost">
                            <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                          </div>
                          <div className="bar-meta">
                            {g.n}× · {brl(g.custo)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}

        {tab === 'lista' ? (
          <>
            <div className="tools">
              <button className="primary" onClick={openNew}>
                + Nova reclamação
              </button>
              <span className="muted">{lista.length} reclamações</span>
            </div>
            <div className="tablewrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Produto voltou?</th>
                    <th>Empresa</th>
                    <th>SKU</th>
                    <th>Reclamação</th>
                    <th>Causa</th>
                    <th>Setor resp.</th>
                    <th>Cliente</th>
                    <th>Dias</th>
                    <th>Custo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((r) => (
                    <tr key={r.id} onClick={() => openEdit(r)}>
                      <td>
                        #{r.reg}
                        {r.rascunho ? ' *' : ''}
                        {r.origem === 'whatsapp' ? ' WA' : ''}
                      </td>
                      <td>{r.data}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {r.devolucao === 'AGUARDANDO' ? (
                          <>
                            <span className="tag aguard">AINDA NÃO CHEGOU</span>
                            <br />
                            <button className="small" onClick={() => receber(r.id)}>
                              Marcar recebido
                            </button>
                          </>
                        ) : r.devolucao === 'RECEBIDO' ? (
                          <span className="tag ok">JÁ VOLTOU</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{r.empresa}</td>
                      <td>
                        <b>{r.sku}</b>
                        <br />
                        <span className="muted">{r.produto}</span>
                      </td>
                      <td style={{ maxWidth: 220 }}>{r.reclamacao}</td>
                      <td>{r.causa?.nome}</td>
                      <td>
                        <span className="tag trat">{r.setorResp}</span>
                      </td>
                      <td>
                        {r.cliente}
                        <br />
                        <span className="muted">
                          {r.cidade}/{r.uf}
                        </span>
                      </td>
                      <td>{r.tempoDias ?? '—'}</td>
                      <td>{r.custoTotal ? brl(r.custoTotal) : '—'}</td>
                      <td>{tagSit(r.situacao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === 'alertas' ? (
          <>
            <div className="tools">
              {ehGestor ? (
                <button
                  className="primary"
                  onClick={async () => {
                    const res = await api<{ abertos: number }>('/alertas/varrer', { method: 'POST' });
                    setMsg(`Varredura ok. Abertos: ${res.abertos}`);
                    await refresh();
                  }}
                >
                  Executar varredura agora
                </button>
              ) : null}
              <span className="muted">{alertCount} abertos</span>
            </div>
            {alertas.map((a) => (
              <div className="card" key={a.id}>
                <h3>
                  {a.titulo} <span className="tag aguard">{a.tipo}</span>
                </h3>
                <p>{a.mensagem}</p>
                <div className="tools">
                  <button className="small" onClick={() => api(`/alertas/${a.id}/resolver`, { method: 'POST' }).then(refresh)}>
                    Resolver
                  </button>
                  <button className="small" onClick={() => api(`/alertas/${a.id}/ignorar`, { method: 'POST' }).then(refresh)}>
                    Ignorar
                  </button>
                </div>
              </div>
            ))}
            {!alertas.length ? <div className="card muted">Nenhum alerta aberto.</div> : null}
          </>
        ) : null}

        {tab === 'gestao' ? (
          <>
            <div className="subnav">
              {(
                [
                  ['usuarios', 'Usuários'],
                  ['regras', 'Regras'],
                  ['produtos', 'Produtos'],
                  ['auditoria', 'Auditoria'],
                ] as const
              ).map(([s, label]) => (
                <button key={s} className={gestaoSub === s ? 'on' : ''} onClick={() => setGestaoSub(s)}>
                  {label}
                </button>
              ))}
            </div>

            {gestaoSub === 'usuarios' ? (
              <>
                {ehGestor ? (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <h3>Novo usuário</h3>
                    <div className="fgrid" style={{ marginBottom: 10 }}>
                      <div className="field">
                        <label>Login</label>
                        <input value={novoUser.login} onChange={(e) => setNovoUser((u) => ({ ...u, login: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Nome</label>
                        <input value={novoUser.nome} onChange={(e) => setNovoUser((u) => ({ ...u, nome: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Senha</label>
                        <input
                          type="password"
                          value={novoUser.senha}
                          onChange={(e) => setNovoUser((u) => ({ ...u, senha: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label>Perfil</label>
                        <select value={novoUser.perfil} onChange={(e) => setNovoUser((u) => ({ ...u, perfil: e.target.value }))}>
                          <option value="operador">Operador</option>
                          <option value="gestor">Gestor</option>
                          {user.perfil === 'master' ? <option value="master">Master</option> : null}
                        </select>
                      </div>
                    </div>
                    <button
                      className="primary"
                      onClick={async () => {
                        await api('/gestao/usuarios', { method: 'POST', json: novoUser });
                        setNovoUser({ login: '', nome: '', senha: '', perfil: 'operador' });
                        setMsg('Usuário criado.');
                        await loadGestao();
                      }}
                    >
                      Criar usuário
                    </button>
                  </div>
                ) : null}
                <div className="tablewrap">
                  <table className="list" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Login</th>
                        <th>Nome</th>
                        <th>Perfil</th>
                        <th>Status</th>
                        <th>Criado por</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(gestaoData as UsuarioRow[]).map((u) => (
                        <tr key={u.id} style={{ cursor: 'default' }}>
                          <td>
                            <b>{u.login}</b>
                          </td>
                          <td>{u.nome}</td>
                          <td>
                            <span className="tag trat">{u.perfil}</span>
                          </td>
                          <td>{u.ativo ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
                          <td className="muted">{u.criadoPor || '—'}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {ehGestor ? (
                              <button
                                className="small"
                                onClick={async () => {
                                  await api(`/gestao/usuarios/${u.id}`, {
                                    method: 'PATCH',
                                    json: { ativo: !u.ativo },
                                  });
                                  await loadGestao();
                                }}
                              >
                                {u.ativo ? 'Desativar' : 'Ativar'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {gestaoSub === 'regras' ? (
              <div className="tablewrap">
                <table className="list" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Causa</th>
                      <th>Categoria</th>
                      <th>Setor responsável</th>
                      <th>Ação sugerida</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gestaoData as RegraRow[]).map((r) => (
                      <tr key={r.id} style={{ cursor: 'default' }}>
                        <td>
                          <b>{r.nome}</b>
                          <br />
                          <span className="muted">{r.id}</span>
                        </td>
                        <td>{r.cat}</td>
                        <td>{r.setor}</td>
                        <td style={{ maxWidth: 360 }}>{r.acao}</td>
                        <td>{r.customizado ? <span className="tag trat">Custom</span> : <span className="muted">Padrão</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {gestaoSub === 'produtos' ? (
              <>
                <div className="tools">
                  <input
                    placeholder="Buscar código, produto ou família…"
                    value={produtoQ}
                    onChange={(e) => setProdutoQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setProdutoBusca(produtoQ.trim());
                    }}
                    style={{ minWidth: 280 }}
                  />
                  <button className="small" onClick={() => setProdutoBusca(produtoQ.trim())}>
                    Buscar
                  </button>
                  <span className="muted">{(gestaoData as ProdutoRow[]).length} produtos</span>
                </div>
                <div className="tablewrap">
                  <table className="list" style={{ minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Produto</th>
                        <th>Setor</th>
                        <th>Família</th>
                        <th>Categoria</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(gestaoData as ProdutoRow[]).map((p) => (
                        <tr key={p.id} style={{ cursor: 'default' }}>
                          <td>
                            <b>{p.cod}</b>
                          </td>
                          <td>{p.produto}</td>
                          <td>{p.setor}</td>
                          <td>{p.familia || '—'}</td>
                          <td className="muted">{p.categoria || '—'}</td>
                          <td>
                            {p.status === 'ATIVO' ? (
                              <span className="tag ok">Ativo</span>
                            ) : (
                              <span className="tag bad">Inativo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {gestaoSub === 'auditoria' ? (
              <div className="tablewrap">
                <table className="list" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Usuário</th>
                      <th>Ação</th>
                      <th>Alvo</th>
                      <th>Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gestaoData as AuditoriaRow[]).map((a) => (
                      <tr key={a.id} style={{ cursor: 'default' }}>
                        <td className="muted">{a.ts ? new Date(a.ts).toLocaleString('pt-BR') : '—'}</td>
                        <td>
                          <b>{a.user}</b>
                          {a.perfil ? (
                            <>
                              <br />
                              <span className="muted">{a.perfil}</span>
                            </>
                          ) : null}
                        </td>
                        <td>{a.acao}</td>
                        <td>{a.alvo || '—'}</td>
                        <td style={{ maxWidth: 360 }}>{a.detalhe || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'dados' ? (
          <div className="card">
            <h3>Dados / Backup</h3>
            <p className="muted">Importa o JSON legado para o Postgres (EasyPanel).</p>
            <div className="tools">
              {ehGestor ? (
                <button
                  className="primary"
                  onClick={async () => {
                    const res = await api<{ reclamacoes: number }>('/dados/importar-backup', {
                      method: 'POST',
                      json: {},
                    });
                    setMsg(`Importadas ${res.reclamacoes} reclamações.`);
                    await refresh();
                  }}
                >
                  Importar backup
                </button>
              ) : null}
              <button
                onClick={async () => {
                  const data = await api('/dados/exportar-backup', { method: 'POST' });
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `sac_backup_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                }}
              >
                Exportar backup
              </button>
            </div>
            <p className="muted">
              Evolution API webhook: <code>/whatsapp/webhook/evolution</code>
            </p>
          </div>
        ) : null}
      </main>

      {modal ? (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="dhead">{editId ? 'Editar reclamação' : 'Nova reclamação'}</div>
            <div className="dbody">
              <div className="fgrid">
                <div className="field">
                  <label>Data</label>
                  <input type="date" value={form.data} onChange={(e) => setF('data', e.target.value)} />
                </div>
                <div className="field">
                  <label>Empresa</label>
                  <select value={form.empresa} onChange={(e) => setF('empresa', e.target.value)}>
                    <option value="">—</option>
                    {['AISA', 'ARTMAQ', 'ARAUCA', 'WORK'].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>SKU</label>
                  <input value={form.sku} onChange={(e) => setF('sku', e.target.value.toUpperCase())} />
                </div>
                <div className="field">
                  <label>Garantia</label>
                  <select value={form.garantia} onChange={(e) => setF('garantia', e.target.value)}>
                    <option>SIM</option>
                    <option>NÃO</option>
                  </select>
                </div>
                <div className="field s2">
                  <label>Produto</label>
                  <input value={form.produto} onChange={(e) => setF('produto', e.target.value)} />
                </div>
                <div className="field s2">
                  <label>Devolução</label>
                  <select value={form.devolucao} onChange={(e) => setF('devolucao', e.target.value)}>
                    <option value="NA">Sem devolução</option>
                    <option value="AGUARDANDO">Aguardando chegada</option>
                    <option value="RECEBIDO">Produto recebido</option>
                  </select>
                </div>
                <div className="secao">Dados da reclamação</div>
                <div className="field">
                  <label>Canal</label>
                  <input value={form.canal} onChange={(e) => setF('canal', e.target.value.toUpperCase())} />
                </div>
                <div className="field">
                  <label>Protocolo</label>
                  <input value={form.protocolo} onChange={(e) => setF('protocolo', e.target.value)} />
                </div>
                <div className="field">
                  <label>Cliente</label>
                  <input value={form.cliente} onChange={(e) => setF('cliente', e.target.value)} />
                </div>
                <div className="field">
                  <label>UF</label>
                  <input maxLength={2} value={form.uf} onChange={(e) => setF('uf', e.target.value.toUpperCase())} />
                </div>
                <div className="field s4">
                  <label>Reclamação</label>
                  <textarea value={form.reclamacao} onChange={(e) => setF('reclamacao', e.target.value)} />
                </div>
                <div className="field s2">
                  <label>Laudo</label>
                  <input value={form.laudo} onChange={(e) => setF('laudo', e.target.value)} />
                </div>
                <div className="field s2">
                  <label>Procedência</label>
                  <select value={form.procedencia} onChange={(e) => setF('procedencia', e.target.value)}>
                    <option value="">—</option>
                    <option>PROCEDE</option>
                    <option>NÃO PROCEDE</option>
                  </select>
                </div>
                <div className="field s4">
                  <label>Solução</label>
                  <textarea value={form.solucao} onChange={(e) => setF('solucao', e.target.value)} />
                </div>
                <div className="field">
                  <label>Data da ação</label>
                  <input type="date" value={form.dataAcao} onChange={(e) => setF('dataAcao', e.target.value)} />
                </div>
                <div className="secao">Direcionamento</div>
                <div className="sugestao-box">
                  <h4>Sugestão de causa e setor</h4>
                  <p className="help">
                    Lê o texto da <b>reclamação</b>, <b>laudo</b> e <b>solução</b> e sugere a causa + setor
                    responsável. Sem chave LLM, usa só as <b>regras do SAC</b> (palavras-chave). Com
                    OpenRouter/OpenAI, a LLM pode reforçar ou confirmar a sugestão. Você sempre pode
                    trocar a causa manualmente.
                  </p>
                  {sugestao ? (
                    <>
                      <div className="sugestao-grid">
                        <div className="cell">
                          <span>Causa</span>
                          <b>{sugestao.causaNome}</b>
                        </div>
                        <div className="cell">
                          <span>Setor responsável</span>
                          <b>{sugestao.setor}</b>
                        </div>
                        <div className="cell">
                          <span>Peça detectada</span>
                          <b>{sugestao.peca || '—'}</b>
                        </div>
                        <div className="cell">
                          <span>Fonte · confiança</span>
                          <b>
                            {fonteLabel(sugestao.fonte)} · {Math.round(sugestao.confianca * 100)}%
                          </b>
                        </div>
                      </div>
                      {sugestao.acao || sugestao.explicacao ? (
                        <p className="why">
                          {sugestao.acao ? (
                            <>
                              <b>Ação sugerida:</b> {sugestao.acao}
                              <br />
                            </>
                          ) : null}
                          {sugestao.explicacao || null}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="help" style={{ marginBottom: 0 }}>
                      Clique em <b>Sugerir causa e setor</b> depois de preencher o texto.
                    </p>
                  )}
                </div>
                <div className="field s2">
                  <label>Causa</label>
                  <select
                    value={form.causaId}
                    onChange={(e) => {
                      setF('causaId', e.target.value);
                      setF('causaManual', true);
                    }}
                  >
                    <option value="">Selecione…</option>
                    {causas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field s2">
                  <label>Peça</label>
                  <input value={form.peca} onChange={(e) => setF('peca', e.target.value)} />
                </div>
                <div className="secao">Custos (R$)</div>
                {(['freteEnvio', 'freteRetorno', 'valorPeca', 'estorno', 'desconto', 'guia'] as const).map((k) => (
                  <div className="field" key={k}>
                    <label>{k}</label>
                    <input type="number" step="0.01" value={form[k]} onChange={(e) => setF(k, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
            <div className="dfoot">
              <button onClick={classificarIa}>Sugerir causa e setor</button>
              <button onClick={() => setModal(false)}>Cancelar</button>
              <button className="primary" onClick={salvar}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
