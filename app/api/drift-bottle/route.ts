import { NextRequest, NextResponse } from "next/server";
import {
  throwBottle,
  pickBottle,
  replyToBottle,
  getInbox,
  getBottleCount,
} from "@/lib/bottleStore";
import { isEnglishOnlyBottleContent } from "@/lib/bottleValidation";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === "throw") {
    const { userId, senderName, senderGrade, content, audioBase64, mimeType } = body;
    if (!userId || !senderName || !content?.trim()) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }
    if (!isEnglishOnlyBottleContent(content)) {
      return NextResponse.json(
        { error: "Bottle content must be English" },
        { status: 400 }
      );
    }
    const bottle = throwBottle({
      userId,
      senderName,
      senderGrade: senderGrade || 1,
      content: content.trim(),
      audioBase64: audioBase64 || undefined,
      mimeType: mimeType || undefined,
    });
    return NextResponse.json({ ok: true, bottleId: bottle.id });
  }

  if (action === "pick") {
    const { userId } = body;
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    const bottle = pickBottle(userId);
    if (!bottle) {
      return NextResponse.json({
        ok: false,
        message: "海里暂时没有瓶子，试试扔一个吧！",
      });
    }
    return NextResponse.json({ ok: true, bottle });
  }

  if (action === "reply") {
    const { bottleId, userId, userName, content } = body;
    if (!bottleId || !userId || !userName || !content?.trim()) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }
    const ok = replyToBottle({
      bottleId,
      userId,
      userName,
      content: content.trim(),
    });
    return NextResponse.json({ ok });
  }

  if (action === "inbox") {
    const { userId } = body;
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    const bottles = getInbox(userId);
    return NextResponse.json({ ok: true, bottles });
  }

  if (action === "count") {
    return NextResponse.json({ ok: true, count: getBottleCount() });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
