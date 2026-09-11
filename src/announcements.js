/*
 * 公告：主辦方在管理台發佈，顯示在玩家頁的公告區。
 *
 * 存在 SQLite，所以伺服器重開不會消失。「開始新活動」刻意不清掉公告
 * （那是分數的事），要清空請用管理台的「全部清除」。
 */
const { db } = require('./db');

const MAX_LENGTH = 200;
const SHOW_LIMIT = 5;

const statements = {
  insert: db.prepare('INSERT INTO announcements (body, created_at) VALUES (?, ?)'),
  latest: db.prepare('SELECT id, body, created_at FROM announcements ORDER BY id DESC LIMIT ?'),
  remove: db.prepare('DELETE FROM announcements WHERE id = ?'),
  clear: db.prepare('DELETE FROM announcements')
};

// 最新的排在前面。
function list(limit = SHOW_LIMIT) {
  return statements.latest.all(limit)
    .map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }));
}

function post(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new Error('公告內容不能空白。');
  if (text.length > MAX_LENGTH) throw new Error(`公告最多 ${MAX_LENGTH} 個字，目前 ${text.length} 個。`);
  const info = statements.insert.run(text, Date.now());
  return { id: Number(info.lastInsertRowid), body: text };
}

function remove(id) {
  const parsed = Number(id);
  if (!Number.isInteger(parsed)) throw new Error('公告編號錯誤。');
  if (statements.remove.run(parsed).changes === 0) throw new Error('找不到這則公告。');
}

function clear() {
  return statements.clear.run().changes;
}

module.exports = { list, post, remove, clear, MAX_LENGTH, SHOW_LIMIT };
