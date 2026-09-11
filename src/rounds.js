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
const { gameState } = require('./roundState');
const {
  players, plantings, resetPlayerForRound, persistRoundScore, clearAllPlayers
} = require('./players');

let transitionTimer = null;

function clearTransitionTimer() {
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = null;
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

function beginRound() {
  clearTransitionTimer();
  // 秒數在每局開始的當下才讀取，所以管理台改過的值會從下一局起生效。
  const durationSeconds = settings.roundSeconds();
  gameState.phase = 'round';
  gameState.roundNumber += 1;
  gameState.phaseEndsAt = Date.now() + durationSeconds * 1000;
  plantings.clearAll();
  for (const player of players.values()) resetPlayerForRound(player);
  log('round_started', { roundNumber: gameState.roundNumber, durationSeconds });
  transitionTimer = setTimeout(finishRound, durationSeconds * 1000);
}

function finishRound() {
  if (gameState.phase !== 'round') return;
  clearTransitionTimer();
  settleCurrentRound();
  const durationSeconds = settings.breakSeconds();
  gameState.phase = 'break';
  gameState.phaseEndsAt = Date.now() + durationSeconds * 1000;
  log('break_started', { afterRound: gameState.roundNumber, durationSeconds });
  transitionTimer = setTimeout(beginRound, durationSeconds * 1000);
}

function startEvent() {
  clearTransitionTimer();
  // A new event is a true clean slate: remove player accounts, PINs, scores,
  // live sessions and planting rows. Admin accounts/settings/announcements stay.
  clearAllPlayers();
  gameState.roundNumber = 0;
  log('event_started', {});
  beginRound();
}

// A restart mid-event lands back in 'waiting'.  This resumes play without
// wiping the cumulative scores that were just restored from SQLite.
function resumeEvent() {
  clearTransitionTimer();
  log('event_resumed', { fromRound: gameState.roundNumber });
  beginRound();
}

function endEvent() {
  clearTransitionTimer();
  if (gameState.phase === 'round') settleCurrentRound();
  gameState.phase = 'ended';
  gameState.phaseEndsAt = null;
  log('event_ended', { afterRound: gameState.roundNumber });
}

module.exports = { beginRound, finishRound, startEvent, resumeEvent, endEvent };
