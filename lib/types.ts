export type MessageSender = "user" | "tino" | "ai2" | "friend" | "system";

export type Message = {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: number;
};

export type AppMode = "companion" | "matching" | "room";

export type RoomPhase = "icebreaking" | "free_chat" | "game" | "summary";

export type VirtualFriend = {
  name: string;
  englishName: string;
  grade: number;
  likes: string[];
};
