import {
  joinQueue,
  checkMatch,
  leaveQueue,
  leaveRoom,
} from "@/lib/matchStore";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "join": {
        const { userId, name, grade } = body;
        if (!userId || !name) {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }
        const result = joinQueue({ userId, name, grade: grade || 0 });
        return Response.json(result);
      }

      case "status": {
        const { userId } = body;
        if (!userId) {
          return Response.json({ error: "missing userId" }, { status: 400 });
        }
        const result = checkMatch(userId);
        return Response.json(result);
      }

      case "leave": {
        const { userId } = body;
        if (userId) {
          leaveQueue(userId);
          leaveRoom(userId);
        }
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Match API Error]", error);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
