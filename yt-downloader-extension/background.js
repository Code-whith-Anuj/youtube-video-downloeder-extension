// Background service worker for YT Downloader extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('[YTDown] Extension installed.');
  chrome.storage.local.set({ downloadHistory: [] });
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] });
    });
    return true; // async
  }

  if (message.type === 'DOWNLOAD_CLICKED') {
    handleQuickDownload(message.url, message.title, message.quality, message.downloadType);
  }
});

async function handleQuickDownload(url, title, quality, type) {
  const SERVER_URL = 'http://localhost:9000';
  try {
    const resp = await fetch(`${SERVER_URL}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        type: type || 'video',
        quality: quality || '1080',
        isPlaylist: false
      })
    });

    if (resp.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Download Started',
        message: `Started downloading: ${title}`
      });
    } else {
      throw new Error('Server error');
    }
  } catch (e) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Download Error',
      message: 'Could not connect to the local server. Is start_server.bat running?'
    });
  }
}
