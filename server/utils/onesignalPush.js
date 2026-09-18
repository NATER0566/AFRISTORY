import { oneSignalClient, ONESIGNAL_APP_ID } from '../config/onesignal.js';

export const sendPushNotification = async (userId, title, message, targetUrl = '/') => {
  if (!ONESIGNAL_APP_ID) {
    console.warn('OneSignal App ID missing. Push notification skipped.');
    return false;
  }

  try {
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      target_channel: "push",
      // This tells OneSignal to send it to the specific AFROSTORY User ID
      include_aliases: {
        external_id: Array.isArray(userId) ? userId.map(String) : [String(userId)]
      },
      headings: { en: title },
      contents: { en: message },
      url: targetUrl
    };

    const response = await oneSignalClient.post('/notifications', payload);
    return response.data;
  } catch (error) {
    console.error('OneSignal Push Error:', error?.response?.data || error.message);
    return false;
  }
};
