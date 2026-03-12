export type QueueUser = {
  userId: string;
  name: string;
  grade: number;
  joinedAt: number;
};

export type RoomUser = {
  userId: string;
  name: string;
  grade: number;
};

export type RoomMessage = {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  audioBase64?: string;
  mimeType?: string;
};

export type Room = {
  id: string;
  users: RoomUser[];
  messages: RoomMessage[];
  createdAt: number;
  tinoGenerating: boolean;
  lastTinoAt: number;
};

type MatchStoreState = {
  waitingQueue: QueueUser[];
  rooms: Map<string, Room>;
  userRoomMap: Map<string, string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __tinoMatchStore__: MatchStoreState | undefined;
}

const store =
  globalThis.__tinoMatchStore__ ??
  (globalThis.__tinoMatchStore__ = {
    waitingQueue: [],
    rooms: new Map<string, Room>(),
    userRoomMap: new Map<string, string>(),
  });

const STALE_QUEUE_MS = 60_000;

function pruneStaleQueue() {
  const now = Date.now();
  store.waitingQueue = store.waitingQueue.filter(
    (u) => now - u.joinedAt < STALE_QUEUE_MS
  );
}

export function joinQueue(user: {
  userId: string;
  name: string;
  grade: number;
}): { matched: boolean; roomId?: string; partner?: RoomUser } {
  const existingRoomId = store.userRoomMap.get(user.userId);
  if (existingRoomId) {
    const room = store.rooms.get(existingRoomId);
    if (room) {
      const partner = room.users.find((u) => u.userId !== user.userId);
      return { matched: true, roomId: existingRoomId, partner };
    }
    store.userRoomMap.delete(user.userId);
  }

  store.waitingQueue = store.waitingQueue.filter((u) => u.userId !== user.userId);
  pruneStaleQueue();

  if (store.waitingQueue.length > 0) {
    const partner = store.waitingQueue.shift()!;
    const roomId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const room: Room = {
      id: roomId,
      users: [
        { userId: partner.userId, name: partner.name, grade: partner.grade },
        { userId: user.userId, name: user.name, grade: user.grade },
      ],
      messages: [],
      createdAt: Date.now(),
      tinoGenerating: false,
      lastTinoAt: 0,
    };

    const welcome: RoomMessage = {
      id: `msg_tino_welcome`,
      senderId: "tino",
      senderName: "Tino",
      content: `Hi ${partner.name} and ${user.name}! Welcome to the English Chat Room! I'm Tino, your English chat helper. Let's have fun chatting in English today! Say hi to each other! 🎉`,
      timestamp: Date.now(),
    };
    room.messages.push(welcome);

    store.rooms.set(roomId, room);
    store.userRoomMap.set(partner.userId, roomId);
    store.userRoomMap.set(user.userId, roomId);

    return {
      matched: true,
      roomId,
      partner: {
        userId: partner.userId,
        name: partner.name,
        grade: partner.grade,
      },
    };
  }

  store.waitingQueue.push({ ...user, joinedAt: Date.now() });
  return { matched: false };
}

export function checkMatch(
  userId: string
): { matched: boolean; roomId?: string; partner?: RoomUser } {
  const roomId = store.userRoomMap.get(userId);
  if (roomId) {
    const room = store.rooms.get(roomId);
    if (room) {
      const partner = room.users.find((u) => u.userId !== userId);
      return { matched: true, roomId, partner };
    }
  }
  return { matched: false };
}

export function leaveQueue(userId: string) {
  store.waitingQueue = store.waitingQueue.filter((u) => u.userId !== userId);
}

export function sendRoomMessage(
  roomId: string,
  senderId: string,
  senderName: string,
  content: string,
  audioBase64?: string,
  mimeType?: string
): RoomMessage | null {
  const room = store.rooms.get(roomId);
  if (!room) return null;

  const msg: RoomMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    senderId,
    senderName,
    content,
    timestamp: Date.now(),
    audioBase64,
    mimeType,
  };
  room.messages.push(msg);
  return msg;
}

export function addTinoMessage(
  roomId: string,
  content: string
): RoomMessage | null {
  const room = store.rooms.get(roomId);
  if (!room) return null;

  const msg: RoomMessage = {
    id: `msg_tino_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    senderId: "tino",
    senderName: "Tino",
    content,
    timestamp: Date.now(),
  };
  room.messages.push(msg);
  room.lastTinoAt = room.messages.filter((m) => m.senderId !== "tino").length;
  return msg;
}

export function getMessages(roomId: string, since: number): RoomMessage[] {
  const room = store.rooms.get(roomId);
  if (!room) return [];
  return room.messages.filter((m) => m.timestamp > since);
}

export function getRoom(roomId: string): Room | undefined {
  return store.rooms.get(roomId);
}

export function shouldTinoComment(roomId: string): boolean {
  const room = store.rooms.get(roomId);
  if (!room || room.tinoGenerating) return false;
  const userMsgCount = room.messages.filter(
    (m) => m.senderId !== "tino"
  ).length;
  return userMsgCount > 0 && userMsgCount % 4 === 0 && userMsgCount > room.lastTinoAt;
}

export function leaveRoom(userId: string) {
  const roomId = store.userRoomMap.get(userId);
  if (roomId) {
    store.userRoomMap.delete(userId);
    const room = store.rooms.get(roomId);
    if (room) {
      const otherUser = room.users.find((u) => u.userId !== userId);
      if (!otherUser || !store.userRoomMap.has(otherUser.userId)) {
        store.rooms.delete(roomId);
      }
    }
  }
  store.waitingQueue = store.waitingQueue.filter((u) => u.userId !== userId);
}
