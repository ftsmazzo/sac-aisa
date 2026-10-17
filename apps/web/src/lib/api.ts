const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('sac_token') || '';
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem('sac_token', token);
  localStorage.setItem('sac_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('sac_token');
  localStorage.removeItem('sac_user');
}

export function getUser<T = { login: string; nome: string; perfil: string }>() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('sac_user') || 'null') as T | null;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${API}${path}`, { ...opts, headers, body });
  if (opts.signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/login')) {
    clearSession();
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Erro ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function uploadFile<T = unknown>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body });
  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession();
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Erro ${res.status}`);
  }
  return res.json();
}

export function uploadUrl(relativePath: string) {
  if (!relativePath) return '';
  if (relativePath.startsWith('http')) return relativePath;
  return `${API}/uploads/${relativePath.replace(/^\/+/, '')}`;
}

export async function downloadAuthed(path: string, filename: string) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    clearSession();
    window.location.href = '/login';
    throw new Error('Não autorizado');
  }
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export { API };
