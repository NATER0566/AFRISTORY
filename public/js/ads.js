const ROBINS_WEBSITE_ID = '6b06e5d10354f7305a5bc51b';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 4 * 60 * 1000; // 4 minutes max per session

let activeSession = null;

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('afristory_token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function showStatusToast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon"></span><span class="toast-message">${message}</span>`;
  region.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOutToast 0.3s ease forwards';
    setTimeout(() => toast.remove(), 320);
  }, 4200);
}

function isTelegramWebApp() {
  return Boolean(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
}

function resetTriggerButton(trigger) {
  document.body.classList.remove('robins-ad-processing');
  if (!trigger) return;
  delete trigger.dataset.robinsLoading;
  if (trigger.dataset.originalHtml) {
    trigger.innerHTML = trigger.dataset.originalHtml;
  }
  const note = trigger.parentElement?.querySelector('.robins-processing-note');
  if (note) note.remove();
}

function setTriggerStatus(trigger, label) {
  if (!trigger) return;
  if (!trigger.dataset.originalHtml) {
    trigger.dataset.originalHtml = trigger.innerHTML;
  }
  trigger.dataset.robinsLoading = 'true';
  trigger.innerHTML = `<span class="btn-spinner"></span><span>${label}</span>`;
  document.body.classList.add('robins-ad-processing');

  const container = trigger.parentElement;
  if (container) {
    let note = container.querySelector('.robins-processing-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'robins-processing-note';
      container.appendChild(note);
    }
    note.innerHTML = `<span class="btn-spinner" style="width:12px;height:12px;border-top-color:#f0c44d;border-color:rgba(240,196,77,0.25);"></span><span>${label}</span>`;
  }
}

function dispatchRewardVerified(trigger, payload) {
  const detail = {
    provider: 'ROBINADS',
    websiteId: ROBINS_WEBSITE_ID,
    verified: true,
    ...payload,
  };

  const target = trigger || window.__lastRobinsTrigger || document;
  window.__lastRobinsTrigger = null;
  target.dispatchEvent(
    new CustomEvent('robins:rewarded', {
      bubbles: true,
      detail,
    })
  );
}

async function pollRewardUntilTerminal({ rewardId, popupWindow, trigger }) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let finished = false;
    let closedCheckCount = 0;

    const cleanup = (timer) => {
      finished = true;
      clearInterval(timer);
      activeSession = null;
      resetTriggerButton(trigger);
      try {
        if (popupWindow && !popupWindow.closed) popupWindow.close();
      } catch (_) {}
    };

    const timer = setInterval(async () => {
      if (finished) return;

      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        cleanup(timer);
        reject(new Error('Ad session timed out. Please try again.'));
        return;
      }

      try {
        const res = await fetch(
          `/api/ads/rewards/${encodeURIComponent(rewardId)}/status`,
          {
            method: 'GET',
            credentials: 'include',
            headers: getAuthHeaders(),
          }
        );

        const json = await res.json().catch(() => ({}));
        const data = json?.data || {};

        if (!res.ok) {
          cleanup(timer);
          reject(new Error(json?.message || 'Could not verify ad completion.'));
          return;
        }

        if (data.status === 'verified' && data.verified) {
          cleanup(timer);
          const result = {
            rewardId,
            transactionId: rewardId,
            verified: true,
          };
          dispatchRewardVerified(trigger, result);
          resolve(result);
          return;
        }

        if (data.status === 'expired' || data.status === 'rejected') {
          cleanup(timer);
          reject(
            new Error(
              data.status === 'expired'
                ? 'Ad expired before completion. Please try again.'
                : 'Ad watch could not be verified.'
            )
          );
          return;
        }

        // If user closed the popup window, allow 2 final status checks in case verification just finished
        if (popupWindow && popupWindow.closed) {
          closedCheckCount += 1;
          if (closedCheckCount >= 2) {
            cleanup(timer);
            reject(new Error('Ad closed before completion. Watch the full ad to unlock.'));
          }
        }
      } catch (_) {
        // Keep polling on transient network hiccup
      }
    }, POLL_INTERVAL_MS);
  });
}

/**
 * Fallback to Robins Ads Section 2a / Section 4 in-app interstitial
 * when inside Telegram WebApp or if the browser blocks window.open().
 */
async function runInAppInterstitialFallback(trigger) {
  if (!window.RobinAds || typeof window.RobinAds.showInterstitial !== 'function') {
    throw new Error('Please allow popups for afristory.live to watch the sponsor ad.');
  }

  setTriggerStatus(trigger, 'Playing sponsor video...');
  const result = await window.RobinAds.showInterstitial();

  if (!result || !result.rewardGranted || !result.rewardId || !result.token) {
    throw new Error(result?.error || 'Watch the full ad to claim your reward.');
  }

  const payload = {
    rewardId: result.rewardId,
    transactionId: result.rewardId,
    token: result.token,
    verified: true,
  };

  resetTriggerButton(trigger);
  dispatchRewardVerified(trigger, payload);
  return payload;
}

/**
 * Primary Rewarded Ad Entrypoint (Robins Ads Section 3 Server-Verified Reward API)
 */
export async function launchRewardedAd(options = {}) {
  const trigger = options.trigger || window.__lastRobinsTrigger || null;

  if (activeSession) {
    return activeSession;
  }

  const purpose =
    options.purpose ||
    trigger?.dataset?.purpose ||
    (trigger?.dataset?.episodeId ? 'DIRECT_EPISODE_UNLOCK' : 'PROMO_REWARD');
  const targetId =
    options.targetId ||
    trigger?.dataset?.episodeId ||
    trigger?.dataset?.targetId ||
    trigger?.dataset?.rewardId ||
    null;
  const coins = 5;

  setTriggerStatus(trigger, 'Starting sponsor ad...');

  const task = (async () => {
    try {
      // Inside Telegram Mini Apps, window.open is blocked — use RobinAds.showInterstitial() per Section 4
      if (isTelegramWebApp()) {
        return await runInAppInterstitialFallback(trigger);
      }

      // Step 1: Ask AfriStory backend to create a verified Robins Ads reward session
      const createRes = await fetch('/api/ads/rewards/create', {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ purpose, targetId, coins }),
      });

      const createJson = await createRes.json().catch(() => ({}));
      const session = createJson?.data || {};

      if (!createRes.ok || !session.id || !session.popup_url) {
        throw new Error(
          createJson?.message || 'No sponsor ad available right now. Please try again.'
        );
      }

      // Step 2: Open Robins Ads' official hosted interstitial popup
      const popup = window.open(
        session.popup_url,
        'robinads_reward',
        'width=480,height=640,menubar=no,toolbar=no,location=no,status=no'
      );

      // If popup was blocked by browser settings, fall back to in-app RobinAds.showInterstitial()
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        return await runInAppInterstitialFallback(trigger);
      }

      setTriggerStatus(trigger, 'Watching sponsor ad... Finish to verify');

      // Step 3: Poll backend until Robins Ads server flips status to "verified"
      return await pollRewardUntilTerminal({
        rewardId: session.id,
        popupWindow: popup,
        trigger,
      });
    } catch (err) {
      resetTriggerButton(trigger);
      showStatusToast(err.message || 'Could not complete sponsor ad.', 'error');
      throw err;
    } finally {
      activeSession = null;
    }
  })();

  activeSession = task;
  return task;
}

// Compatibility aliases so any call from main.js works seamlessly
export const showRewardedAd = launchRewardedAd;
export const requestRewardedAd = launchRewardedAd;
export const showSponsoredMessage = launchRewardedAd;

export function initAds() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-robins-rewarded]');
    if (!trigger) return;

    event.preventDefault();
    launchRewardedAd({ trigger }).catch(() => {});
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAds, { once: true });
} else {
  initAds();
}
