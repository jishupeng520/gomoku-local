/**
 * 星星五子棋多人服务：提供静态页面、在线大厅、邀请房间和服务端落子校验。
 * 状态仅保存在当前进程内，适合 Render 免费单实例和临时聚会对战。
 */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const BOARD_SIZE = 15;
const PUBLIC_DIR = path.join(__dirname, 'public');
const sessions = new Map();
const rooms = new Map();
const pendingInvites = new Map();

/** @returns {string} 生成短的连接标识，避免在页面展示长 UUID。 */
function createId() { return crypto.randomBytes(5).toString('hex'); }

/** @returns {Array<Array<string|null>>} 创建一张没有落子的 15×15 棋盘。 */
function createBoard() { return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)); }

/** @returns {string} 获取优先级最高的局域网 IPv4 地址。 */
function getLanIp() {
  const all = Object.values(os.networkInterfaces()).flatMap((items) => items || []);
  const ips = all.filter((item) => item.family === 'IPv4' && !item.internal).map((item) => item.address);
  return ips.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip)) || ips[0] || '127.0.0.1';
}

/**
 * @param {number} row 行索引，0 至 14。
 * @param {number} col 列索引，0 至 14。
 * @returns {boolean} 坐标在棋盘内时返回 true。
 */
function isInside(row, col) { return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE; }

/**
 * @param {Array<Array<string|null>>} currentBoard 待检查的棋盘。
 * @param {number} row 最后一手的行索引。
 * @param {number} col 最后一手的列索引。
 * @param {'black'|'white'} color 要检查的棋色。
 * @returns {boolean} 任一方向连续五子时返回 true。
 */
function hasFive(currentBoard, row, col, color) {
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign; let c = col + dc * sign;
      while (isInside(r, c) && currentBoard[r][c] === color) { count += 1; r += dr * sign; c += dc * sign; }
    }
    return count >= 5;
  });
}

/** @param {Array<Array<string|null>>} currentBoard @returns {boolean} 棋盘无空位时返回 true。 */
function isDraw(currentBoard) { return currentBoard.every((row) => row.every((cell) => cell !== null)); }

/**
 * @param {import('ws').WebSocket} socket 目标连接。
 * @param {string} type 消息类型。
 * @param {object} payload 业务消息字段。
 * @returns {void}
 */
function send(socket, type, payload = {}) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, ...payload })); }

/** @param {import('ws').WebSocket} socket @param {string} message @returns {void} 向连接返回统一格式的错误。 */
function sendError(socket, code, message) { send(socket, 'error', { code, message }); }

/** @returns {Array<object>} 返回大厅中可展示的在线玩家摘要。 */
function getOnlineUsers() {
  return [...sessions.values()].map((item) => ({ id: item.id, nickname: item.nickname, status: item.status, roomId: item.roomId }));
}

/** @returns {void} 向所有大厅连接广播在线列表，房间内玩家也会收到最新状态。 */
function broadcastLobby() {
  const users = getOnlineUsers();
  for (const session of sessions.values()) send(session.socket, 'lobby', { onlineUsers: users, onlineCount: users.length });
}

/**
 * @param {object} room 对局房间对象。
 * @returns {object} 可安全发送给浏览器的房间快照。
 */
function roomState(room) {
  const players = { black: null, white: null };
  for (const [color, socket] of room.players) {
    const session = sessions.get(socket);
    players[color] = session ? { id: session.id, nickname: session.nickname } : null;
  }
  return { roomId: room.id, board: room.board, turn: room.turn, winner: room.winner, lastMove: room.lastMove, players };
}

/** @param {object} room @returns {void} 将房间快照广播给双方玩家。 */
function broadcastRoom(room) { for (const socket of room.players.keys()) send(socket, 'state', roomState(room)); }

/** @param {object} room @returns {void} 重置房间棋盘和回合。 */
function resetRoom(room) { room.board = createBoard(); room.turn = 'black'; room.winner = null; room.lastMove = null; }

/**
 * @param {import('ws').WebSocket} socket 当前连接。
 * @returns {void} 处理连接关闭，撤销邀请并通知同房间玩家。
 */
function disconnect(socket) {
  const session = sessions.get(socket);
  if (!session) return;
  for (const [inviteId, invite] of pendingInvites) if (invite.from === socket || invite.to === socket) pendingInvites.delete(inviteId);
  if (session.roomId) {
    const room = rooms.get(session.roomId);
    if (room) {
      room.players.delete(socket);
      for (const peer of room.players.keys()) send(peer, 'opponentLeft', { message: '对手已离开房间，回到大厅后可以重新邀请。' });
      for (const peer of room.players.keys()) { const peerSession = sessions.get(peer); if (peerSession) { peerSession.roomId = null; peerSession.status = 'idle'; } }
      rooms.delete(room.id);
    }
  }
  sessions.delete(socket);
  broadcastLobby();
}

/**
 * @param {import('ws').WebSocket} socket 当前连接。
 * @param {object} payload 经过 JSON 解析的客户端消息。
 * @returns {void} 执行大厅、邀请或对局操作并回传结果。
 */
function handleMessage(socket, payload) {
  const session = sessions.get(socket);
  if (!session || !payload || typeof payload.type !== 'string') return;
  if (payload.type === 'hello') {
    session.nickname = typeof payload.nickname === 'string' ? payload.nickname.trim().slice(0, 12) || session.nickname : session.nickname;
    broadcastLobby();
    return;
  }
  if (payload.type === 'invite') {
    const target = [...sessions.values()].find((item) => item.id === payload.targetId);
    if (!target || target.socket === socket) return sendError(socket, 'PLAYER_OFFLINE', '这位玩家已经不在线。');
    if (session.status !== 'idle' || target.status !== 'idle') return sendError(socket, 'PLAYER_BUSY', '对方或你正在别的邀请/对局中。');
    const inviteId = createId();
    pendingInvites.set(inviteId, { from: socket, to: target.socket, expiresAt: Date.now() + 60000 });
    session.status = 'inviting'; target.status = 'invited';
    send(target.socket, 'invite', { inviteId, from: { id: session.id, nickname: session.nickname } });
    send(socket, 'inviteSent', { inviteId, to: { id: target.id, nickname: target.nickname } });
    broadcastLobby();
    return;
  }
  if (payload.type === 'inviteResponse') {
    const invite = pendingInvites.get(payload.inviteId);
    if (!invite || invite.to !== socket || invite.expiresAt < Date.now()) return sendError(socket, 'INVITE_EXPIRED', '邀请已过期。');
    pendingInvites.delete(payload.inviteId);
    const from = sessions.get(invite.from); const to = sessions.get(invite.to);
    if (!from || !to) return;
    if (payload.accept !== true) { from.status = 'idle'; to.status = 'idle'; send(invite.from, 'inviteDeclined', { nickname: to.nickname }); broadcastLobby(); return; }
    const room = { id: createId(), board: createBoard(), turn: 'black', winner: null, lastMove: null, players: new Map([ [invite.from, 'black'], [invite.to, 'white'] ]) };
    rooms.set(room.id, room); from.roomId = room.id; to.roomId = room.id; from.status = 'playing'; to.status = 'playing';
    send(invite.from, 'roomJoined', { roomId: room.id, color: 'black' }); send(invite.to, 'roomJoined', { roomId: room.id, color: 'white' });
    broadcastRoom(room); broadcastLobby();
    return;
  }
  if (payload.type === 'restart') {
    const room = rooms.get(session.roomId); if (!room || !room.players.has(socket)) return;
    resetRoom(room); broadcastRoom(room); return;
  }
  if (payload.type !== 'move') return;
  const room = rooms.get(session.roomId); const color = room?.players.get(socket);
  if (!room || !color) return sendError(socket, 'NOT_IN_ROOM', '请先从大厅邀请一位同事。');
  const row = Number(payload.row); const col = Number(payload.col);
  if (room.winner) return sendError(socket, 'GAME_OVER', '本局已经结束，请再来一局。');
  if (room.turn !== color) return sendError(socket, 'NOT_TURN', '还没轮到你落子。');
  if (!isInside(row, col) || room.board[row][col]) return sendError(socket, 'BAD_MOVE', '这个位置不能落子。');
  room.board[row][col] = color; room.lastMove = { row, col, color };
  if (hasFive(room.board, row, col, color)) room.winner = color; else if (isDraw(room.board)) room.winner = 'draw'; else room.turn = color === 'black' ? 'white' : 'black';
  broadcastRoom(room);
}

/** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @returns {void} 提供静态文件和健康检查端点。 */
function serveStatic(request, response) {
  const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  if (pathname === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, online: sessions.size })); return; }
  const target = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(PUBLIC_DIR)) { response.writeHead(403); return response.end('Forbidden'); }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404); return response.end('Not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(data);
  });
}

const httpServer = http.createServer(serveStatic);
const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
wsServer.on('connection', (socket) => {
  const id = createId(); sessions.set(socket, { socket, id, nickname: `星星玩家${id.slice(0, 3)}`, status: 'idle', roomId: null });
  send(socket, 'welcome', { clientId: id, color: null, roomId: null }); broadcastLobby();
  socket.on('message', (raw) => { try { handleMessage(socket, JSON.parse(raw.toString())); } catch { sendError(socket, 'BAD_MESSAGE', '消息格式不正确。'); } });
  socket.on('close', () => disconnect(socket)); socket.on('error', () => disconnect(socket));
});

/** @param {string} url @returns {void} 在房主电脑的默认浏览器打开游戏。 */
function openBrowser(url) { if (process.env.OPEN_BROWSER === '0') return; const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'; const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]; const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.unref(); }

httpServer.listen(PORT, HOST, () => {
  const lanUrl = `http://${getLanIp()}:${PORT}`;
  console.log(`\n🎲 欢乐五子棋已启动！\n本机访问： http://127.0.0.1:${PORT}\n同事访问： ${lanUrl}\n线上部署后可直接分享 Render 域名。\n`);
  openBrowser(`http://127.0.0.1:${PORT}`);
});
process.on('SIGINT', () => { wsServer.close(); httpServer.close(() => process.exit(0)); });
