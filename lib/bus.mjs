// Each server keeps its own rooms. Redis carries invalidations across servers.
export function createLiveRooms(loadAccess) {
  const rooms = new Map();

  function subscribe(projectId, ws, tokenHash) {
    let room = rooms.get(projectId);
    if (!room) {
      room = new Map();
      rooms.set(projectId, room);
    }
    room.set(ws, { ws, projectId, tokenHash });
    ws.on("close", () => {
      room.delete(ws);
      if (room.size === 0) rooms.delete(projectId);
    });
  }

  async function check(entries, onAllowed) {
    const open = entries.filter(({ ws }) => ws.readyState === ws.OPEN);
    if (open.length === 0) return;

    let access;
    try {
      access = await loadAccess(open);
    } catch (error) {
      for (const { ws } of open) ws.close(1013, "Authorization unavailable");
      throw error;
    }
    for (const [index, { ws }] of open.entries()) {
      if (ws.readyState !== ws.OPEN) continue;
      if (access[index]?.can_view) onAllowed?.(ws);
      else ws.close(1008, "Project access revoked");
    }
  }

  async function broadcast(projectId, message) {
    const room = rooms.get(projectId);
    if (!room?.size) return;
    const text = JSON.stringify(message);
    await check([...room.values()], (ws) => ws.send(text));
  }

  function revalidate() {
    return check([...rooms.values()].flatMap((room) => [...room.values()]));
  }

  return { subscribe, broadcast, revalidate };
}
