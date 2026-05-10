import { verify } from 'jsonwebtoken';
import type { Socket } from 'socket.io';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function wsAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const secret = config.ws.jwtSecret;
  if (!secret) {
    logger.warn('WS_JWT_SECRET not set — rejecting WebSocket connection');
    next(new Error('unauthorized'));
    return;
  }

  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error('unauthorized'));
    return;
  }

  try {
    verify(token, secret);
    next();
  } catch {
    logger.warn({ id: socket.id }, 'invalid WebSocket JWT token');
    next(new Error('unauthorized'));
  }
}
