/* ======================================================
   UI 控制模块
   - 主题切换
   - Toast 提示
   - 进度显示
   - 声音反馈 (ding.wav)
   ====================================================== */

// ======= 主题切换 =======
const themeToggleBtn = document.getElementById('themeToggle');

// 初始化主题
(function initTheme() {
  try {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark');
    }
  } catch (e) {
    console.warn('读取主题设置失败');
  }
  updateThemeIcon();
})();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    } catch (e) {
      console.warn('保存主题设置失败');
    }
    updateThemeIcon();
  });
}

function updateThemeIcon() {
  const isDark = document.body.classList.contains('dark');
  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) themeIcon.textContent = isDark ? '☀' : '☽';
}

// ======= Toast 提示 =======
let toastTimer = null;

/**
 * 显示 Toast 提示
 * @param {string} msg 消息内容
 * @param {number} duration 显示时间 (ms)
 */
function showToast(msg = '操作成功 ✅', duration = 2000) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ======= 进度显示 =======
function updateProgress(percent, text = '') {
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressDetails = document.getElementById('progressDetails');

  if (progressContainer) progressContainer.style.display = 'block';
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressDetails) progressDetails.textContent = text;
}

function resetProgress() {
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressDetails = document.getElementById('progressDetails');

  if (progressContainer) progressContainer.style.display = 'none';
  if (progressBar) progressBar.style.width = '0%';
  if (progressDetails) progressDetails.textContent = '';
}

// ======= 声音反馈 (ding.wav) =======
let dingAudio = null;
try {
  dingAudio = new Audio('assets/ding.wav');
  dingAudio.preload = 'auto';
} catch (e) {
  console.warn('音频加载失败，可忽略');
}

function playDing() {
  if (!dingAudio) return;
  const playPromise = dingAudio.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
}

function testSound() {
  showToast('🔊 播放测试提示音');
  playDing();
}

window.showToast = showToast;
window.updateProgress = updateProgress;
window.resetProgress = resetProgress;
window.playDing = playDing;
window.testSound = testSound;