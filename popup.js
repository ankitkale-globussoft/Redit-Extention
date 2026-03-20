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
  const confirmModal = document.getElementById('confirm-modal');
  const modalCancel = document.getElementById('modal-cancel');
  const modalConfirm = document.getElementById('modal-confirm');

  let allResults = { posts: [] };

  // Custom Modal Logic
  closeBtn.addEventListener('click', () => {
    confirmModal.classList.remove('hidden');
  });

  modalCancel.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
  });

  modalConfirm.addEventListener('click', () => {
    window.close();
  });

  // File Import Logic
  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      // Split by newline or comma
      const foundUrls = content.split(/[\n,]+/)
        .map(u => u.trim())
        .filter(u => u.startsWith('http'))
        .join('\n');
      
      if (foundUrls) {
        urlsInput.value = (urlsInput.value.trim() ? urlsInput.value + '\n' : '') + foundUrls;
        statusText.innerText = "URLs imported from file!";
      } else {
        statusText.innerText = "No valid URLs found in file.";
      }
    };
    reader.readAsText(file);
    fileInput.value = ''; // Reset for next import
  });

  scrapeBtn.addEventListener('click', async () => {
    const urls = urlsInput.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (urls.length === 0) {
      statusText.innerText = "Please enter at least one Reddit URL.";
      return;
    }

    statusText.innerText = "Starting batch process...";
    container.classList.add('loading');
    progressBar.style.width = "5%";
    scrapeBtn.disabled = true;
    resultsContainer.classList.remove('hidden');
    tableBody.innerHTML = ''; // Clear previous table data
    allResults = { posts: [] };

    try {
      for (let batchIndex = 0; batchIndex < urls.length; batchIndex++) {
        const currentBatchUrl = urls[batchIndex];
        statusText.innerText = `[${batchIndex + 1}/${urls.length}] Navigating to ${currentBatchUrl}...`;
        
        // Navigate or ensure we are on the right page for link collection
        if (tab.url !== currentBatchUrl) {
          await chrome.tabs.update(tab.id, { url: currentBatchUrl });
          await new Promise(r => setTimeout(r, 6000)); // Wait for page load
        }

        const loadExtra = document.getElementById('load-extra').checked;
        if (loadExtra) {
          statusText.innerText = `[${batchIndex + 1}/${urls.length}] Auto-scrolling...`;
          await chrome.tabs.sendMessage(tab.id, { action: "auto_scroll", maxScrolls: 5 });
        }

        const { links } = await chrome.tabs.sendMessage(tab.id, { action: "get_post_links" });
        if (!links || links.length === 0) continue;

        for (let i = 0; i < links.length; i++) {
          let link = links[i];
          if (!link.endsWith('/')) link += '/';
          const jsonUrl = link + '.json';
          
          const overallProgress = 5 + Math.floor(((batchIndex * links.length + i) / (urls.length * links.length)) * 95);
          progressBar.style.width = `${overallProgress}%`;
          statusText.innerText = `[${batchIndex + 1}/${urls.length}] Scraping post ${i + 1}/${links.length}...`;

          try {
            const res = await fetch(jsonUrl).then(r => r.json());
            const postData = res[0].data.children[0].data;
            const commentsData = res[1].data.children;

            const post = {
              type: 'post',
              title: postData.title,
              author: postData.author,
              date: formatDate(postData.created_utc),
              content: postData.selftext || '',
              url: link,
              comments: []
            };

            renderTableRow('POST', post.author, post.date, post.title);

            const parseComments = (children, depth = 0, parentId = null) => {
              const items = [];
              children.forEach(c => {
                if (c.kind !== 't1') return;
                const d = c.data;
                const comment = {
                  type: depth === 0 ? 'comment' : 'reply',
                  author: d.author,
                  date: formatDate(d.created_utc),
                  content: (d.body || '').replace(/\s+/g, ' ').trim(),
                  depth: depth,
                  parentId: d.parent_id || parentId,
                  id: d.name
                };
                items.push(comment);
                renderTableRow(comment.type.toUpperCase(), comment.author, comment.date, comment.content);
                if (d.replies && d.replies.data && d.replies.data.children) {
                  items.push(...parseComments(d.replies.data.children, depth + 1, d.name));
                }
              });
              return items;
            };

            post.comments = parseComments(commentsData);
            allResults.posts.push(post);
          } catch (e) { console.error(e); }
          await new Promise(r => setTimeout(r, 600));
        }
      }
      updateStatus(allResults);
    } catch (err) {
      statusText.innerText = "Error: " + err.message;
    } finally {
      scrapeBtn.disabled = false;
      container.classList.remove('loading');
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
