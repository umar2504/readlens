const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Подключение к MongoDB Atlas через переменную окружения
const MONGO_URI = process.env.MONGO_URI;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
} else {
  console.log('⚠️ MONGO_URI is not defined. Database features will not work.');
}

// Создаем модель (схему) для карточки в базе данных
const CardSchema = new mongoose.Schema({
  word: { type: String, required: true },
  translation: { type: String, required: true },
  context: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const Card = mongoose.model('Card', CardSchema);

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// --- API МАРШРУТЫ ---

// 1. Проверка работоспособности (Health Check)
app.get('/api/health', (req, res) => {
  res.json({ status: "ok", version: "1.1.0", service: "ReadLens Full-Stack Backend" });
});

// 2. Старый добрый парсер статей
app.get('/api/parse', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ success: false, error: 'MISSING_URL' });

  try {
    const response = await axios.get(targetUrl, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10000
    });
    const $ = cheerio.load(response.data);

    $('script, style, nav, footer, header, ads').remove();
    let text = $('article').text() || $('main').text() || $('body').text();
    text = cleanText(text);

    res.json({
      success: true,
      text: text.substring(0, 50000),
      wordCount: text.split(/\s+/).length,
      domain: new URL(targetUrl).hostname
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'EXTRACTION_FAILED', message: error.message });
  }
});

// 3. Получение всех карточек из базы данных
app.get('/api/cards', async (req, res) => {
  try {
    const cards = await Card.find().sort({ createdAt: -1 });
    res.json({ success: true, cards });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Сохранение новой карточки в базу данных
app.post('/api/cards', async (req, res) => {
  try {
    const { word, translation, context } = req.body;
    if (!word || !translation) {
      return res.status(400).json({ success: false, error: 'Word and translation are required' });
    }
    const newCard = new Card({ word, translation, context });
    await newCard.save();
    res.json({ success: true, card: newCard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`📡 Server running on port ${PORT}`);
});