(function () {
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

  function emitLifecycleEvent(name, trigger, detail = {}) {
    const payload = {
      provider: 'ROBINS_ADS',
      websiteId: ROBINS_WEBSITE_ID,
      button: trigger || null,
      ...detail,
    };
    const target = trigger || window.__lastRobinsTrigger || document;
    try {
      target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: payload }));
      window.dispatchEvent(new CustomEvent(name, { detail: payload }));
    } catch (_) {}
  }

  function resetTriggerButton(trigger) {
    document.body.classList.remove('robins-ad-processing');
    if (!trigger) return;
    delete trigger.dataset.robinsLoading;
    delete trigger.dataset.rsLoading;
    trigger.disabled = false;
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
    trigger.disabled = true;
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

  function normalizePurpose(rawPurpose, hasEpisodeTarget) {
    const normalized = String(rawPurpose || '').trim().toUpperCase();
    if (
      ['EPISODE_UNLOCK', 'UNLOCK_EPISODE', 'DIRECT_EPISODE_UNLOCK'].includes(normalized) ||
      (!normalized && hasEpisodeTarget)
    ) {
      return 'DIRECT_EPISODE_UNLOCK';
    }
    return 'PROMO_REWARD';
  }

  function dispatchRewardVerified(trigger, payload) {
    const detail = {
      provider: 'ROBINS_ADS',
      websiteId: ROBINS_WEBSITE_ID,
      verified: true,
      ...payload,
    };

    const target = trigger || window.__lastRobinsTrigger || document;
    window.__lastRobinsTrigger = null;
    emitLifecycleEvent('robins:rewarded', target, detail);
  }

  async function pollRewardUntilTerminal({ rewardId, purpose, targetId, popupWindow, trigger }) {
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
          emitLifecycleEvent('robins:error', trigger, { reason: 'timeout' });
          reject(new Error('Ad session timed out. Please try again.'));
          return;
        }

        try {
          const res = await fetch(
            `/api/ads/rewards/${encodeURIComponent(rewardId)}/status`,
            {
              method: 'GET',
              credentials: 'include',
              cache: 'no-store',
              headers: getAuthHeaders(),
            }
          );

          const json = await res.json().catch(() => ({}));
          const data = json?.data || json || {};

          if (!res.ok) {
            cleanup(timer);
            emitLifecycleEvent('robins:error', trigger, { reason: 'status_error' });
            reject(new Error(json?.message || 'Could not verify ad completion.'));
            return;
          }

          if (data.status === 'verified' && data.verified !== false) {
            cleanup(timer);
            const result = {
              rewardId,
              transactionId: rewardId,
              purpose: data.purpose || purpose,
              targetId: data.targetId || targetId,
              verified: true,
            };
            dispatchRewardVerified(trigger, result);
            resolve(result);
            return;
          }

          if (data.status === 'expired' || data.status === 'rejected') {
            cleanup(timer);
            emitLifecycleEvent('robins:closed', trigger, { status: data.status });
            reject(
              new Error(
                data.status === 'expired'
                  ? 'Ad expired before completion. Please try again.'
                  : 'Ad watch could not be verified.'
              )
            );
            return;
          }

          // Allow 2 final status checks after popup closes in case webhook landed right at close
          if (popupWindow && popupWindow.closed) {
            closedCheckCount += 1;
            if (closedCheckCount >= 2) {
              cleanup(timer);
              emitLifecycleEvent('robins:closed', trigger, { reason: 'popup_closed' });
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
   * Fallback to Robins Ads in-app interstitial SDK when inside Telegram WebApp
   * or when strict browser settings block window.open().
   */
  async function runInAppInterstitialFallback(trigger, { purpose, targetId }) {
    if (!window.RobinAds || typeof window.RobinAds.showInterstitial !== 'function') {
      throw new Error('Please allow popups for afristory.live to watch the sponsor ad.');
    }

    setTriggerStatus(trigger, 'Playing sponsor video...');
    const result = await window.RobinAds.showInterstitial();

    const granted = Boolean(
      result &&
      (result.rewardGranted === true ||
        result.verified === true ||
        result.completed === true ||
        result.status === 'verified' ||
        result.status === 'completed')
    );

    if (!granted) {
      throw new Error(result?.error || 'Watch the full ad to claim your reward.');
    }

    const resolvedRewardId =
      result.rewardId || result.transactionId || `sdk_${Date.now()}`;

    const payload = {
      rewardId: resolvedRewardId,
      transactionId: resolvedRewardId,
      token: result.token || null,
      purpose,
      targetId,
      verified: true,
    };

    resetTriggerButton(trigger);
    dispatchRewardVerified(trigger, payload);
    return payload;
  }

  /**
   * Primary Rewarded Ad Entrypoint (Server-Verified Reward API + Gesture-Safe Popup)
   */
  async function launchRewardedAd(options = {}) {
    const trigger = options.trigger || window.__lastRobinsTrigger || null;

    if (activeSession) {
      return activeSession;
    }

    const episodeId = options.episodeId || trigger?.dataset?.episodeId || null;
    const purpose = normalizePurpose(
      options.purpose || trigger?.dataset?.purpose,
      Boolean(episodeId)
    );

    const rawTargetId =
      options.targetId ||
      episodeId ||
      trigger?.dataset?.targetId ||
      trigger?.dataset?.rewardId ||
      null;

    const targetId =
      purpose === 'DIRECT_EPISODE_UNLOCK'
        ? rawTargetId
        : rawTargetId || 'watch_ads';

    if (purpose === 'DIRECT_EPISODE_UNLOCK' && !targetId) {
      const err = new Error('Missing episode ID for direct episode ad unlock.');
      showStatusToast(err.message, 'error');
      throw err;
    }

    const coins = purpose === 'PROMO_REWARD' ? 5 : 0;

    setTriggerStatus(trigger, 'Starting sponsor ad...');
    emitLifecycleEvent('robins:start', trigger, { purpose, targetId });

    // Open popup synchronously inside the user click gesture BEFORE any await fetch()
    let popup = null;
    if (!isTelegramWebApp()) {
      try {
        popup = window.open(
          'about:blank',
          'robinads_reward',
          'width=480,height=640,menubar=no,toolbar=no,location=no,status=no'
        );
        if (popup && !popup.closed) {
          popup.document.write(
            '<!doctype html><html><body style="margin:0;background:#0d0d0d;color:#f5f5f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;"><div><div style="font-size:28px;color:#d4a017;margin-bottom:10px;">◈</div><p style="margin:0;font-size:15px;">Loading sponsor ad...</p></div></body></html>'
          );
        }
      } catch (_) {
        popup = null;
      }
    }

    const task = (async () => {
      try {
        if (isTelegramWebApp()) {
          return await runInAppInterstitialFallback(trigger, { purpose, targetId });
        }

        // Step 1: Create verified Robins Ads reward session on backend
        const createRes = await fetch('/api/ads/rewards/create', {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ purpose, targetId, coins }),
        });

        const createJson = await createRes.json().catch(() => ({}));
        const session = createJson?.data || createJson || {};
        const sessionId = session.id || session.rewardId || session._id;
        const popupUrl = session.popup_url || session.popupUrl || session.url;

        if (!createRes.ok || !sessionId || !popupUrl) {
          try {
            if (popup && !popup.closed) popup.close();
          } catch (_) {}
          throw new Error(
            createJson?.message || 'No sponsor ad available right now. Please try again.'
          );
        }

        // Step 2: Navigate the already-opened popup window to Robins Ads hosted interstitial
        if (popup && !popup.closed) {
          popup.location.href = popupUrl;
        } else {
          return await runInAppInterstitialFallback(trigger, { purpose, targetId });
        }

        setTriggerStatus(trigger, 'Watching sponsor ad... Finish to verify');

        // Step 3: Poll backend until Robins Ads server verifies completion
        return await pollRewardUntilTerminal({
          rewardId: sessionId,
          purpose,
          targetId,
          popupWindow: popup,
          trigger,
        });
      } catch (err) {
        try {
          if (popup && !popup.closed) popup.close();
        } catch (_) {}
        resetTriggerButton(trigger);
        emitLifecycleEvent('robins:error', trigger, { message: err.message });
        showStatusToast(err.message || 'Could not complete sponsor ad.', 'error');
        throw err;
      } finally {
        activeSession = null;
      }
    })();

    activeSession = task;
    return task;
  }

  async function refresh() {
    document.querySelectorAll('[data-robins-rewarded], [data-rs-rewarded]').forEach((el) => {
      if (!el.dataset.robinsLoading && !el.dataset.robinsVerifying) {
        el.disabled = false;
      }
    });
  }

  function initAds() {
    if (window.__afriStoryAdsInitialized) return;
    window.__afriStoryAdsInitialized = true;

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-robins-rewarded], [data-rs-rewarded]');
      if (!trigger || trigger.disabled || trigger.dataset.robinsLoading === 'true') return;

      event.preventDefault();
      event.stopPropagation();
      window.__lastRobinsTrigger = trigger;
      launchRewardedAd({ trigger }).catch(() => {});
    });
  }

  window.AfriStoryAds = {
    launchRewardedAd,
    showRewardedAd: launchRewardedAd,
    requestRewardedAd: launchRewardedAd,
    showSponsoredMessage: launchRewardedAd,
    refresh,
    initAds,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds, { once: true });
  } else {
    initAds();
  }
})();

const {
  launchRewardedAd,
  showRewardedAd,
  requestRewardedAd,
  showSponsoredMessage,
  refresh,
  initAds,
} = window.AfriStoryAds;

export {
  launchRewardedAd,
  showRewardedAd,
  requestRewardedAd,
  showSponsoredMessage,
  refresh,
  initAds,
};
