'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro('');
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const res = await api<{ token: string; user: unknown }>('/auth/login', {
        method: 'POST',
        json: { login: fd.get('login'), senha: fd.get('senha') },
      });
      setSession(res.token, res.user);
      router.replace('/');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>SAC — Reclamações e KPIs</h1>
        <p>AISA em nuvem · Entre com usuário e senha</p>
        <label>
          Usuário
          <input name="login" autoComplete="username" required />
        </label>
        <label>
          Senha
          <input name="senha" type="password" autoComplete="current-password" required />
        </label>
        <div className="erro">{erro}</div>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
