/*
 * /admin/announcements 這一頁：發佈、刪除、清空公告。
 * 登入與 session 由 common.js 處理。
 *
 * 包在 IIFE 裡的理由同 control.js：避免與 common.js 的全域宣告撞名。
 */
(() => {
  const { $, post, fail, token } = window.Admin;

  // 公告內容一律用 textContent 當純文字，不讓它變成另一個 XSS 破口。
  function renderAnnouncements(items) {
    const list = $('announce-list');
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = '目前沒有公告。';
      list.append(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement('li');
      const stamp = document.createElement('time');
      stamp.textContent = new Date(item.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      const body = document.createElement('span');
      body.className = 'body';
      body.textContent = item.body;
      const remove = document.createElement('button');
      remove.textContent = '刪除';
      remove.addEventListener('click', () => {
        if (confirm('確定要刪除這則公告嗎？')) {
          announce('/api/admin/announcements/delete', { id: item.id }, '已刪除。');
        }
      });
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
      const data = await post(path, { token: token(), ...extra });
      renderAnnouncements(data.announcements);
      $('announce-notice').textContent = successMessage;
    } catch (error) {
      fail(error, 'announce-notice');
    }
  }

  $('announce-post').addEventListener('click', async () => {
    const body = $('announce-text').value;
    await announce('/api/admin/announcements', { body }, '已發佈。');
    if ($('announce-notice').textContent === '已發佈。') $('announce-text').value = '';
  });
  $('announce-clear').addEventListener('click', () => {
    if (confirm('確定要清除所有公告嗎？')) announce('/api/admin/announcements/clear', {}, '已全部清除。');
  });

  window.Admin.onReady(() => refreshAnnouncements());
})();
