const ROBINS_WEBSITE_ID = '6b06e5d10354f7305a5bc51b';
const ROBINS_ZONE_ID = '9824292';
const ROBINS_SCRIPT_URL = 'https://robinsads.com/ads.js';

export const Ads = (() => {
  const ADS_ENABLED = true;

  function ensureRobinsScript() {
    if (document.querySelector(`script[src*="robinsads.com/ads.js"]`)) {
      return;
    }
    const script = document.createElement('script');
    script.src = ROBINS_SCRIPT_URL;
    script.async = true;
    script.dataset.websiteId = ROBINS_WEBSITE_ID;
    script.dataset.zoneId = ROBINS_ZONE_ID;
    (document.head || document.body || document.documentElement).appendChild(script);
  }

  function mountRobinsSlot(container, zoneId = ROBINS_ZONE_ID) {
    if (!container || !ADS_ENABLED) return;
    ensureRobinsScript();

    container.dataset.robinsWebsiteId = ROBINS_WEBSITE_ID;
    container.dataset.robinsZoneId = String(zoneId);

    if (!container.querySelector('[data-robins-zone]')) {
      const slot = document.createElement('div');
      slot.dataset.robinsZone = String(zoneId);
      slot.dataset.websiteId = ROBINS_WEBSITE_ID;
      container.appendChild(slot);
    }

    if (window.RobinsAds && typeof window.RobinsAds.refresh === 'function') {
      try {
        window.RobinsAds.refresh(container);
      } catch (_) {}
    }
  }

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

  async function refresh() {
    if (!ADS_ENABLED) return false;
    ensureRobinsScript();

    document.querySelectorAll('[data-robins-ad]').forEach((el) => {
      mountRobinsSlot(el, el.dataset.robinsZoneId || ROBINS_ZONE_ID);
    });

    if (window.RobinsAds && typeof window.RobinsAds.refresh === 'function') {
      try {
        window.RobinsAds.refresh();
      } catch (_) {}
    }

    return true;
  }

  function showRewardedAd(options = {}) {
    return new Promise((resolve) => {
      if (!ADS_ENABLED) {
        resolve({ completed: false, reason: 'disabled' });
        return;
      }

      ensureRobinsScript();
      const zoneId = String(options.zoneId || ROBINS_ZONE_ID);
      let settled = false;

      const cleanup = () => {
        window.removeEventListener('robins:rewarded', onRewarded, true);
        document.removeEventListener('robins:rewarded', onRewarded, true);
        ['robins:closed', 'robins:cancel', 'robins:error', 'robins:no-fill'].forEach((evtName) => {
          window.removeEventListener(evtName, onDismiss, true);
          document.removeEventListener(evtName, onDismiss, true);
        });
        clearTimeout(timer);
      };

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(payload);
      };

      const onRewarded = (event) => {
        finish({
          completed: true,
          zoneId,
          detail: event?.detail || {}
        });
      };

      const onDismiss = (event) => {
        finish({
          completed: false,
          zoneId,
          reason: event?.type || 'dismissed'
        });
      };

      window.addEventListener('robins:rewarded', onRewarded, true);
      document.addEventListener('robins:rewarded', onRewarded, true);
      ['robins:closed', 'robins:cancel', 'robins:error', 'robins:no-fill'].forEach((evtName) => {
        window.addEventListener(evtName, onDismiss, true);
        document.addEventListener(evtName, onDismiss, true);
      });

      const timer = setTimeout(() => {
        finish({ completed: false, zoneId, reason: 'timeout' });
      }, 25000);

      if (window.RobinsAds && typeof window.RobinsAds.showRewarded === 'function') {
        Promise.resolve()
          .then(() => window.RobinsAds.showRewarded({ websiteId: ROBINS_WEBSITE_ID, zoneId }))
          .then((result) => {
            if (result && result.rewarded === true) {
              finish({ completed: true, zoneId, detail: result });
            } else if (result && result.rewarded === false) {
              finish({ completed: false, zoneId, reason: result.reason || 'not_rewarded' });
            }
          })
          .catch((err) => {
            finish({ completed: false, zoneId, reason: err?.message || 'error' });
          });
      }
    });
  }

  async function showSponsoredMessage() {
    if (!ADS_ENABLED) {
      throw new Error('Sponsored messages are currently unavailable.');
    }

    ensureRobinsScript();

    try {
      const res = await api('/ads/serve');
      const adData = res.data;

      if (!adData || (!adData.imageUrl && !adData.videoUrl && !adData.adContent)) {
        throw new Error('No sponsored messages available right now.');
      }

      renderAdModal(adData);
    } catch (error) {
      throw new Error(error.message || 'Sponsored messages are currently unavailable.');
    }
  }

  function renderAdModal(adData) {
    const existing = document.getElementById('afrostory-ad-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'afrostory-ad-modal';
    modal.className = 'modal-root';
    modal.style.zIndex = '9999999';

    const closeModal = () => {
      modal.querySelectorAll('video').forEach(v => {
        v.pause();
        v.removeAttribute('src');
        v.load();
      });
      modal.remove();
    };

    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    const modalContent = document.createElement('div');
    modalContent.className = 'modal';
    modalContent.style.cssText = 'padding:0; overflow:hidden; background:#111; border:1px solid #333;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 15px; background:#222; display:flex; justify-content:space-between; align-items:center;';
    header.innerHTML = '<span style="color:#999; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">Sponsored Message</span>';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.style.cssText = 'background:none; border:none; color:#fff; font-size:24px; cursor:pointer;';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeModal;

    header.appendChild(closeBtn);
    modalContent.appendChild(header);

    function isValidHttpsUrl(urlStr) {
      if (!urlStr) return false;
      try {
        const parsed = new URL(urlStr);
        return parsed.protocol === 'https:';
      } catch (e) {
        return false;
      }
    }

    if (adData.videoUrl && isValidHttpsUrl(adData.videoUrl)) {
      const video = document.createElement('video');
      video.src = adData.videoUrl;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = 'width:100%; max-height:300px; background:#000;';
      modalContent.appendChild(video);
      video.play().catch(() => {});
    } else if (adData.imageUrl && isValidHttpsUrl(adData.imageUrl)) {
      const img = document.createElement('img');
      img.src = adData.imageUrl;
      img.alt = adData.title || 'Sponsored Content';
      img.style.cssText = 'width:100%; max-height:300px; object-fit:contain; background:#000;';
      modalContent.appendChild(img);
    } else if (adData.adContent) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(adData.adContent, 'text/html');

      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'padding:10px; background:#fff; color:#000; max-height: 300px; overflow-y: auto;';

      function sanitizeAndAppend(sourceNode, targetNode) {
        const safeTags = ['B', 'I', 'U', 'STRONG', 'EM', 'P', 'BR', 'DIV', 'SPAN', 'A', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE'];
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
                } catch (e) {
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

      sanitizeAndAppend(doc.body, contentDiv);
      modalContent.appendChild(contentDiv);
    }

    const body = document.createElement('div');
    body.style.padding = '20px';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 10px 0; color:#fff;';
    title.textContent = adData.title || 'Sponsored Content';
    body.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'color:#ccc; font-size:14px; margin:0 0 20px 0;';
    desc.textContent = adData.description || '';
    body.appendChild(desc);

    if (isValidHttpsUrl(adData.clickUrl)) {
      const link = document.createElement('a');
      link.href = adData.clickUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'button button-primary';
      link.style.cssText = 'display:block; text-align:center; text-decoration:none;';
      link.textContent = 'Learn More';
      body.appendChild(link);
    }

    modalContent.appendChild(body);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
  }

  return {
    websiteId: ROBINS_WEBSITE_ID,
    zoneId: ROBINS_ZONE_ID,
    ensureRobinsScript,
    mountRobinsSlot,
    refresh,
    showRewardedAd,
    showSponsoredMessage,
    get isEnabled() { return ADS_ENABLED; }
  };
})();

window.AfroStoryAds = Ads;
window.RobinsAds = window.RobinsAds || Ads;
window.Ads = Ads;

export default Ads;
