(() => {
  const $ = (id) => document.getElementById(id);
  let state = { phase: 'waiting', roundNumber: 0, phaseEndsAt: null, remainingMs: null };
  let clockOffset = 0;
  let syncing = false;

  function formatTime(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(value / 60);
    return `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function renderState() {
    const pausedFrom = state.pausedFrom === 'break' ? '休息暫停中' : '本局暫停中';
    const labels = {
      waiting: '等待主辦方開始',
      round: `第 ${state.roundNumber} 局進行中`,
      break: `第 ${state.roundNumber} 局結算完成・休息中`,
      paused: pausedFrom
    };
    document.body.dataset.phase = state.phase;
    $('round-number').textContent = state.roundNumber;
    $('phase-label').textContent = labels[state.phase] || '狀態未知';
    $('countdown-caption').textContent = state.phase === 'paused' ? 'TIME FROZEN' : 'TIME LEFT';
    renderCountdown();
  }

  function renderCountdown() {
    if (state.phase === 'paused') {
      $('countdown').textContent = Number.isFinite(state.remainingMs)
        ? formatTime(state.remainingMs / 1000)
        : 'PAUSED';
      return;
    }
    if (!state.phaseEndsAt) {
      $('countdown').textContent = '—';
      return;
    }
    const remaining = (state.phaseEndsAt - (Date.now() + clockOffset)) / 1000;
    $('countdown').textContent = formatTime(remaining);
  }

  // 玩家暱稱是外部輸入，使用 textContent 避免 Stored XSS。
  function renderLeaderboard(targetId, entries) {
    const list = $(targetId);
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '尚無玩家成績';
      list.append(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement('li');
      const rank = document.createElement('span');
      const name = document.createElement('span');
      const score = document.createElement('strong');
      rank.className = `rank rank-${entry.rank}`;
      rank.textContent = entry.rank;
      name.className = 'player-name';
      name.textContent = entry.nickname;
      score.className = 'player-score';
      score.textContent = `${entry.score.toLocaleString()} 分`;
      row.append(rank, name, score);
      list.append(row);
    }
  }

  function setConnection(kind, text) {
    $('connection').className = `connection ${kind}`;
    $('connection-text').textContent = text;
    document.body.classList.toggle('offline', kind === 'offline');
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const [stateResponse, leaderboardResponse] = await Promise.all([
        fetch('/api/game-state', { cache: 'no-store' }),
        fetch('/api/leaderboard', { cache: 'no-store' })
      ]);
      if (!stateResponse.ok || !leaderboardResponse.ok) throw new Error('讀取失敗');
      const [nextState, leaderboard] = await Promise.all([
        stateResponse.json(), leaderboardResponse.json()
      ]);
      clockOffset = nextState.serverNow - Date.now();
      state = nextState;
      renderState();
      renderLeaderboard('round-leaderboard', leaderboard.roundLeaderboard);
      renderLeaderboard('cumulative-leaderboard', leaderboard.cumulativeLeaderboard);
      $('player-count').textContent = `${leaderboard.playerCount} / ${leaderboard.maxPlayers}`;
      $('last-updated').textContent = `最後同步 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`;
      setConnection('online', '即時連線');
    } catch (_error) {
      setConnection('offline', '連線中斷・自動重試');
    } finally {
      syncing = false;
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_error) { /* 瀏覽器不支援時維持一般畫面 */ }
  }

  function updateFullscreenLabel() {
    $('fullscreen').textContent = document.fullscreenElement ? '離開全螢幕' : '進入全螢幕';
  }

  $('fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenLabel);
  document.addEventListener('keydown', (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  });

  sync();
  setInterval(sync, 1000);
  setInterval(renderCountdown, 250);
})();
