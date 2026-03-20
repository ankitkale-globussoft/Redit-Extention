(function() {
  async function autoScroll(maxScrolls = 5) {
    let scrollCount = 0;
    while (scrollCount < maxScrolls) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 2000)); // Wait for content
      scrollCount++;
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "auto_scroll") {
      autoScroll(request.maxScrolls || 5).then(() => {
        sendResponse({ success: true });
      });
      return true;
    } else if (request.action === "get_post_links") {
      const links = Array.from(document.querySelectorAll(SELECTORS.post))
        .map(p => p.querySelector(SELECTORS.postLink)?.href)
        .filter(l => !!l);
      sendResponse({ success: true, links: links });
    } else if (request.action === "scrape") {
      try {
        const posts = document.querySelectorAll(SELECTORS.post);
        const scrapedPosts = [];
        posts.forEach(p => {
          const pData = scrapePostData(p);
          if (pData) scrapedPosts.push(pData);
        });

        const topLevelComments = Array.from(document.querySelectorAll(SELECTORS.comment)).filter(c => {
          return !c.parentElement.closest(SELECTORS.commentChildren);
        });

        let allCommentsData = [];
        topLevelComments.forEach(c => {
          allCommentsData.push(...scrapeCommentsRecursive(c));
        });

        sendResponse({ success: true, posts: scrapedPosts, comments: allCommentsData });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
    return true;
  });
})();
