document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const downloadBtn = document.getElementById('download-btn');
  const jsonBtn = document.getElementById('json-btn');
  const statusText = document.getElementById('status-text');
  const progressBar = document.getElementById('progress-bar');
  const container = document.querySelector('.glass-container');
  const communityUrlInput = document.getElementById('community-url');

  let allResults = { posts: [] };

  scrapeBtn.addEventListener('click', async () => {
    const customUrl = communityUrlInput.value.trim();
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    statusText.innerText = "Initializing deep scrape...";
    container.classList.add('loading');
    progressBar.style.width = "5%";
    scrapeBtn.disabled = true;

    try {
      if (customUrl && tab.url !== customUrl) {
        await chrome.tabs.update(tab.id, { url: customUrl });
        statusText.innerText = "Navigating...";
        await new Promise(r => setTimeout(r, 5000));
      }

      const loadExtra = document.getElementById('load-extra').checked;
      if (loadExtra) {
        statusText.innerText = "Auto-scrolling to load maximum posts...";
        progressBar.style.width = "15%";
        await chrome.tabs.sendMessage(tab.id, { action: "auto_scroll", maxScrolls: 5 });
      }

      statusText.innerText = "Processing post listing...";
      const { links } = await chrome.tabs.sendMessage(tab.id, { action: "get_post_links" });
      
      if (!links || links.length === 0) {
        throw new Error("No post links detected on the page. Please ensure you are on a subreddit or profile.");
      }

      statusText.innerText = `Found ${links.length} posts. Fetching full content and comments...`;
      allResults = { posts: [] };
      
      for (let i = 0; i < links.length; i++) {
        let link = links[i];
        if (!link.endsWith('/')) link += '/';
        const jsonUrl = link + '.json';
        
        const progress = 20 + Math.floor((i / links.length) * 75);
        progressBar.style.width = `${progress}%`;
        statusText.innerText = `Deep scraping post ${i + 1}/${links.length}...`;

        try {
          const res = await fetch(jsonUrl).then(r => r.json());
          // Reddit usually returns [ {post_data}, {comments_data} ]
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

          // Recursively parse comments from JSON
          const parseComments = (children, depth = 0, parentId = null) => {
            const comments = [];
            children.forEach(c => {
              if (c.kind !== 't1') return; // Only process actual comments
              const data = c.data;
              const comment = {
                type: depth === 0 ? 'comment' : 'reply',
                author: data.author,
                date: formatDate(data.created_utc),
                content: (data.body || '').replace(/\s+/g, ' ').trim(),
                depth: depth,
                parentId: data.parent_id || parentId, // Use parent_id from data if available, otherwise passed parentId
                id: data.name
              };
              comments.push(comment);
              if (data.replies && data.replies.data && data.replies.data.children) {
                comments.push(...parseComments(data.replies.data.children, depth + 1, data.name));
              }
            });
            return comments;
          };

          post.comments = parseComments(commentsData);
          allResults.posts.push(post);
        } catch (e) {
          console.error(`Failed to deep scrape ${link}:`, e);
        }
        
        await new Promise(r => setTimeout(r, 600)); // Respectful delay
      }

      updateStatus(allResults);

    } catch (err) {
      statusText.innerText = "Error: " + err.message;
      console.error(err);
    } finally {
      scrapeBtn.disabled = false;
      container.classList.remove('loading');
    }
  });

  function updateStatus(results) {
    const postCount = results.posts.length;
    let commentCount = 0;
    results.posts.forEach(p => commentCount += p.comments.length);
    
    statusText.innerText = `Scraped ${postCount} posts and ${commentCount} comments successfully!`;
    progressBar.style.width = "100%";
    downloadBtn.disabled = postCount === 0;
    jsonBtn.disabled = postCount === 0;
  }

  downloadBtn.addEventListener('click', () => {
    if (!allResults.posts.length) return;
    const flat = [];
    allResults.posts.forEach(p => {
      flat.push({
        Type: 'POST', Author: p.author, Date: p.date, Title_or_ID: p.title,
        Content: p.content, Parent_ID: '', Depth: 0, URL: p.url
      });
      p.comments.forEach(c => {
        flat.push({
          Type: c.type.toUpperCase(), Author: c.author, Date: c.date, Title_or_ID: c.id,
          Content: c.content, Parent_ID: c.parentId || '', Depth: c.depth, URL: ''
        });
      });
    });
    downloadFile(jsonToCsv(flat), 'csv');
  });

  jsonBtn.addEventListener('click', () => {
    if (!allResults.posts.length) return;
    downloadFile(JSON.stringify(allResults, null, 2), 'json');
  });

  // Helper function to format Unix timestamp to readable date
  function formatDate(timestamp) {
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
    return date.toLocaleString(); // Adjust to desired format (e.g., 'en-US')
  }

  // Placeholder for jsonToCsv - assuming it's defined elsewhere or will be added
  function jsonToCsv(items) {
    if (!items || items.length === 0) return '';

    const header = Object.keys(items[0]).join(',');
    const rows = items.map(row =>
      Object.values(row)
        .map(value => {
          if (typeof value === 'string') {
            // Escape double quotes and wrap in double quotes if it contains comma or double quote
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(',')
    );
    return [header, ...rows].join('\n');
  }

  function downloadFile(content, ext) {
    const mime = ext === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reddit_full_scrape_${new Date().getTime()}.${ext}`;
    link.click();
    statusText.innerText = `Deep ${ext.toUpperCase()} Exported!`;
  }
});
