(function() {
  'use strict';
  
  let panel = null;
  let allPromptList = [];   // 完整列表（含草稿、禁用版本），用于写回 storage
  let promptList = [];      // 过滤后的显示列表（仅启用且非草稿）
  let filteredList = [];    // 用于搜索过滤后的列表
  let currentSortMode = 'usage';  // 'usage' 或 'pinned'
  let displayLimit = 8;     // 当前显示条数限制，初始8，点击更多变为20
  let searchKeyword = '';
  
  // 数据规范化
  function normalize(item) {
    item.tags = item.tags || '';
    item.content = item.content || '';
    item.title = item.title || '';
    item.category = item.category || '';
    item.remark = item.remark || '';
    item.version = item.version || '0.1';
    item.pinned = !!item.pinned;
    item.collect = !!item.collect;
    item.enable = (item.enable !== false);
    item.useCount = item.useCount || 0;
    item.isDraft = !!item.isDraft;
    return item;
  }
  
  // 从 chrome.storage 读取数据
  function loadData() {
    chrome.storage.local.get(['myPromptList'], (result) => {
      let rawList = (result.myPromptList || []).map(normalize);
      allPromptList = rawList;                          // 保留完整数据
      promptList = rawList.filter(item => item.enable !== false && !item.isDraft);
      // 仅当面板已创建时才更新 UI
      if (panel) {
        applyFilterAndSort();
      }
    });
  }
  
  // 根据搜索关键词过滤
  function filterByKeyword(list) {
    if (!searchKeyword.trim()) return list;
    const kw = searchKeyword.toLowerCase();
    return list.filter(item => 
      item.title.toLowerCase().includes(kw) || 
      item.content.toLowerCase().includes(kw)
    );
  }
  
  // 排序
  function sortList(list) {
    if (currentSortMode === 'pinned') {
      // 置顶优先：先按 pinned 降序，再按使用次数降序
      return [...list].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.useCount || 0) - (a.useCount || 0);
      });
    } else {
      // 使用次数优先：按使用次数降序，再按最近使用降序
      return [...list].sort((a, b) => {
        let countA = a.useCount || 0, countB = b.useCount || 0;
        if (countA !== countB) return countB - countA;
        let dateA = a.lastUsed ? new Date(a.lastUsed) : 0;
        let dateB = b.lastUsed ? new Date(b.lastUsed) : 0;
        return dateB - dateA;
      });
    }
  }
  
  // 获取需要显示的词条（收藏+置顶+高频），然后过滤、排序、限制数量
  function getDisplayList() {
    // 1. 收集收藏和置顶（去重）
    let collectOrPinned = promptList.filter(p => p.collect === true);
    promptList.forEach(p => {
      if (p.pinned && !collectOrPinned.find(x => x.id === p.id)) {
        collectOrPinned.push(p);
      }
    });
    // 2. 高频词条（使用次数>=5，且不在上述集合中）
    const HIGH_FREQ_THRESHOLD = 5;
    let highFreq = promptList.filter(p => 
      (p.useCount || 0) >= HIGH_FREQ_THRESHOLD && 
      !collectOrPinned.find(x => x.id === p.id)
    );
    // 3. 合并
    let combined = [...collectOrPinned, ...highFreq];
    // 4. 去重（理论上已去重，但安全起见）
    combined = combined.filter((item, index, self) => self.findIndex(x => x.id === item.id) === index);
    // 5. 搜索过滤
    combined = filterByKeyword(combined);
    // 6. 排序
    combined = sortList(combined);
    // 7. 限制数量
    return combined.slice(0, displayLimit);
  }
  
  // 应用过滤和排序并重新渲染
  function applyFilterAndSort() {
    filteredList = getDisplayList();
    renderPanel();
  }
  
  // 切换排序模式
  function toggleSortMode() {
    currentSortMode = currentSortMode === 'usage' ? 'pinned' : 'usage';
    applyFilterAndSort();
    // 更新开关按钮样式
    updateSortSwitchUI();
  }
  
  // 更新排序开关的 UI
  function updateSortSwitchUI() {
    const switchBtn = panel?.querySelector('#ph-sort-switch');
    if (switchBtn) {
      switchBtn.textContent = currentSortMode === 'usage' ? '次数优先' : '置顶优先';
      switchBtn.style.background = currentSortMode === 'usage' ? '#f0f2f5' : '#ffecb3';
    }
  }
  
  // 加载更多
  function loadMore() {
    displayLimit = 20;
    applyFilterAndSort();
    // 隐藏“查看更多”按钮
    const moreBtn = panel?.querySelector('#ph-more-btn');
    if (moreBtn) moreBtn.style.display = 'none';
  }
  
  // 搜索输入处理
  function onSearchInput(e) {
    searchKeyword = e.target.value.trim();
    displayLimit = 8;  // 搜索时重置显示数量，避免混乱
    const moreBtn = panel?.querySelector('#ph-more-btn');
    if (moreBtn) moreBtn.style.display = 'block'; // 恢复按钮
    applyFilterAndSort();
  }
  
  // 刷新数据（手动或自动）
  function refreshData() {
    loadData();  // 重新加载数据（内部已判断 panel 存在才渲染）
    // 更新状态指示器（仅当面板存在时）
    if (panel) {
      const statusIndicator = panel.querySelector('#ph-status');
      if (statusIndicator) {
        statusIndicator.textContent = '✓ 已更新';
        statusIndicator.style.opacity = '1';
        setTimeout(() => {
          if (statusIndicator) statusIndicator.style.opacity = '0';
        }, 2000);
      }
    }
  }
  
  // 创建/切换浮动面板
  function togglePanel() {
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        // 重置搜索和显示数量
        searchKeyword = '';
        displayLimit = 8;
        currentSortMode = 'usage';
        const searchInput = panel.querySelector('#ph-search');
        if (searchInput) searchInput.value = '';
        loadData();
      }
      return;
    }
    
    panel = document.createElement('div');
    panel.id = 'prompt-helper-panel';
    panel.style.display = 'block';
    panel.innerHTML = `
      <div style="position:fixed;bottom:20px;right:20px;width:320px;max-height:500px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:99999;font-size:13px;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="padding:12px 15px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;background:#f5f7fa;border-radius:10px 10px 0 0;">
          <span style="font-weight:bold;color:#333;">🚀 快捷提示词</span>
          <div>
            <button id="ph-clear" style="border:none;background:none;cursor:pointer;font-size:13px;color:#409eff;margin-right:12px;">🗑️ 清空</button>
            <button id="ph-close" style="border:none;background:none;cursor:pointer;font-size:18px;color:#999;line-height:1;">×</button>
          </div>
        </div>
        <!-- 工具栏：搜索、排序开关、状态 -->
        <div style="padding:8px 10px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #f0f0f0;">
          <input type="text" id="ph-search" placeholder="🔍 搜索标题或内容" style="flex:1;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
          <button id="ph-sort-switch" style="padding:4px 8px;border:none;border-radius:4px;background:#f0f2f5;cursor:pointer;font-size:11px;">次数优先</button>
          <span id="ph-status" style="font-size:10px;color:#67c23a;opacity:0;transition:opacity 0.3s;">✓ 已更新</span>
        </div>
        <div id="ph-content" style="padding:10px;overflow-y:auto;max-height:360px;">
          <div style="text-align:center;color:#999;padding:20px;">加载中...</div>
        </div>
        <div style="padding:8px;border-top:1px solid #eee;text-align:center;display:flex;justify-content:space-between;align-items:center;">
          <button id="ph-more-btn" style="border:none;background:#409eff;color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;">查看更多</button>
          <span style="color:#999;font-size:10px;">按 Ctrl+Shift+L 打开管理器</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    
    // 绑定事件
    panel.querySelector('#ph-close').onclick = () => panel.style.display = 'none';
    panel.querySelector('#ph-clear').onclick = () => clearInput();
    panel.querySelector('#ph-sort-switch').onclick = () => toggleSortMode();
    panel.querySelector('#ph-more-btn').onclick = () => loadMore();
    panel.querySelector('#ph-search').addEventListener('input', onSearchInput);
    
    // 不再在此处注册 storage 监听器（已移至全局）
    
    loadData();
  }
  
  // 清空输入框（原有逻辑保持不变）
  function clearInput() {
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
    if (!editor) {
      alert('未找到输入框，请先在页面点击输入框');
      return;
    }
    try {
      editor.focus();
      const isLexical = editor.hasAttribute('data-lexical-editor') || editor.closest('[data-lexical-editor="true"]');
      if (editor.isContentEditable && isLexical) {
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true, bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Delete', bubbles: true }));
        setTimeout(() => {
          editor.innerHTML = '';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }, 10);
      } else if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        editor.value = '';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (editor.isContentEditable) {
        editor.innerText = '';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      console.error('清空失败', e);
    }
  }
  
  // 渲染面板内容（使用 filteredList）
  function renderPanel() {
    const box = panel.querySelector('#ph-content');
    
    if (filteredList.length === 0) {
      box.innerHTML = `<div style="text-align:center;color:#999;padding:20px;line-height:1.6;">
        暂无符合条件的词条<br>
        <span style="font-size:11px;">在管理器中添加、收藏或多次使用提示词</span>
      </div>`;
      // 控制“查看更多”按钮显示
      const moreBtn = panel.querySelector('#ph-more-btn');
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }
    
    // 判断是否需要显示“查看更多”（当列表长度 >=8 且当前限制为8时显示）
    const moreBtn = panel.querySelector('#ph-more-btn');
    if (moreBtn) {
      if (displayLimit === 8 && filteredList.length >= 8) {
        moreBtn.style.display = 'block';
      } else {
        moreBtn.style.display = 'none';
      }
    }
    
    box.innerHTML = '';
    filteredList.forEach(p => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:8px;margin:4px 0;background:#f7f7f7;border-radius:6px;cursor:pointer;transition:0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.05);border:1px solid #eee;';
      const tagText = p.tags ? p.tags.split(',').slice(0,2).join(' ') : '';
      const useCountText = (p.useCount && p.useCount > 0) ? `📊 使用次数：${p.useCount}` : '';
      
      let sourceText = '';
      if (p.pinned) sourceText = '📍 置顶';
      else if (p.collect) sourceText = '⭐ 收藏';
      else if ((p.useCount || 0) >= 5) sourceText = '🔥 高频';
      
      item.innerHTML = `
        <div style="margin-bottom:6px;">
          <div style="font-weight:500;color:#333;word-break:break-word;">${escapeHtml(p.title)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${useCountText ? `<span style="font-size:10px;background:#e8f4ff;color:#409eff;padding:2px 6px;border-radius:10px;">${escapeHtml(useCountText)}</span>` : ''}
            ${sourceText ? `<span style="font-size:9px;background:#e8e8e8;color:#666;padding:2px 5px;border-radius:10px;">${escapeHtml(sourceText)}</span>` : ''}
          </div>
          <span style="font-size:11px;color:#409eff;background:#ecf5ff;padding:2px 6px;border-radius:3px;flex-shrink:0;">填入</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.content.slice(0,35))}...</div>
        ${tagText ? `<div style="font-size:10px;color:#666;margin-top:3px;">${escapeHtml(tagText)}</div>` : ''}
      `;
      item.onmouseenter = () => item.style.background = '#e0f0ff';
      item.onmouseleave = () => item.style.background = '#f7f7f7';
      item.onclick = () => insertText(p.content, p.id);
      box.appendChild(item);
    });
  }
  
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  // 填入逻辑（无变化）
  function insertText(text, promptId) {
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
    if (!editor) {
      alert('未找到输入框，请先在页面点击输入框');
      return;
    }
    
    try {
      if (editor.hasAttribute('data-lexical-editor')) {
        editor.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const pasteEv = new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true
        });
        editor.dispatchEvent(pasteEv);
      } else if (editor.isContentEditable) {
        editor.innerText = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      panel.style.display = 'none';
      
      if (promptId) {
        const target = allPromptList.find(item => item.id === promptId && !item.isDraft);
        if (target) {
          target.useCount = (target.useCount || 0) + 1;
          target.lastUsed = new Date().toISOString();
          chrome.storage.local.set({
            myPromptList: allPromptList,   // 写回完整列表，避免丢失草稿和禁用版本
            dataChanged: Date.now()
          });
          localStorage.setItem('myPromptList', JSON.stringify(allPromptList));
          chrome.runtime.sendMessage({ action: 'refreshPopup' });
        }
      }
    } catch (e) {
      console.error('填入失败', e);
    }
  }
  
  // ----- 全局存储变化监听器（仅注册一次）-----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.myPromptList || changes.dataChanged)) {
      refreshData();
    }
  });
  
  // 快捷键监听
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === '1') {
      e.preventDefault();
      togglePanel();
    }
    if (e.key === 'Escape' && panel && panel.style.display === 'block') {
      panel.style.display = 'none';
    }
  });
  
})();