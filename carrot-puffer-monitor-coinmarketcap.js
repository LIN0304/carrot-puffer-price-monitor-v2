// carrot-puffer-monitor-coinmarketcap.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let notifyIntervalArg = null;

// Check for --notify-interval argument
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--notify-interval' && i + 1 < args.length) {
    notifyIntervalArg = parseInt(args[i + 1]) * 60 * 1000; // Convert minutes to milliseconds
    break;
  }
}

// --- CONFIGURATION ---
// Set your configuration values directly here
const CONFIG = {
  // Get API key from https://coinmarketcap.com/api/
  coinmarketcapApiKey: '', // <--- SET YOUR CMC API KEY HERE
  // Your Telegram Bot Token
  telegramBotToken: '', // <--- SET YOUR TELEGRAM BOT TOKEN HERE
  // List of Telegram Chat IDs (add your chat IDs as strings in this array)
  telegramChatIds: [''], // <--- ADD YOUR CHAT IDS HERE, e.g., ['12345', '-1009876']
  // Discount threshold (e.g., 0.55 means 55%)
  discountRatio: 0.55, // <--- SET desired discount ratio (e.g., 0.6 for 60%)
  // How often to check prices (in minutes)
  checkInterval: 5 * 60 * 1000, // <--- SET check interval (e.g., 10 * 60 * 1000 for 10 minutes)
  // Minimum interval between notifications (in minutes)
  // Priority: Command line (--notify-interval X) -> Default (10 mins)
  notifyInterval: notifyIntervalArg || (10 * 60 * 1000), // <--- SET default notification interval (e.g., 30 * 60 * 1000 for 30 minutes)
  // Log file location
  logFile: path.join(__dirname, 'price-monitor.log'),
  // CoinMarketCap IDs for the tokens
  carrotId: '35839', // Carrot by Puffer ID (Update if needed)
  pufferId: '32325' // Puffer ID (Update if needed)
};

// --- STATE ---
let lastNotificationTime = 0;

// --- FUNCTIONS ---

/**
 * Logs a message to the console and a file.
 * @param {string} message - The message to log.
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  console.log(logMessage.trim()); // Log to console

  // Append to log file
  try {
    fs.appendFileSync(CONFIG.logFile, logMessage);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error writing to log file: ${err.message}`);
  }
}

/**
 * Validates essential configuration values.
 * @returns {boolean} True if configuration is valid, false otherwise.
 */
function validateConfig() {
    if (!CONFIG.coinmarketcapApiKey || CONFIG.coinmarketcapApiKey === 'YOUR_COINMARKETCAP_API_KEY_HERE') {
        log('Error: CoinMarketCap API key is missing or not set in the script.');
        return false;
    }
    if (!CONFIG.telegramBotToken || CONFIG.telegramBotToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        log('Error: Telegram Bot Token is missing or not set in the script.');
        return false;
    }
    if (!Array.isArray(CONFIG.telegramChatIds) || CONFIG.telegramChatIds.length === 0 || CONFIG.telegramChatIds.includes('YOUR_CHAT_ID_1_HERE')) {
        log('Error: No Telegram Chat IDs provided or default placeholder found. Please add valid chat IDs to the CONFIG.telegramChatIds array in the script.');
        return false;
    }
    // Add more checks if needed (e.g., for IDs, ratios)
    return true;
}


/**
 * Fetches cryptocurrency prices from CoinMarketCap API.
 */
async function fetchPrices() {
  // Validation is now done once at the start, but keep a basic check here just in case.
  if (!CONFIG.coinmarketcapApiKey || !CONFIG.telegramBotToken || CONFIG.telegramChatIds.length === 0) {
    log('Error: Configuration missing (API Key, Bot Token, or Chat IDs). Please check the CONFIG object in the script.');
    return; // Stop if essential config is missing
  }

  try {
    log('Fetching current prices from CoinMarketCap...');

    // Fetch both tokens in one API call
    const response = await axios.get(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest`, {
        headers: {
          'X-CMC_PRO_API_KEY': CONFIG.coinmarketcapApiKey,
          'Accept': 'application/json' // Ensure we accept JSON
        },
        params: {
          id: `${CONFIG.carrotId},${CONFIG.pufferId}`
        }
      });

    const data = response.data.data;

    // Extract prices safely
    const carrotPrice = data[CONFIG.carrotId]?.quote?.USD?.price;
    const pufferPrice = data[CONFIG.pufferId]?.quote?.USD?.price;

    // Check if both prices were successfully fetched
    if (typeof carrotPrice === 'number' && typeof pufferPrice === 'number') {
      log(`Current prices: Carrot: $${carrotPrice.toFixed(6)}, Puffer: $${pufferPrice.toFixed(6)}`);

      const thresholdPrice = pufferPrice * CONFIG.discountRatio;
      log(`Discount threshold (${(CONFIG.discountRatio * 100).toFixed(0)}% of Puffer): $${thresholdPrice.toFixed(6)}`);

      // Check if Carrot is below the threshold
      if (carrotPrice < thresholdPrice) {
        const discountPercentage = (((pufferPrice * CONFIG.discountRatio) - carrotPrice) / (pufferPrice * CONFIG.discountRatio) * 100).toFixed(2); // More accurate discount calculation relative to the threshold
        log(`Discount detected! Carrot is ${discountPercentage}% below the threshold price.`);

        // Check if enough time has passed since the last notification
        const now = Date.now();
        if (now - lastNotificationTime >= CONFIG.notifyInterval) {
          await sendTelegramNotifications(carrotPrice, pufferPrice, thresholdPrice, discountPercentage); // Call the plural version
          lastNotificationTime = now; // Update last notification time only after successful sends (or attempt)
        } else {
          const nextNotificationTime = new Date(lastNotificationTime + CONFIG.notifyInterval);
          const minutesRemaining = Math.ceil((nextNotificationTime - now) / 60000); // Use ceil for better user understanding
          log(`Skipped notification due to rate limit. Next notification possible in ~${minutesRemaining} minute(s).`);
        }
      } else {
        log('No discount detected. Carrot price is at or above the threshold.');
      }
    } else {
      log('Error: Could not fetch valid prices for one or both cryptocurrencies.');
      log(`Carrot Price Found: ${carrotPrice}, Puffer Price Found: ${pufferPrice}`);
      log(`Raw data received: ${JSON.stringify(data, null, 2)}`);
    }
  } catch (error) {
    log(`Error fetching prices: ${error.message}`);
    if (error.response) {
      // Log API response error details if available
      log(`API Error Status: ${error.response.status}`);
      log(`API Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      // The request was made but no response was received
      log('Error: No response received from CoinMarketCap API.');
    } else {
      // Something happened in setting up the request that triggered an Error
      log('Error setting up the request:', error.message);
    }
    // console.error(error); // Optionally log the full error object for debugging
  }
}

/**
 * Sends Telegram notifications to multiple chat IDs.
 * @param {number} carrotPrice - Current price of Carrot.
 * @param {number} pufferPrice - Current price of Puffer.
 * @param {number} thresholdPrice - Calculated threshold price.
 * @param {string} discountPercentage - Calculated discount percentage string.
 */
async function sendTelegramNotifications(carrotPrice, pufferPrice, thresholdPrice, discountPercentage) {
  const message = `🚨 DISCOUNT ALERT 🚨\n\n` +
                  `Carrot is trading at a ${discountPercentage}% discount!\n\n` +
                  `🥕 Carrot: $${carrotPrice.toFixed(6)}\n` +
                  `🐡 Puffer: $${pufferPrice.toFixed(6)}\n` +
                  `📉 Threshold (${(CONFIG.discountRatio * 100).toFixed(0)}% of Puffer): $${thresholdPrice.toFixed(6)}`;

  const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;

  // Use Promise.allSettled to send to all chats even if some fail
  const sendPromises = CONFIG.telegramChatIds.map(chatId => {
    // Basic check for placeholder ID
    if (typeof chatId !== 'string' || chatId.startsWith('YOUR_CHAT_ID')) {
        log(`Skipping invalid or placeholder chat ID: ${chatId}`);
        return Promise.resolve({ status: 'skipped', chatId: chatId }); // Resolve immediately for invalid IDs
    }

    log(`Attempting to send notification to chat ID: ${chatId}`);
    return axios.post(url, {
      chat_id: chatId,
      text: message,
      // Optional: Disable link previews if desired
      // disable_web_page_preview: true
    })
    .then(response => {
      if (response.data.ok) {
        log(`Telegram notification sent successfully to chat ID: ${chatId}`);
        return { status: 'fulfilled', chatId: chatId };
      } else {
        log(`Failed to send Telegram notification to chat ID ${chatId}: ${response.data.description}`);
        return { status: 'rejected', chatId: chatId, reason: response.data.description };
      }
    })
    .catch(error => {
      log(`Error sending Telegram notification to chat ID ${chatId}: ${error.message}`);
      // console.error(`Error details for chat ID ${chatId}:`, error); // Optional detailed logging
       return { status: 'rejected', chatId: chatId, reason: error.message };
    });
  });

  // Wait for all send attempts to complete (including skipped ones)
  const results = await Promise.allSettled(sendPromises);

  // Log summary of results (optional)
  results.forEach(result => {
      if (result.status === 'fulfilled') {
          if (result.value.status === 'skipped') {
              // Already logged during the map phase
          } else {
             log(`Final status for chat ID ${result.value.chatId}: Success`);
          }
      } else if (result.status === 'rejected') {
          // This case handles errors thrown before the axios promise (e.g., invalid URL, though unlikely here)
          log(`Final status: Failed (Promise rejected before API call) - Reason: ${result.reason}`);
      } else { // Check the resolved value for rejections from axios/telegram
          if(result.value.status === 'rejected'){
             log(`Final status for chat ID ${result.value.chatId}: Failed (${result.value.reason})`);
          }
      }
  });


  // Check if at least one notification was successful if needed for logic downstream
  const oneSuccess = results.some(r => r.status === 'fulfilled' && r.value.status === 'fulfilled');
  if (!oneSuccess) {
      log("Warning: Failed to send notification to any valid chat ID.");
  }
}


/**
 * Starts the price monitoring process.
 */
function startMonitoring() {
  log('--- Price Monitoring Script Starting ---');
  log(`Configuration loaded from script:`);
  log(` - Check Interval: ${CONFIG.checkInterval / 60000} minutes`);
  log(` - Notification Interval: ${CONFIG.notifyInterval / 60000} minutes`);
  log(` - Discount Ratio: ${CONFIG.discountRatio * 100}%`);
  log(` - Carrot ID: ${CONFIG.carrotId}`);
  log(` - Puffer ID: ${CONFIG.pufferId}`);
  // Ensure telegramChatIds is an array before joining
  const chatIdsString = Array.isArray(CONFIG.telegramChatIds) ? CONFIG.telegramChatIds.join(', ') : 'Invalid configuration';
  log(` - Target Chat IDs: ${chatIdsString || 'None configured'}`);
  log(` - Log File: ${CONFIG.logFile}`);
  log('-----------------------------------------');


  // Validate configuration before starting
  if (!validateConfig()) {
      log('ERROR: Invalid or incomplete configuration found in the script. Please fix the CONFIG object. Exiting.');
      process.exit(1); // Exit if essential config is missing or invalid
  }


  // Run immediately on startup
  fetchPrices();

  // Then set interval for periodic checks
  const intervalId = setInterval(fetchPrices, CONFIG.checkInterval);

  // Handle script termination gracefully
  process.on('SIGINT', () => {
    log('SIGINT received. Stopping monitoring...');
    clearInterval(intervalId); // Stop the interval timer
    log('Monitoring stopped.');
    process.exit(0);
  });

   process.on('SIGTERM', () => {
    log('SIGTERM received. Stopping monitoring...');
    clearInterval(intervalId); // Stop the interval timer
    log('Monitoring stopped.');
    process.exit(0);
  });
}

// --- EXECUTION ---
startMonitoring();

