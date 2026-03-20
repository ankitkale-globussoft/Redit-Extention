document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const downloadBtn = document.getElementById('download-btn');
  const jsonBtn = document.getElementById('json-btn');
  const closeBtn = document.getElementById('close-panel-btn');
  const statusText = document.getElementById('status-text');
  const progressBar = document.getElementById('progress-bar');
  const container = document.querySelector('.glass-container');
  const urlsInput = document.getElementById('community-urls');
  const resultsContainer = document.getElementById('results-container');
  const tableBody = document.querySelector('#data-table tbody');
  const importBtn = document.getElementById('import-file-btn');
  const fileInput = document.getElementById('file-input');
  const clearBtn = document.getElementById('clear-btn');
  
  const confirmModal = document.getElementById('confirm-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('modal-text');
  const modalCancel = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  let allResults = { posts: [] };
  let isScraping = false;
  let stopRequested = false;
  let batchIdx = 0;
  let postIdx = 0;
  let pendingAction = null; // 'close' or 'clear'

  // Modal Control
  const showModal = (title, text, action) => {
    modalTitle.innerText = title;
    modalText.innerText = text;
    pendingAction = action;
    confirmModal.classList.remove('hidden');
  };

  closeBtn.addEventListener('click', () => showModal("Close Scraper?", "Any active progress and unsaved data will be lost.", 'close'));
  clearBtn.addEventListener('click', () => showModal("Clear All Data?", "This will reset all batch progress and clear the table.", 'clear'));

  modalCancel.addEventListener('click', () => { confirmModal.classList.add('hidden'); pendingAction = null; });
  
  modalConfirm.addEventListener('click', () => {
    if (pendingAction === 'close') window.close();
    if (pendingAction === 'clear') resetAll();
    confirmModal.classList.add('hidden');
  });

  function resetAll() {
    isScraping = false;
    stopRequested = true;
    batchIdx = 0;
    postIdx = 0;
    allResults = { posts: [] };
    tableBody.innerHTML = '';
    resultsContainer.classList.add('hidden');
    urlsInput.value = '';
    progressBar.style.width = "0%";
    statusText.innerText = "Data cleared and reset.";
    updateBtnUI('START');
  }

  // File Import
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const found = ev.target.result.split(/[\n,]+/).map(u => u.trim()).filter(u => u.startsWith('http')).join('\n');
      if (found) {
        urlsInput.value = (urlsInput.value.trim() ? urlsInput.value + '\n' : '') + found;
        statusText.innerText = "URLs imported!";
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  function updateBtnUI(state) {
    const btnText = scrapeBtn.querySelector('.btn-text');
    if (state === 'START') btnText.innerText = "Start Batch Deep Scrape";
    if (state === 'STOP') btnText.innerText = "Stop / Pause Scrape";
    if (state === 'CONTINUE') btnText.innerText = "Continue Scraping";
    if (state === 'STOPPING') btnText.innerText = "Stopping...";
  }

  scrapeBtn.addEventListener('click', async () => {
    if (isScraping) {
      stopRequested = true;
      updateBtnUI('STOPPING');
      return;
    }

    const urls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (!urls.length) { statusText.innerText = "Please enter URLs first."; return; }

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    isScraping = true;
    stopRequested = false;
    updateBtnUI('STOP');
    resultsContainer.classList.remove('hidden');
    container.classList.add('loading');

    try {
      for (; batchIdx < urls.length; batchIdx++) {
        if (stopRequested) break;
        const currentUrl = urls[batchIdx];
        
        if (postIdx === 0) { // Only navigate if we are starting a fresh batch URL
          statusText.innerText = `[${batchIdx + 1}/${urls.length}] Navigating...`;
          if (tab.url !== currentUrl) {
            await chrome.tabs.update(tab.id, { url: currentUrl });
            await new Promise(r => setTimeout(r, 6000));
          }
          const loadExtra = document.getElementById('load-extra').checked;
          if (loadExtra) {
            statusText.innerText = `[${batchIdx + 1}/${urls.length}] Scrolling...`;
            await chrome.tabs.sendMessage(tab.id, { action: "auto_scroll", maxScrolls: 5 });
          }
        }

        const { links } = await chrome.tabs.sendMessage(tab.id, { action: "get_post_links" });
        if (!links || !links.length) { postIdx = 0; continue; }

        for (; postIdx < links.length; postIdx++) {
          if (stopRequested) break;
          let link = links[postIdx];
          const jsonUrl = (link.endsWith('/') ? link : link + '/') + '.json';
          
          const progress = Math.floor(((batchIdx * links.length + postIdx) / (urls.length * links.length)) * 100);
          progressBar.style.width = `${progress}%`;
          statusText.innerText = `[${batchIdx + 1}/${urls.length}] Post ${postIdx + 1}/${links.length}`;

          try {
            const res = await fetch(jsonUrl).then(r => r.json());
            const pData = res[0].data.children[0].data;
            const post = { type: 'post', author: pData.author, title: pData.title, date: formatDate(pData.created_utc), content: pData.selftext || '', url: link, comments: [] };
            renderTableRow('POST', post.author, post.date, post.title);
            
            const parse = (children, depth = 0, pId = null) => {
              const itms = [];
              children.forEach(c => {
                if (c.kind !== 't1') return;
                const d = c.data;
                const comm = { type: depth === 0 ? 'comment' : 'reply', author: d.author, date: formatDate(d.created_utc), content: (d.body || '').replace(/\s+/g, ' ').trim(), depth, parentId: d.parent_id || pId, id: d.name };
                itms.push(comm);
                renderTableRow(comm.type.toUpperCase(), comm.author, comm.date, comm.content);
                if (d.replies && d.replies.data) itms.push(...parse(d.replies.data.children, depth + 1, d.name));
              });
              return itms;
            };
            post.comments = parse(res[1].data.children);
            allResults.posts.push(post);
          } catch (e) { console.error(e); }
          await new Promise(r => setTimeout(r, 600));
        }

        if (!stopRequested) postIdx = 0; // Reset post index if we finished this batch link
      }

      if (!stopRequested) {
        updateStatus(allResults);
        updateBtnUI('START');
        batchIdx = 0; postIdx = 0;
      } else {
        statusText.innerText = "Scraping Paused.";
        updateBtnUI('CONTINUE');
      }

    } catch (err) {
      statusText.innerText = "Error: " + err.message;
    } finally {
      isScraping = false;
      container.classList.remove('loading');
      // Enable export buttons if we have any results (even partials)
      if (allResults.posts.length > 0) {
        downloadBtn.disabled = false;
        jsonBtn.disabled = false;
      }
    }
  });

  function renderTableRow(type, author, date, content) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${type}</td>
      <td>${author}</td>
      <td>${date}</td>
      <td title="${content.replace(/"/g, '&quot;')}">${content}</td>
    `;
    tableBody.appendChild(row);
    // Auto scroll the table wrapper
    const wrapper = document.querySelector('.table-wrapper');
    wrapper.scrollTop = wrapper.scrollHeight;
  }

  function updateStatus(results) {
    let commentCount = 0;
    results.posts.forEach(p => commentCount += p.comments.length);
    statusText.innerText = `Final: Scraped ${results.posts.length} posts and ${commentCount} comments!`;
    progressBar.style.width = "100%";
    downloadBtn.disabled = results.posts.length === 0;
    jsonBtn.disabled = results.posts.length === 0;
  }

  downloadBtn.addEventListener('click', () => {
    if (!allResults.posts.length) return;
    const flat = [];
    allResults.posts.forEach(p => {
      flat.push({ Type: 'POST', Author: p.author, Date: p.date, Title_or_ID: p.title, Content: p.content, Parent_ID: '', Depth: 0, URL: p.url });
      p.comments.forEach(c => { flat.push({ Type: c.type.toUpperCase(), Author: c.author, Date: c.date, Title_or_ID: c.id, Content: c.content, Parent_ID: c.parentId || '', Depth: c.depth, URL: '' }); });
    });
    downloadFile(jsonToCsv(flat), 'csv');
  });

  jsonBtn.addEventListener('click', () => {
    if (!allResults.posts.length) return;
    downloadFile(JSON.stringify(allResults, null, 2), 'json');
  });

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function jsonToCsv(items) {
    if (!items || items.length === 0) return '';
    const header = Object.keys(items[0]).join(',');
    const rows = items.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return [header, ...rows].join('\n');
  }

  function downloadFile(content, ext) {
    const blob = new Blob([content], { type: ext === 'json' ? 'application/json' : 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reddit_batch_${new Date().getTime()}.${ext}`;
    link.click();
    statusText.innerText = `${ext.toUpperCase()} Exported!`;
  }
});
