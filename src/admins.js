/*
 * 管理員帳號與登入 session。
 *
 * 這個管理台「不是」CTF 的目標：密碼以 scrypt + 每組獨立 salt 雜湊，資料庫不存
 * 明文；登入後換成一組隨機 session token，密碼不會進到瀏覽器或 activity.log。
 */
const crypto = require('crypto');
const { db } = require('./db');
const { DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASSWORD } = require('./config');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

const statements = {
  find: db.prepare('SELECT username, password_hash, created_at FROM admin_accounts WHERE username = ?'),
  list: db.prepare('SELECT username, created_at FROM admin_accounts ORDER BY created_at'),
  count: db.prepare('SELECT COUNT(*) AS total FROM admin_accounts'),
  insert: db.prepare('INSERT INTO admin_accounts (username, password_hash, created_at) VALUES (?, ?, ?)'),
  setPassword: db.prepare('UPDATE admin_accounts SET password_hash = ? WHERE username = ?'),
  remove: db.prepare('DELETE FROM admin_accounts WHERE username = ?')
};

// Verifying a missing account still runs one scrypt pass, so "no such user"
// and "wrong password" take roughly the same time.
const ABSENT_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

const admins = {
  find: (username) => statements.find.get(String(username)),
  list: () => statements.list.all(),
  count: () => statements.count.get().total,
  add(username, password) {
    if (statements.find.get(username)) throw new Error(`管理員帳號 ${username} 已經存在。`);
    statements.insert.run(username, hashPassword(password), Date.now());
  },
  setPassword(username, password) {
    if (!statements.find.get(username)) throw new Error(`找不到管理員帳號 ${username}。`);
    statements.setPassword.run(hashPassword(password), username);
  },
  remove(username) {
    if (statements.remove.run(username).changes === 0) throw new Error(`找不到管理員帳號 ${username}。`);
  },
  verify(username, password) {
    const row = statements.find.get(String(username));
    const matches = verifyPassword(password, row ? row.password_hash : ABSENT_HASH);
    return Boolean(row) && matches;
  }
};

/*
 * 把 .env（或環境變數）裡的主控帳號套用到資料庫。每次啟動都會執行：
 *   - 帳號不存在 → 建立
 *   - 密碼與 .env 不同 → 更新成 .env 的值
 * 所以改 .env 重開就會生效。用 add-admin 另外建立的帳號不受影響。
 *
 * 完全沒設定 ADMIN_USER／ADMIN_PASSWORD 時只做一件事：資料庫一個管理員都沒有
 * 的話建立預設帳號。這樣用 script 刪掉的帳號不會在重開後自己跑回來。
 */
function applyEnvAdmin() {
  const username = process.env.ADMIN_USER || DEFAULT_ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  const usingDefaultPassword = password === DEFAULT_ADMIN_PASSWORD;

  if (!process.env.ADMIN_USER && !process.env.ADMIN_PASSWORD) {
    if (admins.count() > 0) return null;
    admins.add(username, password);
    return { username, action: 'created', usingDefaultPassword };
  }

  const existing = admins.find(username);
  if (!existing) {
    admins.add(username, password);
    return { username, action: 'created', usingDefaultPassword };
  }
  if (!verifyPassword(password, existing.password_hash)) {
    admins.setPassword(username, password);
    return { username, action: 'updated', usingDefaultPassword };
  }
  return { username, action: 'unchanged', usingDefaultPassword };
}

/* 登入 session：只存在記憶體，伺服器重開即全部失效。 */
const sessions = new Set();

const adminSessions = {
  issue() {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    return token;
  },
  has: (token) => typeof token === 'string' && sessions.has(token),
  revoke: (token) => { if (typeof token === 'string') sessions.delete(token); }
};

module.exports = { admins, adminSessions, hashPassword, verifyPassword, applyEnvAdmin };
