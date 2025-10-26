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
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
  }
  updateThemeIcon();
})();

themeToggleBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
});

function updateThemeIcon() {
  const isDark = document.body.classList.contains('dark');
  themeToggleBtn.textContent = isDark ? '☀️' : '🌓';
}

// ======= Toast 提示 =======
const toastEl = document.getElementById('toast');
let toastTimer = null;

/**
 * 显示 Toast 提示
 * @param {string} msg 消息内容
 * @param {number} duration 显示时间 (ms)
 */
export function showToast(msg = '操作成功 ✅', duration = 2000) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ======= 进度显示 =======
/**
 * 更新进度条
 * @param {number} percent 百分比 (0~100)
 * @param {string} text 详情文字
 */
export function updateProgress(percent, text = '') {
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressDetails = document.getElementById('progressDetails');
  
  if (progressContainer) progressContainer.style.display = 'block';
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressDetails) progressDetails.textContent = text;
}

/**
 * 重置进度显示
 */
export function resetProgress() {
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

/**
 * 播放提示音
 */
export function playDing() {
  if (!dingAudio) return;
  // Safari/iOS 要求用户交互后才能播放
  const playPromise = dingAudio.play();
  if (playPromise) {
    playPromise.catch(() => {
      console.log('提示音播放被浏览器限制（需用户交互后启用）');
    });
  }
}

/**
 * 测试音效（可用于未来在设置界面中调用）
 */
export function testSound() {
  showToast('🔊 播放测试提示音');
  playDing();
}