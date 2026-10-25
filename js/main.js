/* ======================================================
   主逻辑模块
   - 上传、拖拽、粘贴图片
   - 绘制文字 / LOGO 水印（单个 / 平铺）
   - 下载与复制（直接导出原始分辨率画布）
   - 历史记录（IndexedDB 存原图，localStorage 存元数据）
   - 双语支持
   ====================================================== */

import { showToast } from './ui.js';
import { loadSettings, saveSettings, initSettingsAutoSave } from './settings.js';

// ========== 常量 ==========
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_HISTORY_ITEMS = 20;
const REFERENCE_SIZE = 1000; // 文字大小 / 平铺间距以「图片短边 1000px」为基准等比缩放
const THUMBNAIL_SIZE = 80;
const DEFAULT_TEXTS = ['水印', 'Watermark'];
const WEBSITE_TEXT = 'aishuiyin.babydu.cn';

// ========== IndexedDB 辅助函数 (用于存储大图，解决 localStorage 限制) ==========
const DB_NAME = 'WatermarkToolDB';
const STORE_NAME = 'images';
const DB_VERSION = 1;
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => {
        dbPromise = null;
        reject(e.target.error);
      };
    });
  }
  return dbPromise;
}

async function saveImageToDB(id, data) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB save failed:', err);
  }
}

async function loadImageFromDB(id) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB load failed:', err);
    return null;
  }
}

async function deleteImageFromDB(id) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB delete failed:', err);
  }
}

// ========== 全局状态 ==========
let dropZone, imgInput, watermarkImgInput, canvas, ctx;

let baseImage = null;
let watermarkImage = null;
let currentFileName = '';
let watermarkPos = { x: 0, y: 0 };
let tileOffset = { x: 0, y: 0 }; // 平铺模式的偏移量

let historyList = [];
let currentHistoryId = null;
let lastHistoryId = 0;

let currentLanguage = 'zh';

const $ = (id) => document.getElementById(id);

// ========== 语言 ==========
function t(zh, en) {
  return currentLanguage === 'zh' ? zh : en;
}

function detectSystemLanguage() {
  const systemLang = navigator.language || navigator.userLanguage || '';
  return systemLang.startsWith('en') ? 'en' : 'zh';
}

function initLanguage() {
  currentLanguage = localStorage.getItem('language') || detectSystemLanguage();
  localStorage.setItem('language', currentLanguage);
  applyLanguage();

  const languageToggle = $('languageToggle');
  if (languageToggle) {
    languageToggle.addEventListener('click', () => {
      currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
      localStorage.setItem('language', currentLanguage);
      applyLanguage();
    });
  }
}

function applyLanguage() {
  document.querySelectorAll('[data-zh][data-en]').forEach((el) => {
    const text = el.getAttribute(`data-${currentLanguage}`);
    if (text) el.textContent = text;
  });

  document.querySelectorAll('[data-placeholder-zh][data-placeholder-en]').forEach((input) => {
    const placeholder = input.getAttribute(`data-placeholder-${currentLanguage}`);
    if (placeholder) input.placeholder = placeholder;
  });

  const languageIcon = $('languageIcon');
  if (languageIcon) languageIcon.textContent = currentLanguage === 'zh' ? 'EN' : '中';

  document.documentElement.lang = currentLanguage === 'zh' ? 'zh-cn' : 'en';

  // 只替换默认水印文字，不覆盖用户自定义（或特意清空）的内容
  const watermarkInput = $('watermarkText');
  if (watermarkInput && DEFAULT_TEXTS.includes(watermarkInput.value.trim())) {
    watermarkInput.value = t('水印', 'Watermark');
    saveSettings();
  }

  updateLogoButtonState();
  updateHistoryDisplay();
  requestRepaint();
}

// ========== 初始化 ==========
function init() {
  dropZone = $('preview');
  imgInput = $('imgInput');
  watermarkImgInput = $('watermarkImg');
  canvas = $('canvas');

  if (!dropZone || !imgInput || !canvas) {
    console.error('关键DOM元素未找到');
    return;
  }

  ctx = canvas.getContext('2d');

  loadSettings();
  migrateLegacyTileMode();
  refreshSliderLabels();
  initSettingsAutoSave();

  initLanguage();
  initControls();
  initUploadEvents();
  initPasteEvents();
  initDragEvents();
  initGlobalDragPrevention();
  window.addEventListener('resize', onWindowResize);

  switchToUploadMode();
  loadHistoryFromStorage();

  showToast(t('欢迎使用 AI 水印工具 🎨', 'Welcome to AI Watermark Tool 🎨'), 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// 旧版本保存的是隐藏的 mode 下拉框，这里迁移到平铺开关
function migrateLegacyTileMode() {
  try {
    const saved = JSON.parse(localStorage.getItem('wm_settings') || '{}');
    const tileMode = $('tileMode');
    if (tileMode && !('tileMode' in saved) && saved.mode === 'tile') {
      tileMode.checked = true;
      saveSettings();
    }
  } catch (err) {
    console.warn('迁移平铺设置失败：', err);
  }
}

// ========== 控件 ==========
function getSettings() {
  const opacity = parseFloat($('opacity').value);
  return {
    text: $('watermarkText').value.trim(),
    fontSize: parseInt($('fontSize').value, 10) || 50,
    fontColor: $('fontColor').value,
    opacity: Number.isFinite(opacity) ? opacity : 0.5,
    rotate: parseFloat($('rotate').value) || 0,
    mode: $('tileMode').checked ? 'tile' : 'single',
    tileGap: parseInt($('tileGap').value, 10) || 150,
  };
}

function refreshSliderLabels() {
  const opacity = $('opacity');
  const tileGap = $('tileGap');
  const fontSize = $('fontSize');
  if (opacity) $('opacityValue').textContent = Math.round(opacity.value * 100) + '%';
  if (tileGap) $('densityValue').textContent = tileGap.value;
  if (fontSize) $('sizeValue').textContent = fontSize.value;
}

function initControls() {
  ['watermarkText', 'fontSize', 'fontColor', 'opacity', 'rotate', 'tileGap', 'tileMode'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const onChange = () => {
      refreshSliderLabels();
      requestRepaint();
    };
    el.addEventListener('input', onChange);
    if (el.type === 'checkbox') el.addEventListener('change', onChange);
  });

  const uploadLogoBtn = $('uploadLogoBtn');
  if (uploadLogoBtn && watermarkImgInput) {
    uploadLogoBtn.addEventListener('click', () => {
      if (watermarkImage) {
        deleteWatermarkImage();
      } else {
        watermarkImgInput.click();
      }
    });
  }

  if (watermarkImgInput) {
    watermarkImgInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      watermarkImgInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast(t('请选择图片文件', 'Please choose an image file'));
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        watermarkImage = await decodeImage(url);
        updateLogoButtonState();
        requestRepaint();
      } catch (err) {
        console.error('LOGO 加载失败:', err);
        showToast(t('LOGO 加载失败，请换一张图片', 'Failed to load LOGO, please try another image'), 3000);
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  }

  const downloadBtn = $('downloadBtn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentImage);

  const copyBtn = $('copyBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyImageToClipboard);

  updateLogoButtonState();
}

function deleteWatermarkImage() {
  watermarkImage = null;
  if (watermarkImgInput) watermarkImgInput.value = '';
  updateLogoButtonState();
  requestRepaint();
  showToast(t('LOGO已删除', 'LOGO deleted'));
}

function updateLogoButtonState() {
  const uploadLogoBtn = $('uploadLogoBtn');
  const btnText = uploadLogoBtn ? uploadLogoBtn.querySelector('.btn-text') : null;
  if (!uploadLogoBtn || !btnText) return;

  if (watermarkImage) {
    btnText.textContent = t('删除LOGO', 'Delete LOGO');
    uploadLogoBtn.classList.add('btn-delete-logo');
    uploadLogoBtn.classList.remove('btn-upload-logo');
  } else {
    btnText.textContent = t('上传LOGO', 'Upload LOGO');
    uploadLogoBtn.classList.add('btn-upload-logo');
    uploadLogoBtn.classList.remove('btn-delete-logo');
  }
}

// ========== 上传 / 拖拽 / 粘贴 ==========
function initUploadEvents() {
  // 点击预览区空白处也可以上传（canvas 和 label 自己处理）
  dropZone.addEventListener('click', (e) => {
    if (e.target === canvas) return;
    const uploadPrompt = $('uploadPrompt');
    if (uploadPrompt && uploadPrompt.contains(e.target)) return;
    if (e.target === imgInput) return;
    imgInput.click();
  });

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
    handleIncomingFiles(e.dataTransfer.files);
  });

  imgInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    imgInput.value = ''; // 允许重复选择同一个文件
    handleIncomingFiles(files);
  });
}

function initPasteEvents() {
  document.addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // files 和 items 往往包含同一张图，只取其中一种来源，避免重复
    let files = Array.from(clipboardData.files || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      files = Array.from(clipboardData.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
    }

    if (!files.length) {
      // 不拦截在输入框中粘贴文字
      if (!isEditableTarget(e.target)) {
        showToast(t('剪贴板中没有图片，请先复制一张图片', 'No image in clipboard, please copy an image first'));
      }
      return;
    }

    e.preventDefault();
    handleIncomingFiles(files);
  });
}

function isEditableTarget(target) {
  return !!(target && target.closest && target.closest('input, textarea, [contenteditable="true"]'));
}

function initGlobalDragPrevention() {
  // 防止把文件拖到预览区以外时浏览器直接打开图片
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

async function handleIncomingFiles(fileList) {
  const images = Array.from(fileList || []).filter((f) => f.type && f.type.startsWith('image/'));
  if (!images.length) {
    showToast(t('请选择图片文件', 'Please choose image files'));
    return;
  }

  const valid = images.filter((f) => f.size <= MAX_FILE_SIZE);
  const skipped = images.length - valid.length;
  if (skipped > 0) {
    showToast(
      t(`有 ${skipped} 张图片超过 20MB，已跳过`, `${skipped} image(s) larger than 20MB were skipped`),
      4000
    );
  }
  if (!valid.length) return;

  // 先立即加载并展示第一张图片，其余图片随后按顺序加入历史记录
  await loadImageFile(valid[0]);
  for (const file of valid.slice(1).reverse()) {
    await addFileToHistoryOnly(file);
  }

  if (valid.length > 1) {
    showToast(t(`已添加 ${valid.length} 张图片 ✅`, `Added ${valid.length} images ✅`));
  }
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    setBaseImage(img, { name: file.name });
    const id = await addToHistory(file, url, watermarkPos);
    currentHistoryId = id;
    updateHistoryDisplay();
  } catch (err) {
    console.error('图片加载失败:', err);
    showToast(t('图片加载失败，可能是文件损坏或格式不支持', 'Failed to load image, the file may be corrupted or unsupported'), 3000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addFileToHistoryOnly(file) {
  const url = URL.createObjectURL(file);
  try {
    await addToHistory(file, url, null, false);
  } catch (err) {
    console.error('添加历史记录失败:', err);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ========== 画布 ==========
function setBaseImage(img, { name = '', pos = null } = {}) {
  baseImage = img;
  currentFileName = name;

  // 画布保持原始分辨率，显示尺寸交给 CSS
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  fitCanvasDisplay();

  const posValid = pos && pos.x >= 0 && pos.y >= 0 && pos.x <= img.width && pos.y <= img.height;
  watermarkPos = posValid ? { x: pos.x, y: pos.y } : { x: img.width * 0.75, y: img.height * 0.85 };
  tileOffset = { x: 0, y: 0 };

  switchToEditMode();
  drawWatermark();
}

function fitCanvasDisplay() {
  if (!baseImage) return;
  const maxWidth = Math.min(1200, window.innerWidth * 0.9);
  const maxHeight = Math.min(800, window.innerHeight * 0.7 * 0.9);
  const scale = Math.min(maxWidth / baseImage.width, maxHeight / baseImage.height, 1); // 不放大，只缩小
  canvas.style.width = baseImage.width * scale + 'px';
  canvas.style.height = baseImage.height * scale + 'px';
}

let resizeRequested = false;
function onWindowResize() {
  if (resizeRequested) return;
  resizeRequested = true;
  requestAnimationFrame(() => {
    resizeRequested = false;
    fitCanvasDisplay(); // 只调整显示尺寸，不重置水印位置
  });
}

function switchToEditMode() {
  const uploadPrompt = $('uploadPrompt');
  if (uploadPrompt) uploadPrompt.style.display = 'none';
  if (canvas) canvas.style.display = 'block';
}

function switchToUploadMode() {
  const uploadPrompt = $('uploadPrompt');
  if (uploadPrompt) uploadPrompt.style.display = '';
  baseImage = null;
  currentFileName = '';
  currentHistoryId = null;
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.display = 'none';
  }
}

// ========== 水印几何计算 ==========
function getMetrics(s, w, h) {
  const k = Math.min(w, h) / REFERENCE_SIZE;
  const metrics = {
    fontPx: Math.max(1, s.fontSize * k),
    gap: Math.max(10, s.tileGap * k),
    logoW: 0,
    logoH: 0,
  };
  if (watermarkImage) {
    metrics.logoW = w * (s.fontSize / 72) * 0.3;
    metrics.logoH = (metrics.logoW * watermarkImage.height) / watermarkImage.width;
  }
  return metrics;
}

// 平铺偏移按间距取模，并从画布外一格开始，保证边缘（含旋转后）都被覆盖
function forEachTile(w, h, gap, cb) {
  const startX = (((tileOffset.x % gap) + gap) % gap) - gap;
  const startY = (((tileOffset.y % gap) + gap) % gap) - gap;
  for (let y = startY; y < h + gap; y += gap) {
    for (let x = startX; x < w + gap; x += gap) {
      if (cb(x, y) === false) return;
    }
  }
}

function isInWatermark(x, y) {
  const s = getSettings();
  if (!s.text && !watermarkImage) return false;

  const m = getMetrics(s, canvas.width, canvas.height);
  let boxW = 0;
  let boxH = 0;
  if (s.text) {
    ctx.save();
    ctx.font = `${m.fontPx}px sans-serif`;
    boxW = ctx.measureText(s.text).width;
    ctx.restore();
    boxH = m.fontPx * 1.2;
  }
  if (watermarkImage) {
    boxW = Math.max(boxW, m.logoW);
    boxH = Math.max(boxH, m.logoH);
  }
  // 保证最小可点击区域
  const minSize = Math.min(canvas.width, canvas.height) * 0.05;
  const halfW = Math.max(boxW, minSize) / 2;
  const halfH = Math.max(boxH, minSize) / 2;

  // 把点击点转换到水印自身（已旋转）的坐标系
  const rad = (-s.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - watermarkPos.x;
  const dy = y - watermarkPos.y;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return Math.abs(rx) <= halfW && Math.abs(ry) <= halfH;
}

// ========== 绘制 ==========
function drawWatermark() {
  if (!baseImage || !ctx) return;
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    renderWatermarkLayer(ctx, canvas.width, canvas.height);
  } catch (error) {
    console.error('drawWatermark 绘制失败:', error);
    showToast(t('图片绘制失败，请重试', 'Failed to render image, please try again'), 3000);
  }
}

function renderWatermarkLayer(c, w, h) {
  const s = getSettings();

  if (s.text || watermarkImage) {
    const m = getMetrics(s, w, h);
    const rad = (s.rotate * Math.PI) / 180;

    c.save();
    c.globalAlpha = s.opacity;

    const drawMark = (x, y) => {
      c.save();
      c.translate(x, y);
      if (rad) c.rotate(rad);
      if (s.text) {
        c.font = `${m.fontPx}px sans-serif`;
        c.fillStyle = s.fontColor;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(s.text, 0, 0);
      }
      if (watermarkImage) {
        c.drawImage(watermarkImage, -m.logoW / 2, -m.logoH / 2, m.logoW, m.logoH);
      }
      c.restore();
    };

    if (s.mode === 'tile') {
      forEachTile(w, h, m.gap, drawMark);
    } else {
      drawMark(watermarkPos.x, watermarkPos.y);
    }

    c.restore();
  }

  drawWebsiteWatermark(c, w, h);
}

function drawWebsiteWatermark(c, w, h) {
  const fontSize = Math.max(12, Math.min(w, h) * 0.02);
  const padding = Math.max(10, Math.min(w, h) * 0.01);

  c.save();
  c.globalAlpha = 0.6;
  c.font = `${fontSize}px Arial, sans-serif`;
  c.fillStyle = '#ffffff';
  c.textAlign = 'right';
  c.textBaseline = 'bottom';
  c.fillText(WEBSITE_TEXT, w - padding, h - padding);
  c.restore();
}

// 重绘节流，保证 60fps
let renderRequested = false;
function requestRepaint() {
  if (renderRequested || !baseImage) return;
  renderRequested = true;
  requestAnimationFrame(() => {
    renderRequested = false;
    drawWatermark();
  });
}

// ========== 拖拽水印 ==========
let dragging = false;
let dragOffset = { x: 0, y: 0 };

function initDragEvents() {
  canvas.addEventListener('mousedown', startDrag);
  canvas.addEventListener('mousemove', updateCursor);
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag);

  // passive: false 允许 preventDefault 阻止页面滚动
  canvas.addEventListener('touchstart', startDrag, { passive: false });
  canvas.addEventListener('touchmove', onDrag, { passive: false });
  canvas.addEventListener('touchend', endDrag);
  canvas.addEventListener('touchcancel', endDrag);
}

function getPointer(e) {
  const point = e.touches && e.touches.length ? e.touches[0] : e;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (point.clientX - rect.left) * (canvas.width / rect.width),
    y: (point.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function hasWatermark() {
  return !!(getSettings().text || watermarkImage);
}

function updateCursor(e) {
  if (dragging || !baseImage) return;
  const s = getSettings();
  let movable;
  if (s.mode === 'tile') {
    movable = hasWatermark();
  } else {
    const { x, y } = getPointer(e);
    movable = isInWatermark(x, y);
  }
  canvas.style.cursor = movable ? 'move' : '';
}

function startDrag(e) {
  if (!baseImage) return;
  const { x, y } = getPointer(e);
  const s = getSettings();

  // 平铺模式下整张图都可以拖动；单个模式需要按在水印上
  const canDrag = s.mode === 'tile' ? hasWatermark() : isInWatermark(x, y);
  if (!canDrag) return;

  if (e.cancelable) e.preventDefault();
  e.stopPropagation();
  dragging = true;

  if (s.mode === 'tile') {
    dragOffset = { x: x - tileOffset.x, y: y - tileOffset.y };
  } else {
    dragOffset = { x: x - watermarkPos.x, y: y - watermarkPos.y };
  }
}

function onDrag(e) {
  if (!dragging) return;
  if (e.cancelable) e.preventDefault();

  const { x, y } = getPointer(e);
  if (getSettings().mode === 'tile') {
    tileOffset = { x: x - dragOffset.x, y: y - dragOffset.y };
  } else {
    watermarkPos = {
      x: Math.max(0, Math.min(canvas.width, x - dragOffset.x)),
      y: Math.max(0, Math.min(canvas.height, y - dragOffset.y)),
    };
  }
  requestRepaint();
}

function endDrag(e) {
  if (!dragging) return;
  if (e.cancelable) e.preventDefault();
  dragging = false;

  // 保存当前图片的水印位置
  const item = historyList.find((i) => i.id === currentHistoryId);
  if (item) {
    item.watermarkPos = { ...watermarkPos };
    saveHistoryToStorage();
  }
}

// ========== 下载 / 复制 ==========
// 画布本身就是原始分辨率，与预览完全一致，直接导出即可
function exportCanvasBlob() {
  drawWatermark();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function getExportFileName() {
  const base = (currentFileName || 'image').replace(/\.[^.]+$/, '');
  return `${base}_watermarked.png`;
}

async function downloadCurrentImage() {
  if (!baseImage) {
    showToast(t('请先上传图片', 'Please upload an image first'), 2000);
    return;
  }
  try {
    const blob = await exportCanvasBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = getExportFileName();
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t('图片已下载 ✅', 'Image downloaded ✅'));
  } catch (error) {
    console.error('下载失败:', error);
    showToast(t('下载失败，请重试', 'Download failed, please try again'), 2000);
  }
}

async function copyImageToClipboard() {
  if (!baseImage) {
    showToast(t('请先上传图片', 'Please upload an image first'), 2000);
    return;
  }
  try {
    try {
      // 优先直接传入 Promise，兼容 Safari 对用户手势的要求
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportCanvasBlob() })]);
    } catch {
      // 兼容不支持 Promise 参数的浏览器内核
      const blob = await exportCanvasBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
    showToast(t('图片已复制到剪切板 ✅', 'Image copied to clipboard ✅'));
  } catch (error) {
    console.error('复制失败:', error);
    showToast(t('复制失败，请重试', 'Copy failed, please try again'), 2000);
  }
}

// ========== 历史记录 ==========
function nextHistoryId() {
  // 保证同一毫秒内添加多张图片时 id 也不会重复
  const now = Date.now();
  lastHistoryId = now > lastHistoryId ? now : lastHistoryId + 1;
  return lastHistoryId;
}

function saveHistoryToStorage() {
  try {
    localStorage.setItem('watermark_history', JSON.stringify(historyList));
  } catch (error) {
    console.error('保存历史记录失败:', error);
  }
}

// 从 localStorage 加载历史记录，并把旧版本存在 localStorage 中的大图迁移到 IndexedDB
function loadHistoryFromStorage() {
  try {
    const saved = localStorage.getItem('watermark_history');
    if (!saved) {
      updateHistoryDisplay();
      return;
    }
    historyList = JSON.parse(saved);
    historyList.forEach((item) => {
      if (typeof item.id === 'number' && item.id > lastHistoryId) lastHistoryId = item.id;
    });

    historyList.forEach(async (item) => {
      if (!item.imageDataUrl) return;
      try {
        const res = await fetch(item.imageDataUrl);
        await saveImageToDB(item.id, await res.blob());
      } catch (err) {
        console.error('迁移历史图片失败:', item.id, err);
      }
      delete item.imageDataUrl;
      saveHistoryToStorage();
    });

    updateHistoryDisplay();
  } catch (error) {
    console.error('加载历史记录失败:', error);
  }
}

async function addToHistory(file, imageUrl, pos, prepend = true) {
  const thumbnail = await createThumbnail(imageUrl);
  const id = nextHistoryId();
  await saveImageToDB(id, file);

  // 移除重复项（同名同大小），同时清理 IndexedDB
  const duplicates = historyList.filter((item) => item.name === file.name && item.size === file.size);
  for (const item of duplicates) {
    await deleteImageFromDB(item.id);
  }
  historyList = historyList.filter((item) => !duplicates.includes(item));

  const newItem = {
    id,
    name: file.name || t('未命名图片', 'Untitled image'),
    size: file.size || 0,
    timestamp: new Date().toISOString(),
    thumbnail,
    watermarkPos: pos ? { ...pos } : null,
  };

  if (prepend || historyList.length === 0) {
    historyList.unshift(newItem);
  } else {
    historyList.splice(1, 0, newItem);
  }

  if (historyList.length > MAX_HISTORY_ITEMS) {
    const removed = historyList.slice(MAX_HISTORY_ITEMS);
    for (const item of removed) {
      await deleteImageFromDB(item.id);
    }
    historyList = historyList.slice(0, MAX_HISTORY_ITEMS);
  }

  saveHistoryToStorage();
  updateHistoryDisplay();
  return id;
}

// 居中裁剪成正方形缩略图，避免变形
function createThumbnail(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const thumb = document.createElement('canvas');
      thumb.width = THUMBNAIL_SIZE;
      thumb.height = THUMBNAIL_SIZE;
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const thumbCtx = thumb.getContext('2d');
      thumbCtx.imageSmoothingQuality = 'high';
      thumbCtx.drawImage(img, sx, sy, side, side, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
      resolve(thumb.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

function updateHistoryDisplay() {
  const historyThumbnails = $('historyThumbnails');
  const historyPanel = $('historyPanel');
  if (!historyThumbnails || !historyPanel) return;

  historyThumbnails.innerHTML = '';

  if (historyList.length === 0) {
    historyPanel.style.display = 'none';
    return;
  }
  historyPanel.style.display = 'flex';

  historyList.forEach((item) => {
    const container = document.createElement('div');
    container.className = 'history-thumbnail-container';
    container.style.position = 'relative';
    container.style.display = 'inline-block';

    const thumbnail = document.createElement('img');
    thumbnail.className = `history-thumbnail ${item.id === currentHistoryId ? 'active' : ''}`;
    if (item.thumbnail) thumbnail.src = item.thumbnail;
    thumbnail.alt = item.name;
    thumbnail.title = `${item.name} - ${formatTime(item.timestamp)}`;
    thumbnail.addEventListener('click', () => loadFromHistory(item.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'history-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = t('删除此历史记录', 'Delete this history item');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromHistory(item.id);
    });

    container.appendChild(thumbnail);
    container.appendChild(deleteBtn);
    historyThumbnails.appendChild(container);
  });

  requestAnimationFrame(() => {
    const active = historyThumbnails.querySelector('.history-thumbnail.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
}

async function loadFromHistory(id) {
  const item = historyList.find((i) => i.id === id);
  if (!item) return;

  const fileBlob = await loadImageFromDB(id);
  if (!fileBlob) {
    showToast(t('原图已丢失或未能加载，请重新上传', 'Original image lost or failed to load, please upload again'), 3000);
    return;
  }

  const url = URL.createObjectURL(fileBlob);
  try {
    const img = await decodeImage(url);
    setBaseImage(img, { name: item.name, pos: item.watermarkPos });
    currentHistoryId = id;
    updateHistoryDisplay();
  } catch (err) {
    console.error('加载历史图片失败:', err);
    showToast(t('加载历史图片失败', 'Failed to load historical image'), 3000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function removeFromHistory(id) {
  const index = historyList.findIndex((item) => item.id === id);
  if (index === -1) return;

  historyList.splice(index, 1);
  await deleteImageFromDB(id);
  saveHistoryToStorage();

  if (id === currentHistoryId) {
    // 删除的是当前图片：切换到相邻的一张，没有则回到上传状态（保留 LOGO 设置）
    if (historyList.length) {
      await loadFromHistory(historyList[Math.min(index, historyList.length - 1)].id);
    } else {
      switchToUploadMode();
    }
  }

  updateHistoryDisplay();
  showToast(t('已删除历史记录', 'History record deleted'));
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const diff = Date.now() - date.getTime();

  if (diff < 60000) return t('刚刚', 'just now');
  if (diff < 3600000) {
    const n = Math.floor(diff / 60000);
    return t(`${n}分钟前`, `${n} min ago`);
  }
  if (diff < 86400000) {
    const n = Math.floor(diff / 3600000);
    return t(`${n}小时前`, `${n} h ago`);
  }
  return date.toLocaleDateString();
}