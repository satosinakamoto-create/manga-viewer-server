// お気に入り一覧ページのスクリプト（作品全体＋巻単位）

const favGrid = document.getElementById('fav-grid');
let favoritesList = JSON.parse(localStorage.getItem('favorites') || '[]');

console.log('お気に入りデータ:', favoritesList);

// お気に入り一覧を読み込み（作品全体＋巻単位）
async function loadFavorites() {
  if (favoritesList.length === 0) {
    favGrid.innerHTML = `
      <div class="no-results">
        <h3>お気に入りがありません</h3>
        <p>ハートボタンでお気に入りに追加できます</p>
      </div>
    `;
    return;
  }

  try {
    favGrid.innerHTML = '<div class="loading">読み込み中</div>';
    
    console.log('お気に入りを読み込んでいます...');
    
    const response = await fetch('/api/library');
    const allLibrary = await response.json();
    
    console.log('ライブラリデータ取得:', allLibrary.length, '件');

    favGrid.innerHTML = '';
    let displayedCount = 0;

    // お気に入りを処理
    for (const favItem of favoritesList) {
      console.log('処理中:', favItem);
      
      // "::"で分割
      const parts = favItem.split('::');
      
      if (parts.length === 1) {
        // 作品全体のお気に入り
        const seriesTitle = parts[0];
        console.log(`作品全体: "${seriesTitle}"`);
        
        const manga = allLibrary.find(m => m.title === seriesTitle);
        if (manga) {
          const card = createSeriesFavCard(manga);
          favGrid.appendChild(card);
          displayedCount++;
        } else {
          console.warn('作品が見つかりません:', seriesTitle);
        }
        
      } else if (parts.length === 2) {
        // 巻単位のお気に入り
        const [seriesTitle, volumeInfo] = parts;
        console.log(`タイトル: "${seriesTitle}", 巻: "${volumeInfo}"`);
        
        // 作品を探す
        const manga = allLibrary.find(m => m.title === seriesTitle);
        if (!manga) {
          console.warn('作品が見つかりません:', seriesTitle);
          continue;
        }
        
        // 巻情報を取得
        const volumesResponse = await fetch(`/api/volumes?title=${encodeURIComponent(seriesTitle)}`);
        const volumes = await volumesResponse.json();
        
        // 該当する巻を探す
        const targetVolume = volumes.find(v => 
          (v.volume && v.volume === volumeInfo) || 
          (v.folder_name && v.folder_name === volumeInfo)
        );
        
        if (targetVolume) {
          const card = createVolumeFavCard(seriesTitle, targetVolume);
          favGrid.appendChild(card);
          displayedCount++;
        } else {
          console.warn('巻が見つかりません:', volumeInfo);
        }
        
      } else {
        console.warn('不正なフォーマット:', favItem);
      }
    }
    
    console.log('表示件数:', displayedCount);
    
    if (displayedCount === 0) {
      favGrid.innerHTML = `
        <div class="no-results">
          <h3>お気に入りがありません</h3>
          <p>一部の作品が削除された可能性があります</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('お気に入り読み込みエラー:', error);
    favGrid.innerHTML = '<div class="error">読み込みに失敗しました</div>';
  }
}

// 作品全体のお気に入りカードを作成
function createSeriesFavCard(manga) {
  const card = document.createElement('div');
  card.className = 'manga-card';

  const metadata = manga.metadata || {};
  const volumeCount = manga.volume_count || 0;

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${manga.cover}" alt="${manga.title}" class="manga-cover" loading="lazy">
      <button class="fav-button active" data-title="${manga.title}" data-volume="">❤️</button>
    </div>
    <div class="manga-info">
      <div class="manga-title">${manga.title}</div>
      <div class="manga-meta">${volumeCount}巻${metadata.author ? ' / ' + metadata.author : ''}</div>
    </div>
  `;

  // お気に入り削除ボタン
  const favButton = card.querySelector('.fav-button');
  favButton.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFavorite(manga.title, null);
  });

  // カードクリック - 巻一覧へ
  card.addEventListener('click', () => {
    // お気に入りから来たことを記録
    sessionStorage.setItem('cameFromFavorites', 'true');
    sessionStorage.setItem('favoritesScrollY', window.scrollY.toString());
    console.log('お気に入りから作品を開く:', manga.title);
    window.location.href = `index.html?series=${encodeURIComponent(manga.title)}`;
  });

  return card;
}

// 巻単位のお気に入りカードを作成
function createVolumeFavCard(seriesTitle, volume) {
  const card = document.createElement('div');
  card.className = 'manga-card';

  const volumeTitle = volume.volume || volume.folder_name;

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${volume.cover}" alt="${volumeTitle}" class="manga-cover" loading="lazy">
      <button class="fav-button active" data-title="${seriesTitle}" data-volume="${volumeTitle}">❤️</button>
    </div>
    <div class="manga-info">
      <div class="manga-title">${seriesTitle}</div>
      <div class="manga-meta">${volumeTitle}</div>
    </div>
  `;

  // お気に入り削除ボタン
  const favButton = card.querySelector('.fav-button');
  favButton.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFavorite(seriesTitle, volumeTitle);
  });

  // カードクリック - 直接リーダーへ
  card.addEventListener('click', () => {
    // お気に入りから来たことを記録
    sessionStorage.setItem('cameFromFavorites', 'true');
    sessionStorage.setItem('favoritesScrollY', window.scrollY.toString());
    console.log('お気に入りから巻を開く:', seriesTitle, volumeTitle);
    window.location.href = `index.html?open=${encodeURIComponent(seriesTitle)}&volume=${encodeURIComponent(volumeTitle)}`;
  });

  return card;
}

// お気に入りから削除
function removeFavorite(seriesTitle, volumeTitle) {
  const itemKey = volumeTitle ? `${seriesTitle}::${volumeTitle}` : seriesTitle;
  favoritesList = favoritesList.filter(t => t !== itemKey);
  localStorage.setItem('favorites', JSON.stringify(favoritesList));
  console.log('削除:', itemKey);
  loadFavorites();
}

// 初期化
loadFavorites();

// ライブラリに戻るボタン（履歴に残さない）
document.addEventListener('DOMContentLoaded', () => {
  const backButton = document.getElementById('back-to-library-from-fav');
  if (backButton) {
    backButton.addEventListener('click', (e) => {
      e.preventDefault(); // デフォルトのリンク動作を防止
      console.log('お気に入りからライブラリに戻る（履歴に残さない）');
      // 履歴に残さずに遷移
      window.location.replace('index.html');
    });
  }
});

// お気に入りページのスクロール位置を復元
window.addEventListener('DOMContentLoaded', () => {
  const restoreScroll = sessionStorage.getItem('restoreFavoritesScroll');
  if (restoreScroll) {
    console.log('お気に入りページのスクロール位置を復元:', restoreScroll);
    sessionStorage.removeItem('restoreFavoritesScroll');
    setTimeout(() => {
      window.scrollTo(0, parseInt(restoreScroll));
    }, 100);
  }
});
