const Ads = (() => {
  const ADS_ENABLED = true;
  const ROBINS_SCRIPT_URL = 'https://robinsads.com/ads.js';
  const ROBINS_WEBSITE_ID = '6b06e5d10354f7305a5bc51b';
  const ROBINS_ZONE_ID = '9824292';

  const api = async (path, options = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api${path}`, {
        credentials: 'include',
        signal: controller.signal,
        ...options
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Sponsored message unavailable');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Sponsored message timed out');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  function ensureRobinsScript() {
    if (!ADS_ENABLED || typeof document === 'undefined') return null;
    let script = document.querySelector(`script[src*="robinsads.com/ads.js"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = ROBINS_SCRIPT_URL;
      script.async = true;
      script.setAttribute('data-website-id', ROBINS_WEBSITE_ID);
      document.head.appendChild(script);
    } else if (!script.getAttribute('data-website-id')) {
      script.setAttribute('data-website-id', ROBINS_WEBSITE_ID);
    }
    return script;
  }

  function getRobinsSdk() {
    return (
      window.robinsAds ||
      window.RobinsAds ||
      window.robins ||
      window.Robins ||
      null
    );
  }

  function mountDisplaySlot(slotEl) {
    if (!slotEl || !ADS_ENABLED) return;
    slotEl.setAttribute('data-website-id', ROBINS_WEBSITE_ID);
    slotEl.setAttribute('data-zone-id', ROBINS_ZONE_ID);

    if (!slotEl.querySelector('.robins-zone-anchor')) {
      const zoneAnchor = document.createElement('div');
      zoneAnchor.className = 'robins-zone-anchor';
      zoneAnchor.setAttribute('data-robins-zone', ROBINS_ZONE_ID);
      zoneAnchor.setAttribute('data-website-id', ROBINS_WEBSITE_ID);
      zoneAnchor.setAttribute('data-zone-id', ROBINS_ZONE_ID);
      zoneAnchor.style.cssText = 'width:100%; display:flex; justify-content:center; align-items:center;';
      slotEl.appendChild(zoneAnchor);
    }
  }

  async function refresh() {
    if (!ADS_ENABLED) return false;
    ensureRobinsScript();

    document.querySelectorAll('[data-robins-ad], #global-ad-slot').forEach((slot) => {
      mountDisplaySlot(slot);
    });

    const sdk = getRobinsSdk();
    try {
      if (sdk && typeof sdk.refresh === 'function') {
        await sdk.refresh({ websiteId: ROBINS_WEBSITE_ID, zoneId: ROBINS_ZONE_ID });
      } else if (sdk && typeof sdk.load === 'function') {
        await sdk.load({ websiteId: ROBINS_WEBSITE_ID, zoneId: ROBINS_ZONE_ID });
      } else if (sdk && typeof sdk.init === 'function') {
        sdk.init({ websiteId: ROBINS_WEBSITE_ID, zoneId: ROBINS_ZONE_ID });
      }
    } catch (_) {
      // Non-fatal: Robins Ads auto-scans DOM zones asynchronously
    }

    return true;
  }

  function isValidHttpsUrl(urlStr) {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function sanitizeAndAppend(sourceNode, targetNode) {
    const safeTags = [
      'B', 'I', 'U', 'STRONG', 'EM', 'P', 'BR', 'DIV', 'SPAN', 'A', 'IMG',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE'
    ];
    const safeAttributes = ['href', 'src', 'alt', 'title', 'target', 'rel'];

    for (let i = 0; i < sourceNode.childNodes.length; i++) {
      const child = sourceNode.childNodes[i];

      if (child.nodeType === Node.TEXT_NODE) {
        targetNode.appendChild(document.createTextNode(child.textContent));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toUpperCase();
        if (!safeTags.includes(tagName)) continue;

        const el = document.createElement(tagName);

        for (let j = 0; j < child.attributes.length; j++) {
          const attr = child.attributes[j];
          const name = attr.name.toLowerCase();
          const val = attr.value;

          if (!safeAttributes.includes(name)) continue;

          if (name === 'href' || name === 'src') {
            try {
              const parsed = new URL(val, window.location.origin);
              if (parsed.protocol !== 'https:') continue;
            } catch (_) {
              continue;
            }
          }

          el.setAttribute(name, val);
        }

        if (tagName === 'A') {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }

        sanitizeAndAppend(child, el);
        targetNode.appendChild(el);
      }
    }
  }

  function dispatchRewardedCompletion(triggerEl, detail = {}) {
    const payload = {
      provider: 'robinsads',
      websiteId: ROBINS_WEBSITE_ID,
      zoneId: ROBINS_ZONE_ID,
      completedAt: Date.now(),
      ...detail
    };

    if (triggerEl && typeof triggerEl.dispatchEvent === 'function') {
      triggerEl.dispatchEvent(new CustomEvent('robins:rewarded', { bubbles: true, detail: payload }));
      triggerEl.dispatchEvent(new CustomEvent('rs:rewarded', { bubbles: true, detail: payload }));
    } else {
      document.dispatchEvent(new CustomEvent('robins:rewarded', { bubbles: true, detail: payload }));
      window.dispatchEvent(new CustomEvent('robins:rewarded', { detail: payload }));
    }
  }

  function dispatchRewardedClosed() {
    window.dispatchEvent(new CustomEvent('robins:closed'));
    document.dispatchEvent(new CustomEvent('robins:closed'));
  }

  // Renders Robins Ads Zone 9824292 (plus optional /api/ads/serve fallback) inside a timed sponsor modal
  function renderSponsoredModal(adData = null, options = {}) {
    const { rewarded = false, durationSeconds = 5, triggerEl = null } = options;

    return new Promise((resolve, reject) => {
      const existing = document.getElementById('afrostory-ad-modal');
      if (existing) existing.remove();

      let settled = false;
      let timerInterval = null;
      let remaining = Math.max(3, Number(durationSeconds) || 5);

      const modal = document.createElement('div');
      modal.id = 'afrostory-ad-modal';
      modal.className = 'modal-root';
      modal.style.zIndex = '9999999';

      const cleanup = () => {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        modal.querySelectorAll('video').forEach((v) => {
          v.pause();
          v.removeAttribute('src');
          v.load();
        });
        modal.remove();
      };

      const cancelModal = () => {
        if (settled) return;
        settled = true;
        cleanup();
        dispatchRewardedClosed();
        if (rewarded) {
          reject(new Error('Sponsored ad was closed before completion.'));
        } else {
          resolve({ completed: false });
        }
      };

      const completeReward = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const detail = {
          provider: 'robinsads',
          websiteId: ROBINS_WEBSITE_ID,
          zoneId: ROBINS_ZONE_ID
        };
        dispatchRewardedCompletion(triggerEl, detail);
        resolve({ completed: true, ...detail });
      };

      modal.onclick = (e) => {
        if (e.target === modal && (!rewarded || remaining <= 0)) {
          cancelModal();
        }
      };

      const modalContent = document.createElement('div');
      modalContent.className = 'modal';
      modalContent.style.cssText =
        'padding:0; overflow:hidden; background:#111; border:1px solid rgba(212,160,23,0.45); max-width:520px;';

      // Header
      const header = document.createElement('div');
      header.style.cssText =
        'padding:12px 16px; background:#1a1a1a; border-bottom:1px solid #2b2b2b; display:flex; justify-content:space-between; align-items:center; gap:12px;';

      const labelSpan = document.createElement('span');
      labelSpan.style.cssText =
        'color:#d4a017; font-size:11.5px; font-weight:700; letter-spacing:1px; text-transform:uppercase;';
      labelSpan.textContent = rewarded ? 'Sponsor Break • Unlock Reward' : 'Sponsored Message';
      header.appendChild(labelSpan);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'modal-close';
      closeBtn.style.cssText =
        'background:none; border:none; color:#fff; font-size:22px; cursor:pointer; line-height:1;';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = rewarded ? 'Cancel sponsor break' : 'Close';
      closeBtn.onclick = cancelModal;
      header.appendChild(closeBtn);

      modalContent.appendChild(header);

      // Robins Ads Live Zone Slot (Website ID: 6b06e5d10354f7305a5bc51b | Zone ID: 9824292)
      const robinsStage = document.createElement('div');
      robinsStage.style.cssText =
        'padding:16px; background:#0b0b0d; min-height:180px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-bottom:1px solid #222;';

      const robinsSlot = document.createElement('div');
      robinsSlot.setAttribute('data-robins-ad', '');
      robinsSlot.setAttribute('data-website-id', ROBINS_WEBSITE_ID);
      robinsSlot.setAttribute('data-zone-id', ROBINS_ZONE_ID);
      robinsSlot.style.cssText = 'width:100%; min-height:140px; display:flex; justify-content:center; align-items:center;';
      mountDisplaySlot(robinsSlot);
      robinsStage.appendChild(robinsSlot);
      modalContent.appendChild(robinsStage);

      // Optional internal sponsored media if /api/ads/serve returned creative
      if (adData && adData.videoUrl && isValidHttpsUrl(adData.videoUrl)) {
        const video = document.createElement('video');
        video.src = adData.videoUrl;
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.style.cssText = 'width:100%; max-height:260px; background:#000; display:block;';
        modalContent.appendChild(video);
        video.play().catch(() => {});
      } else if (adData && adData.imageUrl && isValidHttpsUrl(adData.imageUrl)) {
        const img = document.createElement('img');
        img.src = adData.imageUrl;
        img.alt = adData.title || 'Sponsored Content';
        img.style.cssText = 'width:100%; max-height:260px; object-fit:contain; background:#000; display:block;';
        modalContent.appendChild(img);
      } else if (adData && adData.adContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(adData.adContent, 'text/html');
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'padding:12px; background:#fff; color:#000; max-height:240px; overflow-y:auto;';
        sanitizeAndAppend(doc.body, contentDiv);
        modalContent.appendChild(contentDiv);
      }

      // Footer / Reward Countdown Action
      const body = document.createElement('div');
      body.style.cssText = 'padding:18px 20px; text-align:center;';

      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 8px 0; color:#fff; font-size:17px;';
      title.textContent = (adData && adData.title) || 'AfriStory Sponsor Support';
      body.appendChild(title);

      const desc = document.createElement('p');
      desc.style.cssText = 'color:#bdbdbd; font-size:13.5px; margin:0 0 16px 0; line-height:1.45;';
      desc.textContent =
        (adData && adData.description) ||
        (rewarded
          ? 'Thank you for supporting African storytellers. Your reward unlocks automatically in a few seconds.'
          : 'Discover our featured partner message.');
      body.appendChild(desc);

      if (adData && isValidHttpsUrl(adData.clickUrl)) {
        const link = document.createElement('a');
        link.href = adData.clickUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'button button-quiet';
        link.style.cssText = 'display:block; text-align:center; text-decoration:none; margin-bottom:10px;';
        link.textContent = 'Visit Sponsor ↗';
        body.appendChild(link);
      }

      if (rewarded) {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'button button-primary';
        actionBtn.style.cssText = 'width:100%; font-weight:700;';
        actionBtn.disabled = true;
        actionBtn.textContent = `Unlocking in ${remaining}s...`;
        actionBtn.onclick = completeReward;
        body.appendChild(actionBtn);

        timerInterval = setInterval(() => {
          remaining -= 1;
          if (remaining > 0) {
            actionBtn.textContent = `Unlocking in ${remaining}s...`;
          } else {
            clearInterval(timerInterval);
            timerInterval = null;
            actionBtn.disabled = false;
            actionBtn.textContent = 'Claim Reward & Continue →';
            completeReward();
          }
        }, 1000);
      }

      modalContent.appendChild(body);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      refresh().catch(() => {});
    });
  }

  async function showSponsoredMessage(options = {}) {
    if (!ADS_ENABLED) {
      throw new Error('Sponsored messages are currently unavailable.');
    }

    ensureRobinsScript();
    const sdk = getRobinsSdk();

    // 1. Try native Robins Ads programmatic rewarded/interstitial API if exposed by robinsads.com/ads.js
    if (sdk) {
      try {
        if (options.rewarded && typeof sdk.showRewarded === 'function') {
          const result = await sdk.showRewarded({
            websiteId: ROBINS_WEBSITE_ID,
            zoneId: ROBINS_ZONE_ID
          });
          dispatchRewardedCompletion(options.triggerEl || null, result || {});
          return { completed: true, provider: 'robinsads-sdk' };
        }
        if (typeof sdk.showInterstitial === 'function') {
          const result = await sdk.showInterstitial({
            websiteId: ROBINS_WEBSITE_ID,
            zoneId: ROBINS_ZONE_ID
          });
          if (options.rewarded) {
            dispatchRewardedCompletion(options.triggerEl || null, result || {});
          }
          return { completed: true, provider: 'robinsads-sdk' };
        }
      } catch (sdkErr) {
        if (options.rewarded && sdkErr && sdkErr.cancelled) {
          dispatchRewardedClosed();
          throw new Error('Sponsored ad was closed before completion.');
        }
      }
    }

    // 2. Fetch optional server-side sponsored creative as enrichment, without blocking Robins Ads zone
    let adData = null;
    try {
      const res = await api('/ads/serve');
      adData = res.data || null;
    } catch (_) {
      adData = null;
    }

    return renderSponsoredModal(adData, options);
  }

  // Automatically bind rewarded ad clicks on [data-robins-rewarded] (and legacy [data-rs-rewarded])
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      refresh().catch(() => {});
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-robins-rewarded], [data-rs-rewarded]');
      if (!trigger) return;

      // Avoid double-triggering if already handled by custom inline flow
      if (trigger.dataset.robinsHandled === 'true') return;
      trigger.dataset.robinsHandled = 'true';

      showSponsoredMessage({
        rewarded: true,
        durationSeconds: Number(trigger.dataset.adDuration || 5),
        triggerEl: trigger
      })
        .catch(() => {})
        .finally(() => {
          delete trigger.dataset.robinsHandled;
        });
    });
  }

  return {
    refresh,
    showSponsoredMessage,
    mountDisplaySlot,
    get websiteId() { return ROBINS_WEBSITE_ID; },
    get zoneId() { return ROBINS_ZONE_ID; },
    get isEnabled() { return ADS_ENABLED; }
  };
})();

window.AfroStoryAds = Ads;
window.Ads = Ads;

export { Ads };
export default Ads;
