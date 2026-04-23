// ── State ──
let currentVideo = null;
let currentPlaylist = null;
let selectedType = 'video';
let selectedQuality = '1080';
let downloadQueue = [];
let SERVER_URL = 'http://localhost:9000'; // Default, will fallback to 127.0.0.1 if needed


// ── DOM refs ──
const statusDot = document.getElementById('statusDot');
const noVideo = document.getElementById('noVideo');
const videoInfo = document.getElementById('videoInfo');
const videoThumb = document.getElementById('videoThumb');
const videoDuration = document.getElementById('videoDuration');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');
const formatSection = document.getElementById('formatSection');
const videoQualities = document.getElementById('videoQualities');
const audioQualities = document.getElementById('audioQualities');
const subtitleQualities = document.getElementById('subtitleQualities');
const downloadBtn = document.getElementById('downloadBtn');
const btnLabel = document.getElementById('btnLabel');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const historyList = document.getElementById('historyList');
const clearHistory = document.getElementById('clearHistory');
const serverBtn = document.getElementById('serverBtn');
const serverBtnStatus = document.getElementById('serverBtnStatus');

// New UI Elements
const settingsBtn = document.getElementById('settingsBtn');
const githubBtn = document.getElementById('githubBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const downloadDirInput = document.getElementById('downloadDirInput');
const saveSettings = document.getElementById('saveSettings');

const thumbDownloadBtn = document.getElementById('thumbDownloadBtn');
const playlistBanner = document.getElementById('playlistBanner');
const downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn');

const advancedToggleBtn = document.getElementById('advancedToggleBtn');
const advancedOptions = document.getElementById('advancedOptions');
const trimmerWrap = document.getElementById('trimmerWrap');
const trimStart = document.getElementById('trimStart');
const trimEnd = document.getElementById('trimEnd');
const lyricsWrap = document.getElementById('lyricsWrap');
const embedLyrics = document.getElementById('embedLyrics');

const queueSection = document.getElementById('queueSection');
const queueList = document.getElementById('queueList');

// Remove old progress DOM refs since we use queue now
// const progressWrap = document.getElementById('progressWrap');
// const progressFill = document.getElementById('progressFill');
// const progressLabel = document.getElementById('progressLabel');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Establish server connection first
  await bootstrapConnection();
  
  // 2. Then detect video and fetch qualities
  await detectVideo();
  await renderHistory();
  bindEvents();

  // Start server heartbeat
  setInterval(checkServerHealth, 5000);
});

async function bootstrapConnection() {
  const targets = ['http://localhost:9000', 'http://127.0.0.1:9000'];
  for (const url of targets) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        SERVER_URL = url;
        checkServerHealth();
        return;
      }
    } catch (e) {
      // Normal if server is offline
    }
  }
  checkServerHealth(); // Will set error state if both fail
}


// ── Server Health Check ──
async function checkServerHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      
      // Check if dependencies are missing on the server side
      if (data.dependencies && !data.dependencies.ytdlp) {
        statusDot.className = 'status-dot error';
        statusDot.title = `Missing dependency: yt-dlp`;
        
        if (currentVideo && !isQueueProcessing) {
          btnLabel.innerHTML = 'Install yt-dlp <span style="font-size:10px; opacity:0.8;">(Required)</span>';
          downloadBtn.disabled = false;
          downloadBtn.onclick = () => {
            chrome.tabs.create({ url: 'https://github.com/yt-dlp/yt-dlp#installation' });
          };
        }
        return;
      }

      statusDot.className = 'status-dot active';
      statusDot.title = `Connected to server at ${SERVER_URL}`;
      
      serverBtn.classList.add('active');
      serverBtnStatus.textContent = 'ON';

      // Reset onclick if it was hijacked by errors
      downloadBtn.onclick = handleDownload;

      // If we recovered, fix the button if needed
      if (currentVideo && !isQueueProcessing) {
        btnLabel.textContent = 'Download';
        downloadBtn.disabled = false;
      }
    } else {
      throw new Error();
    }
  } catch (e) {
    statusDot.className = 'status-dot error';
    statusDot.title = 'Local server not found. Please run start_server.bat.';
    
    serverBtn.classList.remove('active');
    serverBtnStatus.textContent = 'OFF';

    if (currentVideo && !isQueueProcessing) {
      btnLabel.innerHTML = 'Server Offline <span style="font-size:10px; opacity:0.8;">(Click to Start)</span>';
      downloadBtn.disabled = false; 
      downloadBtn.onclick = () => {
        // Since we can't start a local process from a Chrome extension for security reasons,
        // we show a helpful alert or redirect to a local guide.
        alert('To start downloading:\n1. Open the project folder\n2. Double-click "start_server.bat"\n3. Keep that window open!');
      };
    }
  }
}


// ── Detect YouTube video in active tab ──
async function detectVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return setNoVideo();

    const url = new URL(tab.url);
    const isYouTube = url.hostname.includes('youtube.com');
    const videoId = url.searchParams.get('v');

    if (!isYouTube || !videoId) return setNoVideo();

    // 1. Show basic info first (oEmbed for speed)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      currentVideo = {
        id: videoId,
        title: data.title,
        channel: data.author_name,
        thumb: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        url: tab.url,
        qualities: [1080, 720, 480, 360] // Initial fallback
      };
      showVideo(currentVideo);
    }

    // 2. Fetch real qualities from local server (Async)
    videoQualities.innerHTML = '<p style="grid-column: 1/-1; opacity:0.6; font-size:11px;">Scanning for 4K/HD formats…</p>';
    subtitleQualities.innerHTML = '<p style="grid-column: 1/-1; opacity:0.6; font-size:11px;">Scanning for CC…</p>';
    
    const fetchQualities = async () => {
      try {
        const r = await fetch(`${SERVER_URL}/info?url=${encodeURIComponent(tab.url)}`, { signal: AbortSignal.timeout(25000) });
        const data = await r.json();
        if (data.qualities && data.qualities.length > 0) {
          currentVideo.qualities = data.qualities;
          currentVideo.subtitles = data.subtitles || [];
        } else {
          throw new Error('No qualities found');
        }
      } catch (err) {
        currentVideo.qualities = [1080, 720, 480, 360];
        currentVideo.subtitles = [];
      } finally {
        renderQualities(currentVideo.qualities);
        renderSubtitles(currentVideo.subtitles);
      }
    };

    fetchQualities();

    // 3. Detect if it's a playlist
    if (url.searchParams.has('list')) {
      try {
        const pRes = await fetch(`${SERVER_URL}/playlist?url=${encodeURIComponent(tab.url)}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          currentPlaylist = pData.videos;
          playlistBanner.style.display = 'flex';
          playlistBanner.querySelector('span').textContent = `📚 Playlist: ${pData.videos.length} videos`;
        }
      } catch (e) {
        console.warn('Playlist detection failed', e);
      }
    }

  } catch (e) {
    setNoVideo();
  }
}

function setNoVideo() {
  // Only change status dot to grey if we haven't already set it to error by health check
  if (!statusDot.classList.contains('error')) {
    statusDot.className = 'status-dot';
  }
  noVideo.style.display = 'flex';
  videoInfo.style.display = 'none';
  formatSection.style.display = 'none';
  downloadBtn.disabled = true;
  btnLabel.textContent = 'No video detected';
}

function showVideo(v) {
  statusDot.className = 'status-dot active';
  noVideo.style.display = 'none';
  videoInfo.style.display = 'block';
  formatSection.style.display = 'flex';
  downloadBtn.disabled = false;

  videoThumb.src = v.thumb;
  videoTitle.textContent = v.title;
  videoChannel.textContent = v.channel;
  btnLabel.textContent = 'Download';
  videoDuration.textContent = '';  // Duration requires YT Data API key

  renderQualities(v.qualities || [1080, 720, 480, 360]);
  renderSubtitles(v.subtitles || []);
}

function renderQualities(qualities) {
  // Clear existing buttons
  videoQualities.innerHTML = '';
  
  qualities.forEach((q, index) => {
    const btn = document.createElement('button');
    btn.className = 'quality-btn';
    if (index === 0 && selectedType === 'video') {
      btn.classList.add('active');
      selectedQuality = q.toString();
    }
    btn.dataset.quality = q.toString();
    btn.textContent = q >= 2160 ? '4K' : q >= 1440 ? '2K' : q + 'p';
    
    btn.onclick = () => {
      videoQualities.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQuality = btn.dataset.quality;
    };
    
    videoQualities.appendChild(btn);
  });
}

function renderSubtitles(subs) {
  subtitleQualities.innerHTML = '';
  
  if (subs.length === 0) {
    subtitleQualities.innerHTML = '<p style="grid-column: 1/-1; opacity:0.6; font-size:11px;">No subtitles found</p>';
    return;
  }

  subs.forEach((s, index) => {
    const btn = document.createElement('button');
    btn.className = 'quality-btn';
    btn.style.fontSize = '9px'; // Smaller for language names
    btn.dataset.quality = s.lang;
    btn.textContent = s.name;
    
    btn.onclick = () => {
      subtitleQualities.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQuality = btn.dataset.quality;
    };
    
    subtitleQualities.appendChild(btn);
  });
}

// ── Format / Quality selection ──
function bindEvents() {
  // Format tabs (Segmented Control)
  document.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;

      if (selectedType === 'video') {
        videoQualities.style.display = 'grid';
        audioQualities.style.display = 'none';
        subtitleQualities.style.display = 'none';
        advancedToggleBtn.style.display = 'flex';
        trimmerWrap.style.display = 'block';
        lyricsWrap.style.display = 'none';
        selectedQuality = videoQualities.querySelector('.quality-btn.active')?.dataset.quality || '1080';
      } else if (selectedType === 'audio') {
        videoQualities.style.display = 'none';
        audioQualities.style.display = 'grid';
        subtitleQualities.style.display = 'none';
        advancedToggleBtn.style.display = 'flex';
        trimmerWrap.style.display = 'block';
        lyricsWrap.style.display = 'block';
        selectedQuality = '320';
        setActiveQuality(audioQualities, '320');
      } else {
        videoQualities.style.display = 'none';
        audioQualities.style.display = 'none';
        subtitleQualities.style.display = 'grid';
        advancedToggleBtn.style.display = 'none';
        advancedOptions.style.display = 'none';
        advancedToggleBtn.classList.remove('expanded');
        const firstSub = subtitleQualities.querySelector('.quality-btn');
        if (firstSub) {
          firstSub.classList.add('active');
          selectedQuality = firstSub.dataset.quality;
        } else {
          selectedQuality = null;
        }
      }
    });
  });

  // Quality buttons for audio (fixed)
  audioQualities.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      audioQualities.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedQuality = btn.dataset.quality;
    });
  });

  // Advanced Toggle
  advancedToggleBtn.addEventListener('click', () => {
    const isExpanded = advancedOptions.style.display === 'flex';
    advancedOptions.style.display = isExpanded ? 'none' : 'flex';
    advancedToggleBtn.classList.toggle('expanded', !isExpanded);
  });

  // Download
  downloadBtn.addEventListener('click', handleDownload);

  // Server Control
  serverBtn.addEventListener('click', async () => {
    if (serverBtn.classList.contains('active')) {
      // Server is ON, request shutdown
      if (confirm('Are you sure you want to CLOSE the server?')) {
        try {
          await fetch(`${SERVER_URL}/shutdown`, { method: 'POST' });
          checkServerHealth();
        } catch (e) {
          console.warn('Shutdown request failed (expected if server dies fast)');
          checkServerHealth();
        }
      }
    } else {
      // Server is OFF, show instructions
      alert('To START the server:\n\n1. Go to your project folder\n2. Double-click "start_server.bat"\n3. Wait for the green dot in this popup!');
    }
  });

  // Settings
  settingsBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`${SERVER_URL}/settings`);
      if (res.ok) {
        const config = await res.json();
        downloadDirInput.value = config.downloadDir || '';
      }
    } catch (e) {
      console.warn('Could not fetch settings');
    }
    settingsModal.style.display = 'flex';
  });

  // GitHub Link
  githubBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/Code-whith-Anuj/youtube-video-downloeder-extension' });
  });

  closeSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  saveSettings.addEventListener('click', async () => {
    try {
      await fetch(`${SERVER_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadDir: downloadDirInput.value.trim() })
      });
      settingsModal.style.display = 'none';
    } catch (e) {
      alert('Failed to save settings. Is the server running?');
    }
  });

  // Thumbnail Download
  thumbDownloadBtn.addEventListener('click', async () => {
    if (!currentVideo) return;
    const maxResUrl = `https://img.youtube.com/vi/${currentVideo.id}/maxresdefault.jpg`;
    chrome.downloads.download({
      url: maxResUrl,
      filename: `YTDownloader/${currentVideo.title.replace(/[\\/:*?"<>|]/g, '')}_thumb.jpg`,
      saveAs: false
    });
  });

  // Playlist Download
  downloadPlaylistBtn.addEventListener('click', () => {
    if (!currentPlaylist) return;
    if (confirm(`Queue ${currentPlaylist.length} videos from this playlist?`)) {
      currentPlaylist.forEach(vid => {
        enqueueDownload({
          title: vid.title,
          url: vid.url,
          type: selectedType,
          quality: selectedQuality,
          options: {
            startTime: trimStart.value.trim(),
            endTime: trimEnd.value.trim(),
            addLyrics: embedLyrics.checked,
            isPlaylist: false // we process flat playlists item by item
          }
        });
      });
      playlistBanner.style.display = 'none'; // hide after queuing
    }
  });

  // Clear history
  clearHistory.addEventListener('click', async () => {
    await chrome.storage.local.set({ downloadHistory: [] });
    renderHistory();
  });
}

function setActiveQuality(container, quality) {
  container.querySelectorAll('.quality-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.quality === quality);
  });
}

async function handleDownload() {
  if (!currentVideo) return;
  
  if (selectedType === 'subs' && !selectedQuality) {
    alert("No subtitles available to download for this video.");
    return;
  }
  
  const options = {
    startTime: trimStart.value.trim(),
    endTime: trimEnd.value.trim(),
    addLyrics: embedLyrics.checked,
    isPlaylist: false
  };

  enqueueDownload({
    title: currentVideo.title,
    url: `https://www.youtube.com/watch?v=${currentVideo.id}`,
    type: selectedType,
    quality: selectedQuality,
    options
  });
}

function enqueueDownload(job) {
  job.id = 'job_' + Date.now() + Math.random().toString(36).substr(2, 5);
  job.status = 'queued'; // queued, starting, running, done, error
  job.percent = 0;
  job.speed = '';
  job.serverId = null;
  downloadQueue.push(job);
  
  renderQueue();
  queueSection.style.display = 'block';
  
  processQueue();
}

function renderQueue() {
  queueList.innerHTML = downloadQueue.map(job => `
    <div class="queue-item" id="${job.id}">
      <div class="queue-header">
        <span class="queue-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</span>
        <span class="queue-status">${job.status === 'running' ? job.percent + '% ' + job.speed : job.status}</span>
      </div>
      <div class="queue-bar-bg">
        <div class="queue-bar-fill" style="width: ${job.percent}%"></div>
      </div>
    </div>
  `).join('');
}

function updateQueueUI(jobId, percent, speed, status) {
  const job = downloadQueue.find(j => j.id === jobId);
  if (!job) return;
  job.percent = percent;
  job.speed = speed;
  job.status = status;
  
  const el = document.getElementById(jobId);
  if (el) {
    el.querySelector('.queue-status').textContent = status === 'running' ? `${percent}% ${speed}` : status;
    el.querySelector('.queue-bar-fill').style.width = `${percent}%`;
    if (status === 'error') el.querySelector('.queue-bar-fill').style.background = 'var(--red)';
    if (status === 'done') el.querySelector('.queue-bar-fill').style.background = '#4CAF50';
  }
}

let isQueueProcessing = false;

async function processQueue() {
  if (isQueueProcessing) return;
  isQueueProcessing = true;

  while (true) {
    const nextJob = downloadQueue.find(j => j.status === 'queued');
    if (!nextJob) break;

    nextJob.status = 'starting';
    renderQueue();

    // 1. Ensure server is running
    if (!serverBtn.classList.contains('active')) {
      updateQueueUI(nextJob.id, 0, '', 'Starting server...');
      window.location.href = 'yt-down://start';
      let attempts = 0;
      while (attempts < 10 && !serverBtn.classList.contains('active')) {
        await new Promise(r => setTimeout(r, 1000));
        await checkServerHealth();
        attempts++;
      }
      if (!serverBtn.classList.contains('active')) {
        updateQueueUI(nextJob.id, 0, '', 'error: server offline');
        continue; // skip to next
      }
    }

    try {
      updateQueueUI(nextJob.id, 0, '', 'connecting...');
      
      let resp;
      if (nextJob.type === 'subs') {
        resp = await fetch(`${SERVER_URL}/download-subs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: nextJob.url, lang: nextJob.quality }),
          signal: AbortSignal.timeout(30000)
        });
        if (!resp.ok) throw new Error('Sub download failed');
        updateQueueUI(nextJob.id, 100, '', 'done');
        addToHistory({
          title: nextJob.title, type: 'subs', quality: nextJob.quality, ext: 'txt', date: new Date().toISOString()
        });
        renderHistory();
        continue;
      }

      // Audio/Video
      const downloadData = {
        url: nextJob.url,
        type: nextJob.type,
        quality: nextJob.quality,
        ...nextJob.options
      };

      resp = await fetch(`${SERVER_URL}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(downloadData)
      });

      if (!resp.ok) throw new Error('Server error');
      const { jobId } = await resp.json();
      nextJob.serverId = jobId;
      updateQueueUI(nextJob.id, 0, '', 'running');

      // Poll
      await pollJob(nextJob);

      // Done
      addToHistory({
        title: nextJob.title, 
        type: nextJob.type, 
        quality: nextJob.quality, 
        ext: nextJob.type === 'audio' ? 'mp3' : 'mp4', 
        date: new Date().toISOString()
      });
      renderHistory();

    } catch (e) {
      updateQueueUI(nextJob.id, 0, '', 'error: ' + e.message);
    }
  }

  isQueueProcessing = false;
}

async function pollJob(job) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`${SERVER_URL}/progress/${job.serverId}`);
        const d = await r.json();
        updateQueueUI(job.id, d.percent, d.speed || '', d.status === 'done' ? 'done' : 'running');
        if (d.percent >= 100 || d.status === 'done') {
          clearInterval(interval);
          resolve();
        }
        if (d.status === 'error') {
          clearInterval(interval);
          updateQueueUI(job.id, d.percent, '', 'error');
          reject(new Error(d.message || 'Download error'));
        }
      } catch {
        if (attempts > 60) { 
          clearInterval(interval); 
          updateQueueUI(job.id, 0, '', 'error: timeout');
          reject(new Error('Timeout')); 
        }
      }
    }, 1000);
  });
}

// ── History ──
async function addToHistory(entry) {
  const { downloadHistory = [] } = await chrome.storage.local.get('downloadHistory');
  downloadHistory.unshift(entry);
  const trimmed = downloadHistory.slice(0, 10); // Keep last 10
  await chrome.storage.local.set({ downloadHistory: trimmed });
}

async function renderHistory() {
  const { downloadHistory = [] } = await chrome.storage.local.get('downloadHistory');

  if (downloadHistory.length === 0) {
    historyList.innerHTML = '<p class="history-empty">No downloads yet</p>';
    return;
  }

  historyList.innerHTML = downloadHistory.map(item => {
    const date = new Date(item.date);
    const timeStr = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    const typeLabel = item.type === 'audio' ? `MP3 ${item.quality}k` : `MP4 ${item.quality}p`;
    return `
      <div class="history-item">
        <span class="history-title">${escapeHtml(item.title)}</span>
        <span class="history-meta">${typeLabel} · ${timeStr}</span>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
