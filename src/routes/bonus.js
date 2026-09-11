/*
 * 隱藏加分頁 /extrabigbonus。
 *
 * robots.txt 把這條路徑 Disallow 掉 —— 會去翻 robots.txt 的人才找得到它。
 * 這正是要講的點：robots.txt 是「請爬蟲不要索引」，不是存取控制，寫進去反而
 * 等於把秘密路徑公告出來。
 *
 * 身分沿用玩家在遊戲頁建立的同一組 token（同源，所以 localStorage 直接共用）。
 */
const path = require('path');
const express = require('express');
const { PUBLIC_DIR, MAX_POINTS } = require('../config');
const { isRoundActive } = require('../roundState');
const { getPlayer, cumulativeScore } = require('../players');

const router = express.Router();
const BONUS_POINTS = 1;

// 防腳本刷分：同一位玩家一秒內超過 30 次就冷卻 30 秒。
// 人手最快大約 10 下／秒，正常玩不會踩到這條線。
const MAX_CLICKS_PER_SECOND = 30;
const COOLDOWN_SECONDS = 30;

// 計數掛在玩家物件上，玩家離場就一起被回收，不需要額外的表或清理。
// 回傳還要等幾秒；0 代表放行。
function cooldownRemaining(player) {
  const now = Date.now();
  const state = player.bonusRate || (player.bonusRate = { windowStart: now, count: 0, cooldownUntil: 0 });

  if (now < state.cooldownUntil) return Math.ceil((state.cooldownUntil - now) / 1000);

  if (now - state.windowStart >= 1000) {
    state.windowStart = now;
    state.count = 0;
  }
  state.count += 1;
  if (state.count > MAX_CLICKS_PER_SECOND) {
    state.cooldownUntil = now + COOLDOWN_SECONDS * 1000;
    state.windowStart = now;
    state.count = 0;
    return COOLDOWN_SECONDS;
  }
  return 0;
}

router.get('/extrabigbonus', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'extrabigbonus.html'));
});

router.post('/api/bonus', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const player = getPlayer(token);
  // 這條刻意不寫 activity.log：一直點會把紀錄洗掉，也沒有講解價值。
  if (!player) return res.status(401).json({ error: 'token 無效，請先回遊戲頁建立帳號。' });
  // 非比賽時間加的分會在下一局開始時被清掉，與其讓人白點，不如直接說明。
  if (!isRoundActive()) return res.status(409).json({ error: '目前不是比賽時間，現在點不會計分。' });

  const cooldown = cooldownRemaining(player);
  if (cooldown > 0) {
    return res.status(429).json({ error: `點太快了，冷卻 ${cooldown} 秒後再試。`, retryAfter: cooldown });
  }

  player.score = Math.min(MAX_POINTS, player.score + BONUS_POINTS);
  res.json({
    ok: true,
    gained: BONUS_POINTS,
    nickname: player.nickname,
    score: player.score,
    cumulativeScore: cumulativeScore(player)
  });
});

module.exports = router;
