/**
 * 在线五子棋客户端状态。棋盘单元使用 null、black、white 表示空位与棋子颜色。
 */
const gameState = {
  board: Array.from({ length: 15 }, () => Array(15).fill(null)),
  turn: 'black', winner: null, lastMove: null, localColor: 'spectator',
  clientId: '', nickname: localStorage.getItem('gomokuNickname') || '小太阳',
  roomId: '', socket: null, zoom: 1, baseBoardSize: 0, soundEnabled: true, pendingInvite: null,
};
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('gameStatus');
const toastElement = document.getElementById('toast');

/** 创建 15×15 棋盘按钮，并绑定落子操作。 */
function buildBoard() {
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 15; row += 1) for (let col = 0; col < 15; col += 1) {
    const cell = document.createElement('button'); cell.className = 'cell'; cell.type = 'button';
    cell.dataset.row = row; cell.dataset.col = col; cell.setAttribute('role', 'gridcell');
    cell.addEventListener('click', () => placeStone(row, col));
    cell.append(Object.assign(document.createElement('span'), { className: 'stone empty' })); fragment.append(cell);
  }
  boardElement.replaceChildren(fragment);
}

/** 把服务端棋盘状态渲染到页面，并标出最新落子。 */
function renderBoard() {
  boardElement.querySelectorAll('.cell').forEach((cell) => {
    const row = Number(cell.dataset.row); const col = Number(cell.dataset.col); const value = gameState.board[row][col];
    const stone = cell.firstElementChild; stone.className = `stone ${value || 'empty'}`;
    if (gameState.lastMove && gameState.lastMove.row === row && gameState.lastMove.col === col) stone.classList.add('last');
    cell.setAttribute('aria-label', `${row + 1} 行 ${col + 1} 列，${value === 'black' ? '黑棋' : value === 'white' ? '白棋' : '空位'}`);
  });
  updateTurnCards();
}

/** 向服务端发送合法落子请求，服务端负责最终校验。 */
function placeStone(row, col) {
  if (gameState.winner || gameState.turn !== gameState.localColor || gameState.board[row][col]) return;
  sendMessage({ type: 'move', row, col });
}

/** 处理 welcome、state、lobby、邀请和错误消息。 */
function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'welcome') { gameState.clientId = message.clientId || ''; gameState.localColor = message.color || 'spectator'; if (message.roomId) setRoom(message.roomId); updateTurnCards(); return; }
  if (message.type === 'roomJoined') { gameState.roomId = message.roomId || gameState.roomId; gameState.localColor = message.color || gameState.localColor; setRoom(gameState.roomId); updateTurnCards(); return; }
  if (message.type === 'state') { gameState.board = message.board || gameState.board; gameState.turn = message.turn || 'black'; gameState.winner = message.winner || null; gameState.lastMove = message.lastMove || null; if (message.roomId) setRoom(message.roomId); if (message.lanUrl) setAddress(message.lanUrl); renderBoard(); updatePlayers(message); return; }
  if (message.type === 'lobby') { updateLobby(message.onlineUsers || message.players || []); return; }
  if (message.type === 'invite') { showInvite(message); return; }
  if (message.type === 'inviteSent') { showToast(`已邀请 ${message.to?.nickname || '玩家'}，等待回应`); return; }
  if (message.type === 'inviteDeclined') { showToast(`${message.nickname || '对方'} 暂时没有接受邀请`); return; }
  if (message.type === 'inviteResult') { showToast(message.message || (message.accepted ? '对方接受了邀请' : '对方暂时无法应战')); return; }
  if (message.type === 'opponentLeft') { gameState.localColor = 'spectator'; gameState.roomId = ''; gameState.winner = null; gameState.board = Array.from({ length: 15 }, () => Array(15).fill(null)); setRoom('------'); renderBoard(); showToast(message.message || '对手已离开房间'); return; }
  if (message.type === 'error') showToast(message.message || '房间操作失败');
}

/** 更新当前玩家卡片、轮次状态以及胜负提示。 */
function updateTurnCards() {
  const playing = !gameState.winner && gameState.localColor !== 'spectator';
  const blackActive = playing && gameState.turn === 'black'; const whiteActive = playing && gameState.turn === 'white';
  document.getElementById('blackPlayerCard').classList.toggle('active', blackActive); document.getElementById('whitePlayerCard').classList.toggle('active', whiteActive);
  document.getElementById('blackTurnBadge').textContent = gameState.localColor === 'black' && blackActive ? '你的回合' : '等待中';
  document.getElementById('whiteTurnBadge').textContent = gameState.localColor === 'white' && whiteActive ? '你的回合' : '等待中';
  if (gameState.winner === 'draw') statusElement.textContent = '和棋啦，点击 ↻ 再来一局';
  else if (gameState.winner) statusElement.textContent = gameState.winner === gameState.localColor ? '你赢啦！点击 ↻ 再来一局' : '对手赢啦，点击 ↻ 再来一局';
  else statusElement.textContent = gameState.localColor === gameState.turn ? '轮到你落子啦' : gameState.localColor === 'spectator' ? '观战中 · 等待玩家落子' : '等待对手落子…';
  document.getElementById('boardHint').textContent = gameState.localColor === gameState.turn ? '点击棋盘落子 · 祝你好运' : '对手思考中 · 看看下一步放哪里';
}

/** 将在线玩家数组渲染成可邀请的大厅卡片。 */
function updateLobby(users) {
  const list = document.getElementById('onlineList'); const normalized = Array.isArray(users) ? users : Object.entries(users || {}).map(([id, value]) => ({ id, nickname: value }));
  document.getElementById('onlineCount').textContent = `${normalized.length} 人在线`; list.replaceChildren();
  if (!normalized.length) { list.innerHTML = '<p class="empty-lobby">正在寻找在线玩家…</p>'; return; }
  normalized.forEach((user) => { const item = document.createElement('div'); item.className = 'online-user'; item.innerHTML = `<span class="user-dot"></span><span class="user-name"></span><span class="user-status">${user.status || '在线'}</span>`; item.querySelector('.user-name').textContent = user.nickname || '玩家'; if (user.id && user.id !== gameState.clientId) { const button = document.createElement('button'); button.className = 'invite-user'; button.textContent = '邀请'; button.onclick = () => inviteUser(user.id, user.nickname); item.append(button); } list.append(item); });
}

/** 从 state.players 补充大厅与两侧玩家昵称。 */
function updatePlayers(message) {
  const players = message.players || {}; const black = typeof players.black === 'object' ? players.black?.nickname : players.black; const white = typeof players.white === 'object' ? players.white?.nickname : players.white; document.querySelector('#blackPlayerCard strong').textContent = black || '小太阳'; document.querySelector('#whitePlayerCard strong').textContent = white || '月亮同事';
  const users = message.onlineUsers || Object.entries(players).filter(([, value]) => value).map(([id, value]) => ({ id, nickname: typeof value === 'object' ? value.nickname : value, status: '对战中' })); updateLobby(users);
}

/** 向大厅指定玩家发起对战邀请。 */
function inviteUser(targetId, nickname) { sendMessage({ type: 'invite', targetId, nickname }); showToast(`已邀请 ${nickname || '玩家'}`); }

/** 显示邀请弹窗并保存邀请上下文。 */
function showInvite(message) { const from = message.from || {}; gameState.pendingInvite = message; document.getElementById('inviteTitle').textContent = `${from.nickname || message.nickname || '玩家'} 邀请你对战`; document.getElementById('inviteMessage').textContent = message.message || '要不要来一局五子棋？'; document.getElementById('inviteDialog').showModal(); }

/** 回应当前邀请并关闭弹窗。 */
function respondInvite(accept) { const invite = gameState.pendingInvite; if (invite) sendMessage({ type: 'inviteResponse', inviteId: invite.inviteId, accept }); gameState.pendingInvite = null; document.getElementById('inviteDialog').close(); }

/** 建立 WebSocket 连接并在连接后发送昵称。 */
function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; const endpoint = `${protocol}//${window.location.host}/ws`;
  try { gameState.socket = new WebSocket(endpoint); gameState.socket.onopen = () => { setConnection('connected', '已连接 · 房间可玩'); sendMessage({ type: 'hello', nickname: gameState.nickname }); }; gameState.socket.onmessage = (event) => { try { handleMessage(JSON.parse(event.data)); } catch { showToast('收到无法识别的房间消息'); } }; gameState.socket.onclose = () => setConnection('error', '离线演示模式'); gameState.socket.onerror = () => setConnection('error', '离线演示模式'); } catch { setConnection('error', '离线演示模式'); }
}

/** 发送 JSON 消息；未连接时保持页面可浏览。 */
function sendMessage(message) { if (gameState.socket?.readyState === WebSocket.OPEN) gameState.socket.send(JSON.stringify(message)); }
/** 更新连接状态徽标。 */
function setConnection(state, text) { const pill = document.getElementById('connectionPill'); pill.dataset.state = state; document.getElementById('connectionText').textContent = text; }
/** 设置房间编号与可复制分享链接。 */
function setRoom(room) { gameState.roomId = room; document.getElementById('roomCodeLabel').textContent = room || '------'; const url = `${window.location.origin}${window.location.pathname}`; document.getElementById('shareUrl').textContent = url; setAddress(url); }
/** 更新页面底部显示的访问地址。 */
function setAddress(address) { document.getElementById('addressLabel').textContent = String(address).replace(/^https?:\/\//, ''); }
/** 复制房间链接。 */
async function copyRoomLink() { try { await navigator.clipboard.writeText(document.getElementById('shareUrl').textContent); showToast('房间链接已复制，发给同事吧！'); } catch { showToast(document.getElementById('shareUrl').textContent); } }
/** 请求服务端重开一局。 */
function resetGame() { sendMessage({ type: 'restart' }); }
/**
 * 应用整张棋盘的缩放尺寸；棋盘视口同步变大，始终展示完整棋盘。
 * @param {number} nextZoom 目标缩放比例，范围 75% 至 150%。
 * @param {boolean} keepCenter 是否保持用户当前看到的棋盘位置。
 */
function setZoom(nextZoom) {
  const viewport = document.getElementById('boardViewport'); const boardWrap = document.getElementById('boardWrap');
  if (!viewport || !boardWrap) return;
  gameState.zoom = Math.min(1.5, Math.max(.75, nextZoom));
  const baseSize = gameState.baseBoardSize || viewport.clientWidth; const nextSize = Math.max(1, Math.round(baseSize * gameState.zoom));
  document.querySelector('.game-layout')?.style.setProperty('--board-stage-width', `${nextSize}px`);
  viewport.style.width = `${nextSize}px`; viewport.style.height = `${nextSize}px`;
  boardWrap.style.width = `${nextSize}px`; boardWrap.style.height = `${nextSize}px`;
  document.getElementById('zoomValue').textContent = `${Math.round(gameState.zoom * 100)}%`;
}

/** 调整棋盘缩放比例，供备用按钮调用。 */
function adjustZoom(delta) { setZoom(gameState.zoom + delta); }

/** 注册鼠标滚轮、触控板捏合和 Safari 手势缩放。 */
function bindZoomGestures() {
  const viewport = document.getElementById('boardViewport'); let gestureStartZoom = gameState.zoom;
  viewport.addEventListener('wheel', (event) => { event.preventDefault(); setZoom(gameState.zoom * Math.exp(-event.deltaY * 0.002)); }, { passive: false });
  viewport.addEventListener('gesturestart', (event) => { event.preventDefault(); gestureStartZoom = gameState.zoom; }, { passive: false });
  viewport.addEventListener('gesturechange', (event) => { event.preventDefault(); setZoom(gestureStartZoom * event.scale); }, { passive: false });
  viewport.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });
  gameState.baseBoardSize = viewport.getBoundingClientRect().width;
  window.addEventListener('resize', () => { viewport.style.width = ''; viewport.style.height = ''; gameState.baseBoardSize = viewport.getBoundingClientRect().width; setZoom(gameState.zoom); });
  setZoom(1);
}
/** 显示短暂的页面提示。 */
function showToast(message) { toastElement.textContent = message; toastElement.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toastElement.classList.remove('show'), 2200); }

buildBoard(); setRoom(new URLSearchParams(location.search).get('room') || '------'); bindZoomGestures(); connectSocket();
document.getElementById('copyButton').onclick = copyRoomLink; document.getElementById('resetButton').onclick = resetGame; document.getElementById('zoomIn').onclick = () => adjustZoom(.05); document.getElementById('zoomOut').onclick = () => adjustZoom(-.05);
document.getElementById('soundButton').onclick = () => { gameState.soundEnabled = !gameState.soundEnabled; document.getElementById('soundButton').textContent = gameState.soundEnabled ? '♫' : '♩'; showToast(gameState.soundEnabled ? '音效已开启' : '音效已关闭'); };
document.getElementById('nicknameForm').onsubmit = (event) => { event.preventDefault(); const input = document.getElementById('nicknameInput'); gameState.nickname = input.value.trim().slice(0, 12) || '玩家'; localStorage.setItem('gomokuNickname', gameState.nickname); sendMessage({ type: 'hello', nickname: gameState.nickname }); showToast('昵称已更新'); };
document.getElementById('nicknameInput').value = gameState.nickname; document.getElementById('acceptInvite').onclick = () => respondInvite(true); document.getElementById('rejectInvite').onclick = () => respondInvite(false);
