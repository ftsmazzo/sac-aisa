import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PrismaService } from '../prisma.service';
import { FilaService } from '../infra/fila.service';

const execFileAsync = promisify(execFile);

export type BackupItem = {
  nome: string;
  criadoEm: string;
  tamanhoBytes: number;
  tamanhoLabel: string;
};

@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);
  private readonly maxArquivos = Number(process.env.BACKUP_RETENTION || 20);

  constructor(
    private prisma: PrismaService,
    private fila: FilaService,
  ) {}

  private dir() {
    const d = process.env.BACKUP_DIR || '/data/backups';
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    return d;
  }

  private safeName(nome: string) {
    if (!/^sac-\d{8}-\d{6}\.dump$/.test(nome)) {
      throw new BadRequestException('Nome de backup inválido');
    }
    return nome;
  }

  private formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  listar(): { ultimo: BackupItem | null; backups: BackupItem[]; pasta: string } {
    const pasta = this.dir();
    const backups = readdirSync(pasta)
      .filter((f) => /^sac-\d{8}-\d{6}\.dump$/.test(f))
      .map((nome) => {
        const st = statSync(join(pasta, nome));
        return {
          nome,
          criadoEm: st.mtime.toISOString(),
          tamanhoBytes: st.size,
          tamanhoLabel: this.formatBytes(st.size),
        };
      })
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return { ultimo: backups[0] || null, backups, pasta };
  }

  /** Prisma usa ?schema=public; pg_dump não aceita esse query param. */
  private connectionUrl() {
    const raw = process.env.DATABASE_URL?.trim();
    if (!raw) throw new ServiceUnavailableException('DATABASE_URL não configurada');
    try {
      const u = new URL(raw);
      u.search = '';
      return u.toString();
    } catch {
      return raw.split('?')[0];
    }
  }

  async criar(origem = 'admin'): Promise<BackupItem> {
    const url = this.connectionUrl();

    const pasta = this.dir();
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const nome = `sac-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}.dump`;
    const destino = join(pasta, nome);

    await this.fila.enfileirar('backup_dump', { origem, nome });

    try {
      const { stderr } = await execFileAsync(
        'pg_dump',
        [
          `--dbname=${url}`,
          '--no-owner',
          '--no-acl',
          '--format=custom',
          `--file=${destino}`,
        ],
        { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      );
      if (stderr?.trim()) this.log.warn(`pg_dump stderr: ${stderr.slice(0, 500)}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.log.error(`pg_dump falhou: ${detail}`);
      if (existsSync(destino)) {
        try {
          unlinkSync(destino);
        } catch {
          /* ignore */
        }
      }
      throw new ServiceUnavailableException(
        `Não foi possível gerar o dump (${detail.slice(0, 180)}). Verifique postgresql-client na imagem e o banco.`,
      );
    }

    this.podar();
    const st = statSync(destino);
    return {
      nome,
      criadoEm: st.mtime.toISOString(),
      tamanhoBytes: st.size,
      tamanhoLabel: this.formatBytes(st.size),
    };
  }

  private podar() {
    const { backups } = this.listar();
    for (const velho of backups.slice(this.maxArquivos)) {
      try {
        unlinkSync(join(this.dir(), velho.nome));
      } catch (e) {
        this.log.warn(`Falha ao apagar backup antigo ${velho.nome}: ${e}`);
      }
    }
  }

  caminhoDownload(nome: string) {
    const safe = this.safeName(nome);
    const path = join(this.dir(), safe);
    if (!existsSync(path)) throw new NotFoundException('Backup não encontrado');
    return path;
  }

  streamDownload(nome: string) {
    return createReadStream(this.caminhoDownload(nome));
  }

  /** Snapshot JSON legado (Dropbox) — mantido só para migração pontual. */
  async gerarJsonLegado() {
    await this.fila.enfileirar('backup_json_legado', { origem: 'admin' });
    const [
      usuarios,
      produtos,
      causas,
      regras,
      reclamacoes,
      auditoria,
      config,
      alertas,
      destinos,
      vendas,
      planos,
      depara,
      permissoes,
    ] = await Promise.all([
      this.prisma.usuario.findMany({
        select: {
          id: true,
          login: true,
          nome: true,
          perfil: true,
          ativo: true,
          telefone: true,
          criadoEm: true,
        },
      }),
      this.prisma.produto.findMany(),
      this.prisma.causa.findMany(),
      this.prisma.regraDirecionamento.findMany(),
      this.prisma.reclamacao.findMany({
        include: { fotos: true, causas: { orderBy: { ordem: 'asc' } } },
      }),
      this.prisma.auditoria.findMany({ orderBy: { ts: 'desc' }, take: 5000 }),
      this.prisma.config.findMany(),
      this.prisma.alerta.findMany(),
      this.prisma.alertaDestino.findMany(),
      this.prisma.vendaDia.findMany(),
      this.prisma.planoAcao.findMany(),
      this.prisma.skuDepara.findMany(),
      this.prisma.permissaoUsuario.findMany(),
    ]);

    return {
      meta: {
        sistema: 'AISA SAC',
        geradoEm: new Date().toISOString(),
        tipo: 'backup-json-legado',
        aviso: 'Legado. Prefira o dump .dump da lista de backups do Admin.',
        contagens: {
          usuarios: usuarios.length,
          produtos: produtos.length,
          reclamacoes: reclamacoes.length,
          vendas: vendas.length,
          auditoria: auditoria.length,
        },
      },
      usuarios,
      produtos,
      causas,
      regras,
      reclamacoes,
      auditoria,
      config,
      alertas,
      destinos,
      vendas,
      planos,
      depara,
      permissoes,
    };
  }
}
