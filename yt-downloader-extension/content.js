// Content script — runs on YouTube pages
// Communicates page data to the popup if needed.

(function () {
  'use strict';

  // Extract video metadata from the page DOM
  function getVideoData() {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim()
      || document.title.replace(' - YouTube', '');

    const channel = document.querySelector('#channel-name a')?.textContent?.trim()
      || document.querySelector('ytd-channel-name yt-formatted-string')?.textContent?.trim()
      || '';

    const duration = document.querySelector('.ytp-time-duration')?.textContent?.trim() || '';

    return { title, channel, duration };
  }

  // Listen for popup requesting video info
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_DATA') {
      sendResponse(getVideoData());
    }
  });
})();
