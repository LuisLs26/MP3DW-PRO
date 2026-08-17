const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { exec } = require('child_process');
const youtubedl = require('youtube-dl-exec');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 4895;

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
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
    }

    const ytId = extractYouTubeId(url);
    const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url.trim();

    // Default: use youtube-dl-exec (yt-dlp)
    try {
      const info = await youtubedl(targetUrl, {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        noCheckCertificates: true,
        extractorArgs: 'youtube:player_client=ios,mweb,android,web',
      });

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

// Download Audio / Video Endpoint
app.post('/api/download', async (req, res) => {
  const {
    url,
    title: clientTitle,
    artist: clientArtist,
    format = 'mp3',
    quality = '320',
    trimStart,
    trimEnd,
  } = req.body;

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
      if (tiktokData && tiktokData.playUrl) {
        const streamUrl = tiktokData.playUrl.startsWith('http')
          ? tiktokData.playUrl
          : `https://www.tikwm.com${tiktokData.playUrl}`;

        const tempRawVideo = path.join(TEMP_DIR, `${fileId}_raw.mp4`);
        const finalFile = path.join(TEMP_DIR, `${fileId}.${isVideo ? 'mp4' : format}`);

        // Download the pristine stream to temp file
        const streamRes = await fetch(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
          },
        });

        if (!streamRes.ok) {
          throw new Error('No se pudo descargar el flujo de video de TikTok');
        }

        const buffer = Buffer.from(await streamRes.arrayBuffer());
        fs.writeFileSync(tempRawVideo, buffer);

        // FFmpeg conversion command
        let ffmpegArgs = [`-y`, `-i`, `"${tempRawVideo}"`];

        if (startSec !== null && startSec >= 0) {
          ffmpegArgs.push(`-ss`, `${startSec}`);
        }
        if (endSec !== null && endSec > (startSec || 0)) {
          ffmpegArgs.push(`-to`, `${endSec}`);
        }

        if (isVideo) {
          // Video MP4 direct copy or trim
          ffmpegArgs.push(`-c`, `copy`);
        } else {
          // Audio conversion
          ffmpegArgs.push(`-vn`);
          const audioFmt = ['mp3', 'flac', 'wav'].includes(format.toLowerCase())
            ? format.toLowerCase()
            : 'mp3';

          if (audioFmt === 'mp3') {
            const bitrate = ['320', '256', '192', '128'].includes(String(quality)) ? `${quality}k` : '320k';
            ffmpegArgs.push(`-c:a`, `libmp3lame`, `-b:a`, bitrate, `-q:a`, `0`, `-ar`, `48000`);
          }

          if (clientArtist) {
            ffmpegArgs.push(`-metadata`, `artist="${clientArtist.replace(/"/g, '')}"`);
          }
          if (clientTitle) {
            ffmpegArgs.push(`-metadata`, `title="${cleanTitle.replace(/"/g, '')}"`);
          }
        }

        ffmpegArgs.push(`"${finalFile}"`);

        const ffmpegCmd = `"${ffmpeg.path}" ${ffmpegArgs.join(' ')}`;
        await new Promise((resolve, reject) => {
          exec(ffmpegCmd, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Cleanup raw video
        try { fs.unlinkSync(tempRawVideo); } catch { /* ignore */ }

        // Send generated file
        const fileExt = isVideo ? '.mp4' : `.${format}`;
        const downloadFilename = `${cleanTitle}${fileExt}`;
        const stat = fs.statSync(finalFile);

        res.setHeader('Content-Type', mimeTypes[fileExt.toLowerCase()] || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`
        );

        const stream = fs.createReadStream(finalFile);
        stream.pipe(res);

        stream.on('end', () => cleanupFileId(fileId));
        stream.on('error', (err) => {
          console.error('Stream error:', err);
          cleanupFileId(fileId);
        });

        return;
      }
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
      extractorArgs: 'youtube:player_client=ios,mweb,android,web',
    };

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

      ytOptions.extractorArgs = 'youtube:player_client=android,web';
      ytOptions.format = formatSelector;
      ytOptions.mergeOutputFormat = 'mp4';
      ytOptions.windowsFilenames = true;

      if (postArgs.length > 0) {
        ytOptions.postprocessorArgs = postArgs.join(' ');
      }
    } else {
      ytOptions.format = '251/140/bestaudio/best';
      ytOptions.extractAudio = true;
      ytOptions.extractorArgs = 'youtube:player_client=android,web';
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

    const stream = fs.createReadStream(outputFile);
    stream.pipe(res);

    stream.on('end', () => cleanupFileId(fileId));
    stream.on('error', (err) => {
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
        error: 'Ocurrió un error al procesar la descarga. Intenta de nuevo o prueba con otro formato.',
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
