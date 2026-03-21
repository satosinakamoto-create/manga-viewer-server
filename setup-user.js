#!/usr/bin/env node
/**
 * setup-user.js
 * 初回セットアップ用スクリプト。管理者アカウントを作成する。
 *
 * 使い方:
 *   node setup-user.js
 *   node setup-user.js --username admin --password mypassword
 */

const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const readline = require("readline");
const path = require("path");

const DB_PATH = path.join(__dirname, "users.db");

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    DEFAULT (datetime('now'))
  )
`);

// コマンドライン引数から取得
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

async function createUser(username, password) {
  if (!username || username.length < 2) {
    console.error("❌  ユーザー名は2文字以上にしてください");
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("❌  パスワードは8文字以上にしてください");
    process.exit(1);
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);
  if (existing) {
    console.error(`❌  ユーザー "${username}" は既に存在します`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
    username,
    hash,
  );
  console.log(`✅  ユーザー "${username}" を作成しました`);
  db.close();
}

const cliUsername = getArg("--username");
const cliPassword = getArg("--password");

if (cliUsername && cliPassword) {
  createUser(cliUsername, cliPassword);
} else {
  // 対話モード
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));

  (async () => {
    console.log("=== 漫画ライブラリ ユーザー作成 ===\n");
    const username = await question("ユーザー名: ");
    const password = await question("パスワード (8文字以上): ");
    rl.close();
    await createUser(username.trim(), password.trim());
  })();
}
