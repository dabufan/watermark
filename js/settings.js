/* ======================================================
   设置管理模块
   - 保存用户设置到 localStorage
   - 页面加载时自动恢复上次参数
   ====================================================== */

// 所有控制项的ID
const settingKeys = [
    'watermarkText',
    'fontSize',
    'fontColor',
    'opacity',
    'rotate',
    'mode',
    'tileGap',
    'quality'
  ];
  
  /**
   * 保存当前设置到 localStorage
   */
  export function saveSettings() {
    const settings = {};
    settingKeys.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') settings[id] = el.checked;
      else settings[id] = el.value;
    });
    localStorage.setItem('wm_settings', JSON.stringify(settings));
  }
  
  /**
   * 从 localStorage 加载设置并应用到控件
   */
  export function loadSettings() {
    try {
      const data = localStorage.getItem('wm_settings');
      if (!data) return;
      const settings = JSON.parse(data);
      Object.entries(settings).forEach(([key, val]) => {
        const el = document.getElementById(key);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = val;
        else el.value = val;
      });
    } catch (err) {
      console.warn('加载设置失败：', err);
    }
  }
  
  /**
   * 初始化：绑定 change 事件自动保存
   */
  export function initSettingsAutoSave() {
    settingKeys.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', saveSettings);
    });
  }