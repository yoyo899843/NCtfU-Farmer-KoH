/*
 * /admin/players 這一頁：玩家帳號的清單、刪除與重設 PIN。
 * 登入與 session 由 common.js 處理。
 *
 * 包在 IIFE 裡的理由同 control.js：避免與 common.js 的全域宣告撞名。
 */
(() => {
  const { $, post, fail, token } = window.Admin;

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
      const data = await post('/api/admin/players', { token: token() });
      renderPlayers(data.players);
    } catch (_error) { /* 下次操作或按重新整理時會再讀 */ }
  }

  async function playerAction(path, extra, successMessage) {
    try {
      const data = await post(path, { token: token(), ...extra });
      renderPlayers(data.players);
      $('players-notice').textContent = successMessage;
    } catch (error) {
      fail(error, 'players-notice');
    }
  }

  $('players-refresh').addEventListener('click', () => {
    $('players-notice').textContent = '';
    refreshPlayers();
  });

  window.Admin.onReady(() => refreshPlayers());
})();
