import { Server as IOServer, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: IOServer | null = null;

export type CashierSocketAuth = {
  userId: string;
  companyId: string;
  currentBranchId: string | null;
};

function roomCashier(companyId: string, branchId: string) {
  return `restaurant:cashier:${companyId}:${branchId}`;
}

function roomCompany(companyId: string) {
  return `system:company:${companyId}`;
}

function roomBranch(companyId: string, branchId: string) {
  return `system:branch:${companyId}:${branchId}`;
}

export function roomPublic(publicToken: string) {
  return `restaurant:public:${publicToken}`;
}

export function roomSession(sessionId: string) {
  return `restaurant:session:${sessionId}`;
}

export function initRestaurantSocket(httpServer: any, jwtSecret: string) {
  if (io) return io;
  io = new IOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use((socket: Socket, next) => {
    const auth = (socket.handshake.auth || {}) as Record<string, unknown>;
    const token = typeof auth.token === 'string' ? auth.token : typeof auth.jwt === 'string' ? auth.jwt : '';
    const publicToken = typeof auth.publicToken === 'string' ? auth.publicToken.trim() : '';
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret) as any;
        const companyId = String(payload.companyId || '').trim();
        const branchId = String(payload.currentBranchId || '').trim();
        const userId = String(payload.id || '').trim();
        if (!userId || !companyId) return next(new Error('UNAUTH'));
        (socket.data as any).cashier = { userId, companyId, currentBranchId: branchId || null } as CashierSocketAuth;
        return next();
      } catch {
        return next(new Error('UNAUTH'));
      }
    }
    if (publicToken.length >= 16) {
      (socket.data as any).publicToken = publicToken;
      return next();
    }
    return next(new Error('NO_AUTH'));
  });

  io.on('connection', (socket: Socket) => {
    const cashier = (socket.data as any).cashier as CashierSocketAuth | undefined;
    const pub = (socket.data as any).publicToken as string | undefined;
    if (cashier?.companyId && cashier.currentBranchId) {
      socket.join(roomCashier(cashier.companyId, cashier.currentBranchId));
    }
    if (cashier?.companyId) {
      socket.join(roomCompany(cashier.companyId));
      if (cashier.currentBranchId) {
        socket.join(roomBranch(cashier.companyId, cashier.currentBranchId));
      }
    }
    if (pub) {
      socket.join(roomPublic(pub));
    }
    socket.on('restaurant:join-session', (sessionId: unknown) => {
      if (typeof sessionId === 'string' && sessionId.startsWith('rses-')) {
        socket.join(roomSession(sessionId));
      }
    });
  });

  return io;
}

export function getRestaurantIo(): IOServer | null {
  return io;
}

export const restaurantEmit = {
  requestNew(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
    tableId: string;
    requestId: string;
    unreadCount: number;
    tableCode?: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:request-new', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:request-new', {
        requestId: payload.requestId,
        unreadCount: payload.unreadCount,
      });
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:request-new', payload);
  },

  sessionUpdated(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
    unreadCount: number;
    sessionStatus?: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:session-updated', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:session-updated', payload);
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:session-updated', payload);
  },

  requestSeen(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
    requestId: string;
    status: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:request-seen', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:request-seen', payload);
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:request-seen', payload);
  },

  requestAccepted(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
    requestId: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:request-accepted', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:request-accepted', payload);
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:request-accepted', payload);
  },

  requestRejected(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
    requestId: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:request-rejected', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:request-rejected', payload);
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:request-rejected', payload);
  },

  sessionClosed(payload: {
    companyId: string;
    branchId: string;
    publicToken: string | null;
    sessionId: string;
  }) {
    if (!io) return;
    if (payload.companyId && payload.branchId) {
      io.to(roomCashier(payload.companyId, payload.branchId)).emit('restaurant:session-closed', payload);
    }
    if (payload.publicToken) {
      io.to(roomPublic(payload.publicToken)).emit('restaurant:session-closed', payload);
    }
    io.to(roomSession(payload.sessionId)).emit('restaurant:session-closed', payload);
  },
};

export const systemEmit = {
  sync(payload: {
    companyId: string;
    branchId?: string | null;
    reason?: string;
    scope?: string;
  }) {
    if (!io) return;
    if (payload.companyId) {
      io.to(roomCompany(payload.companyId)).emit('system:sync', payload);
      if (payload.branchId) {
        io.to(roomBranch(payload.companyId, payload.branchId)).emit('system:sync', payload);
      }
    }
  },
};
