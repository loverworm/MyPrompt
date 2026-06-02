(function() {
  'use strict';

  function loadData() {
    try {
      return {
        promptList: JSON.parse(localStorage.getItem('myPromptList')) || []
      };
    } catch (e) {
      console.warn('加载本地数据失败', e);
      return { promptList: [] };
    }
  }

  function saveData(promptList) {
    localStorage.setItem('myPromptList', JSON.stringify(promptList));
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        myPromptList: promptList,
        dataChanged: Date.now()
      });
    }
  }

  function compareVersionDesc(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const av = pa[i] || 0, bv = pb[i] || 0;
      if (av !== bv) return bv - av;
    }
    return 0;
  }

  // 按 seriesId 分组（替代按 title 分组），兼容旧数据无 seriesId 的情况
  function groupBySeries(items) {
    const groups = new Map();
    items.forEach(item => {
      const key = item.seriesId || item.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    for (let [, versions] of groups) {
      versions.sort((a, b) => compareVersionDesc(a.version, b.version));
    }
    return groups;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  function formatDate(str) {
    if (!str) return '未知日期';
    try {
        const d = new Date(str);
        if (isNaN(d)) return str;
        
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const datePart = `${year}年${month}月${day}日`;
        
        const isLegacyDate = !str.includes('T') && !str.includes(':') && str.length < 20;
        if (isLegacyDate) return datePart;
        
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        const second = String(d.getSeconds()).padStart(2, '0');
        return `${datePart} ${hour}:${minute}:${second}`;
    } catch (e) {
        return str;
    }
  }

  function renderHistory() {
    const { promptList } = loadData();
    const groups = groupBySeries(promptList);
    const container = document.getElementById('historyContainer');

    if (groups.size === 0) {
      container.innerHTML = '<div class="empty-tip">暂无提示词数据，请先在管理器中创建提示词。</div>';
      return;
    }

    let totalVersions = 0;
    let activeVersions = 0;
    for (let [, versions] of groups) {
      totalVersions += versions.length;
      activeVersions += versions.filter(v => v.enable !== false).length;
    }
    const inactiveVersions = totalVersions - activeVersions;

    const summaryHtml = `
      <div class="version-summary" style="background:#f0f7ff; border-radius:12px; padding:10px 16px; margin-bottom:20px; display:flex; gap:24px; font-size:13px; align-items:center; flex-wrap:wrap;">
        <div>📊 总计版本：<strong>${totalVersions}</strong></div>
        <div style="color:#10b981;">✅ 有效版本：<strong>${activeVersions}</strong></div>
        <div style="color:#f97316;">⏸️ 失效版本：<strong>${inactiveVersions}</strong></div>
        <div style="font-size:12px; color:#5b6e8c;">（有效版本即“当前使用”版本，失效版本可恢复）</div>
      </div>
    `;

    let html = summaryHtml;

    for (let [seriesId, versions] of groups) {
      // 组标题取当前生效版本的标题；若全部禁用，则取最新版本标题
      const current = versions.find(v => v.enable !== false);
      const displayTitle = current ? current.title : versions[0].title;

      html += `
        <div class="prompt-group">
          <div class="group-header">
            <h2>📜 ${escapeHtml(displayTitle)}</h2>
            <span class="version-badge">${versions.length} 个版本</span>
          </div>
          <div class="timeline">
      `;

      versions.forEach(ver => {
        const isCurrent = ver.enable !== false;
        const dateStr = formatDate(ver.updateDate || ver.createDate);
        const remark = ver.remark ? `💬 备注：${escapeHtml(ver.remark)}` : '';
        const catTag = `📁 ${escapeHtml(ver.category || '未分类')}${ver.tags ? '｜🏷 ' + escapeHtml(ver.tags) : ''}`;

        html += `
          <div class="version-card ${isCurrent ? 'current' : ''}" data-id="${ver.id}">
            <div class="card">
              <div class="card-header">
                <span class="version-num">v${escapeHtml(ver.version)}</span>
                <span class="version-date">${escapeHtml(dateStr)}</span>
                ${isCurrent ? '<span class="version-badge-current">当前使用</span>' : ''}
              </div>
              <div class="card-meta">${escapeHtml(catTag)}</div>
              <div class="card-content" onclick="this.classList.toggle('expanded')">
                ${escapeHtml(ver.content)}
              </div>
              ${remark ? `<div class="card-remark">${remark}</div>` : ''}
              <div class="card-actions">
                ${!isCurrent ? `<button class="btn btn-primary restore-btn" data-id="${ver.id}">↻ 恢复为此版本</button>` : ''}
                <button class="btn btn-danger delete-version-btn" data-id="${ver.id}">🗑 删除版本</button>
              </div>
            </div>
          </div>
        `;
      });

      html += `</div></div>`;
    }

    container.innerHTML = html;

    document.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreVersion(btn.dataset.id));
    });

    document.querySelectorAll('.delete-version-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('确定要永久删除这个版本吗？不可恢复。')) {
          deleteVersion(btn.dataset.id);
        }
      });
    });
  }

  function restoreVersion(id) {
    let { promptList } = loadData();
    const target = promptList.find(p => p.id === id);
    if (!target) return;

    // 按 seriesId 匹配该系列所有版本（兼容旧数据用 id 兜底）
    const seriesId = target.seriesId || target.id;
    promptList.forEach(p => {
      if ((p.seriesId || p.id) === seriesId) {
        p.enable = false;
        p.collect = false;
        p.pinned = false;
      }
    });
    // 然后仅将目标版本启用
    target.enable = true;

    saveData(promptList);
    renderHistory();
    alert(`已恢复版本 v${target.version} 为当前使用版本`);
  }

  function deleteVersion(id) {
    let { promptList } = loadData();
    const target = promptList.find(p => p.id === id);
    if (!target) return;

    const seriesId = target.seriesId || target.id;
    const sameSeries = promptList.filter(p => (p.seriesId || p.id) === seriesId);
    if (sameSeries.length === 1) {
      if (!confirm('这是该提示词的唯一版本，删除后该提示词将彻底消失。确定删除？')) return;
    }

    const newList = promptList.filter(p => p.id !== id);

    if (target.enable !== false && sameSeries.length > 1) {
      const remaining = newList.filter(p => (p.seriesId || p.id) === seriesId);
      remaining.sort((a, b) => compareVersionDesc(a.version, b.version));
      if (remaining.length > 0) {
        remaining[0].enable = true;
        remaining[0].collect = false;
        remaining[0].pinned = false;
      }
    }

    saveData(newList);
    renderHistory();
  }

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    window.open('', '_self').close();
  });

  renderHistory();
})();