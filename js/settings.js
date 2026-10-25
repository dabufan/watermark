/* ======================================================
   设置管理模块
   - 保存用户设置到 localStorage
   - 页面加载时自动恢复上次参数
   ====================================================== */

// 所有需要持久化的控制项 ID
const settingKeys = [
  'watermarkText',
  'fontSize',
  'fontColor',
  'opacity',
  'rotate',
  'tileMode',
  'tileGap'
];

/**
 * 保存当前设置到 localStorage
 */
function saveSettings() {
  try {
    const settings = {};
    settingKeys.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      settings[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    localStorage.setItem('wm_settings', JSON.stringify(settings));
  } catch (err) {
    console.warn('保存设置失败：', err);
  }
}

/**
 * 从 localStorage 加载设置并应用到控件
 */
function loadSettings() {
  try {
    const data = localStorage.getItem('wm_settings');
    if (!data) return;
    const settings = JSON.parse(data);
    if (!settings || typeof settings !== 'object') return;
    settingKeys.forEach(key => {
      if (!(key in settings)) return;
      const el = document.getElementById(key);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!settings[key];
      else el.value = settings[key];
    });
  } catch (err) {
    console.warn('加载设置失败：', err);
  }
}

/**
 * 初始化：控件变化时自动保存
 */
function initSettingsAutoSave() {
  settingKeys.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveSettings);
  });
}

window.saveSettings = saveSettings;
window.loadSettings = loadSettings;
window.initSettingsAutoSave = initSettingsAutoSave;