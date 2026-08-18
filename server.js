const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { Readable } = require('stream');
const youtubedl = require('youtube-dl-exec');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 4895;

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Cookies path for authenticated downloads
let COOKIES_PATH = path.join(__dirname, 'cookies.txt');
if (!fs.existsSync(COOKIES_PATH) && fs.existsSync(path.join(__dirname, 'www.youtube.com_cookies.txt'))) {
  COOKIES_PATH = path.join(__dirname, 'www.youtube.com_cookies.txt');
}

// Ensure Node binary directory is in PATH for yt-dlp JavaScript challenge solver
try {
  const nodeDir = path.dirname(process.execPath);
  if (process.env.PATH && !process.env.PATH.includes(nodeDir)) {
    process.env.PATH = `${nodeDir}${path.delimiter}${process.env.PATH}`;
  }
} catch (e) {
  console.warn('PATH setup notice:', e.message);
}

// Ensure FFmpeg binary has execution permissions on Linux/Render
try {
  if (ffmpeg.path && fs.existsSync(ffmpeg.path)) {
    fs.chmodSync(ffmpeg.path, 0o755);
  }
} catch (e) {
  console.warn('FFmpeg chmod notice:', e.message);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Port Discovery ─────────────────────────────────────────

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, exclusive: true });
  });
}

async function getAvailablePort(startPort) {
  let port = startPort;
  while (port < startPort + 50) {
    const available = await checkPortAvailable(port);
    if (available) return port;
    port++;
  }
  return startPort;
}

// ─── Helpers & Platform Detection ───────────────────────────

function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/(?:youtube\.com|youtu\.be)/i.test(trimmed)) {
    return 'youtube';
  }
  if (/(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(trimmed)) {
    return 'tiktok';
  }
  if (/(?:instagram\.com)/i.test(trimmed)) {
    return 'instagram';
  }
  return 'general';
}

function isValidSupportedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const patterns = [
    /^(https?:\/\/)?(www\.|m\.|music\.)?youtube\.com\/.+/i,
    /^(https?:\/\/)?youtu\.be\/.+/i,
    /^(https?:\/\/)?([a-z0-9_.-]+\.)?tiktok\.com\/.+/i,
    /^(https?:\/\/)?(vm|vt)\.tiktok\.com\/.+/i,
    /^(https?:\/\/)?(www\.)?instagram\.com\/.+/i,
  ];
  return patterns.some((p) => p.test(trimmed));
}

function sanitizeFilename(name) {
  if (!name) return 'media';
  return name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 180);
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

function cleanTempFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      // Remove files older than 5 minutes
      if (now - stat.mtimeMs > 5 * 60 * 1000) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

// Clean temp files periodically
setInterval(cleanTempFiles, 3 * 60 * 1000);

function cleanupFileId(fileId) {
  try {
    const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
    files.forEach((f) => {
      try {
        fs.unlinkSync(path.join(TEMP_DIR, f));
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

// ─── TikTok API Handler ──────────────────────────────────────

async function fetchTikTokMetadata(url) {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}`;
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    const json = await res.json();
    if (json && json.data) {
      const d = json.data;
      let rawTitle = d.title || (d.music_info && d.music_info.title) || 'Video de TikTok';
      if (rawTitle.includes('\n')) {
        rawTitle = rawTitle.split('\n')[0].trim();
      }
      const channel = (d.author && (d.author.nickname || d.author.unique_id)) ? `@${d.author.unique_id || d.author.nickname}` : 'TikTok Creator';
      const duration = d.duration || (d.music_info && d.music_info.duration) || 0;

      return {
        id: d.id || '',
        title: rawTitle,
        channel: channel,
        thumbnail: d.cover || d.origin_cover || '',
        duration: duration,
        durationFormatted: formatDuration(duration),
        viewCount: d.play_count || d.digg_count || null,
        uploadDate: d.create_time ? new Date(d.create_time * 1000).toISOString().split('T')[0] : null,
        webpageUrl: url,
        platform: 'tiktok',
        playUrl: d.play || d.wmplay || '',
        musicUrl: d.music || (d.music_info && d.music_info.play) || '',
      };
    }
  } catch (err) {
    console.error('TikWM info error:', err.message || err);
  }
  return null;
}

// ─── API Routes ─────────────────────────────────────────────

// Health & Info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MP3DW Studio Pro',
    version: '2.1.0',
    ffmpeg: ffmpeg.path ? 'ready' : 'missing',
    cookiesPresent: fs.existsSync(COOKIES_PATH),
  });
});

// Helper to extract YouTube video ID
function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|watch\?.+&v=))([\w-]{11})/i);
  return match ? match[1] : null;
}

// Video / Audio Info Endpoint
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidSupportedUrl(url)) {
    return res.status(400).json({ error: 'Por favor, ingresa un enlace válido de YouTube o TikTok.' });
  }

  const platform = detectPlatform(url);

  try {
    console.log(`[Info] Obteniendo metadatos (${platform}) para: ${url}`);

    // Check TikTok specialized API first
    if (platform === 'tiktok') {
      const tiktokData = await fetchTikTokMetadata(url);
      if (tiktokData) {
        return res.json(tiktokData);
      }
      return res.status(404).json({ error: 'No se pudo obtener la información de este video de TikTok. Verifica que el enlace sea público.' });
    }

    const ytId = extractYouTubeId(url);
    const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url.trim();

    // Default: use youtube-dl-exec (yt-dlp)
    try {
      const infoOptions = {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        noCheckCertificates: true,
      };
      if (fs.existsSync(COOKIES_PATH)) {
        infoOptions.cookies = COOKIES_PATH;
        infoOptions.jsRuntimes = `node:${process.execPath}`;
      } else {
        infoOptions.extractorArgs = 'youtube:player_client=android_music,android_creator,tv_embedded';
      }
      const info = await youtubedl(targetUrl, infoOptions);

      const durationSec = Number(info.duration) || 0;
      const formattedDuration = formatDuration(durationSec);

      let rawTitle = info.title || info.description || 'Video de YouTube';
      if (rawTitle.includes('\n')) {
        rawTitle = rawTitle.split('\n')[0].trim();
      }

      const channelName =
        info.channel ||
        info.uploader ||
        info.creator ||
        'Artista';

      let thumbnail = info.thumbnail || '';
      if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
        const bestThumb = info.thumbnails.reduce((prev, current) => {
          return (prev.width || 0) > (current.width || 0) ? prev : current;
        });
        thumbnail = bestThumb.url || thumbnail;
      }

      return res.json({
        id: info.id || ytId || '',
        title: rawTitle,
        channel: channelName,
        thumbnail: thumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : ''),
        duration: durationSec,
        durationFormatted: formattedDuration,
        viewCount: info.view_count || info.like_count || null,
        uploadDate: info.upload_date || null,
        webpageUrl: info.webpage_url || targetUrl,
        platform: 'youtube',
      });
    } catch (ytDlpErr) {
      console.warn('[Info] yt-dlp fallback oEmbed activado para:', targetUrl, ytDlpErr.message);

      if (ytId) {
        try {
          const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + ytId)}&format=json`);
          if (oembedRes.ok) {
            const oembed = await oembedRes.json();
            return res.json({
              id: ytId,
              title: oembed.title || 'Video de YouTube',
              channel: oembed.author_name || 'YouTube Creator',
              thumbnail: oembed.thumbnail_url || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
              duration: 0,
              durationFormatted: 'Completo',
              viewCount: null,
              uploadDate: null,
              webpageUrl: `https://www.youtube.com/watch?v=${ytId}`,
              platform: 'youtube',
            });
          }
        } catch (oembedErr) {
          console.error('[Info] oEmbed error:', oembedErr.message);
        }
      }

      throw ytDlpErr;
    }
  } catch (err) {
    console.error('Info error:', err.message || err);
    res.status(500).json({
      error: 'No se pudo obtener información del enlace. Verifica que sea público y accesible.',
    });
  }
});

// Prepare / Convert Endpoint (Returns immediate downloadUrl)
app.post('/api/prepare', async (req, res) => {
  const {
    url,
    title: clientTitle,
    artist: clientArtist,
    format = 'mp3',
    quality = '320',
    trimStart,
    trimEnd,
  } = req.body || {};

  if (!url || !isValidSupportedUrl(url)) {
    return res.status(400).json({ error: 'URL no válida o no soportada.' });
  }

  const platform = detectPlatform(url);
  const fileId = crypto.randomBytes(8).toString('hex');
  const cleanTitle = sanitizeFilename(clientTitle || (platform === 'tiktok' ? 'tiktok_media' : 'mp3dw_media'));
  const isVideo = format === 'mp4';
  const startSec = parseTimeToSeconds(trimStart);
  const endSec = parseTimeToSeconds(trimEnd);
  const hasTrim = (startSec !== null && startSec >= 0) || (endSec !== null && endSec > (startSec || 0));

  try {
    // ─── TIKTOK DIRECT FAST PATH ───
    if (platform === 'tiktok') {
      const tiktokData = await fetchTikTokMetadata(url);
      if (!tiktokData || (!tiktokData.playUrl && !tiktokData.musicUrl)) {
        throw new Error('No se pudo obtener el video de TikTok. Verifica que el enlace sea público.');
      }

      const audioFmt = ['mp3', 'flac', 'wav'].includes(format.toLowerCase()) ? format.toLowerCase() : 'mp3';
      const fileExt = isVideo ? '.mp4' : `.${audioFmt}`;
      const downloadFilename = `${cleanTitle}${fileExt}`;

      if (!hasTrim && ((isVideo && tiktokData.playUrl) || (!isVideo && audioFmt === 'mp3' && tiktokData.musicUrl))) {
        const directUrl = isVideo
          ? (tiktokData.playUrl.startsWith('http') ? tiktokData.playUrl : `https://www.tikwm.com${tiktokData.playUrl}`)
          : (tiktokData.musicUrl.startsWith('http') ? tiktokData.musicUrl : `https://www.tikwm.com${tiktokData.musicUrl}`);

        return res.json({
          success: true,
          mode: 'direct',
          downloadUrl: directUrl,
          filename: downloadFilename,
        });
      }

      // TikTok with conversion / trim
      const sourceUrl = (!isVideo && tiktokData.musicUrl)
        ? (tiktokData.musicUrl.startsWith('http') ? tiktokData.musicUrl : `https://www.tikwm.com${tiktokData.musicUrl}`)
        : (tiktokData.playUrl.startsWith('http') ? tiktokData.playUrl : `https://www.tikwm.com${tiktokData.playUrl}`);

      const tempRaw = path.join(TEMP_DIR, `${fileId}_raw`);
      const finalFile = path.join(TEMP_DIR, `${fileId}${fileExt}`);

      const rawRes = await fetch(sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tiktok.com/',
        },
      });

      if (!rawRes.ok) throw new Error('No se pudo descargar el flujo de TikTok.');

      const buffer = Buffer.from(await rawRes.arrayBuffer());
      fs.writeFileSync(tempRaw, buffer);

      let ffmpegArgs = ['-y', '-i', tempRaw];
      if (startSec !== null && startSec >= 0) ffmpegArgs.push('-ss', `${startSec}`);
      if (endSec !== null && endSec > (startSec || 0)) ffmpegArgs.push('-to', `${endSec}`);

      if (isVideo) {
        ffmpegArgs.push('-c', 'copy');
      } else {
        ffmpegArgs.push('-vn');
        if (audioFmt === 'mp3') {
          const bitrate = ['320', '256', '192', '128'].includes(String(quality)) ? `${quality}k` : '320k';
          ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', bitrate, '-q:a', '0', '-ar', '48000');
        } else if (audioFmt === 'flac') {
          ffmpegArgs.push('-c:a', 'flac');
        } else if (audioFmt === 'wav') {
          ffmpegArgs.push('-c:a', 'pcm_s16le');
        }
      }

      ffmpegArgs.push(finalFile);

      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpeg.path, ffmpegArgs);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg error code ${code}`)));
        proc.on('error', reject);
      });

      try { fs.unlinkSync(tempRaw); } catch {}

      return res.json({
        success: true,
        mode: 'server',
        downloadUrl: `/api/file/${fileId}?name=${encodeURIComponent(downloadFilename)}`,
        filename: downloadFilename,
      });
    }

    // ─── YOUTUBE PIPELINE ───
    const ytId = extractYouTubeId(url);
    const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url.trim();
    const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);

    const ytOptions = {
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      ffmpegLocation: ffmpeg.path,
      output: outputTemplate,
    };

    if (fs.existsSync(COOKIES_PATH)) {
      ytOptions.cookies = COOKIES_PATH;
      ytOptions.jsRuntimes = `node:${process.execPath}`;
    } else {
      ytOptions.extractorArgs = isVideo
        ? 'youtube:player_client=tv_embedded,web_embedded,android_creator'
        : 'youtube:player_client=android_music,android_creator,tv_embedded';
    }

    let postArgs = [];
    if (startSec !== null && startSec >= 0) postArgs.push(`-ss ${startSec}`);
    if (endSec !== null && endSec > (startSec || 0)) postArgs.push(`-to ${endSec}`);

    if (isVideo) {
      let formatSelector;
      if (quality === '1080') {
        formatSelector = '137+140/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      } else if (quality === '720') {
        formatSelector = '136+140/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      } else if (quality === '480') {
        formatSelector = '135+140/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      } else {
        formatSelector = '18/134+140/bestvideo[height<=360]+bestaudio/best[height<=360]/best';
      }

      ytOptions.format = formatSelector;
      ytOptions.mergeOutputFormat = 'mp4';
      ytOptions.windowsFilenames = true;

      if (postArgs.length > 0) {
        ytOptions.postprocessorArgs = postArgs.join(' ');
      }
    } else {
      ytOptions.format = '251/140/250/249/bestaudio/best';
      ytOptions.extractAudio = true;
      ytOptions.concurrentFragments = 4;
      ytOptions.windowsFilenames = true;

      const audioFmt = ['mp3', 'flac', 'wav'].includes(format.toLowerCase()) ? format.toLowerCase() : 'mp3';
      ytOptions.audioFormat = audioFmt;

      if (audioFmt === 'mp3') {
        const bitrate = ['320', '256', '192', '128'].includes(String(quality)) ? `${quality}K` : '320K';
        ytOptions.audioQuality = bitrate;
      } else {
        ytOptions.audioQuality = '0';
      }

      if (clientArtist) postArgs.push(`-metadata artist="${clientArtist.replace(/"/g, '')}"`);
      if (clientTitle) postArgs.push(`-metadata title="${cleanTitle.replace(/"/g, '')}"`);
      postArgs.push('-threads 0');
      if (postArgs.length > 0) ytOptions.postprocessorArgs = postArgs.join(' ');
      ytOptions.addMetadata = true;
    }

    await youtubedl(targetUrl, ytOptions);

    const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
    if (files.length === 0) {
      throw new Error('No se pudo generar el archivo.');
    }

    const outputFile = path.join(TEMP_DIR, files[0]);
    const fileExt = path.extname(outputFile) || (isVideo ? '.mp4' : `.${format}`);
    const downloadFilename = `${cleanTitle}${fileExt}`;

    return res.json({
      success: true,
      mode: 'server',
      downloadUrl: `/api/file/${fileId}?name=${encodeURIComponent(downloadFilename)}`,
      filename: downloadFilename,
    });

  } catch (err) {
    console.error('Prepare error:', err.message || err);
    cleanupFileId(fileId);
    return res.status(500).json({ error: err.message || 'Error al preparar la descarga.' });
  }
});

// Direct File Download Endpoint
app.get('/api/file/:id', (req, res) => {
  const fileId = req.params.id;
  const customName = req.query.name || 'descarga';
  const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));

  if (files.length === 0) {
    return res.status(404).send('El archivo ha expirado o ya fue descargado.');
  }

  const filePath = path.join(TEMP_DIR, files[0]);
  const fileExt = path.extname(filePath);
  const stat = fs.statSync(filePath);
  const safeName = customName.endsWith(fileExt) ? customName : `${customName}${fileExt}`;

  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.mp4': 'video/mp4',
  };

  res.setHeader('Content-Type', mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );

  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);

  readStream.on('end', () => {
    setTimeout(() => {
      try { fs.unlinkSync(filePath); } catch {}
    }, 60000); // 1 min buffer
  });
});

// Download Audio / Video Endpoint (Supports both POST and GET)
app.all('/api/download', async (req, res) => {
  const data = req.method === 'GET' ? req.query : (req.body || {});
  const {
    url,
    title: clientTitle,
    artist: clientArtist,
    format = 'mp3',
    quality = '320',
    trimStart,
    trimEnd,
  } = data;

  if (!url || !isValidSupportedUrl(url)) {
    return res.status(400).json({ error: 'URL no válida o no soportada.' });
  }

  const platform = detectPlatform(url);
  const fileId = crypto.randomBytes(8).toString('hex');
  const cleanTitle = sanitizeFilename(clientTitle || (platform === 'tiktok' ? 'tiktok_media' : 'mp3dw_media'));
  const isVideo = format === 'mp4';

  const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);

  // MIME Types
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.mp4': 'video/mp4',
  };

  try {
    console.log(`[Download] Iniciando (${platform} - ${format.toUpperCase()} ${quality || ''}): ${cleanTitle}`);

    // Trim arguments setup
    const startSec = parseTimeToSeconds(trimStart);
    const endSec = parseTimeToSeconds(trimEnd);

    // ─── TIKTOK DEDICATED PIPELINE ─────────────────────────
    if (platform === 'tiktok') {
      const tiktokData = await fetchTikTokMetadata(url);
      if (!tiktokData || (!tiktokData.playUrl && !tiktokData.musicUrl)) {
        throw new Error('No se pudo obtener el video de TikTok. Verifica que el enlace sea público.');
      }

      const isAudio = !isVideo;
      const audioFmt = ['mp3', 'flac', 'wav'].includes(format.toLowerCase())
        ? format.toLowerCase()
        : 'mp3';

      const fileExt = isVideo ? '.mp4' : `.${audioFmt}`;
      const downloadFilename = `${cleanTitle}${fileExt}`;
      const hasTrim = (startSec !== null && startSec >= 0) || (endSec !== null && endSec > (startSec || 0));

      // FAST PATH: Direct streaming for instant downloads on mobile and PC
      if (!hasTrim) {
        let directMediaUrl = null;
        if (isVideo && tiktokData.playUrl) {
          directMediaUrl = tiktokData.playUrl.startsWith('http')
            ? tiktokData.playUrl
            : `https://www.tikwm.com${tiktokData.playUrl}`;
        } else if (isAudio && audioFmt === 'mp3' && tiktokData.musicUrl) {
          directMediaUrl = tiktokData.musicUrl.startsWith('http')
            ? tiktokData.musicUrl
            : `https://www.tikwm.com${tiktokData.musicUrl}`;
        }

        if (directMediaUrl) {
          const directRes = await fetch(directMediaUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Referer': 'https://www.tiktok.com/',
            },
          });

          if (directRes.ok) {
            const contentLength = directRes.headers.get('content-length');
            res.setHeader('Content-Type', mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream');
            if (contentLength) res.setHeader('Content-Length', contentLength);
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${downloadFilename.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`
            );

            const nodeStream = Readable.fromWeb(directRes.body);
            nodeStream.pipe(res);
            return;
          }
        }
      }

      // CONVERSION PATH: FFmpeg processing for FLAC/WAV or trimmed clips
      const sourceUrl = (isAudio && tiktokData.musicUrl)
        ? (tiktokData.musicUrl.startsWith('http') ? tiktokData.musicUrl : `https://www.tikwm.com${tiktokData.musicUrl}`)
        : (tiktokData.playUrl.startsWith('http') ? tiktokData.playUrl : `https://www.tikwm.com${tiktokData.playUrl}`);

      const tempRaw = path.join(TEMP_DIR, `${fileId}_raw`);
      const finalFile = path.join(TEMP_DIR, `${fileId}${fileExt}`);

      const rawRes = await fetch(sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tiktok.com/',
        },
      });

      if (!rawRes.ok) {
        throw new Error('No se pudo descargar el flujo multimedia de TikTok');
      }

      const buffer = Buffer.from(await rawRes.arrayBuffer());
      fs.writeFileSync(tempRaw, buffer);

      let ffmpegArgs = ['-y', '-i', tempRaw];
      if (startSec !== null && startSec >= 0) ffmpegArgs.push('-ss', `${startSec}`);
      if (endSec !== null && endSec > (startSec || 0)) ffmpegArgs.push('-to', `${endSec}`);

      if (isVideo) {
        ffmpegArgs.push('-c', 'copy');
      } else {
        ffmpegArgs.push('-vn');
        if (audioFmt === 'mp3') {
          const bitrate = ['320', '256', '192', '128'].includes(String(quality)) ? `${quality}k` : '320k';
          ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', bitrate, '-q:a', '0', '-ar', '48000');
        } else if (audioFmt === 'flac') {
          ffmpegArgs.push('-c:a', 'flac');
        } else if (audioFmt === 'wav') {
          ffmpegArgs.push('-c:a', 'pcm_s16le');
        }
      }

      ffmpegArgs.push(finalFile);

      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpeg.path, ffmpegArgs);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg falló con código ${code}`));
        });
        proc.on('error', reject);
      });

      try { fs.unlinkSync(tempRaw); } catch {}

      const stat = fs.statSync(finalFile);
      res.setHeader('Content-Type', mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadFilename.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`
      );

      const fileStream = fs.createReadStream(finalFile);
      fileStream.pipe(res);
      fileStream.on('end', () => {
        setTimeout(() => {
          try { fs.unlinkSync(finalFile); } catch {}
        }, 2000);
      });
      return;
    }

    // ─── YOUTUBE & GENERAL PIPELINE (yt-dlp) ───────────────
    const ytId = extractYouTubeId(url);
    const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url.trim();

    const ytOptions = {
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      ffmpegLocation: ffmpeg.path,
      output: outputTemplate,
    };

    if (fs.existsSync(COOKIES_PATH)) {
      ytOptions.cookies = COOKIES_PATH;
      ytOptions.jsRuntimes = `node:${process.execPath}`;
    } else {
      ytOptions.extractorArgs = isVideo
        ? 'youtube:player_client=tv_embedded,web_embedded,android_creator'
        : 'youtube:player_client=android_music,android_creator,tv_embedded';
    }

    let postArgs = [];
    if (startSec !== null && startSec >= 0) {
      postArgs.push(`-ss ${startSec}`);
    }
    if (endSec !== null && endSec > (startSec || 0)) {
      postArgs.push(`-to ${endSec}`);
    }

    if (isVideo) {
      let formatSelector;
      if (quality === '1080') {
        formatSelector = '137+140/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      } else if (quality === '720') {
        formatSelector = '136+140/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      } else if (quality === '480') {
        formatSelector = '135+140/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      } else {
        formatSelector = '18/134+140/bestvideo[height<=360]+bestaudio/best[height<=360]/best';
      }

      ytOptions.format = formatSelector;
      ytOptions.mergeOutputFormat = 'mp4';
      ytOptions.windowsFilenames = true;

      if (postArgs.length > 0) {
        ytOptions.postprocessorArgs = postArgs.join(' ');
      }
    } else {
      ytOptions.format = '251/140/250/249/bestaudio/best';
      ytOptions.extractAudio = true;
      ytOptions.concurrentFragments = 4;
      ytOptions.windowsFilenames = true;

      const audioFmt = ['mp3', 'flac', 'wav'].includes(format.toLowerCase())
        ? format.toLowerCase()
        : 'mp3';

      ytOptions.audioFormat = audioFmt;

      if (audioFmt === 'mp3') {
        const bitrate = ['320', '256', '192', '128'].includes(String(quality)) ? `${quality}K` : '320K';
        ytOptions.audioQuality = bitrate;
      } else {
        ytOptions.audioQuality = '0';
      }

      if (clientArtist) {
        postArgs.push(`-metadata artist="${clientArtist.replace(/"/g, '')}"`);
      }
      if (clientTitle) {
        postArgs.push(`-metadata title="${cleanTitle.replace(/"/g, '')}"`);
      }

      if (postArgs.length > 0) {
        ytOptions.postprocessorArgs = postArgs.join(' ');
      }

      ytOptions.addMetadata = true;
    }

    await youtubedl(targetUrl, ytOptions);

    const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
    if (files.length === 0) {
      return res.status(500).json({ error: 'No se pudo generar el archivo solicitado.' });
    }

    const outputFile = path.join(TEMP_DIR, files[0]);
    const fileExt = path.extname(outputFile) || (isVideo ? '.mp4' : `.${format}`);
    const downloadFilename = `${cleanTitle}${fileExt}`;
    const asciiFilename = `${cleanTitle.replace(/[^a-zA-Z0-9_\-.]/g, '_')}${fileExt}`;
    const stat = fs.statSync(outputFile);

    res.setHeader('Content-Type', mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(downloadFilename).replace(/'/g, '%27')}`
    );

    const readStream = fs.createReadStream(outputFile);
    readStream.pipe(res);

    readStream.on('end', () => cleanupFileId(fileId));
    readStream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al enviar el archivo generado' });
      }
      cleanupFileId(fileId);
    });

  } catch (err) {
    console.error('Download error:', err.message || err);
    cleanupFileId(fileId);
    if (!res.headersSent) {
      res.status(500).json({
        error: err.message || 'Ocurrió un error al procesar la descarga. Intenta de nuevo o prueba con otro formato.',
      });
    }
  }
});

// ─── Open Browser Function ──────────────────────────────────

function openBrowser(url) {
  const startCmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, (err) => {
    if (err) {
      console.log(`[INFO] Puedes abrir la aplicación en: ${url}`);
    }
  });
}

// ─── Start Server ───────────────────────────────────────────

async function start() {
  const port = await getAvailablePort(DEFAULT_PORT);
  const serverUrl = `http://localhost:${port}`;

  app.listen(port, '0.0.0.0', () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║            🎵  MP3DW STUDIO PRO v2.1  🎵                  ║
  ║                                                           ║
  ║  ⚡ Servidor activo en: ${serverUrl.padEnd(33)} ║
  ║  ⚡ Puerto:             ${String(port).padEnd(33)} ║
  ║  ⚡ FFmpeg:            ${(ffmpeg.path ? 'Instalado y Listo' : 'No encontrado').padEnd(33)} ║
  ║  ⚡ Soporte:            YouTube + TikTok (MP3 / MP4)      ║
  ╚═══════════════════════════════════════════════════════════╝
    `);

    if (process.env.NO_AUTO_OPEN !== 'true' && !process.env.RENDER && !process.env.PORT) {
      setTimeout(() => {
        openBrowser(serverUrl);
      }, 500);
    }
  });
}

start().catch((err) => {
  console.error('Error fatal al iniciar servidor:', err);
});
