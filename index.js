// --- Imports ---
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const express = require('express'); // For the web server
require('dotenv').config();

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000; // Render provides the PORT env var

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID, 10);

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in the .env file.");
  process.exit(1);
}
if (!OWNER_ID || isNaN(OWNER_ID)) {
  console.error("Error: OWNER_ID is not a valid number in the .env file.");
  process.exit(1);
}

// --- Rate Limiting Configuration ---
const UPLOAD_LIMIT = 5;
const TIME_WINDOW_MS = 60 * 60 * 1000;
const userUploads = {};

// --- Bot Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- Helper Functions ---
function isRateLimited(userId) {
  if (userId === OWNER_ID) {
    return { isLimited: false, timeToWaitMin: 0 };
  }
  const now = Date.now();
  const userTimestamps = userUploads[userId] || [];
  const relevantTimestamps = userTimestamps.filter(ts => now - ts < TIME_WINDOW_MS);
  userUploads[userId] = relevantTimestamps;

  if (relevantTimestamps.length >= UPLOAD_LIMIT) {
    const oldestTimestamp = Math.min(...relevantTimestamps);
    const timeToWaitMs = (oldestTimestamp + TIME_WINDOW_MS) - now;
    const timeToWaitMin = Math.ceil(timeToWaitMs / 1000 / 60);
    return { isLimited: true, timeToWaitMin };
  }
  return { isLimited: false, timeToWaitMin: 0 };
}

function recordUpload(userId) {
  if (!userUploads[userId]) {
    userUploads[userId] = [];
  }
  userUploads[userId].push(Date.now());
}

async function uploadToTelegraph(buffer, filename) {
  try {
    const form = new FormData();
    form.append('file', buffer, filename);

    const response = await axios.post('https://telegra.ph/upload', form, {
      headers: { ...form.getHeaders() },
      timeout: 30000,
    });

    if (response.data && response.data[0] && response.data[0].src) {
      return `https://telegra.ph${response.data[0].src}`;
    }
    console.error('Telegra.ph API returned unexpected response:', response.data);
    return null;
  } catch (error) {
    console.error('Error uploading to Telegra.ph.');
    if (error.response) {
      console.error('Data:', error.response.data);
      console.error('Status:', error.response.status);
    } else {
      console.error('Error Message:', error.message);
    }
    return null;
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// --- NEW: Web Server Logic ---
// This tells Express to serve your website files (index.html, style.css)
app.use(express.static(path.join(__dirname)));

// Main route serves your landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the web server
app.listen(PORT, () => {
  console.log(`✅ Web server is live and listening on port ${PORT}`);
});


// --- Bot Event Handlers ---
bot.onText(/\/start/, (msg) => {
  const userName = msg.from.first_name;
  bot.sendMessage(
    msg.chat.id,
    `👋 Hello, ${userName}!\n\n` +
    "I am <b>WHIZ LITE</b>, your personal image uploader.\n\n" +
    "Simply send me any image, and I will upload it to Telegra.ph.",
    { parse_mode: 'HTML' }
  );
});

bot.on('photo', async (msg) => {
  if (msg.chat.type !== 'private') return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const { isLimited, timeToWaitMin } = isRateLimited(userId);
  if (isLimited) {
    bot.sendMessage(chatId, `⚠️ Rate limit reached! Please wait ~${timeToWaitMin}m.`);
    return;
  }

  let processingMessage;
  try {
    processingMessage = await bot.sendMessage(chatId, '🔄 Processing your image...');
    
    const bestQualityPhoto = msg.photo[msg.photo.length - 1];
    const fileId = bestQualityPhoto.file_id;
    const fileDetails = await bot.getFile(fileId);
    const filename = path.basename(fileDetails.file_path);
    
    console.log(`Attempting to upload: ${filename}, Size: ${fileDetails.file_size} bytes`);
    
    const photoStream = bot.getFileStream(fileId);
    const imageBuffer = await streamToBuffer(photoStream);
    const telegraphLink = await uploadToTelegraph(imageBuffer, filename);

    if (telegraphLink) {
      await bot.editMessageText(
        `✅ **Upload Successful!**\n\n🔗 Here is your permanent link:\n${telegraphLink}`, {
          chat_id: chatId, message_id: processingMessage.message_id, parse_mode: 'Markdown'
        }
      );
      recordUpload(userId);
    } else {
      await bot.editMessageText(
        `❌ **Upload Failed.**\n\nFile might be too large (> 5MB) or in an unsupported format.`, {
          chat_id: chatId, message_id: processingMessage.message_id
        }
      );
    }
  } catch (error) {
    console.error(`Error in handle_image for user ${userId}:`, error.message);
    if (processingMessage) {
      await bot.editMessageText('An unexpected error occurred.', {
          chat_id: chatId, message_id: processingMessage.message_id
        }
      );
    }
  }
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, '-', error.message);
});

console.log('🤖 WHIZ LITE bot is starting to poll for updates...');
