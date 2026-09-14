/*
 * /admin 這一頁：活動狀態、回合控制、時間設定。
 * 登入與 session 由 common.js 處理。
 *
 * 整支包在 IIFE 裡：這頁會同時載入 common.js，兩支 classic script 共用
 * 同一個全域作用域，不包起來的話 const $ / post / fail 會跟 common 撞名，
 * 整頁直接 SyntaxError。
 */
(() => {
  const { $, post, fail, token } = window.Admin;

  let state = { phase: 'waiting', roundNumber: 0, phaseEndsAt: null };
  let clockOffset = 0;
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

  function applyState(gameState) {
    state = gameState;
    clockOffset = state.serverNow - Date.now();
    renderState();
  }

  async function control(path) {
    try {
      const data = await post(path, { token: token() });
      applyState(data.gameState);
      $('notice').textContent = '操作成功。';
    } catch (error) {
      fail(error, 'notice');
    }
  }

  $('save-settings').addEventListener('click', async () => {
    try {
      const data = await post('/api/admin/settings', {
        token: token(),
        roundSeconds: Number($('round-seconds').value),
        breakSeconds: Number($('break-seconds').value)
      });
      applyState(data.gameState);
      $('settings-notice').textContent = '已儲存，將於下一局開始時生效。';
    } catch (error) {
      fail(error, 'settings-notice');
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

  window.Admin.onReady((gameState) => {
    if (gameState) applyState(gameState); else renderState();
    if (!pollTimer) pollTimer = setInterval(loadState, 1000);
  });
  window.Admin.onLogout(() => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  // 還沒登入時也讓狀態欄有東西看。
  loadState();
})();
