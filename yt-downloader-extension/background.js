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
});
