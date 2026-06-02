// 自动检测所有截图并返回按优先级排序的 URL 列表（数字从1到maxTry）
async function getImageList(baseName, maxTry = 20) {
    const urls = [];
    for (let i = 1; i <= maxTry; i++) {
        const url = `${baseName}_${i}.png`;
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok) urls.push(url);
        } catch (e) {}
    }
    // 如果没有找到任何带数字的图片，尝试回退到无后缀版本（但建议统一命名）
    if (urls.length === 0) {
        const noSuffixUrl = `${baseName}.png`;
        try {
            const res = await fetch(noSuffixUrl, { method: 'HEAD' });
            if (res.ok) urls.push(noSuffixUrl);
        } catch (e) {}
    }
    return urls;
}

let popupImageUrls = [];
let floatingImageUrls = [];
let currentIndex = 0;          // 同步索引，同时控制两组图片
let intervalId = null;
let autoPlayEnabled = true;

function updateImages() {
    const popupImg = document.getElementById('popupScreenshot');
    const floatingImg = document.getElementById('floatingScreenshot');
    const popupCaption = document.getElementById('popupCaption');
    const floatingCaption = document.getElementById('floatingCaption');
    const counterSpan = document.getElementById('imageCounter');

    if (popupImg && popupImageUrls.length) {
        const url = popupImageUrls[currentIndex % popupImageUrls.length];
        popupImg.src = url;
        let label = url.replace(/\.png$/, '').replace(/.*_/, '');
        if (label === url) label = '最新界面';
        else label = `版本 ${label}`;
        popupCaption.textContent = `插件主界面（管理器） - ${label}`;
    }
    if (floatingImg && floatingImageUrls.length) {
        const url = floatingImageUrls[currentIndex % floatingImageUrls.length];
        floatingImg.src = url;
        let label = url.replace(/\.png$/, '').replace(/.*_/, '');
        if (label === url) label = '最新界面';
        else label = `版本 ${label}`;
        floatingCaption.textContent = `浮动快捷面板 - ${label}`;
    }
    if (counterSpan && popupImageUrls.length) {
        counterSpan.textContent = `第 ${(currentIndex % popupImageUrls.length) + 1} / ${popupImageUrls.length} 张`;
    }
}

function nextImage() {
    if (popupImageUrls.length || floatingImageUrls.length) {
        currentIndex++;
        updateImages();
    }
}

function prevImage() {
    if (popupImageUrls.length || floatingImageUrls.length) {
        currentIndex--;
        if (currentIndex < 0) {
            // 使用两组图片中最大的数量作为循环上限
            const maxLen = Math.max(popupImageUrls.length, floatingImageUrls.length);
            currentIndex = maxLen - 1;
        }
        updateImages();
    }
}

function toggleAutoPlay() {
    autoPlayEnabled = !autoPlayEnabled;
    if (autoPlayEnabled) startAutoPlay();
    else stopAutoPlay();
    const toggleBtn = document.getElementById('togglePlayBtn');
    if (toggleBtn) toggleBtn.textContent = autoPlayEnabled ? '⏸️ 暂停' : '▶️ 播放';
}

function startAutoPlay() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => nextImage(), 3000);
}

function stopAutoPlay() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

function closePage() {
    window.close();
    if (!window.closed) window.open('', '_self').close();
}

document.addEventListener('DOMContentLoaded', async () => {
    const closeBtn = document.getElementById('closeBtn');
    if (closeBtn) closeBtn.addEventListener('click', closePage);

    // 获取图片列表（数字从1开始递增）
    popupImageUrls = await getImageList('popup-screenshot');
    floatingImageUrls = await getImageList('floating-panel-screenshot');

    if (popupImageUrls.length === 0 && floatingImageUrls.length === 0) return;

    currentIndex = 0;
    updateImages();

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const toggleBtn = document.getElementById('togglePlayBtn');

    if (prevBtn) prevBtn.addEventListener('click', () => { prevImage(); if (!autoPlayEnabled) updateImages(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { nextImage(); if (!autoPlayEnabled) updateImages(); });
    if (toggleBtn) toggleBtn.addEventListener('click', toggleAutoPlay);

    startAutoPlay();

    const popupImg = document.getElementById('popupScreenshot');
    const floatingImg = document.getElementById('floatingScreenshot');
    [popupImg, floatingImg].forEach(img => {
        if (img) {
            img.addEventListener('mouseenter', () => { if (autoPlayEnabled) stopAutoPlay(); });
            img.addEventListener('mouseleave', () => { if (autoPlayEnabled) startAutoPlay(); });
        }
    });
});