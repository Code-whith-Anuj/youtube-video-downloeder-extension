(function () {
  'use strict';

  let injectionActive = false;

  // Extract video metadata from the page DOM
  function getVideoData() {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim()
      || document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim()
      || document.title.replace(' - YouTube', '');

    const channel = document.querySelector('#channel-name a')?.textContent?.trim()
      || document.querySelector('ytd-channel-name yt-formatted-string')?.textContent?.trim()
      || '';

    const duration = document.querySelector('.ytp-time-duration')?.textContent?.trim() || '';

    return { title, channel, duration };
  }

  function injectDownloadButton() {
    // Target the menu where Like/Share buttons are
    const menu = document.querySelector('#top-level-buttons-computed') || 
                 document.querySelector('ytd-menu-renderer #top-level-buttons-computed') ||
                 document.querySelector('.ytd-watch-metadata #top-level-buttons-computed');

    if (!menu || menu.querySelector('#ytdl-native-button')) return;

    const downloadBtn = document.createElement('div');
    downloadBtn.id = 'ytdl-native-button';
    downloadBtn.className = 'style-scope ytd-menu-renderer force-icon-button';
    downloadBtn.style.cssText = `
      display: flex;
      align-items: center;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 18px;
      padding: 0 16px;
      height: 36px;
      margin-left: 8px;
      font-family: "Roboto", "Arial", sans-serif;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      transition: background 0.2s;
    `;

    downloadBtn.innerHTML = `
      <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: white; margin-right: 6px;">
        <path d="M17 18v1H6v-1h11zm-.5-6.6l-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-5z"></path>
      </svg>
      <span>Download</span>
    `;

    downloadBtn.onmouseover = () => downloadBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    downloadBtn.onmouseout = () => downloadBtn.style.background = 'rgba(255, 255, 255, 0.1)';

    downloadBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showQualityMenu(downloadBtn);
    };

    menu.appendChild(downloadBtn);
  }

  function showQualityMenu(anchor) {
    const existingMenu = document.querySelector('#ytdl-quality-menu');
    if (existingMenu) {
      existingMenu.remove();
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'ytdl-quality-menu';
    const rect = anchor.getBoundingClientRect();
    
    menu.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 8}px;
      left: ${rect.left}px;
      background: #282828;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 8px 0;
      z-index: 9999;
      min-width: 140px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      font-family: "Roboto", "Arial", sans-serif;
    `;

    const options = [
      { label: 'Video 1080p', type: 'video', quality: '1080' },
      { label: 'Video 720p', type: 'video', quality: '720' },
      { label: 'Video 480p', type: 'video', quality: '480' },
      { label: 'Audio MP3', type: 'audio', quality: '320' }
    ];

    options.forEach(opt => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 10px 16px;
        cursor: pointer;
        color: #fff;
        font-size: 14px;
        transition: background 0.2s;
      `;
      item.textContent = opt.label;
      
      item.onmouseover = () => item.style.background = 'rgba(255, 255, 255, 0.1)';
      item.onmouseout = () => item.style.background = 'transparent';
      
      item.onclick = () => {
        chrome.runtime.sendMessage({ 
          type: 'DOWNLOAD_CLICKED', 
          url: window.location.href,
          title: getVideoData().title,
          quality: opt.quality,
          downloadType: opt.type
        });
        menu.remove();
      };
      
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Close on click outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
  }

  // Observer to handle dynamic content loading
  const observer = new MutationObserver(() => {
    if (window.location.href.includes('watch?v=')) {
      injectDownloadButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check
  if (window.location.href.includes('watch?v=')) {
    setTimeout(injectDownloadButton, 2000);
  }

  // Listen for messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_DATA') {
      sendResponse(getVideoData());
    }
  });
})();
