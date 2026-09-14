/*
 * 回合／活動狀態機。
 *
 * 一場活動由主辦方在 /admin 開始，之後「比賽 → 休息」自動輪替。每個階段的秒數
 * 在該階段開始的當下才從 settings 讀取，所以管理台改過的值會從下一局起生效。
 * 每局開始會重置所有人的本局狀態；每局結束會把本局分數累加進 SQLite。
 */
const { MAX_POINTS } = require('./config');
const settings = require('./settings');
const { log } = require('./log');
const { gameState, setRoundNumber } = require('./roundState');
const {
  players, plantings, resetPlayerForRound, persistRoundScore, clearAllPlayers
} = require('./players');

let transitionTimer = null;

function clearTransitionTimer() {
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = null;
}

// 任何「重新開始計時」的轉換都要把暫停快照清掉，免得舊的剩餘時間殘留下來。
function clearPauseSnapshot() {
  gameState.pausedFrom = null;
  gameState.remainingMs = null;
}

function settleCurrentRound() {
  const now = Date.now();
  for (const player of players.values()) {
    player.lastRoundScore = player.score;
    player.totalScore = Math.min(MAX_POINTS, player.totalScore + player.score);
    // The cumulative total is the part that has to outlive a restart.
    persistRoundScore(player, now);
  }
  log('round_settled', { roundNumber: gameState.roundNumber });
}

// advance=false 是給「接續開始」用的：重開後要接回原本的第 n 局，不是重新計數。
// 休息結束的自動輪替與「提早開始下一局」都不帶參數，照常進位。
function beginRound({ advance = true } = {}) {
  clearTransitionTimer();
  clearPauseSnapshot();
  // 秒數在每局開始的當下才讀取，所以管理台改過的值會從下一局起生效。
  const durationSeconds = settings.roundSeconds();
  gameState.phase = 'round';
  // 全新的資料庫接續時 roundNumber 還是 0，至少要從第 1 局開始。
  setRoundNumber(advance ? gameState.roundNumber + 1 : Math.max(1, gameState.roundNumber));
  gameState.phaseEndsAt = Date.now() + durationSeconds * 1000;
  plantings.clearAll();
  for (const player of players.values()) resetPlayerForRound(player);
  log('round_started', { roundNumber: gameState.roundNumber, durationSeconds });
  transitionTimer = setTimeout(finishRound, durationSeconds * 1000);
}

function finishRound() {
  if (gameState.phase !== 'round') return;
  clearTransitionTimer();
  clearPauseSnapshot();
  settleCurrentRound();
  const durationSeconds = settings.breakSeconds();
  gameState.phase = 'break';
  gameState.phaseEndsAt = Date.now() + durationSeconds * 1000;
  log('break_started', { afterRound: gameState.roundNumber, durationSeconds });
  transitionTimer = setTimeout(beginRound, durationSeconds * 1000);
}

function startEvent() {
  clearTransitionTimer();
  clearPauseSnapshot();
  // A new event is a true clean slate: remove player accounts, PINs, scores,
  // live sessions and planting rows. Admin accounts/settings/announcements stay.
  clearAllPlayers();
  setRoundNumber(0);
  log('event_started', {});
  beginRound();
}

// 暫停：不算遊戲也不算休息。把剩餘時間凍結起來，計時器停掉，玩家資料一律不動
// （帳號、累計分數、本局的錢與田地都原封不動）。暫停期間 isRoundActive() 為
// false，所以買種子／種植／收成／販售都會被擋下。
function pauseEvent() {
  clearTransitionTimer();
  gameState.pausedFrom = gameState.phase;
  gameState.remainingMs = gameState.phaseEndsAt ? Math.max(0, gameState.phaseEndsAt - Date.now()) : null;
  gameState.phase = 'paused';
  gameState.phaseEndsAt = null;
  log('event_paused', {
    roundNumber: gameState.roundNumber,
    from: gameState.pausedFrom,
    remainingMs: gameState.remainingMs
  });
}

// 繼續。兩種情況：
//   1. 有暫停快照 → 真正的解凍：回到原本那個階段，用剩下的時間把計時器接回去，
//      玩家的錢／種子／田地／本局分數完全不動。
//   2. 沒有快照（伺服器中途重開過，快照只在記憶體）→ 退回「用同一個局數重開
//      一局」，累計分數從 SQLite 接回來，但本局狀態會重置。
function resumeEvent() {
  clearTransitionTimer();
  const { pausedFrom, remainingMs } = gameState;

  if (pausedFrom && Number.isFinite(remainingMs)) {
    gameState.phase = pausedFrom;
    gameState.phaseEndsAt = Date.now() + remainingMs;
    clearPauseSnapshot();
    transitionTimer = setTimeout(pausedFrom === 'round' ? finishRound : beginRound, remainingMs);
    log('event_resumed', { roundNumber: gameState.roundNumber, phase: gameState.phase, remainingMs, frozen: true });
    return;
  }

  log('event_resumed', { fromRound: gameState.roundNumber, frozen: false });
  beginRound({ advance: false });
}

module.exports = { beginRound, finishRound, startEvent, resumeEvent, pauseEvent };
