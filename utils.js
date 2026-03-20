const SELECTORS = {
  post: 'shreddit-post',
  postTitleAttr: 'post-title',
  postAuthorAttr: 'author',
  postCreatedAttr: 'created-timestamp',
  postContent: 'div[slot="text-body"]',
  postLink: 'a[slot="full-post-link"]',
  comment: 'shreddit-comment',
  commentAuthorAttr: 'author',
  commentContent: 'div[slot="comment"]',
  commentChildren: 'div[slot="children"]',
  timeAgo: 'faceplate-timeago'
};

function formatDate(timestamp) {
  if (!timestamp) return '';
  try {
    const date = isNaN(timestamp) ? new Date(timestamp) : new Date(parseInt(timestamp) * 1000);
    return date.toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) { return timestamp; }
}

function scrapePostData(postEl, url = '') {
  if (!postEl) return null;
  // Shreddit stores the full content in 'post-text' attribute to avoid truncation in UI
  let content = postEl.getAttribute('post-text') || '';
  if (!content) {
    content = postEl.querySelector(SELECTORS.postContent)?.innerText || '';
  }
  // Remove "Read more" if it's still there
  content = content.replace(/\s*Read more\s*$/i, '').trim();

  return {
    type: 'post',
    title: postEl.getAttribute(SELECTORS.postTitleAttr) || postEl.querySelector('h1[slot="title"]')?.innerText || '',
    author: postEl.getAttribute(SELECTORS.postAuthorAttr) || 'unknown',
    date: formatDate(postEl.getAttribute(SELECTORS.postCreatedAttr) || postEl.querySelector(SELECTORS.timeAgo)?.getAttribute('ts')),
    content: content,
    url: postEl.querySelector(SELECTORS.postLink)?.href || url || window.location.href
  };
}

function scrapeCommentsRecursive(commentEl, depth = 0, parentId = null) {
  const data = [];
  const author = commentEl.getAttribute(SELECTORS.commentAuthorAttr) || 'unknown';
  const rawDate = commentEl.querySelector(SELECTORS.timeAgo)?.getAttribute('ts') || '';
  const content = commentEl.querySelector(SELECTORS.commentContent)?.innerText || '';
  const commentId = commentEl.getAttribute('thingid') || Math.random().toString(36).substr(2, 9);

  data.push({
    type: depth === 0 ? 'comment' : 'reply',
    author: author,
    date: formatDate(rawDate),
    content: content.replace(/\s+/g, ' ').trim(),
    depth: depth,
    parentId: parentId,
    id: commentId
  });

  const childrenContainer = commentEl.querySelector(SELECTORS.commentChildren);
  if (childrenContainer) {
    const childComments = childrenContainer.querySelectorAll(`:scope > ${SELECTORS.comment}`);
    childComments.forEach(child => {
      data.push(...scrapeCommentsRecursive(child, depth + 1, commentId));
    });
  }
  return data;
}

function jsonToCsv(data) {
  if (!data || !data.length) return '';
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  for (const row of data) {
    const values = headers.map(header => {
      let val = row[header] === null || row[header] === undefined ? '' : row[header];
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        val = `"${val}"`;
      }
      return val;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

// Export for usage in other scripts
if (typeof module !== 'undefined') {
  module.exports = { SELECTORS, formatDate, scrapePostData, scrapeCommentsRecursive, jsonToCsv };
}
