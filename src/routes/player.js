/*
 * 玩家端的讀取與登入：設定、活動狀態、註冊／登入、自己的狀態、排行榜。
 */
const express = require('express');
const {
  SEEDS, MAX_PLAYERS, MAX_NICKNAME_LENGTH, STARTING_MONEY, STARTING_SCORE,
  VISIBLE_PLOT_COUNT, HIDDEN_PLOT_COUNT, PLOT_COUNT
} = require('../config');
const { log } = require('../log');
const announcements = require('../announcements');
const { publicGameState, isRoundActive } = require('../roundState');
const {
  players, safePlayer, getPlayer, logoutPlayer, activePlayerByNickname, findAccount, createPlayer, cumulativeTotals
} = require('../players');

const router = express.Router();

router.get('/api/config', (_req, res) => {
  res.json({
    seeds: SEEDS,
    maxPlayers: MAX_PLAYERS,
    startingMoney: STARTING_MONEY,
    startingScore: STARTING_SCORE,
    // 前端靠這兩個數字把田地切成「看得到的」與「藏起來的」兩區。
    visiblePlotCount: VISIBLE_PLOT_COUNT,
    hiddenPlotCount: HIDDEN_PLOT_COUNT,
    plotCount: PLOT_COUNT
  });
});

router.get('/api/game-state', (_req, res) => {
  res.json(publicGameState());
});

// 公告是公開的，不需要 token；玩家頁與管理台都讀這一支。
router.get('/api/announcements', (_req, res) => {
  res.json({ announcements: announcements.list() });
});

// Doubles as login: a known nickname must present the PIN that created it, and
// its cumulative score is restored from SQLite.
router.post('/api/register', (req, res) => {
  const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.trim() : '';
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  log('register', { nickname, pin });

  if (!nickname || nickname.length > MAX_NICKNAME_LENGTH) {
    return res.status(400).json({ error: `暱稱需為 1～${MAX_NICKNAME_LENGTH} 個字元。` });
  }
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'PIN 必須是 6 位數字。' });

  const account = findAccount(nickname);
  if (account && account.pin !== pin) return res.status(401).json({ error: '這個暱稱已經有人用了，PIN 不正確。' });

  // Same nickname still seated: hand back the existing session so a reconnect
  // never resets money or re-keys the planting rows.
  const seated = activePlayerByNickname(nickname);
  if (seated) return res.json({ token: seated.token, player: safePlayer(seated) });

  if (players.size >= MAX_PLAYERS) return res.status(403).json({ error: `本場活動的 ${MAX_PLAYERS} 個玩家名額已滿。` });

  const player = createPlayer(nickname, pin, account);
  res.json({ token: player.token, player: safePlayer(player) });
});

router.post('/api/logout', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const player = logoutPlayer(token);
  log('logout', { nickname: player?.nickname || null, ok: Boolean(player) });
  // Logging out is idempotent: a repeated request still leaves the browser in
  // the desired logged-out state.
  res.json({ ok: true });
});

router.get('/api/me', (req, res) => {
  const player = getPlayer(req.query.token);
  log('me', req.query);
  if (!player) return res.status(401).json({ error: 'token 無效。' });
  res.json({ player: safePlayer(player) });
});

router.get('/api/leaderboard', (_req, res) => {
  const roundScore = (player) => isRoundActive() ? player.score : player.lastRoundScore;
  const roundLeaderboard = [...players.values()]
    .sort((a, b) => roundScore(b) - roundScore(a) || a.nickname.localeCompare(b.nickname, 'zh-Hant'))
    .slice(0, 3)
    .map((player, index) => ({ rank: index + 1, nickname: player.nickname, score: roundScore(player) }));

  const cumulativeLeaderboard = [...cumulativeTotals().entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
    .slice(0, 3)
    .map(([nickname, score], index) => ({ rank: index + 1, nickname, score }));

  res.json({ roundLeaderboard, cumulativeLeaderboard, playerCount: players.size, maxPlayers: MAX_PLAYERS });
});

module.exports = router;
