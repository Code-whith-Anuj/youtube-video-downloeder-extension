# youtube-video-downloeder-extension

Advanced YouTube Downloader Suite

A hybrid Chrome Extension + Local Node.js Server that integrates the
full capabilities of yt-dlp and FFmpeg directly into your browser. This
system provides a secure and high-performance alternative to third-party
download websites.

------------------------------------------------------------------------
UI

<div align="center">
  <img width="362" alt="image" src="https://github.com/user-attachments/assets/625bde0a-5359-4ec0-ace0-faae726ffd9d" />
  <br><br>
  <img width="358" alt="image" src="https://github.com/user-attachments/assets/68677ab6-5378-4293-8d41-3df53341b5ad" />
  <br><br>
  <img width="359" alt="image" src="https://github.com/user-attachments/assets/71359895-c902-41cc-adde-87976e1195af" />
  <br><br>
  <img width="358" alt="image" src="https://github.com/user-attachments/assets/62279ba5-a703-411b-beaf-7230db002f78" />
</div>





------------------------------------------------------------------------

Features

-   4K / 1080p video downloads
-   320kbps MP3 audio extraction
-   Subtitle (CC) downloads
-   Playlist batch downloading
-   Queue-based processing system
-   Clip trimming (start/end time selection)
-   Lyrics embedding (MP3 ID3 tags via LRCLIB API)
-   Max resolution thumbnail download
-   Custom download directory support

------------------------------------------------------------------------

Architecture

Frontend (Chrome Extension)

-   Manifest V3 extension
-   Extracts video and playlist metadata
-   Sends download requests to local server

Backend (Node.js Server)

-   Express server running at http://localhost:9000
-   Executes yt-dlp commands
-   Handles FFmpeg processing
-   Embeds metadata using node-id3
-   Streams progress updates to UI

------------------------------------------------------------------------

Setup

Prerequisites

-   Node.js (v16+)
-   yt-dlp
-   FFmpeg

------------------------------------------------------------------------

Start Server

1.  Open terminal in project directory
2.  Run: npm install
3.  Start server: node server.js
4.  Keep terminal running

------------------------------------------------------------------------

Install Extension

1.  Go to chrome://extensions/
2.  Enable Developer Mode
3.  Click Load unpacked
4.  Select extension folder
5.  Pin extension

------------------------------------------------------------------------

Usage

1.  Open a YouTube video
2.  Click extension icon
3.  Select format and quality
4.  (Optional) Configure trimming or lyrics
5.  Click Download
6.  File enters processing queue

------------------------------------------------------------------------

Configuration

Default path: C:_NAME

To change: - Open extension settings
- Enter custom absolute path
- Save (stored in config.json)

------------------------------------------------------------------------

------------------------------------------------------------------------
 
+Contributing & Editing
+
+This project is open-source. To suggest improvements or edit the code:
+1.  Visit the [GitHub Repository](https://github.com/Code-whith-Anuj/youtube-video-downloeder-extension)
+2.  Click the **Fork** button
+3.  Make your changes and submit a **Pull Request**
+4.  Alternatively, use the **GitHub Web Editor** by pressing `.` while viewing the repository.
+
+------------------------------------------------------------------------
+
 Disclaimer

This tool is for personal use only. Users must comply with copyright
laws and YouTube Terms of Service.