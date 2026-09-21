const Ads = (() => {
  // Ads are currently disabled for premium unlocks until the provider integration is verified.
  const ADS_ENABLED = false; 
  let currentEpisode = null;

  const api = async (path, options = {}) => { 
    const response = await fetch(`/api${path}`, { credentials: 'include', ...options }); 
    const data = await response.json().catch(() => ({})); 
    if (!response.ok || data.success === false) throw new Error(data.message || 'Ad request failed'); 
    return data; 
  };

  // Kept for compatibility with main.js, but no longer fetches legacy daily quotas
  async function refresh() { 
      return true; 
  }

  async function showRewarded(episodeId) {
    if (!ADS_ENABLED) {
        throw new Error('Rewarded ads are currently unavailable. Please try again later or unlock this episode with coins.');
    }
    
    currentEpisode = episodeId;
    
    // PHASE 1: Client-trusted fake completions are permanently removed.
    // Future Phase 4/6 will implement the real Adscod display and secure verification here.
    throw new Error('Rewarded ads are currently unavailable. Please try again later or unlock this episode with coins.');
  }

  return { 
      refresh, 
      showRewarded, 
      get isEnabled() { return ADS_ENABLED; } 
  };
})();

window.AfroStoryAds = Ads;
