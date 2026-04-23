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
      
      // Notify background to handle the download or open popup
      chrome.runtime.sendMessage({ 
        type: 'DOWNLOAD_CLICKED', 
        url: window.location.href,
        title: getVideoData().title 
      });
      
      // Visual feedback
      const span = downloadBtn.querySelector('span');
      const oldText = span.textContent;
      span.textContent = 'Starting...';
      setTimeout(() => span.textContent = oldText, 2000);
    };

    menu.appendChild(downloadBtn);
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
