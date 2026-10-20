import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { captureException } from './sentry';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('SentryFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      void captureException(exception);
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Erro interno' };

    res.status(status).json(typeof body === 'string' ? { message: body } : body);
  }
}
