// Count connected player identities, excluding visitors, bots and retained reconnect sessions.
export function presenceStats(network, lobby) {
  const presence = { online: 0, lobby: 0, waiting: 0, playing: 0 };
  const seen = new Set();
  for (const conn of network.conns.values()) {
    const session = conn.session;
    if (conn.closing || !session?.connected || session.ws !== conn.ws || conn.ws.readyState !== 1 || seen.has(session.playerId)) continue;
    seen.add(session.playerId);
    presence.online++;
    const room = session.roomCode ? lobby.rooms.get(session.roomCode) : null;
    if (room?.match) presence.playing++;
    else if (room) presence.waiting++;
    else presence.lobby++;
  }
  return presence;
}
