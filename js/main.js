/* ======================================================
   主逻辑模块
   - 上传、粘贴、绘制水印
   - 并行处理与导出
   - 生成 manifest.txt
   - 双语支持
   ====================================================== */

   import { showToast, updateProgress, resetProgress, playDing } from './ui.js';
   import { loadSettings, initSettingsAutoSave } from './settings.js';
   
   // ========== IndexedDB 辅助函数 (用于存储大图，解决 localStorage 限制) ==========
   const DB_NAME = 'WatermarkToolDB';
   const STORE_NAME = 'images';
   const DB_VERSION = 1;

   function getDB() {
     return new Promise((resolve, reject) => {
       const request = indexedDB.open(DB_NAME, DB_VERSION);
       request.onupgradeneeded = (e) => {
         const db = e.target.result;
         if (!db.objectStoreNames.contains(STORE_NAME)) {
           db.createObjectStore(STORE_NAME, { keyPath: 'id' });
         }
       };
       request.onsuccess = (e) => resolve(e.target.result);
       request.onerror = (e) => reject(e.target.error);
     });
   }

   async function saveImageToDB(id, data) {
     try {
       const db = await getDB();
       return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE_NAME, 'readwrite');
         const store = tx.objectStore(STORE_NAME);
         store.put({ id: id, data: data });
         tx.oncomplete = () => resolve();
         tx.onerror = (e) => reject(tx.error);
       });
     } catch (err) {
       console.error('IndexedDB save failed:', err);
     }
   }

   async function loadImageFromDB(id) {
     try {
       const db = await getDB();
       return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE_NAME, 'readonly');
         const store = tx.objectStore(STORE_NAME);
         const request = store.get(id);
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
       return new Promise((resolve, reject) => {
         const tx = db.transaction(STORE_NAME, 'readwrite');
         const store = tx.objectStore(STORE_NAME);
         store.delete(id);
         tx.oncomplete = () => resolve();
         tx.onerror = () => reject(tx.error);
       });
     } catch (err) {
       console.error('IndexedDB delete failed:', err);
     }
   }
   
   // ========== 全局变量 ==========
  let dropZone, imgInput, watermarkImgInput, canvas, ctx;
   
   let baseImage = null;
   let watermarkImage = null;
   let imagesList = [];
  let watermarkPos = { x: 50, y: 50 };
  let tileOffset = { x: 0, y: 0 }; // 平铺模式的偏移量
  const CONCURRENCY = 3; // 默认并行数量
  
  // 历史记录相关变量
  let historyList = [];
  let currentHistoryIndex = -1;
  const maxHistoryItems = 20;
  
  // 语言相关变量
  let currentLanguage = 'zh'; // 默认中文
  let languageToggle, languageIcon;
  
  // 检测系统语言
  function detectSystemLanguage() {
    const systemLang = navigator.language || navigator.userLanguage;
    console.log('系统语言:', systemLang);
    
    // 如果系统语言是英文或英文变体，则使用英文
    if (systemLang.startsWith('en')) {
      return 'en';
    }
    // 其他情况默认使用中文
    return 'zh';
  }
  
  // 语言切换功能
  function initLanguageToggle() {
    // 延迟获取DOM元素，确保元素已渲染
    setTimeout(() => {
      languageToggle = document.getElementById('languageToggle');
      languageIcon = document.getElementById('languageIcon');
      
      if (languageToggle) {
        // 首先检查本地存储
        const savedLanguage = localStorage.getItem('language');
        if (savedLanguage) {
          currentLanguage = savedLanguage;
          console.log('使用保存的语言设置:', currentLanguage);
        } else {
          // 如果没有保存的设置，则使用系统语言
          currentLanguage = detectSystemLanguage();
          console.log('使用系统语言:', currentLanguage);
          // 保存系统语言设置
          localStorage.setItem('language', currentLanguage);
        }
        
        // 应用语言设置
        updateLanguage();
        
        languageToggle.addEventListener('click', () => {
          currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
          updateLanguage();
          localStorage.setItem('language', currentLanguage);
        });
      }
    }, 100);
  }
  
  function updateLanguage() {
    // 更新页面标题
    const title = document.querySelector('title');
    if (title) {
      title.textContent = title.getAttribute(`data-${currentLanguage}`);
    }
    
    // 更新所有带有data-zh和data-en属性的元素
    const elements = document.querySelectorAll('[data-zh][data-en]');
    elements.forEach(element => {
      const text = element.getAttribute(`data-${currentLanguage}`);
      if (text) {
        element.textContent = text;
      }
    });
    
    // 更新placeholder属性
    const inputs = document.querySelectorAll('[data-placeholder-zh][data-placeholder-en]');
    inputs.forEach(input => {
      const placeholder = input.getAttribute(`data-placeholder-${currentLanguage}`);
      if (placeholder) {
        input.placeholder = placeholder;
      }
    });
    
    // 更新语言图标
    if (languageIcon) {
      languageIcon.textContent = currentLanguage === 'zh' ? 'EN' : '中';
    }
    
    // 更新HTML lang属性
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-cn' : 'en';
    
    // 更新水印输入框的默认值
    const watermarkInput = document.getElementById('watermarkText');
    if (watermarkInput) {
      watermarkInput.value = currentLanguage === 'zh' ? '水印' : 'Watermark';
    }
  }
  
  // 获取双语Toast消息
  function getToastMessage(zhMessage, enMessage) {
    return currentLanguage === 'zh' ? zhMessage : enMessage;
  }
   
   // 初始化设置
   window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成，开始初始化...');
    
    // 延迟获取DOM元素，确保所有元素都已渲染
    setTimeout(() => {
      // 获取DOM元素
      dropZone = document.getElementById('preview');
      imgInput = document.getElementById('imgInput');
      watermarkImgInput = document.getElementById('watermarkImg');
      canvas = document.getElementById('canvas');
      
      console.log('DOM元素获取结果:', {
        dropZone: !!dropZone,
        imgInput: !!imgInput,
        watermarkImgInput: !!watermarkImgInput,
        canvas: !!canvas
      });
      
      // 检查元素是否存在
      if (!dropZone || !imgInput || !canvas) {
        console.error('关键DOM元素未找到', {
          dropZone: dropZone,
          imgInput: imgInput,
          canvas: canvas
        });
        showToast(getToastMessage('初始化失败，请刷新页面重试', 'Initialization failed, please refresh and try again'), 3000);
        return;
      }
      
      // 添加上传提示的点击事件（现在使用label，会自动触发）
      const uploadPrompt = document.getElementById('uploadPrompt');
      if (uploadPrompt) {
        console.log('上传提示已设置为label，点击会自动触发文件选择');
        
        // 添加点击监听用于调试
        uploadPrompt.addEventListener('click', (e) => {
          console.log('✅ 点击上传提示（label自动触发文件选择）');
          console.log('事件详情:', {
            type: e.type,
            target: e.target.tagName,
            isTrusted: e.isTrusted
          });
        });
      } else {
        console.error('❌ uploadPrompt 未找到');
      }
      
      ctx = canvas.getContext('2d');
      
     loadSettings();
     initSettingsAutoSave();
     
     // 初始化语言切换
     initLanguageToggle();
     
      showToast(getToastMessage('欢迎使用专业水印工具 🎨', 'Welcome to Professional Watermark Tool 🎨'), 2000);
      
      // 初始化历史记录
      initHistoryPanel();
      
      // 初始化事件监听器
      initEventListeners();
      
      // 添加窗口大小变化监听
      window.addEventListener('resize', handleWindowResize);
      
      console.log('初始化完成');
      
      // 添加调试信息
      console.log('=== 初始化状态检查 ===');
      console.log('dropZone:', !!dropZone);
      console.log('imgInput:', !!imgInput);
      console.log('canvas:', !!canvas);
      console.log('uploadPrompt:', !!document.getElementById('uploadPrompt'));
      console.log('=== 状态检查完成 ===');
      
      // 显示初始化成功提示
      showToast(getToastMessage('页面初始化完成，可以开始上传图片', 'Page initialization complete, you can start uploading images'), 3000);
    }, 100);
  });
  
  // 初始化事件监听器
  function initEventListeners() {
    // 测试粘贴功能按钮
    const testPasteBtn = document.getElementById('testPasteBtn');
    if (testPasteBtn) {
      testPasteBtn.addEventListener('click', () => {
        showToast('请先复制一张图片，然后按 Cmd/Ctrl + V 粘贴', 3000);
        console.log('测试粘贴功能 - 请复制图片后使用 Cmd/Ctrl + V');
      });
    }
    
    // 测试上传功能按钮
    const testUploadBtn = document.getElementById('testUploadBtn');
    if (testUploadBtn) {
      testUploadBtn.addEventListener('click', () => {
        console.log('测试上传功能');
        console.log('dropZone:', dropZone);
        console.log('imgInput:', imgInput);
        if (imgInput) {
          try {
            imgInput.click();
            console.log('文件选择对话框已触发');
            showToast('文件选择对话框已打开');
          } catch (error) {
            console.error('点击上传失败:', error);
            showToast('点击上传失败: ' + error.message);
          }
        } else {
          showToast('imgInput 未找到');
        }
      });
    }
    
    // 添加全局测试函数
    window.testAllFunctions = function() {
      console.log('=== 功能测试开始 ===');
      console.log('dropZone:', dropZone);
      console.log('imgInput:', imgInput);
      console.log('canvas:', canvas);
      console.log('imagesList:', imagesList);
      console.log('baseImage:', baseImage);
      console.log('=== 功能测试结束 ===');
    };
    
    // 添加上传功能测试
    window.testUpload = function() {
      console.log('=== 上传功能测试 ===');
      console.log('dropZone 元素:', dropZone);
      console.log('imgInput 元素:', imgInput);
      console.log('uploadPrompt 元素:', document.getElementById('uploadPrompt'));
      
      if (imgInput) {
        try {
          imgInput.click();
          console.log('✅ 文件选择对话框已触发');
          showToast('文件选择对话框已打开');
        } catch (error) {
          console.error('❌ 点击上传失败:', error);
          showToast('点击上传失败: ' + error.message);
        }
      } else {
        console.error('❌ imgInput 未找到');
        showToast('imgInput 未找到');
      }
      console.log('=== 测试结束 ===');
    };
    
    // 添加强制测试函数
    window.forceTestUpload = function() {
      console.log('=== 强制上传测试 ===');
      const testInput = document.createElement('input');
      testInput.type = 'file';
      testInput.accept = 'image/*';
      testInput.multiple = true;
      testInput.style.display = 'none';
      document.body.appendChild(testInput);
      
      try {
        testInput.click();
        console.log('✅ 强制测试文件选择对话框已触发');
        showToast('强制测试成功');
        
        // 清理测试元素
        setTimeout(() => {
          document.body.removeChild(testInput);
        }, 1000);
      } catch (error) {
        console.error('❌ 强制测试失败:', error);
        showToast('强制测试失败: ' + error.message);
        document.body.removeChild(testInput);
      }
      console.log('=== 强制测试结束 ===');
    };
    
    // 图片水印文件选择
    if (watermarkImgInput) {
      watermarkImgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const info = document.getElementById('watermarkImgInfo');
        if (info) {
          if (file) {
            info.textContent = `已选择: ${file.name}`;
            info.style.color = '#10b981';
          } else {
            info.textContent = '未选择任何文件';
            info.style.color = '#64748b';
          }
        }
      });
    }
    
    // 上传区域事件
    initUploadEvents();
    
    // 初始化粘贴功能
    initPasteEvents();
    
    // 初始化水印功能
    initWatermarkEvents();
    
    // 初始化设置监听
    initSettingsListeners();
    
    // 初始化导出功能
    initExportEvents();
    
    // 全局阻止拖拽默认行为
    initGlobalDragPrevention();
    
    // 初始化新按钮事件
    initNewButtonEvents();
  }
  
  // 初始化新按钮事件
  function initNewButtonEvents() {
    console.log('初始化新按钮事件...');
    
    // 上传/删除LOGO按钮
    const uploadLogoBtn = document.getElementById('uploadLogoBtn');
    const watermarkImg = document.getElementById('watermarkImg');
    
    if (uploadLogoBtn && watermarkImg) {
      uploadLogoBtn.onclick = () => {
        if (watermarkImage) {
          // 如果有LOGO，则删除
          console.log('删除LOGO');
          deleteWatermarkImage();
        } else {
          // 如果没有LOGO，则上传
          console.log('点击上传LOGO按钮');
          watermarkImg.click();
        }
      };
      
      // 更新按钮状态
      updateLogoButtonState();
    } else {
      console.log('上传LOGO按钮或文件输入未找到', { uploadLogoBtn, watermarkImg });
    }
    
    // 下载按钮
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        console.log('点击下载按钮');
        downloadCurrentImage();
      };
    } else {
      console.log('下载按钮未找到');
    }
    
    // 复制按钮
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        console.log('点击复制按钮');
        copyImageToClipboard();
      };
    } else {
      console.log('复制按钮未找到');
    }
    
    
    
    // 平铺模式切换
    const tileMode = document.getElementById('tileMode');
    const mode = document.getElementById('mode');
    if (tileMode && mode) {
      tileMode.onchange = () => {
        console.log('平铺模式切换:', tileMode.checked);
        mode.value = tileMode.checked ? 'tile' : 'single';
        drawWatermark();
      };
    } else {
      console.log('平铺模式控件未找到', { tileMode, mode });
    }
    
    // 滑块值显示更新
    updateSliderValues();
    
    console.log('新按钮事件初始化完成');
  }
  
  // 更新滑块值显示
  function updateSliderValues() {
    console.log('初始化滑块值显示...');
    
    const opacity = document.getElementById('opacity');
    const opacityValue = document.getElementById('opacityValue');
    const tileGap = document.getElementById('tileGap');
    const densityValue = document.getElementById('densityValue');
    const fontSize = document.getElementById('fontSize');
    const sizeValue = document.getElementById('sizeValue');
    
    console.log('滑块元素:', { opacity, opacityValue, tileGap, densityValue, fontSize, sizeValue });
    
    if (opacity && opacityValue) {
      opacity.oninput = () => {
        console.log('透明度滑块变化:', opacity.value);
        opacityValue.textContent = Math.round(opacity.value * 100) + '%';
        drawWatermark();
      };
    } else {
      console.log('透明度滑块未找到');
    }
    
    if (tileGap && densityValue) {
      tileGap.oninput = () => {
        console.log('疏密滑块变化:', tileGap.value);
        densityValue.textContent = tileGap.value;
        drawWatermark();
      };
    } else {
      console.log('疏密滑块未找到');
    }
    
    if (fontSize && sizeValue) {
      fontSize.oninput = () => {
        console.log('大小滑块变化:', fontSize.value);
        sizeValue.textContent = fontSize.value + 'px';
        drawWatermark();
      };
    } else {
      console.log('大小滑块未找到');
    }
    
    // 添加其他控件的事件监听
    const watermarkText = document.getElementById('watermarkText');
    const fontColor = document.getElementById('fontColor');
    const rotate = document.getElementById('rotate');
    
    if (watermarkText) {
      watermarkText.oninput = () => {
        console.log('水印文字变化:', watermarkText.value);
        drawWatermark();
      };
    }
    
    if (fontColor) {
      fontColor.onchange = () => {
        console.log('颜色变化:', fontColor.value);
        drawWatermark();
      };
    }
    
    if (rotate) {
      rotate.oninput = () => {
        console.log('旋转角度变化:', rotate.value);
        drawWatermark();
      };
    }
    
    console.log('滑块值显示初始化完成');
  }
   
  // 初始化上传事件
  function initUploadEvents() {
    console.log('初始化上传事件', { dropZone, imgInput });
    
    if (!dropZone || !imgInput) {
      console.error('上传元素未找到', { dropZone, imgInput });
      return;
    }
    
    // 点击上传 - 简化版本（现在主要依赖label）
    dropZone.addEventListener('click', function(e) {
      console.log('点击上传区域');
      
      // 检查是否点击的是canvas（水印拖拽区域）
      if (e.target === canvas || canvas.contains(e.target)) {
        console.log('点击的是canvas区域，不触发上传');
        return;
      }
      
      // 检查是否点击的是上传提示区域（label）
      const uploadPrompt = document.getElementById('uploadPrompt');
      if (uploadPrompt && uploadPrompt.contains(e.target)) {
        console.log('点击的是上传提示区域（label会自动处理）');
        return;
      }
      
      // 如果点击的是其他区域，也尝试触发文件选择
      console.log('点击的是预览区域其他部分，尝试触发文件选择');
      try {
        if (imgInput) {
          imgInput.click();
          console.log('✅ 通过预览区域触发文件选择');
        } else {
          console.error('❌ imgInput 未找到');
          showToast('文件输入框未找到，请刷新页面重试');
        }
      } catch (error) {
        console.error('❌ 点击上传失败:', error);
        showToast('点击上传失败: ' + error.message);
      }
    });
    
    // 拖拽事件 - 使用 addEventListener
    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽悬停');
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragenter', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽进入');
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽离开');
      dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽放下');
      dropZone.classList.remove('dragover');
      
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      console.log('拖拽文件:', files);
      
      if (files.length) {
        imagesList.push(...files);
        loadImage(files[0]);
        
        // 为所有图片添加到历史记录
        files.forEach(async (file) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            await addToHistory(file, e.target.result);
            updateHistoryDisplay();
          };
          reader.readAsDataURL(file);
        });
        
        showToast(getToastMessage(`已添加 ${files.length} 张图片 ✅`, `Added ${files.length} images ✅`));
      } else {
        showToast('请拖拽图片文件');
      }
    });
   
    // 文件选择事件 - 使用 addEventListener
    imgInput.addEventListener('change', function(e) {
      console.log('文件选择变化');
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      console.log('选择的文件:', files);
      
      if (files.length) {
        imagesList.push(...files);
        loadImage(files[0]);
        
        // 为所有图片添加到历史记录
        files.forEach(async (file) => {
          const reader = new FileReader();
          reader.onload = async (e) => {
            await addToHistory(file, e.target.result);
            updateHistoryDisplay();
          };
          reader.readAsDataURL(file);
        });
        
        showToast(getToastMessage(`已选择 ${files.length} 张图片 ✅`, `Selected ${files.length} images ✅`));
      } else {
        showToast('请选择图片文件');
      }
    });
    
    console.log('上传事件初始化完成');
  }
   
  // 初始化粘贴功能
  function initPasteEvents() {
    console.log('正在初始化粘贴功能...');
    document.onpaste = async function(e) {
      console.log('粘贴事件触发', e);
      e.preventDefault();
      
      const clipboardData = e.clipboardData;
      if (!clipboardData) {
        console.log('没有剪贴板数据');
        showToast('无法访问剪贴板数据');
        return;
      }
      
      const items = clipboardData.items;
      if (!items || items.length === 0) {
        console.log('剪贴板中没有项目');
        showToast('剪贴板中没有数据');
        return;
      }
      
      console.log('剪贴板项目数量:', items.length);
     const imgs = [];
      
      // 处理剪贴板项目
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log('项目类型:', item.type);
        
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imgs.push(file);
            console.log('找到图片文件:', file.name, file.size);
          }
        }
      }
      
      // 处理剪贴板文件
      const files = clipboardData.files;
      if (files && files.length > 0) {
        console.log('从 files 属性获取到文件:', files.length);
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            imgs.push(file);
            console.log('从 files 找到图片:', file.name, file.size);
          }
        }
      }
      
      if (imgs.length > 0) {
       console.log('准备加载粘贴的图片:', imgs.length, '张');
       
       // 检查图片大小
       const oversizedImages = imgs.filter(img => img.size > 20 * 1024 * 1024);
       if (oversizedImages.length > 0) {
         showToast(`检测到 ${oversizedImages.length} 张图片过大（>20MB），将跳过这些图片`, 5000);
         imgs = imgs.filter(img => img.size <= 20 * 1024 * 1024);
       }
       
       if (imgs.length > 0) {
         imagesList.push(...imgs);
         
         // 延迟一点时间确保UI更新
         setTimeout(() => {
           try {
             loadImage(imgs[0]);
             // showToast(`已粘贴 ${imgs.length} 张图片 ✅`);
             console.log('成功处理粘贴的图片');
           } catch (error) {
             console.error('加载粘贴图片失败:', error);
             showToast('图片加载失败，请重试', 3000);
           }
         }, 100);
       } else {
         showToast('没有可用的图片（所有图片都过大）', 3000);
       }
      } else {
        console.log('没有找到图片数据');
        showToast('剪贴板中没有图片数据，请确保复制了图片');
      }
    };
    
    console.log('粘贴功能初始化完成');
    
    // 添加测试函数
    window.testPaste = function() {
      console.log('粘贴事件监听器状态:', !!document.onpaste);
      console.log('当前粘贴事件:', document.onpaste);
    };
  }
   
   // 处理窗口大小变化
  function handleWindowResize() {
    if (baseImage) {
      // 重新计算图片尺寸
      const containerHeight = window.innerHeight * 0.7; // 70vh
      const containerWidth = window.innerWidth;
      const maxWidth = Math.min(1200, containerWidth * 0.9);
      const maxHeight = Math.min(800, containerHeight * 0.9);
      
      const scaleX = maxWidth / baseImage.width;
      const scaleY = maxHeight / baseImage.height;
      const scale = Math.min(scaleX, scaleY, 1);
      
      const displayWidth = baseImage.width * scale;
      const displayHeight = baseImage.height * scale;
      
      // 重新设置画布尺寸为原始尺寸
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      
      // 通过CSS设置显示尺寸
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      
      // 重新设置水印位置（相对于原始尺寸）
      watermarkPos = { x: baseImage.width * 0.75, y: baseImage.height * 0.85 };
      
      // 重新绘制
      drawWatermark();
    }
  }
   
   // ========== 加载主图 ==========
  function loadImage(file) {
    console.log('开始加载图片:', file.name, file.size, file.type);
    
    // 检查文件大小限制（20MB）
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      console.error('图片文件过大:', file.size, 'bytes');
      showToast(`图片文件过大（${Math.round(file.size / 1024 / 1024)}MB），请选择小于20MB的图片`, 5000);
      return;
    }
     
     // 检查文件类型
     if (!file.type.startsWith('image/')) {
       console.error('不是图片文件:', file.type);
       showToast('请选择图片文件', 3000);
       return;
     }
     
     // 使用 Object URL 代替 FileReader，节省内存并加快加载
     const blobUrl = URL.createObjectURL(file);
     loadImageFromBlobUrl(blobUrl, file);
  }
  
  // 从 Blob URL 加载图片
  function loadImageFromBlobUrl(blobUrl, originalFile) {
    const img = new Image();
      
    img.onload = () => {
      console.log('图片加载完成:', img.width, 'x', img.height);
      baseImage = img;
       
      // 计算缩放比例，确保图片完全显示在固定容器中
      const containerHeight = window.innerHeight * 0.7; // 70vh
      const containerWidth = window.innerWidth;
      const maxWidth = Math.min(1200, containerWidth * 0.9);
      const maxHeight = Math.min(800, containerHeight * 0.9);
      
      const scaleX = maxWidth / img.width;
      const scaleY = maxHeight / img.height;
      const scale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小
      
      const displayWidth = img.width * scale;
      const displayHeight = img.height * scale;
      
      console.log('缩放比例:', scale, '显示尺寸:', displayWidth, 'x', displayHeight);
      
      // 设置画布为原始图片尺寸（保持高质量）
      canvas.width = img.width;
      canvas.height = img.height;
      
      // 通过CSS设置显示尺寸
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      
      // 设置水印位置（相对于原始尺寸）
      watermarkPos = { x: img.width * 0.75, y: img.height * 0.85 };
      
      // 启用高质量图像渲染
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
       
      // 切换到编辑模式
      switchToEditMode();
      
      // 添加预览区域功能
      if (originalFile) {
        addPreviewFeatures(originalFile);
        
        // 添加到历史记录（异步完成，等待 createThumbnail 使用完 blobUrl 后再 revoke）
        addToHistory(originalFile, blobUrl).then(() => {
          // 设置当前历史记录索引为0（最新添加的）
          currentHistoryIndex = 0;
          updateHistoryDisplay();
          URL.revokeObjectURL(blobUrl);
        }).catch(err => {
          console.error('保存历史记录失败:', err);
          URL.revokeObjectURL(blobUrl);
        });
      } else {
        URL.revokeObjectURL(blobUrl);
      }
      
      drawWatermark();
    };
    
    img.onerror = (error) => {
      console.error('图片加载失败:', error);
      showToast('图片加载失败，可能是文件损坏或格式不支持', 3000);
      URL.revokeObjectURL(blobUrl);
    };
    
    img.src = blobUrl;
  }
   
   // 图片压缩功能
   function compressImage(file, quality = 0.9) {
     return new Promise((resolve) => {
       console.log('压缩函数开始执行...');
       
       // 设置超时机制
       const timeout = setTimeout(() => {
         console.error('压缩超时');
         resolve(null);
       }, 10000); // 10秒超时
       
       const canvas = document.createElement('canvas');
       const ctx = canvas.getContext('2d');
       const img = new Image();
       
       img.onload = () => {
         console.log('压缩图片加载完成:', img.width, 'x', img.height);
         // 计算压缩后的尺寸 - 更激进的压缩
         const maxWidth = 1200;
         const maxHeight = 1200;
         let { width, height } = img;
         
         if (width > maxWidth || height > maxHeight) {
           const ratio = Math.min(maxWidth / width, maxHeight / height);
           width *= ratio;
           height *= ratio;
           console.log('图片尺寸过大，缩放到:', width, 'x', height);
         } else {
           console.log('图片尺寸合适，无需缩放');
         }
         
         canvas.width = width;
         canvas.height = height;
         console.log('设置canvas尺寸:', canvas.width, 'x', canvas.height);
         
         // 绘制压缩后的图片
         ctx.drawImage(img, 0, 0, width, height);
         console.log('图片绘制完成');
         
         // 转换为dataURL - 使用更高的质量
         const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
         console.log('转换为dataURL完成');
         
         console.log('压缩完成:', {
           原始大小: Math.round(file.size / 1024) + 'KB',
           压缩后大小: Math.round(compressedDataUrl.length / 1024) + 'KB',
           压缩比例: Math.round((1 - compressedDataUrl.length / file.size) * 100) + '%',
           原始尺寸: img.width + 'x' + img.height,
           压缩后尺寸: width + 'x' + height
         });
         
         clearTimeout(timeout);
         resolve(compressedDataUrl);
       };
       
       img.onerror = (error) => {
         console.error('压缩失败:', error);
         resolve(null);
       };
       
       // 使用FileReader而不是URL.createObjectURL
       const reader = new FileReader();
       reader.onload = (e) => {
         img.src = e.target.result;
       };
       reader.onerror = () => {
         console.error('FileReader读取失败');
         resolve(null);
       };
       reader.readAsDataURL(file);
     });
   }
   
  // 删除水印图片
  function deleteWatermarkImage() {
    watermarkImage = null;
    
    // 清空文件输入
    if (watermarkImgInput) {
      watermarkImgInput.value = '';
    }
    
    // 更新按钮状态
    updateLogoButtonState();
    
    // 重新绘制（只显示文字水印）
    drawWatermark();
    
    // 更新文件信息显示
    const info = document.getElementById('watermarkImgInfo');
    if (info) {
      info.textContent = '未选择任何文件';
      info.style.color = '#64748b';
    }
    
    showToast(getToastMessage('LOGO已删除', 'LOGO deleted'));
  }
  
  // 更新LOGO按钮状态
  function updateLogoButtonState() {
    const uploadLogoBtn = document.getElementById('uploadLogoBtn');
    const btnText = uploadLogoBtn ? uploadLogoBtn.querySelector('.btn-text') : null;
    
    if (uploadLogoBtn && btnText) {
      if (watermarkImage) {
        // 有LOGO时显示删除按钮
        btnText.textContent = '删除LOGO';
        uploadLogoBtn.classList.add('btn-delete-logo');
        uploadLogoBtn.classList.remove('btn-upload-logo');
      } else {
        // 无LOGO时显示上传按钮
        btnText.textContent = '上传LOGO';
        uploadLogoBtn.classList.add('btn-upload-logo');
        uploadLogoBtn.classList.remove('btn-delete-logo');
      }
    }
  }

  // 初始化水印功能
  function initWatermarkEvents() {
    // 水印图片加载
    if (watermarkImgInput) {
   watermarkImgInput.addEventListener('change', e => {
     const file = e.target.files[0];
     if (file) {
       const reader = new FileReader();
       reader.onload = ev => {
         watermarkImage = new Image();
         watermarkImage.onload = () => {
           drawWatermark();
           updateLogoButtonState(); // 更新按钮状态
         };
         watermarkImage.src = ev.target.result;
       };
       reader.readAsDataURL(file);
     }
   });
    }
    
    // 拖拽定位水印
    initDragEvents();
  }
   
  // 重绘节流控制，保证 60fps 帧率
  let renderRequested = false;
  function requestRepaint() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(() => {
        drawWatermark();
        renderRequested = false;
      });
    }
  }

  // 拖拽定位水印
  let dragging = false;
  let dragOffset = { x: 0, y: 0 };
  
  function initDragEvents() {
    if (!canvas) return;
   
    // 鼠标事件
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', onDrag);
    canvas.addEventListener('mouseup', endDrag);

    // 触摸事件 (使用 passive: false 允许 preventDefault 阻止页面滚动)
    canvas.addEventListener('touchstart', startDrag, { passive: false });
    canvas.addEventListener('touchmove', onDrag, { passive: false });
    canvas.addEventListener('touchend', endDrag);
  }
  
  // 初始化设置监听
  function initSettingsListeners() {
    const settingKeys = [
      'watermarkText', 'fontSize', 'fontColor', 'opacity', 
      'rotate', 'mode', 'tileGap', 'quality'
    ];
    
    settingKeys.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          if (baseImage) {
            requestRepaint();
          }
        });
      }
    });
  }
   
   function startDrag(e) {
     const isTouch = e.type === 'touchstart';
     const pointerEvent = isTouch ? e.touches[0] : e;
     const pos = getPointer(pointerEvent);
     const { x, y } = pos;
     if (isInWatermark(x, y)) {
       if (e.cancelable) {
         e.preventDefault();
       }
       e.stopPropagation();
       dragging = true;
       
       // 获取当前模式
       const modeEl = document.getElementById('mode');
       const mode = modeEl ? modeEl.value : 'single';
       
       if (mode === 'tile') {
         // 平铺模式：使用平铺偏移量
         dragOffset.x = x - tileOffset.x;
         dragOffset.y = y - tileOffset.y;
       } else {
         // 单个水印模式：使用水印位置
         dragOffset.x = x - watermarkPos.x;
         dragOffset.y = y - watermarkPos.y;
       }
     }
   }
   function onDrag(e) {
     if (!dragging) return;
     if (e.cancelable) {
       e.preventDefault();
     }
     
     const isTouch = e.type === 'touchmove';
     const pointerEvent = isTouch ? e.touches[0] : e;
     const pos = getPointer(pointerEvent);
     
     // 获取当前模式
     const modeEl = document.getElementById('mode');
     const mode = modeEl ? modeEl.value : 'single';
     
     if (mode === 'tile') {
       // 平铺模式：调整平铺偏移量
       tileOffset.x = pos.x - dragOffset.x;
       tileOffset.y = pos.y - dragOffset.y;
       
       // 限制偏移量范围，避免平铺超出画布
       const tileGapEl = document.getElementById('tileGap');
       const tileGap = tileGapEl ? parseInt(tileGapEl.value, 10) : 100;
       tileOffset.x = Math.max(-tileGap, Math.min(tileGap, tileOffset.x));
       tileOffset.y = Math.max(-tileGap, Math.min(tileGap, tileOffset.y));
     } else {
       // 单个水印模式：调整水印位置
       watermarkPos.x = pos.x - dragOffset.x;
       watermarkPos.y = pos.y - dragOffset.y;
       
       // 实时更新当前历史记录中的水印位置
       if (currentHistoryIndex >= 0 && historyList[currentHistoryIndex]) {
         historyList[currentHistoryIndex].watermarkPos = { ...watermarkPos };
         historyList[currentHistoryIndex].displayWidth = canvas.width;
         historyList[currentHistoryIndex].displayHeight = canvas.height;
       }
     }
     
     requestRepaint();
   }
   function endDrag(e) { 
     if (dragging) {
       if (e.cancelable) {
         e.preventDefault();
       }
       e.stopPropagation();
     }
     dragging = false; 
   }
   
   function getPointer(e) {
     const rect = canvas.getBoundingClientRect();
     return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
     };
   }
  function isInWatermark(x, y) {
    // 获取当前水印设置
    const watermarkTextEl = document.getElementById('watermarkText');
    const fontSizeEl = document.getElementById('fontSize');
    const modeEl = document.getElementById('mode');
    const tileGapEl = document.getElementById('tileGap');
    
    if (!watermarkTextEl || !fontSizeEl) {
      // 如果无法获取设置，使用默认检测区域
      const size = 200;
      return x > watermarkPos.x - size/2 && x < watermarkPos.x + size/2 &&
             y > watermarkPos.y - size/2 && y < watermarkPos.y + size/2;
    }
    
    const text = watermarkTextEl.value.trim();
    const fontSize = parseInt(fontSizeEl.value, 10);
    const mode = modeEl ? modeEl.value : 'single';
    const tileGap = tileGapEl ? parseInt(tileGapEl.value, 10) : 100;
    
    if (watermarkImage) {
      // 图片水印检测
      const logoSizePercent = (fontSize / 72) * 30;
      const logoWidth = canvas.width * (logoSizePercent / 100);
      const logoHeight = watermarkImage.height / watermarkImage.width * logoWidth;
      
      if (mode === 'tile') {
        // 平铺模式：检测是否在任何LOGO的范围内（使用偏移量）
        for (let tileY = tileOffset.y; tileY < canvas.height; tileY += tileGap) {
          for (let tileX = tileOffset.x; tileX < canvas.width; tileX += tileGap) {
            const logoLeft = tileX - logoWidth/2;
            const logoTop = tileY - logoHeight/2;
            const logoRight = tileX + logoWidth/2;
            const logoBottom = tileY + logoHeight/2;
            
            if (x >= logoLeft && x <= logoRight && y >= logoTop && y <= logoBottom) {
              return true;
            }
          }
        }
      } else {
        // 单个LOGO模式
        const logoLeft = watermarkPos.x - logoWidth/2;
        const logoTop = watermarkPos.y - logoHeight/2;
        const logoRight = watermarkPos.x + logoWidth/2;
        const logoBottom = watermarkPos.y + logoHeight/2;
        
        if (x >= logoLeft && x <= logoRight && y >= logoTop && y <= logoBottom) {
          return true;
        }
      }
    }

    if (text) {
      // 文字水印检测
      const detectionSize = Math.max(fontSize * 2, 100); // 至少100px
      
      if (mode === 'tile') {
        // 平铺模式：检测是否在任何水印的范围内（使用偏移量）
        for (let tileY = tileOffset.y; tileY < canvas.height; tileY += tileGap) {
          for (let tileX = tileOffset.x; tileX < canvas.width; tileX += tileGap) {
            if (x > tileX - detectionSize/2 && x < tileX + detectionSize/2 &&
                y > tileY - detectionSize/2 && y < tileY + detectionSize/2) {
              return true;
            }
          }
        }
        return false;
      } else {
        // 单个水印模式
        return x > watermarkPos.x - detectionSize/2 && x < watermarkPos.x + detectionSize/2 &&
               y > watermarkPos.y - detectionSize/2 && y < watermarkPos.y + detectionSize/2;
      }
    }
    
    if (watermarkImage) {
      return false;
    }
    
    // 默认检测区域
    const size = 200;
    return x > watermarkPos.x - size/2 && x < watermarkPos.x + size/2 &&
           y > watermarkPos.y - size/2 && y < watermarkPos.y + size/2;
  }
   
   // ========== 绘制水印 ==========
   function drawWatermark() {
     if (!baseImage) {
       console.log('drawWatermark: baseImage 不存在');
       return;
     }
     
     if (!ctx) {
       console.error('drawWatermark: ctx 不存在');
       return;
     }
     
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 使用原始尺寸绘制图片，保持高质量
      ctx.drawImage(baseImage, 0, 0);
     
       // 安全地获取DOM元素值
       const watermarkTextEl = document.getElementById('watermarkText');
       const fontSizeEl = document.getElementById('fontSize');
       const fontColorEl = document.getElementById('fontColor');
       const opacityEl = document.getElementById('opacity');
       const rotateEl = document.getElementById('rotate');
       const modeEl = document.getElementById('mode');
       const tileGapEl = document.getElementById('tileGap');
       
       if (!watermarkTextEl || !fontSizeEl || !fontColorEl || !opacityEl || !rotateEl || !modeEl || !tileGapEl) {
         console.error('drawWatermark: 某些DOM元素未找到', {
           watermarkTextEl: !!watermarkTextEl,
           fontSizeEl: !!fontSizeEl,
           fontColorEl: !!fontColorEl,
           opacityEl: !!opacityEl,
           rotateEl: !!rotateEl,
           modeEl: !!modeEl,
           tileGapEl: !!tileGapEl
         });
         return;
       }
       
       const text = watermarkTextEl.value.trim();
       const fontSize = parseInt(fontSizeEl.value, 10);
       const fontColor = fontColorEl.value;
       const opacity = parseFloat(opacityEl.value);
       const rotate = parseFloat(rotateEl.value) || 0;
       const mode = modeEl.value;
       const tileGap = parseInt(tileGapEl.value, 10);
   
       ctx.save();
       ctx.globalAlpha = opacity;
     
       if (mode === 'tile') {
         for (let y = tileOffset.y; y < canvas.height; y += tileGap)
           for (let x = tileOffset.x; x < canvas.width; x += tileGap)
             drawMark(x, y);
       } else {
         drawMark(watermarkPos.x, watermarkPos.y);
       }
     
       ctx.restore();
     
       function drawMark(x, y) {
         ctx.save();
         ctx.translate(x, y);
         if (rotate !== 0) {
           ctx.rotate((rotate * Math.PI) / 180);
         }
         if (text) {
           ctx.font = `${fontSize}px sans-serif`;
           ctx.fillStyle = fontColor;
           ctx.textAlign = 'center';
           ctx.textBaseline = 'middle';
           ctx.fillText(text, 0, 0);
         }
         if (watermarkImage) {
           // 使用fontSize控制logo大小，将px转换为百分比
           const logoSizePercent = (fontSize / 72) * 30; // 将12-72px映射到5-30%
           const w = canvas.width * (logoSizePercent / 100);
           const h = watermarkImage.height / watermarkImage.width * w;
           // 居中对齐绘制，与检测逻辑保持一致
           ctx.drawImage(watermarkImage, -w / 2, -h / 2, w, h);
         }
         ctx.restore();
       }
       
       // 添加网站水印到右下角
       drawWebsiteWatermark(ctx, canvas.width, canvas.height);
     } catch (error) {
       console.error('drawWatermark 绘制失败:', error);
       showToast('图片绘制失败，请重试', 3000);
     }
   }
   
  // 初始化导出功能
  function initExportEvents() {
    const downloadBtn = document.getElementById('downloadAllBtn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        if (!imagesList.length) {
        showToast(getToastMessage('请先上传至少一张图片', 'Please upload at least one image first'));
          return;
        }
        
     const quality = parseFloat(document.getElementById('quality').value);
     const zip = new JSZip();
     const manifest = [];
     const startTime = Date.now();
   
     showToast(getToastMessage('开始批量处理...', 'Starting batch processing...'));
     resetProgress();
   
     let index = 0;
     let active = 0;
     let completed = 0;
     const total = imagesList.length;
   
     function next() {
       while (active < CONCURRENCY && index < total) {
         const file = imagesList[index++];
         active++;
         const currentIndex = index;
         processImage(file, quality).then(({ imgName, dataUrl, timeCost }) => {
           zip.file(imgName, dataUrl.split(',')[1], { base64: true });
           manifest.push(`${imgName} | ${timeCost}ms`);
           active--;
           completed++;
           const percent = Math.round((completed / total) * 100);
           const elapsed = (Date.now() - startTime) / 1000;
           const est = ((elapsed / completed) * (total - completed)).toFixed(1);
           updateProgress(percent, `正在处理第 ${currentIndex} / ${total} 张，剩余约 ${est}s`);
           if (completed === total) finalize();
           else next();
         });
       }
     }
   
     function finalize() {
       manifest.push(`总计：${total} 张`);
       manifest.push(`导出时间：${new Date().toLocaleString()}`);
       manifest.push(`参数：${JSON.stringify(getSettingsSummary())}`);
       zip.file('manifest.txt', manifest.join('\n'));
       zip.generateAsync({ type: 'blob' }).then(blob => {
         const now = new Date();
         const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
         saveAs(blob, `watermarked-${timestamp}.zip`);
         playDing();
         showToast(getToastMessage('✅ 全部处理完成', '✅ All processing completed'));
         resetProgress();
       });
     }
   
     next();
   });
    }
  }
   
   // 处理单张图片
   async function processImage(file, quality) {
     return new Promise(resolve => {
       const start = performance.now();
       const reader = new FileReader();
       reader.onload = e => {
         const img = new Image();
         img.onload = () => {
           canvas.width = img.width;
           canvas.height = img.height;
           baseImage = img;
           drawWatermark();
           const dataUrl = canvas.toDataURL('image/png', quality);
           const imgName = file.name.replace(/\.[^.]+$/, '') + '_watermarked.png';
           const timeCost = Math.round(performance.now() - start);
           resolve({ imgName, dataUrl, timeCost });
         };
         img.src = e.target.result;
       };
       reader.readAsDataURL(file);
     });
   }
   
  // 添加预览区域功能
  function addPreviewFeatures(file) {
    const preview = document.getElementById('preview');
    
    // 清除之前的功能
    const existingToolbar = preview.querySelector('.preview-toolbar');
    const existingInfo = preview.querySelector('.image-info');
    const existingHint = preview.querySelector('.watermark-hint');
    
    if (existingToolbar) existingToolbar.remove();
    if (existingInfo) existingInfo.remove();
    if (existingHint) existingHint.remove();
    
    // 不添加任何工具栏，保持预览区简洁
  }
  
  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // 在指定画布上绘制水印
  function drawWatermarkOnCanvas(ctx, canvasWidth, canvasHeight, scaleX = 1, scaleY = 1) {
    // 获取当前的水印设置
    const watermarkTextEl = document.getElementById('watermarkText');
    const fontSizeEl = document.getElementById('fontSize');
    const fontColorEl = document.getElementById('fontColor');
    const opacityEl = document.getElementById('opacity');
    const rotateEl = document.getElementById('rotate');
    const modeEl = document.getElementById('mode');
    const tileGapEl = document.getElementById('tileGap');
    
    if (!watermarkTextEl || !fontSizeEl || !fontColorEl || !opacityEl || !rotateEl || !modeEl || !tileGapEl) {
      console.error('水印控件未找到');
      return;
    }
    
    const text = watermarkTextEl.value.trim();
    const currentFontSize = parseInt(fontSizeEl.value, 10);
    const currentFontColor = fontColorEl.value;
    const currentOpacity = parseFloat(opacityEl.value);
    const currentRotate = parseFloat(rotateEl.value) || 0;
    const currentMode = modeEl.value;
    const currentTileGap = parseInt(tileGapEl.value, 10);
    
    if (!text && !watermarkImage) return;
    
    // 计算缩放后的水印位置和大小
    const scaledWatermarkPos = {
      x: watermarkPos.x * scaleX,
      y: watermarkPos.y * scaleY
    };
    
    const scaledFontSize = currentFontSize * scaleX;
    const scaledOpacity = currentOpacity;
    const scaledRotate = currentRotate;
    
    ctx.save();
    ctx.globalAlpha = scaledOpacity;

    function drawMark(x, y) {
      ctx.save();
      ctx.translate(x, y);
      if (scaledRotate !== 0) {
        ctx.rotate((scaledRotate * Math.PI) / 180);
      }
      if (text) {
        ctx.font = `${scaledFontSize}px sans-serif`;
        ctx.fillStyle = currentFontColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
      }
      if (watermarkImage) {
        // 与 drawWatermark 保持完全一致的百分比大小和原始宽高比计算
        const logoSizePercent = (currentFontSize / 72) * 30;
        const w = canvasWidth * (logoSizePercent / 100);
        const h = (watermarkImage.height / watermarkImage.width) * w;
        ctx.drawImage(watermarkImage, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }

    if (currentMode === 'tile') {
      const tileGapScaled = currentTileGap * scaleX;
      const scaledTileOffset = {
        x: tileOffset.x * scaleX,
        y: tileOffset.y * scaleY
      };
      for (let y = scaledTileOffset.y; y < canvasHeight; y += tileGapScaled) {
        for (let x = scaledTileOffset.x; x < canvasWidth; x += tileGapScaled) {
          drawMark(x, y);
        }
      }
    } else {
      drawMark(scaledWatermarkPos.x, scaledWatermarkPos.y);
    }
    
    ctx.restore();
    
    // 添加网站水印到右下角
    drawWebsiteWatermark(ctx, canvasWidth, canvasHeight, scaleX, scaleY);
  }
  
  // 绘制网站水印
  function drawWebsiteWatermark(ctx, canvasWidth, canvasHeight, scaleX = 1, scaleY = 1) {
    const websiteText = 'aishuiyin.babydu.cn';
    const websiteFontSize = Math.max(12, Math.min(canvasWidth, canvasHeight) * 0.02); // 根据图片大小动态调整字体
    const websiteOpacity = 0.6; // 网站水印透明度
    
    ctx.save();
    ctx.globalAlpha = websiteOpacity;
    ctx.font = `${websiteFontSize * scaleX}px Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    
    // 计算文字位置（右下角）
    const padding = 10 * scaleX; // 距离边缘的间距
    const x = canvasWidth - padding;
    const y = canvasHeight - padding;
    
    // 绘制文字填充（白色，无描边）
    ctx.fillText(websiteText, x, y);
    
    ctx.restore();
  }

  // 下载当前图片
  function downloadCurrentImage() {
    if (!baseImage) return;
    
    // 创建临时画布，使用原始图片尺寸
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // 设置临时画布为原始图片尺寸
    tempCanvas.width = baseImage.width;
    tempCanvas.height = baseImage.height;
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';
    
    // 绘制原始图片
    tempCtx.drawImage(baseImage, 0, 0);
    
    // 计算水印在原始尺寸下的位置和大小
    const scaleX = baseImage.width / canvas.width;
    const scaleY = baseImage.height / canvas.height;
    
    // 绘制水印
    drawWatermarkOnCanvas(tempCtx, tempCanvas.width, tempCanvas.height, scaleX, scaleY);
    
    const link = document.createElement('a');
    link.download = `watermarked-${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png', 1);
    link.click();
    
    showToast('图片已下载 ✅');
  }
  
  // 复制图片到剪切板
  async function copyImageToClipboard() {
    if (!baseImage) {
      showToast('请先上传图片', 2000);
      return;
    }
    
    try {
      // 创建临时画布，使用原始图片尺寸
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      // 设置临时画布为原始图片尺寸
      tempCanvas.width = baseImage.width;
      tempCanvas.height = baseImage.height;
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      
      // 绘制原始图片
      tempCtx.drawImage(baseImage, 0, 0);
      
      // 计算水印在原始尺寸下的位置和大小
      const scaleX = baseImage.width / canvas.width;
      const scaleY = baseImage.height / canvas.height;
      
      // 绘制水印
      drawWatermarkOnCanvas(tempCtx, tempCanvas.width, tempCanvas.height, scaleX, scaleY);
      
      // 将临时画布转换为blob
      const blob = await new Promise(resolve => {
        tempCanvas.toBlob(resolve, 'image/png', 1);
      });
      
      // 复制到剪切板
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);
      
      showToast('图片已复制到剪切板 ✅');
    } catch (error) {
      console.error('复制失败:', error);
      showToast('复制失败，请重试', 2000);
    }
  }
  
  // 全局阻止拖拽默认行为
  function initGlobalDragPrevention() {
    // 阻止整个页面的拖拽默认行为
    document.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    document.addEventListener('dragenter', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    document.addEventListener('dragleave', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    document.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    console.log('全局拖拽阻止已启用');
  }
  
  // 暴露函数到全局作用域
  window.resetUpload = resetUpload;
  window.downloadCurrentImage = downloadCurrentImage;
  window.copyImageToClipboard = copyImageToClipboard;
  
  // 切换到编辑模式
  function switchToEditMode() {
    const uploadPrompt = document.getElementById('uploadPrompt');
    if (uploadPrompt) {
      uploadPrompt.style.display = 'none';
    }
    console.log('已切换到编辑模式');
  }
  
  // 切换到上传模式
  function switchToUploadMode() {
    const uploadPrompt = document.getElementById('uploadPrompt');
    if (uploadPrompt) {
      uploadPrompt.style.display = 'block';
    }
    console.log('已切换到上传模式');
  }
  
  // 重置上传
  function resetUpload() {
    // 清空数据
    baseImage = null;
    watermarkImage = null;
    imagesList = [];
    
    // 切换到上传模式
    switchToUploadMode();
    
    // 清空文件输入
    const imgInput = document.getElementById('imgInput');
    if (imgInput) imgInput.value = '';
    
    showToast('已重置，可以重新上传图片');
   }
   
   // 获取当前设置摘要
   function getSettingsSummary() {
     const keys = ['watermarkText','fontSize','fontColor','opacity','rotate','mode','tileGap','quality'];
     const summary = {};
     keys.forEach(k => summary[k] = document.getElementById(k).value);
     return summary;
   }
  
  // ========== 历史记录功能 ==========
  
  // 初始化历史记录面板
  function initHistoryPanel() {
    
    // 从localStorage加载历史记录
    loadHistoryFromStorage();
    
    // 添加调试功能
    console.log('历史记录面板初始化完成');
    console.log('历史记录数量:', historyList.length);
  }
  
  // 保存历史记录到localStorage
  function saveHistoryToStorage() {
    try {
      localStorage.setItem('watermark_history', JSON.stringify(historyList));
    } catch (error) {
      console.error('保存历史记录失败:', error);
    }
  }
  
  // 从localStorage加载历史记录并平滑迁移大图到IndexedDB
  function loadHistoryFromStorage() {
    try {
      const saved = localStorage.getItem('watermark_history');
      if (saved) {
        historyList = JSON.parse(saved);
        
        // 平滑迁移：检测旧版本直接保存在 localStorage 中的大图
        historyList.forEach(async (item) => {
          if (item.imageDataUrl) {
            try {
              // 将 dataURL 转换为 Blob 并存入 IndexedDB
              const res = await fetch(item.imageDataUrl);
              const blob = await res.blob();
              await saveImageToDB(item.id, blob);
              console.log('成功迁移历史图片到 IndexedDB:', item.id);
            } catch (err) {
              console.error('迁移历史图片失败:', item.id, err);
            }
            // 清理 localStorage 中的大图数据
            delete item.imageDataUrl;
            saveHistoryToStorage();
          }
        });
        
        updateHistoryDisplay();
      }
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
  }
  
  // 添加图片到历史记录
  async function addToHistory(file, imageBlobOrUrl) {
    // 先创建缩略图
    const thumbnail = await createThumbnail(imageBlobOrUrl);
    
    const id = Date.now();
    const historyItem = {
      id: id,
      name: file.name || '未命名图片',
      size: file.size || 0,
      timestamp: new Date().toISOString(),
      thumbnail: thumbnail, // 40x40 缩略图
      watermarkPos: { ...watermarkPos }, // 保存当前水印位置
      displayWidth: canvas.width, // 保存显示宽度
      displayHeight: canvas.height // 保存显示高度
    };
    
    // 1. 将原图存入 IndexedDB
    await saveImageToDB(id, file);
    
    // 移除重复项（通过名字和尺寸判断，因为 id 不同）
    historyList = historyList.filter(item => item.name !== file.name || item.size !== file.size);
    
    // 添加到开头
    historyList.unshift(historyItem);
    
    // 限制历史记录数量，多余的同步清理 IndexedDB
    if (historyList.length > maxHistoryItems) {
      const removedItems = historyList.slice(maxHistoryItems);
      for (const item of removedItems) {
        await deleteImageFromDB(item.id);
      }
      historyList = historyList.slice(0, maxHistoryItems);
    }
    
    // 更新当前索引
    currentHistoryIndex = 0;
    
    // 保存到localStorage
    saveHistoryToStorage();
    
    // 更新显示
    updateHistoryDisplay();
  }
  
  // 创建缩略图
  function createThumbnail(imageDataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // 设置缩略图尺寸
        const size = 40;
        canvas.width = size;
        canvas.height = size;
        
        // 绘制缩略图
        ctx.drawImage(img, 0, 0, size, size);
        
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(null);
      img.src = imageDataUrl;
    });
  }
  
  // 更新历史记录显示
  function updateHistoryDisplay() {
    const historyThumbnails = document.getElementById('historyThumbnails');
    const historyPanel = document.getElementById('historyPanel');
    if (!historyThumbnails || !historyPanel) return;
    
    historyThumbnails.innerHTML = '';
    
    if (historyList.length === 0) {
      // 如果没有历史记录，隐藏整个面板
      historyPanel.style.display = 'none';
      return;
    }
    
    // 有历史记录时显示面板
    historyPanel.style.display = 'flex';
    
    // 显示所有历史记录
    console.log('更新历史记录显示:', {
      historyListLength: historyList.length,
      currentHistoryIndex: currentHistoryIndex
    });
    
    historyList.forEach((item, index) => {
      // 创建缩略图容器
      const thumbnailContainer = document.createElement('div');
      thumbnailContainer.className = 'history-thumbnail-container';
      thumbnailContainer.style.position = 'relative';
      thumbnailContainer.style.display = 'inline-block';
      
      // 创建缩略图
      const thumbnail = document.createElement('img');
      const isActive = index === currentHistoryIndex;
      thumbnail.className = `history-thumbnail ${isActive ? 'active' : ''}`;
      
      console.log(`缩略图 ${index}:`, {
        itemId: item.id,
        isActive: isActive,
        className: thumbnail.className
      });
      
      // 优先使用缩略图，如果没有则使用原图
      thumbnail.src = item.thumbnail || item.imageDataUrl;
      thumbnail.alt = item.name;
      thumbnail.title = `${item.name} - ${formatTime(item.timestamp)}`;
      
      // 如果缩略图加载失败，使用原图
      thumbnail.onerror = () => {
        if (thumbnail.src !== item.imageDataUrl) {
          thumbnail.src = item.imageDataUrl;
        }
      };
      
      // 创建删除按钮
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete-btn';
      deleteBtn.innerHTML = '×';
      deleteBtn.title = '删除此历史记录';
      
      // 添加调试信息
      console.log(`删除按钮状态 - 索引: ${index}, 当前索引: ${currentHistoryIndex}, 是否激活: ${isActive}`);
      console.log(`缩略图类名: ${thumbnail.className}`);
      
      // 添加点击事件
      thumbnail.addEventListener('click', () => {
        console.log('点击缩略图，加载历史记录:', item.id);
        loadFromHistory(item.id);
      });
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡
        console.log('点击删除按钮，删除历史记录:', item.id);
        removeFromHistory(item.id);
      });
      
      // 组装元素
      thumbnailContainer.appendChild(thumbnail);
      thumbnailContainer.appendChild(deleteBtn);
      historyThumbnails.appendChild(thumbnailContainer);
    });
    
    // 滚动到当前激活的项目
    setTimeout(() => {
      const activeThumbnail = historyThumbnails.querySelector('.history-thumbnail.active');
      if (activeThumbnail) {
        activeThumbnail.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }, 100);
  }
  
  // 从历史记录加载图片
  async function loadFromHistory(id) {
    const item = historyList.find(item => item.id === id);
    if (!item) return;
    
    try {
      const fileBlob = await loadImageFromDB(id);
      if (!fileBlob) {
        showToast(getToastMessage('原图已丢失或未能加载，请重新上传', 'Original image lost or failed to load, please upload again'), 3000);
        return;
      }
      
      const blobUrl = URL.createObjectURL(fileBlob);
      const img = new Image();
      
      img.onload = () => {
        console.log('从历史记录加载图片完成:', img.width, 'x', img.height);
        baseImage = img;
        
        // 计算缩放比例，确保图片完全显示在固定容器中
        const containerHeight = window.innerHeight * 0.7; // 70vh
        const containerWidth = window.innerWidth;
        const maxWidth = Math.min(1200, containerWidth * 0.9);
        const maxHeight = Math.min(800, containerHeight * 0.9);
        
        const scaleX = maxWidth / img.width;
        const scaleY = maxHeight / img.height;
        const scale = Math.min(scaleX, scaleY, 1);
        
        const displayWidth = img.width * scale;
        const displayHeight = img.height * scale;
        
        // 设置画布为原始尺寸（保持高质量）
        canvas.width = img.width;
        canvas.height = img.height;
        
        // 通过CSS设置显示尺寸
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        // 恢复保存的水印位置，如果没有则使用默认位置
        if (item.watermarkPos) {
          watermarkPos = { ...item.watermarkPos };
        } else {
          watermarkPos = { x: img.width * 0.75, y: img.height * 0.85 };
        }
        
        // 切换到编辑模式
        switchToEditMode();
        
        // 绘制水印
        drawWatermark();
        
        // 更新当前索引
        currentHistoryIndex = historyList.findIndex(item => item.id === id);
        
        // 更新显示
        updateHistoryDisplay();
        
        URL.revokeObjectURL(blobUrl);
      };
      
      img.onerror = () => {
        showToast(getToastMessage('加载历史图片失败', 'Failed to load historical image'), 3000);
        URL.revokeObjectURL(blobUrl);
      };
      
      img.src = blobUrl;
    } catch (err) {
      console.error('加载历史记录失败:', err);
      showToast(getToastMessage('加载历史记录失败', 'Failed to load history item'), 3000);
    }
  }
  
  // 从历史记录中删除
  async function removeFromHistory(id) {
    const index = historyList.findIndex(item => item.id === id);
    if (index === -1) return;
    
    // 从历史记录中删除
    historyList.splice(index, 1);
    
    // 从 IndexedDB 中删除
    await deleteImageFromDB(id);
    
    // 如果删除的是当前显示的图片，需要重置界面
    if (index === currentHistoryIndex) {
      // 重置到上传状态
      switchToUploadMode();
      
      // 清空相关变量
      baseImage = null;
      watermarkImage = null;
      
      // 清空画布
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      // 重置当前索引
      currentHistoryIndex = -1;
    } else if (currentHistoryIndex > index) {
      // 如果删除的是当前图片之前的记录，需要调整当前索引
      currentHistoryIndex = currentHistoryIndex - 1;
    }
    
    // 保存到localStorage
    saveHistoryToStorage();
    
    // 更新显示
    updateHistoryDisplay();
    
    showToast(getToastMessage('已删除历史记录', 'History record deleted'));
  }
  
  // 格式化时间
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) { // 1分钟内
      return '刚刚';
    } else if (diff < 3600000) { // 1小时内
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) { // 1天内
      return `${Math.floor(diff / 3600000)}小时前`;
    } else {
      return date.toLocaleDateString();
    }
  }
  
  // 清空所有历史记录
  async function clearAllHistory() {
    const confirmMsg = getToastMessage('确定要清空所有历史记录吗？', 'Are you sure you want to clear all history?');
    if (confirm(confirmMsg)) {
      // 清理 IndexedDB
      for (const item of historyList) {
        await deleteImageFromDB(item.id);
      }
      historyList = [];
      currentHistoryIndex = -1;
      saveHistoryToStorage();
      updateHistoryDisplay();
      showToast(getToastMessage('已清空所有历史记录', 'All history cleared'));
    }
  }
  
  // 导出历史记录功能到全局
  window.loadFromHistory = loadFromHistory;
  window.removeFromHistory = removeFromHistory;
  window.clearAllHistory = clearAllHistory;
  
  // 调试功能
  window.testHistory = function() {
    console.log('当前历史记录:', historyList);
    console.log('历史记录面板元素:', document.getElementById('historyPanel'));
    console.log('历史记录缩略图容器:', document.getElementById('historyThumbnails'));
    console.log('当前历史记录索引:', currentHistoryIndex);
    updateHistoryDisplay();
  };
  
  // 详细调试删除按钮
  window.debugDeleteButtons = function() {
    console.log('=== 详细删除按钮调试 ===');
    
    const thumbnails = document.querySelectorAll('.history-thumbnail');
    const deleteButtons = document.querySelectorAll('.history-delete-btn');
    const thumbnailContainers = Array.from(document.querySelectorAll('.history-thumbnail')).map(thumb => thumb.parentElement);
    
    console.log('缩略图数量:', thumbnails.length);
    console.log('删除按钮数量:', deleteButtons.length);
    console.log('缩略图容器数量:', thumbnailContainers.length);
    console.log('当前历史记录索引:', currentHistoryIndex);
    console.log('历史记录总数:', historyList.length);
    
    thumbnails.forEach((thumb, index) => {
      const computedStyle = window.getComputedStyle(thumb);
      const deleteBtn = thumb.parentElement.querySelector('.history-delete-btn');
      const deleteBtnStyle = deleteBtn ? window.getComputedStyle(deleteBtn) : null;
      
      console.log(`缩略图 ${index}:`, {
        id: thumb.id || 'no-id',
        className: thumb.className,
        hasActive: thumb.classList.contains('active'),
        position: computedStyle.position,
        zIndex: computedStyle.zIndex,
        width: computedStyle.width,
        height: computedStyle.height,
        deleteButton: {
          exists: !!deleteBtn,
          element: deleteBtn,
          className: deleteBtn ? deleteBtn.className : 'N/A',
          opacity: deleteBtnStyle ? deleteBtnStyle.opacity : 'N/A',
          display: deleteBtnStyle ? deleteBtnStyle.display : 'N/A',
          visibility: deleteBtnStyle ? deleteBtnStyle.visibility : 'N/A',
          position: deleteBtnStyle ? deleteBtnStyle.position : 'N/A',
          zIndex: deleteBtnStyle ? deleteBtnStyle.zIndex : 'N/A',
          top: deleteBtnStyle ? deleteBtnStyle.top : 'N/A',
          right: deleteBtnStyle ? deleteBtnStyle.right : 'N/A',
          width: deleteBtnStyle ? deleteBtnStyle.width : 'N/A',
          height: deleteBtnStyle ? deleteBtnStyle.height : 'N/A',
          backgroundColor: deleteBtnStyle ? deleteBtnStyle.backgroundColor : 'N/A'
        }
      });
    });
    
    console.log('=== 调试结束 ===');
  };