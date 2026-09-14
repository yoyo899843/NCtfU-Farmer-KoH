/*
 * 管理台三個功能頁共用的門禁與工具。
 *
 * 登入表單不在這裡——它有自己的獨立頁面 /admin/login。這支的職責是：
 * 頁面一載入就驗證 session，沒過就把人轉去登入頁；過了才把控制台、導覽列
 * 與標題列上的按鈕顯示出來（這三塊在 CSS 裡預設隱藏，所以未登入者不會
 * 先閃一下功能列）。
 *
 * 每個頁面自己的 script 用 Admin.onReady(fn) 註冊「登入確認後要做的事」。
 * 這支必須在頁面自己的 script 之前載入。
 */
const tokenStorage = 'ctf-farmer-admin-token';
const LOGIN_PAGE = '/admin/login';
const $ = (id) => document.getElementById(id);

let adminToken = '';
const readyCallbacks = [];
const logoutCallbacks = [];

function storedToken() {
  return localStorage.getItem(tokenStorage) || sessionStorage.getItem(tokenStorage);
}

function forgetSession() {
  adminToken = '';
  localStorage.removeItem(tokenStorage);
  sessionStorage.removeItem(tokenStorage);
}

// 轉去登入頁，並記住原本想去哪一頁，登入後可以直接回來。
function goToLogin() {
  for (const fn of logoutCallbacks) fn();
  location.replace(`${LOGIN_PAGE}?next=${encodeURIComponent(location.pathname)}`);
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

// 每個頁面都會重複「401 就回登入頁、其他錯誤就顯示在該區塊」，收在這裡。
function fail(error, noticeId) {
  if (error.status === 401) {
    forgetSession();
    goToLogin();
    return;
  }
  if (noticeId) $(noticeId).textContent = error.message;
}

function revealPanel() {
  $('admin-panel').style.display = 'block';
  $('admin-nav').style.display = 'flex';
  $('topbar-actions').style.display = 'flex';
}

$('logout').addEventListener('click', async () => {
  const token = adminToken;
  forgetSession();
  try { await post('/api/admin/logout', { token }); } catch (_error) { /* 本來就沒了 */ }
  location.replace(LOGIN_PAGE);
});

window.Admin = {
  $,
  post,
  fail,
  forgetSession,
  goToLogin,
  token: () => adminToken,
  onReady: (fn) => readyCallbacks.push(fn),
  onLogout: (fn) => logoutCallbacks.push(fn)
};

// 門禁：沒有有效的 session 就不讓這一頁顯示出來。
(async () => {
  const saved = storedToken();
  if (!saved) return goToLogin();
  try {
    const data = await post('/api/admin/session', { token: saved });
    adminToken = saved;
    revealPanel();
    for (const fn of readyCallbacks) fn(data.gameState);
  } catch (_error) {
    forgetSession();
    goToLogin();
  }
})();
