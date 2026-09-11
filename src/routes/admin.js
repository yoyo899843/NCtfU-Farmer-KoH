/*
 * 管理台：頁面、登入／登出，以及活動與回合的控制。
 * 除了登入本身，每個端點都要帶有效的 session token。
 */
const path = require('path');
const express = require('express');
const { PUBLIC_DIR } = require('../config');
const { log } = require('../log');
const { admins, adminSessions } = require('../admins');
const settings = require('../settings');
const announcements = require('../announcements');
const { gameState, publicGameState, isRoundActive } = require('../roundState');
const { beginRound, finishRound, startEvent, resumeEvent, endEvent } = require('../rounds');

const router = express.Router();

function tokenFrom(req) {
  return req.body?.token || req.get('x-admin-token');
}

function requireAdmin(req, res) {
  if (!adminSessions.has(tokenFrom(req))) {
    res.status(401).json({ error: '請先登入管理帳號。' });
    return false;
  }
  return true;
}

// 包住「需要登入 + 檢查目前階段」這兩件每個控制端點都要做的事。
function control(guard, action) {
  return (req, res) => {
    if (!requireAdmin(req, res)) return;
    const problem = guard();
    if (problem) return res.status(409).json({ error: problem });
    action();
    res.json({ ok: true, gameState: publicGameState() });
  };
}

const notRunning = () => (gameState.phase === 'round' || gameState.phase === 'break' ? '活動已經進行中。' : null);

router.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

router.post('/api/admin/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ok = admins.verify(username, password);
  // The password is deliberately left out of the log.
  log('admin_login', { username, ok });
  if (!ok) return res.status(401).json({ error: '帳號或密碼錯誤。' });
  res.json({ ok: true, token: adminSessions.issue(), gameState: publicGameState() });
});

// Lets the admin page resume a saved session without asking for the password.
router.post('/api/admin/session', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, gameState: publicGameState() });
});

router.post('/api/admin/logout', (req, res) => {
  adminSessions.revoke(tokenFrom(req));
  res.json({ ok: true });
});

// 秒數可隨時改，但要等下一局才套用，免得正在跑的倒數突然跳動。
router.post('/api/admin/settings', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const saved = settings.update({
      roundSeconds: req.body?.roundSeconds,
      breakSeconds: req.body?.breakSeconds
    });
    log('settings_updated', saved);
    res.json({ ok: true, settings: saved, gameState: publicGameState() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* 公告 */
router.post('/api/admin/announcements', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const posted = announcements.post(req.body?.body);
    log('announcement_posted', { id: posted.id, body: posted.body });
    res.json({ ok: true, announcements: announcements.list() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/api/admin/announcements/delete', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    announcements.remove(req.body?.id);
    log('announcement_deleted', { id: Number(req.body?.id) });
    res.json({ ok: true, announcements: announcements.list() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/api/admin/announcements/clear', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const removed = announcements.clear();
  log('announcements_cleared', { removed });
  res.json({ ok: true, removed, announcements: announcements.list() });
});

router.post('/api/admin/start', control(notRunning, startEvent));
router.post('/api/admin/resume', control(notRunning, resumeEvent));
router.post('/api/admin/end-round', control(
  () => (isRoundActive() ? null : '目前不在比賽回合。'),
  finishRound
));
router.post('/api/admin/next-round', control(
  () => (gameState.phase === 'break' ? null : '目前不在休息時間。'),
  beginRound
));
router.post('/api/admin/end', control(
  () => (gameState.phase === 'waiting' || gameState.phase === 'ended' ? '活動尚未開始或已結束。' : null),
  endEvent
));

module.exports = router;
