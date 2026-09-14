/*
 * 管理台三個頁面共用的：登入閘門、session token、POST 包裝、登出。
 *
 * 每個頁面自己的 script 用 Admin.onReady(fn) 註冊「登入完成後要做的事」，
 * 用 Admin.onLogout(fn) 註冊「退回登入畫面時要收拾的事」（例如停掉輪詢）。
 * 這支必須在頁面自己的 script 之前載入。
 */
const tokenStorage = 'ctf-farmer-admin-token';
const $ = (id) => document.getElementById(id);

let adminToken = '';
const readyCallbacks = [];
const logoutCallbacks = [];

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

function forgetSession() {
  adminToken = '';
  localStorage.removeItem(tokenStorage);
}

function showLogin(message = '') {
  $('admin-panel').style.display = 'none';
  $('admin-login').style.display = 'block';
  $('login-error').textContent = message;
  for (const fn of logoutCallbacks) fn();
}

function showPanel(gameState) {
  $('admin-login').style.display = 'none';
  $('admin-panel').style.display = 'block';
  for (const fn of readyCallbacks) fn(gameState);
}

// 每個頁面都會重複「401 就退回登入、其他錯誤就顯示在該區塊」，收在這裡。
function fail(error, noticeId) {
  if (error.status === 401) {
    forgetSession();
    showLogin('登入已失效，請重新登入。');
    return;
  }
  if (noticeId) $(noticeId).textContent = error.message;
}

async function login(username, password) {
  try {
    const data = await post('/api/admin/login', { username, password });
    adminToken = data.token;
    // 只記住 session token，密碼不會被存下來。
    if ($('remember').checked) localStorage.setItem(tokenStorage, data.token);
    $('admin-password').value = '';
    showPanel(data.gameState);
  } catch (error) {
    forgetSession();
    showLogin(error.message);
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
  try { await post('/api/admin/logout', { token }); } catch (_error) { /* 本來就沒了 */ }
});

window.Admin = {
  $,
  post,
  fail,
  showLogin,
  forgetSession,
  token: () => adminToken,
  onReady: (fn) => readyCallbacks.push(fn),
  onLogout: (fn) => logoutCallbacks.push(fn)
};

// 用記住的 token 續用登入；伺服器重開過的話會失敗，退回登入畫面。
(async () => {
  const savedToken = localStorage.getItem(tokenStorage);
  if (!savedToken) return;
  try {
    const data = await post('/api/admin/session', { token: savedToken });
    adminToken = savedToken;
    $('remember').checked = true;
    showPanel(data.gameState);
  } catch (_error) {
    forgetSession();
  }
})();
