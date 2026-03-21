# 漫画ライブラリ - Node.js/Express セキュアサーバー

Python の `http.server` から Node.js/Express に移植したバージョン。  
就活ポートフォリオとして、セキュリティ対策を明示的に実装している。

---

## 🛡 実装セキュリティ対策

| 対策 | 実装方法 | コード参照 |
|------|----------|-----------|
| **JWT認証** | `jsonwebtoken` / httpOnly Cookie | `authenticateToken()` |
| **パスワードハッシュ** | `bcryptjs` (saltRounds=12) | `POST /api/login` |
| **レートリミット** | `express-rate-limit` / ログイン専用制限 | `loginLimiter` |
| **HTTPヘッダー強化** | `helmet.js` (CSP / X-Frame / HSTS等) | `app.use(helmet(...))` |
| **ディレクトリトラバーサル** | `path.resolve()` + ベースDIR検証 | `safeResolvePath()` |
| **セッションハイジャック** | httpOnly + Secure + SameSite=Strict | Cookie設定部分 |
| **SQLインジェクション** | プリペアドステートメント (`better-sqlite3`) | `stmtFindUser.get()` |
| **HTTPS** | デプロイ先 (Railway/Render) が自動対応 | `NODE_ENV=production` |

---

## 📁 ディレクトリ構造

```
manga-viewer/
├── server.js           # メインサーバー（セキュリティ実装）
├── setup-user.js       # 初回ユーザー作成スクリプト
├── package.json
├── .env                # 環境変数（要作成）
├── .env.example        # 環境変数テンプレート
├── users.db            # SQLite（自動生成）
├── library_cache.json  # ライブラリキャッシュ（自動生成）
├── manga_data/         # 漫画ファイル置き場
└── web/                # フロントエンド
    ├── index.html
    ├── login.html      # 追加
    ├── auth.js         # 追加（認証ヘルパー）
    ├── app.js
    ├── fav.html
    ├── fav.js
    ├── style.css
    └── lib/
        ├── pdf.min.js
        └── pdf.worker.min.js
```

---

## 🚀 セットアップ

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を開いて `JWT_SECRET` を変更する（長いランダム文字列推奨）:

```bash
# JWTシークレット生成コマンド
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. 管理者ユーザーを作成

```bash
node setup-user.js
```

### 4. PDF.js をダウンロード

```bash
# web/lib/ フォルダを作成して配置
mkdir -p web/lib
```

または Python 版の `pdfjs_ダウンロード.bat` を先に実行しておく。

### 5. サーバー起動

```bash
node server.js
# または
npm start
```

→ `http://localhost:8000/` でログインページが表示される。

---

## 🌐 デプロイ (Railway)

### 環境変数設定
Railway の Variables に以下を追加:

| 変数名 | 値 |
|--------|-----|
| `JWT_SECRET` | ランダムな64文字以上の文字列 |
| `NODE_ENV` | `production` |
| `PORT` | `8000` (RailwayはPORTを自動設定するので不要でも可) |
| `MANGA_DIR` | `/app/manga_data` など |

### 注意点
- `manga_data/` の漫画ファイルは **GitHubに含めない** (`.gitignore` に追加)
- Railway の永続ストレージ (Volume) にマウントする
- `users.db` も永続化が必要

---

## 📝 API エンドポイント

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | `/api/login` | ❌ | ログイン (JWT発行) |
| POST | `/api/logout` | ❌ | ログアウト (Cookie削除) |
| GET  | `/api/me` | ✅ | 現在のユーザー情報 |
| GET  | `/api/library` | ✅ | ライブラリ一覧 |
| GET  | `/api/library/refresh` | ✅ | 再スキャン |
| GET  | `/api/library/status` | ✅ | キャッシュ状態 |
| GET  | `/api/volumes?title=` | ✅ | 巻一覧 |
| GET  | `/api/images?title=&folder=` | ✅ | 画像一覧 |
| GET  | `/api/image/:title/:file` | ✅ | 画像ファイル |
| GET  | `/api/pdf/:title/:file` | ✅ | PDFファイル |
| GET  | `/api/cover/:title` | ✅ | 表紙画像 |

---

## 🔒 セキュリティ詳細

### ディレクトリトラバーサル対策

```javascript
function safeResolvePath(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('Forbidden: Invalid path');
  }
  return resolved;
}
```

例えば `title = "../../etc/passwd"` のようなリクエストが来ても、
`MANGA_DIR` の外を参照しようとする時点で 403 を返す。

### JWTのhttpOnly Cookie管理

```javascript
res.cookie('token', token, {
  httpOnly: true,   // JS からアクセス不可 → XSS でのトークン盗難を防ぐ
  secure:   true,   // HTTPS のみ → 通信傍受を防ぐ
  sameSite: 'strict', // 他サイトのリクエストには付与しない → CSRF を防ぐ
  maxAge:   7200000,  // 2時間
});
```

### SQLインジェクション対策

```javascript
// ❌ 危険な例（文字列連結）
db.query(`SELECT * FROM users WHERE username = '${username}'`);

// ✅ 安全な例（プリペアドステートメント）
const user = stmtFindUser.get(username);
// → better-sqlite3 がプレースホルダー処理を行う
```
