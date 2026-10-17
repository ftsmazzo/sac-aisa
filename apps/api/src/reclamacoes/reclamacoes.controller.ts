import {
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
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { ReclamacoesService } from './reclamacoes.service';
import { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/auth.guard';
import { PrismaService } from '../prisma.service';

const uploadRoot = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

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

  @Post('reclamacoes/:id/fotos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(uploadRoot, 'fotos');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const id = randomBytes(8).toString('hex');
          cb(null, `${id}${extname(file.originalname) || '.jpg'}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadFoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthUser },
  ) {
    await this.service.get(id);
    const foto = await this.prisma.reclamacaoFoto.create({
      data: {
        reclamacaoId: id,
        nome: file.originalname,
        path: `fotos/${file.filename}`,
        kb: Math.round(file.size / 1024),
        criadoPor: req.user.login,
      },
    });
    return foto;
  }
}
