// --- Imports ---
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config(); // Load environment variables from .env file

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID, 10);

// Validate configuration
if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set in the .env file.");
  process.exit(1);
}
if (!OWNER_ID || isNaN(OWNER_ID)) {
  console.error("Error: OWNER_ID is not a valid number in the .env file.");
  process.exit(1);
}

// --- Rate Limiting Configuration ---
const UPLOAD_LIMIT = 5; // Max 5 images per user
const TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds

// In-memory storage for tracking user uploads.
// Format: { userId: [timestamp1, timestamp2, ...] }
const userUploads = {};

// --- Bot Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('WHIZ LITE bot is starting...');

// --- Helper Functions ---

/**
 * Checks if a user has exceeded the upload limit. Cleans up old timestamps.
 * @param {number} userId The Telegram user ID.
 * @returns {{isLimited: boolean, timeToWaitMin: number}}
 */
function isRateLimited(userId) {
  if (userId === OWNER_ID) {
    return { isLimited: false, timeToWaitMin: 0 }; // Owner is never limited
  }

  const now = Date.now();
  const userTimestamps = userUploads[userId] || [];

  // Filter out timestamps older than the time window
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

/**
 * Records a new upload timestamp for a user.
 * @param {number} userId The Telegram user ID.
 */
function recordUpload(userId) {
  if (!userUploads[userId]) {
    userUploads[userId] = [];
  }
  userUploads[userId].push(Date.now());
}

/**
 * Uploads an image buffer to Telegra.ph.
 * @param {Buffer} buffer The image data as a Buffer.
 * @returns {Promise<string|null>} The permanent URL or null if failed.
 */
async function uploadToTelegraph(buffer) {
  try {
    const form = new FormData();
    form.append('file', buffer, 'image.jpg');

    const response = await axios.post('https://telegra.ph/upload', form, {
      headers: { ...form.getHeaders() },
      timeout: 30000, // 30-second timeout
    });

    if (response.data && response.data[0] && response.data[0].src) {
      return `https://telegra.ph${response.data[0].src}`;
    } else {
      console.error('Telegra.ph API returned unexpected response:', response.data);
      return null;
    }
  } catch (error) {
    console.error('Error uploading to Telegra.ph:', error.message);
    return null;
  }
}

/**
 * Converts a readable stream into a Buffer.
 * @param {ReadableStream} stream The input stream.
 * @returns {Promise<Buffer>} A Buffer containing the stream data.
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// --- Bot Event Handlers ---

// Handler for the /start command
bot.onText(/\/start/, (msg) => {
  const userName = msg.from.first_name;
  bot.sendMessage(
    msg.chat.id,
    `👋 Hello, ${userName}!\n\n` +
    "I am <b>WHIZ LITE</b>, your personal image uploader.\n\n" +
    "Simply send me any image (or multiple images at once), and I will upload them to " +
    "Telegra.ph, giving you a permanent, direct link.\n\n" +
    `<i>Note: You are limited to ${UPLOAD_LIMIT} uploads per hour.</i>`, { parse_mode: 'HTML' }
  );
});

// Main handler for photos
bot.on('photo', async (msg) => {
  // Ensure the message is in a private chat
  if (msg.chat.type !== 'private') return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // 1. Check Rate Limiting
  const { isLimited, timeToWaitMin } = isRateLimited(userId);
  if (isLimited) {
    bot.sendMessage(
      chatId,
      `⚠️ Rate limit reached! Please wait approximately ${timeToWaitMin} ` +
      `more minute(s) before uploading again.`
    );
    return;
  }

  // 2. Process the Image
  let processingMessage;
  try {
    processingMessage = await bot.sendMessage(chatId, '🔄 Processing your image...');
    
    // Get the highest quality photo
    const bestQualityPhoto = msg.photo[msg.photo.length - 1];
    const fileId = bestQualityPhoto.file_id;

    // Download the photo from Telegram's servers as a stream
    const photoStream = bot.getFileStream(fileId);
    const imageBuffer = await streamToBuffer(photoStream);

    // 3. Upload to Telegra.ph
    const telegraphLink = await uploadToTelegraph(imageBuffer);

    // 4. Reply to the user
    if (telegraphLink) {
      await bot.editMessageText(
        `✅ **Upload Successful!**\n\n🔗 Here is your permanent link:\n${telegraphLink}`, {
          chat_id: chatId,
          message_id: processingMessage.message_id,
          parse_mode: 'Markdown'
        }
      );
      recordUpload(userId); // Record successful upload
    } else {
      await bot.editMessageText(
        `❌ **Upload Failed.**\n\nSorry, I couldn't upload your image to Telegra.ph. Please try again later.`, {
          chat_id: chatId,
          message_id: processingMessage.message_id
        }
      );
    }
  } catch (error) {
    console.error(`Error handling image for user ${userId}:`, error.message);
    if (processingMessage) {
      await bot.editMessageText(
        'An unexpected error occurred. Please try again.', {
          chat_id: chatId,
          message_id: processingMessage.message_id
        }
      );
    }
  }
});

// Log any polling errors
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, '-', error.message);
});

console.log('Bot is now polling for updates.');