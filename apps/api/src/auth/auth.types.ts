import { Perfil } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  login: string;
  nome: string;
  perfil: Perfil;
}

export interface AuthUser extends JwtPayload {
  permissoes?: string[];
}
