import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const ONESIGNAL_BASE_URL = 'https://onesignal.com/api/v1';

if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
  console.warn('OneSignal credentials not configured - push notifications disabled');
}

const oneSignalClient = axios.create({
  baseURL: ONESIGNAL_BASE_URL,
  headers: {
    Authorization: `Basic ${ONESIGNAL_API_KEY}`,
    'Content-Type': 'application/json; charset=utf-8',
  },
});

export { oneSignalClient, ONESIGNAL_APP_ID, ONESIGNAL_API_KEY };
export default oneSignalClient;
