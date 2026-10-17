import { Body, Controller, Post } from '@nestjs/common';
import { IaService } from './ia.service';

@Controller('ia')
export class IaController {
  constructor(private ia: IaService) {}

  @Post('classificar')
  classificar(
    @Body()
    body: {
      laudo?: string;
      reclamacao?: string;
      solucao?: string;
      sku?: string;
      produto?: string;
      causaId?: string;
      causaManual?: boolean;
      peca?: string;
    },
  ) {
    return this.ia.classificar(body);
  }

  @Post('foto')
  descrever(@Body() body: { base64: string; mime?: string }) {
    return this.ia.descreverFoto(body.base64, body.mime).then((descricao) => ({ descricao }));
  }
}
