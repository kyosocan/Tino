export type DriftBottle = {
  id: string;
  senderId: string;
  senderName: string;
  senderGrade: number;
  content: string;
  audioBase64?: string;
  mimeType?: string;
  createdAt: number;
  pickedBy?: string;
  pickedAt?: number;
  reply?: {
    content: string;
    repliedBy: string;
    repliedByName: string;
    repliedAt: number;
  };
};

type BottleStoreState = {
  bottles: DriftBottle[];
};

declare global {
  // eslint-disable-next-line no-var
  var __tinoBottleStore__: BottleStoreState | undefined;
}

const store =
  globalThis.__tinoBottleStore__ ??
  (globalThis.__tinoBottleStore__ = { bottles: [] });

const MAX_BOTTLES = 500;

export function throwBottle(params: {
  userId: string;
  senderName: string;
  senderGrade: number;
  content: string;
  audioBase64?: string;
  mimeType?: string;
}): DriftBottle {
  const bottle: DriftBottle = {
    id: `bottle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    senderId: params.userId,
    senderName: params.senderName,
    senderGrade: params.senderGrade,
    content: params.content,
    audioBase64: params.audioBase64,
    mimeType: params.mimeType,
    createdAt: Date.now(),
  };
  store.bottles.push(bottle);
  if (store.bottles.length > MAX_BOTTLES) {
    store.bottles = store.bottles.slice(-MAX_BOTTLES);
  }
  return bottle;
}

export function pickBottle(userId: string): DriftBottle | null {
  const available = store.bottles.filter(
    (b) => b.senderId !== userId && !b.pickedBy
  );
  if (available.length === 0) return null;
  const idx = Math.floor(Math.random() * available.length);
  const bottle = available[idx];
  bottle.pickedBy = userId;
  bottle.pickedAt = Date.now();
  return bottle;
}

export function replyToBottle(params: {
  bottleId: string;
  userId: string;
  userName: string;
  content: string;
}): boolean {
  const bottle = store.bottles.find((b) => b.id === params.bottleId);
  if (!bottle || bottle.reply) return false;
  bottle.reply = {
    content: params.content,
    repliedBy: params.userId,
    repliedByName: params.userName,
    repliedAt: Date.now(),
  };
  return true;
}

export function getInbox(userId: string): DriftBottle[] {
  return store.bottles
    .filter((b) => b.senderId === userId && b.reply)
    .sort((a, b) => b.reply!.repliedAt - a.reply!.repliedAt)
    .slice(0, 20);
}

export function getBottleCount(): number {
  return store.bottles.filter((b) => !b.pickedBy).length;
}
