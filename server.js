/**
 * server.js - 漫画ライブラリ Node.js/Express サーバー
 *
 * ■ セキュリティ対策一覧
 * ┌────────────────────────────────────────────────────────────┐
 * │  1. JWT認証           httpOnly Cookie でトークン管理        │
 * │  2. bcryptハッシュ     パスワードをソルト付きで保存         │
 * │  3. レートリミット     一般API: 100req/15min                │
 * │                       ログイン: 10req/15min (BF対策)        │
 * │  4. Helmet.js         X-Frame-Options / CSP / HSTS 等      │
 * │  5. ディレクトリ      path.resolve でベースDIR外アクセス遮断│
 * │     トラバーサル対策                                        │
 * │  6. セッション        httpOnly + Secure + SameSite=Strict   │
 * │     ハイジャック対策   でCookieを設定                       │
 * │  7. SQLインジェクション プリペアドステートメント使用        │
 * │  8. HTTPS             デプロイ先 (Railway/Render) が対応    │
 * └────────────────────────────────────────────────────────────┘
 */

"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");

// ============================================================
//  設定
// ============================================================

const PORT = process.env.PORT || 8000;
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn("⚠  JWT_SECRETが未設定です。.envファイルを確認してください。");
    return "insecure-default-secret-change-this";
  })();
const NODE_ENV = process.env.NODE_ENV || "development";
const MANGA_DIR = path.resolve(process.env.MANGA_DIR || "./manga_data");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const DISK_CACHE_FILE = path.join(__dirname, "library_cache.json");

// ============================================================
//  データベース初期化 (SQLite)
// ============================================================

const db = new Database(path.join(__dirname, "users.db"));

// テーブル作成（存在しない場合のみ）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    DEFAULT (datetime('now'))
  )
`);

// プリペアドステートメント（SQLインジェクション対策）
// ユーザー検索・作成を必ずこれ経由で行う
const stmtFindUser = db.prepare("SELECT * FROM users WHERE username = ?");
const stmtInsertUser = db.prepare(
  "INSERT INTO users (username, password_hash) VALUES (?, ?)",
);

// ============================================================
//  Express アプリ初期化
// ============================================================

const app = express();

// ============================================================
//  セキュリティ: Helmet.js (HTTPヘッダー強化)
// ============================================================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        workerSrc: ["'self'", "blob:", "cdnjs.cloudflare.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // HSTS: HTTPS を強制 (本番環境でのみ有効)
    hsts:
      NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    // クリックジャッキング対策
    frameguard: { action: "deny" },
  }),
);

// ============================================================
//  セキュリティ: レートリミット
// ============================================================

// 一般API: 15分間に100リクエストまで
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// ログインAPI専用: 15分間に10リクエストまで（ブルートフォース対策）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes." },
  skipSuccessfulRequests: true, // 成功したリクエストはカウントしない
});

app.use(generalLimiter);

// ============================================================
//  ミドルウェア
// ============================================================

app.use(cookieParser());
app.use(express.json({ limit: "1mb" })); // リクエストボディサイズ制限

// ============================================================
//  セキュリティ: JWT認証ミドルウェア
// ============================================================

/**
 * 保護されたルートに適用するミドルウェア。
 * httpOnly Cookie からトークンを取り出して検証する。
 *
 * セッションハイジャック対策:
 * - httpOnly: JSからCookieにアクセス不可 → XSS経由でのトークン盗難を防ぐ
 * - Secure:   HTTPS通信でのみCookieを送信 → 盗聴対策
 * - SameSite: 他サイトからのリクエストにCookieを付けない → CSRF対策
 */
function authenticateToken(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    // 期限切れや改ざんされたトークン
    res.clearCookie("token");
    return res
      .status(401)
      .json({ error: "Invalid or expired token. Please log in again." });
  }
}

// ============================================================
//  セキュリティ: ディレクトリトラバーサル対策
// ============================================================

/**
 * ベースディレクトリの外への脱出を防ぐパス解決関数。
 *
 * 例: title = "../../etc/passwd" のような攻撃を防ぐ
 *
 * @param {string} base  - 許可するベースディレクトリの絶対パス
 * @param {...string} parts - 結合するパス部品
 * @returns {string} 解決された絶対パス
 * @throws  {Error}  ベースDIRの外を指している場合
 */
function safeResolvePath(base, ...parts) {
  const decodedParts = parts.map((p) => decodeURIComponent(p));
  const resolved = path.resolve(base, ...decodedParts);

  if (
    !resolved.startsWith(path.resolve(base) + path.sep) &&
    resolved !== path.resolve(base)
  ) {
    // ログに記録して拒否
    console.warn(`[SECURITY] Directory traversal attempt: ${parts.join("/")}`);
    throw new Error("Forbidden: Invalid path");
  }
  return resolved;
}

// ============================================================
//  ユーティリティ
// ============================================================

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function isPdfFile(filename) {
  return filename.toLowerCase().endsWith(".pdf");
}

/** cover.* を除いた漫画ページ画像を自然順ソートで返す */
function getMangaPageImages(folderPath) {
  try {
    return fs
      .readdirSync(folderPath)
      .filter((f) => isImageFile(f) && !f.toLowerCase().startsWith("cover."))
      .sort(naturalSort);
  } catch {
    return [];
  }
}

function getAllImageFiles(folderPath) {
  try {
    return fs
      .readdirSync(folderPath)
      .filter((f) => isImageFile(f))
      .sort(naturalSort);
  } catch {
    return [];
  }
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function loadMetadata(titlePath) {
  const metaFile = path.join(titlePath, "metadata.json");
  if (fs.existsSync(metaFile)) {
    try {
      return JSON.parse(fs.readFileSync(metaFile, "utf-8"));
    } catch {
      return {};
    }
  }
  return { author: "", publisher: "", genre: [] };
}

// ============================================================
//  ライブラリキャッシュ
// ============================================================

let _libraryCache = null;
let _cacheReady = false;

function saveDiskCache(library) {
  try {
    const tmp = DISK_CACHE_FILE + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          version: 3,
          saved_at: Date.now(),
          manga_dir: MANGA_DIR,
          data: library,
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.renameSync(tmp, DISK_CACHE_FILE);
    console.log(`💾  ディスクキャッシュ保存: ${library.length}件`);
  } catch (e) {
    console.error("ディスクキャッシュ保存エラー:", e.message);
  }
}

function loadDiskCache() {
  if (!fs.existsSync(DISK_CACHE_FILE)) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(DISK_CACHE_FILE, "utf-8"));
    if (cache.version < 3 || cache.manga_dir !== MANGA_DIR) return null;
    const ageHours = (Date.now() - cache.saved_at) / 3600000;
    console.log(
      `📀  ディスクキャッシュ読み込み: ${cache.data.length}件 (${ageHours.toFixed(1)}時間前)`,
    );
    return cache.data;
  } catch {
    return null;
  }
}

function buildLibraryList() {
  const library = [];
  if (!fs.existsSync(MANGA_DIR)) return library;

  const items = fs.readdirSync(MANGA_DIR).sort(naturalSort);
  console.log(`🔍  スキャン開始: ${items.length}件`);

  for (const item of items) {
    const itemPath = path.join(MANGA_DIR, item);

    // manga_data直下のPDF
    if (isPdfFile(item)) {
      const title = path.basename(item, ".pdf");
      library.push({
        title,
        cover: `/api/cover/_pdf/${encodeURIComponent(item)}`,
        volume_count: 1,
        metadata: { author: "", publisher: "", genre: [] },
        is_direct_pdf: true,
      });
      continue;
    }

    if (!fs.statSync(itemPath).isDirectory()) continue;

    const directImages = getMangaPageImages(itemPath);
    const hasDirectImages = directImages.length > 0;

    let volumeCount = 0;
    if (hasDirectImages) {
      volumeCount = 1;
    } else {
      const pdfs = fs.readdirSync(itemPath).filter(isPdfFile);
      volumeCount += pdfs.length;
      for (const sub of fs.readdirSync(itemPath)) {
        const subPath = path.join(itemPath, sub);
        if (fs.statSync(subPath).isDirectory() && sub !== ".cache") {
          if (getMangaPageImages(subPath).length > 0) volumeCount++;
        }
      }
    }

    if (volumeCount === 0) continue;

    library.push({
      title: item,
      cover: `/api/cover/${encodeURIComponent(item)}`,
      volume_count: volumeCount,
      metadata: loadMetadata(itemPath),
      has_direct_images: hasDirectImages,
    });
  }

  console.log(`✅  スキャン完了: ${library.length}件`);
  return library;
}

function initializeCache() {
  const disk = loadDiskCache();
  if (disk) {
    _libraryCache = disk;
    _cacheReady = true;
    // バックグラウンドで差分確認
    setImmediate(() => {
      const fresh = buildLibraryList();
      _libraryCache = fresh;
      saveDiskCache(fresh);
    });
  } else {
    setImmediate(() => {
      _libraryCache = buildLibraryList();
      _cacheReady = true;
      saveDiskCache(_libraryCache);
    });
  }
}

// ============================================================
//  表紙パス解決
// ============================================================

function findSeriesCoverPath(titlePath) {
  // cover.* ファイルを優先
  try {
    const coverFiles = fs
      .readdirSync(titlePath)
      .filter((f) => f.toLowerCase().startsWith("cover.") && isImageFile(f));
    if (coverFiles.length > 0) {
      return path.join(titlePath, coverFiles.sort()[0]);
    }
  } catch {
    /* ignore */
  }

  // 直下の漫画ページ先頭
  const direct = getMangaPageImages(titlePath);
  if (direct.length > 0) return path.join(titlePath, direct[0]);

  // サブフォルダ先頭
  try {
    const items = fs.readdirSync(titlePath).sort(naturalSort);
    for (const item of items) {
      const itemPath = path.join(titlePath, item);
      const stat = fs.statSync(itemPath);
      if (isPdfFile(item)) {
        // PDFキャッシュを確認（Python側で作成済みの場合）
        const baseName = path.basename(item, ".pdf");
        const cachedCover = path.join(
          titlePath,
          ".cache",
          `${baseName}_cover.jpg`,
        );
        if (fs.existsSync(cachedCover)) return cachedCover;
      }
      if (stat.isDirectory() && item !== ".cache") {
        const imgs = getAllImageFiles(itemPath);
        if (imgs.length > 0) return path.join(itemPath, imgs[0]);
      }
    }
  } catch {
    /* ignore */
  }

  return null;
}

function findPdfCoverPath(dirPath, filename) {
  // Python が事前に抽出したキャッシュを使用
  const baseName = path.basename(filename, ".pdf");
  const cachedCover = path.join(dirPath, ".cache", `${baseName}_cover.jpg`);
  if (fs.existsSync(cachedCover)) return cachedCover;
  return null;
}

// ============================================================
//  認証ルート
// ============================================================

/**
 * POST /api/login
 * ログイン。成功時に httpOnly Cookie でJWTを発行する。
 *
 * ブルートフォース対策: loginLimiter (15分間に10回まで)
 * SQLインジェクション対策: プリペアドステートメント使用
 */
app.post("/api/login", loginLimiter, (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  // プリペアドステートメントで検索（SQLインジェクション対策）
  const user = stmtFindUser.get(username);

  // タイミング攻撃対策: ユーザーが存在しない場合でも比較処理を実行する
  const dummyHash = "$2a$12$invalidhashinvalidhashinvalidhashinvalid";
  const hashToCompare = user ? user.password_hash : dummyHash;
  const isValid = bcrypt.compareSync(password, hashToCompare);

  if (!user || !isValid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  // JWTトークン生成 (有効期限: 2時間)
  const token = jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "2h", issuer: "manga-library" },
  );

  /**
   * セッションハイジャック対策 Cookie 設定:
   * - httpOnly: JavaScriptからアクセス不可 → XSS でのトークン窃取を防ぐ
   * - secure:   HTTPS でのみ送信 → 通信傍受によるトークン窃取を防ぐ
   * - sameSite: 他サイトのリクエストには付与しない → CSRF を防ぐ
   */
  res.cookie("token", token, {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 2 * 60 * 60 * 1000, // 2時間
  });

  console.log(`[LOGIN] ユーザー "${user.username}" がログインしました`);
  res.json({ success: true, username: user.username });
});

/**
 * POST /api/logout
 * Cookieを削除してログアウト。
 */
app.post("/api/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "strict" });
  res.json({ success: true });
});

/**
 * GET /api/me
 * 現在のログイン状態を確認する。
 */
app.get("/api/me", authenticateToken, (req, res) => {
  res.json({ username: req.user.username });
});

// ============================================================
//  ライブラリ API (要認証)
// ============================================================

app.get("/api/library", authenticateToken, (req, res) => {
  if (!_cacheReady) {
    // キャッシュ未準備の場合は同期スキャン（初回起動）
    _libraryCache = buildLibraryList();
    _cacheReady = true;
    saveDiskCache(_libraryCache);
  }
  res.json(_libraryCache ?? []);
});

app.get("/api/library/status", authenticateToken, (req, res) => {
  res.json({
    ready: _cacheReady,
    count: _libraryCache?.length ?? 0,
    disk_cache_exists: fs.existsSync(DISK_CACHE_FILE),
  });
});

app.get("/api/library/refresh", authenticateToken, (req, res) => {
  // ディスクキャッシュを削除して完全再スキャン
  if (fs.existsSync(DISK_CACHE_FILE)) {
    try {
      fs.unlinkSync(DISK_CACHE_FILE);
    } catch {
      /* ignore */
    }
  }
  _libraryCache = buildLibraryList();
  _cacheReady = true;
  saveDiskCache(_libraryCache);
  res.json(_libraryCache);
});

app.get("/api/volumes", authenticateToken, (req, res) => {
  const { title, is_direct_pdf } = req.query;

  if (!title) {
    return res.status(400).json({ error: "title parameter is required" });
  }

  const volumes = [];

  try {
    if (is_direct_pdf === "true") {
      const pdfFilename = `${title}.pdf`;
      const pdfPath = safeResolvePath(MANGA_DIR, pdfFilename);
      if (fs.existsSync(pdfPath)) {
        volumes.push({
          type: "pdf_direct",
          volume: title,
          filename: pdfFilename,
          cover: `/api/cover/_pdf/${encodeURIComponent(pdfFilename)}`,
          pdf_url: `/api/pdf/_direct/${encodeURIComponent(pdfFilename)}`,
        });
      }
      return res.json(volumes);
    }

    // ディレクトリトラバーサル対策: safeResolvePath でパスを検証
    const titlePath = safeResolvePath(MANGA_DIR, title);

    if (!fs.existsSync(titlePath)) {
      return res.status(404).json({ error: "Title not found" });
    }

    const directImages = getMangaPageImages(titlePath);
    if (directImages.length > 0) {
      volumes.push({
        type: "images_direct",
        volume: title,
        folder_name: "",
        cover: `/api/image/${encodeURIComponent(title)}/${encodeURIComponent(directImages[0])}`,
        image_count: directImages.length,
      });
    } else {
      // PDFファイル
      const pdfs = fs
        .readdirSync(titlePath)
        .filter(isPdfFile)
        .sort(naturalSort);
      for (const pdf of pdfs) {
        volumes.push({
          type: "pdf",
          volume: path.basename(pdf, ".pdf"),
          filename: pdf,
          cover: `/api/cover/${encodeURIComponent(title)}/${encodeURIComponent(pdf)}`,
          pdf_url: `/api/pdf/${encodeURIComponent(title)}/${encodeURIComponent(pdf)}`,
        });
      }
      // 画像サブフォルダ
      for (const item of fs.readdirSync(titlePath).sort(naturalSort)) {
        const itemPath = path.join(titlePath, item);
        if (fs.statSync(itemPath).isDirectory() && item !== ".cache") {
          const images = getMangaPageImages(itemPath);
          if (images.length > 0) {
            volumes.push({
              type: "images",
              volume: item,
              folder_name: item,
              cover: `/api/image/${encodeURIComponent(title)}/${encodeURIComponent(item)}/${encodeURIComponent(images[0])}`,
              image_count: images.length,
            });
          }
        }
      }
    }

    res.json(volumes);
  } catch (err) {
    if (err.message.startsWith("Forbidden")) {
      return res.status(403).json({ error: "Access denied" });
    }
    console.error("/api/volumes エラー:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/images", authenticateToken, (req, res) => {
  const { title, folder } = req.query;

  if (!title) {
    return res.status(400).json({ error: "title parameter is required" });
  }

  try {
    const folderPath = folder
      ? safeResolvePath(MANGA_DIR, title, folder)
      : safeResolvePath(MANGA_DIR, title);

    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const images = getMangaPageImages(folderPath);
    const imageUrls = images.map((img) =>
      folder
        ? `/api/image/${encodeURIComponent(title)}/${encodeURIComponent(folder)}/${encodeURIComponent(img)}`
        : `/api/image/${encodeURIComponent(title)}/${encodeURIComponent(img)}`,
    );
    res.json(imageUrls);
  } catch (err) {
    if (err.message.startsWith("Forbidden")) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
//  ファイル配信 API (要認証)
// ============================================================

/**
 * GET /api/image/:title/:file
 * GET /api/image/:title/:subfolder/:file
 * 画像ファイルを返す。ディレクトリトラバーサル対策済み。
 */
app.get("/api/image/:title/:p1/:p2?", authenticateToken, (req, res) => {
  try {
    const { title, p1, p2 } = req.params;
    const filePath = p2
      ? safeResolvePath(MANGA_DIR, title, p1, p2)
      : safeResolvePath(MANGA_DIR, title, p1);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Image not found" });
    }

    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    const stat = fs.statSync(filePath);

    res.set({
      "Content-Type": mimeType,
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.message.startsWith("Forbidden")) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/pdf/_direct/:filename
 * GET /api/pdf/:title/:filename
 * PDFファイルをストリーミング配信する。
 */
app.get("/api/pdf/:titleOrDirect/:filename", authenticateToken, (req, res) => {
  try {
    const { titleOrDirect, filename } = req.params;
    let filePath;

    if (titleOrDirect === "_direct") {
      filePath = safeResolvePath(MANGA_DIR, filename);
    } else {
      filePath = safeResolvePath(MANGA_DIR, titleOrDirect, filename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Range リクエスト対応 (大きなPDFの高速読み込みに必要)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206).set({
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "application/pdf",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.set({
        "Content-Type": "application/pdf",
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
        "Cache-Control": "private, max-age=3600",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (err.message.startsWith("Forbidden")) {
      return res.status(403).json({ error: "Access denied" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/cover/_pdf/:filename
 * GET /api/cover/:title
 * GET /api/cover/:title/:filename
 * 表紙画像を返す。見つからない場合はデフォルト表紙を返す。
 */
app.get("/api/cover/:p1/:p2?", authenticateToken, (req, res) => {
  try {
    const { p1, p2 } = req.params;
    let coverPath = null;

    if (p1 === "_pdf" && p2) {
      // manga_data直下のPDFの表紙
      const dirPath = MANGA_DIR;
      coverPath = findPdfCoverPath(dirPath, p2);
    } else if (!p2) {
      // シリーズ表紙
      const titlePath = safeResolvePath(MANGA_DIR, p1);
      coverPath = findSeriesCoverPath(titlePath);
    } else {
      // 巻の表紙
      if (isPdfFile(p2)) {
        const titlePath = safeResolvePath(MANGA_DIR, p1);
        coverPath = findPdfCoverPath(titlePath, p2);
        if (!coverPath) {
          // キャッシュなし → シリーズ表紙にフォールバック
          coverPath = findSeriesCoverPath(titlePath);
        }
      } else {
        const subPath = safeResolvePath(MANGA_DIR, p1, p2);
        if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory()) {
          const imgs = getAllImageFiles(subPath);
          if (imgs.length > 0) coverPath = path.join(subPath, imgs[0]);
        }
      }
    }

    if (!coverPath || !fs.existsSync(coverPath)) {
      return sendDefaultCover(res);
    }

    const mtime = fs.statSync(coverPath).mtime.getTime();
    const etag = `"${mtime}"`;

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    const mimeType = mime.lookup(coverPath) || "image/jpeg";
    const stat = fs.statSync(coverPath);

    res.set({
      "Content-Type": mimeType,
      "Content-Length": stat.size,
      ETag: etag,
      "Cache-Control": "private, no-cache",
    });
    fs.createReadStream(coverPath).pipe(res);
  } catch (err) {
    if (err.message.startsWith("Forbidden")) {
      return res.status(403).json({ error: "Access denied" });
    }
    sendDefaultCover(res);
  }
});

function sendDefaultCover(res) {
  // 1x1 透明PNG
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000001f15c4890000000" +
      "0d4944415478016360f80f0000000101000500000000000000000049454e44ae426082",
    "hex",
  );
  res.set({
    "Content-Type": "image/png",
    "Content-Length": png.length,
    "Cache-Control": "no-cache",
  });
  res.end(png);
}

// ============================================================
//  デバッグ API (開発時のみ有効)
// ============================================================

if (NODE_ENV !== "production") {
  app.get("/api/debug/cover", authenticateToken, (req, res) => {
    const { title } = req.query;
    if (!title) return res.status(400).json({ error: "title required" });

    try {
      const titlePath = safeResolvePath(MANGA_DIR, title);
      const files = fs.existsSync(titlePath) ? fs.readdirSync(titlePath) : [];
      const coverFiles = files.filter(
        (f) => f.toLowerCase().startsWith("cover.") && isImageFile(f),
      );
      const resolved = findSeriesCoverPath(titlePath);

      res.json({
        title,
        folder_path: titlePath,
        all_files: files.slice(0, 30),
        cover_candidates: coverFiles,
        resolved_cover_path: resolved,
      });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });
}

// ============================================================
//  静的ファイル配信 (認証なし - HTMLとCSSを返すため)
// ============================================================

app.use(express.static(path.join(__dirname, "web")));

// ============================================================
//  エラーハンドリング
// ============================================================

app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  res.status(500).json({ error: "Internal server error" });
});

// 存在しないルート
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ============================================================
//  サーバー起動
// ============================================================

initializeCache();

app.listen(PORT, () => {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       漫画ライブラリ サーバー起動        ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\n🚀  http://localhost:${PORT}/`);
  console.log(`🛡   環境: ${NODE_ENV}`);
  console.log(`📁  漫画データ: ${MANGA_DIR}`);
  console.log("\nログインが必要です。アカウントがない場合:");
  console.log("  node setup-user.js\n");
});

// 環境変数から初期ユーザーを自動作成（Render初回デプロイ用）
(function createInitialUser() {
  const username = process.env.INIT_USERNAME;
  const password = process.env.INIT_PASSWORD;
  if (!username || !password) return;

  const existing = stmtFindUser.get(username);
  if (existing) {
    console.log(`✅  初期ユーザー "${username}" は既に存在します`);
    return;
  }

  const hash = bcrypt.hashSync(password, 12);
  stmtInsertUser.run(username, hash);
  console.log(`✅  初期ユーザー "${username}" を自動作成しました`);
})();
