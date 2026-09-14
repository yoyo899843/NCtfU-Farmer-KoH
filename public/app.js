/*
 * Workshop note: the server sends planting timestamps directly to this browser.
 * Maturity is deliberately trusted to the client; do not reuse in a real app.
 */
const sessionKey = 'ctf-farmer-session-v1';
let session = JSON.parse(localStorage.getItem(sessionKey) || 'null');
let config;
let player;
let gameState = { phase: 'waiting', roundNumber: 0, phaseEndsAt: null };
let serverClockOffset = 0;

const $ = (id) => document.getElementById(id);
const request = async (url, options) => {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '操作失敗。');
  return body;
};
const seed = (seedtype) => config.seeds[seedtype];
const formatTime = (seconds) => {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes} 分 ${remainingSeconds} 秒`;
};

async function refresh() {
  if (!session) return;
  try {
    const data = await request(`/api/me?token=${encodeURIComponent(session.token)}`);
    player = data.player;
    // Deliberately exposed workshop state: DevTools can alter plantedAt here.
    window.player = player;
    render();
  } catch (error) {
    localStorage.removeItem(sessionKey);
    session = null;
    $('game').style.display = 'none';
    $('login').style.display = 'block';
    $('login-error').textContent = error.message;
  }
}

function render() {
  $('welcome').textContent = `農夫 ${player.nickname}`;
  renderStats();
  renderPlots(); renderShop(); renderStock(); updateLeaderboard();
}

function renderStats() {
  $('money').textContent = player.money.toLocaleString();
  $('score').textContent = player.score.toLocaleString();
  $('cumulative-score').textContent = player.cumulativeScore.toLocaleString();
}

function plotTile(plot, index, labelText) {
  const label = `<span class="plot-label">${labelText}</span>`;
  if (!plot) {
    return `<article class="plot">${label}<span class="plot-crop">空地</span><div class="row">${seedSelect(index)}</div></article>`;
  }
  const kind = seed(plot.seedtype);
  // plantedAt is intentionally exposed as a DOM data attribute so it can be
  // changed directly in DevTools. The server never validates elapsed time.
  // data-crop-image 讓 updateCropTimers 不用再查 config 就能換圖。
  return `<article class="plot" data-plot-index="${index}" data-planted-at="${plot.plantedAt}" data-grow-seconds="${kind.growSeconds}" data-crop-image="${kind.image}">${label}<img class="crop-img" alt=""><span class="plot-crop">${kind.name}</span><span class="crop-status"></span><button class="harvest-button" disabled>等待成熟</button></article>`;
}

function renderPlots() {
  // 前 visiblePlotCount 格畫在正常農地，其餘畫進用 hidden 藏起來的那一區。
  // 這裡只寫內容、從不去碰 #hidden-farm-panel 的 hidden 屬性——玩家在
  // DevTools 刪掉之後，不會被下一次重繪加回去。
  const visibleCount = config.visiblePlotCount;
  $('plots').innerHTML = player.plots
    .slice(0, visibleCount)
    .map((plot, index) => plotTile(plot, index, `田地 ${index + 1}`))
    .join('');
  $('hidden-plots').innerHTML = player.plots
    .slice(visibleCount)
    .map((plot, offset) => plotTile(plot, visibleCount + offset, `田地 ${offset + 1}`))
    .join('');
  updateCropTimers();
}

function updateCropTimers() {
  // 兩區農地都要跑倒數，所以不限定在 #plots 底下。
  document.querySelectorAll('.plot[data-planted-at]').forEach((plotElement) => {
    // INTENTIONALLY VULNERABLE: both values are browser-controlled.
    const plantedAt = Number(plotElement.dataset.plantedAt);
    const growMilliseconds = Number(plotElement.dataset.growSeconds) * 1000;
    const elapsed = Date.now() - plantedAt;
    const mature = elapsed >= growMilliseconds;
    const remaining = Math.max(0, Math.ceil((growMilliseconds - elapsed) / 1000));
    const status = plotElement.querySelector('.crop-status');
    const button = plotElement.querySelector('.harvest-button');
    const image = plotElement.querySelector('.crop-img');

    // 生長三階段：前半用種子圖、後半用發芽圖、時間到換成收成圖。
    // 只有真的換階段時才寫 src，否則每秒重設會讓瀏覽器重新載入、畫面閃動。
    // 這段一樣吃 DevTools 改過的 data-planted-at，改成 0 會直接跳到收成圖。
    if (image) {
      const crop = plotElement.dataset.cropImage;
      const stage = mature
        ? `/images/harvest/${crop}.png`
        : elapsed >= growMilliseconds / 2
          ? '/images/buds/bud.png'
          : `/images/seeds/${crop}.png`;
      if (image.getAttribute('src') !== stage) image.setAttribute('src', stage);
    }

    if (gameState.phase !== 'round') {
      status.textContent = '目前不是比賽時間';
      button.disabled = true;
      button.textContent = '暫停操作';
      button.onclick = null;
      return;
    }

    status.textContent = mature ? '可收成！' : `剩餘 ${formatTime(remaining)}`;
    button.disabled = !mature;
    button.textContent = mature ? '收成' : '等待成熟';
    button.onclick = mature ? () => harvest(Number(plotElement.dataset.plotIndex)) : null;
  });
}

function seedSelect(index) {
  const options = Object.entries(config.seeds)
    .map(([key, item]) => `<option value="${key}">${item.name}（種子 ${player.seeds[key]}）</option>`)
    .join('');
  return `<select id="seed-${index}">${options}</select><button onclick="plant(${index})">種下</button>`;
}

function renderShop() {
  $('shop').innerHTML = Object.entries(config.seeds).map(([key, item]) => `<div class="shop-row"><span><strong>${item.name}</strong>　<small>持有 ${player.seeds[key]}</small><br><small>${item.price} 元／顆・成長 ${formatTime(item.growSeconds)}・賣出 ${item.price * 1.5} 元、+${item.score} 分</small></span><span class="shop-buy"><input id="count-${key}" type="number" min="1" max="99" value="1" aria-label="${item.name}數量"><button onclick="buy('${key}')">購買</button></span></div>`).join('');
}

function renderStock() {
  $('stock').innerHTML = Object.entries(config.seeds).map(([key, item]) => `<div class="stock-row"><span><strong>${item.name}</strong>　<small>作物 ${player.crops[key]}</small><br><small>${player.crops[key] ? `可賣 ${item.price * 1.5 * player.crops[key]} 元、+${item.score * player.crops[key]} 分` : '目前沒有可賣的作物'}</small></span><button ${player.crops[key] ? '' : 'disabled'} onclick="sell('${key}')">賣出全部</button></div>`).join('');
}

function showShopTab(which) {
  const buying = which === 'buy';
  $('tab-buy').setAttribute('aria-selected', String(buying));
  $('tab-sell').setAttribute('aria-selected', String(!buying));
  $('shop').hidden = !buying;
  $('stock').hidden = buying;
}

async function updateLeaderboard() {
  const data = await (await fetch('/api/leaderboard')).json();
  const renderRows = (list, entries) => {
    list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = '尚無玩家';
      list.append(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('li');
      // Nicknames are player-controlled. Keep them as text so leaderboard
      // updates cannot turn a stored nickname into executable HTML.
      row.textContent = `${entry.nickname} — ${entry.score.toLocaleString()} 分`;
      list.append(row);
    }
  };
  renderRows($('round-leaderboard'), data.roundLeaderboard);
  renderRows($('cumulative-leaderboard'), data.cumulativeLeaderboard);
  $('player-count').textContent = `${data.playerCount} / ${data.maxPlayers} 位玩家`;
}

async function updateAnnouncements() {
  try {
    const data = await (await fetch('/api/announcements')).json();
    const list = $('announcements');
    list.replaceChildren();
    for (const item of data.announcements) {
      const row = document.createElement('li');
      const stamp = document.createElement('time');
      stamp.textContent = new Date(item.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      const body = document.createElement('span');
      // 用 textContent 而不是 innerHTML：公告不該變成另一個 XSS 破口。
      body.textContent = item.body;
      row.append(stamp, body);
      list.append(row);
    }
    $('announcements-panel').hidden = data.announcements.length === 0;
  } catch (_error) { /* 下一輪再試 */ }
}

function renderGameState() {
  const labels = {
    waiting: '等待主辦方開始活動',
    round: `第 ${gameState.roundNumber} 局進行中`,
    break: `第 ${gameState.roundNumber} 局已結算，休息中`,
    paused: `第 ${gameState.roundNumber} 局暫停中`
  };
  $('phase-label').textContent = labels[gameState.phase] || '狀態未知';
  const remaining = gameState.phaseEndsAt
    ? Math.max(0, Math.ceil((gameState.phaseEndsAt - (Date.now() + serverClockOffset)) / 1000))
    : null;
  $('phase-countdown').textContent = remaining === null ? '' : `剩餘 ${formatTime(remaining)}`;
  document.body.classList.toggle('round-inactive', gameState.phase !== 'round');
  if (player) updateCropTimers();
}

async function updateGameState() {
  try {
    const previousPhase = gameState.phase;
    const previousRound = gameState.roundNumber;
    const data = await (await fetch('/api/game-state')).json();
    serverClockOffset = data.serverNow - Date.now();
    gameState = data;
    window.gameState = gameState;
    renderGameState();
    if (player && (previousPhase !== gameState.phase || previousRound !== gameState.roundNumber)) {
      await refresh();
    }
  } catch (_error) {
    $('phase-label').textContent = '無法讀取活動狀態';
  }
}

function buy(seedtype) {
  const count = Number($(`count-${seedtype}`).value);
  if (!Number.isInteger(count) || count < 1 || count > 99) return say('請輸入 1～99 的數量。');
  const totalprice = seed(seedtype).price * count;
  // The new tab intentionally exposes the full GET URL for the workshop challenge.
  window.open(`/buy_seed?token=${encodeURIComponent(session.token)}&seedtype=${encodeURIComponent(seedtype)}&count=${count}&totalprice=${totalprice}`, '_blank');
  say('已在新分頁送出購買；回來後稍候會同步庫存。');
}

async function syncInventory() {
  if (!session || !player) return;
  try {
    const data = await request(`/api/me?token=${encodeURIComponent(session.token)}`);
    // Keep the browser's existing plot timestamps intact for the CTF exercise.
    player.money = data.player.money;
    player.score = data.player.score;
    player.cumulativeScore = data.player.cumulativeScore;
    player.seeds = data.player.seeds;
    player.crops = data.player.crops;
    renderStats();
    renderShop();
    renderStock();
  } catch (error) { say(error.message); }
}

async function plant(index) {
  const seedtype = $(`seed-${index}`).value;
  try {
    await request(`/plant?token=${encodeURIComponent(session.token)}&plot=${index}&seedtype=${encodeURIComponent(seedtype)}`);
    say('已種下，開始計時。'); await refresh();
  } catch (error) { say(error.message); }
}

async function harvest(index) {
  try {
    const result = await request(`/harvest?token=${encodeURIComponent(session.token)}&plot=${index}`);
    say(result.message); await refresh();
  } catch (error) { say(error.message); }
}

async function sell(seedtype) {
  try {
    const count = player.crops[seedtype];
    const result = await request(`/sell?token=${encodeURIComponent(session.token)}&seedtype=${encodeURIComponent(seedtype)}&count=${count}`);
    say(`賣出成功，獲得 ${result.earnedMoney} 元與 ${result.earnedScore} 分。`); await refresh();
  } catch (error) { say(error.message); }
}

function say(message) { $('notice').textContent = message; }

$('tab-buy').addEventListener('click', () => showShopTab('buy'));
$('tab-sell').addEventListener('click', () => showShopTab('sell'));

function showLoggedOut() {
  localStorage.removeItem(sessionKey);
  session = null;
  player = null;
  delete window.player;
  $('game').style.display = 'none';
  $('login').style.display = 'block';
  $('pin').value = '';
  $('login-error').textContent = '';
  $('nickname').focus();
}

$('logout-player').addEventListener('click', async () => {
  const token = session?.token;
  showLoggedOut();
  if (!token) return;
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true
    });
  } catch (_error) {
    // The local logout has already completed. A network error should not trap
    // the user on the game screen.
  }
});

$('register').addEventListener('click', async () => {
  const nickname = $('nickname').value;
  const pin = $('pin').value;
  try {
    const data = await request('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, pin }) });
    session = { token: data.token }; localStorage.setItem(sessionKey, JSON.stringify(session));
    player = data.player; window.player = player;
    $('login').style.display = 'none'; $('game').style.display = 'block';
    render(); updateAnnouncements();
  } catch (error) { $('login-error').textContent = error.message; }
});

window.addEventListener('message', (event) => {
  if (event.origin === location.origin && event.data?.type === 'farmer-purchase-complete') {
    syncInventory();
  }
});

(async () => {
  config = await (await fetch('/api/config')).json();
  await updateGameState();
  if (session) { $('login').style.display = 'none'; $('game').style.display = 'block'; await refresh(); }
  // Rankings refresh periodically, but the player's crop/timestamp is not
  // re-fetched. Maturity therefore remains entirely a local browser decision.
  if (session) updateAnnouncements();
  setInterval(() => { if (session) { updateLeaderboard(); updateAnnouncements(); } }, 3000);
  setInterval(updateGameState, 1000);
  setInterval(() => {
    if (!session || !player) return;
    // Update only text/button state. The plot DOM and seed dropdowns are never
    // replaced by the timer, and DevTools edits to data-planted-at persist.
    updateCropTimers();
  }, 1000);
})();
