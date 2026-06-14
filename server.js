const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextFromHTML(html, url) {
  const $ = cheerio.load(html);

  $('script, style, noscript, iframe, object, embed, applet').remove();
  $('nav, header, footer, aside, .nav, .header, .footer, .sidebar, .menu, .navigation').remove();
  $('[class*="ad-"], [class*="ads-"], [class*="advertisement"], [id*="advertisement"]').remove();
  $('[class*="banner"], [class*="popup"], [class*="modal"], [class*="overlay"]').remove();
  $('[class*="social"], [class*="share"], [class*="comment"], [class*="related"]').remove();
  $('[class*="cookie"], [class*="subscribe"], [class*="newsletter"]').remove();
  $('[class*="promo"], [class*="promotion"], [class*="sponsored"]').remove();
  $('figure figcaption, .caption, .image-caption').remove();
  $('[role="navigation"], [role="banner"], [role="complementary"]').remove();

  const paragraphs = [];

  let title = $('h1').first().text().trim();
  if (!title) title = $('title').text().trim();
  if (title) paragraphs.push(title);

  const articleSelectors = [
    'article p',
    '[class*="article-body"] p',
    '[class*="article-content"] p',
    '[class*="story-body"] p',
    '[class*="story-content"] p',
    '[class*="post-content"] p',
    '[class*="entry-content"] p',
    '[class*="content-body"] p',
    '[class*="body-text"] p',
    '.main-content p',
    'main p',
    '.content p',
    '#content p',
    'p'
  ];

  let found = false;
  for (const selector of articleSelectors) {
    const elements = $(selector);
    if (elements.length >= 3) {
      elements.each((i, el) => {
        const text = cleanText($(el).text());
        if (text.length > 50) {
          paragraphs.push(text);
        }
      });
      found = true;
      break;
    }
  }

  if (!found) {
    $('p').each((i, el) => {
      const text = cleanText($(el).text());
      if (text.length > 50) {
        paragraphs.push(text);
      }
    });
  }

  const uniqueParagraphs = [...new Set(paragraphs)];
  return uniqueParagraphs.join('\n\n');
}

app.get('/api/parse', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required',
      message: 'Please provide a URL to parse'
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format',
      message: 'The provided URL is not valid'
    });
  }

  try {
    const userAgent = getRandomUserAgent();

    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Referer': `${parsedUrl.protocol}//${parsedUrl.hostname}/`
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    if (response.status === 403 || response.status === 429 || response.status === 451) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_BLOCKED',
        message: `The website blocked access (HTTP ${response.status}). This site uses anti-bot protection (e.g., Cloudflare). Please copy the text manually.`
      });
    }

    if (response.status >= 400) {
      return res.status(response.status).json({
        success: false,
        error: 'HTTP_ERROR',
        message: `The website returned HTTP ${response.status}. The article may not exist or has been moved.`
      });
    }

    const html = response.data;
    if (typeof html !== 'string' || html.length < 100) {
      return res.status(422).json({
        success: false,
        error: 'EMPTY_RESPONSE',
        message: 'The server returned no readable content.'
      });
    }

    const text = extractTextFromHTML(html, url);

    if (!text || text.length < 100) {
      return res.status(422).json({
        success: false,
        error: 'NO_TEXT_FOUND',
        message: 'Could not extract readable text from this page. The content may be dynamically loaded (JavaScript-rendered) or behind a paywall. Please copy the text manually.'
      });
    }

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return res.json({
      success: true,
      url: url,
      domain: parsedUrl.hostname,
      text: text,
      wordCount: wordCount,
      charCount: text.length,
      extractedAt: new Date().toISOString()
    });

  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return res.status(408).json({
        success: false,
        error: 'TIMEOUT',
        message: 'The request timed out. The website may be slow or blocking automated requests.'
      });
    }

    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(502).json({
        success: false,
        error: 'NETWORK_ERROR',
        message: 'Could not reach the website. Please check the URL and try again.'
      });
    }

    if (err.response && err.response.status === 403) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_BLOCKED',
        message: 'This website blocks automated access. Please copy the article text manually and paste it in the "Clear Text" tab.'
      });
    }

    console.error('Parse error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'PARSE_FAILED',
      message: `Failed to parse the article: ${err.message}`
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'ReadLens Backend' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`\n🎬 ReadLens Cinema Edition — Backend Server`);
  console.log(`📡 Running on: http://localhost:${PORT}`);
  console.log(`🔗 Parse API: http://localhost:${PORT}/api/parse?url=<URL>`);
  console.log(`❤️  Health: http://localhost:${PORT}/api/health\n`);
});
