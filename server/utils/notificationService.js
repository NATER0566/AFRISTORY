import Notification from '../models/Notification.js';
import WebpushrSubscriber from '../models/WebpushrSubscriber.js';
import User from '../models/User.js';
import { sendToSubscriber } from '../config/webpushr.js';

export const createNotification = async ({ userId, type, title, message, data, targetUrl, dedupeKey }) => {
  try {
    // 1. Deduplication (Prevent duplicate pushes for the exact same event)
    if (dedupeKey) {
      const existing = await Notification.findOne({ userId, type, 'data.dedupeKey': dedupeKey });
      if (existing) {
        return { success: true, duplicated: true, notification: existing };
      }
    }

    // 2. Create MongoDB Notification (Immutable Source of Truth)
    const notificationData = data || {};
    if (dedupeKey) notificationData.dedupeKey = dedupeKey;

    const notification = new Notification({
      userId,
      type,
      title,
      message: message || '',
      data: notificationData,
    });

    await notification.save();

    // 3. Check Master User Push Preference
    const user = await User.findById(userId).select('privacy');
    const pushEnabled = user?.privacy?.pushEnabled !== false; // Defaults to true if undefined

    if (!pushEnabled) {
      return { success: true, notification, pushSent: false, reason: 'user_disabled_push' };
    }

    // 4. Find Active Webpushr Subscribers for this User
    const subscribers = await WebpushrSubscriber.find({ userId, active: true });
    
    if (!subscribers.length) {
      return { success: true, notification, pushSent: false, reason: 'no_active_subscribers' };
    }

    // 5. Send Targeted Webpushr Push
    let successCount = 0;
    for (const sub of subscribers) {
      const pushResult = await sendToSubscriber(sub.webpushrSid, title, message, targetUrl);
      
      // 6. Automatically deactivate invalid/unsubscribed browsers
      if (pushResult?.error) {
        if (pushResult.status === 400 || String(pushResult.details).toLowerCase().includes('invalid')) {
          sub.active = false;
          await sub.save();
        }
      } else {
        successCount++;
      }
    }

    return { success: true, notification, pushSent: successCount > 0, deliveryCount: successCount };

  } catch (error) {
    // A push failure NEVER breaks the main business transaction (e.g. reward or payment)
    console.error('[Notification Service Error]', error);
    return { success: false, error: error.message };
  }
};

export default { createNotification };
