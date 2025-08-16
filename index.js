// --- Imports ---
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const express = require('express'); // NEW: For the web server
require('dotenv').config();

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000; // Render provides the PORT env var

// --- Configuration & Bot Initialization ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID, 10);
// ... All other configs and helper functions (isRateLimited, recordUpload, etc.) remain the same ...
// [ Keeping them hidden here for brevity, but they are in the full code below ]

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not set.");
  process.exit(1);
}
if (!OWNER_ID || isNaN(OWNER_ID)) {
  console.error("Error: OWNER_ID is not a valid number.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- Helper Functions (Unchanged) ---
const UPLOAD_LIMIT = 5;
const TIME_WINDOW_MS = 60 * 60 * 1000;
const userUploads = {};
function isRateLimited(userId) { /* ... same as before ... */ }
function recordUpload(userId) { /* ... same as before ... */ }
async function uploadToTelegraph(buffer, filename) { /* ... same as before ... */ }
function streamToBuffer(stream) { /* ... same as before ... */ }
// [Full helper function code is in the complete block below]


// --- NEW: Web Server Logic ---
// This tells Express to serve your website files (index.html, style.css)
app.use(express.static(path.join(__dirname)));

// This is the main page of your website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the web server to listen for Render's health checks
app.listen(PORT, () => {
  console.log(`✅ Web server is live and listening on port ${PORT}`);
  console.log('🤖 WHIZ LITE bot is starting...');
  // All the bot logic will run within this same process
});


// --- Bot Event Handlers (Unchanged) ---
bot.onText(/\/start/, (msg) => { /* ... same as before ... */ });
bot.on('photo', async (msg) => { /* ... same as before ... */ });
bot.on('polling_error', (error) => { console.error('Polling error:', error.code, '-', error.message); });

console.log('Bot is now polling for updates.');


// --- PASTE THIS ENTIRE BLOCK INTO index.js ---
// The full, complete code is below for easy copy-pasting.
