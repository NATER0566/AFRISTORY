import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const WEBPUSHR_API_KEY = process.env.WEBPUSHR_API_KEY;
const WEBPUSHR_AUTH_TOKEN = process.env.WEBPUSHR_AUTH_TOKEN;
const WEBPUSHR_BASE_URL = 'https://api.webpushr.com/v1';

if (!WEBPUSHR_API_KEY || !WEBPUSHR_AUTH_TOKEN) {
  console.warn('Webpushr credentials missing in .env - browser push delivery disabled.');
}

const webpushrClient = axios.create({
  baseURL: WEBPUSHR_BASE_URL,
  headers: {
    webpushrKey: WEBPUSHR_API_KEY || '',
    webpushrAuthToken: WEBPUSHR_AUTH_TOKEN || '',
    'Content-Type': 'application/json',
  },
});

export const sendToSubscriber = async (sid, title, message, targetUrl = '/', traceId = 'unknown', options = {}) => {
  if (!WEBPUSHR_API_KEY || !WEBPUSHR_AUTH_TOKEN) {
    return { success: false, stage: 'WEBPUSHR_CREDENTIALS', reason: 'CREDENTIALS_MISSING' };
  }

  const maskedSid = sid ? `${sid.substring(0, 8)}***` : 'undefined';
  console.log(`[WEBPUSHR_API] trace=${traceId} stage=REQUEST endpoint=/notification/send/sid sid=${maskedSid}`);

  // WEB PUSHR STRICT IMAGE VALIDATION
  // Webpushr silently drops any image that doesn't end in .png, .jpg, or .jpeg
  
  // REPLACE THIS URL WITH YOUR ACTUAL AFROSTORY LOGO (Must end in .png or .jpg)
  // For now, I am using a guaranteed high-quality gold bell .png so you can see it work.
  let safeIcon = 'https://cdn-icons-png.flaticon.com/512/3114/3114931.png'; 
  
  if (options.icon && (options.icon.includes('.png') || options.icon.includes('.jpg') || options.icon.includes('.jpeg'))) {
      safeIcon = options.icon;
  }

  let safeImage = undefined;
  if (options.image && (options.image.includes('.png') || options.image.includes('.jpg') || options.image.includes('.jpeg'))) {
      safeImage = options.image;
  }

  try {
    const payload = {
      title,
      message: message || 'New notification',
      target_url: targetUrl,
      sid,
      name: options.name || 'AfriStory API Notification', // Tells Webpushr to group these
      icon: safeIcon, 
    };

    if (safeImage) {
      payload.image = safeImage; // Adds the big beautiful banner/thumbnail
    }

    const response = await webpushrClient.post('/notification/send/sid', payload);
    
    console.log(`[WEBPUSHR_API] trace=${traceId} stage=RESPONSE status=${response.status} success=true`);
    
    return { 
      success: true, 
      stage: 'WEBPUSHR_RESPONSE', 
      webpushrStatus: response.status, 
      data: response.data 
    };
  } catch (error) {
    const status = error.response?.status || 'NETWORK_ERROR';
    const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    
    console.log(`[WEBPUSHR_API] trace=${traceId} stage=ERROR status=${status} message=${errorData}`);
    
    return {
      success: false,
      stage: 'WEBPUSHR_RESPONSE',
      webpushrStatus: status,
      reason: errorData,
    };
  }
};

export default webpushrClient;
