import crypto from 'crypto';
import Notification from '../models/Notification.js';
import WebpushrSubscriber from '../models/WebpushrSubscriber.js';
import User from '../models/User.js';
import { sendToSubscriber } from '../config/webpushr.js';

export const createNotification = async ({ 
  userId, 
  type, 
  title, 
  message, 
  data = {}, 
  targetUrl, 
  dedupeKey, 
  icon = null, 
  image = null 
}) => {
  const traceId = crypto.randomUUID();
  console.log(`[NOTIFICATION] trace=${traceId} event=${type} user=${userId} stage=START`);

  try {
    // 1. Deduplication (Prevent duplicate pushes for the exact same event)
    if (dedupeKey) {
      const existing = await Notification.findOne({ userId, type, dedupeKey });
      if (existing) {
        console.log(`[NOTIFICATION] trace=${traceId} stage=DEDUPLICATION status=SKIPPED reason=DUPLICATE`);
        return { success: true, duplicated: true, traceId, notification: existing };
      }
    }

    // 2. Create MongoDB Notification (Immutable Source of Truth)
    const notification = new Notification({
      userId,
      type,
      title,
      message: message || '',
      data,
      targetUrl,
      icon,
      image,
      dedupeKey,
    });

    await notification.save();
    console.log(`[NOTIFICATION] trace=${traceId} stage=MONGODB_NOTIFICATION status=SUCCESS`);

    // 3. Check Master User Push Preference
    const user = await User.findById(userId).select('privacy');
    const pushEnabled = user?.privacy?.pushEnabled !== false; // Defaults to true if undefined

    if (!pushEnabled) {
      console.log(`[NOTIFICATION] trace=${traceId} stage=PUSH_PREFERENCE status=DISABLED`);
      return { 
        success: true, 
        notificationCreated: true, 
        pushAttempted: false, 
        pushSent: false, 
        traceId, 
        stage: 'PUSH_PREFERENCE', 
        reason: 'USER_DISABLED_PUSH', 
        notification 
      };
    }
    console.log(`[NOTIFICATION] trace=${traceId} stage=PUSH_PREFERENCE status=ENABLED`);

    // 4. Find Active Webpushr Subscribers for this User
    const subscribers = await WebpushrSubscriber.find({ userId, active: true });
    console.log(`[NOTIFICATION] trace=${traceId} stage=SUBSCRIBER_LOOKUP activeSubscribers=${subscribers.length}`);
    
    if (!subscribers.length) {
      return { 
        success: true, 
        notificationCreated: true, 
        pushAttempted: false, 
        pushSent: false, 
        traceId, 
        stage: 'SUBSCRIBER_LOOKUP', 
        reason: 'NO_ACTIVE_SUBSCRIBER', 
        notification 
      };
    }

    // 5. Send Targeted Webpushr Push with Styling & Campaign Grouping
    let successCount = 0;
    let lastResult = null;

    const pushOptions = {
      name: `AfriStory - ${type}`,
      ...(icon ? { icon } : {}),
      ...(image ? { image } : {}),
    };

    for (const sub of subscribers) {
      const pushResult = await sendToSubscriber(
        sub.webpushrSid, 
        title, 
        message, 
        targetUrl, 
        traceId, 
        pushOptions
      );
      lastResult = pushResult;
      
      // 6. Automatically deactivate invalid/unsubscribed browsers
      if (!pushResult.success) {
        if (pushResult.webpushrStatus === 400 || String(pushResult.reason).toLowerCase().includes('invalid')) {
          sub.active = false;
          await sub.save();
          console.log(`[NOTIFICATION] trace=${traceId} stage=SUBSCRIBER_CLEANUP status=DEACTIVATED sid=${sub.webpushrSid.substring(0, 8)}***`);
        }
      } else {
        successCount++;
      }
    }

    console.log(`[NOTIFICATION] trace=${traceId} stage=COMPLETE deliveryCount=${successCount}`);
    return { 
      success: true, 
      notificationCreated: true, 
      pushAttempted: true, 
      pushSent: successCount > 0, 
      deliveryCount: successCount, 
      traceId, 
      stage: lastResult?.stage || 'COMPLETE', 
      webpushrStatus: lastResult?.webpushrStatus, 
      reason: lastResult?.reason,
      notification 
    };

  } catch (error) {
    console.log(`[NOTIFICATION] trace=${traceId} stage=FAILED status=ERROR reason="${error.message}"`);
    return { success: false, stage: 'FAILED', reason: error.message, traceId };
  }
};

export default { createNotification };
