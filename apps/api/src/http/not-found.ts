import type { Request, Response } from 'express';
import { ERROR_HTTP_STATUS } from '@secure360/shared';
import { toErrorEnvelope } from './error-envelope';

export function handleNotFound(req: Request, res: Response): void {
  res
    .status(ERROR_HTTP_STATUS.NOT_FOUND)
    .json(toErrorEnvelope('NOT_FOUND', req.get('accept-language')));
}
