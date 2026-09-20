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

// NEW: Added the options parameter to receive images and campaign names
export const sendToSubscriber = async (sid, title, message, targetUrl = '/', traceId = 'unknown', options = {}) => {
  if (!WEBPUSHR_API_KEY || !WEBPUSHR_AUTH_TOKEN) {
    return { success: false, stage: 'WEBPUSHR_CREDENTIALS', reason: 'CREDENTIALS_MISSING' };
  }

  const maskedSid = sid ? `${sid.substring(0, 8)}***` : 'undefined';
  console.log(`[WEBPUSHR_API] trace=${traceId} stage=REQUEST endpoint=/notification/send/sid sid=${maskedSid}`);

  try {
    // FIX: Added 'name', 'icon', and 'image' to fix the dashboard and visual design
    const payload = {
      title,
      message: message || 'New notification',
      target_url: targetUrl,
      sid,
      name: options.name || 'AfriStory API Notification', // Forces Webpushr to log this in the dashboard
      icon: options.icon || 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192', // Branded AfriStory gold logo
    };

    // If an episode thumbnail or banner is provided, add it to the payload
    if (options.image) {
      payload.image = options.image; // Big beautiful banner
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
