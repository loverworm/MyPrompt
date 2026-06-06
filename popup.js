const APP_META = {
    updateDate: '2026-06-05'
};

document.addEventListener('DOMContentLoaded', function () {
    let promptList = [];
    let draftList = [];
    let cateList = [];  // 对象数组 { name, color }
    let tagList = ["基础", "办公", "写作"];
    let editId = null;
    let checkedIds = [];
    let searchKeyword = '';
    let sortType = 'default';  // 存储排序选项的值
    let selectedTags = [];
    let tooltipTimer = null;
    let isSaving = false;

    // 筛选变量
    let selectedCategoryFilter = '';
    let selectedTagFilter = '';

    // 预设16种背景色（柔和不刺眼）
    const PRESET_COLORS = [
        { value: "", label: "默认白色" },
        { value: "#e8f7e6", label: "淡绿" },
        { value: "#fff0e6", label: "淡橙" },
        { value: "#ffe6f0", label: "淡粉" },
        { value: "#f0e6ff", label: "淡紫" },
        { value: "#e6fffa", label: "青绿" },
        { value: "#f5f0e6", label: "米色" },
        { value: "#e6f0ff", label: "淡天蓝" },
        { value: "#f0f5e6", label: "草绿" },
        { value: "#e6e6ff", label: "淡靛蓝" },
        { value: "#fff0f5", label: "淡樱花" },
        { value: "#f5f5dc", label: "奶油" },
        { value: "#ffe6e6", label: "淡红" },
        { value: "#e6f7ff", label: "淡蓝（收藏色）" },
        { value: "#fff9e6", label: "淡黄（置顶色）" }
    ];

    // ========== 工具函数 ==========
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    function formatDate(isoStr) {
        if (!isoStr) return '未知日期';
        try {
            const d = new Date(isoStr);
            if (isNaN(d)) return isoStr;
            return d.toLocaleDateString();
        } catch (e) { return isoStr; }
    }
    function formatDateTime(isoStr) {
        if (!isoStr) return '未知日期';
        try {
            const d = new Date(isoStr);
            if (isNaN(d)) return isoStr;
            return d.toLocaleString();
        } catch (e) { return isoStr; }
    }

    // 颜色加深辅助函数（用于左边框）
    function adjustColor(color, percent) {
        if (!color || color === "") return "#ddd";
        let r, g, b;
        if (color.startsWith('#')) {
            r = parseInt(color.slice(1,3), 16);
            g = parseInt(color.slice(3,5), 16);
            b = parseInt(color.slice(5,7), 16);
        } else {
            return "#ddd";
        }
        r = Math.max(0, Math.min(255, r + percent));
        g = Math.max(0, Math.min(255, g + percent));
        b = Math.max(0, Math.min(255, b + percent));
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }

    // 版本号比较函数（支持 1.2.3 格式）
    function compareVersion(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        const maxLen = Math.max(parts1.length, parts2.length);
        for (let i = 0; i < maxLen; i++) {
            const n1 = i < parts1.length ? parts1[i] : 0;
            const n2 = i < parts2.length ? parts2[i] : 0;
            if (n1 !== n2) return n2 - n1; // 降序：大的在前
        }
        return 0;
    }

    // ========== 操作日志存储 ==========
    let operationLogs = [];
    const LOG_KEY = 'myOperationLogs';
    function loadLogs() {
        try {
            const stored = localStorage.getItem(LOG_KEY);
            if (stored) operationLogs = JSON.parse(stored);
            else operationLogs = [];
        } catch (e) { operationLogs = []; }

        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([LOG_KEY], (result) => {
                if (result[LOG_KEY] && Array.isArray(result[LOG_KEY])) {
                    const localIds = new Set(operationLogs.map(l => l.id));
                    const newLogs = result[LOG_KEY].filter(l => !localIds.has(l.id));
                    if (newLogs.length > 0) {
                        operationLogs.push(...newLogs);
                        operationLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
                        saveLogs();
                    }
                }
            });
        }
    }
    function saveLogs() {
        const trimmed = operationLogs.slice(0, 500);
        try { localStorage.setItem(LOG_KEY, JSON.stringify(trimmed)); } catch (e) {}
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [LOG_KEY]: trimmed });
        }
    }
    function addLog(type, title, detail, source, targetSite) {
        const log = {
            id: Date.now() + '-' + Math.random().toString(36).substring(2, 8),
            time: new Date().toISOString(),
            type: type,
            title: title || '',
            detail: detail || '',
            source: source || '',
            targetSite: targetSite || ''
        };
        operationLogs.unshift(log);
        saveLogs();
        const logModal = document.getElementById('logModal');
        if (logModal && logModal.style.display === 'flex') renderLogList();
    }
    function getCurrentSiteDomain(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs.length && tabs[0].url) {
                try { callback(new URL(tabs[0].url).hostname); } catch(e) { callback(''); }
            } else callback('');
        });
    }

    // ========== 分类数据规范化（兼容旧格式） ==========
    function normalizeCateList(raw) {
        if (!raw || !Array.isArray(raw)) return [];
        return raw.map(item => {
            if (typeof item === 'string') {
                return { name: item, color: "" };
            } else if (typeof item === 'object' && item !== null && item.name) {
                return { name: String(item.name), color: (item.color && typeof item.color === 'string') ? item.color : "" };
            } else {
                return null;
            }
        }).filter(item => item !== null);
    }

    // ========== 页面状态管理 ==========
    const pageState = {
        promptList: { rendered: false, dirty: true },
        collectList: { rendered: false, dirty: true },
        draftList: { rendered: false, dirty: true },
        cateManage: { rendered: false, dirty: true },
        tagManage: { rendered: false, dirty: true }
    };
    function markDirty(pageId) { if (pageState[pageId]) pageState[pageId].dirty = true; }
    function reloadDataFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['myPromptList', 'myDraftList', 'cateList', 'tagList'], (result) => {
                promptList = (result.myPromptList || []).map(fixItem);
                draftList = (result.myDraftList || []).map(fixItem);
                cateList = normalizeCateList(result.cateList || ["通用", "写作", "办公"]);
                tagList = result.tagList || ["基础", "办公", "写作"];
                localStorage.setItem('myPromptList', JSON.stringify(promptList));
                localStorage.setItem('myDraftList', JSON.stringify(draftList));
                localStorage.setItem('cateList', JSON.stringify(cateList));
                localStorage.setItem('tagList', JSON.stringify(tagList));
                refreshFilterDropdowns();
                resolve();
            });
        });
    }
    // 新标签页按钮
    const openInTabBtn = document.getElementById('openInTabBtn');
    if (openInTabBtn) {
        openInTabBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?standalone=true') });
        });
    }

    // 独立标签页样式适配
    const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.get('standalone') === 'true') {
		document.body.style.width = 'auto';
		document.body.style.height = '100vh';
		document.body.style.minWidth = '600px';
		document.body.style.minHeight = '500px';
		// 彻底禁止 body 滚动
		document.body.style.overflow = 'hidden';
		document.body.style.overflowY = 'hidden';
		document.body.style.overflowX = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		document.documentElement.style.overflowY = 'hidden';
		document.documentElement.style.overflowX = 'hidden';
		
		const leftNav = document.querySelector('.left-nav');
		const rightContent = document.querySelector('.right-content');
		if (leftNav) leftNav.style.height = '100vh';
		if (rightContent) {
			rightContent.style.height = '100vh';
			rightContent.style.overflow = 'hidden';
			rightContent.style.overflowY = 'hidden';
			rightContent.style.overflowX = 'hidden';
		}
		if (openInTabBtn) openInTabBtn.style.display = 'none';
	}

    // ========== 【新增】Popup 模式下：动态修正 body/html 高度，消除幽灵滚动条 ==========
    if (urlParams.get('standalone') !== 'true') {
        const actualHeight = document.documentElement.clientHeight;
        document.documentElement.style.height = actualHeight + 'px';
        document.body.style.height = actualHeight + 'px';
        // 双重保险，彻底禁止外层滚动
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    }

    function refreshFilterDropdowns() {
		const categoryFilter = document.getElementById('categoryFilter');
		const tagFilter = document.getElementById('tagFilter');
		if (categoryFilter) {
			const current = categoryFilter.value;
			categoryFilter.innerHTML = '<option value="">全部分类</option>';   // 修改此处
			cateList.forEach(c => {
				const opt = document.createElement('option');
				opt.value = c.name;
				opt.textContent = c.name;
				categoryFilter.appendChild(opt);
			});
			categoryFilter.value = current;
		}
		if (tagFilter) {
			const current = tagFilter.value;
			tagFilter.innerHTML = '<option value="">全部标签</option>';       // 修改此处
			tagList.forEach(t => {
				const opt = document.createElement('option');
				opt.value = t;
				opt.textContent = t;
				tagFilter.appendChild(opt);
			});
			tagFilter.value = current;
		}
	}

    function switchPage(pageId) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
        const page = document.getElementById(pageId);
        if (page) page.classList.add('show');

        const renderAndMark = () => {
            switch (pageId) {
                case 'promptList': renderPromptList(); break;
                case 'collectList': renderCollectList(); break;
                case 'draftList': renderDraftList(); break;
                case 'cateManage': renderCatePage(); break;
                case 'tagManage': renderTagPage(); break;
            }
            pageState[pageId].rendered = true;
            pageState[pageId].dirty = false;
        };

        if (!pageState[pageId].rendered || pageState[pageId].dirty) {
            if (pageState[pageId].dirty) {
                reloadDataFromStorage().then(renderAndMark);
            } else {
                renderAndMark();
            }
        }
    }

    function setStorage(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
        chrome.storage.local.set({ [key]: val });
    }

    function increaseVersion(ver) {
        let parts = ver.split('.');
        let last = parseInt(parts.pop()) + 1;
        parts.push(last);
        return parts.join('.');
    }
    function fixItem(item) {
        item.pinned = !!item.pinned;
        item.collect = !!item.collect;
        item.updateDate = item.updateDate || item.createDate || new Date().toISOString();
        item.createDate = item.createDate || new Date().toISOString();
        item.isDraft = !!item.isDraft;
        item.enable = item.enable ?? true;
        item.useCount = item.useCount ?? 0;
        item.lastUsed = item.lastUsed ?? null;
        item.tags = item.tags || '';
        item.category = item.category || '未分类';
        item.content = item.content || '';
        item.title = item.title || '';
        item.remark = item.remark || '';
        item.version = item.version || '0.1';
        item.seriesId = item.seriesId || item.id;  // ← 新增：兼容旧数据，补全系列标识
        return item;
    }

    promptList = promptList.map(fixItem);
    draftList = draftList.map(fixItem);
    loadLogs();

    // ========== 使用次数递增 ==========
    function incrementUseCount(itemId) {
        const item = promptList.find(x => x.id === itemId && !x.isDraft);
        if (item) {
            item.useCount = (item.useCount || 0) + 1;
            item.lastUsed = new Date().toISOString();
            setStorage('myPromptList', promptList);
            const curPage = document.querySelector('.page.show')?.id;
            if (curPage === 'promptList') {
                renderPromptList();
                pageState.promptList.dirty = false;
            } else if (curPage === 'collectList') {
                renderCollectList();
                pageState.collectList.dirty = false;
            } else if (curPage === 'draftList') {
                renderDraftList();
                pageState.draftList.dirty = false;
            } else {
                markDirty('promptList');
                markDirty('collectList');
                markDirty('draftList');
            }
        }
    }

    // ========== Tooltip ==========
    function showTip(e, item) {
        if (tooltipTimer) clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(() => {
            const tip = document.getElementById('toolTip');
            if (!tip) return;
            // 【修正】将 <<br> 改为 <br>，消除 Tooltip 中多余的 "<" 符号
            tip.innerHTML = `标题：${escapeHtml(item.title)}<br>备注：${escapeHtml(item.remark) || "无"}<br>摘要：${escapeHtml(item.content.slice(0, 60))}...`;
            tip.style.display = 'block';

            let left = e.clientX + 10;
            let top = e.clientY + 10;
            const rect = tip.getBoundingClientRect();
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            if (left + rect.width > winWidth) left = e.clientX - rect.width - 10;
            if (top + rect.height > winHeight) top = e.clientY - rect.height - 10;
            left = Math.max(5, left);
            top = Math.max(5, top);

            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
        }, 400);
    }
    function hideTip() {
        if (tooltipTimer) clearTimeout(tooltipTimer);
        const tip = document.getElementById('toolTip');
        if (tip) tip.style.display = 'none';
    }

    // ========== 弹窗绑定 ==========
    const logModal = document.getElementById('logModal');
    const closeLog = document.getElementById('closeLogBtn');
    const closeEdit = document.getElementById('closeEdit');
    if (closeLog) closeLog.addEventListener('click', () => logModal.style.display = 'none');
    if (closeEdit) closeEdit.addEventListener('click', () => document.getElementById('editModal').style.display = 'none');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.page) {
            btn.addEventListener('click', () => switchPage(btn.dataset.page));
        }
    });

    // 顶部工具栏事件
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            searchKeyword = e.target.value.trim().toLowerCase();
            renderPromptList();
        });
    }
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', e => {
            sortType = e.target.value;
            renderPromptList();
        });
    }
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', e => {
            selectedCategoryFilter = e.target.value;
            renderPromptList();
        });
    }
    const tagFilter = document.getElementById('tagFilter');
    if (tagFilter) {
        tagFilter.addEventListener('change', e => {
            selectedTagFilter = e.target.value;
            renderPromptList();
        });
    }

    // 过滤函数
    function filterItems(arr, kw, cateFilter, tagFilter) {
        return arr.filter(item => {
            if (kw && !item.title.toLowerCase().includes(kw) && !item.content.toLowerCase().includes(kw) && !item.tags.toLowerCase().includes(kw)) return false;
            if (cateFilter && item.category !== cateFilter) return false;
            if (tagFilter) {
                const itemTags = item.tags ? item.tags.split(',').map(t => t.trim()) : [];
                if (!itemTags.includes(tagFilter)) return false;
            }
            return true;
        });
    }

    // ========== 分类/标签管理（保留原始提示行和详细统计） ==========
    function renderCatePage() {
        const box = document.getElementById('cateContainer');
        if (!box) return;
        const tipLine = document.createElement('div');
        tipLine.style.cssText = 'font-size:11px; color:#888; margin-bottom:8px; padding:4px; background:#f5f7fa; border-radius:4px;';
        tipLine.innerHTML = '💡 括号内数字格式：(启用数 / 总数) <br> 鼠标悬停可查看详细统计（总词条数、草稿数、未启用数、启用数）';
        box.innerHTML = '';
        box.appendChild(tipLine);

        if (cateList.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-tip';
            emptyDiv.textContent = '暂无分类，请添加';
            box.appendChild(emptyDiv);
            return;
        }

        const colorSelectOptions = PRESET_COLORS.map(c => `<option value="${c.value}" ${c.value === "" ? 'selected' : ''}>${c.label}</option>`).join('');

        cateList.forEach((cate, idx) => {
            const allItems = [...promptList, ...draftList].filter(p => p.category === cate.name);
            const total = allItems.length;
            const draftCount = allItems.filter(p => p.isDraft === true).length;
            const disabledCount = allItems.filter(p => p.enable === false).length;
            const activeCount = total - draftCount - disabledCount;
            const titleText = `总词条:${total} | 草稿:${draftCount} | 未启用:${disabledCount} | 启用:${activeCount}`;
            
            let div = document.createElement('div');
            div.className = 'manage-item';
            div.innerHTML = `
                <span title="${titleText}" style="flex:1;">${escapeHtml(cate.name)} (${activeCount}/${total})</span>
                <select class="cate-color-select" data-idx="${idx}" style="width:100px;">
                    ${colorSelectOptions}
                </select>
                <button class="btn danger del-cate" data-idx="${idx}">删除</button>
            `;
            const colorSelect = div.querySelector('select');
            if (cate.color) colorSelect.value = cate.color;
            colorSelect.addEventListener('change', (e) => {
                cateList[idx].color = e.target.value;
                setStorage('cateList', cateList);
                markDirty('promptList');
                renderPromptList();
                addLog('edit', `分类“${cate.name}”`, `修改背景色为${PRESET_COLORS.find(c=>c.value===e.target.value)?.label || '默认'}`, 'cateManage');
            });
            div.querySelector('.del-cate').onclick = () => {
                const delName = cateList[idx].name;
                cateList.splice(idx, 1);
                setStorage('cateList', cateList);
                renderCatePage();
                markDirty('promptList');
                refreshFilterDropdowns();
                addLog('edit', `分类“${delName}”`, '删除分类', 'cateManage');
                renderPromptList();
            };
            box.appendChild(div);
        });
    }

    function renderTagPage() {
        const box = document.getElementById('tagContainer');
        if (!box) return;
        const tipLine = document.createElement('div');
        tipLine.style.cssText = 'font-size:11px; color:#888; margin-bottom:8px; padding:4px; background:#f5f7fa; border-radius:4px;';
        tipLine.innerHTML = '💡 括号内数字格式：(启用数 / 总数) <br> 鼠标悬停可查看详细统计（总词条数、草稿数、未启用数、启用数）';
        box.innerHTML = '';
        box.appendChild(tipLine);

        if (tagList.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-tip';
            emptyDiv.textContent = '暂无标签';
            box.appendChild(emptyDiv);
            return;
        }

        tagList.forEach((name, idx) => {
            const allItems = [...promptList, ...draftList].filter(p => {
                if (!p.tags) return false;
                const itemTags = p.tags.split(',').map(t => t.trim());
                return itemTags.includes(name);
            });
            const total = allItems.length;
            const draftCount = allItems.filter(p => p.isDraft === true).length;
            const disabledCount = allItems.filter(p => p.enable === false).length;
            const activeCount = total - draftCount - disabledCount;
            const titleText = `总词条:${total} | 草稿:${draftCount} | 未启用:${disabledCount} | 启用:${activeCount}`;
            let div = document.createElement('div');
            div.className = 'manage-item';
            div.innerHTML = `<span title="${titleText}">${escapeHtml(name)} (${activeCount}/${total})</span><button class="btn danger del-tag" data-i="${idx}">删除</button>`;
            box.appendChild(div);
        });

        document.querySelectorAll('.del-tag').forEach(btn => {
            btn.onclick = () => {
                const idx = +btn.dataset.i;
                const delName = tagList[idx];
                tagList.splice(idx, 1);
                setStorage('tagList', tagList);
                renderTagPage();
                markDirty('promptList');
                refreshFilterDropdowns();
                addLog('edit', `标签“${delName}”`, '删除标签', 'tagManage');
                renderPromptList();
            };
        });
    }

    const addCateBtn = document.getElementById('addCateBtn');
    const newCateInput = document.getElementById('newCateInput');
    const newCateColor = document.getElementById('newCateColor');
    if (addCateBtn && newCateInput && newCateColor) {
        newCateColor.innerHTML = PRESET_COLORS.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
        addCateBtn.onclick = () => {
            let val = newCateInput.value.trim();
            if (!val) return alert('请输入分类名称');
            if (cateList.some(c => c.name === val)) return alert('分类已存在');
            const selectedColor = newCateColor.value;
            cateList.push({ name: val, color: selectedColor });
            setStorage('cateList', cateList);
            newCateInput.value = '';
            newCateColor.value = '';
            renderCatePage();
            markDirty('promptList');
            refreshFilterDropdowns();
            addLog('edit', `分类“${val}”`, '新增分类', 'cateManage');
            renderPromptList();
        };
    }

    const addTagBtn = document.getElementById('addTagBtn');
    const newTagInput = document.getElementById('newTagInput');
    if (addTagBtn && newTagInput) {
        addTagBtn.onclick = () => {
            let val = newTagInput.value.trim();
            if (val && !tagList.includes(val)) {
                tagList.push(val);
                setStorage('tagList', tagList);
                newTagInput.value = '';
                renderTagPage();
                markDirty('promptList');
                refreshFilterDropdowns();
                addLog('edit', `标签“${val}”`, '新增标签', 'tagManage');
                renderPromptList();
            }
        };
    }

    function refreshCateSelect() {
        const sel = document.getElementById('promptCate');
        const batchSel = document.getElementById('batchMoveCate');
        if (!sel || !batchSel) return;
        sel.innerHTML = '';
        batchSel.innerHTML = '';
        cateList.forEach(c => {
            const opt1 = document.createElement('option');
            opt1.value = c.name;
            opt1.textContent = c.name;
            sel.appendChild(opt1);
            const opt2 = document.createElement('option');
            opt2.value = c.name;
            opt2.textContent = c.name;
            batchSel.appendChild(opt2);
        });
    }

    function renderTagSelector(initTags = []) {
        const box = document.getElementById('tagSelector');
        if (!box) return;
        box.innerHTML = '';
        selectedTags = [...initTags];
        tagList.forEach(tag => {
            let el = document.createElement('span');
            el.className = 'tag-option';
            if (selectedTags.includes(tag)) el.classList.add('active');
            el.textContent = tag;
            el.onclick = () => {
                if (selectedTags.includes(tag)) {
                    selectedTags = selectedTags.filter(t => t !== tag);
                    el.classList.remove('active');
                } else {
                    selectedTags.push(tag);
                    el.classList.add('active');
                }
                document.getElementById('promptTag').value = selectedTags.join(',');
            };
            box.appendChild(el);
        });
        document.getElementById('promptTag').value = selectedTags.join(',');
    }
    const addTagBtnEdit = document.getElementById('addTagBtnEdit');
    const newTagInputEdit = document.getElementById('newTagInputEdit');
    if (addTagBtnEdit && newTagInputEdit) {
        addTagBtnEdit.onclick = () => {
            const val = newTagInputEdit.value.trim();
            if (!val) return alert('请输入标签名');
            if (tagList.includes(val)) return alert('标签已存在');
            tagList.push(val);
            setStorage('tagList', tagList);
            selectedTags.push(val);
            renderTagSelector(selectedTags);
            renderTagPage();
            refreshFilterDropdowns();
            newTagInputEdit.value = '';
            addLog('edit', `标签“${val}”`, '新增标签（编辑页）', 'tagManage');
            renderPromptList();
        };
    }

    // ========== 填入网页 ==========
    function insertTextToPage(text) {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs.length) return alert('未获取页面');
            const tab = tabs[0];
            if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
                alert('无法在浏览器内部页面使用此功能，请切换到普通网页');
                return;
            }
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (txt) => {
                    const selectors = [
                        '.chat-input-editor[data-lexical-editor="true"]',
                        'div[contenteditable="true"][data-testid]',
                        'textarea[data-testid="chat_input_input"]',
                        'textarea[id^="chat-textarea"]',
                        'textarea',
                        'div[role="textbox"]'
                    ];
                    let editor = null;
                    for (let s of selectors) {
                        const candidates = document.querySelectorAll(s);
                        for (let el of candidates) {
                            const ph = (el.getAttribute('placeholder') || '').toLowerCase();
                            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                            if (ph.includes('搜索') || ph.includes('search') || aria.includes('搜索')) continue;
                            editor = el;
                            break;
                        }
                        if (editor) break;
                    }
                    if (!editor) return 'no';
                    try {
                        if (editor.hasAttribute('data-lexical-editor')) {
                            editor.focus();
                            const sel = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(editor);
                            sel.removeAllRanges();
                            sel.addRange(range);
                            const dt = new DataTransfer();
                            dt.setData('text/plain', txt);
                            const pasteEv = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                            editor.dispatchEvent(pasteEv);
                            return 'ok-kimi';
                        } else if (editor.isContentEditable) {
                            editor.innerText = txt;
                            editor.dispatchEvent(new Event('input', { bubbles: true }));
                            return 'ok-div';
                        } else {
                            editor.value = txt;
                            editor.dispatchEvent(new Event('input', { bubbles: true }));
                            return 'ok-textarea';
                        }
                    } catch (e) { return 'err'; }
                },
                args: [text]
            });
        });
    }

    // ========== 排序核心函数 ==========
    function sortList(arr, sortMode) {
        if (sortMode === 'default') {
            // 默认排序：先置顶（pinned），再按修改时间降序
            return arr.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                let da = new Date(a.updateDate).getTime(), db = new Date(b.updateDate).getTime();
                if (isNaN(da)) da = 0;
                if (isNaN(db)) db = 0;
                return db - da;
            });
        } else if (sortMode === 'cate_oldest') {
            // 分类内最早修改在前：置顶优先，再按修改时间升序
            return arr.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                let da = new Date(a.updateDate).getTime(), db = new Date(b.updateDate).getTime();
                if (isNaN(da)) da = 0;
                if (isNaN(db)) db = 0;
                return da - db;
            });
        } else if (sortMode === 'cate_most_used') {
            // 分类内使用次数最多：置顶优先，再按使用次数降序
            return arr.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return (b.useCount || 0) - (a.useCount || 0);
            });
        } else if (sortMode === 'global_most_used') {
            // 全局使用次数最多：不按置顶，直接按使用次数降序
            return arr.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        } else if (sortMode === 'global_pinned_first') {
            // 全局置顶优先：所有置顶在前，内部按使用次数降序；非置顶也按使用次数降序
            return arr.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return (b.useCount || 0) - (a.useCount || 0);
            });
        } else if (sortMode === 'global_collected_first') {
            // 全局收藏优先：所有收藏在前，内部按使用次数降序；非收藏也按使用次数降序
            return arr.sort((a, b) => {
                if (a.collect !== b.collect) return a.collect ? -1 : 1;
                return (b.useCount || 0) - (a.useCount || 0);
            });
        } else if (sortMode === 'global_version_desc') {
            // 全局版本号降序：不按置顶，直接按版本号降序
            return arr.sort((a, b) => compareVersion(a.version, b.version));
        }
        return arr;
    }

    // 创建单个卡片 DOM 元素（复用逻辑）
    function createCardElement(p) {
        let tagStr = p.tags.split(',').filter(t => t).map(t => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('');
        let dom = document.createElement('div');
        let className = 'prompt-item';
        if (p.pinned) {
            className += ' pinned-item';
        } else if (p.collect) {
            className += ' collected-item';
        } else {
            const cateObj = cateList.find(c => c.name === p.category);
            if (cateObj && cateObj.color) {
                dom.style.backgroundColor = cateObj.color;
                dom.style.borderLeft = `4px solid ${adjustColor(cateObj.color, -20)}`;
            }
        }
        dom.className = className;
        dom.dataset.id = p.id;
        const pinIcon = p.pinned ? '📍' : '📌';
        const pinTitle = p.pinned ? '已置顶，点击取消' : '未置顶，点击置顶';
        
        let statusBadge = '';
        if (p.pinned) {
            statusBadge = '<span class="status-badge pinned-badge">已置顶</span>';
        } else if (p.collect) {
            statusBadge = '<span class="status-badge collect-badge">已收藏</span>';
        }
        
      dom.innerHTML = `
        <div class="item-head">
          <div class="title-wrap">
            <input type="checkbox" class="item-check" title="勾选后可使用批量操作">
            <button class="pin-btn" data-id="${p.id}" title="${pinTitle}">${pinIcon}</button>
            <span class="title-main">${escapeHtml(p.title)}</span>
            <span class="title-meta">v${escapeHtml(p.version)} ${p.useCount ? `🔥${p.useCount}` : ''}</span>
          </div>
          ${statusBadge}
        </div>
        <div style="margin-top:6px;">
          <div class="item-opt">
            <button class="btn primary insert-btn">📥 填入</button>
            <button class="btn copy-btn">📋 复制</button>
            <button class="btn success collect-btn">${p.collect ? '⭐ 已收藏' : '☆ 收藏'}</button>
            <button class="btn warning to-draft-btn">📄 转草稿</button>
            <button class="btn gray edit-btn">✏️ 编辑</button>
            <button class="btn danger del-btn">✖ 删除</button>
          </div>
        </div>
        <div>分类：${escapeHtml(p.category)}${tagStr ? '｜标签：' + tagStr : ''}</div>
        <div style="font-size:11px;color:#999;">创建：${formatDate(p.createDate)}｜修改：${formatDate(p.updateDate)}</div>`;
        dom.addEventListener('mouseenter', e => showTip(e, p));
        dom.addEventListener('mouseleave', hideTip);
        return dom;
    }

    // ========== 渲染列表（已修改为使用新排序和分组逻辑） ==========
    function renderPromptList() {
        refreshCateSelect();
        const box = document.getElementById('listContainer');
        if (!box) return;
        box.innerHTML = '';
        checkedIds = [];
        let activeList = promptList.filter(p => p.enable !== false);
        let list = filterItems(activeList, searchKeyword, selectedCategoryFilter, selectedTagFilter);
        
        // 判断是否为全局排序模式（不显示分类标题）
        const globalModes = ['global_most_used', 'global_pinned_first', 'global_collected_first', 'global_version_desc'];
        const isGlobalMode = globalModes.includes(sortType);
        
        // 排序
        list = sortList(list, sortType);
        
        const fragment = document.createDocumentFragment();
        
        if (isGlobalMode) {
            // 全局模式：不分组，直接渲染所有词条
            list.forEach(p => {
                const card = createCardElement(p);
                fragment.appendChild(card);
            });
        } else {
            // 分类内模式：按分类分组，每组内部已排序（且置顶优先）
            let group = {};
            list.forEach(item => (group[item.category] ??= []).push(item));
            for (let c in group) {
                const cateTitle = document.createElement('div');
                cateTitle.className = 'cate-title';
                cateTitle.textContent = `【${c}】`;
                fragment.appendChild(cateTitle);
                group[c].forEach(p => {
                    const card = createCardElement(p);
                    fragment.appendChild(card);
                });
            }
        }
        
        box.appendChild(fragment);
        
        // 更新统计
        const countSpan = document.getElementById('count');
        const pinnedCountSpan = document.getElementById('pinnedCount');
        const collectedCountSpan = document.getElementById('collectedCount');
		if (countSpan) countSpan.innerText = list.length;

		const pinnedTotal = list.filter(p => p.pinned === true).length;
		const collectedTotal = list.filter(p => p.collect === true).length;
		if (pinnedCountSpan) pinnedCountSpan.innerText = pinnedTotal;
		if (collectedCountSpan) collectedCountSpan.innerText = collectedTotal;
        
        bindPromptEvent();
    }

    function renderCollectList() {
        const collected = promptList.filter(p => p.collect === true && p.enable !== false);
        const box = document.getElementById('collectContainer');
        if (!box) return;
        box.innerHTML = collected.length ? '' : '<div class="empty-tip">暂无收藏</div>';
        collected.forEach(p => {
            let tagStr = p.tags.split(',').filter(t=>t).map(t=>`<span class="tag">${escapeHtml(t.trim())}</span>`).join('');
            let dom = document.createElement('div');
            dom.className = 'prompt-item';
            dom.dataset.id = p.id;
            dom.innerHTML = `
        <div class="item-head">
          <div class="title-wrap">
            <span class="title-main">${escapeHtml(p.title)} v${escapeHtml(p.version)} ${p.useCount ? `🔥${p.useCount}` : ''}</span>
          </div>
        </div>
        <div style="margin-top:6px;">
          <div class="item-opt">
            <button class="btn primary insert-btn">📥 填入</button>
            <button class="btn copy-btn">📋 复制</button>
            <button class="btn warning cancel-collect">✖ 取消收藏</button>
            <button class="btn gray edit-btn">✏️ 编辑</button>
            <button class="btn danger del-btn">✖ 删除</button>
          </div>
        </div>
        <div>分类：${escapeHtml(p.category)}${tagStr ? '｜标签：' + tagStr : ''}</div>
        <div style="font-size:11px;color:#999;">创建：${formatDate(p.createDate)}｜修改：${formatDate(p.updateDate)}</div>`;
            dom.addEventListener('mouseenter',e=>showTip(e,p));
            dom.addEventListener('mouseleave',hideTip);
            box.appendChild(dom);
        });
        bindCollectEvent();
    }

    function renderDraftList() {
        const box = document.getElementById('draftContainer');
        if (!box) return;
        box.innerHTML = draftList.length ? '' : '<div class="empty-tip">暂无草稿</div>';
        draftList.forEach(p => {
            let tagStr = p.tags.split(',').filter(t=>t).map(t=>`<span class="tag">${escapeHtml(t.trim())}</span>`).join('');
            let dom = document.createElement('div');
            dom.className = 'prompt-item';
            dom.dataset.id = p.id;
             dom.innerHTML = `
        <div class="item-head">
          <div class="title-wrap">
            <span class="title-main">${escapeHtml(p.title)} v${escapeHtml(p.version)} ${p.useCount ? `🔥${p.useCount}` : ''}</span>
          </div>
        </div>
        <div style="margin-top:6px;">
          <div class="item-opt">
            <button class="btn primary insert-btn">📥 填入</button>
            <button class="btn copy-btn">📋 复制</button>
            <button class="btn warning formal-btn">📌 转为正式</button>
            <button class="btn gray edit-btn">✏️ 编辑</button>
            <button class="btn danger del-btn">✖ 删除</button>
          </div>
        </div>
        <div>分类：${escapeHtml(p.category)}${tagStr ? '｜标签：' + tagStr : ''}</div>
        <div style="font-size:11px;color:#999;">创建：${formatDate(p.createDate)}｜修改：${formatDate(p.updateDate)}</div>`;
            dom.addEventListener('mouseenter',e=>showTip(e,p));
            dom.addEventListener('mouseleave',hideTip);
            box.appendChild(dom);
        });
        bindDraftEvent();
    }

    // ========== 事件绑定（保留原有完整逻辑） ==========
    function bindPromptEvent() {
        document.querySelectorAll('.item-check').forEach(cb => {
            cb.onchange = () => {
                let id = cb.closest('.prompt-item').dataset.id;
                cb.checked ? checkedIds.push(id) : checkedIds = checkedIds.filter(i => i !== id);
            };
        });
        document.querySelectorAll('.pin-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.dataset.id;
                let idx = promptList.findIndex(x => x.id === id);
                if (idx > -1) {
                    promptList[idx].pinned = !promptList[idx].pinned;
                    setStorage('myPromptList', promptList);
                    renderPromptList();
                    addLog('edit', promptList[idx].title, `置顶状态改为${promptList[idx].pinned ? '已置顶' : '取消置顶'}`, 'formal');
                }
            };
        });
        document.querySelectorAll('.insert-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id) || draftList.find(x => x.id === id);
                if (!item) return;
                insertTextToPage(item.content);
                incrementUseCount(id);
                getCurrentSiteDomain(domain => {
                    addLog('use', item.title, `填入到 ${domain || '当前页面'}`, item.isDraft ? 'draft' : (item.collect ? 'collect' : 'formal'), domain);
                });
            };
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id) || draftList.find(x => x.id === id);
                if (item) {
                    navigator.clipboard.writeText(item.content).then(() => alert('复制成功')).catch(err => console.error('复制失败', err));
                    addLog('copy', item.title, '复制内容', item.isDraft ? 'draft' : (item.collect ? 'collect' : 'formal'));
                }
            };
        });
        document.querySelectorAll('.collect-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let idx = promptList.findIndex(x => x.id === id);
                if (idx === -1) return;
                promptList[idx].collect = !promptList[idx].collect;
                setStorage('myPromptList', promptList);
                renderPromptList();
                markDirty('collectList');
                addLog('collect', promptList[idx].title, promptList[idx].collect ? '收藏词条' : '取消收藏', 'formal');
            };
        });
        document.querySelectorAll('.to-draft-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let idx = promptList.findIndex(x => x.id === id);
                if (idx === -1) return;
                draftList.push({ ...promptList[idx], isDraft: true });
                addLog('draft', promptList[idx].title, '正式词条转为草稿', 'formal');
                promptList.splice(idx, 1);
                setStorage('myPromptList', promptList);
                setStorage('myDraftList', draftList);
                renderPromptList();
                markDirty('draftList');
            };
        });
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id) || draftList.find(x => x.id === id);
                if (!item) return;
                editId = id;
                document.getElementById('promptTitle').value = item.title;
                document.getElementById('promptContent').value = item.content;
                document.getElementById('promptCate').value = item.category;
                document.getElementById('promptRemark').value = item.remark || '';
                document.getElementById('promptVer').value = item.version;
                document.getElementById('promptPin').checked = !!item.pinned;
                renderTagSelector(item.tags ? item.tags.split(',') : []);
                updateCharCount();
                document.getElementById('editModal').style.display = 'flex';
            };
        });
        document.querySelectorAll('.del-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id);
                if (item && confirm(`确定要永久删除词条“${item.title}”吗？`)) {
                    addLog('delete', item.title, '删除词条', 'formal');
                    promptList = promptList.filter(x => x.id !== id);
                    draftList = draftList.filter(x => x.id !== id);
                    setStorage('myPromptList', promptList);
                    setStorage('myDraftList', draftList);
                    renderPromptList();
                    markDirty('collectList');
                    markDirty('draftList');
                }
            };
        });
    }

    function bindCollectEvent() {
        document.querySelectorAll('.cancel-collect').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let idx = promptList.findIndex(x => x.id === id);
                if (idx > -1 && promptList[idx].collect) {
                    promptList[idx].collect = false;
                    setStorage('myPromptList', promptList);
                    renderCollectList();
                    markDirty('promptList');
                    addLog('collect', promptList[idx].title, '取消收藏', 'collect');
                }
            };
        });
        document.querySelectorAll('.insert-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id);
                if (item) {
                    insertTextToPage(item.content);
					incrementUseCount(id);
                    getCurrentSiteDomain(domain => {
                        addLog('use', item.title, `填入到 ${domain || '当前页面'}`, 'collect', domain);
                    });
                }
            };
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id);
                if (item) {
                    navigator.clipboard.writeText(item.content).then(() => alert('复制成功')).catch(err => console.error('复制失败', err));
                    addLog('copy', item.title, '复制内容', 'collect');
                }
            };
        });
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id);
                if (!item) return;
                editId = id;
                document.getElementById('promptTitle').value = item.title;
                document.getElementById('promptContent').value = item.content;
                document.getElementById('promptCate').value = item.category;
                document.getElementById('promptRemark').value = item.remark || '';
                document.getElementById('promptVer').value = item.version;
                document.getElementById('promptPin').checked = !!item.pinned;
                renderTagSelector(item.tags ? item.tags.split(',') : []);
                updateCharCount();
                document.getElementById('editModal').style.display = 'flex';
            };
        });
        document.querySelectorAll('.del-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = promptList.find(x => x.id === id);
                if (item && confirm(`确定要永久删除词条“${item.title}”吗？此操作将从所有列表中删除。`)) {
                    addLog('delete', item.title, '彻底删除词条（从收藏夹）', 'collect');
                    promptList = promptList.filter(x => x.id !== id);
                    draftList = draftList.filter(x => x.id !== id);
                    setStorage('myPromptList', promptList);
                    setStorage('myDraftList', draftList);
                    renderCollectList();
                    markDirty('promptList');
                    markDirty('draftList');
                }
            };
        });
    }

    function bindDraftEvent() {
        document.querySelectorAll('.formal-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let idx = draftList.findIndex(x => x.id === id);
                if (idx === -1) return;
                let newItem = { ...draftList[idx], isDraft: false, enable: true };
                addLog('draft', newItem.title, '草稿转为正式词条', 'draft');
                promptList.forEach(p => {
                    if (p.title === newItem.title) {
                        p.enable = false;
                        p.collect = false;
                        p.pinned = false;
                    }
                });
                promptList.push(newItem);
                draftList.splice(idx, 1);
                setStorage('myPromptList', promptList);
                setStorage('myDraftList', draftList);
                renderDraftList();
                markDirty('promptList');
            };
        });
        document.querySelectorAll('.insert-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = draftList.find(x => x.id === id);
                if (item) {
                    insertTextToPage(item.content);
					// 草稿箱词条填入时不累计使用次数，避免半成品草稿干扰高频词条统计
					// incrementUseCount(id);
                    getCurrentSiteDomain(domain => {
                        addLog('use', item.title, `填入到 ${domain || '当前页面'}`, 'draft', domain);
                    });
                }
            };
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = draftList.find(x => x.id === id);
                if (item) {
                    navigator.clipboard.writeText(item.content).then(() => alert('复制成功')).catch(err => console.error('复制失败', err));
                    addLog('copy', item.title, '复制内容', 'draft');
                }
            };
        });
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = draftList.find(x => x.id === id);
                if (!item) return;
                editId = id;
                document.getElementById('promptTitle').value = item.title;
                document.getElementById('promptContent').value = item.content;
                document.getElementById('promptCate').value = item.category;
                document.getElementById('promptRemark').value = item.remark || '';
                document.getElementById('promptVer').value = item.version;
                document.getElementById('promptPin').checked = !!item.pinned;
                renderTagSelector(item.tags ? item.tags.split(',') : []);
                updateCharCount();
                document.getElementById('editModal').style.display = 'flex';
            };
        });
        document.querySelectorAll('.del-btn').forEach(btn => {
            btn.onclick = () => {
                let id = btn.closest('.prompt-item').dataset.id;
                let item = draftList.find(x => x.id === id);
                if (item && confirm(`确定要永久删除草稿“${item.title}”吗？`)) {
                    addLog('delete', item.title, '删除草稿', 'draft');
                    draftList = draftList.filter(x => x.id !== id);
                    setStorage('myDraftList', draftList);
                    renderDraftList();
                    markDirty('promptList');
                }
            };
        });
    }

    // ========== 批量操作 ==========
    const selectAll = document.getElementById('selectAll');
    const batchDel = document.getElementById('batchDel');
    const batchMove = document.getElementById('batchMove');
    if (selectAll) {
        selectAll.onclick = () => {
            let checks = document.querySelectorAll('.item-check');
            let all = Array.from(checks).every(c => c.checked);
            checks.forEach(c => c.checked = !all);
            checkedIds = !all ? Array.from(checks).filter(c => c.checked).map(c => c.closest('.prompt-item').dataset.id) : [];
        };
    }
    if (batchDel) {
        batchDel.onclick = () => {
            if (!checkedIds.length) return alert('请勾选内容');
            let count = checkedIds.length;
            promptList = promptList.filter(x => !checkedIds.includes(x.id));
            draftList = draftList.filter(x => !checkedIds.includes(x.id));
            setStorage('myPromptList', promptList);
            setStorage('myDraftList', draftList);
            renderPromptList();
            markDirty('collectList');
            markDirty('draftList');
            addLog('batch', '', `批量删除，共删除 ${count} 条词条`, 'formal');
        };
    }
    if (batchMove) {
        batchMove.onclick = () => {
            if (!checkedIds.length) return alert('请勾选内容');
            let val = document.getElementById('batchMoveCate').value;
            if (!val) return alert('请先选择目标分类');
            let count = checkedIds.length;
            promptList.forEach(item => {
                if (checkedIds.includes(item.id)) item.category = val;
            });
            setStorage('myPromptList', promptList);
            renderPromptList();
            markDirty('collectList');
            addLog('batch', '', `批量移动分类，移动 ${count} 条词条到“${val}”`, 'formal');
        };
    }

    // ========== 编辑表单字数统计 ==========
    function updateCharCount() {
        const content = document.getElementById('promptContent').value;
        const cnt = document.getElementById('charCount');
        if (cnt) cnt.innerText = content.length;
    }
    const promptContent = document.getElementById('promptContent');
    if (promptContent) promptContent.addEventListener('input', updateCharCount);
    const addPrompt = document.getElementById('addPrompt');
    if (addPrompt) {
        addPrompt.onclick = () => {
            editId = null;
            document.getElementById('promptTitle').value = '';
            document.getElementById('promptContent').value = '';
            document.getElementById('promptRemark').value = '';
            document.getElementById('promptVer').value = '0.1';
            document.getElementById('promptPin').checked = false;
            renderTagSelector([]);
            updateCharCount();
            document.getElementById('editModal').style.display = 'flex';
        };
    }

    // ========== 保存词条 ==========
    function saveItem(isDraft) {
        if (isSaving) return;
        isSaving = true;
        let title = document.getElementById('promptTitle').value.trim();
        let content = document.getElementById('promptContent').value.trim();
        let cate = document.getElementById('promptCate').value;
        let tags = document.getElementById('promptTag').value;
        let remark = document.getElementById('promptRemark').value.trim();
        let ver = document.getElementById('promptVer').value;
        let pinned = document.getElementById('promptPin').checked;
        if (!title || !content) { isSaving = false; return alert('标题和内容不能为空'); }
        let now = new Date().toISOString();

        if (editId) {
            let draftIdx = draftList.findIndex(x => x.id === editId);
            if (draftIdx !== -1 && !isDraft) {
                let old = draftList[draftIdx];
                let newVersion = increaseVersion(old.version);
                let newItem = {
                    id: Date.now().toString(),
                    seriesId: old.seriesId || old.id,  // ← 新增：继承原系列标识
                    title, content, category: cate, tags, remark, version: newVersion,
                    pinned, collect: false, isDraft: false,
                    createDate: old.createDate, updateDate: now, enable: true,
                    useCount: old.useCount || 0, lastUsed: old.lastUsed || null
                };
                promptList.forEach(p => {
                    if (p.title === title) {
                        p.enable = false;
                        p.collect = false;
                        p.pinned = false;
                    }
                });
                promptList.push(newItem);
                draftList.splice(draftIdx, 1);
                addLog('draft', title, `草稿转为正式词条（编辑后保存正式），版本 ${old.version} → ${newVersion}`, 'draft');
                setStorage('myPromptList', promptList);
                setStorage('myDraftList', draftList);
                document.getElementById('editModal').style.display = 'none';
                isSaving = false;
                renderPromptList();
                const currentPage = document.querySelector('.page.show')?.id;
                if (currentPage === 'draftList') {
                    renderDraftList();
                    pageState.draftList.dirty = false;
                } else {
                    markDirty('draftList');
                }
                markDirty('collectList');
                return;
            }

            let arr = isDraft ? draftList : promptList;
            let idx = arr.findIndex(x => x.id === editId);
            if (idx > -1) {
                let old = arr[idx];
                let oldVer = old.version;
                if (isDraft) {
                    arr[idx] = { ...old, title, content, category: cate, tags, remark, version: ver, pinned, isDraft, updateDate: now };
                    addLog('edit', title, `编辑草稿，版本 ${oldVer} → ${ver}`, 'draft');
                } else {
                    old.enable = false;
                    old.collect = false;
                    old.pinned = false;
                    let newVersion = increaseVersion(old.version);
                    let newItem = {
                        id: Date.now().toString(),
                        seriesId: old.seriesId || old.id,  // ← 新增：继承原系列标识
                        title, content, category: cate, tags, remark, version: newVersion,
                        pinned, collect: false, isDraft: false,
                        createDate: old.createDate, updateDate: now, enable: true,
                        useCount: old.useCount || 0, lastUsed: old.lastUsed || null
                    };
                    promptList.push(newItem);
                    document.getElementById('promptVer').value = newVersion;
                    addLog('edit', title, `编辑正式词条，版本 ${oldVer} → ${newVersion}`, 'formal');
                    editId = newItem.id;
                }
            }
        } else {
            let newId = Date.now().toString();
            let newItem = {
                id: newId,
                seriesId: newId,  // ← 新增：新建时生成唯一系列标识
                title, content, category: cate, tags, remark, version: ver,
                pinned, collect: false, isDraft,
                createDate: now, updateDate: now, enable: true,
                useCount: 0, lastUsed: null
            };
            if (isDraft) {
                draftList.push(newItem);
                addLog('add', title, `创建草稿，分类:${cate}`, 'draft');
            } else {
                promptList.forEach(p => {
                    if (p.title === title) {
                        p.enable = false;
                        p.collect = false;
                        p.pinned = false;
                    }
                });
                promptList.push(newItem);
                addLog('add', title, `创建正式词条，分类:${cate}`, 'formal');
                editId = newItem.id;
            }
        }
        setStorage('myPromptList', promptList);
        setStorage('myDraftList', draftList);
        document.getElementById('editModal').style.display = 'none';
        isSaving = false;
        if (isDraft) { renderDraftList(); markDirty('promptList'); }
        else { renderPromptList(); markDirty('collectList'); markDirty('draftList'); }
    }
    const saveEdit = document.getElementById('saveEdit');
    const saveDraft = document.getElementById('saveDraft');
    if (saveEdit) saveEdit.onclick = () => saveItem(false);
    if (saveDraft) saveDraft.onclick = () => saveItem(true);

    // ========== 清空 AI 输入框 ==========
    function clearInput() {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs.length) return;
            const tab = tabs[0];
            if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
                alert('无法在浏览器内部页面清空输入框');
                return;
            }
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const selectors = [
                        '.chat-input-editor[data-lexical-editor="true"]',
                        '[data-testid="chat-input"]',
                        '#chat-input',
                        'textarea.chat-input',
                        'textarea[data-testid="chat_input_input"]',
                        'textarea[id^="chat-textarea"]',
                        'textarea[placeholder*="请输入"]',
                        'textarea',
                        'div[contenteditable="true"]',
                        'div[role="textbox"]'
                    ];
                    let editor = null;
                    for (let s of selectors) {
                        const candidates = document.querySelectorAll(s);
                        for (let el of candidates) {
                            const ph = (el.getAttribute('placeholder') || '').toLowerCase();
                            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                            if (ph.includes('搜索') || ph.includes('search') || aria.includes('搜索')) continue;
                            editor = el;
                            break;
                        }
                        if (editor) break;
                    }
                    if (!editor) return { success: false, error: 'no_editor' };
                    try {
                        editor.focus();
                        const isLexical = editor.hasAttribute('data-lexical-editor') || 
                                          editor.closest('[data-lexical-editor="true"]') !== null;
                        if (editor.isContentEditable && isLexical) {
                            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
                            editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true, bubbles: true }));
                            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
                            editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Delete', bubbles: true }));
                            setTimeout(() => {
                                editor.innerHTML = '';
                                editor.dispatchEvent(new Event('input', { bubbles: true }));
                            }, 10);
                            return { success: true };
                        }
                        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
                            editor.value = '';
                            editor.dispatchEvent(new Event('input', { bubbles: true }));
                            return { success: true };
                        }
                        if (editor.isContentEditable) {
                            editor.innerText = '';
                            editor.dispatchEvent(new Event('input', { bubbles: true }));
                            return { success: true };
                        }
                        return { success: false };
                    } catch (e) {
                        return { success: false, error: e.message };
                    }
                }
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                    alert('清空失败：无法访问页面');
                    return;
                }
                const result = results && results[0] && results[0].result;
                if (result && result.success) {
                    getCurrentSiteDomain(domain => {
                        addLog('clear', '', `清空输入框（${domain || '当前页面'}）`, '', domain);
                    });
                } else {
                    alert('未找到输入框，请确保当前页面是支持的 AI 对话网站（Deepseek/豆包/Kimi）');
                }
            });
        });
    }
    const clearAiInput = document.getElementById('clearAiInput');
    if (clearAiInput) clearAiInput.onclick = clearInput;

    // ========== 导入导出备份 ==========
    const backupModal = document.getElementById('backupModal');
    if (backupModal) {
        document.getElementById('closeBackup').addEventListener('click', () => backupModal.style.display = 'none');
        document.getElementById('exportData').addEventListener('click', () => {
            const data = { promptList, draftList, cateList, tagList, logs: operationLogs, exportTime: new Date().toLocaleString() };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const now = new Date();
            const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
            a.download = `提示词备份_${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
            alert('导出成功');
            addLog('export', '', `导出备份，包含${operationLogs.length}条日志`, 'system');
        });
        document.getElementById('importDataBtn').addEventListener('click', () => {
            const fileInput = document.getElementById('importFile');
            if (!fileInput.files.length) return alert('请先选择一个 JSON 文件');
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data || typeof data !== 'object') throw new Error('文件内容不是有效的对象');

                    if (data.promptList !== undefined) {
                        if (!Array.isArray(data.promptList)) throw new Error('promptList 必须是数组');
                        promptList = data.promptList.map(fixItem);
                        setStorage('myPromptList', promptList);
                    }
                    if (data.draftList !== undefined) {
                        if (!Array.isArray(data.draftList)) throw new Error('draftList 必须是数组');
                        draftList = data.draftList.map(fixItem);
                        setStorage('myDraftList', draftList);
                    }
                    if (data.cateList !== undefined) {
                        if (!Array.isArray(data.cateList)) throw new Error('cateList 必须是数组');
                        cateList = normalizeCateList(data.cateList);
                        setStorage('cateList', cateList);
                        refreshFilterDropdowns();
                    }
                    if (data.tagList !== undefined) {
                        if (!Array.isArray(data.tagList)) throw new Error('tagList 必须是数组');
                        tagList = data.tagList;
                        setStorage('tagList', tagList);
                        refreshFilterDropdowns();
                    }
                    const logMode = document.querySelector('input[name="logImportMode"]:checked').value;
                    if (data.logs && Array.isArray(data.logs)) {
                        if (logMode === 'replace') operationLogs = data.logs;
                        else {
                            const existingIds = new Set(operationLogs.map(l => l.id));
                            const newLogs = data.logs.filter(l => !existingIds.has(l.id));
                            operationLogs.push(...newLogs);
                            operationLogs.sort((a,b) => new Date(b.time) - new Date(a.time));
                        }
                        saveLogs();
                    }
                    Object.keys(pageState).forEach(k => pageState[k].dirty = true);
                    renderPromptList();
                    pageState.promptList.dirty = false;
                    backupModal.style.display = 'none';
                    alert('导入成功');
                    fileInput.value = '';
                    addLog('import', '', `导入备份，日志模式:${logMode === 'replace' ? '替换' : '追加'}`, 'system');
                } catch (err) {
                    alert('导入失败：' + err.message);
                }
            };
            reader.readAsText(file);
        });
    }

    // ========== 底部按钮事件 ==========
    const showBackupBtn = document.getElementById('showBackupBtn');
    if (showBackupBtn && backupModal) {
        showBackupBtn.addEventListener('click', () => {
            backupModal.style.display = 'flex';
            const fileInput = document.getElementById('importFile');
            if (fileInput) fileInput.value = '';
        });
    }
    const showFuncBtn = document.getElementById('showFuncBtn');
    const showVerBtn = document.getElementById('showVerBtn');
    const showVersionHistoryBtn = document.getElementById('showVersionHistoryBtn');
    const showLogBtn = document.getElementById('showLogBtn');
    const clearAllLogsBtn = document.getElementById('clearAllLogsBtn');

    // ========== 动态加载预览数据 ==========
    let previewData = null;
    function loadPreviewData() {
        fetch(chrome.runtime.getURL('preview-data.json'))
            .then(response => response.json())
            .then(data => { previewData = data; })
            .catch(err => { console.warn('加载预览数据失败，使用内置默认值', err); });
    }
    loadPreviewData();

    // ========== 操作日志渲染 ==========
    let currentLogFilter = 'all';
    function renderLogList() {
        const container = document.getElementById('logListContainer');
        if (!container) return;
        let filtered = operationLogs;
        if (currentLogFilter !== 'all') filtered = operationLogs.filter(log => log.type === currentLogFilter);
        const now = new Date();
        const groups = {};
        filtered.forEach(log => {
            const logDate = new Date(log.time);
            const diffDays = Math.floor((now - logDate) / (1000 * 60 * 60 * 24));
            let groupKey;
            if (diffDays <= 7) groupKey = '最近7天';
            else if (diffDays <= 30) groupKey = '8-30天前';
            else groupKey = '30天前';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(log);
        });
        const order = ['最近7天', '8-30天前', '30天前'];
        container.innerHTML = '';
        for (let key of order) {
            if (!groups[key]) continue;
            const groupDiv = document.createElement('div');
            groupDiv.className = 'log-group';
            const isCollapsed = (key !== '最近7天');
            if (isCollapsed) groupDiv.classList.add('log-collapsed');
            groupDiv.innerHTML = `<div class="log-group-title">📅 ${key} (${groups[key].length}条)</div><div class="log-list"></div>`;
            const listDiv = groupDiv.querySelector('.log-list');
            groups[key].forEach(log => {
                let icon = '';
                switch(log.type) {
                    case 'add': icon = '➕'; break;
                    case 'edit': icon = '✏️'; break;
                    case 'delete': icon = '🗑️'; break;
                    case 'collect': icon = '⭐'; break;
                    case 'draft': icon = '📄'; break;
                    case 'batch': icon = '📦'; break;
                    case 'use': icon = '📥'; break;
                    case 'copy': icon = '📋'; break;
                    case 'clear': icon = '🧹'; break;
                    case 'import': icon = '📂'; break;
                    case 'export': icon = '💾'; break;
                    default: icon = '🔹';
                }
                const logItem = document.createElement('div');
                logItem.className = 'log-item';
                logItem.innerHTML = `<span class="log-time">${formatDateTime(log.time)}</span><span class="log-type-icon">${icon}</span><span class="log-detail">${log.title ? `《${escapeHtml(log.title)}》 ` : ''}${escapeHtml(log.detail)}</span>`;
                listDiv.appendChild(logItem);
            });
            groupDiv.querySelector('.log-group-title').onclick = () => { groupDiv.classList.toggle('log-collapsed'); };
            container.appendChild(groupDiv);
        }
        if (filtered.length === 0) container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">暂无操作日志</div>';
        document.querySelectorAll('.log-filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.filter === currentLogFilter) btn.classList.add('active');
        });
    }
    document.querySelectorAll('.log-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentLogFilter = btn.dataset.filter;
            renderLogList();
        });
    });

    // ========== 左侧导航分组折叠初始化 ==========
    function initNavGroups() {
        const groups = document.querySelectorAll('.nav-group');
        let savedState = {};
        try {
            savedState = JSON.parse(localStorage.getItem('navGroupsState') || '{}');
        } catch (e) { savedState = {}; }
        groups.forEach(group => {
            const groupName = group.dataset.group;
            const title = group.querySelector('.group-title');
            const buttonsContainer = group.querySelector('.group-buttons');
            if (savedState[groupName] === 'collapsed') {
                title.classList.add('collapsed');
                buttonsContainer.classList.add('collapsed');
            }
            title.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = title.classList.toggle('collapsed');
                buttonsContainer.classList.toggle('collapsed');
                const state = JSON.parse(localStorage.getItem('navGroupsState') || '{}');
                state[groupName] = isCollapsed ? 'collapsed' : 'expanded';
                localStorage.setItem('navGroupsState', JSON.stringify(state));
            });
        });
    }
    initNavGroups();

    // ========== 按钮悬停预览 ==========
    const previewTip = document.createElement('div');
    previewTip.id = 'previewTip';
    previewTip.style.cssText = `
        position: fixed;
        background: #333;
        color: #fff;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.6;
        max-width: 260px;
        z-index: 10000;
        display: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        pointer-events: none;
    `;
    document.body.appendChild(previewTip);

    let previewTimer = null;
    function showPreview(content, x, y) {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            previewTip.innerHTML = content;
            previewTip.style.display = 'block';
            const rect = previewTip.getBoundingClientRect();
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            let left = x + 15;
            let top = y + 15;
            if (left + rect.width > winWidth) {
                left = x - rect.width - 15;
            }
            if (top + rect.height > winHeight) {
                top = y - rect.height - 15;
            }
            left = Math.max(5, left);
            top = Math.max(5, top);
            previewTip.style.left = left + 'px';
            previewTip.style.top = top + 'px';
        }, 400);
    }
    function hidePreview() {
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        previewTip.style.display = 'none';
    }

    if (showFuncBtn) {
        showFuncBtn.addEventListener('mouseenter', (e) => {
            let content = '<div style="font-weight:bold;margin-bottom:6px;color:#ffd966;">📘 功能说明（简要）</div>加载中...';
            if (previewData && previewData.funcPreview) {
                content = previewData.funcPreview;
            } else if (!previewData) {
                fetch(chrome.runtime.getURL('preview-data.json'))
                    .then(res => res.json())
                    .then(data => {
                        previewData = data;
                        showPreview(data.funcPreview, e.clientX, e.clientY);
                    })
                    .catch(() => {});
                return;
            }
            showPreview(content, e.clientX, e.clientY);
        });
        showFuncBtn.addEventListener('mouseleave', hidePreview);
        showFuncBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
        });
    }

    if (showVerBtn) {
        showVerBtn.addEventListener('mouseenter', (e) => {
            const manifest = chrome.runtime.getManifest();
            const currentVer = manifest && manifest.version ? manifest.version : '1.7';
            let content = `<div style="font-weight:bold;margin-bottom:6px;color:#ffd966;">🔄 版本更新（最新 V${currentVer}）</div>加载中...`;
            if (previewData && previewData.verPreview) {
                content = previewData.verPreview;
            } else if (!previewData) {
                fetch(chrome.runtime.getURL('preview-data.json'))
                    .then(res => res.json())
                    .then(data => {
                        previewData = data;
                        showPreview(data.verPreview, e.clientX, e.clientY);
                    })
                    .catch(() => {});
                return;
            }
            showPreview(content, e.clientX, e.clientY);
        });
        showVerBtn.addEventListener('mouseleave', hidePreview);
        showVerBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('version.html') });
        });
    }

    if (showVersionHistoryBtn) {
        showVersionHistoryBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('version-history.html') });
        });
    }
    if (showLogBtn) {
        showLogBtn.addEventListener('click', () => {
            renderLogList();
            logModal.style.display = 'flex';
        });
    }
    if (clearAllLogsBtn) {
        clearAllLogsBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有操作日志吗？此操作不可恢复。')) {
                operationLogs = [];
                saveLogs();
                renderLogList();
            }
        });
    }

    // ========== 监听刷新消息 ==========
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'refreshPopup') {
            console.log('收到刷新消息，重新加载数据');
            reloadDataFromStorage().then(() => {
                const currentPage = document.querySelector('.page.show')?.id;
                if (currentPage === 'collectList') {
                    renderCollectList();
                    pageState.collectList.dirty = false;
                } else if (currentPage === 'promptList') {
                    renderPromptList();
                    pageState.promptList.dirty = false;
                } else if (currentPage === 'draftList') {
                    renderDraftList();
                    pageState.draftList.dirty = false;
                } else {
                    Object.keys(pageState).forEach(k => pageState[k].dirty = true);
                }
            });
        }
    });

    // ========== 初始化 ==========
    refreshFilterDropdowns();
    reloadDataFromStorage().then(() => {
        renderPromptList();
        // 动态同步 manifest 版本号与日期到底部信息区
        const manifest = chrome.runtime.getManifest();
        const infoVersionEl = document.getElementById('infoVersion');
        const infoDateEl = document.getElementById('infoDate');
        if (infoVersionEl && manifest && manifest.version) {
            infoVersionEl.textContent = 'V' + manifest.version;
        }
        if (infoDateEl) {
            infoDateEl.textContent = APP_META.updateDate;
        }
        pageState.promptList.rendered = true;
        pageState.promptList.dirty = false;
    });
    chrome.storage.local.onChanged.addListener((changes) => {
        if (changes.myPromptList || changes.myDraftList || changes.dataChanged) {
            reloadDataFromStorage().then(() => {
                const currentPage = document.querySelector('.page.show')?.id;
                if (currentPage === 'collectList') {
                    renderCollectList();
                    pageState.collectList.dirty = false;
                } else if (currentPage === 'promptList') {
                    renderPromptList();
                    pageState.promptList.dirty = false;
                } else if (currentPage === 'draftList') {
                    renderDraftList();
                    pageState.draftList.dirty = false;
                } else {
                    Object.keys(pageState).forEach(k => pageState[k].dirty = true);
                }
            });
        }
    });
});