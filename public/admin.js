const tokenStorage = 'ctf-farmer-admin-token';
const $ = (id) => document.getElementById(id);
let state = { phase: 'waiting', roundNumber: 0, phaseEndsAt: null };
let clockOffset = 0;
let adminToken = '';
let pollTimer = null;

const formatTime = (seconds) => {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
};

function renderState() {
  const pausedLabel = state.pausedFrom === 'break'
    ? `已暫停（第 ${state.roundNumber} 局的休息中斷）`
    : `已暫停（第 ${state.roundNumber} 局進行中斷）`;
  const labels = {
    waiting: '等待開始',
    round: `第 ${state.roundNumber} 局進行中`,
    break: `第 ${state.roundNumber} 局結算完成，休息中`,
    paused: pausedLabel
  };
  $('status').textContent = labels[state.phase] || '狀態未知';
  const remaining = state.phaseEndsAt
    ? Math.max(0, Math.ceil((state.phaseEndsAt - (Date.now() + clockOffset)) / 1000))
    : null;
  if (state.phase === 'paused') {
    // 暫停時倒數是凍結的，顯示定住的剩餘時間而不是一直跳的數字。
    $('countdown').textContent = Number.isFinite(state.remainingMs)
      ? `倒數已凍結，剩餘 ${formatTime(state.remainingMs / 1000)}`
      : '倒數已凍結';
  } else {
    $('countdown').textContent = remaining === null ? '' : `剩餘 ${formatTime(remaining)}`;
  }
  $('round-number').textContent = state.roundNumber;
  $('round-duration').textContent = formatTime(state.roundSeconds || 0);
  $('break-duration').textContent = formatTime(state.breakSeconds || 0);
  syncDurationInputs();
  const running = state.phase === 'round' || state.phase === 'break';
  $('start-event').disabled = running;
  $('resume-event').disabled = running;
  $('end-round').disabled = state.phase !== 'round';
  $('next-round').disabled = state.phase !== 'break';
  $('pause-event').disabled = !running;
}

// 每秒都會重畫，所以正在輸入的欄位不要蓋掉。
function syncDurationInputs() {
  const fields = [['round-seconds', state.roundSeconds], ['break-seconds', state.breakSeconds]];
  for (const [id, value] of fields) {
    const input = $(id);
    if (input !== document.activeElement && Number.isInteger(value)) input.value = value;
  }
}

async function loadState() {
  try {
    const response = await fetch('/api/game-state');
    const data = await response.json();
    clockOffset = data.serverNow - Date.now();
    state = data;
    renderState();
  } catch (_error) {
    $('status').textContent = '無法連線到伺服器';
  }
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || '操作失敗。');
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyState(gameState) {
  state = gameState;
  clockOffset = state.serverNow - Date.now();
  renderState();
}

function showPanel() {
  $('admin-login').style.display = 'none';
  $('admin-panel').style.display = 'block';
  renderState();
  refreshAnnouncements();
  refreshPlayers();
  if (!pollTimer) pollTimer = setInterval(loadState, 1000);
}

// 暱稱是玩家自己取的，一律用 textContent 當純文字，別讓管理台變成 XSS 破口。
function renderPlayers(list) {
  const target = $('players-list');
  target.replaceChildren();
  $('players-count').textContent = `共 ${list.length} 位`;
  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = '目前沒有任何玩家帳號。';
    target.append(empty);
    return;
  }
  for (const item of list) {
    const row = document.createElement('li');
    if (!item.online) row.className = 'offline';

    const name = document.createElement('strong');
    name.textContent = item.nickname;

    const info = document.createElement('span');
    info.className = 'info';
    const bits = [item.online ? '在線' : '離線', `累計 ${item.totalScore} 分`, `已玩 ${item.roundsPlayed} 局`];
    if (item.online) bits.push(`本局 ${item.roundScore} 分`);
    info.textContent = bits.join('・');

    const resetPin = document.createElement('button');
    resetPin.textContent = '重設 PIN';
    resetPin.addEventListener('click', () => {
      const pin = prompt(`給「${item.nickname}」一組新的 6 位數 PIN：`);
      if (pin === null) return;
      playerAction('/api/admin/players/reset-pin', { nickname: item.nickname, pin }, `已重設 ${item.nickname} 的 PIN。`);
    });

    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = '刪除';
    remove.addEventListener('click', () => {
      if (confirm(`確定要刪除「${item.nickname}」？累計分數與目前連線都會消失，無法復原。`)) {
        playerAction('/api/admin/players/delete', { nickname: item.nickname }, `已刪除 ${item.nickname}。`);
      }
    });

    row.append(name, info, resetPin, remove);
    target.append(row);
  }
}

async function refreshPlayers() {
  try {
    const data = await post('/api/admin/players', { token: adminToken });
    renderPlayers(data.players);
  } catch (_error) { /* 下次操作或按重新整理時會再讀 */ }
}

async function playerAction(path, extra, successMessage) {
  try {
    const data = await post(path, { token: adminToken, ...extra });
    renderPlayers(data.players);
    $('players-notice').textContent = successMessage;
  } catch (error) {
    if (error.status === 401) {
      forgetSession();
      return showLogin('登入已失效，請重新登入。');
    }
    $('players-notice').textContent = error.message;
  }
}

// 管理台這邊也用 textContent，公告內容一律當純文字處理。
function renderAnnouncements(items) {
  const list = $('announce-list');
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    const stamp = document.createElement('time');
    stamp.textContent = new Date(item.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const body = document.createElement('span');
    body.textContent = item.body;
    const remove = document.createElement('button');
    remove.textContent = '刪除';
    remove.addEventListener('click', () => announce('/api/admin/announcements/delete', { id: item.id }, '已刪除。'));
    row.append(stamp, body, remove);
    list.append(row);
  }
}

async function refreshAnnouncements() {
  try {
    const data = await (await fetch('/api/announcements')).json();
    renderAnnouncements(data.announcements);
  } catch (_error) { /* 下次操作時會再讀 */ }
}

async function announce(path, extra, successMessage) {
  try {
    const data = await post(path, { token: adminToken, ...extra });
    renderAnnouncements(data.announcements);
    $('announce-notice').textContent = successMessage;
  } catch (error) {
    if (error.status === 401) {
      forgetSession();
      return showLogin('登入已失效，請重新登入。');
    }
    $('announce-notice').textContent = error.message;
  }
}

function showLogin(message = '') {
  $('admin-panel').style.display = 'none';
  $('admin-login').style.display = 'block';
  $('login-error').textContent = message;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function forgetSession() {
  adminToken = '';
  localStorage.removeItem(tokenStorage);
}

async function login(username, password) {
  try {
    const data = await post('/api/admin/login', { username, password });
    adminToken = data.token;
    // Only the session token is remembered; the password is never stored.
    if ($('remember').checked) localStorage.setItem(tokenStorage, data.token);
    $('admin-password').value = '';
    applyState(data.gameState);
    showPanel();
  } catch (error) {
    forgetSession();
    showLogin(error.message);
  }
}

async function control(path) {
  try {
    const data = await post(path, { token: adminToken });
    applyState(data.gameState);
    $('notice').textContent = '操作成功。';
  } catch (error) {
    if (error.status === 401) {
      forgetSession();
      return showLogin('登入已失效，請重新登入。');
    }
    $('notice').textContent = error.message;
  }
}

$('login').addEventListener('click', () => login($('admin-user').value, $('admin-password').value));
for (const id of ['admin-user', 'admin-password']) {
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login($('admin-user').value, $('admin-password').value);
  });
}
$('logout').addEventListener('click', async () => {
  const token = adminToken;
  forgetSession();
  showLogin('已登出。');
  try { await post('/api/admin/logout', { token }); } catch (_error) { /* already gone */ }
});
$('players-refresh').addEventListener('click', () => {
  $('players-notice').textContent = '';
  refreshPlayers();
});
$('announce-post').addEventListener('click', async () => {
  const body = $('announce-text').value;
  await announce('/api/admin/announcements', { body }, '已發佈。');
  if ($('announce-notice').textContent === '已發佈。') $('announce-text').value = '';
});
$('announce-clear').addEventListener('click', () => {
  if (confirm('確定要清除所有公告嗎？')) announce('/api/admin/announcements/clear', {}, '已全部清除。');
});
$('save-settings').addEventListener('click', async () => {
  try {
    const data = await post('/api/admin/settings', {
      token: adminToken,
      roundSeconds: Number($('round-seconds').value),
      breakSeconds: Number($('break-seconds').value)
    });
    applyState(data.gameState);
    $('settings-notice').textContent = '已儲存，將於下一局開始時生效。';
  } catch (error) {
    if (error.status === 401) {
      forgetSession();
      return showLogin('登入已失效，請重新登入。');
    }
    $('settings-notice').textContent = error.message;
  }
});
$('start-event').addEventListener('click', () => {
  if (confirm('「開始」會永久刪除所有玩家帳號、PIN、分數與本局資料，並從第 1 局重新計算。\n\n只是想暫時停下來的話請按「暫停」。確定要開始新的一場嗎？')) {
    control('/api/admin/start');
  }
});
$('resume-event').addEventListener('click', () => control('/api/admin/resume'));
$('end-round').addEventListener('click', () => control('/api/admin/end-round'));
$('next-round').addEventListener('click', () => control('/api/admin/next-round'));
// 暫停不動任何資料，所以不需要確認框。
$('pause-event').addEventListener('click', () => control('/api/admin/pause'));

(async () => {
  await loadState();
  const savedToken = localStorage.getItem(tokenStorage);
  if (!savedToken) return;
  // Resume a remembered session; a server restart drops it and we fall back.
  try {
    const data = await post('/api/admin/session', { token: savedToken });
    adminToken = savedToken;
    $('remember').checked = true;
    applyState(data.gameState);
    showPanel();
  } catch (_error) {
    forgetSession();
  }
})();
