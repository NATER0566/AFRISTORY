const Ads = (() => {
  const DAILY_LIMIT = 3;
  const ADS_ENABLED = false; // Set to false - NO real ads configured yet
  let remaining = DAILY_LIMIT;
  let currentEpisode = null;
  const api = async (path, options = {}) => { const response = await fetch(`/api${path}`, { credentials: 'include', ...options }); const data = await response.json().catch(() => ({})); if (!response.ok || data.success === false) throw new Error(data.message || 'Ad unlock failed'); return data; };
  function setRemaining(value) { remaining = Math.max(0, Number(value) || 0); document.querySelectorAll('#ad-balance').forEach(el => { el.textContent = remaining; }); }
  async function refresh() { try { const data = await api('/ads/unlocks/remaining'); setRemaining(data.data?.adUnlocksRemaining); } catch { setRemaining(0); } return remaining; }
  function createPayload() { return { provider: 'monetag', completedAt: new Date().toISOString(), nonce: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` }; }
  async function showRewarded(episodeId) {
    if (!ADS_ENABLED) throw new Error('Ad unlocks are not available yet. Please use coins to unlock.');
    currentEpisode = episodeId; await refresh();
    if (remaining < 1) throw new Error('You have used all three ad unlocks for today');
    if (window.Swal) { const result = await Swal.fire({ title: 'Watch to unlock', text: 'Complete the rewarded ad to unlock this episode.', confirmButtonText: 'Watch ad', confirmButtonColor: '#e67e22', showCancelButton: true, cancelButtonText: 'Not now', background: '#242424', color: '#f5f5f5' }); if (!result.isConfirmed) return null; }
    const result = await api('/ads/verify-completion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: currentEpisode, adPayload: createPayload() }) });
    setRemaining(result.data?.adUnlocksRemaining ?? remaining - 1); return result;
  }
  return { refresh, showRewarded, get remaining() { return remaining; }, get isEnabled() { return ADS_ENABLED; } };
})();
window.AfroStoryAds = Ads;
