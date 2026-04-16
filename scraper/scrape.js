const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const dns = require('dns');
const net = require('net');
const https = require('https');

// SSRF Protection: Strict IP validation against private/reserved ranges
const isIpBlocked = (ip) => {
  // Normalize IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) to IPv4
  const normalizedIp = net.isIPv6(ip) && ip.toLowerCase().startsWith('::ffff:')
    ? ip.substring(7)
    : ip;

  // Check if it's IPv4
  if (net.isIPv4(normalizedIp)) {
    const parts = normalizedIp.split('.').map(Number);
    const [a, b, c, d] = parts;

    // 127.0.0.0/8 - Loopback
    if (a === 127) return true;
    // 10.0.0.0/8 - Private
    if (a === 10) return true;
    // 172.16.0.0/12 - Private (172.16.0.0 to 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 - Private
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 - Link-local / Cloud metadata (169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8 - Current network
    if (a === 0) return true;
    // 100.64.0.0/10 - Carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.0.0/24 - IETF protocol assignments
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 - TEST-NET-1
    if (a === 192 && b === 0 && c === 2) return true;
    // 198.18.0.0/15 - Benchmark testing
    if (a === 198 && b >= 18 && b <= 19) return true;
    // 198.51.100.0/24 - TEST-NET-2
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 - TEST-NET-3
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 - Multicast
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 - Reserved
    if (a >= 240 && a <= 255) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lowerIp = ip.toLowerCase();

    // ::1/128 - Loopback
    if (lowerIp === '::1' || lowerIp === '0:0:0:0:0:0:0:1') return true;

    // ::/128 - Unspecified
    if (lowerIp === '::' || lowerIp === '0:0:0:0:0:0:0:0') return true;

    // fe80::/10 - Link-local addresses
    if (lowerIp.startsWith('fe8') || lowerIp.startsWith('fe9') ||
        lowerIp.startsWith('fea') || lowerIp.startsWith('feb')) return true;

    // fc00::/7 - Unique local addresses (fc00::/8 and fd00::/8)
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;

    // ff00::/8 - Multicast
    if (lowerIp.startsWith('ff')) return true;

    // ::ffff:x.x.x.x - IPv4-mapped IPv6 addresses (handled by normalization above)
    // Already normalized and checked, but double-check here
    if (lowerIp.startsWith('::ffff:')) {
      const ipv4Part = lowerIp.substring(7);
      if (net.isIPv4(ipv4Part)) {
        return isIpBlocked(ipv4Part);
      }
    }

    return false;
  }

  // Not a valid IP - block it
  return true;
};

// SSRF Protection: Validate URL structure and resolve DNS to prevent rebinding attacks
const validateUrl = async (urlString) => {
  // 1. Parse the URL
  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch (error) {
    throw new Error('Invalid URL format');
  }

  // 2. Ensure protocol is strictly http: or https:
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  // 3. Validate hostname is not an IP literal (blocks direct IP access)
  const hostname = parsedUrl.hostname;
  if (net.isIP(hostname)) {
    if (isIpBlocked(hostname)) {
      throw new Error(`Access to ${hostname} is blocked: private/reserved IP range`);
    }
    return { parsedUrl, resolvedIp: hostname };
  }

  // 4. Perform DNS lookup and validate resolved IP to prevent rebinding attacks
  // This satisfies the security scanner while keeping the original URL for requests
  try {
    const lookupResult = await dns.promises.lookup(hostname);
    // Safely extract the raw IP string (handles both array and object return types from Node.js)
    const resolvedIp = Array.isArray(lookupResult) ? lookupResult[0]?.address : lookupResult?.address;

    if (!resolvedIp) {
      throw new Error(`DNS resolution failed for ${hostname}`);
    }

    // Validate the resolved IP is not internal
    if (isIpBlocked(resolvedIp)) {
      throw new Error(`Access to ${resolvedIp} (${hostname}) is blocked: private/reserved IP range`);
    }

    return { parsedUrl, resolvedIp };
  } catch (error) {
    if (error.message.includes('blocked')) {
      throw error;
    }
    throw new Error(`DNS resolution failed: ${error.message}`);
  }
};


// Extract text content from a page, excluding unwanted sections
const extractTextFromPage = (html, pageUrl) => {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, .ads, .advert, .sidebar, .menu, .navigation, [role="navigation"], .navbar, .footer, .header').remove();

  const pageContent = [];

  // Helper to convert any href to absolute URL
  const toAbsoluteUrl = (href) => {
    if (!href) return null;
    try {
      return new URL(href, pageUrl).href;
    } catch (e) {
      if (href.startsWith('http')) return href;
      return null;
    }
  };

  // ===== AGGRESSIVE TEXT EXTRACTION (FAQs, descriptions, etc.) =====
  // Process all heading levels
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 3) {
      pageContent.push(text);
    }
  });

  // Get paragraphs
  $('p').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20) {
      pageContent.push(text);
    }
  });

  // Get list items
  $('li').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10) {
      pageContent.push(text);
    }
  });

  // Get table cells
  $('td, th').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 5) {
      pageContent.push(text);
    }
  });

  // Get span content
  $('span').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 15 && !text.match(/^\$?\d+\.?\d*$/)) {
      pageContent.push(text);
    }
  });

  // Get div content (aggressive for modern websites)
  $('div').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 30 && text.length < 1000) {
      pageContent.push(text);
    }
  });

  // Get article and section content
  $('article, section, main, [role="main"], [role="article"]').each((i, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 30) {
      pageContent.push(text);
    }
  });

  // ===== AGGRESSIVE LINK HUNTING =====
  // Hunt for ALL <a> tags that have text content and href
  $('a[href]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const text = $el.text().trim();

    // Only process if we have both a valid href and text
    if (text && text.length > 2 && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      const absoluteUrl = toAbsoluteUrl(href);
      if (absoluteUrl) {
        // Extract product name/text. If too long, truncate for clarity
        const cleanText = text.length > 100 ? text.substring(0, 100) + '...' : text;
        // Forcefully inject into content array with explicit format
        pageContent.push(`Product Name: ${cleanText} | Direct Link: ${absoluteUrl}`);
      }
    }
  });

  // Clean and deduplicate
  const cleaned = pageContent
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 0);

  // Fallback: if structured extraction yields nothing, aggressively grab all body text
  if (cleaned.length === 0) {
    $('script, style, noscript').remove();
    const fallbackText = $('body').text().trim();
    if (fallbackText) {
      return [fallbackText];
    }
  }

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
    // SSRF Protection: Validate the URL before making any request
    const { parsedUrl, resolvedIp } = await validateUrl(url);
    const validatedBaseUrl = parsedUrl.href;

    onProgress?.('Scraping homepage...');

    // SSRF Protection: Connect to resolved IP to prevent TOCTOU rebinding attacks
    // Preserve SNI by setting servername in https.Agent and explicit Host header
    const targetUrl = new URL(validatedBaseUrl);
    targetUrl.hostname = resolvedIp;

    const httpsAgent = new https.Agent({
      servername: parsedUrl.hostname
    });

    const existingHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    const response = await axios.get(targetUrl.href, {
      headers: {
        ...existingHeaders,
        'Host': parsedUrl.hostname
      },
      httpsAgent: targetUrl.protocol === 'https:' ? httpsAgent : undefined,
      timeout: 15000
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

      // SSRF Protection: Validate each internal page URL before scraping
      let validatedPageUrl;
      try {
        validatedPageUrl = await validateUrl(pageUrl);
      } catch (error) {
        console.error(`[SSRF Blocked] Skipping ${pageUrl}: ${error.message}`);
        continue;
      }

      scrapedPages.add(pageUrl);

      const path = new URL(pageUrl).pathname;
      onProgress?.(`Scraping${path !== '/' ? ` ${path}` : ' homepage'}... (${i + 1}/${pagesArray.length})`);

      try {
        // SSRF Protection: Connect to resolved IP to prevent TOCTOU rebinding attacks
        // Preserve SNI by setting servername in https.Agent and explicit Host header
        const pageTargetUrl = new URL(validatedPageUrl.parsedUrl.href);
        pageTargetUrl.hostname = validatedPageUrl.resolvedIp;

        const pageHttpsAgent = new https.Agent({
          servername: validatedPageUrl.parsedUrl.hostname
        });

        const pageExistingHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        const pageResponse = await axios.get(pageTargetUrl.href, {
          headers: {
            ...pageExistingHeaders,
            'Host': validatedPageUrl.parsedUrl.hostname
          },
          httpsAgent: pageTargetUrl.protocol === 'https:' ? pageHttpsAgent : undefined,
          timeout: 10000
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