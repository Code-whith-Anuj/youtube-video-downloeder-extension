#!/usr/bin/env node
/**
 * YT Downloader — Local Backend Server
 * 
 * Runs on http://localhost:9000
 * Wraps yt-dlp to handle download requests from the Chrome extension.
 * 
 * Requirements:
 *   - Node.js 16+
 *   - yt-dlp installed and in PATH (https://github.com/yt-dlp/yt-dlp)
 *   - ffmpeg installed (for audio conversion and merging)
 * 
 * Start: node server.js
 */

const http = require('http');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');
const NodeID3 = require('node-id3');

// ── Configuration ──
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  port: 9000,
  downloadDir: path.join(os.homedir(), 'Downloads', 'YTDownloader')
};

let config = { ...DEFAULT_CONFIG };

// Load config
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const fileData = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fileData) };
  } catch (e) {
    console.error('[Config] Error reading config.json:', e);
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

const PORT = config.port;
let DOWNLOAD_DIR = config.downloadDir;

const LOCAL_YT_DLP = path.join(__dirname, 'yt-dlp.exe');
const LOCAL_FFMPEG = path.join(__dirname, 'ffmpeg.exe');

// Resolved paths
let YTDLP_PATH = 'yt-dlp';
let FFMPEG_PATH = 'ffmpeg';

// Ensure download directory exists
function ensureDownloadDir() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    try {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    } catch (e) {
      console.error('[Error] Could not create download directory:', e);
    }
  }
}
ensureDownloadDir();

// Check for required CLI tools
async function checkDependencies() {
  const check = (cmd, fallback, versionArg = '--version') => new Promise(resolve => {
    // Try to find the full path if it's in PATH
    const whereProc = spawn('where', [cmd]);
    let fullPath = cmd;
    
    whereProc.stdout.on('data', data => {
      const p = data.toString().split('\r\n')[0].trim();
      if (p) fullPath = p;
    });

    whereProc.on('close', (whereCode) => {
      const proc = spawn(fullPath, [versionArg]);
      proc.on('error', () => {
        if (fallback && fs.existsSync(fallback)) {
          resolve({ found: true, path: fallback });
        } else {
          resolve({ found: false, path: null });
        }
      });
      proc.on('close', code => {
        resolve({ found: code === 0, path: fullPath });
      });
    });
  });

  const ytdlp = await check('yt-dlp', LOCAL_YT_DLP);
  const ffmpeg = await check('ffmpeg', LOCAL_FFMPEG, '-version');

  YTDLP_PATH = ytdlp.found ? ytdlp.path : null;
  FFMPEG_PATH = ffmpeg.found ? ffmpeg.path : null;

  return {
    ytdlp: !!ytdlp.found,
    ffmpeg: !!ffmpeg.found,
    paths: { ytdlp: YTDLP_PATH, ffmpeg: FFMPEG_PATH }
  };
}


// In-memory job tracker
const jobs = {};

// ── CORS helper ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24h
}

function sendJSON(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Lyrics Fetching ──
function fetchLyricsFromLRCLIB(title) {
  return new Promise((resolve) => {
    const cleanTitle = title
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/official( video| audio| music video)?/ig, '')
      .replace(/lyrics?/ig, '')
      .trim();

    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`;
    https.get(url, { headers: { 'User-Agent': 'YTDownloader/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (Array.isArray(results) && results.length > 0) {
            const best = results.find(r => r.syncedLyrics) || results[0];
            resolve(best.syncedLyrics || best.plainLyrics || null);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// ── Build yt-dlp args ──
function buildArgs(url, type, quality, options = {}) {
  const args = ['--newline', '--progress', '-o', path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s')];

  // Point to ffmpeg if we found it locally or in PATH
  if (FFMPEG_PATH) {
    args.push('--ffmpeg-location', FFMPEG_PATH);
  }

  // Trimmer: Start / End time
  if (options.startTime || options.endTime) {
    const start = options.startTime || '00:00:00';
    const end = options.endTime || 'inf';
    args.push('--download-sections', `*${start}-${end}`);
  }

  // Playlist support
  if (!options.isPlaylist) {
    args.push('--no-playlist');
  } else {
    args.push('--yes-playlist');
  }

  if (type === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', quality === '320' ? '0' : quality === '256' ? '5' : '9');
  } else if (type === 'subs') {
    // Subtitle download is handled by dedicated /download-subs endpoint
    // This path should not be reached, but just in case:
    args.push('--skip-download', '--write-sub', '--write-auto-sub', '--sub-lang', quality, '--sub-format', 'srt', '--convert-subs', 'srt');
  } else {
    // Use the selected quality height directly
    const h = parseInt(quality) || 720;
    args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`, '--merge-output-format', 'mp4');
  }

  args.push(url);
  return args;
}

// ── Parse yt-dlp progress line ──
function parseProgress(line) {
  // Example: [download]  45.2% of  123.45MiB at  2.34MiB/s ETA 00:30
  const match = line.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+\w+\/s)?/);
  if (match) {
    return {
      percent: Math.round(parseFloat(match[1])),
      speed: match[2] || ''
    };
  }
  return null;
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /settings
  if (req.method === 'GET' && url.pathname === '/settings') {
    return sendJSON(res, 200, config);
  }

  // POST /settings
  if (req.method === 'POST' && url.pathname === '/settings') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        if (updates.downloadDir) {
          config.downloadDir = updates.downloadDir;
          DOWNLOAD_DIR = updates.downloadDir;
          ensureDownloadDir();
        }
        saveConfig();
        sendJSON(res, 200, { success: true, config });
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid config JSON' });
      }
    });
    return;
  }

  // /download — start a download job
  if (url.pathname === '/download') {
    const handleDownloadRequest = (ytUrl, type, quality, options = {}) => {
      if (!ytUrl || !ytUrl.includes('youtube.com')) {
        return sendJSON(res, 400, { error: 'Invalid YouTube URL' });
      }

      const jobId = randomUUID();
      jobs[jobId] = { status: 'running', percent: 0, speed: '', error: null, filePath: null };

      const args = buildArgs(ytUrl, type, quality, options);
      console.log(`[Job ${jobId}] Starting: ${YTDLP_PATH} ${args.join(' ')}`);

      const proc = spawn(YTDLP_PATH, args);

      proc.on('error', (err) => {
        jobs[jobId].status = 'error';
        jobs[jobId].error = `Failed to start yt-dlp: ${err.message}`;
        console.error(`[Job ${jobId}] spawn error:`, err);
      });

      proc.stdout.on('data', data => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          // Capture destination filepath
          const destMatch = line.match(/\[download\] Destination: (.+)/);
          if (destMatch) {
            jobs[jobId].filePath = destMatch[1].trim();
          }
          // Some merges rename the file at the end
          const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
          if (mergeMatch) {
            jobs[jobId].filePath = mergeMatch[1].trim();
          }
          const extractAudioMatch = line.match(/\[ExtractAudio\] Destination: (.+)/);
          if (extractAudioMatch) {
             jobs[jobId].filePath = extractAudioMatch[1].trim();
          }

          const progress = parseProgress(line);
          if (progress) {
            jobs[jobId].percent = progress.percent;
            jobs[jobId].speed = progress.speed;
          }
        }
      });

      proc.stderr.on('data', data => {
        console.error(`[Job ${jobId}] stderr:`, data.toString());
      });

      proc.on('close', async (code) => {
        if (jobs[jobId].status === 'error') return;
        if (code === 0) {
          // Post-processing for subtitles: convert to plain text if needed
          if (type === 'subs') {
            try {
              const files = fs.readdirSync(DOWNLOAD_DIR);
              // Find the most recently modified subtitle file
              const subFile = files
                .filter(f => f.endsWith('.srt') || f.endsWith('.vtt'))
                .map(f => ({ name: f, time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtimeMs }))
                .sort((a, b) => b.time - a.time)[0]?.name;
              
              if (subFile) {
                const fullPath = path.join(DOWNLOAD_DIR, subFile);
                let content = fs.readFileSync(fullPath, 'utf8');
                
                // Remove timestamps and formatting
                // SRT format: 1\n00:00:00,000 --> 00:00:00,000\nText
                content = content
                  .replace(/^\d+$/gm, '') // Remove SRT index numbers
                  .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/g, '') // Remove timestamps
                  .replace(/<[^>]*>/g, '') // Remove HTML tags
                  .replace(/^\s*[\r\n]/gm, '') // Remove empty lines
                  .trim();

                const txtPath = fullPath.replace(/\.(srt|vtt)$/, '.txt');
                fs.writeFileSync(txtPath, content);
                fs.unlinkSync(fullPath); // Delete the original srt
                console.log(`[Job ${jobId}] Subtitle converted to Plain Text: ${txtPath}`);
              }
            } catch (err) {
              console.error(`[Job ${jobId}] Subtitle conversion failed:`, err);
            }
          }
          
          // Lyrics Embedding Logic
          if (type === 'audio' && options.addLyrics && jobs[jobId].filePath && fs.existsSync(jobs[jobId].filePath)) {
            console.log(`[Job ${jobId}] Fetching lyrics...`);
            jobs[jobId].speed = 'Fetching lyrics...';
            const filename = path.basename(jobs[jobId].filePath, path.extname(jobs[jobId].filePath));
            const lyrics = await fetchLyricsFromLRCLIB(filename);
            
            if (lyrics) {
              console.log(`[Job ${jobId}] Lyrics found! Embedding into ID3 tags...`);
              const tags = {
                unsynchronisedLyrics: {
                  language: 'eng',
                  text: lyrics
                }
              };
              try {
                NodeID3.update(tags, jobs[jobId].filePath);
                console.log(`[Job ${jobId}] Lyrics successfully embedded.`);
              } catch (e) {
                console.error(`[Job ${jobId}] Error embedding lyrics:`, e);
              }
            } else {
              console.log(`[Job ${jobId}] No lyrics found for: ${filename}`);
            }
          }

          jobs[jobId].status = 'done';
          jobs[jobId].percent = 100;
          console.log(`[Job ${jobId}] Completed.`);
        } else {
          jobs[jobId].status = 'error';
          jobs[jobId].error = `yt-dlp exited with code ${code}`;
          console.error(`[Job ${jobId}] Failed with code ${code}`);
        }
      });

      sendJSON(res, 200, { jobId });
    };

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const bodyData = JSON.parse(body);
          const { url: ytUrl, type, quality } = bodyData;
          handleDownloadRequest(ytUrl, type, quality, bodyData);
        } catch (e) {
          sendJSON(res, 400, { error: 'Bad request: ' + e.message });
        }
      });
    } else if (req.method === 'GET') {
      const ytUrl = url.searchParams.get('url');
      const type = url.searchParams.get('type');
      const quality = url.searchParams.get('quality');
      handleDownloadRequest(ytUrl, type, quality);
    }
    return;
  }

  // GET /progress/:jobId — check job progress
  const progressMatch = url.pathname.match(/^\/progress\/([a-f0-9-]+)$/i);
  if (req.method === 'GET' && progressMatch) {
    const jobId = progressMatch[1];
    const job = jobs[jobId];
    if (!job) {
      return sendJSON(res, 404, { error: 'Job not found' });
    }
    return sendJSON(res, 200, job);
  }

  // POST /download-subs — download subtitle as plain text
  if (req.method === 'POST' && url.pathname === '/download-subs') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { url: ytUrl, lang } = JSON.parse(body);
        if (!ytUrl || !lang) return sendJSON(res, 400, { error: 'Missing url or lang' });

        console.log(`[Subs] Downloading subtitle lang="${lang}" for ${ytUrl}`);

        // Use a temp dir to avoid clashing with other downloads
        const tempDir = path.join(DOWNLOAD_DIR, '_subs_temp_' + Date.now());
        fs.mkdirSync(tempDir, { recursive: true });

        const args = [
          '--skip-download',
          '--write-sub', '--write-auto-sub',
          '--sub-lang', lang,
          '--convert-subs', 'srt',
          '-o', path.join(tempDir, '%(title)s.%(ext)s'),
          '--no-warnings', '--no-playlist',
          ytUrl
        ];

        console.log(`[Subs] Running: ${YTDLP_PATH} ${args.join(' ')}`);
        const proc = spawn(YTDLP_PATH, args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.stdout.on('data', d => console.log(`[Subs] ${d.toString().trim()}`));

        proc.on('close', code => {
          try {
            // Find any subtitle file in the temp dir (check even on error — file may exist)
            const allFiles = fs.readdirSync(tempDir);
            console.log(`[Subs] Files in temp dir: ${allFiles.join(', ')}`);
            
            const subFile = allFiles.find(f => 
              f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.ass')
            );

            if (!subFile) {
              // Clean up
              fs.rmSync(tempDir, { recursive: true, force: true });
              
              if (stderr.includes('429')) {
                console.error(`[Subs] Rate limited by YouTube`);
                return sendJSON(res, 429, { error: 'YouTube is rate-limiting requests. Please wait 30 seconds and try again.' });
              }
              console.error(`[Subs] No subtitle file found. yt-dlp code=${code}, stderr: ${stderr}`);
              return sendJSON(res, 500, { error: 'No subtitle file was downloaded. This video may not have captions for that language.' });
            }

            const fullPath = path.join(tempDir, subFile);
            let content = fs.readFileSync(fullPath, 'utf8');

            // Convert SRT/VTT to plain text
            content = content
              .replace(/WEBVTT[\s\S]*?\n\n/i, '')           // Remove VTT header
              .replace(/^\d+\s*$/gm, '')                     // Remove SRT index numbers
              .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}.*/g, '') // Remove timestamps
              .replace(/<[^>]*>/g, '')                        // Remove HTML tags
              .replace(/\{[^}]*\}/g, '')                      // Remove ASS tags
              .replace(/^\s*[\r\n]/gm, '')                    // Remove blank lines
              .trim();

            // Deduplicate rolling auto-caption lines
            const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
            const deduped = [];
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              // Skip if identical to previous line
              if (deduped.length > 0 && line === deduped[deduped.length - 1]) continue;
              // Skip if previous line is a substring of current (rolling build-up)
              if (deduped.length > 0 && line.startsWith(deduped[deduped.length - 1])) {
                deduped[deduped.length - 1] = line; // Replace with the longer version
                continue;
              }
              // Skip if current line is a substring of previous (duplicate fragment)
              if (deduped.length > 0 && deduped[deduped.length - 1].startsWith(line)) continue;
              deduped.push(line);
            }
            content = deduped.join('\n');

            // Save to final download dir as .txt
            const baseName = subFile.replace(/\.[^.]+$/, '');
            const txtName = `${baseName}.txt`;
            const txtPath = path.join(DOWNLOAD_DIR, txtName);
            fs.writeFileSync(txtPath, content, 'utf8');

            // Clean up temp dir
            fs.rmSync(tempDir, { recursive: true, force: true });

            console.log(`[Subs] ✅ Saved: ${txtPath} (${content.length} chars)`);
            return sendJSON(res, 200, { 
              status: 'done', 
              file: txtName, 
              path: txtPath,
              chars: content.length 
            });
          } catch (err) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.error(`[Subs] Post-processing error:`, err);
            return sendJSON(res, 500, { error: err.message });
          }
        });
      } catch (err) {
        return sendJSON(res, 400, { error: 'Invalid JSON body' });
      }
    });
    return;
  }

  // GET /health — health check with dependency diagnostic
  if (req.method === 'GET' && url.pathname === '/health') {
    checkDependencies().then(deps => {
      sendJSON(res, 200, {
        status: 'ok',
        downloadDir: DOWNLOAD_DIR,
        dependencies: {
          ytdlp: deps.ytdlp,
          ffmpeg: deps.ffmpeg
        },
        platform: os.platform(),
        uptime: Math.round(process.uptime())
      });
    });
    return;
  }

  // GET /info — fetch available qualities for a video
  if (req.method === 'GET' && url.pathname === '/info') {
    const ytUrl = url.searchParams.get('url');
    if (!ytUrl) return sendJSON(res, 400, { error: 'Missing URL' });

    console.log(`[Info] Fetching metadata for: ${ytUrl}`);
    const proc = spawn(YTDLP_PATH, ['-J', '--no-warnings', '--no-playlist', ytUrl]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        console.error(`[Info] Failed with code ${code}: ${stderr}`);
        return sendJSON(res, 500, { error: 'Failed to fetch video info', detail: stderr });
      }
      try {
        const info = JSON.parse(stdout);
        // Extract unique heights from formats (video only)
        // If it's a flat playlist or similar, info.formats might be missing, 
        // but for a single video it should be there.
        const formats = info.formats || [];
        const heights = [...new Set(formats
          .filter(f => f.vcodec !== 'none' && f.height)
          .map(f => f.height))]
          .sort((a, b) => b - a); // Highest first

        // Extract subtitles
        const subtitles = [];
        const manualLangs = new Set();
        if (info.subtitles) {
          for (const lang in info.subtitles) {
            if (lang === 'live_chat') continue;
            const entry = info.subtitles[lang];
            const name = (entry && entry[0] && entry[0].name) ? entry[0].name : lang;
            subtitles.push({ lang, name, type: 'manual' });
            manualLangs.add(lang);
          }
        }

        // Add ONLY the auto-caption for the original audio language (usually ends in -orig)
        if (info.automatic_captions) {
          for (const lang in info.automatic_captions) {
            if (lang.endsWith('-orig') || lang.includes('orig')) {
              if (manualLangs.has(lang)) continue;
              const entry = info.automatic_captions[lang];
              const name = (entry && entry[0] && entry[0].name) ? entry[0].name : lang;
              subtitles.push({ lang, name: name + ' (Auto)', type: 'auto' });
            }
          }
        }

        sendJSON(res, 200, {
          id: info.id,
          title: info.title,
          thumbnail: info.thumbnail,
          channel: info.uploader,
          qualities: heights.length > 0 ? heights : [1080, 720, 480, 360],
          subtitles: subtitles.sort((a, b) => {
            // Original language always first
            const aOrig = a.name.toLowerCase().includes('original') || a.lang.includes('orig') ? -2 : 0;
            const bOrig = b.name.toLowerCase().includes('original') || b.lang.includes('orig') ? -2 : 0;
            if (aOrig !== bOrig) return aOrig - bOrig;
            // Manual before auto
            if (a.type !== b.type) return a.type === 'manual' ? -1 : 1;
            // Alphabetical
            return a.name.localeCompare(b.name);
          })
        });
      } catch (e) {
        console.error(`[Info] Parse error: ${e.message}`);
        sendJSON(res, 500, { error: 'Failed to parse video info' });
      }
    });
    return;
  }

  // GET /playlist — fetch all video URLs in a playlist quickly
  if (req.method === 'GET' && url.pathname === '/playlist') {
    const ytUrl = url.searchParams.get('url');
    if (!ytUrl) return sendJSON(res, 400, { error: 'Missing URL' });

    console.log(`[Playlist] Fetching items for: ${ytUrl}`);
    const proc = spawn(YTDLP_PATH, ['-J', '--flat-playlist', '--no-warnings', ytUrl]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        console.error(`[Playlist] Failed with code ${code}: ${stderr}`);
        return sendJSON(res, 500, { error: 'Failed to fetch playlist', detail: stderr });
      }
      try {
        const info = JSON.parse(stdout);
        const entries = info.entries || [];
        const videos = entries
          .filter(e => e.url || e.id)
          .map(e => ({
            id: e.id,
            title: e.title,
            url: e.url || `https://www.youtube.com/watch?v=${e.id}`
          }));
        
        sendJSON(res, 200, { title: info.title, videos });
      } catch (e) {
        console.error(`[Playlist] Parse error:`, e.message);
        sendJSON(res, 500, { error: 'Failed to parse playlist info' });
      }
    });
    return;
  }

  // POST /shutdown — close the server
  if (req.method === 'POST' && url.pathname === '/shutdown') {
    sendJSON(res, 200, { message: 'Shutting down...' });
    console.log('\n[Server] Shutdown requested via extension.');
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, 500);
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', async () => {
  const deps = await checkDependencies();
  console.log('--------------------------------------------------');
  console.log(`🚀 YT Downloader Server [RELIABILITY MODE]`);
  console.log(`✅ Listening on: http://localhost:${PORT}`);
  console.log(`📁 Target Dir: ${DOWNLOAD_DIR}`);
  console.log('--------------------------------------------------');

  if (!deps.ytdlp) {
    console.error(`❌ ERROR: yt-dlp not found! Checked PATH and ${LOCAL_YT_DLP}`);
  } else {
    console.log(`✅ yt-dlp: Detected (${YTDLP_PATH})`);
  }

  if (!deps.ffmpeg) {
    console.warn(`⚠️  WARNING: ffmpeg not found! High-quality merging disabled.`);
  } else {
    console.log(`✅ ffmpeg: Detected (${FFMPEG_PATH})`);
  }
  console.log('--------------------------------------------------\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => process.exit(0));
});
