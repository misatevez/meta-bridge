import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { logger } from './logger.js';

let connectionCount = 0;

export function attachWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: 'https://firmas.moacrm.com',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    connectionCount++;
    logger.info({ socketId: socket.id, total: connectionCount }, 'ws: client connected');

    socket.on('disconnect', () => {
      connectionCount--;
      logger.info({ socketId: socket.id, total: connectionCount }, 'ws: client disconnected');
    });
  });

  return io;
}

export function getConnectionCount(): number {
  return connectionCount;
}
