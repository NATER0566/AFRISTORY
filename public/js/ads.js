const Ads = (() => {
  // PHASE 4: Adscod Advertising enabled. This is strictly for display.
  // It DOES NOT grant premium unlocks.
  const ADS_ENABLED = true; 

  const api = async (path, options = {}) => { 
    const response = await fetch(`/api${path}`, { credentials: 'include', ...options }); 
    const data = await response.json().catch(() => ({})); 
    if (!response.ok || data.success === false) throw new Error(data.message || 'Sponsored message unavailable'); 
    return data; 
  };

  // Kept for backward compatibility to prevent console errors from old code
  async function refresh() { 
      return true; 
  }

  // Replaces legacy showRewarded. Fetches and displays a sponsored message.
  async function showSponsoredMessage() {
    if (!ADS_ENABLED) {
        throw new Error('Sponsored messages are currently unavailable.');
    }
    
    try {
      // Fetch from our secure backend proxy
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
    const modal = document.createElement('div');
    modal.className = 'modal-root';
    modal.style.zIndex = '9999999';
    
    let mediaHtml = '';
    if (adData.videoUrl) {
       mediaHtml = `<video src="${adData.videoUrl}" controls autoplay style="width:100%; max-height:300px; background:#000;"></video>`;
    } else if (adData.imageUrl) {
       mediaHtml = `<img src="${adData.imageUrl}" style="width:100%; max-height:300px; object-fit:contain; background:#000;">`;
    } else if (adData.adContent) {
       mediaHtml = `<div style="padding:10px; background:#fff; color:#000;">${adData.adContent}</div>`;
    }

    modal.innerHTML = `
      <div class="modal" style="padding:0; overflow:hidden; background:#111; border:1px solid #333;">
        <div style="padding:10px 15px; background:#222; display:flex; justify-content:space-between; align-items:center;">
          <span style="color:#999; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">Sponsored Message</span>
          <button class="modal-close" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>
        </div>
        ${mediaHtml}
        <div style="padding:20px;">
          <h3 style="margin:0 0 10px 0; color:#fff;">${adData.title || 'Sponsored Content'}</h3>
          <p style="color:#ccc; font-size:14px; margin:0 0 20px 0;">${adData.description || ''}</p>
          ${adData.clickUrl ? `<a href="${adData.clickUrl}" target="_blank" class="button button-primary" style="display:block; text-align:center; text-decoration:none;">Learn More</a>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // CRITICAL SECURITY: Closing the ad simply removes the DOM element. 
    // It DOES NOT send an unlock request to the server.
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => {
      modal.remove();
    });
  }

  return { 
      refresh, 
      showSponsoredMessage, 
      get isEnabled() { return ADS_ENABLED; } 
  };
})();

window.AfroStoryAds = Ads;
