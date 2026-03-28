const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

// Extract text content from a page, excluding unwanted sections
const extractTextFromPage = (html, pageUrl) => {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, .ads, .advert, .sidebar, .menu, .navigation, [role="navigation"], .navbar, .footer, .header').remove();

  const texts = [];
  const pageContent = [];

  // Helper function to find the closest link and convert to absolute URL
  const findAssociatedLink = (el) => {
    const $el = $(el);

    // Helper to convert href to absolute URL
    const toAbsolute = (href) => {
      if (!href) return null;
      try {
        return new URL(href, pageUrl).href;
      } catch (e) {
        // If URL constructor fails, return as-is if it looks like a URL
        if (href.startsWith('http')) return href;
        return null;
      }
    };

    // 1. Check if element itself contains a direct <a> (e.g., <p>with <a>link</a></p>)
    const selfLink = $el.find('a').first();
    if (selfLink.length) {
      const href = selfLink.attr('href');
      if (href) return toAbsolute(href);
    }

    // 2. Check if element is wrapped by an <a> tag (ancestor)
    const ancestorLink = $el.closest('a');
    if (ancestorLink.length) {
      const href = ancestorLink.attr('href');
      if (href) return toAbsolute(href);
    }

    // 3. Search among siblings (within the same parent)
    const parent = $el.parent();
    if (parent.length) {
      // Find any <a> within this parent (including deeper descendants)
      const parentLink = parent.find('a').first();
      if (parentLink.length && !parentLink.closest($el).length) {
        const href = parentLink.attr('href');
        if (href) return toAbsolute(href);
      }
    }

    // 4. Check grandparent (to catch links in adjacent columns/sections)
    const grandparent = parent.parent();
    if (grandparent.length) {
      const gpLink = grandparent.find('a').first();
      if (gpLink.length) {
        // Only accept if the link is not too far away (within 2 levels up)
        const href = gpLink.attr('href');
        if (href) return toAbsolute(href);
      }
    }

    return null;
  };

  // Process headings (likely product titles)
  $('h1, h2, h3').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 5) {
      const link = findAssociatedLink(el);
      if (link) {
        pageContent.push(`${text} | Link: ${link}`);
      } else {
        pageContent.push(text);
      }
    }
  });

  // Get paragraphs
  $('p').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 50) {
      const link = findAssociatedLink(el);
      if (link) {
        pageContent.push(`${text} | Link: ${link}`);
      } else {
        pageContent.push(text);
      }
    }
  });

  // Get list items (often product listings)
  $('li').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20) {
      const link = findAssociatedLink(el);
      if (link) {
        pageContent.push(`${text} | Link: ${link}`);
      } else {
        pageContent.push(text);
      }
    }
  });

  // Get table cells (useful for pricing, features)
  $('td, th').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10) {
      const link = findAssociatedLink(el);
      if (link) {
        pageContent.push(`${text} | Link: ${link}`);
      } else {
        pageContent.push(text);
      }
    }
  });

  // Get span content (often contains important info)
  $('span').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 30 && !text.match(/^\$?\d+\.?\d*$/)) {
      const link = findAssociatedLink(el);
      if (link) {
        pageContent.push(`${text} | Link: ${link}`);
      } else {
        pageContent.push(text);
      }
    }
  });

  // Clean and deduplicate
  const cleaned = pageContent
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 0);

  return [...new Set(cleaned)]; // Remove duplicates
};

// Find internal links from the same domain
const findInternalLinks = async (baseUrl, html) => {
  const $ = cheerio.load(html);
  const links = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, baseUrl).href;
      const url = new URL(absoluteUrl);

      // Only include links from the same domain
      if (url.hostname === base.hostname) {
        // Remove hash fragments
        const cleanUrl = absoluteUrl.split('#')[0];
        if (cleanUrl && !cleanUrl.includes('?') && !cleanUrl.includes('.pdf') &&
            !cleanUrl.includes('.jpg') && !cleanUrl.includes('.png') &&
            !cleanUrl.includes('.gif') && !cleanUrl.includes('.zip') &&
            !cleanUrl.includes('.doc') && !cleanUrl.includes('.docx')) {
          links.add(cleanUrl);
        }
      }
    } catch (e) {
      // Skip invalid URLs
    }
  });

  return Array.from(links);
};

// Main scraping function with multi-page support
const scrapeWebsite = async (url, onProgress) => {
  try {
    onProgress?.('Scraping homepage...');

    const response = await axios.get(url, {
      timeout: 15000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const baseUrl = response.config.url || url;
    const allContent = [];
    const pagesToScrape = new Set([baseUrl]);
    const scrapedPages = new Set();
    const importantPaths = ['/about', '/services', '/products', '/contact', '/faq'];

    // First, collect important pages from homepage
    const homeLinks = await findInternalLinks(baseUrl, response.data);
    importantPaths.forEach(path => {
      const fullUrl = new URL(path, baseUrl).href;
      if (homeLinks.includes(fullUrl)) {
        pagesToScrape.add(fullUrl);
      }
    });

    // Add first 15 internal links from homepage
    homeLinks.slice(0, 15).forEach(link => {
      pagesToScrape.add(link);
    });

    const pagesArray = Array.from(pagesToScrape);
    onProgress?.(`Found ${pagesArray.length} pages, scraping...`);

    // Scrape each page
    for (let i = 0; i < pagesArray.length; i++) {
      const pageUrl = pagesArray[i];

      if (scrapedPages.has(pageUrl)) continue;
      scrapedPages.add(pageUrl);

      const path = new URL(pageUrl).pathname;
      onProgress?.(`Scraping${path !== '/' ? ` ${path}` : ' homepage'}... (${i + 1}/${pagesArray.length})`);

      try {
        const pageResponse = await axios.get(pageUrl, {
          timeout: 10000,
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        const pageTexts = extractTextFromPage(pageResponse.data, pageUrl);

        if (pageTexts.length > 0) {
          allContent.push({
            page: path || '/',
            url: pageUrl,
            content: pageTexts,
            chunkCount: pageTexts.length
          });
        }
      } catch (error) {
        console.error(`Failed to scrape ${pageUrl}:`, error.message);
        // Continue with other pages
      }
    }

    onProgress?.('Training AI on your content...');

    // Return content organized by pages
    return {
      totalPages: allContent.length,
      totalChunks: allContent.reduce((sum, page) => sum + page.chunkCount, 0),
      pages: allContent
    };

  } catch (error) {
    throw new Error('Failed to scrape website: ' + error.message);
  }
};

module.exports = { scrapeWebsite };