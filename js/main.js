/* ======================================================
   主逻辑模块
   - 上传、粘贴、绘制水印
   - 并行处理与导出
   - 生成 manifest.txt
   ====================================================== */

   import { showToast, updateProgress, resetProgress, playDing } from './ui.js';
   import { loadSettings, initSettingsAutoSave } from './settings.js';
   
  // ========== 全局变量 ==========
  let dropZone, imgInput, watermarkImgInput, canvas, ctx;
  
  let baseImage = null;
  let watermarkImage = null;
  let imagesList = [];
  let watermarkPos = { x: 50, y: 50 };
  const CONCURRENCY = 3; // 默认并行数量
  
  // 初始化设置
  window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成，开始初始化...');
    
    // 延迟获取DOM元素，确保所有元素都已渲染
    setTimeout(() => {
      // 获取DOM元素
      dropZone = document.getElementById('dropZone');
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
        showToast('初始化失败，请刷新页面重试', 3000);
        return;
      }
      
      ctx = canvas.getContext('2d');
      
      loadSettings();
      initSettingsAutoSave();
      showToast('欢迎使用专业水印工具 🎨', 2000);
      
      // 初始化事件监听器
      initEventListeners();
      
      console.log('初始化完成');
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
    
    // 图片水印文件选择
    if (watermarkImgInput) {
      watermarkImgInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        const info = document.getElementById('watermarkImgInfo');
        if (file) {
          info.textContent = `已选择: ${file.name}`;
          info.style.color = '#10b981';
        } else {
          info.textContent = '未选择任何文件';
          info.style.color = '#64748b';
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
    
    // 上传LOGO按钮
    const uploadLogoBtn = document.getElementById('uploadLogoBtn');
    const watermarkImg = document.getElementById('watermarkImg');
    
    if (uploadLogoBtn && watermarkImg) {
      uploadLogoBtn.onclick = () => {
        console.log('点击上传LOGO按钮');
        watermarkImg.click();
      };
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
    
    // 删除按钮
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        console.log('点击删除按钮');
        resetUpload();
      };
    } else {
      console.log('删除按钮未找到');
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
    
    // 点击上传 - 简化版本
    dropZone.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('点击上传区域');
      try {
        imgInput.click();
        console.log('文件选择对话框已触发');
      } catch (error) {
        console.error('点击上传失败:', error);
        showToast('点击上传失败，请重试');
      }
    };
    
    // 拖拽事件 - 简化版本
    dropZone.ondragover = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽悬停');
      dropZone.classList.add('dragover');
    };
    
    dropZone.ondragenter = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽进入');
      dropZone.classList.add('dragover');
    };
    
    dropZone.ondragleave = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽离开');
      dropZone.classList.remove('dragover');
    };
    
    dropZone.ondrop = function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('拖拽放下');
      dropZone.classList.remove('dragover');
      
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      console.log('拖拽文件:', files);
      
      if (files.length) {
        imagesList.push(...files);
        loadImage(files[0]);
        showToast(`已添加 ${files.length} 张图片 ✅`);
      } else {
        showToast('请拖拽图片文件');
      }
    };
    
    // 文件选择事件 - 简化版本
    imgInput.onchange = function(e) {
      console.log('文件选择变化');
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      console.log('选择的文件:', files);
      
      if (files.length) {
        imagesList.push(...files);
        loadImage(files[0]);
        showToast(`已选择 ${files.length} 张图片 ✅`);
      } else {
        showToast('请选择图片文件');
      }
    };
    
    console.log('上传事件初始化完成');
  }
   
  // 初始化粘贴功能
  function initPasteEvents() {
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
        imagesList.push(...imgs);
        loadImage(imgs[0]);
        showToast(`已粘贴 ${imgs.length} 张图片 ✅`);
        console.log('成功处理粘贴的图片');
      } else {
        console.log('没有找到图片数据');
        showToast('剪贴板中没有图片数据，请确保复制了图片');
      }
    };
    
    console.log('粘贴功能初始化完成');
  }
   
  // ========== 加载主图 ==========
  function loadImage(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        console.log('图片加载完成:', img.width, 'x', img.height);
        baseImage = img;
        
        // 计算缩放比例，确保图片完全显示
        const maxWidth = 1200;
        const maxHeight = 800;
        const scaleX = maxWidth / img.width;
        const scaleY = maxHeight / img.height;
        const scale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小
        
        const displayWidth = img.width * scale;
        const displayHeight = img.height * scale;
        
        console.log('缩放比例:', scale, '显示尺寸:', displayWidth, 'x', displayHeight);
        
        // 设置画布为显示尺寸
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        
        // 设置水印位置（相对于显示尺寸）
        watermarkPos = { x: displayWidth * 0.75, y: displayHeight * 0.85 };
        
        // 切换到编辑模式
        switchToEditMode();
        
        // 添加预览区域功能
        addPreviewFeatures(file);
        
        drawWatermark();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
            watermarkImage.onload = drawWatermark;
            watermarkImage.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        }
      });
    }
    
    // 拖拽定位水印
    initDragEvents();
  }
  
  // 拖拽定位水印
  let dragging = false;
  let dragOffset = { x: 0, y: 0 };
  
  function initDragEvents() {
    if (!canvas) return;
    
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', onDrag);
    canvas.addEventListener('mouseup', endDrag);
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
            drawWatermark();
          }
        });
      }
    });
  }
   
   function startDrag(e) {
     const pos = getPointer(e);
     const { x, y } = pos;
     if (isInWatermark(x, y)) {
       dragging = true;
       dragOffset.x = x - watermarkPos.x;
       dragOffset.y = y - watermarkPos.y;
     }
   }
   function onDrag(e) {
     if (!dragging) return;
     e.preventDefault();
     const pos = getPointer(e);
     watermarkPos.x = pos.x - dragOffset.x;
     watermarkPos.y = pos.y - dragOffset.y;
     drawWatermark();
   }
   function endDrag() { dragging = false; }
   
  function getPointer(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
   function isInWatermark(x, y) {
     const size = 200;
     return x > watermarkPos.x - size/2 && x < watermarkPos.x + size/2 &&
            y > watermarkPos.y - size/2 && y < watermarkPos.y + size/2;
   }
   
   // ========== 绘制水印 ==========
   function drawWatermark() {
     if (!baseImage) return;
     ctx.clearRect(0, 0, canvas.width, canvas.height);
     ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
   
     const text = document.getElementById('watermarkText').value.trim();
     const fontSize = parseInt(document.getElementById('fontSize').value, 10);
     const fontColor = document.getElementById('fontColor').value;
     const opacity = parseFloat(document.getElementById('opacity').value);
     const rotate = parseFloat(document.getElementById('rotate').value);
     const mode = document.getElementById('mode').value;
     const tileGap = parseInt(document.getElementById('tileGap').value, 10);
   
     ctx.save();
     ctx.globalAlpha = opacity;
     ctx.translate(canvas.width / 2, canvas.height / 2);
     ctx.rotate((rotate * Math.PI) / 180);
     ctx.translate(-canvas.width / 2, -canvas.height / 2);
   
     if (mode === 'tile') {
       for (let y = 0; y < canvas.height; y += tileGap)
         for (let x = 0; x < canvas.width; x += tileGap)
           drawMark(x, y);
     } else {
       drawMark(watermarkPos.x, watermarkPos.y);
     }
   
     ctx.restore();
   
     function drawMark(x, y) {
       if (text) {
         ctx.font = `${fontSize}px sans-serif`;
         ctx.fillStyle = fontColor;
         ctx.fillText(text, x, y);
       }
       if (watermarkImage) {
         const w = canvas.width * 0.15;
         const h = watermarkImage.height / watermarkImage.width * w;
         ctx.drawImage(watermarkImage, x, y - h, w, h);
       }
     }
   }
   
  // 初始化导出功能
  function initExportEvents() {
    const downloadBtn = document.getElementById('downloadAllBtn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        if (!imagesList.length) {
          showToast('请先上传至少一张图片');
          return;
        }
        
        const quality = parseFloat(document.getElementById('quality').value);
        const zip = new JSZip();
        const manifest = [];
        const startTime = Date.now();
      
        showToast('开始批量处理...');
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
            showToast('✅ 全部处理完成');
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
    
    // 添加工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-toolbar';
    toolbar.innerHTML = `
      <button class="btn" onclick="resetUpload()">
        <span>🔄</span>
        <span>重新上传</span>
      </button>
      <button class="btn" onclick="downloadCurrentImage()">
        <span>💾</span>
        <span>下载图片</span>
      </button>
    `;
    preview.appendChild(toolbar);
    
    // 不添加图片信息和水印提示，只显示图片
  }
  
  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // 下载当前图片
  function downloadCurrentImage() {
    if (!baseImage) return;
    
    const link = document.createElement('a');
    link.download = `watermarked-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png', 1);
    link.click();
    
    showToast('图片已下载 ✅');
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
  
  // 切换到编辑模式
  function switchToEditMode() {
    const uploadOnlyLayout = document.getElementById('uploadOnlyLayout');
    const mainLayout = document.getElementById('mainLayout');
    
    if (uploadOnlyLayout && mainLayout) {
      uploadOnlyLayout.style.display = 'none';
      mainLayout.style.display = 'flex';
      console.log('已切换到编辑模式');
    }
  }
  
  // 切换到上传模式
  function switchToUploadMode() {
    const uploadOnlyLayout = document.getElementById('uploadOnlyLayout');
    const mainLayout = document.getElementById('mainLayout');
    
    if (uploadOnlyLayout && mainLayout) {
      uploadOnlyLayout.style.display = 'flex';
      mainLayout.style.display = 'none';
      console.log('已切换到上传模式');
    }
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