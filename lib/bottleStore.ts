export type DriftBottle = {
  id: string;
  senderId: string;
  senderName: string;
  senderGrade: number;
  content: string;
  audioBase64?: string;
  mimeType?: string;
  createdAt: number;
  /** 预设的虚拟小朋友瓶子，非真实用户投递 */
  isVirtual?: boolean;
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

/** 与真实 userId 不会冲突的虚拟投递者前缀 */
const VIRTUAL_SENDER_PREFIX = "__tino_virtual_kid__";

/** 海里至少保持的未捞虚拟瓶数量，捞完会再补 */
const MIN_UNPICKED_VIRTUAL = 10;

const VIRTUAL_KID_NAMES = [
  "小朵",
  "乐乐",
  "琪琪",
  "豆豆",
  "小雨",
  "阳阳",
  "米米",
  "诺诺",
  "糖糖",
  "天天",
  "阿杰",
  "萌萌",
];

const VIRTUAL_BOTTLE_TEMPLATES: { senderGrade: number; content: string }[] = [
  { senderGrade: 1, content: "Hi! I like drawing. What do you like?" },
  { senderGrade: 2, content: "Hello! My favorite animal is the panda. What is yours?" },
  { senderGrade: 2, content: "I am practicing English. Let's be friends!" },
  { senderGrade: 2, content: "Good morning! Today I learned the word \"friend\". Do you like school?" },
  { senderGrade: 3, content: "Hi from China! Where do you live?" },
  { senderGrade: 2, content: "I love stories. Do you like reading books?" },
  { senderGrade: 2, content: "My favorite food is noodles. What is your favorite food?" },
  { senderGrade: 1, content: "I want to say hello to someone new today. Hello!" },
  { senderGrade: 3, content: "Do you like music? I play the piano." },
  { senderGrade: 3, content: "I am a little shy, but I want to make new friends." },
  { senderGrade: 3, content: "The weather is nice today. How is the weather where you are?" },
  { senderGrade: 3, content: "I like English class. What subject do you like?" },
  { senderGrade: 3, content: "Happy weekend! What will you do this weekend?" },
  { senderGrade: 2, content: "I have a pet fish. Do you have a pet?" },
  { senderGrade: 2, content: "Tell me one English word you learned this week!" },
  { senderGrade: 2, content: "I like playing basketball after school. What sports do you like?" },
  { senderGrade: 1, content: "Nice to meet you! Can you say hello in English?" },
  { senderGrade: 3, content: "I want to travel to the sea one day. Have you seen the ocean?" },
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function createVirtualBottle(): DriftBottle {
  const tpl = randomPick(VIRTUAL_BOTTLE_TEMPLATES);
  const name = randomPick(VIRTUAL_KID_NAMES);
  return {
    id: `vbottle_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    senderId: `${VIRTUAL_SENDER_PREFIX}_${Math.random().toString(36).slice(2, 12)}`,
    senderName: name,
    senderGrade: tpl.senderGrade,
    content: tpl.content,
    createdAt: Date.now(),
    isVirtual: true,
  };
}

function countUnpickedVirtual(): number {
  return store.bottles.filter(
    (b) => !b.pickedBy && b.senderId.startsWith(VIRTUAL_SENDER_PREFIX)
  ).length;
}

/** 保证海里有足够的虚拟小朋友瓶子，便于冷启动或用户较少时也能捞到 */
export function ensureVirtualBottlePool(): void {
  while (countUnpickedVirtual() < MIN_UNPICKED_VIRTUAL) {
    store.bottles.push(createVirtualBottle());
    if (store.bottles.length > MAX_BOTTLES) {
      store.bottles = store.bottles.slice(-MAX_BOTTLES);
    }
  }
}

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
  ensureVirtualBottlePool();
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
  ensureVirtualBottlePool();
  return store.bottles.filter((b) => !b.pickedBy).length;
}
