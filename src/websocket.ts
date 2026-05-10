import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { logger } from './logger.js';

let activeConnections = 0;

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: ['https://firmas.moacrm.com', 'https://sacierp.moacrm.com'],
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    activeConnections++;
    logger.info({ socketId: socket.id, connections: activeConnections }, 'ws: client connected');

    socket.on('join', (channel: string) => {
      if (typeof channel === 'string' && channel) {
        void socket.join(channel);
        logger.debug({ socketId: socket.id, channel }, 'ws: client joined room');
      }
    });

    socket.on('disconnect', () => {
      activeConnections--;
      logger.info({ socketId: socket.id, connections: activeConnections }, 'ws: client disconnected');
    });
  });

  return io;
}

export function getConnectionCount(): number {
  return activeConnections;
}
