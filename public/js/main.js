const API = '/api';
const state = { user: null, profile: null, rewards: null, series: [], currentSeries: null, currentEpisode: null, hls: null, recommendedEpisodes: [] };
// Performance optimization: Request caching
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const api = async (path, options = {}) => { 
  const cacheKey = `${path}:${JSON.stringify(options)}`; 
  const cached = apiCache.get(cacheKey); 
  if (cached && Date.now() - cached.time < CACHE_DURATION && options.method !== 'POST') return cached.data; 
  
  try { 
    const timeoutMs = options.timeout || 600000; 
    const response = await fetch(`${API}${path}`, { 
      credentials: 'include', 
      signal: AbortSignal.timeout(timeoutMs), 
      ...options 
    }); 
    
    const data = await response.json().catch(() => ({})); 
    
    if (response.status === 401) { 
      window.location.replace('/'); 
      throw new Error('Your session has expired'); 
    } 
    
    if (!response.ok || data.success === false) {
      throw new Error(data.message || 'Request failed');
    }
    
    if (options.method !== 'POST') {
      apiCache.set(cacheKey, { data: data.data, time: Date.now() }); 
    }
    return data.data; 
    
  } catch (error) { 
    if (error.name === 'AbortError') throw new Error('Request timeout - please check your connection and try again'); 
    throw error; 
  } 
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const image = value => {
  if (!value) value = 'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?auto=format&fit=crop&w=400&q=70';
  if (value.includes('unsplash')) return `${value}&auto=format&fit=crop&w=400&q=70`;
  if (value.includes('cloudinary')) return value.replace('/upload/', '/upload/q_auto,w_400/');
  return value;
};
function getUserDisplayName(user) {
  return user?.profile?.displayName || user?.displayName || user?.username || 'Account';
}
function getUserAvatarUrl(user) {
  return user?.profile?.avatarUrl || user?.profileImage || user?.avatarUrl || null;
}
function renderHeaderUser(user = state.user) {
  const avatarWrap = $('#user-avatar');
  const nameEl = $('#user-name');
  if (!avatarWrap) return;
  
  const displayName = getUserDisplayName(user);
  const avatarUrl = getUserAvatarUrl(user);
  
  if (nameEl) {
    nameEl.textContent = displayName;
    nameEl.title = displayName;
  }
  
  if (avatarUrl) {
    const cacheBust = `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    avatarWrap.innerHTML = `<img src="${image(cacheBust)}" alt="${esc(displayName)} profile picture" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"/>`;
  } else {
    const initial = (displayName || 'A').trim().charAt(0).toUpperCase() || 'A';
    avatarWrap.innerHTML = `<span id="user-initial" class="profile-initial">${esc(initial)}</span>`;
  }
  avatarWrap.parentElement.setAttribute('aria-label', `${displayName} profile menu`);
  avatarWrap.parentElement.setAttribute('title', displayName);
}

function toast(message, type = 'info') { 
  const el = document.createElement('div'); 
  el.className = `toast ${type}`; 
  el.setAttribute('role', 'alert'); 
  el.innerHTML = `<span class="toast-icon"></span><span class="toast-message">${esc(message)}</span>`; 
  const container = $('#toast-region'); 
  if (!container) return; 
  container.appendChild(el); 
  
  setTimeout(() => { 
    el.style.animation = 'fadeOutToast 0.4s ease-out forwards'; 
    setTimeout(() => el.remove(), 400); 
  }, 4000); 
}

function setupLazyLoading() { if ('IntersectionObserver' in window) { const observer = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting && entry.target.dataset.src) { entry.target.src = entry.target.dataset.src; delete entry.target.dataset.src; observer.unobserve(entry.target); } }); }, { rootMargin: '50px' }); $$('[data-src]').forEach(el => observer.observe(el)); } }

function setSection(name) { 
  $$('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== `section-${name}`)); 
  $$('.nav-item[data-section]').forEach(item => item.classList.toggle('active', item.dataset.section === name)); 
  $('#genre-filter')?.closest('.discover-filters')?.classList.toggle('hidden', name !== 'discover'); 
  $('#save-current')?.classList.toggle('hidden', name !== 'watch'); 
  
  $$('.modal-root').forEach(m => m.classList.add('hidden'));
  $('#mobile-more-sheet')?.classList.add('hidden');
  
  location.hash = name; 
  if (name === 'wallet') loadWallet(); if (name === 'rewards') loadRewards(); if (name === 'creator') loadCreator(); if (name === 'admin') loadAdmin(); if (name === 'history') loadHistory(); if (name === 'continue') loadContinue(); if (name === 'favorites') loadFavorites(); if (name === 'trending') loadTrending(); if (name === 'settings') loadSettings(); if (name === 'watch') loadWatchRecommended(); 
}

const episodeGenres = ['Action', 'Drama', 'Comedy', 'Romance', 'Thriller', 'Horror', 'Adventure', 'Family', 'Historical', 'Traditional', 'Documentary', 'Educational', 'Faith', 'Mystery', 'Other'];
const culturalCategories = ['Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Nupe', 'Fulani', 'Edo', 'Efik', 'Ibibio', 'Kanuri', 'Ijaw', 'Other African culture'];
const episodeLanguages = ['English', 'Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Edo', 'Efik', 'Ibibio', 'Nupe', 'Fulfulde', 'Kanuri', 'Ijaw', 'Other'];
function options(values) { return values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join(''); }
function ensureClassificationControls() { const filters = $('.discover-filters'); if (filters && !$('#cultural-filter')) filters.insertAdjacentHTML('beforeend', `<label>Cultural category<select id="cultural-filter"><option value="">All cultures</option>${options(culturalCategories)}</select></label><label>Language<select id="language-filter"><option value="">All languages</option>${options(episodeLanguages)}</select></label>`); const form = $('#upload-form'); if (form && !$('#upload-genre')) { const access = form.querySelector('[name="access"]'); access.insertAdjacentHTML('beforebegin', `<label>Genre<select id="upload-genre" name="genre" required><option value="">Choose genre</option>${options(episodeGenres)}</select></label><label>Cultural category<select id="upload-cultural-category" name="culturalCategory" required><option value="">Choose culture</option>${options(culturalCategories)}</select></label><label>Language<select id="upload-language" name="language" required><option value="">Choose language</option>${options(episodeLanguages)}</select></label><label>Tags<input name="tags" maxlength="300" placeholder="family, tradition, village"></label>`); } }
function card(series) { return `<article class="series-card" data-series-id="${esc(series._id)}"><div class="card-image" style="background-image:url('${image(series.coverImage)}')"><span class="card-tag">${esc(series.genre || 'SERIES')}</span></div><div class="card-body"><h3>${esc(series.title)}</h3><p>★ ${Number(series.rating || 0).toFixed(1)} &nbsp; · &nbsp; ${esc(series.language || 'English')}</p></div></article>`; }
function episodeCard(episode) { const series = episode.seriesId || {}; const creator = series.creatorId || {}; return `<article class="series-card episode-card" data-episode-id="${esc(episode._id)}"><div class="card-image" style="background-image:url('${image(episode.thumbnailUrl || series.coverImage)}')"><span class="card-tag">${esc(episode.genre || 'EPISODE')}</span></div><div class="card-body"><h3>${esc(episode.title)}</h3><p>${esc(series.title || 'Story')} · ${esc(episode.culturalCategory || 'African story')}</p><p>${esc(creator.brandName || '')} · ${esc(episode.language || 'English')} · ${Math.round(Number(episode.duration || 0) / 60)} min</p></div></article>`; }

async function loadDiscover() { 
  try { 
    const genre = $('#genre-filter')?.value || ''; 
    const sort = $('#sort-filter')?.value || 'trending'; 
    const result = await api(`/series/discover/all?page=1&limit=12&sort=${encodeURIComponent(sort)}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`); 
    state.series = result.series || []; 
    const featured = state.series[0]; 
    $('#featured-series').innerHTML = featured ? `<article class="featured-card" style="background-image:url('${image(featured.coverImage)}')" data-series-id="${esc(featured._id)}"><p class="eyebrow">FEATURED SERIES</p><h2>${esc(featured.title)}</h2><p>${esc(featured.description || 'A new story is waiting.')}</p></article>` : '<div class="empty-state">No stories match this filter.</div>'; 
    $('#series-grid').innerHTML = state.series.map(card).join('') || '<div class="empty-state">No stories match this filter.</div>'; 
    
    let creatorsList = [];
    try {
        const cRes = await api('/creators/top/creators?limit=6').catch(() => null) || await api('/creators?limit=6').catch(() => null);
        creatorsList = cRes?.creators || cRes?.data || cRes || [];
        if (!Array.isArray(creatorsList)) creatorsList = [];
    } catch(e) {
        console.warn('Top creators could not be loaded', e);
    }
    
    $('#creator-grid').innerHTML = creatorsList.length > 0 
      ? creatorsList.map(creator => `<div class="creator-pill"><span class="creator-avatar">${creator.userId?.profileImage ? `<img src="${image(creator.userId.profileImage)}" alt="">` : esc((creator.brandName || 'C')[0])}</span><span><strong>${esc(creator.brandName)}</strong><br><small class="muted">${Number(creator.totalViews || 0).toLocaleString()} views</small></span></div>`).join('') 
      : '<div class="empty-state">No creators found yet.</div>'; 
      
  } catch (error) { 
    toast(error.message, 'error'); 
  } 
}

async function loadDiscoverEpisodes() { try { ensureClassificationControls(); const genre = $('#genre-filter')?.value || ''; const culturalCategory = $('#cultural-filter')?.value || ''; const language = $('#language-filter')?.value || ''; const query = new URLSearchParams({ sort: 'trending', limit: '12' }); if (genre) query.set('genre', genre); if (culturalCategory) query.set('culturalCategory', culturalCategory); if (language) query.set('language', language); const result = await api(`/episodes/feed?${query}`); $('#series-grid').innerHTML = (result.episodes || []).map(episodeCard).join('') || '<div class="empty-state">No episodes match these filters.</div>'; } catch (error) { toast(error.message, 'error'); } }

// MODIFIED: Automatically jump to Watch Section when a series is clicked
async function openSeries(id) { 
    try { 
        setSection('watch');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        const [series, episodes] = await Promise.all([api(`/series/${id}`), api(`/series/${id}/episodes?limit=100`)]); 
        state.currentSeries = series; 
        $('#watch-series-meta').innerHTML = `<h3>${esc(series.title)}</h3><p>${esc(series.description || '')}</p>`; 
        $('#watch-title').textContent = series.title; 
        $('#episode-list').innerHTML = (episodes.episodes || []).map((episode, index) => `<button class="episode-row ${index === 0 ? 'active' : ''}" data-episode-id="${esc(episode._id)}"><strong>${String(episode.episodeNumber).padStart(2, '0')}</strong><span>${esc(episode.title)}${episode.isFree ? ' · Free' : ''}</span></button>`).join(''); 
        
        if (episodes.episodes?.[0]) openEpisode(episodes.episodes[0]._id); 
    } catch (error) { 
        toast(error.message, 'error'); 
    } 
}

// MODIFIED: Automatically jump to Watch Section when an episode is clicked
async function openEpisode(id) {
  try {
    setSection('watch');
    window.scrollTo({ top: 0, behavior: 'smooth' });
      
    const episode = await api(`/episodes/${id}`);
    state.currentEpisode = episode;
    if (episode.seriesId && typeof episode.seriesId === 'object') state.currentSeries = episode.seriesId;
    $$('.episode-row').forEach(row => row.classList.toggle('active', row.dataset.episodeId === id));
    $('#watch-title').textContent = `${state.currentSeries?.title || ''} / ${episode.title}`;
    const video = $('#video-player');
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.poster = image(episode.thumbnailUrl || state.currentSeries?.coverImage);
    video.classList.remove('video-error');

    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }

    let mediaUrl = episode.hlsUrl || episode.mediaUrl || episode.videoUrl || '';
    let fallbackUrl = episode.mediaUrl || episode.videoUrl || episode.hlsUrl || '';
    
    if (!mediaUrl) throw new Error('This episode has no video URL yet.');

    if (mediaUrl.startsWith('http://')) mediaUrl = mediaUrl.replace('http://', 'https://');
    if (fallbackUrl.startsWith('http://')) fallbackUrl = fallbackUrl.replace('http://', 'https://');
    
    if (fallbackUrl.includes('cloudinary.com') && fallbackUrl.includes('.m3u8')) {
        const parts = fallbackUrl.split('/upload/');
        if (parts.length === 2) {
            const filePart = parts[1].replace('.m3u8', '.mp4');
            fallbackUrl = `${parts[0]}/upload/f_mp4,vc_auto/${filePart}`;
        }
    } else if (fallbackUrl) {
        fallbackUrl = fallbackUrl.replace('.m3u8', '.mp4');
    }

    const isHls = /\.m3u8(?:\?|$)/i.test(mediaUrl);

    video.onerror = () => {
        let errMessage = 'Video format not supported or network failed.';
        if (video.error && video.error.code === 4) errMessage = 'Video file could not be found or format is unsupported by your browser.';
        console.error("Native Video Error:", video.error);
        video.classList.add('video-error');
        toast(errMessage, 'error');
    };

    if (isHls && window.Hls?.isSupported()) {
      state.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      state.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn('HLS stream not ready. Auto-switching to raw mp4 fallback...');
          if (fallbackUrl && fallbackUrl !== mediaUrl) {
              state.hls.destroy();
              video.src = fallbackUrl;
              video.load();
              video.play().catch(e => console.error('Fallback play failed:', e));
          } else {
              video.classList.add('video-error');
              toast('Video is processing or temporarily unavailable. Try again soon.', 'error');
          }
        }
      });
      state.hls.loadSource(mediaUrl);
      state.hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = mediaUrl;
    } else {
      video.src = fallbackUrl;
    }

    video.play().catch(error => {
      if (error.name !== 'NotAllowedError') console.error('Video play failed:', error);
    });

    if (!episode.hasAccess) {
      $('#player-lock').classList.add('hidden');
      const previewTime = 10;
      const checkPreviewEnd = setInterval(() => {
        if (video.currentTime >= previewTime) {
          video.pause();
          $('#player-lock').classList.remove('hidden');
          clearInterval(checkPreviewEnd);
        }
      }, 500);
    } else {
      $('#player-lock').classList.add('hidden');
    }
    await loadComments(id);
  } catch (error) {
    console.error('Failed to open episode:', error);
    toast(error.message, 'error');
  }
}

async function unlockEpisode() { if (!state.currentEpisode) return; try { const hasActiveSubscription = state.user?.subscriptionExpiresAt && new Date(state.user.subscriptionExpiresAt) > new Date(); if (hasActiveSubscription) { toast('✓ This episode is included in your VIP subscription!', 'success'); return; } const hasAds = state.currentEpisode.adUnlockable && window.AfroStoryAds?.isEnabled; const userAdBalance = state.user?.adUnlocksRemaining || 0; const canUseAd = hasAds && userAdBalance > 0; let choice = 'coins'; if (canUseAd) { if (window.Swal) { const result = await Swal.fire({ title: '🎬 Unlock this episode', html: `<div style="text-align:left; font-size:14px;"><p><strong>📺 Watch Ad (Free)</strong></p><p style="color:#76a86b; font-weight:bold;">${userAdBalance} ad unlock${userAdBalance !== 1 ? 's' : ''} available today</p><hr style="border-color:#343434; margin:15px 0;"><p><strong>💰 Use Coins</strong></p><p style="color:#d4a017; font-weight:bold;">${state.currentEpisode.coinCost || 10} coins</p></div>`, showDenyButton: true, showCancelButton: true, confirmButtonText: '📺 Watch Ad Now', denyButtonText: `💰 Use ${state.currentEpisode.coinCost || 10} Coins`, cancelButtonText: 'Cancel', confirmButtonColor: '#76a86b', denyButtonColor: '#d4a017', background: '#1b1b1b', color: '#f5f5f5', allowOutsideClick: false, allowEscapeKey: false }); if (result.isDismissed) return; choice = result.isDenied ? 'coins' : 'ad'; } } else { if (window.Swal) { const result = await Swal.fire({ title: '🎬 Unlock this episode', html: `<p style="font-size:15px; line-height:1.6;"><strong style="color:#d4a017;">💰 Only coins available now</strong></p><p style="font-size:13px; color:#999; margin-top:10px;">Ad unlocks are coming soon!</p><p style="font-size:15px; margin-top:15px;">Use <strong style="color:#d4a017;">${state.currentEpisode.coinCost || 10} coins</strong> to unlock and continue</p>`, showCancelButton: true, confirmButtonText: `💰 Unlock with ${state.currentEpisode.coinCost || 10} Coins`, cancelButtonText: 'Cancel', confirmButtonColor: '#d4a017', background: '#1b1b1b', color: '#f5f5f5', allowOutsideClick: false, allowEscapeKey: false }); if (result.isDismissed) return; choice = 'coins'; } } if (choice === 'ad') await window.AfroStoryAds.showRewarded(state.currentEpisode._id); else await api('/wallet/unlock-episode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: state.currentEpisode._id }) }); await openEpisode(state.currentEpisode._id); toast('✨ Episode unlocked! Enjoy the story!', 'success'); } catch (error) { toast(error.message, 'error'); } }
async function loadComments(id) { try { const result = await api(`/comments/episode/${id}?limit=50`); const render = comment => `<article class="comment"><span class="comment-meta">${esc(comment.userId?.username || 'Story lover')}</span><p>${esc(comment.text)}</p><button class="text-button" data-reply-comment="${esc(comment._id)}">Reply</button>${comment.replies?.length ? `<div class="comment-replies">${comment.replies.map(render).join('')}</div>` : ''}</article>`; $('#comments-list').innerHTML = (result.comments || []).map(render).join('') || '<p class="muted">Be the first to share a thought.</p>'; $('#comment-input').placeholder = 'Share what this story brought up for you...'; $('#comment-input').disabled = false; $('#comment-submit').disabled = false; } catch (error) { toast(error.message, 'error'); } }
async function loadWallet() { try { const [wallet, transactions] = await Promise.all([api('/wallet/me/balance'), api('/wallet/me/transactions?limit=10')]); $('#wallet-balance').textContent = Number(wallet.storyCoins || 0).toLocaleString(); $('#wallet-earned').textContent = Number(wallet.totalEarned || 0).toLocaleString(); state.user.adUnlocksRemaining = wallet.adUnlocks || 0; const adBalanceEl = $('#ad-balance'); if (adBalanceEl) adBalanceEl.textContent = Math.max(0, wallet.adUnlocks || 0); if (adBalanceEl?.closest('.wallet-stat')) adBalanceEl.closest('.wallet-stat').style.display = 'block'; $('#transactions-list').innerHTML = (transactions.transactions || []).map(item => `<div class="data-row"><div><strong>${esc(item.description || item.type)}</strong><p>${new Date(item.createdAt).toLocaleDateString()}</p></div><span class="data-value">${esc(item.type === 'SPEND' ? '-' : '+')}${Number(item.amount || 0).toLocaleString()}</span></div>`).join('') || '<div class="empty-state">No transactions yet.</div>'; await window.AfroStoryAds.refresh(); } catch (error) { toast(error.message, 'error'); } }
function renderRewardCard(reward) {
  const eligibility = reward.eligibility || { state: reward.claimed ? 'CLAIMED' : 'LOCKED', reason: 'Complete the required activity first.' };
  const state = eligibility.state;
  const isSocial = reward.type === 'SOCIAL';
  const socialUrl = reward.metadata?.targetUrl;
  let action;
  if (isSocial && (state === 'CLAIMED' || reward.claimed)) {
    action = '<span class="reward-check">Completed ✓</span><span class="reward-check">+20 Coins Earned</span>';
  } else if (state === 'PENDING_VERIFICATION') {
    action = '<span class="reward-pending">Processing...</span>';
  } else if (state === 'LOCKED') {
    action = `<span class="reward-locked">🔒 ${esc(eligibility.reason)}</span>`;
  } else if (state === 'EXPIRED') {
    action = '<span class="reward-locked">Expired</span>';
  } else {
    action = `${socialUrl ? `<a class="button button-quiet reward-action" href="${esc(socialUrl)}" target="_blank" rel="noopener">Visit ${esc(reward.metadata?.platform || 'official account')}</a><small class="muted reward-disclosure">Follow the account, then claim. External follow verification is not implemented.</small>` : ''}<button class="button button-accent reward-action" data-reward-id="${esc(reward._id)}">${isSocial ? 'Claim reward' : 'Claim reward'}</button>`;
  }
  return `<article class="reward-card reward-state-${state.toLowerCase()}"><p class="eyebrow">${esc(reward.category || 'MISSION')}</p><h3>${esc(reward.name)}</h3><p class="muted">${esc(reward.description || '')}</p><div class="reward-meta">+${Number(reward.rewardAmount).toLocaleString()} Coins</div><div class="reward-state-label">${isSocial ? (state === 'CLAIMED' ? 'COMPLETED' : 'AVAILABLE') : esc(state.replaceAll('_', ' '))}</div>${action}</article>`;
}
async function loadRewards() { try { const result = await api('/rewards/me'); state.rewards = result; $('#rewards-balance').textContent = Number(result.balance || 0).toLocaleString(); $('#reward-current-streak').textContent = Number(result.streak?.currentStreak || 0); $('#reward-best-streak').textContent = Number(result.streak?.bestStreak || 0); const daily = result.daily; const rewards = result.rewards || []; $('#daily-reward-card').innerHTML = daily ? `<p class="eyebrow">DAILY CHECK-IN</p><h2>${daily.claimed ? 'Check-in complete' : 'Your daily reward is ready'}</h2><p class="muted">${esc(daily.description || 'Return each day to keep your streak alive.')}</p><div class="reward-meta">+${Number(daily.rewardAmount).toLocaleString()} coins</div>${daily.claimed ? '<div class="reward-state">Come back after the next calendar day.</div>' : `<button class="button button-accent reward-action" data-reward-id="${esc(daily._id)}">Claim today</button>`}` : '<div class="profile-empty">Daily check-in is not available right now.</div>'; const social = rewards.filter(reward => reward.type === 'SOCIAL' || reward.category === 'social'); $('#social-rewards-grid').innerHTML = social.map(renderRewardCard).join('') || '<div class="profile-empty">No active social missions right now.</div>'; $('#rewards-grid').innerHTML = rewards.filter(reward => !social.includes(reward) && (!daily || reward._id !== daily._id)).map(renderRewardCard).join('') || '<div class="profile-empty">No active missions right now. New opportunities will appear here.</div>'; $('#rewards-history').innerHTML = (result.history || []).map(item => `<div class="data-row"><div><strong>${esc(item.description || 'Reward activity')}</strong><p>${new Date(item.createdAt).toLocaleDateString()}</p></div><span class="data-value ${item.type === 'SPEND' ? '' : 'reward-positive'}">${item.type === 'SPEND' ? '-' : '+'}${Number(item.amount || 0).toLocaleString()}</span></div>`).join('') || '<div class="profile-empty">Your reward history will appear here.</div>'; } catch (error) { toast(error.message, 'error'); } }
async function loadCreator() { try { const creator = await api('/creators/me/profile'); const series = await api(`/creators/${creator._id}/series?limit=100`); $('#creator-stats').innerHTML = [['TOTAL VIEWS', creator.totalViews], ['TOTAL EARNINGS', creator.totalEarnings], ['FOLLOWERS', creator.totalFollowers], ['SERIES', series.series?.length || 0]].map(item => `<div class="stat-card"><span class="eyebrow">${item[0]}</span><strong>${Number(item[1] || 0).toLocaleString()}</strong></div>`).join(''); $('#my-series-grid').innerHTML = (series.series || []).map(card).join('') || '<div class="empty-state">Create your first series.</div>'; $('#upload-series').innerHTML = (series.series || []).map(item => `<option value="${esc(item._id)}">${esc(item.title)}</option>`).join(''); } catch (error) { if (error.message.includes('creator')) { $('#section-creator').innerHTML = '<div class="creator-onboarding"><p class="eyebrow">SHARE YOUR VOICE</p><h1>Become a creator</h1><p>Create a home for your stories and upload episodes.</p><button class="button button-primary" data-action="become-creator">Start creating</button></div>'; } else toast(error.message, 'error'); } }

$('#become-creator-form')?.addEventListener('submit', async (event) => { 
  event.preventDefault(); 
  const form = event.target;
  const brandName = form.querySelector('[name="brandName"]').value.trim();
  const bio = form.querySelector('[name="bio"]').value.trim();
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!brandName) return toast('Brand name is required', 'error'); 

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  try { 
    await api('/creators/become-creator', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ brandName, bio }) 
    }); 
    
    state.user.role = 'CREATOR'; 
    $$('.creator-only').forEach(el => el.classList.remove('hidden')); 
    $('#become-creator-modal').classList.add('hidden'); 
    
    toast('Welcome to Creator Studio!', 'success');
    
    $('#section-creator').innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">MAKE YOUR MARK</p><h1>Creator studio</h1></div>
        <button class="button button-primary" data-action="new-series">New series <span>+</span></button>
      </div>
      <div id="creator-stats" class="stats-row"></div>
      <div class="section-heading compact-heading">
        <h2>Your series</h2>
        <button class="button button-accent" data-action="open-upload">Upload episode</button>
      </div>
      <div id="my-series-grid" class="content-grid"></div>
    `;

    setSection('creator'); 
    await loadCreator(); 
    
  } catch (error) { 
    toast(error.message, 'error'); 
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Start creating';
  }
});

async function uploadAsset(path, file) { 
    const data = new FormData(); 
    data.append('file', file); 
    return api(path, { method: 'POST', body: data, timeout: 600000 }); 
}

async function submitSeries(event) { event.preventDefault(); const form = event.target; const values = new FormData(form); const cover = values.get('cover'); if (!cover?.size) return toast('Choose a cover image', 'error'); try { const upload = await uploadAsset('/upload/image', cover); await api('/series/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: values.get('title'), description: values.get('description'), coverImage: upload.url, genre: values.get('genre'), language: values.get('language'), tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), isPublished: values.get('publish') === 'on', isPremiumExclusive: values.get('premium') === 'on' }) }); $('#series-modal').classList.add('hidden'); form.reset(); await loadCreator(); toast('Series created', 'success'); } catch (error) { toast(error.message, 'error'); } }

async function submitUpload(event) { 
    event.preventDefault(); 
    const form = event.target; 
    const submit = form.querySelector('button[type="submit"]'); 
    const values = new FormData(form); 
    const seriesId = values.get('seriesId'); 
    const file = values.get('video'); 
    const genre = values.get('genre'); 
    const culturalCategory = values.get('culturalCategory'); 
    const language = values.get('language'); 
    
    if (!seriesId || !file?.size) return toast('Choose a series and video', 'error'); 
    if (!genre || !culturalCategory || !language) return toast('Choose a genre, cultural category, and language', 'error'); 
    
    submit.disabled = true; 
    submit.textContent = 'Uploading video (please wait)...'; 
    
    try { 
        const upload = await uploadAsset('/upload/video', file); 
        const mediaUrl = upload.hlsUrl || upload.mediaUrl || upload.secure_url || upload.url; 
        if (!mediaUrl || !/^https?:\/\/.+\.(mp4|m3u8)(?:\?.*)?$/i.test(mediaUrl)) throw new Error('Cloudinary did not return a playable MP4 or HLS URL'); 
        
        const thumbnail = values.get('thumbnail'); 
        const thumbnailUpload = thumbnail?.size ? await uploadAsset('/upload/image', thumbnail) : null; 
        if (thumbnail?.size && !thumbnailUpload?.url) throw new Error('Thumbnail upload did not return an image URL'); 
        
        const access = values.get('access'); 
        await api(`/episodes/series/${encodeURIComponent(seriesId)}/create`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ title: values.get('title'), description: values.get('description'), mediaUrl, thumbnailUrl: thumbnailUpload?.url || null, genre, culturalCategory, language, tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), mediaUrl, duration: upload.duration || 0, coinCost: Number(values.get('coinCost')), isFree: false, adUnlockable: access === 'Ad', isPublished: values.get('publish') === 'on' }) 
        }); 
        
        $('#upload-modal').classList.add('hidden'); 
        form.reset(); 
        await loadCreator(); 
        
        // MODIFIED: Informative success toast regarding processing time
        toast('Upload successful! 🎬 Cloudinary is processing the video for fast streaming, so playback may take a minute to fully load.', 'success'); 
    } catch (error) { 
        console.error('Episode upload failed:', error); 
        toast(error.message, 'error'); 
    } finally { 
        submit.disabled = false; 
        submit.textContent = 'Upload episode'; 
    } 
}

async function loadAdmin() { try { const [stats, reports] = await Promise.all([api('/admin/dashboard/stats'), api('/admin/reports?limit=20')]); $('#admin-stats').innerHTML = Object.entries(stats).map(([key, value]) => `<div class="stat-card"><span class="eyebrow">${esc(key.replace(/([A-Z])/g, ' $1'))}</span><strong>${Number(value).toLocaleString()}</strong></div>`).join(''); $('#reports-list').innerHTML = (reports.reports || []).map(report => `<div class="data-row"><div><strong>${esc(report.reason || report.type || 'Report')}</strong><p>${esc(report.description || '')}</p></div><span class="data-value">${esc(report.status)}</span></div>`).join('') || '<div class="empty-state">The queue is clear.</div>'; } catch (error) { toast(error.message, 'error'); } }
async function boot() {
  try {
    state.user = await api('/auth/me');
    renderHeaderUser(state.user);
    if (['CREATOR', 'ADMIN'].includes(state.user.role)) $$('.creator-only').forEach(el => el.classList.remove('hidden'));     
    if (state.user.role === 'ADMIN') $$('.admin-only').forEach(el => el.classList.remove('hidden'));
    ensureClassificationControls();
    await Promise.all([loadDiscover(), loadDiscoverEpisodes(), refreshNotificationBadge(), window.AfroStoryAds?.refresh()]);
    setupLazyLoading();
    return true;
  } catch (error) {
    console.error('Dashboard initialization failed:', error);
    toast(`Dashboard could not load: ${error.message}`, 'error');
    return false;
  }
}
document.addEventListener('click', event => { 
  const section = event.target.closest('[data-section]'); if (section) setSection(section.dataset.section); 
  const series = event.target.closest('[data-series-id]'); if (series) openSeries(series.dataset.seriesId); 
  const episodeRow = event.target.closest('[data-episode-id]'); if (episodeRow) openEpisode(episodeRow.dataset.episodeId); 
  if (event.target.closest('[data-action="unlock-current"]')) unlockEpisode(); 
  if (event.target.closest('[data-action="refresh-discover"]')) loadDiscover(); 
  if (event.target.closest('[data-action="buy-coins"]')) showPackages(); 
  
  if (event.target.closest('[data-action="become-creator"]')) {
      const modal = $('#become-creator-modal');
      if(modal) modal.classList.remove('hidden');
  }
  
  if (event.target.closest('[data-action="close-become-creator"]')) {
      $('#become-creator-modal')?.classList.add('hidden');
  }
  
  if (event.target.closest('[data-action="logout"]')) api('/auth/logout', { method: 'POST' }).finally(() => window.location.replace('/')); 
});
document.addEventListener('click', event => { 
    if (event.target.closest('[data-action="new-series"]')) $('#series-modal').classList.remove('hidden'); 
    if (event.target.closest('[data-action="open-upload"]')) { $('#upload-modal').classList.remove('hidden'); loadCreator(); } 
    if (event.target.closest('[data-action="close-upload"]') || event.target.id === 'upload-modal') $('#upload-modal').classList.add('hidden'); 
    if (event.target.closest('[data-action="close-series"]') || event.target.id === 'series-modal') $('#series-modal').classList.add('hidden'); 
});
$('#upload-form')?.addEventListener('submit', submitUpload);
$('#series-form')?.addEventListener('submit', submitSeries);
$('#search-form')?.addEventListener('submit', async event => { event.preventDefault(); const query = $('#search-input').value.trim(); if (query.length < 2) return; try { const result = await api(`/search/global?q=${encodeURIComponent(query)}&type=series&limit=20`); $('#series-grid').innerHTML = (result.series?.data || []).map(card).join('') || '<div class="empty-state">No stories matched your search.</div>'; } catch (error) { toast(error.message, 'error'); } });
$('#comment-form')?.addEventListener('submit', async event => { event.preventDefault(); const input = $('#comment-input'); const submit = $('#comment-submit'); if (!state.currentEpisode) return toast('Open an episode before commenting', 'error'); if (!input.value.trim()) return toast('Write a comment first', 'error'); submit.disabled = true; submit.textContent = 'Posting...'; try { await api('/comments/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: state.currentEpisode._id, text: input.value.trim() }) }); input.value = ''; await loadComments(state.currentEpisode._id); toast('Comment posted', 'success'); } catch (error) { toast(error.message, 'error'); } finally { submit.disabled = false; submit.textContent = 'Post'; } });
async function showPackages() { try { const plans = await api('/payment/packages'); const choices = Object.entries(plans).map(([key, plan]) => `<button class="plan-option" data-package="${key}"><strong>${key}</strong><span>${plan.coins} coins · ₦${Number(plan.naira).toLocaleString()}</span></button>`).join(''); $('#modal-root').innerHTML = `<div class="modal"><div class="modal-header"><div><p class="eyebrow">POWER YOUR WATCHLIST</p><h2>Choose your coins</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div class="plan-grid">${choices}</div></div>`; $('#modal-root').classList.remove('hidden'); } catch (error) { toast(error.message, 'error'); } }
async function showSubscriptionPlans() { try { const plans = await api('/vip/plans'); const choices = Object.entries(plans).map(([tier, plan]) => `<button class="plan-option" data-tier="${tier}"><strong>${tier}</strong><span>${plan.price} coins · ${plan.duration} day${plan.duration === 1 ? '' : 's'}</span></button>`).join(''); $('#modal-root').innerHTML = `<div class="modal"><div class="modal-header"><div><p class="eyebrow">UNLOCK EVERY STORY</p><h2>Choose a pass</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div class="plan-grid">${choices}</div></div>`; $('#modal-root').classList.remove('hidden'); } catch (error) { toast(error.message, 'error'); } }
document.addEventListener('click', async event => { if (event.target.closest('[data-action="close-modal"]') || event.target.id === 'modal-root') $('#modal-root').classList.add('hidden'); if (event.target.closest('[data-action="buy-pass"]')) showSubscriptionPlans(); const packageButton = event.target.closest('[data-package]'); if (packageButton) { try { const result = await api('/payment/initialize-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageKey: packageButton.dataset.package }) }); window.location.href = result.authorizationUrl; } catch (error) { toast(error.message, 'error'); } } const tierButton = event.target.closest('[data-tier]'); if (tierButton) { try { await api('/vip/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: tierButton.dataset.tier, paymentMethod: 'wallet' }) }); $('#modal-root').classList.add('hidden'); toast('Subscription activated', 'success'); } catch (error) { toast(error.message, 'error'); } } });
document.addEventListener('click', async event => { const button = event.target.closest('[data-reward-id]'); if (!button || button.disabled) return; button.disabled = true; button.textContent = 'Claiming...'; try { await api(`/rewards/${encodeURIComponent(button.dataset.rewardId)}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); toast('Reward added to your wallet', 'success'); await loadRewards(); refreshNotificationBadge(); } catch (error) { button.disabled = false; button.textContent = 'Claim reward'; toast(error.message, 'error'); } });
async function loadHistory() { try { const result = await api('/users/history/watch?limit=50'); $('#history-list').innerHTML = (result.history || []).map(item => `<button class="data-row history-row" data-history-episode="${esc(item.episodeId?._id)}" data-history-series="${esc(item.seriesId?._id)}"><div><strong>${esc(item.seriesId?.title || 'Series')}</strong><p>${esc(item.episodeId?.title || 'Episode')}</p></div><span class="data-value">${Math.round(Number(item.watchedPercentage || 0))}%</span></button>`).join('') || '<div class="empty-state">Your watched episodes will appear here.</div>'; } catch (error) { toast(error.message, 'error'); } }
async function openHistoryEpisode(seriesId, episodeId) { try { const [series, episode] = await Promise.all([api(`/series/${seriesId}`), api(`/episodes/${episodeId}`)]); state.currentSeries = series; setSection('watch'); await openEpisode(episode._id); } catch (error) { toast(error.message, 'error'); } }
function profileEmpty(message) { return `<div class="profile-empty">${esc(message)}</div>`; }
function renderProfileStoryList(stories, target, emptyMessage) { $(target).innerHTML = stories?.length ? stories.map(card).join('') : profileEmpty(emptyMessage); }
function renderProfileHistory(history, target) { $(target).innerHTML = history?.length ? history.map(item => `<div class="profile-list-row"><div><strong>${esc(item.seriesId?.title || 'Story')}</strong><p>${esc(item.episodeId?.title || 'Episode')} · ${new Date(item.updatedAt).toLocaleDateString()}</p><div class="progress"><i style="width:${Math.min(100, Number(item.watchedPercentage || 0))}%"></i></div></div><button class="text-button" data-history-episode="${esc(item.episodeId?._id)}" data-history-series="${esc(item.seriesId?._id)}">Continue</button><button class="text-button" data-remove-history="${esc(item._id)}">Remove</button></div>`).join('') : profileEmpty('You have not watched any stories yet.'); }
function renderProfile(profile) { const user = profile.user || {}; const details = user.profile || {}; const avatar = details.avatarUrl || user.profileImage; $('#profile-display-name').textContent = details.displayName || user.username || 'Profile'; $('#profile-handle').textContent = `@${user.username || 'story-lover'}`; $('#profile-bio').textContent = details.bio || 'Complete your profile to help your story journey feel like home.'; $('#profile-location').textContent = [details.region, details.country].filter(Boolean).join(' · '); $('#profile-avatar').innerHTML = avatar ? `<img src="${image(avatar)}" alt="">` : esc((details.displayName || user.username || 'A')[0].toUpperCase()); if (details.coverUrl) $('#profile-cover').style.backgroundImage = `linear-gradient(120deg,#111b,#1118),url('${image(details.coverUrl)}')`; renderProfileHistory(profile.recentlyWatched, '#profile-recent'); renderProfileHistory(profile.recentlyWatched, '#profile-history'); renderProfileStoryList(profile.favorites, '#profile-saved', 'No saved stories yet. Explore Discover to find your next African story.'); renderProfileStoryList(profile.favorites, '#profile-watchlist', 'Your watchlist is empty.'); $('#profile-library').innerHTML = profile.library?.length ? profile.library.map(item => `<div class="profile-list-row"><div><strong>${esc(item.seriesId?.title || 'Story')}</strong><p>${esc(item.episodeId?.title || 'Episode')} · Unlocked ${new Date(item.unlockedAt).toLocaleDateString()}</p></div></div>`).join('') : profileEmpty('Your unlocked stories will appear here.'); const interests = [...(details.favoriteGenres || []), ...(details.favoriteCultures || []), ...(details.additionalLanguages || [])]; $('#profile-interests').innerHTML = interests.length ? interests.map(item => `<span class="interest-chip">${esc(item)}</span>`).join('') : profileEmpty('Choose genres, cultures, and languages to shape your discoveries.'); $('#profile-about').innerHTML = `<div><span>Account</span>${esc(details.displayName || user.username || '')}</div><div><span>Preferred language</span>${esc(details.preferredLanguage || 'English')}</div><div><span>Country</span>${esc(details.country || 'Not added')}</div><div><span>Member since</span>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Recently'}</div><div><span>Profile visibility</span>${esc(user.privacy?.profileVisibility === 'PUBLIC' ? 'Public' : 'Private')}</div>`; $('.creator-profile-tab')?.classList.toggle('hidden', !profile.creator); }
async function loadProfile(refresh = false) { try { if (!state.profile && !refresh) { setSection('profile'); $('#profile-display-name').textContent = state.user?.username || 'Your profile'; $('#profile-handle').textContent = state.user?.username ? `@${state.user.username}` : '@story-lover'; $('#profile-avatar').textContent = (state.user?.username || 'A')[0].toUpperCase(); $('#profile-bio').textContent = 'Loading your story space...'; } if (state.profile && !refresh) { renderProfile(state.profile); setSection('profile'); loadProfile(true); return; } const profile = await api('/users/me/profile'); state.profile = profile; renderProfile(profile); setSection('profile'); } catch (error) { if (!state.profile) toast(error.message, 'error'); } }
function openProfileEditor() { const user = state.profile?.user; const profile = user?.profile || {}; if (!user) return; $('#profile-display-name-input').value = profile.displayName || user.username || ''; $('#profile-username').value = user.username || ''; $('#profile-email').value = user.email || ''; $('#profile-country').value = profile.country || ''; $('#profile-region').value = profile.region || ''; $('#profile-language').value = profile.preferredLanguage || 'English'; $('#profile-bio-input').value = profile.bio || ''; $('#profile-cultures').value = (profile.favoriteCultures || []).join(', '); $('#profile-public').checked = user.privacy?.profileVisibility === 'PUBLIC'; $('#profile-show-favorites').checked = Boolean(user.privacy?.showFavorites); $$('#profile-genres option').forEach(option => { option.selected = (profile.favoriteGenres || []).includes(option.value); }); $('#profile-edit-panel').classList.remove('hidden'); $('#profile-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
async function loadNotifications() { try { const result = await api('/notifications/me?limit=50'); $('#notification-list').innerHTML = (result.notifications || []).map(item => `<article class="notification-item ${item.read ? '' : 'notification-unread'}"><span class="notification-item-icon">${item.type === 'REWARD_EARNED' ? '✧' : '•'}</span><div class="notification-item-content"><strong>${esc(item.title)}</strong><p>${esc(item.message || '')}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div><div class="notification-item-actions"><button class="text-button" data-read-notification="${esc(item._id)}" aria-label="${item.read ? 'Notification already read' : 'Mark notification as read'}">${item.read ? 'Read' : 'Mark read'}</button><button class="text-button" data-dismiss-notification="${esc(item._id)}" aria-label="Dismiss notification">Dismiss</button></div></article>`).join('') || '<div class="notification-empty"><strong>No new notifications</strong><span>You are all caught up.</span></div>'; } catch (error) { toast(error.message, 'error'); } }
async function refreshNotificationBadge() { try { const result = await api('/notifications/me/unread-count'); const badge = $('#notification-badge'); const previousCount = Number(badge.dataset.count || 0); const nextCount = Number(result.unreadCount || 0); badge.textContent = nextCount; badge.dataset.count = String(nextCount); badge.classList.toggle('hidden', !nextCount); if (nextCount > 0 && nextCount !== previousCount) {
    badge.classList.remove('is-new');
    void badge.offsetWidth;
    badge.classList.add('is-new');
    setTimeout(() => badge.classList.remove('is-new'), 1100);
  } } catch {} }
async function saveProfile(event) { 
  event.preventDefault(); 
  try { 
    const form = new FormData(event.target); 
    let avatarUrl = state.profile?.user?.profile?.avatarUrl || state.profile?.user?.profileImage || null; 
    let coverUrl = state.profile?.user?.profile?.coverUrl || null; 
    const imageFile = form.get('profileImage'); 
    const coverFile = form.get('coverImage'); 
    if (imageFile?.size) avatarUrl = (await uploadAsset('image', imageFile)).url; 
    if (coverFile?.size) coverUrl = (await uploadAsset('image', coverFile)).url; 
    
    const updated = await api('/users/profile/update', { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        username: form.get('username'), 
        email: form.get('email'), 
        profile: { 
          displayName: form.get('displayName'), 
          bio: form.get('bio'), 
          avatarUrl, 
          coverUrl, 
          country: form.get('country'), 
          region: form.get('region'), 
          preferredLanguage: form.get('preferredLanguage'), 
          additionalLanguages: [], 
          favoriteGenres: [...form.getAll('favoriteGenres')], 
          favoriteCultures: String(form.get('favoriteCultures') || '').split(',').map(value => value.trim()).filter(Boolean) 
        }, 
        privacy: { 
          profileVisibility: form.get('profileVisibility') === 'on' ? 'PUBLIC' : 'PRIVATE', 
          showFavorites: form.get('showFavorites') === 'on' 
        } 
      }) 
    }); 
    state.user = { ...state.user, ...updated }; 
    renderHeaderUser(state.user); 
    $('#profile-edit-panel').classList.add('hidden'); 
    await loadProfile(); 
    toast('Profile updated', 'success'); 
  } catch (error) { 
    toast(error.message, 'error'); 
  } 
}
async function saveProgress(completed = false) { const video = $('#video-player'); if (!state.currentEpisode || !video.duration || !Number.isFinite(video.duration)) return; try { await api(`/episodes/${state.currentEpisode._id}/watch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lastPosition: video.currentTime, watchedPercentage: Math.min(100, video.currentTime / video.duration * 100), completed }) }); } catch {} }
document.addEventListener('click', async event => { if (event.target.closest('[data-action="profile"]')) loadProfile(); if (event.target.closest('[data-action="notifications"]')) { $('#notification-modal').classList.remove('hidden'); await loadNotifications(); } if (event.target.closest('[data-action="close-notifications"]') || event.target.id === 'notification-modal') $('#notification-modal').classList.add('hidden'); if (event.target.closest('[data-action="read-all"]')) { try { await api('/notifications/me/read-all', { method: 'PUT' }); await loadNotifications(); refreshNotificationBadge(); } catch (error) { toast(error.message, 'error'); } } const notification = event.target.closest('[data-read-notification]'); if (notification) { try { await api(`/notifications/${notification.dataset.readNotification}/read`, { method: 'PUT' }); await loadNotifications(); refreshNotificationBadge(); } catch (error) { toast(error.message, 'error'); } } const dismissed = event.target.closest('[data-dismiss-notification]'); if (dismissed) { try { await api(`/notifications/${dismissed.dataset.dismissNotification}`, { method: 'DELETE' }); await loadNotifications(); refreshNotificationBadge(); } catch (error) { toast(error.message, 'error'); } } const history = event.target.closest('[data-history-episode]'); if (history) openHistoryEpisode(history.dataset.historySeries, history.dataset.historyEpisode); });
document.addEventListener('click', async event => { if (event.target.closest('[data-action="edit-profile"]')) openProfileEditor(); if (event.target.closest('[data-action="close-profile-edit"]')) $('#profile-edit-panel').classList.add('hidden'); const tab = event.target.closest('[data-profile-tab]'); if (tab) { $$('.profile-tab').forEach(item => item.classList.toggle('active', item === tab));$$('.profile-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `profile-panel-${tab.dataset.profileTab}`)); } const remove = event.target.closest('[data-remove-history]'); if (remove) { try { await api(`/users/me/history/${remove.dataset.removeHistory}`, { method: 'DELETE' }); await loadProfile(); } catch (error) { toast(error.message, 'error'); } } });
$('#profile-form')?.addEventListener('submit', saveProfile);
document.addEventListener('click', event => { const section = event.target.closest('[data-section="history"]'); if (section) loadHistory(); });
ensureClassificationControls();
$('#genre-filter')?.addEventListener('change', () => { loadDiscover(); loadDiscoverEpisodes(); }); $('#sort-filter')?.addEventListener('change', () => { loadDiscover(); loadDiscoverEpisodes(); }); $('#cultural-filter')?.addEventListener('change', loadDiscoverEpisodes); $('#language-filter')?.addEventListener('change', loadDiscoverEpisodes);
$('#video-player')?.addEventListener('pause', () => saveProgress()); $('#video-player')?.addEventListener('ended', () => saveProgress(true));
setInterval(refreshNotificationBadge, 30000);
window.addEventListener('hashchange', () => { const name = location.hash.slice(1); if (['discover', 'watch', 'history', 'wallet', 'rewards', 'creator', 'admin', 'profile'].includes(name)) { setSection(name); if (name === 'history') loadHistory(); } });
(async () => { if (await boot()) setSection(location.hash.slice(1) || 'discover'); })();
async function toggleFavorite() { if (!state.currentSeries) return toast('Open a story first', 'error'); try { const result = await api(`/favorites/${state.currentSeries._id}/toggle`, { method: 'POST' }); $('#save-current').textContent = result.saved ? 'Saved to favorites' : 'Save to favorites'; toast(result.saved ? 'Added to favorites' : 'Removed from favorites', 'success'); } catch (error) { toast(error.message, 'error'); } }
document.addEventListener('click', event => { if (event.target.closest('[data-action="save-current"]')) toggleFavorite(); });
async function loadTrending() { try { const result = await api('/search/trending'); $('#trending-list').innerHTML = (result.trending || []).map(episodeCard).join('') || '<div class="empty-state">No trending episodes yet.</div>'; } catch (error) { toast(error.message, 'error'); } }
function ensureWatchFeedTargets() { const section = $('#section-watch'); if (!section) return; if (!$('#watch-featured')) section.insertAdjacentHTML('afterbegin', '<div id="watch-featured" class="watch-featured"></div>'); if (!$('#watch-continue')) section.insertAdjacentHTML('beforeend', '<div class="section-heading compact-heading"><h2>Continue Watching</h2><div id="watch-continue" class="content-grid"></div></div>'); if (!$('#watch-recommended')) section.insertAdjacentHTML('beforeend', '<div class="section-heading compact-heading"><h2>Recommended for You</h2><div id="watch-recommended" class="content-grid"></div></div>'); if (!$('#latest-episodes')) section.insertAdjacentHTML('beforeend', '<div class="section-heading compact-heading"><h2>Latest Episodes</h2><div id="latest-episodes" class="content-grid"></div></div>'); if (!$('#browse-episodes')) section.insertAdjacentHTML('beforeend', '<div class="section-heading compact-heading"><h2>Browse All</h2><div id="browse-episodes" class="content-grid"></div></div>'); }
async function loadWatchRecommended() { try { ensureWatchFeedTargets(); const [trending, latest, history] = await Promise.all([api('/episodes/feed?sort=trending&limit=8'), api('/episodes/feed?sort=latest&limit=8'), api('/users/history/watch?limit=8')]); const trendingEpisodes = trending.episodes || []; const latestEpisodes = latest.episodes || []; const historyItems = (history.history || []).filter(item => !item.completed && item.episodeId?._id); const continueEpisodes = (await Promise.all(historyItems.map(item => api(`/episodes/${item.episodeId._id}`).catch(() => null)))).filter(Boolean); state.recommendedEpisodes = trendingEpisodes; const featured = trendingEpisodes[0] || latestEpisodes[0]; $('#watch-featured').innerHTML = featured ? `<article class="featured-card episode-featured" data-episode-id="${esc(featured._id)}" style="background-image:url('${image(featured.thumbnailUrl || featured.seriesId?.coverImage)}')"><p class="eyebrow">FEATURED EPISODE</p><h2>${esc(featured.title)}</h2><p>${esc(featured.seriesId?.title || '')} · ${esc(featured.genre || '')} · ${esc(featured.culturalCategory || '')}</p><button class="button button-accent" data-episode-id="${esc(featured._id)}">Watch now</button></article>` : '<div class="empty-state">No published episodes available yet.</div>'; $('#recommended-episodes').innerHTML = trendingEpisodes.map(episodeCard).join('') || '<div class="empty-state">No trending episodes yet.</div>'; $('#watch-continue').innerHTML = continueEpisodes.map(episodeCard).join('') || '<div class="empty-state">Nothing to continue yet.</div>'; $('#watch-recommended').innerHTML = trendingEpisodes.map(episodeCard).join('') || '<div class="empty-state">No recommendations yet.</div>'; $('#latest-episodes').innerHTML = latestEpisodes.map(episodeCard).join('') || '<div class="empty-state">No latest episodes yet.</div>'; $('#browse-episodes').innerHTML = latestEpisodes.map(episodeCard).join('') || '<div class="empty-state">No episodes to browse yet.</div>'; } catch (error) { console.error('Failed to load Watch episodes:', error); toast(error.message, 'error'); } }
async function loadContinue() { try { const result = await api('/users/history/watch?limit=50'); $('#continue-list').innerHTML = (result.history || []).filter(item => !item.completed).map(item => `<button class="data-row history-row" data-history-episode="${esc(item.episodeId?._id)}" data-history-series="${esc(item.seriesId?._id)}"><div><strong>${esc(item.seriesId?.title || 'Series')}</strong><p>${esc(item.episodeId?.title || 'Episode')}</p></div><span class="data-value">${Math.round(Number(item.watchedPercentage || 0))}%</span></button>`).join('') || '<div class="empty-state">Nothing to continue yet.</div>'; } catch (error) { toast(error.message, 'error'); } }
async function loadFavorites() { try { const result = await api('/favorites'); $('#favorites-list').innerHTML = (result || []).map(card).join('') || '<div class="empty-state">Save stories from the player to build your library.</div>'; } catch (error) { toast(error.message, 'error'); } }
async function searchLibrary(event) { event.preventDefault(); const query = $('#library-search-input').value.trim(); if (query.length < 2) return; try { const result = await api(`/search/global?q=${encodeURIComponent(query)}&type=series&limit=50`); $('#search-results').innerHTML = (result.series?.data || []).map(card).join('') || '<div class="empty-state">No stories matched your search.</div>'; } catch (error) { toast(error.message, 'error'); } }
function loadSettings() { const settings = JSON.parse(localStorage.getItem('afrostory-settings') || '{}'); $('#settings-language').value = settings.language || 'en'; $('#settings-notifications').checked = settings.notifications !== false; }
function saveSettings(event) { event.preventDefault(); localStorage.setItem('afrostory-settings', JSON.stringify({ language: $('#settings-language').value, notifications: $('#settings-notifications').checked })); toast('Settings saved', 'success'); }
$('#library-search-form')?.addEventListener('submit', searchLibrary); $('#settings-form')?.addEventListener('submit', saveSettings);
async function searchEpisodes(event) { event.preventDefault(); const input = event.currentTarget.querySelector('input'); const query = input.value.trim(); if (query.length < 2) return toast('Enter at least two characters', 'error'); try { const result = await api(`/search/global?q=${encodeURIComponent(query)}&type=episodes&limit=50`); const target = event.currentTarget.id === 'search-form' ? '#series-grid' : '#search-results'; $(target).innerHTML = (result.episodes?.data || []).map(episodeCard).join('') || '<div class="empty-state">No episodes matched your search.</div>'; } catch (error) { toast(error.message, 'error'); } }
$('#search-form')?.addEventListener('submit', searchEpisodes); $('#library-search-form')?.addEventListener('submit', searchEpisodes);
document.addEventListener('click', event => { const section = event.target.closest('[data-section]')?.dataset.section; if (section === 'trending') loadTrending(); if (section === 'continue') loadContinue(); if (section === 'favorites') loadFavorites(); if (section === 'settings') loadSettings(); });
window.addEventListener('hashchange', () => { const name = location.hash.slice(1); if (['search', 'trending', 'continue', 'favorites', 'settings'].includes(name)) { setSection(name); if (name === 'trending') loadTrending(); if (name === 'continue') loadContinue(); if (name === 'favorites') loadFavorites(); if (name === 'settings') loadSettings(); } });
