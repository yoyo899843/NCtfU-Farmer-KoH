/*
 * /admin/login 專用。這一頁刻意不載入 common.js —— common.js 的職責是
 * 「把未登入的人踢到這裡來」，對登入頁本身而言語意相反，而且它綁的
 * #logout、#admin-nav 等元素在這頁並不存在。
 */
const tokenStorage = 'ctf-farmer-admin-token';
const $ = (id) => document.getElementById(id);

// 只接受白名單內的轉址目標，避免 ?next= 變成開放轉址。
const ALLOWED_NEXT = ['/admin', '/admin/player', '/admin/announcement'];

function nextPath() {
  const wanted = new URLSearchParams(location.search).get('next');
  return ALLOWED_NEXT.includes(wanted) ? wanted : '/admin';
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

async function login(username, password) {
  try {
    const data = await post('/api/admin/login', { username, password });
    // 只記住 session token，密碼不會被存下來。
    if ($('remember').checked) localStorage.setItem(tokenStorage, data.token);
    else sessionStorage.setItem(tokenStorage, data.token);
    location.replace(nextPath());
  } catch (error) {
    localStorage.removeItem(tokenStorage);
    sessionStorage.removeItem(tokenStorage);
    $('admin-password').value = '';
    $('login-error').textContent = error.message;
  }
}

$('login').addEventListener('click', () => login($('admin-user').value, $('admin-password').value));
for (const id of ['admin-user', 'admin-password']) {
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login($('admin-user').value, $('admin-password').value);
  });
}

// 已經登入過就不用再看到這一頁。
(async () => {
  const saved = localStorage.getItem(tokenStorage) || sessionStorage.getItem(tokenStorage);
  if (!saved) return $('admin-user').focus();
  try {
    await post('/api/admin/session', { token: saved });
    location.replace(nextPath());
  } catch (_error) {
    localStorage.removeItem(tokenStorage);
    sessionStorage.removeItem(tokenStorage);
    $('admin-user').focus();
  }
})();
