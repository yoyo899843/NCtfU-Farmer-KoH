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
  const labels = {
    waiting: '等待開始',
    round: `第 ${state.roundNumber} 局進行中`,
    break: `第 ${state.roundNumber} 局結算完成，休息中`,
    ended: `活動已結束，共進行 ${state.roundNumber} 局`
  };
  $('status').textContent = labels[state.phase] || '狀態未知';
  const remaining = state.phaseEndsAt
    ? Math.max(0, Math.ceil((state.phaseEndsAt - (Date.now() + clockOffset)) / 1000))
    : null;
  $('countdown').textContent = remaining === null ? '' : `剩餘 ${formatTime(remaining)}`;
  $('round-number').textContent = state.roundNumber;
  $('round-duration').textContent = formatTime(state.roundSeconds || 0);
  $('break-duration').textContent = formatTime(state.breakSeconds || 0);
  syncDurationInputs();
  $('start-event').disabled = state.phase === 'round' || state.phase === 'break';
  $('resume-event').disabled = state.phase === 'round' || state.phase === 'break';
  $('end-round').disabled = state.phase !== 'round';
  $('next-round').disabled = state.phase !== 'break';
  $('end-event').disabled = state.phase === 'waiting' || state.phase === 'ended';
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
  if (!pollTimer) pollTimer = setInterval(loadState, 1000);
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
  if (confirm('這會永久刪除所有玩家帳號、PIN、分數與本局資料，確定要開始新活動嗎？')) control('/api/admin/start');
});
$('resume-event').addEventListener('click', () => control('/api/admin/resume'));
$('end-round').addEventListener('click', () => control('/api/admin/end-round'));
$('next-round').addEventListener('click', () => control('/api/admin/next-round'));
$('end-event').addEventListener('click', () => control('/api/admin/end'));

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
