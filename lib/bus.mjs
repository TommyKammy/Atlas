// Live-room registry. Imported ONLY by server.js (plain Node runtime), never
// by Next route handlers: Next compiles routes into a separate module
// registry, so in-memory state would not be shared. Routes notify through
// POST /api/_notify (lib/notify.ts) instead.
const rooms = new Map();

export function subscribe(projectId, ws) {
  let room = rooms.get(projectId);
  if (!room) {
    room = new Set();
    rooms.set(projectId, room);
  }
  room.add(ws);
  ws.on("close", () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(projectId);
  });
}

export function broadcast(projectId, message) {
  const room = rooms.get(projectId);
  if (!room || room.size === 0) return 0;
  const text = JSON.stringify(message);
  let sent = 0;
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) {
      ws.send(text);
      sent += 1;
    }
  }
  return sent;
}
