/**
 * auth.js
 * フロントエンド用の認証ユーティリティ。
 *
 * app.js の先頭で <script src="auth.js"> として読み込む。
 *
 * 機能:
 * - APIリクエストの 401 レスポンスを検知してログインページへリダイレクト
 * - ログアウトボタンの処理
 * - ログイン状態の確認
 */

'use strict';

// ============================================================
//  認証済み fetch ラッパー
//  401 が返ってきたら自動でログインページへ遷移する
// ============================================================

window.authFetch = async function(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'same-origin' });

  if (res.status === 401) {
    // 未認証 → ログインページへ
    console.warn('[AUTH] 認証が必要です。ログインページへリダイレクト。');
    window.location.href = '/login.html';
    return null; // 後続処理を止める
  }

  return res;
};

// ============================================================
//  ログアウト
// ============================================================

window.logout = async function() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    window.location.href = '/login.html';
  }
};

// ============================================================
//  ページ読み込み時にログイン状態を確認する
// ============================================================

(async function checkAuth() {
  // login.html 自身では確認しない
  if (window.location.pathname.includes('login.html')) return;

  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/login.html';
    } else if (res.ok) {
      const data = await res.json();
      // ログインユーザー名を表示する要素があれば更新
      const el = document.getElementById('current-username');
      if (el) el.textContent = data.username;
    }
  } catch {
    // ネットワークエラー時はそのまま続行
  }
})();
