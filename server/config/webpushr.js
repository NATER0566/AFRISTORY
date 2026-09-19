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

export const sendToSubscriber = async (sid, title, message, targetUrl = '/') => {
  if (!WEBPUSHR_API_KEY || !WEBPUSHR_AUTH_TOKEN) return false;

  try {
    const payload = {
      title,
      message,
      target_url: targetUrl,
      sid,
    };

    const response = await webpushrClient.post('/notification/send/sid', payload);
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    console.error(`[Webpushr API Error] SID: ${sid} | Status: ${status}`, errorData || error.message);
    
    return {
      error: true,
      status,
      details: errorData || error.message,
    };
  }
};

export default webpushrClient;
