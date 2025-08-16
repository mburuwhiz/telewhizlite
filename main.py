import logging
import os
import datetime
import requests
from dotenv import load_dotenv

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
from telegram.constants import ChatType

# --- Configuration ---
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
OWNER_ID_STR = os.getenv("OWNER_ID")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# --- Rate Limiting Configuration ---
UPLOAD_LIMIT = 5
TIME_WINDOW = datetime.timedelta(hours=1)
user_uploads = {}

# --- Input Validation ---
if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN environment variable not set! Get one from @BotFather.")
if not OWNER_ID_STR or not OWNER_ID_STR.isdigit():
    raise ValueError("OWNER_ID environment variable is not a valid number! Get it from @userinfobot.")
OWNER_ID = int(OWNER_ID_STR)


# --- Helper Functions ---

def is_rate_limited(user_id: int) -> tuple[bool, datetime.datetime | None]:
    if user_id == OWNER_ID:
        return False, None

    current_time = datetime.datetime.now()
    if user_id not in user_uploads:
        return False, None

    relevant_timestamps = [
        ts for ts in user_uploads[user_id]
        if current_time - ts < TIME_WINDOW
    ]
    user_uploads[user_id] = relevant_timestamps

    if len(relevant_timestamps) >= UPLOAD_LIMIT:
        oldest_relevant_upload = min(relevant_timestamps)
        return True, oldest_relevant_upload

    return False, None

def record_upload(user_id: int):
    if user_id not in user_uploads:
        user_uploads[user_id] = []
    user_uploads[user_id].append(datetime.datetime.now())

# MODIFIED: This function now accepts bytes instead of a file path.
def upload_bytes_to_telegraph(file_bytes: bytes) -> str | None:
    """
    Uploads image bytes to telegra.ph.

    Args:
        file_bytes: The image data as a bytes object.

    Returns:
        The permanent URL of the uploaded image, or None if it fails.
    """
    try:
        # MODIFIED: Pass the byte data directly to the files parameter.
        files = {'file': ('file.jpg', file_bytes, 'image/jpeg')}
        response = requests.post("https://telegra.ph/upload", files=files, timeout=20)
        response.raise_for_status()

        result = response.json()
        if isinstance(result, list) and result and "src" in result[0]:
            return f"https://telegra.ph{result[0]['src']}"
        else:
            logger.error(f"Telegra.ph API returned an unexpected response: {result}")
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error during Telegra.ph upload: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during upload: {e}")
        return None


# --- Bot Command and Message Handlers ---

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_name = update.effective_user.first_name
    await update.message.reply_html(
        f"👋 Hello, {user_name}!\n\n"
        "I am <b>WHIZ LITE</b>, your personal image uploader.\n\n"
        "Simply send me any image (or multiple images at once), and I will upload them to "
        "Telegra.ph, giving you a permanent, direct link.\n\n"
        f"<i>Note: You are limited to {UPLOAD_LIMIT} uploads per hour.</i>"
    )

async def handle_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if not user:
        return

    is_limited, oldest_upload_time = is_rate_limited(user.id)
    if is_limited and oldest_upload_time:
        time_to_wait = (oldest_upload_time + TIME_WINDOW) - datetime.datetime.now()
        minutes_to_wait = int(time_to_wait.total_seconds() / 60) + 1
        await update.message.reply_text(
            f"⚠️ Rate limit reached! Please wait approximately {minutes_to_wait} "
            f"more minute(s) before uploading again."
        )
        return

    processing_message = await update.message.reply_text("🔄 Processing your image...")

    try:
        photo_file = await update.message.photo[-1].get_file()

        # MODIFIED: Download the image to memory (a byte array) instead of a file.
        image_bytes = await photo_file.download_as_bytearray()

        # MODIFIED: Call the new function that handles bytes.
        telegraph_link = upload_bytes_to_telegraph(bytes(image_bytes))

        if telegraph_link:
            await processing_message.edit_text(
                f"✅ **Upload Successful!**\n\n🔗 Here is your permanent link:\n{telegraph_link}",
                parse_mode='Markdown'
            )
            record_upload(user.id)
        else:
            await processing_message.edit_text(
                "❌ **Upload Failed.**\n\nSorry, I couldn't upload your image to Telegra.ph at the moment. "
                "Please try again later."
            )
    except Exception as e:
        logger.error(f"Error handling image for user {user.id}: {e}")
        await processing_message.edit_text("An unexpected error occurred. Please try again.")

def main():
    logger.info("Starting WHIZ LITE bot...")
    application = Application.builder().token(BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(MessageHandler(filters.PHOTO & filters.ChatType.PRIVATE, handle_image))

    application.run_polling()
    logger.info("WHIZ LITE bot has stopped.")

if __name__ == "__main__":
    main()