// グローバル状態
let currentView = "library";
let currentSeries = null;
let currentContent = null; // 現在の巻のコンテンツ情報
let contentType = null; // 'pdf' or 'images'
let pdfDoc = null; // PDF.jsドキュメント
let imageList = []; // 画像ファイルのリスト
let currentPage = 1;
let totalPages = 0;
let zoomLevel = 1.0;
let renderTask = null;
let viewMode = "spread"; // 'single' or 'spread'
let readingDirection = "rtl"; // 'rtl' (右綴じ) or 'ltr' (左綴じ)
let fitToWidth = true;
let hasBlankPage = false; // 白紙を挿入しているか

// お気に入りと履歴
let favoritesList = JSON.parse(localStorage.getItem('favorites') || '[]');
let recentlyOpened = JSON.parse(localStorage.getItem('recentlyOpened') || '[]');

// 検索関連
let allLibraryData = []; // 全ライブラリデータ
let currentSearchTerm = ""; // 現在の検索ワード

// DOM要素
const libraryView = document.getElementById("library-view");
const volumesView = document.getElementById("volumes-view");
const readerView = document.getElementById("reader-view");
const libraryGrid = document.getElementById("library-grid");
const volumesGrid = document.getElementById("volumes-grid");
const seriesTitle = document.getElementById("series-title");
const readerTitle = document.getElementById("reader-title");
const contentContainer = document.getElementById("content-container");
const pdfCanvasLeft = document.getElementById("pdf-canvas-left");
const pdfCanvasRight = document.getElementById("pdf-canvas-right");
const imageLeft = document.getElementById("image-left");
const imageRight = document.getElementById("image-right");
const pageInfo = document.getElementById("page-info");
const zoomLevelDisplay = document.getElementById("zoom-level");

// === お気に入り・履歴管理関数 ===

// お気に入りに追加/削除（巻単位）
function toggleFavorite(title, volumeInfo) {
  const itemKey = volumeInfo ? `${title}::${volumeInfo}` : title;
  const index = favoritesList.indexOf(itemKey);
  if (index > -1) {
    favoritesList.splice(index, 1);
  } else {
    favoritesList.push(itemKey);
  }
  localStorage.setItem('favorites', JSON.stringify(favoritesList));
}

// お気に入りチェック（巻単位）
function isFavorite(title, volumeInfo) {
  const itemKey = volumeInfo ? `${title}::${volumeInfo}` : title;
  return favoritesList.includes(itemKey);
}

// 最近開いた漫画に追加
function addToRecentlyOpened(title, volumeInfo) {
  // 既存のエントリを削除
  recentlyOpened = recentlyOpened.filter(item => 
    !(item.title === title && item.volume === volumeInfo)
  );
  
  // 先頭に追加
  recentlyOpened.unshift({
    title: title,
    volume: volumeInfo,
    timestamp: Date.now()
  });
  
  // 最大10件に制限
  recentlyOpened = recentlyOpened.slice(0, 10);
  
  localStorage.setItem('recentlyOpened', JSON.stringify(recentlyOpened));
}

// イベントリスナー
document
  .getElementById("back-to-library")
  .addEventListener("click", showLibrary);
document
  .getElementById("back-to-volumes")
  .addEventListener("click", showVolumes);
document.getElementById("prev-page").addEventListener("click", prevPage);
document.getElementById("next-page").addEventListener("click", nextPage);
document
  .getElementById("zoom-in")
  .addEventListener("click", () => changeZoom(0.1));
document
  .getElementById("zoom-out")
  .addEventListener("click", () => changeZoom(-0.1));
document.getElementById("fit-width").addEventListener("click", toggleFitWidth);

// 全画面ボタンのイベントリスナー（nullチェック付き）
const fullscreenButton = document.getElementById("fullscreen-toggle");
if (fullscreenButton) {
  fullscreenButton.addEventListener("click", toggleFullscreen);
}

// 表示モード切り替え
document
  .getElementById("view-mode-single")
  .addEventListener("click", () => setViewMode("single"));
document
  .getElementById("view-mode-spread")
  .addEventListener("click", () => setViewMode("spread"));

// 読み方向切り替え
document
  .getElementById("reading-direction-rtl")
  .addEventListener("click", () => setReadingDirection("rtl"));
document
  .getElementById("reading-direction-ltr")
  .addEventListener("click", () => setReadingDirection("ltr"));

// 白紙挿入切り替え
document
  .getElementById("toggle-blank-page")
  .addEventListener("click", toggleBlankPage);

// 検索機能
const searchInput = document.getElementById("search-input");
const clearButton = document.getElementById("clear-search");

// お気に入りボタン（スクロール位置を保存してから遷移）
document.addEventListener('DOMContentLoaded', () => {
  const favLinkButton = document.getElementById('fav-link-button');
  if (favLinkButton) {
    favLinkButton.addEventListener('click', (e) => {
      // スクロール位置を保存
      sessionStorage.setItem('libraryScrollY', window.scrollY.toString());
      // 通常のリンク遷移を継続（replaceは使わない）
    });
  }
});

searchInput.addEventListener("input", (e) => {
  currentSearchTerm = e.target.value;
  filterLibrary();

  // クリアボタンの表示切り替え
  if (currentSearchTerm) {
    clearButton.classList.add("visible");
  } else {
    clearButton.classList.remove("visible");
  }
});

clearButton.addEventListener("click", () => {
  searchInput.value = "";
  currentSearchTerm = "";
  clearButton.classList.remove("visible");
  filterLibrary();
});

// キーボードショートカット
document.addEventListener("keydown", (e) => {
  if (currentView !== "reader") return;

  switch (e.key) {
    case "ArrowLeft":
      if (readingDirection === "rtl") {
        nextPage();
      } else {
        prevPage();
      }
      break;
    case "ArrowRight":
      if (readingDirection === "rtl") {
        prevPage();
      } else {
        nextPage();
      }
      break;
    case "+":
    case "=":
      changeZoom(0.1);
      break;
    case "-":
      changeZoom(-0.1);
      break;
    case "f":
    case "F":
      toggleFitWidth();
      break;
    case "s":
    case "S":
      setViewMode("single");
      break;
    case "d":
    case "D":
      setViewMode("spread");
      break;
    case "g":
    case "G":
      toggleFullscreen();
      break;
  }
});

// ビュー切り替え
function switchView(viewName) {
  const oldView = currentView;
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));

  switch (viewName) {
    case "library":
      libraryView.classList.add("active");
      break;
    case "volumes":
      volumesView.classList.add("active");
      break;
    case "reader":
      readerView.classList.add("active");
      break;
  }

  currentView = viewName;
}

// ライブラリビューを表示
async function showLibrary() {
  switchView("library");

  // データ未取得の場合のみ読み込む（再描画によるスクロールリセットを防ぐ）
  if (allLibraryData.length === 0) {
    await loadLibrary();
  }

  // スクロール位置を復元（描画完了後に1回だけ）
  const savedScrollY = sessionStorage.getItem('libraryScrollY');
  if (savedScrollY) {
    setTimeout(() => window.scrollTo(0, parseInt(savedScrollY)), 50);
  }
}

// 巻一覧ビューを表示
async function showVolumes() {
  if (!currentSeries) return;

  // 直下に画像がある作品・直下PDFはライブラリに戻る
  if (
    currentContent &&
    (currentContent.type === "images_direct" ||
      currentContent.type === "pdf_direct")
  ) {
    await showLibrary();
  } else {
    switchView("volumes");
    // 巻一覧の履歴エントリを追加（戻るボタン対応）
    window.history.pushState(
      { view: 'volumes', title: currentSeries },
      '',
      window.location.pathname
    );
    await loadVolumes(currentSeries);
    const savedScrollY = sessionStorage.getItem('volumesScrollY');
    if (savedScrollY) {
      setTimeout(() => window.scrollTo(0, parseInt(savedScrollY)), 100);
    }
  }
}

// 表示モード切り替え
function setViewMode(mode) {
  viewMode = mode;

  // ボタンのアクティブ状態を更新
  document
    .getElementById("view-mode-single")
    .classList.toggle("active", mode === "single");
  document
    .getElementById("view-mode-spread")
    .classList.toggle("active", mode === "spread");

  // コンテナのクラスを更新
  contentContainer.classList.remove("single-page", "spread-page");
  contentContainer.classList.add(
    mode === "single" ? "single-page" : "spread-page",
  );

  // クリック可能エリアを更新
  setupClickAreas();

  // ページを再レンダリング
  renderCurrentPages();
}

// 読み方向切り替え
function setReadingDirection(direction) {
  readingDirection = direction;

  // ボタンのアクティブ状態を更新
  document
    .getElementById("reading-direction-rtl")
    .classList.toggle("active", direction === "rtl");
  document
    .getElementById("reading-direction-ltr")
    .classList.toggle("active", direction === "ltr");

  // コンテナのクラスを更新
  contentContainer.classList.remove("rtl", "ltr");
  contentContainer.classList.add(direction);

  // ボタンのテキストを更新
  updateButtonTexts();

  // クリック可能エリアを更新
  setupClickAreas();

  // ページを再レンダリング
  renderCurrentPages();
}

// ボタンのテキストを読み方向に応じて更新
function updateButtonTexts() {
  const prevButton = document.getElementById("prev-page");
  const nextButton = document.getElementById("next-page");

  if (readingDirection === "rtl") {
    // 右綴じ
    nextButton.textContent = "← 次";
    prevButton.textContent = "前 →";
  } else {
    // 左綴じ
    nextButton.textContent = "← 次";
    prevButton.textContent = "前 →";
  }
}

// クリック可能エリアを設定
function setupClickAreas() {
  // 既存のエリアを削除
  const existingAreas = contentContainer.querySelectorAll(".page-turn-area");
  existingAreas.forEach((area) => area.remove());

  // 新しいエリアを作成
  const leftArea = document.createElement("div");
  leftArea.className = "page-turn-area page-turn-left";

  const rightArea = document.createElement("div");
  rightArea.className = "page-turn-area page-turn-right";

  // クリックイベント
  if (readingDirection === "rtl") {
    // 右綴じ: 左クリックで次、右クリックで前
    leftArea.addEventListener("click", nextPage);
    rightArea.addEventListener("click", prevPage);
  } else {
    // 左綴じ: 左クリックで前、右クリックで次
    leftArea.addEventListener("click", prevPage);
    rightArea.addEventListener("click", nextPage);
  }

  contentContainer.appendChild(leftArea);
  contentContainer.appendChild(rightArea);
}

// 白紙挿入切り替え
function toggleBlankPage() {
  hasBlankPage = !hasBlankPage;

  const button = document.getElementById("toggle-blank-page");
  if (hasBlankPage) {
    button.classList.add("active");
    button.textContent = "白紙を削除";
    // 白紙が増えた分だけページ番号をずらして現在位置を維持
    currentPage = currentPage + 1;
  } else {
    button.classList.remove("active");
    button.textContent = "白紙を挿入";
    // 白紙が減った分だけページ番号を戻して現在位置を維持
    currentPage = Math.max(1, currentPage - 1);
  }

  // 見開きモードの場合は奇数ページに調整
  if (viewMode === "spread" && currentPage % 2 === 0) {
    currentPage = Math.max(1, currentPage - 1);
  }

  renderCurrentPages();
}

// 幅に合わせる切り替え
function toggleFitWidth() {
  fitToWidth = !fitToWidth;
  const button = document.getElementById("fit-width");
  button.textContent = fitToWidth ? "元のサイズ" : "幅に合わせる";
  button.classList.toggle("active", fitToWidth);

  renderCurrentPages();
}

// 全画面表示の切り替え
function toggleFullscreen() {
  const readerView = document.getElementById("reader-view");
  const button = document.getElementById("fullscreen-toggle");
  
  if (!button) {
    return;
  }
  
  if (!document.fullscreenElement) {
    // 全画面表示を開始
    readerView.requestFullscreen().then(() => {
      button.textContent = "終了";
      button.classList.add("active");
      readerView.classList.add("fullscreen-mode");
      // 全画面モードで再描画
      setTimeout(() => {
        renderCurrentPages();
      }, 100);
    }).catch(err => {
      alert("全画面表示に失敗しました");
    });
  } else {
    // 全画面表示を終了
    document.exitFullscreen().then(() => {
      button.textContent = "全画面";
      button.classList.remove("active");
      readerView.classList.remove("fullscreen-mode");
      // 通常モードで再描画
      setTimeout(() => {
        renderCurrentPages();
      }, 100);
    });
  }
}

// 全画面状態の変更を監視
document.addEventListener('fullscreenchange', () => {
  const button = document.getElementById("fullscreen-toggle");
  const readerView = document.getElementById("reader-view");
  
  if (!document.fullscreenElement) {
    // 全画面が終了された（ESCキーなどで）
    if (button) {
      button.textContent = "全画面";
      button.classList.remove("active");
    }
    readerView.classList.remove("fullscreen-mode");
    
    // 通常モードで再描画
    setTimeout(() => {
      renderCurrentPages();
    }, 100);
  }
});

// 全画面モードでのクリックナビゲーション
contentContainer.addEventListener('click', (e) => {
  // 全画面モード時のみ
  if (!document.fullscreenElement) return;
  
  const rect = contentContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const containerWidth = rect.width;
  
  // 左側30%をクリック
  if (clickX < containerWidth * 0.3) {
    if (readingDirection === "rtl") {
      nextPage();
    } else {
      prevPage();
    }
  }
  // 右側30%をクリック
  else if (clickX > containerWidth * 0.7) {
    if (readingDirection === "rtl") {
      prevPage();
    } else {
      nextPage();
    }
  }
  // 中央40%をクリック - 何もしない（誤操作防止）
});

// ブラウザネイティブの遅延読み込みを使う（Edgeのlazy loading介入を回避）
// activateLazyCovers は互換性のため関数だけ残す（何もしない）
function activateLazyCovers() {}

// カバー画像URLにキャッシュバスター（起動時刻）を付加する
// 同じURLだとブラウザが古いキャッシュを使い続けるため、起動ごとに変わるtを付ける
const COVER_CACHE_BUSTER = Date.now();
function coverUrl(url) {
  return url + '?t=' + COVER_CACHE_BUSTER;
}

// ===== ライブラリデータを読み込み =====
// サーバー側でキャッシュが完成するまでブロッキング待機するので、
// フロント側はシンプルにfetchするだけでよい
async function loadLibrary() {
  try {
    // スケルトンを即表示（レスポンス待機中のフィードバック）
    showLibrarySkeleton();

    const response = await fetch("/api/library");

    if (!response.ok) {
      libraryGrid.innerHTML = '<div class="error">ライブラリの読み込みに失敗しました</div>';
      return;
    }

    const library = await response.json();

    if (library.length === 0) {
      libraryGrid.innerHTML = '<div class="error">漫画データが見つかりません</div>';
      return;
    }

    allLibraryData = library;
    renderLibrary(library);
    // 描画後に遅延読み込みを起動
    activateLazyCovers(24);
  } catch (error) {
    libraryGrid.innerHTML = '<div class="error">ライブラリの読み込みに失敗しました</div>';
  }
}

// スケルトンカード（プレースホルダー）を即時表示する
function showLibrarySkeleton(count = 24) {
  libraryGrid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'manga-card skeleton-card';
    skeleton.innerHTML = `
      <div class="skeleton-cover"></div>
      <div class="manga-info">
        <div class="skeleton-text skeleton-title"></div>
        <div class="skeleton-text skeleton-meta"></div>
      </div>
    `;
    libraryGrid.appendChild(skeleton);
  }
}

// ライブラリを画面に表示
function renderLibrary(library) {
  libraryGrid.innerHTML = "";

  if (library.length === 0) {
    libraryGrid.innerHTML = `
      <div class="no-results">
        <h3>検索結果が見つかりません</h3>
        <p>別のキーワードで検索してみてください</p>
      </div>
    `;
    return;
  }

  // 最近開いた漫画セクション（検索中は非表示）- 巻単位で表示
  if (recentlyOpened.length > 0 && !currentSearchTerm) {
    const recentTitle = document.createElement('h2');
    recentTitle.className = 'section-title';
    recentTitle.textContent = '📖 最近開いた漫画';
    recentTitle.style.gridColumn = '1 / -1';
    libraryGrid.appendChild(recentTitle);
    
    // 最近開いた漫画のカードを作成（巻単位）
    // 存在する作品のみを表示
    const validRecents = [];
    
    recentlyOpened.slice(0, 5).forEach(recent => {
      // タイトルが空でないかチェック
      if (!recent.title || !recent.volume) {
        return;
      }
      
      // ライブラリに存在する作品かチェック
      const manga = library.find(m => m.title === recent.title);
      if (!manga) {
        return; // この作品はスキップ
      }
      
      validRecents.push(recent);
      
      const card = document.createElement("div");
      card.className = "manga-card";
      
      const isFav = isFavorite(recent.title, recent.volume);
      
      card.innerHTML = `
        <div class="card-image-wrapper">
          <img src="${coverUrl('/api/cover/' + encodeURIComponent(recent.title))}" alt="${recent.title}" class="manga-cover" loading="lazy">
          <button class="fav-button ${isFav ? 'active' : ''}" data-title="${recent.title}" data-volume="${recent.volume}">
            ${isFav ? '❤️' : '🤍'}
          </button>
        </div>
        <div class="manga-info">
          <div class="manga-title">${recent.title}</div>
          <div class="manga-meta">${recent.volume}</div>
        </div>
      `;
      
      // お気に入りボタンのイベント
      const favButton = card.querySelector('.fav-button');
      favButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(recent.title, recent.volume);
        const newIsFav = isFavorite(recent.title, recent.volume);
        favButton.classList.toggle('active', newIsFav);
        favButton.textContent = newIsFav ? '❤️' : '🤍';
      });
      
      // カードクリックで直接リーダーを開く
      card.addEventListener("click", async () => {
        // ライブラリのスクロール位置を保存
        const scrollY = window.scrollY;
        sessionStorage.setItem('libraryScrollY', scrollY.toString());
        try {
          currentSeries = recent.title;
          const response = await fetch(`/api/volumes?title=${encodeURIComponent(recent.title)}`);
          
          if (!response.ok) {
            alert('この作品は削除されたか、見つかりません');
            return;
          }
          
          const volumes = await response.json();
          
          // 該当する巻を探して開く
          const targetVolume = volumes.find(v => 
            (v.volume && v.volume === recent.volume) || 
            (v.folder_name && v.folder_name === recent.volume)
          );
          
          if (targetVolume) {
            openReader(recent.title, targetVolume);
          } else {
            alert('この巻は削除されたか、見つかりません');
          }
        } catch (error) {
          alert('漫画を開けませんでした');
        }
      });
      
      libraryGrid.appendChild(card);
    });
    
    // 存在しない作品を最近開いた漫画から削除
    if (validRecents.length < recentlyOpened.slice(0, 5).length) {
      recentlyOpened = recentlyOpened.filter(recent => 
        library.some(m => m.title === recent.title)
      );
      localStorage.setItem('recentlyOpened', JSON.stringify(recentlyOpened));
    }
    
    // 区切り線
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    libraryGrid.appendChild(divider);
    
    // 全作品タイトル
    const allTitle = document.createElement('h2');
    allTitle.className = 'section-title';
    allTitle.textContent = '📚 全作品';
    allTitle.style.gridColumn = '1 / -1';
    libraryGrid.appendChild(allTitle);
  }

  // 通常のカード表示
  library.forEach((manga) => {
    const card = document.createElement("div");
    card.className = "manga-card";

    const metadata = manga.metadata || {};
    const volumeCount = manga.volume_count || 0;
    
    // 作品全体のお気に入り状態をチェック（作品名のみで）
    const isFav = isFavorite(manga.title, null);

    card.innerHTML = `
      <div class="card-image-wrapper">
        <img src="${coverUrl(manga.cover)}" alt="${manga.title}" class="manga-cover" loading="lazy">
        <button class="fav-button ${isFav ? 'active' : ''}" data-title="${manga.title}" data-volume="">
          ${isFav ? '❤️' : '🤍'}
        </button>
      </div>
      <div class="manga-info">
        <div class="manga-title">${manga.title}</div>
        <div class="manga-meta">${volumeCount}巻${metadata.author ? " / " + metadata.author : ""}</div>
      </div>
    `;
    
    // お気に入りボタンのイベント
    const favButton = card.querySelector('.fav-button');
    favButton.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(manga.title, null);  // 作品全体のお気に入り
      const newIsFav = isFavorite(manga.title, null);
      favButton.classList.toggle('active', newIsFav);
      favButton.textContent = newIsFav ? '❤️' : '🤍';
    });

    card.addEventListener("click", async () => {
      currentSeries = manga.title;
      
      // ライブラリのスクロール位置を保存（すべてのケースで）
      const scrollY = window.scrollY;
      sessionStorage.setItem('libraryScrollY', scrollY.toString());
      // manga_data直下のPDFの場合
      if (manga.is_direct_pdf) {
        const response = await fetch(
          `/api/volumes?title=${encodeURIComponent(manga.title)}&is_direct_pdf=true`,
        );
        const volumes = await response.json();

        if (volumes.length > 0) {
          openReader(manga.title, volumes[0]);
        }
        return;
      }

      // タイトルフォルダ直下に画像がある場合は直接リーダーを開く
      if (manga.has_direct_images) {
        const response = await fetch(
          `/api/volumes?title=${encodeURIComponent(manga.title)}`,
        );
        const volumes = await response.json();

        if (volumes.length > 0) {
          openReader(manga.title, volumes[0]);
        }
      } else {
        // 通常通り巻一覧を表示
        currentSeries = manga.title;
        switchView("volumes");
        window.history.pushState(
          { view: 'volumes', title: manga.title },
          '',
          window.location.pathname
        );
        loadVolumes(manga.title);
      }
    });
    libraryGrid.appendChild(card);
  });
}


// 漫画カードを作成
function createMangaCard(manga) {
  const card = document.createElement("div");
  card.className = "manga-card";

  const metadata = manga.metadata || {};
  const volumeCount = manga.volume_count || 0;

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${coverUrl(manga.cover)}" alt="${manga.title}" class="manga-cover" loading="lazy">
    </div>
    <div class="manga-info">
      <div class="manga-title">${manga.title}</div>
      <div class="manga-meta">${volumeCount}巻${metadata.author ? " / " + metadata.author : ""}</div>
    </div>
  `;

  return card;
}

// フィルター機能
function filterLibrary() {
  if (!currentSearchTerm) {
    renderLibrary(allLibraryData);
    activateLazyCovers(24);
    return;
  }

  const term = currentSearchTerm.toLowerCase();
  const filtered = allLibraryData.filter((manga) => {
    const metadata = manga.metadata || {};
    const titleMatch = manga.title.toLowerCase().includes(term);
    const authorMatch = metadata.author && metadata.author.toLowerCase().includes(term);
    const publisherMatch = metadata.publisher && metadata.publisher.toLowerCase().includes(term);
    const genreMatch = metadata.genre && metadata.genre.some((g) => g.toLowerCase().includes(term));
    return titleMatch || authorMatch || publisherMatch || genreMatch;
  });

  renderLibrary(filtered);
  activateLazyCovers(24);
}

// 巻一覧を読み込み
async function loadVolumes(title) {
  try {
    volumesGrid.innerHTML = '<div class="loading">巻一覧を読み込み中</div>';
    seriesTitle.textContent = title;

    const response = await fetch(
      `/api/volumes?title=${encodeURIComponent(title)}`,
    );
    
    // 404エラーなど、レスポンスが正常でない場合
    if (!response.ok) {
      if (response.status === 404) {
        volumesGrid.innerHTML =
          '<div class="error">作品が見つかりません。削除された可能性があります。</div>';
        // ライブラリに戻る
        setTimeout(() => {
          showLibrary();
        }, 2000);
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const volumes = await response.json();

    if (volumes.length === 0) {
      volumesGrid.innerHTML =
        '<div class="error">この作品には巻がありません</div>';
      return;
    }

    volumesGrid.innerHTML = "";

    volumes.forEach((volume) => {
      const card = createVolumeCard(volume, title);
      card.addEventListener("click", () => {
        // 巻一覧のスクロール位置を保存
        sessionStorage.setItem('volumesScrollY', window.scrollY.toString());
        openReader(title, volume);
      });
      volumesGrid.appendChild(card);
    });
    
    // スクロール位置を復元
    const savedScrollY = sessionStorage.getItem('volumesScrollY');
    if (savedScrollY) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScrollY));
      }, 100);
    }
  } catch (error) {
    volumesGrid.innerHTML =
      '<div class="error">巻一覧の読み込みに失敗しました</div>';
  }
}

// 巻カードを作成
function createVolumeCard(volume, seriesTitle) {
  const card = document.createElement("div");
  card.className = "manga-card";

  const volumeTitle = volume.volume || volume.folder_name;
  const isFav = isFavorite(seriesTitle, volumeTitle);

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${coverUrl(volume.cover)}" alt="${volumeTitle}" class="manga-cover" loading="lazy">
      <button class="fav-button ${isFav ? 'active' : ''}" data-title="${seriesTitle}" data-volume="${volumeTitle}">
        ${isFav ? '❤️' : '🤍'}
      </button>
    </div>
    <div class="manga-info">
      <div class="manga-title">${volumeTitle}</div>
    </div>
  `;

  // お気に入りボタンのイベント
  const favButton = card.querySelector('.fav-button');
  favButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(seriesTitle, volumeTitle);
    // ボタンの表示を更新
    const newIsFav = isFavorite(seriesTitle, volumeTitle);
    favButton.classList.toggle('active', newIsFav);
    favButton.textContent = newIsFav ? '❤️' : '🤍';
  });

  return card;
}

// リーダーを開く
async function openReader(title, volume) {
  // 前のビューを記録（戻るボタン用）
  sessionStorage.setItem('previousView', currentView);
  const cameFromFavorites = sessionStorage.getItem('cameFromFavorites');
  if (cameFromFavorites !== 'true') {
    sessionStorage.removeItem('cameFromFavorites');
  }

  switchView("reader");

  window.history.pushState(
    { view: 'reader', title: title, volume: volume.volume || volume.folder_name },
    '',
    window.location.pathname
  );
  addToRecentlyOpened(title, volume.volume || volume.folder_name);

  readerTitle.textContent = `${title} - ${volume.volume || volume.folder_name}`;
  currentContent = volume;

  // コンテンツタイプを判定して読み込む
  try {
    if (volume.type === "pdf" || volume.type === "pdf_direct") {
      contentType = "pdf";
      await loadPDF(volume.pdf_url);
    } else if (volume.type === "images" || volume.type === "images_direct") {
      contentType = "images";
      await loadImages(title, volume.folder_name || "");
    }
  } catch (e) {
    // エラーが起きてもリーダー画面に留まる（ライブラリに戻らない）
    showPdfError("コンテンツの読み込みに失敗しました。");
    return;
  }

  // 初期設定
  currentPage = 1;
  hasBlankPage = false;
  document.getElementById("toggle-blank-page").classList.remove("active");
  document.getElementById("toggle-blank-page").textContent = "白紙を挿入";

  fitToWidth = true;
  const fitButton = document.getElementById("fit-width");
  fitButton.textContent = "元のサイズ";
  fitButton.classList.add("active");

  setViewMode("spread");
  setReadingDirection("rtl");

  renderCurrentPages();
  setupProgressBarDrag();
}

// PDFを読み込み
async function loadPDF(pdfUrl) {
  // pdf.jsが読み込めていない場合
  if (typeof pdfjsLib === 'undefined') {
    showPdfJsError();
    return;
  }
  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    pdfDoc = await loadingTask.promise;
    totalPages = pdfDoc.numPages;

    imageLeft.style.display = "none";
    imageRight.style.display = "none";
    pdfCanvasLeft.style.display = "block";
    pdfCanvasRight.style.display = "block";
  } catch (error) {
    showPdfError("PDFの読み込みに失敗しました。ファイルが壊れているか、見つかりません。");
  }
}

// pdf.jsが未ロードの場合のエラー表示
function showPdfJsError() {
  contentContainer.innerHTML = `
    <div style="color:#fff; padding:40px; text-align:center; line-height:2;">
      <h2>⚠️ PDFビューアーが読み込めていません</h2>
      <p>同梱の <strong>pdfjs_ダウンロード.bat</strong> を実行して、<br>
      <code>web/lib/</code> フォルダに pdf.js を配置してください。</p>
      <p style="font-size:0.85em; color:#aaa;">
        手順: pdfjs_ダウンロード.bat をダブルクリック → サーバーを再起動 → ページ再読み込み
      </p>
    </div>
  `;
}

// PDFエラーの表示
function showPdfError(msg) {
  contentContainer.innerHTML = `
    <div style="color:#fff; padding:40px; text-align:center;">
      <p>⚠️ ${msg}</p>
    </div>
  `;
}

// 画像リストを読み込み
async function loadImages(title, folderName) {
  try {
    const response = await fetch(
      `/api/images?title=${encodeURIComponent(title)}&folder=${encodeURIComponent(folderName)}`,
    );
    imageList = await response.json();
    totalPages = imageList.length;

    // PDFキャンバスを非表示にして画像要素を表示
    pdfCanvasLeft.style.display = "none";
    pdfCanvasRight.style.display = "none";
    imageLeft.style.display = "block";
    imageRight.style.display = "block";
  } catch (error) {
    alert("画像の読み込みに失敗しました");
  }
}

// 現在のページを描画
async function renderCurrentPages() {
  if (viewMode === "single") {
    // 単ページモード
    await renderPage(currentPage, "left");
  } else {
    // 見開きモード
    if (hasBlankPage && currentPage === 1) {
      // 1ページ目に白紙を挿入
      await renderBlankPage("left");
      await renderPage(1, "right");
    } else {
      const actualPage = hasBlankPage ? currentPage - 1 : currentPage;
      await renderPage(actualPage, "left");
      await renderPage(actualPage + 1, "right");
    }
  }

  updatePageInfo();
  updateProgressBar();
}

// ページを描画（PDFまたは画像）
async function renderPage(pageNum, side) {
  if (contentType === "pdf") {
    const canvas = side === "left" ? pdfCanvasLeft : pdfCanvasRight;
    await renderPDFPage(canvas, pageNum);
  } else if (contentType === "images") {
    const img = side === "left" ? imageLeft : imageRight;
    renderImagePage(img, pageNum);
  }
}

// PDFページを描画
async function renderPDFPage(canvas, pageNum) {
  if (!pdfDoc || pageNum < 1 || pageNum > totalPages) {
    clearCanvas(canvas);
    return;
  }

  // このcanvasが既にレンダリング中の場合は待つ
  if (canvas.isRendering) {
    return;
  }

  try {
    // レンダリング中フラグを設定
    canvas.isRendering = true;

    // 既存のレンダリングタスクをキャンセル
    if (canvas.renderTask) {
      try {
        canvas.renderTask.cancel();
        // キャンセル完了を待つ
        await canvas.renderTask.promise.catch(() => {});
      } catch (e) {
        // キャンセルエラーは無視
      }
      canvas.renderTask = null;
    }

    const page = await pdfDoc.getPage(pageNum);

    let scale = zoomLevel;

    if (fitToWidth) {
      const containerWidth = contentContainer.clientWidth;
      const pageWidth = page.getViewport({ scale: 1.0 }).width;
      
      // 全画面モード時は画面サイズに合わせて計算
      const isFullscreen = document.fullscreenElement !== null;
      let availableWidth;
      
      if (isFullscreen) {
        // 全画面モード時
        availableWidth = viewMode === "spread" ? window.innerWidth / 2 : window.innerWidth;
      } else {
        // 通常モード時
        availableWidth = viewMode === "spread" ? containerWidth / 2 - 10 : containerWidth - 40;
      }
      
      scale = availableWidth / pageWidth;
    }

    const viewport = page.getViewport({ scale: scale });
    const context = canvas.getContext("2d");

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      intent: "display",
    };

    // レンダリングタスクを保存
    const renderTask = page.render(renderContext);
    canvas.renderTask = renderTask;
    
    await renderTask.promise;
    
    // レンダリング完了後にタスクをクリア
    if (canvas.renderTask === renderTask) {
      canvas.renderTask = null;
    }
    page.cleanup();
  } catch (error) {
    // キャンセルエラーは無視
    if (error.name !== 'RenderingCancelledException') {
    }
    canvas.renderTask = null;
  } finally {
    // レンダリング中フラグを解除
    canvas.isRendering = false;
  }
}

// 画像ページを描画
function renderImagePage(img, pageNum) {
  if (!imageList || pageNum < 1 || pageNum > totalPages) {
    img.src = "";
    img.style.width = "0";
    img.style.height = "0";
    return;
  }

  const imageUrl = imageList[pageNum - 1];
  img.src = imageUrl;

  // ズームとフィット設定を適用
  if (fitToWidth) {
    const containerWidth = contentContainer.clientWidth;
    
    // 全画面モード時は画面サイズに合わせて計算
    const isFullscreen = document.fullscreenElement !== null;
    let availableWidth;
    
    if (isFullscreen) {
      // 全画面モード時
      availableWidth = viewMode === "spread" ? window.innerWidth / 2 : window.innerWidth;
    } else {
      // 通常モード時
      availableWidth = viewMode === "spread" ? containerWidth / 2 - 10 : containerWidth - 40;
    }
    
    img.style.width = availableWidth + "px";
    img.style.height = "auto";
  } else {
    img.style.width = 100 * zoomLevel + "%";
    img.style.height = "auto";
  }
}

// 白紙ページを描画
async function renderBlankPage(side) {
  if (contentType === "pdf") {
    const canvas = side === "left" ? pdfCanvasLeft : pdfCanvasRight;
    const ctx = canvas.getContext("2d");

    const width = 420;
    const height = 594;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else if (contentType === "images") {
    const img = side === "left" ? imageLeft : imageRight;
    // 透明な1x1 pngを使用
    img.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    img.style.width = "420px";
    img.style.height = "594px";
    img.style.background = "#ffffff";
  }
}

// キャンバスをクリア
function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  canvas.width = 0;
  canvas.height = 0;
}

// ページ情報を更新
function updatePageInfo() {
  const displayTotal = hasBlankPage ? totalPages + 1 : totalPages;

  if (viewMode === "single") {
    pageInfo.textContent = `${currentPage} / ${displayTotal}`;
  } else {
    const secondPage = Math.min(currentPage + 1, displayTotal);

    if (readingDirection === "rtl") {
      pageInfo.textContent = `${secondPage}-${currentPage} / ${displayTotal}`;
    } else {
      pageInfo.textContent = `${currentPage}-${secondPage} / ${displayTotal}`;
    }
  }

  document.getElementById("prev-page").disabled = currentPage <= 1;

  if (viewMode === "single") {
    document.getElementById("next-page").disabled = currentPage >= displayTotal;
  } else {
    document.getElementById("next-page").disabled =
      currentPage >= displayTotal - 1;
  }
}

// プログレスバーを更新
function updateProgressBar() {
  const progressFill = document.getElementById("progress-fill");
  const progressIndicator = document.getElementById("progress-indicator");
  const progressText = document.getElementById("progress-text");

  if (!progressFill || !progressIndicator || !progressText) return;

  const displayTotal = hasBlankPage ? totalPages + 1 : totalPages;
  const progress = (currentPage / displayTotal) * 100;

  progressFill.style.width = `${progress}%`;
  progressIndicator.style.right = `${progress}%`;

  if (viewMode === "single") {
    progressText.textContent = `${currentPage} / ${displayTotal}`;
  } else {
    const secondPage = Math.min(currentPage + 1, displayTotal);

    if (readingDirection === "rtl") {
      progressText.textContent = `${secondPage}-${currentPage} / ${displayTotal}`;
    } else {
      progressText.textContent = `${currentPage}-${secondPage} / ${displayTotal}`;
    }
  }
}

// プログレスバーのドラッグ機能を設定
function setupProgressBarDrag() {
  const progressBar = document.getElementById("progress-bar");
  const progressIndicator = document.getElementById("progress-indicator");

  if (!progressBar || !progressIndicator) return;

  let isDragging = false;

  progressBar.addEventListener("click", (e) => {
    if (e.target === progressIndicator) return;
    jumpToProgressPosition(e.clientX, progressBar);
  });

  const startDrag = (e) => {
    isDragging = true;
    progressIndicator.style.transition = "none";
    document.body.style.userSelect = "none";
  };

  progressIndicator.addEventListener("mousedown", startDrag);

  const doDrag = (e) => {
    if (!isDragging) return;
    jumpToProgressPosition(e.clientX, progressBar);
  };

  document.addEventListener("mousemove", doDrag);

  const endDrag = () => {
    if (isDragging) {
      isDragging = false;
      progressIndicator.style.transition = "right 0.3s ease-out";
      document.body.style.userSelect = "";
    }
  };

  document.addEventListener("mouseup", endDrag);
}

// プログレスバーの位置からページにジャンプ
function jumpToProgressPosition(clientX, progressBar) {
  const rect = progressBar.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const barWidth = rect.width;

  const displayTotal = hasBlankPage ? totalPages + 1 : totalPages;

  // 右から左なので反転
  const percentage = 100 - (clickX / barWidth) * 100;
  const targetPage = Math.max(
    1,
    Math.min(displayTotal, Math.round((percentage / 100) * displayTotal)),
  );

  // 見開きモードの場合は奇数ページに調整
  if (viewMode === "spread") {
    currentPage =
      targetPage % 2 === 1 ? targetPage : Math.max(1, targetPage - 1);
  } else {
    currentPage = targetPage;
  }

  renderCurrentPages();
}

// 前のページ
function prevPage() {
  if (currentPage <= 1) return;

  const displayTotal = hasBlankPage ? totalPages + 1 : totalPages;
  const step = viewMode === "spread" ? 2 : 1;
  currentPage = Math.max(1, currentPage - step);

  if (viewMode === "spread" && currentPage > 1 && currentPage % 2 === 0) {
    currentPage--;
  }

  renderCurrentPages();
}

// 次のページ
function nextPage() {
  const displayTotal = hasBlankPage ? totalPages + 1 : totalPages;
  const step = viewMode === "spread" ? 2 : 1;

  if (viewMode === "single") {
    if (currentPage >= displayTotal) return;
    currentPage = Math.min(displayTotal, currentPage + step);
  } else {
    if (currentPage >= displayTotal - 1) return;
    currentPage = Math.min(displayTotal - 1, currentPage + step);

    if (currentPage % 2 === 0) {
      currentPage++;
    }
  }

  renderCurrentPages();
}

// ズーム変更
function changeZoom(delta) {
  fitToWidth = false;
  document.getElementById("fit-width").textContent = "幅に合わせる";
  document.getElementById("fit-width").classList.remove("active");

  zoomLevel = Math.max(0.5, Math.min(3.0, zoomLevel + delta));
  zoomLevelDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
  renderCurrentPages();
}

// 初期化
loadLibrary();

// ===== ライブラリ更新ボタン =====
const refreshButton = document.getElementById('refresh-library');
if (refreshButton) {
  refreshButton.addEventListener('click', async () => {
    const confirmed = confirm(
      '漫画フォルダを再スキャンします。\n' +
      '作品数によっては数十秒かかる場合があります。\n\n' +
      '続けますか？'
    );
    if (!confirmed) return;

    refreshButton.disabled = true;
    refreshButton.textContent = '🔄 スキャン中...';
    libraryGrid.innerHTML = '<div class="loading">ライブラリを再スキャン中です。しばらくお待ちください...</div>';

    try {
      // refresh APIがスキャン完了まで待機して新データを返す
      const response = await fetch('/api/library/refresh');
      const library = await response.json();

      // 取得したデータで直接描画（loadLibraryのキャッシュを使わない）
      allLibraryData = library;
      renderLibrary(library);
      activateLazyCovers(24);
    } catch (e) {
      libraryGrid.innerHTML = '<div class="error">更新に失敗しました。サーバーを確認してください。</div>';
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = '🔄 ライブラリ更新';
    }
  });
}


// URLパラメータから作品・巻を開く
window.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const openTitle = urlParams.get('open');
  const openVolume = urlParams.get('volume');
  const seriesTitle = urlParams.get('series');
  
  if (openTitle && openVolume) {
    // 特定の巻を直接開く（お気に入りから）
    try {
      await loadLibrary();
      
      // URLパラメータをクリア（openReaderを呼ぶ前に！）
      window.history.replaceState({}, document.title, window.location.pathname);
      currentSeries = openTitle;
      const response = await fetch(`/api/volumes?title=${encodeURIComponent(openTitle)}`);
      
      // 404エラーなど、レスポンスが正常でない場合
      if (!response.ok) {
        if (response.status === 404) {
          alert('作品が見つかりません。削除された可能性があります。');
          // ライブラリに戻る
          switchView('library');
          return;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const volumes = await response.json();
      
      const targetVolume = volumes.find(v => 
        (v.volume && v.volume === openVolume) || 
        (v.folder_name && v.folder_name === openVolume)
      );
      
      if (targetVolume) {
        // openReaderがpushStateを実行する
        openReader(openTitle, targetVolume);
      } else {
        alert('巻が見つかりません。削除された可能性があります。');
        switchView('library');
      }
    } catch (error) {
      alert('漫画の読み込みに失敗しました。');
      switchView('library');
    }
  } else if (seriesTitle) {
    // 作品の巻一覧を開く（作品全体のお気に入りから）
    await loadLibrary();
    
    currentSeries = seriesTitle;
    switchView('volumes');
    await loadVolumes(seriesTitle);
    
    // URLパラメータをクリア（履歴は置き換えるだけ）
    window.history.replaceState({}, document.title, window.location.pathname);
  } else {
    // 通常のライブラリ表示（fav.htmlから戻った時など）
    // スクロール位置を復元
    const savedScrollY = sessionStorage.getItem('libraryScrollY');
    if (savedScrollY) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScrollY));
      }, 100);
    }
  }
});

// ブラウザの戻る/進むボタンで適切なビューに戻る
window.addEventListener('popstate', (event) => {
  if (currentView === 'reader') {
    // リーダー → お気に入りから来た場合
    const cameFromFavorites = sessionStorage.getItem('cameFromFavorites');
    if (cameFromFavorites === 'true') {
      sessionStorage.removeItem('cameFromFavorites');
      const favScrollY = sessionStorage.getItem('favoritesScrollY');
      if (favScrollY) {
        sessionStorage.setItem('restoreFavoritesScroll', favScrollY);
      }
      window.location.href = 'fav.html';
      return;
    }

    // リーダー → 巻一覧 or ライブラリ
    const previousView = sessionStorage.getItem('previousView');
    if (previousView === 'volumes') {
      // 巻一覧に戻る（さらに戻るボタンでライブラリへ行けるようpushStateしない）
      switchView("volumes");
      loadVolumes(currentSeries);
      const savedScrollY = sessionStorage.getItem('volumesScrollY');
      if (savedScrollY) {
        setTimeout(() => window.scrollTo(0, parseInt(savedScrollY)), 100);
      }
    } else {
      showLibrary();
    }

  } else if (currentView === 'volumes') {
    // 巻一覧 → ライブラリ
    showLibrary();
  }
});

// ページ離脱時にスクロール位置を保存
window.addEventListener('beforeunload', () => {
  if (currentView === 'library') {
    sessionStorage.setItem('libraryScrollY', window.scrollY.toString());
  }
});

// リーダー画面のヘッダー/コントロール自動非表示
(function() {
  const readerView = document.getElementById('reader-view');
  const header = readerView.querySelector('header');
  const progressBar = document.getElementById('progress-bar-container');
  let hideTimer = null;
  
  // ヘッダーとプログレスバーを表示
  function showControls() {
    header.classList.add('show-header');
    progressBar.classList.add('show-controls');
    
    // 既存のタイマーをクリア
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    
    // 1.5秒後に自動非表示
    hideTimer = setTimeout(() => {
      header.classList.remove('show-header');
      progressBar.classList.remove('show-controls');
    }, 1500);
  }
  
  // グローバルに公開（openReaderから呼ぶため）
  window.showReaderControls = showControls;
  
  // ヘッダーとプログレスバーを即座に非表示
  function hideControls() {
    header.classList.remove('show-header');
    progressBar.classList.remove('show-controls');
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }
  
  // コントロールの表示状態をトグル
  function toggleControls() {
    const isVisible = header.classList.contains('show-header');
    if (isVisible) {
      hideControls();
    } else {
      showControls();
    }
  }
  
  // マウス移動でコントロールを表示
  readerView.addEventListener('mousemove', (e) => {
    // リーダー画面でない場合は何もしない
    if (currentView !== 'reader') return;
    
    const viewportHeight = window.innerHeight;
    const mouseY = e.clientY;
    
    // 上部20%または下部20%にマウスがある場合
    if (mouseY < viewportHeight * 0.2 || mouseY > viewportHeight * 0.8) {
      showControls();
    }
  });
  
  // content-containerの中央（ノド辺り）をクリックでトグル
  contentContainer.addEventListener('click', (e) => {
    if (currentView !== 'reader') return;
    
    const rect = contentContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const containerWidth = rect.width;
    
    // 中央40%（30%-70%）をクリックした場合のみトグル
    const clickRatio = clickX / containerWidth;
    if (clickRatio >= 0.3 && clickRatio <= 0.7) {
      toggleControls();
      e.stopPropagation(); // ページめくりを防止
    }
  });
  
  // マウスがヘッダーまたはプログレスバー上にある間は非表示にしない
  header.addEventListener('mouseenter', () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  
  header.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => {
      header.classList.remove('show-header');
      progressBar.classList.remove('show-controls');
    }, 1500);
  });
  
  progressBar.addEventListener('mouseenter', () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });
  
  progressBar.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => {
      header.classList.remove('show-header');
      progressBar.classList.remove('show-controls');
    }, 1500);
  });
  
  // ページ移動ボタンクリック時にコントロールを一時表示
  document.getElementById('next-page').addEventListener('click', showControls);
  document.getElementById('prev-page').addEventListener('click', showControls);
  
  // キーボード操作でページ移動してもコントロールは表示しない
  // （矢印キーでの表示処理を削除）
  
  // リーダー画面に切り替わった時に一度表示
  document.getElementById('back-to-library').addEventListener('click', () => {
    // ライブラリに戻る時は何もしない
  });
})();
