export type MessageSender = "user" | "tino" | "friend" | "system";

export type Message = {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: number;
};

export type AppMode = "login" | "companion" | "matching" | "room" | "shop";

export type RoomPhase = "chatting" | "ending";

export type RoomPartner = {
  userId: string;
  name: string;
  grade: number;
};
