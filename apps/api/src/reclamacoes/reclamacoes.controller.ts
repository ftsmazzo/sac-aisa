import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { ReclamacoesService } from './reclamacoes.service';
import { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';

const uploadRoot = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
  '.csv',
]);

function isImageExt(ext: string) {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext.toLowerCase());
}

@Controller()
export class ReclamacoesController {
  constructor(
    private service: ReclamacoesService,
    private prisma: PrismaService,
  ) {}

  @Get('reclamacoes')
  list(@Query() query: Record<string, string>) {
    return this.service.list(query);
  }

  @Get('kpis')
  kpis(@Query() query: Record<string, string>) {
    return this.service.kpis(query);
  }

  @Get('reclamacoes/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Get('reclamacoes/:id/parecidos')
  parecidos(@Param('id') id: string) {
    return this.service.parecidos(id);
  }

  @Post('reclamacoes')
  create(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    return this.service.create(body, req.user);
  }

  @Patch('reclamacoes/:id')
  update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user: AuthUser },
  ) {
    return this.service.update(id, body, req.user);
  }

  @Post('reclamacoes/:id/receber')
  receber(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.service.marcarRecebido(id, req.user);
  }

  @Roles('gestor', 'master')
  @Delete('reclamacoes/:id')
  remove(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.service.remove(id, req.user);
  }

  @Get('reclamacoes/:id/anexos')
  async listAnexos(@Param('id') id: string) {
    await this.service.get(id);
    return this.prisma.reclamacaoFoto.findMany({
      where: { reclamacaoId: id },
      orderBy: { criadoEm: 'asc' },
    });
  }

  /** Compat: /fotos e /anexos */
  @Post('reclamacoes/:id/fotos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, file, cb) => {
          const ext = (extname(file.originalname) || '').toLowerCase();
          const sub = isImageExt(ext) ? 'fotos' : 'docs';
          const dir = join(uploadRoot, sub);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext = (extname(file.originalname) || '.bin').toLowerCase();
          cb(null, `${randomBytes(8).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = (extname(file.originalname) || '').toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          return cb(new Error('Tipo de arquivo não permitido'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadFoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthUser },
  ) {
    return this.saveAnexo(id, file, req.user);
  }

  @Post('reclamacoes/:id/anexos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, file, cb) => {
          const ext = (extname(file.originalname) || '').toLowerCase();
          const sub = isImageExt(ext) ? 'fotos' : 'docs';
          const dir = join(uploadRoot, sub);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext = (extname(file.originalname) || '.bin').toLowerCase();
          cb(null, `${randomBytes(8).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = (extname(file.originalname) || '').toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          return cb(new Error('Tipo de arquivo não permitido'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAnexo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthUser },
  ) {
    return this.saveAnexo(id, file, req.user);
  }

  @Delete('reclamacoes/:id/anexos/:anexoId')
  async removeAnexo(
    @Param('id') id: string,
    @Param('anexoId') anexoId: string,
    @Req() req: { user: AuthUser },
  ) {
    await this.service.get(id);
    const foto = await this.prisma.reclamacaoFoto.findFirst({
      where: { id: anexoId, reclamacaoId: id },
    });
    if (!foto) throw new BadRequestException('Anexo não encontrado');
    const full = join(uploadRoot, foto.path);
    try {
      if (existsSync(full)) unlinkSync(full);
    } catch {
      /* ignore */
    }
    await this.prisma.reclamacaoFoto.delete({ where: { id: anexoId } });
    return { ok: true };
  }

  private async saveAnexo(id: string, file: Express.Multer.File, user: AuthUser) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    await this.service.get(id);
    const ext = (extname(file.originalname) || '').toLowerCase();
    const sub = isImageExt(ext) ? 'fotos' : 'docs';
    const foto = await this.prisma.reclamacaoFoto.create({
      data: {
        reclamacaoId: id,
        nome: file.originalname,
        path: `${sub}/${file.filename}`,
        kb: Math.round(file.size / 1024),
        criadoPor: user.login,
      },
    });
    return foto;
  }
}
