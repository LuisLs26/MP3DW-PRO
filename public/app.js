/* ═══════════════════════════════════════════════════════════
   MP3DW STUDIO PRO — Advanced App Logic & Media Downloader
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM References ──────────────────────────────────────
  const urlInput = document.getElementById('urlInput');
  const searchBtn = document.getElementById('searchBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const clearBtn = document.getElementById('clearBtn');

  // State Sections
  const loadingSection = document.getElementById('loadingSection');
  const previewSection = document.getElementById('previewSection');
  const progressSection = document.getElementById('progressSection');
  const successSection = document.getElementById('successSection');
  const errorSection = document.getElementById('errorSection');
  const historySection = document.getElementById('historySection');

  // Preview Elements
  const previewThumb = document.getElementById('previewThumb');
  const previewTitle = document.getElementById('previewTitle');
  const previewChannel = document.getElementById('previewChannel');
  const previewPlatformBadge = document.getElementById('previewPlatformBadge');
  const previewDuration = document.getElementById('previewDuration');
  const previewViews = document.getElementById('previewViews');
  const previewExtLink = document.getElementById('previewExtLink');

  // Format Switchers & Panels
  const tabAudio = document.getElementById('tabAudio');
  const tabVideo = document.getElementById('tabVideo');
  const audioOptionsPanel = document.getElementById('audioOptionsPanel');
  const videoOptionsPanel = document.getElementById('videoOptionsPanel');
  const audioFormatGroup = document.getElementById('audioFormatGroup');
  const bitrateContainer = document.getElementById('bitrateContainer');
  const bitrateGroup = document.getElementById('bitrateGroup');
  const videoQualityGroup = document.getElementById('videoQualityGroup');

  // Custom Tools (Metadata & Trimmer)
  const metaToggleBtn = document.getElementById('metaToggleBtn');
  const metaFields = document.getElementById('metaFields');
  const customTitleInput = document.getElementById('customTitleInput');
  const customArtistInput = document.getElementById('customArtistInput');

  const trimToggleBtn = document.getElementById('trimToggleBtn');
  const trimFields = document.getElementById('trimFields');
  const trimStartInput = document.getElementById('trimStartInput');
  const trimEndInput = document.getElementById('trimEndInput');
  const trimResetBtn = document.getElementById('trimResetBtn');

  // Action Buttons
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadBtnText = document.getElementById('downloadBtnText');
  const newDownloadBtn = document.getElementById('newDownloadBtn');
  const retryBtn = document.getElementById('retryBtn');
  const errorResetBtn = document.getElementById('errorResetBtn');
  const errorText = document.getElementById('errorText');
  const successDetails = document.getElementById('successDetails');

  // Progress Indicators
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressStatusDetail = document.getElementById('progressStatusDetail');
  const progressTitle = document.getElementById('progressTitle');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const stepLine1 = document.getElementById('stepLine1');
  const stepLine2 = document.getElementById('stepLine2');

  // History Elements
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const toastContainer = document.getElementById('toastContainer');

  // ─── Application State ───────────────────────────────────
  let state = {
    currentUrl: '',
    rawTitle: '',
    rawChannel: '',
    durationSec: 0,
    durationFormatted: '0:00',
    thumbnail: '',
    platform: 'youtube', // 'youtube' | 'tiktok' | 'general'
    mode: 'audio', // 'audio' | 'video'
    audioFormat: 'mp3', // 'mp3' | 'm4a' | 'flac' | 'wav' | 'opus'
    bitrate: '320', // '320' | '256' | '192' | '128'
    videoQuality: '1080', // '1080' | '720' | '480' | '360'
    isDownloading: false,
  };

  const STORAGE_KEY = 'mp3dw_pro_history_v2';

  // ─── Toast System ────────────────────────────────────────
  function showToast(message, icon = '✨') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // ─── URL Validation ──────────────────────────────────────
  function isValidSupportedUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    const patterns = [
      /^(https?:\/\/)?(www\.)?youtube\.com\/(watch\?v=|shorts\/|live\/|embed\/)[\w-]{11}/i,
      /^(https?:\/\/)?youtu\.be\/[\w-]{11}/i,
      /^(https?:\/\/)?(music\.)?youtube\.com\/watch\?v=[\w-]{11}/i,
      /^(https?:\/\/)?([a-z0-9]+\.)?tiktok\.com\/(@[\w.-]+\/(video|photo)\/\d+|v\/\d+|t\/[\w.-]+|[\w.-]+)/i,
      /^(https?:\/\/)?(vm|vt)\.tiktok\.com\/[\w.-]+/i,
      /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|tv)\/[\w.-]+/i,
    ];
    return patterns.some((p) => p.test(trimmed));
  }

  // ─── Visibility Helpers ──────────────────────────────────
  function hideAllSections() {
    loadingSection.style.display = 'none';
    previewSection.style.display = 'none';
    progressSection.style.display = 'none';
    successSection.style.display = 'none';
    errorSection.style.display = 'none';
  }

  function showSection(section) {
    hideAllSections();
    section.style.display = 'flex';
  }

  function showError(message) {
    errorText.textContent = message || 'Ocurrió un error al procesar tu solicitud.';
    showSection(errorSection);
  }

  // ─── Dynamic Button Label ────────────────────────────────
  function updateDownloadButtonLabel() {
    if (state.mode === 'video') {
      const qText = state.platform === 'tiktok' ? 'Original HD' : `${state.videoQuality}p`;
      downloadBtnText.textContent = `Descargar Video MP4 (${qText})`;
    } else {
      if (state.audioFormat === 'mp3') {
        downloadBtnText.textContent = `Descargar MP3 (${state.bitrate} kbps)`;
      } else if (state.audioFormat === 'flac' || state.audioFormat === 'wav') {
        downloadBtnText.textContent = `Descargar ${state.audioFormat.toUpperCase()} (Lossless)`;
      } else {
        downloadBtnText.textContent = `Descargar Audio (${state.audioFormat.toUpperCase()})`;
      }
    }
  }

  // ─── Fetch Video Metadata ────────────────────────────────
  async function fetchVideoInfo(targetUrl) {
    const url = (targetUrl || urlInput.value).trim();
    if (!isValidSupportedUrl(url)) {
      showToast('Ingresa un enlace válido de YouTube o TikTok', '⚠️');
      return;
    }

    state.currentUrl = url;
    showSection(loadingSection);
    searchBtn.disabled = true;
    clearBtn.style.display = 'flex';

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo obtener información del enlace.');
      }

      // Populate State
      state.rawTitle = data.title || 'Video';
      state.rawChannel = data.channel || 'Creador';
      state.durationSec = data.duration || 0;
      state.durationFormatted = data.durationFormatted || '0:00';
      state.thumbnail = data.thumbnail || '';
      state.platform = data.platform || 'general';

      // Populate UI Preview
      previewTitle.textContent = state.rawTitle;
      previewChannel.textContent = state.rawChannel;
      previewDuration.textContent = state.durationFormatted;
      previewExtLink.href = data.webpageUrl || url;

      if (previewPlatformBadge) {
        previewPlatformBadge.className = `badge badge-platform badge-${state.platform}`;
        if (state.platform === 'tiktok') {
          previewPlatformBadge.innerHTML = '🎵 TikTok';
        } else if (state.platform === 'youtube') {
          previewPlatformBadge.innerHTML = '▶ YouTube';
        } else {
          previewPlatformBadge.innerHTML = '🌐 Video';
        }
      }

      if (data.viewCount) {
        const viewsNum = Number(data.viewCount);
        previewViews.textContent = `${viewsNum.toLocaleString()} vistas / likes`;
        previewViews.style.display = 'inline-block';
      } else {
        previewViews.style.display = 'none';
      }

      if (state.thumbnail) {
        previewThumb.src = state.thumbnail;
      }

      // Populate Metadata Inputs
      customTitleInput.value = state.rawTitle;
      customArtistInput.value = state.rawChannel;

      // Setup Trimmer End default placeholder
      trimEndInput.placeholder = state.durationFormatted;

      updateDownloadButtonLabel();
      showSection(previewSection);
      showToast(`Información cargada (${state.platform === 'tiktok' ? 'TikTok' : 'YouTube'})`, '✅');
    } catch (err) {
      showError(err.message || 'Error al conectar con el servidor.');
    } finally {
      searchBtn.disabled = false;
    }
  }

  // ─── Step Indicator Progress Helpers ─────────────────────
  function updateProgressStage(stepNum, percent, statusText) {
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${Math.round(percent)}%`;
    progressStatusDetail.textContent = statusText;

    if (stepNum >= 1) {
      step1.classList.add('active');
    }
    if (stepNum >= 2) {
      step1.classList.add('done');
      stepLine1.classList.add('active');
      step2.classList.add('active');
    }
    if (stepNum >= 3) {
      step2.classList.add('done');
      stepLine2.classList.add('active');
      step3.classList.add('active');
      step3.classList.add('done');
    }
  }

  function resetSteps() {
    [step1, step2, step3].forEach((s) => s.classList.remove('active', 'done'));
    [stepLine1, stepLine2].forEach((l) => l.classList.remove('active'));
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
  }

  // ─── Download Process (Real-Time SSE Progress + Instant Download) ───
  async function startDownload() {
    if (!state.currentUrl || state.isDownloading) return;

    state.isDownloading = true;
    downloadBtn.disabled = true;
    resetSteps();
    showSection(progressSection);

    progressTitle.textContent = state.mode === 'video' ? 'Procesando Video MP4...' : 'Convirtiendo Audio en Alta Calidad...';
    updateProgressStage(1, 5, 'Conectando con el motor de descarga...');

    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    const payload = {
      url: state.currentUrl,
      title: customTitleInput.value.trim() || state.rawTitle,
      artist: customArtistInput.value.trim() || state.rawChannel,
      format: state.mode === 'video' ? 'mp4' : state.audioFormat,
      quality: state.mode === 'video' ? state.videoQuality : state.bitrate,
      trimStart: trimStartInput.value.trim() || '',
      trimEnd: trimEndInput.value.trim() || '',
      jobId,
    };

    const fileExt = payload.format;
    const safeTitle = (payload.title || 'audio').replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim() || 'descarga';
    const cleanSafeName = `${safeTitle}.${fileExt}`;

    // Setup Real-Time Server-Sent Events (SSE) Progress Listener
    let eventSource = null;
    try {
      eventSource = new EventSource(`/api/progress/${jobId}`);
      eventSource.onmessage = (e) => {
        try {
          const progressData = JSON.parse(e.data);
          if (progressData.stage && progressData.percent !== undefined) {
            updateProgressStage(progressData.stage, progressData.percent, progressData.text);
          }
        } catch {}
      };
    } catch (e) {
      console.warn('SSE setup warning:', e);
    }

    try {
      const res = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (eventSource) {
        eventSource.close();
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al procesar la descarga.');
      }

      updateProgressStage(3, 100, '¡Archivo listo! Guardando en tu navegador...');

      // Trigger instant native browser download
      const downloadLink = document.createElement('a');
      downloadLink.href = data.downloadUrl;
      downloadLink.setAttribute('download', cleanSafeName);
      downloadLink.download = cleanSafeName;
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();

      setTimeout(() => {
        if (downloadLink.parentNode) document.body.removeChild(downloadLink);
      }, 3000);

      // Setup direct fallback download button on success card
      const directDownloadLink = document.getElementById('directDownloadLink');
      if (directDownloadLink) {
        directDownloadLink.href = data.downloadUrl;
        directDownloadLink.setAttribute('download', cleanSafeName);
        directDownloadLink.download = cleanSafeName;
        directDownloadLink.style.display = 'inline-flex';
      }

      // Save to History
      addToHistory({
        url: state.currentUrl,
        title: payload.title,
        channel: payload.artist,
        format: fileExt.toUpperCase(),
        quality: state.mode === 'video' ? (state.platform === 'tiktok' ? 'HD' : `${state.videoQuality}p`) : `${state.bitrate}k`,
        thumbnail: state.thumbnail,
        platform: state.platform || 'general',
        timestamp: Date.now(),
      });

      // Show Success Section
      setTimeout(() => {
        successDetails.textContent = `"${payload.title}" (${fileExt.toUpperCase()}) se ha guardado en tu carpeta de descargas.`;
        showSection(successSection);
        showToast('Descarga completada', '🎉');
      }, 600);

    } catch (err) {
      if (eventSource) eventSource.close();
      showError(err.message || 'Ocurrió un error durante la conversión.');
    } finally {
      state.isDownloading = false;
      downloadBtn.disabled = false;
    }
  }

  // ─── Reset State ─────────────────────────────────────────
  function resetToHome() {
    urlInput.value = '';
    clearBtn.style.display = 'none';
    searchBtn.disabled = true;
    state.currentUrl = '';
    state.rawTitle = '';
    state.rawChannel = '';
    customTitleInput.value = '';
    customArtistInput.value = '';
    trimStartInput.value = '';
    trimEndInput.value = '';
    hideAllSections();
    urlInput.focus();
  }

  // ─── LocalStorage History ────────────────────────────────
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 15)));
    } catch {
      /* ignore */
    }
  }

  function addToHistory(item) {
    let list = getHistory();
    list = list.filter((i) => i.url !== item.url || i.title !== item.title);
    list.unshift(item);
    saveHistory(list);
    renderHistory();
  }

  function renderHistory() {
    const list = getHistory();
    if (list.length === 0) {
      historySection.style.display = 'none';
      return;
    }

    historySection.style.display = 'block';
    historyList.innerHTML = '';

    list.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      const platformLabel = item.platform === 'tiktok' ? '🎵 TikTok' : '▶ YouTube';
      const platformStyle = item.platform === 'tiktok' ? 'background:rgba(0,242,254,0.15);color:#a5f3fc;' : '';

      el.innerHTML = `
        <img class="history-thumb" src="${item.thumbnail || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'34\' fill=\'%23111\'><rect width=\'100%\' height=\'100%\'/></svg>'}" alt="Cover" />
        <div class="history-meta">
          <div class="history-track-title" title="${item.title}">${item.title}</div>
          <div class="history-track-sub">
            <span class="history-badge" style="${platformStyle}">${platformLabel}</span>
            <span>${item.channel || ''}</span>
            <span class="history-badge">${item.format} ${item.quality || ''}</span>
          </div>
        </div>
        <div class="history-actions">
          <button type="button" class="btn-history-action btn-history-load" title="Cargar y descargar">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button type="button" class="btn-history-action btn-history-copy" title="Copiar enlace">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      `;

      el.querySelector('.btn-history-load').addEventListener('click', () => {
        urlInput.value = item.url;
        clearBtn.style.display = 'flex';
        searchBtn.disabled = false;
        fetchVideoInfo(item.url);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      el.querySelector('.btn-history-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(item.url).then(() => {
          showToast('Enlace copiado al portapapeles', '📋');
        });
      });

      historyList.appendChild(el);
    });
  }

  // ─── Event Handlers & Binding ────────────────────────────

  // Input & Paste Listeners
  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    clearBtn.style.display = val.length > 0 ? 'flex' : 'none';
    searchBtn.disabled = !isValidSupportedUrl(val);
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (isValidSupportedUrl(val)) {
        fetchVideoInfo(val);
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    clearBtn.style.display = 'none';
    searchBtn.disabled = true;
    urlInput.focus();
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && isValidSupportedUrl(text)) {
        urlInput.value = text.trim();
        clearBtn.style.display = 'flex';
        searchBtn.disabled = false;
        showToast('Enlace pegado del portapapeles', '📋');
        fetchVideoInfo(text.trim());
      } else if (text) {
        urlInput.value = text.trim();
        clearBtn.style.display = 'flex';
        searchBtn.disabled = !isValidSupportedUrl(text.trim());
        showToast('Texto pegado', 'ℹ️');
      } else {
        showToast('El portapapeles está vacío', '⚠️');
      }
    } catch {
      urlInput.focus();
      showToast('Presiona Ctrl+V para pegar', '⌨️');
    }
  });

  searchBtn.addEventListener('click', () => {
    fetchVideoInfo();
  });

  // Mode Switcher (Audio vs Video)
  tabAudio.addEventListener('click', () => {
    state.mode = 'audio';
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    audioOptionsPanel.style.display = 'block';
    videoOptionsPanel.style.display = 'none';
    updateDownloadButtonLabel();
  });

  tabVideo.addEventListener('click', () => {
    state.mode = 'video';
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    audioOptionsPanel.style.display = 'none';
    videoOptionsPanel.style.display = 'block';
    updateDownloadButtonLabel();
  });

  // Audio Format Pills
  audioFormatGroup.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    audioFormatGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    state.audioFormat = pill.getAttribute('data-format');

    // Bitrate selection is only relevant for MP3
    if (state.audioFormat === 'mp3') {
      bitrateContainer.style.display = 'block';
    } else {
      bitrateContainer.style.display = 'none';
    }

    updateDownloadButtonLabel();
  });

  // Bitrate Pills
  bitrateGroup.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    bitrateGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    state.bitrate = pill.getAttribute('data-quality');
    updateDownloadButtonLabel();
  });

  // Video Quality Pills
  videoQualityGroup.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    videoQualityGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    state.videoQuality = pill.getAttribute('data-quality');
    updateDownloadButtonLabel();
  });

  // Accordions
  metaToggleBtn.addEventListener('click', () => {
    const parent = metaToggleBtn.closest('.tool-toggle-section');
    const isOpen = parent.classList.toggle('open');
    metaFields.style.display = isOpen ? 'block' : 'none';
  });

  trimToggleBtn.addEventListener('click', () => {
    const parent = trimToggleBtn.closest('.tool-toggle-section');
    const isOpen = parent.classList.toggle('open');
    trimFields.style.display = isOpen ? 'block' : 'none';
  });

  trimResetBtn.addEventListener('click', () => {
    trimStartInput.value = '';
    trimEndInput.value = '';
    showToast('Recorte restablecido a pista completa', '🔄');
  });

  // Action Buttons
  downloadBtn.addEventListener('click', startDownload);
  newDownloadBtn.addEventListener('click', resetToHome);
  errorResetBtn.addEventListener('click', resetToHome);
  retryBtn.addEventListener('click', () => {
    if (state.currentUrl) {
      fetchVideoInfo(state.currentUrl);
    } else {
      resetToHome();
    }
  });

  clearHistoryBtn.addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
    showToast('Historial borrado', '🗑️');
  });

  // Initialize
  renderHistory();
  urlInput.focus();
})();
