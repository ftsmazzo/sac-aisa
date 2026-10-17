'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, downloadAuthed, getUser, uploadFile, uploadUrl } from '@/lib/api';

type Tab = 'kpis' | 'lista' | 'alertas' | 'qualidade' | 'gestao' | 'dados';

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

type KpiGrupo = { k: string; n: number; custo: number };
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
  direcionamento: KpiGrupo[];
  porSetor: KpiGrupo[];
  porCausa: KpiGrupo[];
  recorrencias: { cod: string; causaId: string; n: number; custo: number }[];
};

type Filtros = {
  de: string;
  ate: string;
  status: string;
  dev: string;
  busca: string;
  setor: string;
  resp: string;
  causa: string;
  sku: string;
};

const emptyFiltros: Filtros = {
  de: '',
  ate: '',
  status: '',
  dev: '',
  busca: '',
  setor: '',
  resp: '',
  causa: '',
  sku: '',
};

function nomeCausaLabel(causas: { id: string; nome: string }[], id: string) {
  return causas.find((c) => c.id === id)?.nome || id;
}

type QualidadePainel = {
  limitePpm: number;
  modoContagem: string;
  totais: {
    skus: number;
    vendas: number;
    reclamacoes: number;
    ppm: number | null;
    taxa: number | null;
    acimaLimite: number;
    pctAcimaLimite: number | null;
    semVenda: number;
  };
  topDefeitos: {
    sku: string;
    produto: string;
    vendas: number;
    reclamacoes: number;
    setorFab: string;
    setorResp: string;
    taxa: number | null;
    ppm: number | null;
    semVenda: boolean;
    acimaLimite: boolean;
  }[];
  setoresCriticos: {
    k: string;
    vendas: number;
    reclamacoes: number;
    skus: number;
    ppm: number | null;
    taxa: number | null;
    acimaLimite: boolean;
  }[];
  porSetorFab: {
    k: string;
    vendas: number;
    reclamacoes: number;
    skus: number;
    ppm: number | null;
    taxa: number | null;
    acimaLimite: boolean;
  }[];
  porSetorResp: {
    k: string;
    vendas: number;
    reclamacoes: number;
    skus: number;
    ppm: number | null;
    taxa: number | null;
    acimaLimite: boolean;
  }[];
  planosAbertos: number;
  planos: {
    id: string;
    titulo: string;
    sku: string;
    setorFab: string;
    setorResp: string;
    status: string;
    prazo?: string | null;
    responsavel: string;
  }[];
  vendasResumo: {
    linhas: number;
    skus: number;
    totalQtde: number;
    de: string | null;
    ate: string | null;
  };
};

type PlanoRow = {
  id: string;
  titulo: string;
  descricao: string;
  sku: string;
  causaId: string;
  setorFab: string;
  setorResp: string;
  status: string;
  prioridade: string;
  responsavel: string;
  prazo?: string | null;
  origem: string;
};

function fmtPpm(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n).toLocaleString('pt-BR')} ppm`;
}

function fmtTaxa(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(3)}%`;
}

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
type Anexo = {
  id: string;
  nome: string;
  path: string;
  kb?: number;
};
type PendingAnexo = { key: string; file: File; preview?: string };

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
  const [filtros, setFiltros] = useState<Filtros>(emptyFiltros);
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
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingAnexo[]>([]);
  const [anexoDrop, setAnexoDrop] = useState(false);
  const [qualSub, setQualSub] = useState<'painel' | 'importar' | 'planos'>('painel');
  const [qualPainel, setQualPainel] = useState<QualidadePainel | null>(null);
  const [qualPlanos, setQualPlanos] = useState<PlanoRow[]>([]);
  const [vendaTexto, setVendaTexto] = useState('');
  const [vendaPreview, setVendaPreview] = useState<{
    linhas: number;
    skus: number;
    totalQtde: number;
    de: string | null;
    ate: string | null;
    avisos: string[];
    avisosTotal: number;
  } | null>(null);
  const [novoPlano, setNovoPlano] = useState({
    titulo: '',
    descricao: '',
    sku: '',
    setorFab: '',
    setorResp: '',
    responsavel: '',
    prazo: '',
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filtros.de) p.set('de', filtros.de);
    if (filtros.ate) p.set('ate', filtros.ate);
    if (filtros.status) p.set('status', filtros.status);
    if (filtros.dev) p.set('dev', filtros.dev);
    if (filtros.busca) p.set('q', filtros.busca);
    if (filtros.setor) p.set('setor', filtros.setor);
    if (filtros.resp) p.set('resp', filtros.resp);
    if (filtros.causa) p.set('causa', filtros.causa);
    if (filtros.sku) p.set('sku', filtros.sku);
    return p.toString();
  }, [filtros]);

  const chipsAtivos = useMemo(() => {
    const chips: { key: keyof Filtros; label: string }[] = [];
    if (filtros.status) {
      const map: Record<string, string> = {
        aguardando: 'Aguardando produto',
        tratativa: 'Em tratativa',
        resolvida: 'Resolvidas',
      };
      chips.push({ key: 'status', label: `Situação: ${map[filtros.status] || filtros.status}` });
    }
    if (filtros.setor) chips.push({ key: 'setor', label: `Fabricação: ${filtros.setor}` });
    if (filtros.resp) chips.push({ key: 'resp', label: `Resolve: ${filtros.resp}` });
    if (filtros.causa) chips.push({ key: 'causa', label: `Causa: ${nomeCausaLabel(causas, filtros.causa)}` });
    if (filtros.sku) chips.push({ key: 'sku', label: `SKU: ${filtros.sku}` });
    if (filtros.dev) chips.push({ key: 'dev', label: `Devolução: ${filtros.dev}` });
    if (filtros.busca) chips.push({ key: 'busca', label: `Busca: ${filtros.busca}` });
    return chips;
  }, [filtros, causas]);

  function toggleFiltro(patch: Partial<Filtros>, goLista = false) {
    setFiltros((f) => {
      const keys = Object.keys(patch) as (keyof Filtros)[];
      const allOn = keys.length > 0 && keys.every((k) => f[k] === patch[k]);
      const next = { ...f };
      for (const k of keys) next[k] = allOn ? '' : String(patch[k] ?? '');
      return next;
    });
    if (goLista) setTab('lista');
  }

  async function exportRelatorioSetor() {
    try {
      const rows = await api<Rec[]>(`/reclamacoes?${qs}`);
      if (!rows.length) {
        setMsg('Nenhuma reclamação no filtro atual para exportar.');
        return;
      }
      const esc = (v: unknown) => {
        const s = String(v ?? '');
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        'reg',
        'data',
        'sku',
        'produto',
        'setor_fabricacao',
        'setor_responsavel',
        'causa',
        'cliente',
        'cidade',
        'uf',
        'situacao',
        'custo',
        'reclamacao',
        'laudo',
        'solucao',
      ];
      const lines = [
        header.join(';'),
        ...rows.map((r) =>
          [
            r.reg,
            r.data,
            r.sku,
            r.produto,
            r.setor,
            r.setorResp,
            r.causa?.nome,
            r.cliente,
            r.cidade,
            r.uf,
            r.situacao,
            r.custoTotal ?? 0,
            r.reclamacao,
            r.laudo,
            r.solucao,
          ]
            .map(esc)
            .join(';'),
        ),
      ];
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      const setorSlug = (filtros.setor || 'todos').replace(/[^\w-]+/g, '_');
      a.href = URL.createObjectURL(blob);
      a.download = `relatorio_setor_${setorSlug}_${filtros.de || 'inicio'}_${filtros.ate || 'hoje'}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`Relatório exportado (${rows.length} linhas).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao exportar');
    }
  }

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const [l, k, a, c] = await Promise.all([
        api<Rec[]>(`/reclamacoes?${qs}`, { signal }),
        api<Kpis>(`/kpis?${qs}`, { signal }),
        api<Alerta[]>('/alertas?status=aberto', { signal }),
        api<{ abertos: number }>('/alertas/count', { signal }),
      ]);
      if (signal?.aborted) return;
      setLista(l);
      setKpis(k);
      setAlertas(a);
      setAlertCount(c.abertos);
    },
    [qs],
  );

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
    api<Causa[]>('/gestao/causas').then(setCausas).catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    refresh(ac.signal).catch((e) => {
      if (e?.name !== 'AbortError') setMsg(e.message);
    });
    return () => ac.abort();
  }, [user, refresh]);

  const loadGestao = useCallback(
    async (signal?: AbortSignal) => {
      if (tab !== 'gestao') return;
      const path =
        gestaoSub === 'usuarios'
          ? '/gestao/usuarios'
          : gestaoSub === 'regras'
            ? '/gestao/regras'
            : gestaoSub === 'produtos'
              ? `/gestao/produtos${produtoBusca ? `?q=${encodeURIComponent(produtoBusca)}` : ''}`
              : '/gestao/auditoria?limit=100';
      const data = await api<unknown[]>(path, { signal });
      if (!signal?.aborted) setGestaoData(data);
    },
    [tab, gestaoSub, produtoBusca],
  );

  useEffect(() => {
    if (tab !== 'gestao') return;
    const ac = new AbortController();
    loadGestao(ac.signal).catch((e) => {
      if (e?.name !== 'AbortError') setMsg(e.message);
    });
    return () => ac.abort();
  }, [tab, loadGestao]);

  const loadQualidade = useCallback(
    async (signal?: AbortSignal) => {
      if (tab !== 'qualidade') return;
      const p = new URLSearchParams();
      if (filtros.de) p.set('de', filtros.de);
      if (filtros.ate) p.set('ate', filtros.ate);
      if (filtros.setor) p.set('setor', filtros.setor);
      if (filtros.resp) p.set('resp', filtros.resp);
      if (filtros.sku) p.set('sku', filtros.sku);
      const [painel, planos] = await Promise.all([
        api<QualidadePainel>(`/qualidade/painel?${p}`, { signal }),
        api<PlanoRow[]>(`/qualidade/planos?${p}`, { signal }),
      ]);
      if (!signal?.aborted) {
        setQualPainel(painel);
        setQualPlanos(planos);
      }
    },
    [tab, filtros.de, filtros.ate, filtros.setor, filtros.resp, filtros.sku],
  );

  useEffect(() => {
    if (tab !== 'qualidade') return;
    const ac = new AbortController();
    loadQualidade(ac.signal).catch((e) => {
      if (e?.name !== 'AbortError') setMsg(e.message);
    });
    return () => ac.abort();
  }, [tab, loadQualidade]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  useEffect(() => {
    if (!modal || !editId) return;
    const ac = new AbortController();
    const id = editId;
    api<Anexo[]>(`/reclamacoes/${id}/anexos`, { signal: ac.signal })
      .then((list) => {
        if (!ac.signal.aborted) setAnexos(list);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setAnexos([]);
      });
    return () => ac.abort();
  }, [modal, editId]);

  useEffect(() => {
    if (modal) return;
    clearPendingFiles();
  }, [modal]);

  function isImageName(name: string) {
    return /\.(jpe?g|png|gif|webp|bmp)$/i.test(name);
  }

  function clearPendingFiles() {
    setPendingFiles((prev) => {
      for (const p of prev) {
        if (p.preview) URL.revokeObjectURL(p.preview);
      }
      return [];
    });
  }

  function addPendingFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const next: PendingAnexo[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      preview: isImageName(file.name) ? URL.createObjectURL(file) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...next]);
  }

  function removePending(key: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function uploadPendentes(reclamacaoId: string) {
    const queue = [...pendingFiles];
    for (const item of queue) {
      await uploadFile(`/reclamacoes/${reclamacaoId}/anexos`, item.file);
      removePending(item.key);
    }
    const list = await api<Anexo[]>(`/reclamacoes/${reclamacaoId}/anexos`);
    setAnexos(list);
  }

  async function removerAnexo(anexoId: string) {
    if (!editId) return;
    await api(`/reclamacoes/${editId}/anexos/${anexoId}`, { method: 'DELETE' });
    setAnexos((a) => a.filter((x) => x.id !== anexoId));
  }

  function openNew() {
    setEditId(null);
    setForm({ ...emptyForm, data: new Date().toISOString().slice(0, 10) });
    setSugestao(null);
    setAnexos([]);
    clearPendingFiles();
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
    clearPendingFiles();
    setAnexos([]);
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
    try {
      let id = editId;
      const hadPending = pendingFiles.length > 0;
      if (editId) {
        await api(`/reclamacoes/${editId}`, { method: 'PATCH', json: payload });
      } else {
        const created = await api<{ id: string }>('/reclamacoes', { method: 'POST', json: payload });
        id = created.id;
        setEditId(created.id);
      }
      if (id && hadPending) await uploadPendentes(id);
      setModal(false);
      setMsg(hadPending ? 'Salvo com anexos.' : 'Salvo.');
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao salvar');
    }
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
            ['qualidade', 'Qualidade'],
            ['gestao', 'Gestão'],
            ['dados', 'Dados'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'alertas' && alertCount > 0 ? <span className="badge">{alertCount}</span> : null}
            {id === 'qualidade' && qualPainel && qualPainel.planosAbertos > 0 ? (
              <span className="badge">{qualPainel.planosAbertos}</span>
            ) : null}
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
        <button onClick={() => setFiltros({ ...emptyFiltros, de: filtros.de, ate: filtros.ate })}>Limpar filtros</button>
      </div>
      {chipsAtivos.length ? (
        <div className="filtro-chips">
          <span className="muted">Ativos:</span>
          {chipsAtivos.map((c) => (
            <button
              key={c.key}
              type="button"
              className="chip on"
              onClick={() => setFiltros((f) => ({ ...f, [c.key]: '' }))}
              title="Remover filtro"
            >
              {c.label} ×
            </button>
          ))}
          <button type="button" className="small" onClick={() => setTab('lista')}>
            Tratar na lista ({lista.length})
          </button>
          <button type="button" className="small primary" onClick={exportRelatorioSetor}>
            Exportar relatório CSV
          </button>
        </div>
      ) : null}

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
                <div className="kpi-big-label">reclamações no filtro · clique para filtrar</div>
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
                        <button
                          type="button"
                          className={`kpi-click${filtros.status === 'aguardando' ? ' on' : ''}`}
                          aria-pressed={filtros.status === 'aguardando'}
                          onClick={() => toggleFiltro({ status: 'aguardando' })}
                        >
                          Aguardando <b>{kpis.totais.aguardando}</b>
                        </button>
                        <button
                          type="button"
                          className={`kpi-click${filtros.status === 'tratativa' ? ' on' : ''}`}
                          aria-pressed={filtros.status === 'tratativa'}
                          onClick={() => toggleFiltro({ status: 'tratativa' })}
                        >
                          Tratativa <b>{kpis.totais.tratativa}</b>
                        </button>
                        <button
                          type="button"
                          className={`kpi-click${filtros.status === 'resolvida' ? ' on' : ''}`}
                          aria-pressed={filtros.status === 'resolvida'}
                          onClick={() => toggleFiltro({ status: 'resolvida' })}
                        >
                          Resolvidas <b>{kpis.totais.resolvida}</b>
                        </button>
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
                  {(kpis.porSetor?.[0] || kpis.direcionamento?.[0]) && (
                    <p className="kpi-insight">
                      {kpis.porSetor?.[0] ? (
                        <>
                          Mais volume na fabricação <b>{kpis.porSetor[0].k}</b> ({kpis.porSetor[0].n}).{' '}
                        </>
                      ) : null}
                      {kpis.direcionamento?.[0] ? (
                        <>
                          Quadro resolve em <b>{kpis.direcionamento[0].k}</b> ({kpis.direcionamento[0].n}).
                        </>
                      ) : null}
                    </p>
                  )}
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
                  <div className="kpi-actions">
                    <button type="button" className="small" onClick={() => setTab('lista')}>
                      Abrir lista filtrada
                    </button>
                    <button type="button" className="small primary" onClick={exportRelatorioSetor}>
                      Relatório CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid2">
              <div className="card">
                <h3>Setor que resolve o problema</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Clique para filtrar · porta de tratativa (causa → setor responsável).
                </p>
                <div className="bar-list">
                  {(kpis.direcionamento || []).slice(0, 12).map((g) => {
                    const max = kpis.direcionamento[0]?.n || 1;
                    const on = filtros.resp === g.k;
                    return (
                      <button
                        type="button"
                        className={`bar-row clickable${on ? ' on' : ''}`}
                        key={g.k}
                        aria-pressed={on}
                        onClick={() => toggleFiltro({ resp: g.k })}
                        title="Filtrar por setor responsável"
                      >
                        <div className="name" title={g.k}>
                          {g.k}
                        </div>
                        <div className="bar-track">
                          <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                        </div>
                        <div className="bar-meta">
                          {g.n} · {brl(g.custo)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="card">
                <h3>Setor de fabricação do produto</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Campo setor da reclamação (ex.: 4, 5, 7) · use para falar com o responsável da fábrica.
                </p>
                <div className="bar-list">
                  {!(kpis.porSetor || []).length ? (
                    <p className="muted">Sem dados de setor de fabricação no período.</p>
                  ) : (
                    (kpis.porSetor || []).slice(0, 12).map((g) => {
                      const max = kpis.porSetor[0]?.n || 1;
                      const on = filtros.setor === g.k;
                      return (
                        <button
                          type="button"
                          className={`bar-row clickable${on ? ' on' : ''}`}
                          key={g.k}
                          aria-pressed={on}
                          onClick={() => toggleFiltro({ setor: g.k })}
                          title="Filtrar por setor de fabricação"
                        >
                          <div className="name" title={g.k}>
                            Setor {g.k}
                          </div>
                          <div className="bar-track fab">
                            <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                          </div>
                          <div className="bar-meta">
                            {g.n} · {brl(g.custo)}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {filtros.setor ? (
                  <div className="kpi-actions" style={{ marginTop: 12 }}>
                    <button type="button" className="small primary" onClick={exportRelatorioSetor}>
                      Relatório do setor {filtros.setor}
                    </button>
                    <button type="button" className="small" onClick={() => setTab('lista')}>
                      Tratar reclamações
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid2" style={{ marginTop: 12 }}>
              <div className="card">
                <h3>Problemas que se repetem</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Mesmo SKU + mesma causa · clique para filtrar e tratar.
                </p>
                {!kpis.recorrencias.length ? (
                  <p className="muted">Nenhuma repetição no período.</p>
                ) : (
                  <div className="bar-list">
                    {kpis.recorrencias.slice(0, 10).map((g) => {
                      const max = kpis.recorrencias[0]?.n || 1;
                      const nome = nomeCausa(g.causaId);
                      const on = filtros.sku === g.cod && filtros.causa === g.causaId;
                      return (
                        <button
                          type="button"
                          className={`bar-row clickable${on ? ' on' : ''}`}
                          key={`${g.cod}-${g.causaId}`}
                          aria-pressed={on}
                          onClick={() => toggleFiltro({ sku: g.cod, causa: g.causaId })}
                        >
                          <div className="name" title={`${g.cod} — ${nome}`}>
                            <b>{g.cod}</b> · {nome}
                          </div>
                          <div className="bar-track cost">
                            <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                          </div>
                          <div className="bar-meta">
                            {g.n}× · {brl(g.custo)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="card">
                <h3>Principais causas</h3>
                <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                  Clique para filtrar o restante dos indicadores e a lista.
                </p>
                <div className="bar-list">
                  {(kpis.porCausa || []).slice(0, 10).map((g) => {
                    const max = kpis.porCausa[0]?.n || 1;
                    const causaId = causas.find((c) => c.nome === g.k)?.id || '';
                    const on = !!causaId && filtros.causa === causaId;
                    return (
                      <button
                        type="button"
                        className={`bar-row clickable${on ? ' on' : ''}`}
                        key={g.k}
                        disabled={!causaId}
                        aria-pressed={on}
                        onClick={() => causaId && toggleFiltro({ causa: causaId })}
                      >
                        <div className="name" title={g.k}>
                          {g.k}
                        </div>
                        <div className="bar-track">
                          <i style={{ width: `${Math.max(4, (g.n / max) * 100)}%` }} />
                        </div>
                        <div className="bar-meta">
                          {g.n} · {brl(g.custo)}
                        </div>
                      </button>
                    );
                  })}
                </div>
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
                    <th>Setor fab.</th>
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
                        <span className="tag" title="Setor de fabricação">
                          {r.setor || '—'}
                        </span>
                      </td>
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
                  <button
                    className="small"
                    onClick={() => api(`/alertas/${a.id}/resolver`, { method: 'POST' }).then(() => refresh())}
                  >
                    Resolver
                  </button>
                  <button
                    className="small"
                    onClick={() => api(`/alertas/${a.id}/ignorar`, { method: 'POST' }).then(() => refresh())}
                  >
                    Ignorar
                  </button>
                </div>
              </div>
            ))}
            {!alertas.length ? <div className="card muted">Nenhum alerta aberto.</div> : null}
          </>
        ) : null}

        {tab === 'qualidade' ? (
          <>
            <div className="subnav">
              {(
                [
                  ['painel', 'Painel INMETRO'],
                  ['importar', 'Importar vendas'],
                  ['planos', 'Planos de ação'],
                ] as const
              ).map(([s, label]) => (
                <button key={s} className={qualSub === s ? 'on' : ''} onClick={() => setQualSub(s)}>
                  {label}
                </button>
              ))}
              <span className="spacer" />
              <button
                className="small"
                onClick={() =>
                  downloadAuthed(
                    `/qualidade/exportar?${qs}`,
                    `qualidade_${filtros.de || 'inicio'}_${filtros.ate || 'hoje'}.csv`,
                  )
                    .then(() => setMsg('CSV de auditoria baixado.'))
                    .catch((e) => setMsg(e.message))
                }
              >
                Exportar auditoria CSV
              </button>
            </div>

            {qualSub === 'importar' ? (
              <div className="card">
                <h3>Importar vendas (COD · Descrição · DATA · QTDE)</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Cole a planilha (tab ou CSV) no formato do ERP. Datas em DD/MM/AAAA. Reimportar o mesmo
                  dia/SKU sobrescreve a quantidade.
                </p>
                <div className="tools">
                  <label className="small" style={{ cursor: 'pointer' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        border: '1px solid var(--line)',
                        borderRadius: 5,
                        background: '#fff',
                      }}
                    >
                      Escolher arquivo
                    </span>
                    <input
                      type="file"
                      accept=".txt,.csv,.tsv,text/plain"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const text = await f.text();
                        setVendaTexto(text);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {ehGestor ? null : (
                    <span className="muted">Somente gestor/master confirma a importação.</span>
                  )}
                </div>
                <textarea
                  value={vendaTexto}
                  onChange={(e) => setVendaTexto(e.target.value)}
                  rows={12}
                  placeholder={'COD\tDescrição\tDATA\tQTDE\nA70\tEMBALADORA...\t01/06/2026\t22'}
                  style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                />
                <div className="tools">
                  <button
                    onClick={async () => {
                      try {
                        const p = await api<NonNullable<typeof vendaPreview>>('/qualidade/vendas/preview', {
                          method: 'POST',
                          json: { texto: vendaTexto },
                        });
                        setVendaPreview(p);
                        setMsg(`Preview: ${p.linhas} linhas · ${p.skus} SKUs · ${p.totalQtde} un.`);
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : 'Erro no preview');
                      }
                    }}
                  >
                    Pré-visualizar
                  </button>
                  {ehGestor ? (
                    <button
                      className="primary"
                      disabled={!vendaTexto.trim()}
                      onClick={async () => {
                        try {
                          const r = await api<{
                            linhas: number;
                            skus: number;
                            totalQtde: number;
                            de: string;
                            ate: string;
                            avisosTotal: number;
                          }>('/qualidade/vendas/importar', {
                            method: 'POST',
                            json: { texto: vendaTexto },
                          });
                          setMsg(
                            `Importado: ${r.linhas} linhas · ${r.skus} SKUs · ${r.totalQtde} un. (${r.de} → ${r.ate})` +
                              (r.avisosTotal ? ` · ${r.avisosTotal} avisos` : ''),
                          );
                          setVendaPreview(null);
                          setQualSub('painel');
                          await loadQualidade();
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : 'Erro ao importar');
                        }
                      }}
                    >
                      Confirmar importação
                    </button>
                  ) : null}
                </div>
                {vendaPreview ? (
                  <div className="kpi-insight" style={{ marginTop: 12 }}>
                    <b>{vendaPreview.linhas}</b> linhas · <b>{vendaPreview.skus}</b> SKUs ·{' '}
                    <b>{vendaPreview.totalQtde}</b> unidades · período {vendaPreview.de || '—'} a{' '}
                    {vendaPreview.ate || '—'}
                    {vendaPreview.avisosTotal ? (
                      <>
                        <br />
                        <span style={{ color: 'var(--alerta)' }}>
                          {vendaPreview.avisosTotal} avisos (ex.: {vendaPreview.avisos.slice(0, 3).join(' · ')})
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {qualSub === 'painel' && qualPainel ? (
              <>
                <div className="kpi-hero">
                  <div className="kpi-panel">
                    <h3>Itens vendidos</h3>
                    <div className="kpi-big" style={{ fontSize: 28 }}>
                      {qualPainel.totais.vendas.toLocaleString('pt-BR')}
                    </div>
                    <div className="kpi-big-label">
                      {qualPainel.vendasResumo.skus} SKUs na base ·{' '}
                      {qualPainel.vendasResumo.de
                        ? `${qualPainel.vendasResumo.de} → ${qualPainel.vendasResumo.ate}`
                        : 'importe vendas'}
                    </div>
                  </div>
                  <div className="kpi-panel">
                    <h3>Reclamações ({qualPainel.modoContagem})</h3>
                    <div className="kpi-big" style={{ fontSize: 28 }}>
                      {qualPainel.totais.reclamacoes.toLocaleString('pt-BR')}
                    </div>
                    <div className="kpi-big-label">
                      taxa {fmtTaxa(qualPainel.totais.taxa)} · limite {qualPainel.limitePpm} ppm
                    </div>
                  </div>
                  <div className="kpi-panel">
                    <h3>Coeficiente (INMETRO)</h3>
                    <div className="kpi-big" style={{ fontSize: 26 }}>
                      {fmtPpm(qualPainel.totais.ppm)}
                    </div>
                    <div
                      className={`kpi-meter ${
                        qualPainel.totais.ppm != null && qualPainel.totais.ppm > qualPainel.limitePpm
                          ? 'warn'
                          : ''
                      }`}
                    >
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            qualPainel.totais.ppm != null
                              ? (qualPainel.totais.ppm / Math.max(qualPainel.limitePpm * 2, 1)) * 100
                              : 0,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="kpi-big-label">
                      {qualPainel.totais.acimaLimite} SKUs acima do limite
                      {qualPainel.totais.pctAcimaLimite != null
                        ? ` (${qualPainel.totais.pctAcimaLimite}%)`
                        : ''}
                      {qualPainel.totais.semVenda
                        ? ` · ${qualPainel.totais.semVenda} sem venda no período`
                        : ''}
                    </div>
                  </div>
                </div>

                <div className="grid2">
                  <div className="card">
                    <h3>Top defeitos por SKU (ppm)</h3>
                    <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                      Clique para filtrar o SAC · Abrir plano cria tratativa de qualidade.
                    </p>
                    {!qualPainel.topDefeitos.length ? (
                      <p className="muted">Sem reclamações no período (ou importe vendas).</p>
                    ) : (
                      <div className="tablewrap">
                        <table className="list">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Vendas</th>
                              <th>Rec.</th>
                              <th>ppm</th>
                              <th>Fab.</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {qualPainel.topDefeitos.map((g) => (
                              <tr key={g.sku}>
                                <td>
                                  <button
                                    type="button"
                                    className="linkish"
                                    onClick={() => {
                                      toggleFiltro({ sku: g.sku });
                                      setTab('lista');
                                    }}
                                  >
                                    <b>{g.sku}</b>
                                  </button>
                                  <br />
                                  <span className="muted">{g.produto}</span>
                                  {g.acimaLimite ? (
                                    <span className="tag aguard" style={{ marginLeft: 6 }}>
                                      acima
                                    </span>
                                  ) : null}
                                  {g.semVenda ? (
                                    <span className="tag" style={{ marginLeft: 6 }}>
                                      sem venda
                                    </span>
                                  ) : null}
                                </td>
                                <td>{g.vendas}</td>
                                <td>{g.reclamacoes}</td>
                                <td>{fmtPpm(g.ppm)}</td>
                                <td>{g.setorFab || '—'}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="small"
                                    onClick={() => {
                                      setNovoPlano({
                                        titulo: `Reduzir defeitos ${g.sku}`,
                                        descricao: `${g.reclamacoes} reclamações / ${g.vendas} vendas (${fmtPpm(g.ppm)})`,
                                        sku: g.sku,
                                        setorFab: g.setorFab,
                                        setorResp: g.setorResp,
                                        responsavel: '',
                                        prazo: '',
                                      });
                                      setQualSub('planos');
                                    }}
                                  >
                                    Abrir plano
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  <div className="card">
                    <h3>Setor de fabricação</h3>
                    <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
                      Relatório para falar com responsáveis da fábrica.
                    </p>
                    <div className="bar-list">
                      {(qualPainel.porSetorFab || []).slice(0, 12).map((g) => {
                        const max = Math.max(1, ...(qualPainel.porSetorFab || []).map((x) => x.reclamacoes));
                        const on = filtros.setor === g.k;
                        return (
                          <button
                            type="button"
                            key={g.k}
                            className={`bar-row clickable${on ? ' on' : ''}`}
                            aria-pressed={on}
                            onClick={() => toggleFiltro({ setor: g.k })}
                          >
                            <div className="name" title={g.k}>
                              Setor {g.k}
                              {g.acimaLimite ? ' · crítico' : ''}
                            </div>
                            <div className="bar-track fab">
                              <i style={{ width: `${Math.max(4, (g.reclamacoes / max) * 100)}%` }} />
                            </div>
                            <div className="bar-meta">
                              {g.reclamacoes} rec · {fmtPpm(g.ppm)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {filtros.setor ? (
                      <div className="kpi-actions">
                        <button type="button" className="small" onClick={() => setTab('lista')}>
                          Ver reclamações
                        </button>
                        <button
                          type="button"
                          className="small primary"
                          onClick={() => {
                            setNovoPlano((p) => ({
                              ...p,
                              titulo: `Plano qualidade setor ${filtros.setor}`,
                              setorFab: filtros.setor,
                            }));
                            setQualSub('planos');
                          }}
                        >
                          Plano do setor
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card" style={{ marginTop: 12 }}>
                  <h3>Planos abertos ({qualPainel.planosAbertos})</h3>
                  {!qualPainel.planos.length ? (
                    <p className="muted">Nenhum plano em andamento.</p>
                  ) : (
                    <ul className="plano-list">
                      {qualPainel.planos.map((p) => (
                        <li key={p.id}>
                          <b>{p.titulo}</b>
                          <span className="muted">
                            {' '}
                            · {p.sku || '—'} · fab. {p.setorFab || '—'} · {p.status}
                            {p.prazo ? ` · prazo ${p.prazo}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}

            {qualSub === 'painel' && !qualPainel ? (
              <div className="card muted">Carregando painel de qualidade…</div>
            ) : null}

            {qualSub === 'planos' ? (
              <div className="card">
                <h3>Planos de ação</h3>
                {ehGestor || user.perfil === 'operador' ? (
                  <div className="fgrid" style={{ marginBottom: 16 }}>
                    <div className="field s2">
                      <label>Título</label>
                      <input
                        value={novoPlano.titulo}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, titulo: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label>SKU</label>
                      <input
                        value={novoPlano.sku}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, sku: e.target.value.toUpperCase() }))}
                      />
                    </div>
                    <div className="field">
                      <label>Setor fab.</label>
                      <input
                        value={novoPlano.setorFab}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, setorFab: e.target.value }))}
                      />
                    </div>
                    <div className="field s2">
                      <label>Descrição</label>
                      <input
                        value={novoPlano.descricao}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, descricao: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label>Responsável</label>
                      <input
                        value={novoPlano.responsavel}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, responsavel: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label>Prazo</label>
                      <input
                        type="date"
                        value={novoPlano.prazo}
                        onChange={(e) => setNovoPlano((p) => ({ ...p, prazo: e.target.value }))}
                      />
                    </div>
                    <div className="field s4">
                      <button
                        className="primary"
                        onClick={async () => {
                          try {
                            await api('/qualidade/planos', {
                              method: 'POST',
                              json: { ...novoPlano, origem: novoPlano.sku ? 'kpi' : 'manual' },
                            });
                            setNovoPlano({
                              titulo: '',
                              descricao: '',
                              sku: '',
                              setorFab: '',
                              setorResp: '',
                              responsavel: '',
                              prazo: '',
                            });
                            setMsg('Plano criado.');
                            await loadQualidade();
                          } catch (e) {
                            setMsg(e instanceof Error ? e.message : 'Erro');
                          }
                        }}
                      >
                        Salvar plano
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="tablewrap">
                  <table className="list">
                    <thead>
                      <tr>
                        <th>Título</th>
                        <th>SKU</th>
                        <th>Fab.</th>
                        <th>Resp.</th>
                        <th>Prazo</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualPlanos.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <b>{p.titulo}</b>
                            {p.descricao ? (
                              <>
                                <br />
                                <span className="muted">{p.descricao}</span>
                              </>
                            ) : null}
                          </td>
                          <td>{p.sku || '—'}</td>
                          <td>{p.setorFab || '—'}</td>
                          <td>{p.responsavel || '—'}</td>
                          <td>{p.prazo || '—'}</td>
                          <td>
                            <select
                              value={p.status}
                              onChange={async (e) => {
                                try {
                                  await api(`/qualidade/planos/${p.id}`, {
                                    method: 'PATCH',
                                    json: { status: e.target.value },
                                  });
                                  await loadQualidade();
                                } catch (err) {
                                  setMsg(err instanceof Error ? err.message : 'Erro');
                                }
                              }}
                            >
                              <option value="aberto">Aberto</option>
                              <option value="em_andamento">Em andamento</option>
                              <option value="concluido">Concluído</option>
                              <option value="cancelado">Cancelado</option>
                            </select>
                          </td>
                          <td>
                            {p.sku ? (
                              <button
                                type="button"
                                className="small"
                                onClick={() => {
                                  toggleFiltro({ sku: p.sku });
                                  setTab('lista');
                                }}
                              >
                                Ver SAC
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!qualPlanos.length ? <p className="muted">Nenhum plano cadastrado.</p> : null}
                </div>
              </div>
            ) : null}
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
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await api('/gestao/usuarios', { method: 'POST', json: novoUser });
                        setNovoUser({ login: '', nome: '', senha: '', perfil: 'operador' });
                        setMsg('Usuário criado.');
                        await loadGestao();
                      }}
                    >
                      <div className="fgrid" style={{ marginBottom: 10 }}>
                        <div className="field">
                          <label htmlFor="nu-login">Login</label>
                          <input
                            id="nu-login"
                            required
                            value={novoUser.login}
                            onChange={(e) => setNovoUser((u) => ({ ...u, login: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="nu-nome">Nome</label>
                          <input
                            id="nu-nome"
                            required
                            value={novoUser.nome}
                            onChange={(e) => setNovoUser((u) => ({ ...u, nome: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="nu-senha">Senha</label>
                          <input
                            id="nu-senha"
                            type="password"
                            required
                            minLength={4}
                            value={novoUser.senha}
                            onChange={(e) => setNovoUser((u) => ({ ...u, senha: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="nu-perfil">Perfil</label>
                          <select
                            id="nu-perfil"
                            value={novoUser.perfil}
                            onChange={(e) => setNovoUser((u) => ({ ...u, perfil: e.target.value }))}
                          >
                            <option value="operador">Operador</option>
                            <option value="gestor">Gestor</option>
                            {user.perfil === 'master' ? <option value="master">Master</option> : null}
                          </select>
                        </div>
                      </div>
                      <button className="primary" type="submit">
                        Criar usuário
                      </button>
                    </form>
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
                    aria-label="Buscar produtos"
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
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reclamacao-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dhead" id="reclamacao-dialog-title">
              {editId ? 'Editar reclamação' : 'Nova reclamação'}
            </div>
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
                <div className="secao">Anexos (fotos e documentos)</div>
                <div
                  className={`anexos-drop${anexoDrop ? ' over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setAnexoDrop(true);
                  }}
                  onDragLeave={() => setAnexoDrop(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setAnexoDrop(false);
                    addPendingFiles(e.dataTransfer.files);
                  }}
                >
                  <div className="anexos-bar">
                    <label style={{ cursor: 'pointer', margin: 0 }}>
                      <span className="small" style={{
                        display: 'inline-block',
                        padding: '3px 9px',
                        fontSize: 13,
                        border: '1px solid var(--line)',
                        borderRadius: 5,
                        background: '#fff',
                      }}>
                        Escolher arquivos
                      </span>
                      <input
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          addPendingFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <span className="help" style={{ margin: 0 }}>
                      Arraste imagens ou docs aqui · máx. 15 MB · salvos ao clicar em Salvar
                    </span>
                  </div>
                  <div className="anexos-lista">
                    {anexos.map((a) => (
                      <div key={a.id} className="anexo-card">
                        {isImageName(a.nome) || isImageName(a.path) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={uploadUrl(a.path)} alt={a.nome} />
                        ) : (
                          <div className="doc">{(a.nome.split('.').pop() || 'DOC').toUpperCase()}</div>
                        )}
                        <span className="nm" title={a.nome}>
                          {a.nome}
                        </span>
                        <button type="button" className="fx" title="Remover" onClick={() => void removerAnexo(a.id)}>
                          ×
                        </button>
                      </div>
                    ))}
                    {pendingFiles.map((p) => (
                      <div key={p.key} className="anexo-card">
                        {p.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.preview} alt={p.file.name} />
                        ) : (
                          <div className="doc">{(p.file.name.split('.').pop() || 'DOC').toUpperCase()}</div>
                        )}
                        <span className="nm" title={p.file.name}>
                          {p.file.name} (novo)
                        </span>
                        <button type="button" className="fx" title="Remover" onClick={() => removePending(p.key)}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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
