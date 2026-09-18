const API = '/api';
const PREVIEW_LIMIT = 30; // Seconds before the video locks
const state = { 
    user: null, profile: null, rewards: null, series: [], 
    currentSeries: null, currentEpisode: null, hls: null, 
    recommendedEpisodes: [], feedEpisodes: [] 
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

/* ============================================================================ */
/* FRONTEND ERROR LOGGING TO RENDER BACKEND */
/* ============================================================================ */
async function logFrontendError(type, message, stack) {
    if (!state.user) return;
    try {
        console.error(`[Frontend Error Caught]: ${type} - ${message}`);
        await fetch('/api/admin/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type, 
                message, 
                stack, 
                userId: state.user._id,
                url: window.location.href, 
                time: new Date().toISOString() 
            })
        });
    } catch (e) { /* Silent fail if network is down */ }
}

window.addEventListener('error', (event) => {
    logFrontendError('uncaught_error', event.message, event.error ? event.error.stack : '');
});

window.addEventListener('unhandledrejection', (event) => {
    logFrontendError('unhandled_promise', event.reason ? (event.reason.message || String(event.reason)) : 'Unknown', event.reason ? event.reason.stack : '');
});

/* ============================================================================ */
/* NON-BLOCKING, CRASH-PROOF API */
/* ============================================================================ */
const api = async (path, options = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(options.timeout || 15000, 15000));

    try {
        const response = await fetch(`${API}${path}`, { 
            credentials: 'include', 
            signal: controller.signal, 
            ...options 
        });
        const data = await response.json().catch(() => ({}));
        
        if (response.status === 401) { 
            if (options.isExplicitLogout) window.location.replace('/');
            return null; 
        }
        
        if (!response.ok || data.success === false) {
            throw new Error(data.message || 'Request failed');
        }
        
        return data.data !== undefined ? data.data : data;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('Request timeout');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

const esc = value => {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const image = value => {
    if (!value || typeof value !== 'string') return 'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?auto=format&fit=crop&w=400&q=70';
    if (value.includes('unsplash.com')) {
        try {
            const url = new URL(value);
            url.searchParams.set('auto', 'format');
            url.searchParams.set('fit', 'crop');
            url.searchParams.set('w', '400');
            url.searchParams.set('q', '70');
            return url.toString();
        } catch (e) {
            return value;
        }
    }
    if (value.includes('cloudinary.com')) return value.replace('/upload/', '/upload/q_auto,w_400/');
    return value;
};

function getUserDisplayName(user) { return user?.profile?.displayName || user?.displayName || user?.username || 'Account'; }
function getUserAvatarUrl(user) { return user?.profile?.avatarUrl || user?.profileImage || user?.avatarUrl || null; }

function renderHeaderUser(user = state.user) {
    const avatarWrap = $('#user-avatar');
    const nameEl = $('#user-name');
    if (!avatarWrap) return;
    const displayName = getUserDisplayName(user);
    const avatarUrl = getUserAvatarUrl(user);
    if (nameEl) { nameEl.textContent = displayName; nameEl.title = displayName; }
    if (avatarUrl) {
        const cacheBust = `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        avatarWrap.innerHTML = `<img src="${image(cacheBust)}" alt="${esc(displayName)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"/>`;
    } else {
        const initial = (displayName || 'A').trim().charAt(0).toUpperCase() || 'A';
        avatarWrap.innerHTML = `<span class="profile-initial">${esc(initial)}</span>`;
    }
}

function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon"></span><span class="toast-message">${esc(message)}</span>`;
    $('#toast-region')?.appendChild(el);
    setTimeout(() => { el.style.animation = 'fadeOutToast 0.4s ease-out forwards'; setTimeout(() => el.remove(), 400); }, 4000);
}

function setupLazyLoading() {
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => { 
            entries.forEach(entry => { 
                if (entry.isIntersecting && entry.target.dataset.src) { 
                    entry.target.src = entry.target.dataset.src; 
                    delete entry.target.dataset.src; 
                    observer.unobserve(entry.target); 
                } 
            }); 
        }, { rootMargin: '50px' });
        $$('[data-src]').forEach(el => observer.observe(el));
    }
}

function setSection(name) {
    if (name !== 'watch' && state.currentEpisode) {
        const activeVideo = document.querySelector('.feed-video-card video');
        if (activeVideo) {
            saveProgressFeed(state.currentEpisode, activeVideo);
            activeVideo.pause();
        }
    }

    $$('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== `section-${name}`));
    $$('.nav-item[data-section]').forEach(item => item.classList.toggle('active', item.dataset.section === name));
    $('#genre-filter')?.closest('.discover-filters')?.classList.toggle('hidden', name !== 'discover');
    $('#save-current')?.classList.toggle('hidden', name !== 'watch');
    $$('.modal-root').forEach(m => m.classList.add('hidden'));
    $('#mobile-more-sheet')?.classList.add('hidden');
    location.hash = name;

    if (name === 'watch' && !state.currentEpisode) openDefaultFeed();
    if (name === 'wallet') loadWallet();
    if (name === 'rewards') loadRewards();
    if (name === 'creator') loadCreator();
    if (name === 'admin') loadAdmin();
    if (name === 'history') loadHistory();
    if (name === 'continue') loadContinue();
    if (name === 'favorites') loadFavorites();
    if (name === 'trending') loadTrending();
    if (name === 'settings') loadSettings();
}

const episodeGenres = ['Action', 'Drama', 'Comedy', 'Romance', 'Thriller', 'Horror', 'Adventure', 'Family', 'Historical', 'Traditional', 'Documentary', 'Educational', 'Faith', 'Mystery', 'Other'];
const culturalCategories = ['Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Nupe', 'Fulani', 'Edo', 'Efik', 'Ibibio', 'Kanuri', 'Ijaw', 'Other African culture'];
const episodeLanguages = ['English', 'Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Edo', 'Efik', 'Ibibio', 'Nupe', 'Fulfulde', 'Kanuri', 'Ijaw', 'Other'];
function options(values) { return values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join(''); }

function ensureClassificationControls() {
    const filters = $('.discover-filters');
    if (filters && !$('#cultural-filter')) {
        filters.insertAdjacentHTML('beforeend', `<label>Cultural category<select id="cultural-filter"><option value="">All cultures</option>${options(culturalCategories)}</select></label><label>Language<select id="language-filter"><option value="">All languages</option>${options(episodeLanguages)}</select></label>`);
    }
    const form = $('#upload-form');
    if (form && !$('#upload-genre')) {
        const access = form.querySelector('[name="access"]');
        if (access) {
            access.insertAdjacentHTML('beforebegin', `<label>Genre<select id="upload-genre" name="genre" required><option value="">Choose genre</option>${options(episodeGenres)}</select></label><label>Cultural category<select id="upload-cultural-category" name="culturalCategory" required><option value="">Choose culture</option>${options(culturalCategories)}</select></label><label>Language<select id="upload-language" name="language" required><option value="">Choose language</option>${options(episodeLanguages)}</select></label><label>Tags<input name="tags" maxlength="300" placeholder="family, tradition, village"></label>`);
        }
    }
}

function card(series) { 
    return `<article class="series-card" data-series-id="${esc(series._id)}"><div class="card-image" style="background-image:url('${image(series.coverImage)}')"><span class="card-tag">${esc(series.genre || 'SERIES')}</span></div><div class="card-body"><h3>${esc(series.title)}</h3><p>★ ${Number(series.rating || 0).toFixed(1)} &nbsp; · &nbsp; ${esc(series.language || 'English')}</p></div></article>`; 
}

function episodeCard(episode) { 
    const series = episode.seriesId || {}; 
    const creator = series.creatorId || {}; 
    return `<article class="series-card episode-card" data-episode-id="${esc(episode._id)}"><div class="card-image" style="background-image:url('${image(episode.thumbnailUrl || series.coverImage)}')"><span class="card-tag">${esc(episode.genre || 'EPISODE')}</span></div><div class="card-body"><h3>${esc(episode.title)}</h3><p>${esc(series.title || 'Story')} · ${esc(episode.culturalCategory || 'African story')}</p><p>${esc(creator.brandName || '')} · ${esc(episode.language || 'English')} · ${Math.round(Number(episode.duration || 0) / 60)} min</p></div></article>`; 
}

async function loadDiscover() {
    try {
        $$('#section-discover .section-heading').forEach(el => el.classList.remove('hidden'));
        const creatorGrid = $('#creator-grid');
        if (creatorGrid) creatorGrid.classList.remove('hidden');

        const genre = $('#genre-filter')?.value || '';
        const culturalCategory = $('#cultural-filter')?.value || '';
        const language = $('#language-filter')?.value || '';
        const sort = $('#sort-filter')?.value || 'trending';
        
        const params = new URLSearchParams({ page: 1, limit: 12, sort });
        if (genre) params.set('genre', genre);
        if (culturalCategory) params.set('culturalCategory', culturalCategory);
        if (language) params.set('language', language);

        const result = await api(`/series/discover/all?${params.toString()}`) || {};
        state.series = result.series || [];
        
        const featured = $('#featured-series');
        if (featured) {
            featured.innerHTML = `<div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #1b1b1b, #111); border: 1px solid #333; border-radius: 12px; margin-bottom: 24px;"><h2 style="margin: 0 0 8px; color: #d4a017; font-size: 22px;">Choose a Series</h2><p style="margin: 0; color: #999; font-size: 14px;">Select any story below, and all its episodes will be displayed for you to watch in order.</p></div>`;
        }
        
        const seriesGrid = $('#series-grid');
        if (seriesGrid) {
            seriesGrid.innerHTML = state.series.map(card).join('') || '<p>No stories match this filter.</p>';
        }
        
        let creatorsList = [];
        try {
            const cRes = await api('/creators/top/creators?limit=6').catch(() => null) || await api('/creators?limit=6').catch(() => null);
            creatorsList = cRes?.creators || cRes?.data || cRes || [];
            if (!Array.isArray(creatorsList)) creatorsList = [];
        } catch(e) {}
        
        if (creatorGrid) {
            creatorGrid.innerHTML = creatorsList.length > 0 ? creatorsList.map(creator => `<div class="creator-pill"><span class="creator-avatar">${creator.userId?.profileImage ? `<img src="${image(creator.userId.profileImage)}">` : esc((creator.brandName || 'C')[0])}</span><span><strong>${esc(creator.brandName)}</strong><br><small class="muted">${Number(creator.totalViews || 0).toLocaleString()} views</small></span></div>`).join('') : '<p>No creators found yet.</p>';
        }
    } catch (error) { 
        toast(error.message, 'error'); 
    }
} 

async function loadDiscoverEpisodes() {
    try {
        ensureClassificationControls();
        const genre = $('#genre-filter')?.value || '';
        const culturalCategory = $('#cultural-filter')?.value || '';
        const language = $('#language-filter')?.value || '';
        const query = new URLSearchParams({ sort: 'trending', limit: '12' });
        if (genre) query.set('genre', genre);
        if (culturalCategory) query.set('culturalCategory', culturalCategory);
        if (language) query.set('language', language);
        
        const result = await api(`/episodes/feed?${query}`) || {};
        const seriesGrid = $('#series-grid');
        if (seriesGrid) {
            seriesGrid.innerHTML = (result.episodes || []).map(episodeCard).join('') || '<p>No episodes match these filters.</p>';
        }
    } catch (error) { 
        toast(error.message, 'error'); 
    }
} 

/* ============================================================================ */
/* RESILIENT TIKTOK STYLE FEED & OBSERVERS */
/* ============================================================================ */
let currentlyPlaying = null;
const feedObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const video = entry.target.querySelector('video');
        if (!video) return;
        
        if (entry.isIntersecting) {
            if (currentlyPlaying && currentlyPlaying !== video) {
                currentlyPlaying.pause();
            }
            video.play().catch(e => console.log('Autoplay blocked. User must interact first.'));
            currentlyPlaying = video;
            
            const epId = entry.target.dataset.episodeId;
            const epData = state.feedEpisodes.find(e => e._id === epId) || {};
            state.currentEpisode = epData;
            state.currentSeries = epData.seriesId && typeof epData.seriesId === 'object' ? epData.seriesId : { _id: epData.seriesId };
            loadComments(epData._id);
        } else {
            if (!video.paused) video.pause();
        }
    });
}, { threshold: 0.6 });

let isFetchingFeed = false;

async function openDefaultFeed() {
    if (isFetchingFeed) return;
    isFetchingFeed = true;
    try {
        const feedData = await api('/episodes/feed?sort=trending&limit=15') || {};
        const feedContainer = $('#tiktok-feed');
        if (feedData.episodes && feedData.episodes.length > 0) {
            openEpisode(feedData.episodes[0]._id);
        } else if (feedContainer) {
            feedContainer.innerHTML = '<p>No stories available right now.</p>';
        }
    } catch (e) { 
        toast('Could not load feed.', 'error'); 
    } finally { 
        isFetchingFeed = false; 
    }
} 

async function openSeries(id) {
    try {
        const [seriesInfo, episodesData] = await Promise.all([
            api(`/series/${id}`).catch(() => null),
            api(`/series/${id}/episodes?limit=50`).catch(() => ({}))
        ]);
        
        const episodes = episodesData.episodes || [];
        if (!seriesInfo) throw new Error("Could not load series details");

        state.currentSeries = seriesInfo;
        episodes.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

        $$('#section-discover .section-heading').forEach(el => el.classList.add('hidden'));
        const creatorGrid = $('#creator-grid');
        if (creatorGrid) creatorGrid.classList.add('hidden');

        const featured = $('#featured-series');
        if (featured) {
            featured.innerHTML = `
                <article class="featured-card" style="background-image: linear-gradient(to top, rgba(17,17,17,1) 0%, rgba(17,17,17,0.4) 100%), url('${image(seriesInfo.coverImage)}')">
                    <button class="button button-quiet" data-action="back-to-discover" style="margin-bottom: 20px; z-index: 10; position: relative;">← Back to Series</button>
                    <p class="eyebrow" style="position: relative; z-index: 10;">${esc(seriesInfo.genre || 'SERIES')}</p>
                    <h2 style="position: relative; z-index: 10;">${esc(seriesInfo.title)}</h2>
                    <p style="position: relative; z-index: 10; max-width: 600px;">${esc(seriesInfo.description || 'No description available.')}</p>
                    <p style="color:#d4a017; margin-top:10px; position: relative; z-index: 10;">★ ${Number(seriesInfo.rating || 0).toFixed(1)} &nbsp; · &nbsp; ${esc(seriesInfo.language || 'English')}</p>
                    ${episodes.length > 0 ? `<button class="button button-primary" data-episode-id="${episodes[0]._id}" style="margin-top:15px; position: relative; z-index: 10;">Play Episode 1</button>` : ''}
                </article>
            `;
        }
        
        const seriesGrid = $('#series-grid');
        if (seriesGrid) {
            if (episodes.length > 0) {
                seriesGrid.innerHTML = episodes.map((episode, index) => {
                    const series = episode.seriesId || {}; 
                    const creator = series.creatorId || {}; 
                    return `<article class="series-card episode-card" data-episode-id="${esc(episode._id)}"><div class="card-image" style="background-image:url('${image(episode.thumbnailUrl || series.coverImage)}')"><span class="card-tag">EPISODE ${index + 1}</span></div><div class="card-body"><h3>${esc(episode.title)}</h3><p>${esc(series.title || 'Story')} · ${esc(episode.culturalCategory || 'African story')}</p><p>${esc(creator.brandName || '')} · ${esc(episode.language || 'English')} · ${Math.round(Number(episode.duration || 0) / 60)} min</p></div></article>`;
                }).join('');
            } else {
                seriesGrid.innerHTML = '<p style="grid-column: 1/-1;">This story has no episodes yet.</p>';
            }
        }
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch(e) { 
        toast('Could not open story.', 'error'); 
    }
}

async function openEpisode(id) {
    try {
        state.currentEpisode = { _id: id }; 
        setSection('watch');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        const feedContainer = $('#tiktok-feed');
        if (!feedContainer) return;
        feedContainer.innerHTML = '<div style="text-align:center; margin-top:50px;"></div>'; 

        const currentEp = await api(`/episodes/${id}`) || {}; 
        const feedData = await api('/episodes/feed?sort=trending&limit=15') || {}; 
        let episodes = feedData.episodes || []; 
        episodes = episodes.filter(ep => ep._id !== id); 
        if (currentEp._id) episodes.unshift(currentEp); 
        
        state.feedEpisodes = episodes;
        feedObserver.disconnect();
        feedContainer.innerHTML = ''; 

        episodes.forEach(episode => { 
            const actualMediaUrl = episode.mediaUrl || episode.videoUrl || episode.hlsUrl || ''; 
            
            const card = document.createElement('div'); 
            card.className = 'feed-video-card'; 
            card.dataset.episodeId = episode._id; 
            
            let lockScreen = ''; 
            if (!episode.hasAccess) { 
                lockScreen = `
                <div class="feed-lock-overlay hidden" id="lock-${episode._id}"> 
                    <span class="lock-icon" style="font-size:40px;color:#d4a017;">◈</span> 
                    <h3 style="color:#fff; margin-top:15px;">Premium Story</h3> 
                    <p style="color:#ccc; margin-bottom: 20px;">You've reached the end of the free preview.</p> 
                    <button class="button button-accent" data-action="unlock-current">Unlock episode</button> 
                </div>`; 
            } 

            const creatorImgUrl = episode.seriesId?.creatorId?.profileImage;
            const fallbackInitial = esc((episode.seriesId?.creatorId?.brandName || 'A')[0].toUpperCase());
            const profileDisplayHtml = creatorImgUrl 
                ? `<img src="${image(creatorImgUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` 
                : `<span style="font-weight:bold;color:#fff;font-size:18px;">${fallbackInitial}</span>`;

            const epNumText = episode.episodeNumber ? `Episode ${episode.episodeNumber} · ` : '';
            const isFollowing = episode.isFollowing; 

            const followIconBadge = isFollowing 
                ? `<div class="follow-badge-icon" style="position: absolute; bottom: 0; right: 0; background: #76a86b; color: #fff; width: 14px; height: 14px; border-radius: 50%; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; border: 1px solid #111;">✓</div>`
                : `<div class="follow-badge-icon" style="position: absolute; bottom: 0; right: 0; background: #d4a017; color: #111; width: 14px; height: 14px; border-radius: 50%; font-size: 14px; line-height: 14px; font-weight: bold; display: flex; align-items: center; justify-content: center; border: 1px solid #111;">+</div>`;

            card.innerHTML = `
                <video poster="${image(episode.thumbnailUrl || episode.seriesId?.coverImage)}" loop playsinline ${episode.hasAccess ? 'controls' : ''}></video> 
                ${lockScreen} 
                <div class="feed-overlay"> 
                    <h3 style="margin:0; font-size:18px; font-weight:700;">${esc(episode.title)}</h3> 
                    <p style="margin:4px 0 0 0; font-size:14px; opacity:0.9;">@${esc(episode.seriesId?.creatorId?.brandName || 'AfroStory')} · ${epNumText}${esc(episode.seriesId?.title || '')}</p> 
                </div> 
                <div class="feed-sidebar"> 
                    <button class="feed-action-btn" data-action="follow-creator" data-creator="${esc(episode.seriesId?.creatorId?._id)}" ${isFollowing ? 'disabled style="pointer-events:none;"' : ''} title="Follow Creator"> 
                        <div style="width: 42px; height: 42px; border-radius: 50%; overflow: hidden; border: 2px solid #fff; background: #333; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; position: relative;">
                            ${profileDisplayHtml}
                            ${followIconBadge}
                        </div>
                    </button>
                    <button class="feed-action-btn" data-action="save-current" title="Save to Favorites"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> 
                        <span>Save</span> 
                    </button> 
                    <button class="feed-action-btn" onclick="document.getElementById('comments-sheet').classList.remove('hidden')" title="Comments"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> 
                        <span>Reply</span> 
                    </button> 
                </div>`; 
            
            const videoEl = card.querySelector('video'); 
            
            // Native HLS parsing logic
            if (actualMediaUrl.includes('.m3u8')) {
                if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                    videoEl.src = actualMediaUrl; 
                } else if (window.Hls && window.Hls.isSupported()) {
                    const hls = new window.Hls();
                    hls.loadSource(actualMediaUrl);
                    hls.attachMedia(videoEl);
                } else {
                    videoEl.src = actualMediaUrl; 
                }
            } else {
                videoEl.src = actualMediaUrl;
            }

            if (!episode.hasAccess) { 
                videoEl.addEventListener('timeupdate', () => { 
                    if (episode.hasAccess) return; 
                    
                    if (videoEl.currentTime >= PREVIEW_LIMIT) { 
                        if (Math.abs(videoEl.currentTime - PREVIEW_LIMIT) > 1) {
                            videoEl.currentTime = PREVIEW_LIMIT; 
                        }
                        videoEl.pause(); 
                        videoEl.removeAttribute('controls'); 
                        const lockUI = card.querySelector(`#lock-${episode._id}`);
                        if (lockUI) lockUI.classList.remove('hidden'); 
                    } 
                }); 
                videoEl.addEventListener('seeked', () => { 
                    if (episode.hasAccess) return;
                    if (videoEl.currentTime >= PREVIEW_LIMIT) { 
                        videoEl.pause(); 
                        videoEl.currentTime = PREVIEW_LIMIT; 
                        videoEl.removeAttribute('controls'); 
                        const lockUI = card.querySelector(`#lock-${episode._id}`);
                        if (lockUI) lockUI.classList.remove('hidden'); 
                    } 
                }); 
            } 
            
            videoEl.addEventListener('pause', () => saveProgressFeed(episode, videoEl)); 
            videoEl.addEventListener('ended', () => saveProgressFeed(episode, videoEl, true)); 
            
            feedContainer.appendChild(card); 
            feedObserver.observe(card); 
        }); 
    } catch (error) {
        logFrontendError('open_episode_failed', error.message, error.stack);
        toast('Failed to load feed', 'error');
    }
}

/* DEBOUNCED API SAVES */
let saveProgressTimeout = null;
async function saveProgressFeed(episode, video, completed = false) {
    if (!episode || video.currentTime === 0) return;
    
    clearTimeout(saveProgressTimeout);
    saveProgressTimeout = setTimeout(async () => {
        let durationToUse = (video.duration && Number.isFinite(video.duration)) ? video.duration : (episode.duration || 60);
        let percentage = Math.min(100, (video.currentTime / durationToUse) * 100);
        try {
            await api(`/episodes/${episode._id}/watch`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ lastPosition: video.currentTime, watchedPercentage: percentage, completed }) 
            });
        } catch {}
    }, 1000); 
}

async function unlockEpisode() {
    if (!state.currentEpisode) return;
    try {
        const hasActiveSubscription = state.user?.subscriptionExpiresAt && new Date(state.user.subscriptionExpiresAt) > new Date();
        if (hasActiveSubscription) {
            toast('✓ This episode is included in your VIP subscription!', 'success');
            return;
        }

        const hasAds = state.currentEpisode.adUnlockable && window.AfroStoryAds?.isEnabled; 
        const userAdBalance = state.user?.adUnlocksRemaining || 0; 
        const canUseAd = hasAds && userAdBalance > 0; 
        let choice = 'coins'; 
        
        if (canUseAd) { 
            if (window.Swal) { 
                const result = await Swal.fire({ title: '🎬 Unlock this episode', html: `<div style="text-align:left; font-size:14px;"><p><strong>📺 Watch Ad (Free)</strong></p><p style="color:#76a86b; font-weight:bold;">${userAdBalance} ad unlock${userAdBalance !== 1 ? 's' : ''} available today</p><hr style="border-color:#343434; margin:15px 0;"><p><strong>💰 Use Coins</strong></p><p style="color:#d4a017; font-weight:bold;">${state.currentEpisode.coinCost || 10} coins</p></div>`, showDenyButton: true, showCancelButton: true, confirmButtonText: '📺 Watch Ad Now', denyButtonText: `💰 Use ${state.currentEpisode.coinCost || 10} Coins`, cancelButtonText: 'Cancel', confirmButtonColor: '#76a86b', denyButtonColor: '#d4a017', background: '#1b1b1b', color: '#f5f5f5', allowOutsideClick: false, allowEscapeKey: false }); 
                if (result.isDismissed) return; choice = result.isDenied ? 'coins' : 'ad'; 
            } 
        } else { 
            if (window.Swal) { 
                const result = await Swal.fire({ title: '🎬 Unlock this episode', html: `<p style="font-size:15px; line-height:1.6;"><strong style="color:#d4a017;">💰 Only coins available now</strong></p><p style="font-size:13px; color:#999; margin-top:10px;">Ad unlocks are coming soon!</p><p style="font-size:15px; margin-top:15px;">Use <strong style="color:#d4a017;">${state.currentEpisode.coinCost || 10} coins</strong> to unlock and continue</p>`, showCancelButton: true, confirmButtonText: `💰 Unlock with ${state.currentEpisode.coinCost || 10} Coins`, cancelButtonText: 'Cancel', confirmButtonColor: '#d4a017', background: '#1b1b1b', color: '#f5f5f5', allowOutsideClick: false, allowEscapeKey: false }); 
                if (result.isDismissed) return; choice = 'coins'; 
            } 
        } 
        
        if (choice === 'ad') { 
            if(window.AfroStoryAds) await window.AfroStoryAds.showRewarded(state.currentEpisode._id); 
            const unlockRes = await api('/wallet/unlock-episode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: state.currentEpisode._id, method: 'AD' }) }); 
            if (!unlockRes) return toast('Failed to unlock via Ad', 'error');
        } else { 
            const unlockRes = await api('/wallet/unlock-episode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: state.currentEpisode._id, method: 'COIN' }) }); 
            if (!unlockRes) return toast('Failed to unlock (not enough coins)', 'error');
        } 
        
        state.currentEpisode.hasAccess = true; 
        const lockScreen = document.getElementById(`lock-${state.currentEpisode._id}`); 
        if (lockScreen) { 
            lockScreen.classList.add('hidden'); 
            const videoEl = lockScreen.parentElement.querySelector('video'); 
            if (videoEl) { 
                videoEl.setAttribute('controls', 'true'); 
                videoEl.play().catch(e => console.error("Playback blocked:", e)); 
            } 
        } 
        toast('✨ Episode unlocked! Enjoy the story!', 'success'); 
    } catch (error) { toast(error.message, 'error'); }
}

async function loadComments(id) { 
    try { 
        const result = await api(`/comments/episode/${id}?limit=50`) || {}; 
        const render = comment => `<article class="comment"><span class="comment-meta">${esc(comment.userId?.username || 'Story lover')}</span><p>${esc(comment.text)}</p><button class="text-button" data-reply-comment="${esc(comment._id)}">Reply</button>${comment.replies?.length ? `<div class="comment-replies">${comment.replies.map(render).join('')}</div>` : ''}</article>`; 
        const commentsList = $('#comments-list');
        if (commentsList) commentsList.innerHTML = (result.comments || []).map(render).join('') || '<p>Be the first to share a thought.</p>'; 
        
        const input = $('#comment-input');
        const submit = $('#comment-submit');
        if (input && submit) {
            input.placeholder = 'Share what this story brought up for you...'; 
            input.disabled = false; 
            submit.disabled = false; 
        }
    } catch (error) { toast(error.message, 'error'); } 
} 

async function loadWallet() { 
    try { 
        const [wallet = {}, transactions = {}] = await Promise.all([api('/wallet/me/balance').catch(()=>({})), api('/wallet/me/transactions?limit=10').catch(()=>({}))]); 
        
        const balEl = $('#wallet-balance');
        if (balEl) balEl.textContent = Number(wallet.storyCoins || 0).toLocaleString(); 
        
        const earnEl = $('#wallet-earned');
        if (earnEl) earnEl.textContent = Number(wallet.totalEarned || 0).toLocaleString(); 
        
        if(state.user) state.user.adUnlocksRemaining = wallet.adUnlocks || 0; 
        
        const adBalanceEl = $('#ad-balance'); 
        if (adBalanceEl) {
            adBalanceEl.textContent = Math.max(0, wallet.adUnlocks || 0); 
            const statBox = adBalanceEl.closest('.wallet-stat');
            if (statBox) statBox.style.display = 'block'; 
        }
        
        const transList = $('#transactions-list');
        if (transList) {
            transList.innerHTML = (transactions.transactions || []).map(item => `<div class="data-row"><div><strong>${esc(item.description || item.type)}</strong><p>${new Date(item.createdAt).toLocaleDateString()}</p></div><span class="data-value">${esc(item.type === 'SPEND' ? '-' : '+')}${Number(item.amount || 0).toLocaleString()}</span></div>`).join('') || '<p>No transactions yet.</p>'; 
        }
        
        if (window.AfroStoryAds) await window.AfroStoryAds.refresh(); 
    } catch (error) { toast(error.message, 'error'); } 
} 

function renderRewardCard(reward) {
    const eligibility = reward.eligibility || { state: reward.claimed ? 'CLAIMED' : 'LOCKED', reason: 'Complete the required activity first.' };
    const stateVal = eligibility.state;
    const isSocial = reward.type === 'SOCIAL';
    const socialUrl = reward.metadata?.targetUrl;
    let action;
    
    if (isSocial && (stateVal === 'CLAIMED' || reward.claimed)) { action = '<p>Completed ✓<br>+20 Coins Earned</p>'; } 
    else if (stateVal === 'PENDING_VERIFICATION') { action = '<p>Processing...</p>'; } 
    else if (stateVal === 'LOCKED') { action = `<span class="reward-locked">🔒 ${esc(eligibility.reason)}</span>`; } 
    else if (stateVal === 'EXPIRED') { action = '<p>Expired</p>'; } 
    else { action = `${socialUrl ? `<a href="${esc(socialUrl)}" target="_blank" class="button button-quiet">Visit ${esc(reward.metadata?.platform || 'official account')}</a>` : ''}<button class="button button-accent reward-action" data-reward-id="${esc(reward._id)}">Claim reward</button>`; }
    
    return `<article class="reward-card reward-state-${stateVal.toLowerCase()}"><p class="eyebrow">${esc(reward.category || 'MISSION')}</p><h3>${esc(reward.name)}</h3><p class="muted">${esc(reward.description || '')}</p><div class="reward-meta">+${Number(reward.rewardAmount).toLocaleString()} Coins</div><div class="reward-state-label">${isSocial ? (stateVal === 'CLAIMED' ? 'COMPLETED' : 'AVAILABLE') : esc(stateVal.replaceAll('_', ' '))}</div>${action}</article>`;
}

async function loadRewards() {
    try {
        const result = await api('/rewards/me') || {};
        state.rewards = result;
        
        const balEl = $('#rewards-balance');
        if (balEl) balEl.textContent = Number(result.balance || 0).toLocaleString();
        
        const currentStreak = $('#reward-current-streak');
        if (currentStreak) currentStreak.textContent = Number(result.streak?.currentStreak || 0);
        
        const bestStreak = $('#reward-best-streak');
        if (bestStreak) bestStreak.textContent = Number(result.streak?.bestStreak || 0);
        
        const daily = result.daily;
        const rewards = result.rewards || [];
        
        const dailyCard = $('#daily-reward-card');
        if (dailyCard) {
            dailyCard.innerHTML = daily ? `<p class="eyebrow">DAILY CHECK-IN</p><h2>${daily.claimed ? 'Check-in complete' : 'Your daily reward is ready'}</h2><p class="muted">${esc(daily.description || 'Return each day to keep your streak alive.')}</p><div class="reward-meta">+${Number(daily.rewardAmount).toLocaleString()} coins</div>${daily.claimed ? '<div class="reward-state">Come back after the next calendar day.</div>' : `<button class="button button-accent reward-action" data-reward-id="${esc(daily._id)}">Claim today</button>`}` : '<p>Daily check-in is not available right now.</p>';
        }

        const social = rewards.filter(reward => reward.type === 'SOCIAL' || reward.category === 'social');
        const socialGrid = $('#social-rewards-grid');
        if (socialGrid) socialGrid.innerHTML = social.map(renderRewardCard).join('') || '<p>No active social missions right now.</p>';
        
        const standardGrid = $('#rewards-grid');
        if (standardGrid) standardGrid.innerHTML = rewards.filter(reward => !social.includes(reward) && (!daily || reward._id !== daily._id)).map(renderRewardCard).join('') || '<p>No active missions right now.</p>';
        
        const histContainer = $('#rewards-history');
        if (histContainer) {
            histContainer.innerHTML = (result.history || []).map(item => `<div class="data-row"><div><strong>${esc(item.description || 'Reward activity')}</strong><p>${new Date(item.createdAt).toLocaleDateString()}</p></div><span class="data-value ${item.type === 'SPEND' ? '' : 'reward-positive'}">${item.type === 'SPEND' ? '-' : '+'}${Number(item.amount || 0).toLocaleString()}</span></div>`).join('') || '<p>Your reward history will appear here.</p>';
        }
    } catch (error) { toast(error.message, 'error'); }
} 

async function loadFollowersList() {
    try {
        const root = $('#modal-root');
        if (!root) return;
        
        root.innerHTML = `<div class="modal"><div class="modal-header"><div><p class="eyebrow">YOUR COMMUNITY</p><h2>Followers</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div id="followers-modal-list" class="data-list" style="max-height: 50vh; overflow-y: auto;"><p style="text-align:center; padding: 20px;">Loading...</p></div></div>`;
        root.classList.remove('hidden');
        
        const res = await api('/creators/me/followers');
        const followers = res.followers || [];
        const modalList = $('#followers-modal-list');
        
        if (modalList) {
            modalList.innerHTML = followers.map(f => {
                const avatar = f.profileImage 
                    ? `<img src="${image(f.profileImage)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` 
                    : `<span style="font-weight:bold;color:#fff;font-size:18px;">${esc((f.displayName || f.username || 'U')[0].toUpperCase())}</span>`;
                
                const mutualBadge = f.isMutual 
                    ? `<span style="font-size:11px; background:#333; color:#aaa; padding:2px 6px; border-radius:10px; margin-top:4px; display:inline-block;">Mutual</span>` 
                    : '';

                return `<div class="data-row" style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid #222;">
                    <div style="width:40px; height:40px; border-radius:50%; background:#444; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${avatar}</div>
                    <div style="flex:1; min-width:0; text-align:left;">
                        <strong style="display:block; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(f.displayName || f.username)}</strong>
                        <p style="margin:0; font-size:12px; color:#888;">@${esc(f.username)}</p>
                        ${mutualBadge}
                    </div>
                </div>`;
            }).join('') || '<p style="text-align:center; color:#888; padding: 20px;">You have no followers yet.</p>';
        }
    } catch(e) {
        toast(e.message, 'error');
        const root = $('#modal-root');
        if (root) root.classList.add('hidden');
    }
}

async function loadCreator() { 
    try { 
        const creator = await api('/creators/me/profile') || {}; 
        const series = await api(`/creators/${creator._id}/series?limit=100`) || {}; 
        
        const dashboard = $('#creator-dashboard');
        const onboarding = $('#creator-onboarding');
        
        if (dashboard) dashboard.classList.remove('hidden');
        if (onboarding) onboarding.classList.add('hidden');

        const statsContainer = $('#creator-stats');
        if (statsContainer) {
            statsContainer.innerHTML = [
                ['TOTAL VIEWS', creator.totalViews, ''], 
                ['TOTAL EARNINGS', creator.totalEarnings, ''], 
                ['FOLLOWERS', creator.totalFollowers, 'data-action="view-followers" style="cursor:pointer;"'], 
                ['SERIES', series.series?.length || 0, '']
            ].map(item => `<div class="stat-card" ${item[2] || ''}><span class="eyebrow">${item[0]}</span><strong>${Number(item[1] || 0).toLocaleString()}</strong></div>`).join(''); 
        }

        const seriesGrid = $('#my-series-grid');
        if (seriesGrid) {
            seriesGrid.innerHTML = (series.series || []).map(card).join('') || '<p>Create your first series.</p>'; 
        }
        
        const uploadSelect = $('#upload-series');
        if (uploadSelect) {
            uploadSelect.innerHTML = (series.series || []).map(item => `<option value="${esc(item._id)}">${esc(item.title)}</option>`).join(''); 
        }
    } catch (error) { 
        if (error.message?.includes('creator')) { 
            const dashboard = $('#creator-dashboard');
            const onboarding = $('#creator-onboarding');
            if (dashboard) dashboard.classList.add('hidden');
            if (onboarding) onboarding.classList.remove('hidden');
        } else {
            toast(error.message, 'error'); 
        } 
    } 
} 

async function uploadAsset(path, file) { 
    const data = new FormData(); 
    data.append('file', file); 
    return api(path, { method: 'POST', body: data, timeout: 600000 }); 
}

async function submitSeries(event) { 
    event.preventDefault(); 
    const form = event.target; 
    const submit = form.querySelector('button[type="submit"]'); 
    const values = new FormData(form); 
    const cover = values.get('cover'); 
    
    if (!cover?.size) return toast('Choose a cover image', 'error'); 
    
    submit.disabled = true; 
    submit.textContent = 'Creating series (please wait)...';
    
    try { 
        const upload = await uploadAsset('/upload/image', cover); 
        await api('/series/create', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                title: values.get('title'), 
                description: values.get('description'), 
                coverImage: upload.url, 
                genre: values.get('genre'), 
                language: values.get('language'), 
                tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), 
                isPublished: values.get('publish') === 'on', 
                isPremiumExclusive: values.get('premium') === 'on' 
            }) 
        }); 
        
        const modal = $('#series-modal');
        if (modal) modal.classList.add('hidden'); 
        form.reset(); 
        await loadCreator(); 
        toast('Series created', 'success'); 
    } catch (error) { 
        toast(error.message, 'error'); 
    } finally { 
        submit.disabled = false; 
        submit.textContent = 'Create series'; 
    } 
}

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
        const access = values.get('access'); 
        
        await api(`/episodes/series/${encodeURIComponent(seriesId)}/create`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                title: values.get('title'), 
                description: values.get('description'), 
                mediaUrl, 
                thumbnailUrl: thumbnailUpload?.url || null, 
                genre, 
                culturalCategory, 
                language, 
                tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), 
                duration: upload.duration || 0, 
                coinCost: Number(values.get('coinCost')), 
                isFree: false, 
                adUnlockable: access === 'Ad', 
                isPublished: values.get('publish') === 'on' 
            }) 
        }); 
        
        const modal = $('#upload-modal');
        if (modal) modal.classList.add('hidden'); 
        form.reset(); 
        await loadCreator(); 
        toast('Upload successful!', 'success'); 
    } catch (error) { 
        toast(error.message, 'error'); 
    } finally { 
        submit.disabled = false; 
        submit.textContent = 'Upload episode'; 
    } 
}

async function loadAdmin() { 
    try { 
        const [stats = {}, reports = {}] = await Promise.all([
            api('/admin/dashboard/stats').catch(()=>({})), 
            api('/admin/reports?limit=20').catch(()=>({}))
        ]); 
        
        const statsEl = $('#admin-stats');
        if (statsEl) {
            statsEl.innerHTML = Object.entries(stats).map(([key, value]) => `<div class="stat-card"><span class="eyebrow">${esc(key.replace(/([A-Z])/g, ' $1'))}</span><strong>${Number(value).toLocaleString()}</strong></div>`).join(''); 
        }
        
        const reportsEl = $('#reports-list');
        if (reportsEl) {
            reportsEl.innerHTML = (reports.reports || []).map(report => `<div class="data-row"><div><strong>${esc(report.reason || report.type || 'Report')}</strong><p>${esc(report.description || '')}</p></div><span class="data-value">${esc(report.status)}</span></div>`).join('') || '<p>The queue is clear.</p>'; 
        }
    } catch (error) { toast(error.message, 'error'); } 
} 

async function showPackages() { 
    try { 
        const plans = await api('/payment/packages') || {}; 
        const choices = Object.entries(plans).map(([key, plan]) => `<button class="plan-option" data-package="${key}"><strong>${key}</strong><span>${plan.coins} coins · ₦${Number(plan.naira).toLocaleString()}</span></button>`).join(''); 
        
        const root = $('#modal-root');
        if (root) {
            root.innerHTML = `<div class="modal"><div class="modal-header"><div><p class="eyebrow">POWER YOUR WATCHLIST</p><h2>Choose your coins</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div class="plan-grid">${choices}</div></div>`; 
            root.classList.remove('hidden'); 
        }
    } catch (error) { toast(error.message, 'error'); } 
}

async function showSubscriptionPlans() { 
    try { 
        const plans = await api('/vip/plans') || {}; 
        const choices = Object.entries(plans).map(([tier, plan]) => `<button class="plan-option" data-tier="${tier}"><strong>${tier}</strong><span>${plan.price} coins · ${plan.duration} day${plan.duration === 1 ? '' : 's'}</span></button>`).join(''); 
        
        const root = $('#modal-root');
        if (root) {
            root.innerHTML = `<div class="modal"><div class="modal-header"><div><p class="eyebrow">UNLOCK EVERY STORY</p><h2>Choose a pass</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div class="plan-grid">${choices}</div></div>`; 
            root.classList.remove('hidden'); 
        }
    } catch (error) { toast(error.message, 'error'); } 
}

async function loadHistory() {
    try {
        const result = await api('/users/history/watch?limit=50') || {};
        const list = result.history || result.data || result || [];
        
        const listEl = $('#history-list');
        if (listEl) {
            listEl.innerHTML = list.filter(item => item.episodeId).map(item => `
                <button class="profile-list-row history-row" data-history-episode="${esc(item.episodeId._id)}" data-history-series="${esc(item.seriesId?._id)}" style="width: 100%; cursor: pointer; text-align: left; margin-bottom: 10px; border-radius: 8px;">
                    <div style="width: 90px; height: 60px; border-radius: 6px; background-color: #333; background-image: url('${image(item.episodeId.thumbnailUrl || item.seriesId?.coverImage)}'); background-size: cover; background-position: center; flex-shrink: 0;"></div>
                    <div style="flex: 1; min-width: 0;">
                        <strong style="color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${esc(item.seriesId?.title || 'Series')}</strong>
                        <p style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(item.episodeId.title || 'Episode')}</p>
                        <div class="progress" style="width: 100%; max-width: 200px;"><i style="width: ${Math.round(Number(item.watchedPercentage || 0))}%;"></i></div>
                    </div>
                    <span style="color: #d4a017; font-weight: 600; font-size: 13px;">${Math.round(Number(item.watchedPercentage || 0))}%</span>
                </button>
            `).join('') || '<p>Your watched episodes will appear here.</p>';
        }
    } catch (error) { toast(error.message, 'error'); }
}

async function loadContinue() {
    try {
        const result = await api('/users/history/watch?limit=50') || {};
        const list = result.history || result.data || result || [];
        
        const listEl = $('#continue-list');
        if (listEl) {
            listEl.innerHTML = list.filter(item => !item.completed && item.episodeId).map(item => `
                <button class="profile-list-row history-row" data-history-episode="${esc(item.episodeId._id)}" data-history-series="${esc(item.seriesId?._id)}" style="width: 100%; cursor: pointer; text-align: left; margin-bottom: 10px; border-radius: 8px;">
                    <div style="width: 90px; height: 60px; border-radius: 6px; background-color: #333; background-image: url('${image(item.episodeId.thumbnailUrl || item.seriesId?.coverImage)}'); background-size: cover; background-position: center; flex-shrink: 0;"></div>
                    <div style="flex: 1; min-width: 0;">
                        <strong style="color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${esc(item.seriesId?.title || 'Series')}</strong>
                        <p style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(item.episodeId.title || 'Episode')}</p>
                        <div class="progress" style="width: 100%; max-width: 200px;"><i style="width: ${Math.round(Number(item.watchedPercentage || 0))}%;"></i></div>
                    </div>
                    <span style="color: #d4a017; font-weight: 600; font-size: 13px;">${Math.round(Number(item.watchedPercentage || 0))}%</span>
                </button>
            `).join('') || '<p>Nothing to continue yet.</p>';
        }
    } catch (error) { toast(error.message, 'error'); }
} 

async function openHistoryEpisode(seriesId, episodeId) { 
    try { 
        const [series, episode] = await Promise.all([api(`/series/${seriesId}`), api(`/episodes/${episodeId}`)]); 
        if(series && episode) {
            state.currentSeries = series; 
            setSection('watch'); 
            await openEpisode(episode._id); 
        }
    } catch (error) { toast(error.message, 'error'); } 
} 

function renderProfile(profile) {
    const user = profile.user || {}; 
    const details = user.profile || {}; 
    const avatar = details.avatarUrl || user.profileImage;
    
    const nameEl = $('#profile-display-name');
    if (nameEl) nameEl.textContent = details.displayName || user.username || 'Profile';
    
    const handleEl = $('#profile-handle');
    if (handleEl) handleEl.textContent = `@${user.username || 'story-lover'}`;
    
    const bioEl = $('#profile-bio');
    if (bioEl) bioEl.textContent = details.bio || 'Complete your profile to help your story journey feel like home.';
    
    const locEl = $('#profile-location');
    if (locEl) locEl.textContent = [details.region, details.country].filter(Boolean).join(' · ');
    
    const avatarEl = $('#profile-avatar');
    if (avatarEl) avatarEl.innerHTML = avatar ? `<img src="${image(avatar)}" alt="">` : esc((details.displayName || user.username || 'A')[0].toUpperCase());
    
    const coverEl = $('#profile-cover');
    if (coverEl && details.coverUrl) coverEl.style.backgroundImage = `linear-gradient(120deg,#111b,#1118),url('${image(details.coverUrl)}')`;
    
    const tabEl = $('.creator-profile-tab');
    if (tabEl) tabEl.classList.toggle('hidden', !profile.creator);
}

async function loadProfile(refresh = false) { 
    try { 
        if (!state.profile && !refresh) setSection('profile'); 
        if (state.profile && !refresh) { 
            renderProfile(state.profile); 
            setSection('profile'); 
            loadProfile(true); 
            return; 
        } 
        const profile = await api('/users/me/profile'); 
        if(profile) {
            state.profile = profile; 
            renderProfile(profile); 
            setSection('profile'); 
        }
    } catch (error) { 
        if (!state.profile) toast(error.message, 'error'); 
    } 
}

function openProfileEditor() {
    const user = state.profile?.user; 
    const profile = user?.profile || {};
    if (!user) return;
    
    const nameInput = $('#profile-display-name-input');
    if (nameInput) nameInput.value = profile.displayName || user.username || '';
    
    const usernameInput = $('#profile-username');
    if (usernameInput) usernameInput.value = user.username || ''; 
    
    const emailInput = $('#profile-email');
    if (emailInput) emailInput.value = user.email || '';
    
    const editPanel = $('#profile-edit-panel');
    if (editPanel) {
        editPanel.classList.remove('hidden'); 
        editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function loadNotifications() { 
    try { 
        const result = await api('/notifications/me?limit=50') || {}; 
        const listEl = $('#notification-list');
        if (listEl) {
            listEl.innerHTML = (result.notifications || []).map(item => `<article class="notification-item ${item.read ? '' : 'notification-unread'}"><span class="notification-item-icon">✧</span><div class="notification-item-content"><strong>${esc(item.title)}</strong><p>${esc(item.message || '')}</p><time>${new Date(item.createdAt).toLocaleString()}</time></div><div class="notification-item-actions"><button class="text-button" data-read-notification="${esc(item._id)}">Read</button></div></article>`).join('') || '<p>No new notifications</p>'; 
        }
    } catch (error) { toast(error.message, 'error'); } 
}

async function refreshNotificationBadge() { 
    try { 
        const result = await api('/notifications/me/unread-count') || {}; 
        const badge = $('#notification-badge'); 
        if (badge) {
            badge.textContent = result.unreadCount || 0; 
            badge.classList.toggle('hidden', !result.unreadCount); 
        }
    } catch {} 
} 

async function saveProfile(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving profile...';
    }

    try {
        const values = new FormData(form);

        const profileImgFile = values.get('profileImage');
        const coverImgFile = values.get('coverImage');

        let avatarUrl;
        let coverUrl;

        if (profileImgFile && profileImgFile.size) {
            const upload = await uploadAsset('/upload/image', profileImgFile);
            avatarUrl = upload.url || upload.secure_url || upload.mediaUrl;
        }

        if (coverImgFile && coverImgFile.size) {
            const upload = await uploadAsset('/upload/image', coverImgFile);
            coverUrl = upload.url || upload.secure_url || upload.mediaUrl;
        }

        const payload = {
            username: values.get('username'),
            profile: {
                displayName: values.get('displayName'),
                bio: values.get('bio'),
                country: values.get('country'),
                region: values.get('region'),
                preferredLanguage: values.get('preferredLanguage')
            }
        };

        if (avatarUrl) payload.profile.avatarUrl = avatarUrl;
        if (coverUrl) payload.profile.coverUrl = coverUrl;

        const updated = await api('/users/profile/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (updated) {
            state.user = { ...state.user, ...updated };
            renderHeaderUser(state.user);
            const editPanel = $('#profile-edit-panel');
            if (editPanel) editPanel.classList.add('hidden');
            form.reset(); 
            await loadProfile(true); 
            toast('Profile updated successfully!', 'success');
        }
    } catch (error) {
        toast(error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save profile';
        }
    }
}

async function searchLibrary(event) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const query = input ? input.value.trim() : '';
    if (query.length < 2) return toast('Enter at least two characters', 'error');
    try {
        const resEl = $('#search-results');
        if (resEl) resEl.innerHTML = '<p>Searching...</p>';
        const result = await api(`/search/global?q=${encodeURIComponent(query)}&limit=50`) || {};
        const seriesHtml = (result.series?.data || []).map(card).join('');
        const episodesHtml = (result.episodes?.data || []).map(episodeCard).join('');
        if (resEl) resEl.innerHTML = (seriesHtml + episodesHtml) || '<p>No stories matched your search.</p>';
    } catch (error) { toast(error.message, 'error'); }
} 

async function searchEpisodes(event) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const query = input ? input.value.trim() : '';
    if (query.length < 2) return toast('Enter at least two characters', 'error');
    try {
        const gridEl = $('#series-grid');
        if (gridEl) gridEl.innerHTML = '<p>Searching...</p>';
        const result = await api(`/search/global?q=${encodeURIComponent(query)}&type=episodes&limit=50`) || {};
        if (gridEl) gridEl.innerHTML = (result.episodes?.data || []).map(episodeCard).join('') || '<p>No episodes matched your search.</p>';
    } catch (error) { toast(error.message, 'error'); }
} 

async function loadTrending() { 
    try { 
        const result = await api('/search/trending') || {}; 
        const listEl = $('#trending-list');
        if (listEl) listEl.innerHTML = (result.trending || []).map(episodeCard).join('') || '<p>No trending episodes yet.</p>'; 
    } catch (error) { toast(error.message, 'error'); } 
} 

async function loadFavorites() {
    try {
        const result = await api('/favorites') || {};
        const list = result.favorites || result.data || result || [];
        const favEl = $('#favorites-list');
        if (favEl) favEl.innerHTML = list.map(card).join('') || '<p>Save stories from the player to build your library.</p>';
    } catch (error) { toast(error.message, 'error'); }
} 

async function toggleFavorite() { 
    if (!state.currentSeries) return toast('Open a story first', 'error'); 
    try { 
        const result = await api(`/favorites/${state.currentSeries._id}/toggle`, { method: 'POST' }); 
        if(result) toast(result.saved ? 'Added to favorites' : 'Removed from favorites', 'success'); 
    } catch (error) { toast(error.message, 'error'); } 
}

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('afrostory-settings') || '{}');
    const langEl = $('#settings-language');
    if (langEl) langEl.value = settings.language || 'en';
    const notifEl = $('#settings-notifications');
    if (notifEl) notifEl.checked = settings.notifications !== false;
}

function saveSettings(event) { 
    event.preventDefault(); 
    const langEl = $('#settings-language');
    const notifEl = $('#settings-notifications');     localStorage.setItem('afrostory-settings', JSON.stringify({          language: langEl ? langEl.value : 'en',          notifications: notifEl ? notifEl.checked : true      }));      toast('Settings saved', 'success');  }  /* ============================================================================ */ /* BULLETPROOF GLOBAL EVENT DELEGATION */ /* ============================================================================ */  document.addEventListener('change', event => {     try {         const targetId = event.target.id;         if (['genre-filter', 'sort-filter', 'cultural-filter', 'language-filter'].includes(targetId)) {             loadDiscover();         }     } catch (e) {         logFrontendError('filter_change_error', e.message, e.stack);     } });  document.addEventListener('click', async event => {     try {         const section = event.target.closest('[data-section]');          if (section) setSection(section.dataset.section);                  const series = event.target.closest('[data-series-id]');          if (series) openSeries(series.dataset.seriesId);                  const episodeRow = event.target.closest('[data-episode-id]');          if (episodeRow && !episodeRow.closest('.feed-video-card')) openEpisode(episodeRow.dataset.episodeId);          if (event.target.closest('[data-action="view-followers"]')) loadFollowersList();          const followBtn = event.target.closest('[data-action="follow-creator"]');         if (followBtn && !followBtn.disabled) {             event.preventDefault();             const creatorId = followBtn.dataset.creator;                          if (creatorId && creatorId !== 'undefined') {                 $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                    btn.disabled = true;
                    btn.style.pointerEvents = 'none';
                    const iconBadge = btn.querySelector('.follow-badge-icon');
                    if (iconBadge) iconBadge.innerHTML = '<span style="font-size:8px;">...</span>'; 
                });

                try {
                    const res = await api(`/creators/${creatorId}/follow`, { method: 'POST' });
                    
                    if (res && res.alreadyFollowing) {
                        toast('You already follow this creator', 'info');
                    } else {
                        toast('Following creator!', 'success');
                    }

                    $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                        const iconBadge = btn.querySelector('.follow-badge-icon');
                        if (iconBadge) {
                            iconBadge.textContent = '✓';
                            iconBadge.style.background = '#76a86b';
                            iconBadge.style.color = '#fff';
                            iconBadge.style.fontSize = '10px';
                        }
                    });
                } catch (error) { 
                    toast(error.message, 'error'); 
                    $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                        btn.disabled = false;
                        btn.style.pointerEvents = 'auto';
                        const iconBadge = btn.querySelector('.follow-badge-icon');
                        if (iconBadge) {
                            iconBadge.textContent = '+';
                        }
                    });
                }
            }
        }

        if (event.target.closest('[data-action="back-to-discover"]')) loadDiscover();
        if (event.target.closest('[data-action="unlock-current"]')) unlockEpisode();
        if (event.target.closest('[data-action="refresh-discover"]')) loadDiscover();
        if (event.target.closest('[data-action="buy-coins"]')) showPackages();
        if (event.target.closest('[data-action="buy-pass"]')) showSubscriptionPlans();

        if (event.target.closest('[data-action="close-upload"]') || event.target.id === 'upload-modal') {
            const el = $('#upload-modal');
            if (el) el.classList.add('hidden');
        }
        if (event.target.closest('[data-action="close-series"]') || event.target.id === 'series-modal') {
            const el = $('#series-modal');
            if (el) el.classList.add('hidden');
        }
        if (event.target.closest('[data-action="close-modal"]') || event.target.id === 'modal-root') {
            const el = $('#modal-root');
            if (el) el.classList.add('hidden');
        }
        if (event.target.closest('[data-action="close-notifications"]') || event.target.id === 'notification-modal') {
            const el = $('#notification-modal');
            if (el) el.classList.add('hidden');
        }

        if (event.target.closest('[data-action="new-series"]')) {
            const el = $('#series-modal');
            if (el) el.classList.remove('hidden');
        }
        if (event.target.closest('[data-action="open-upload"]')) { 
            const el = $('#upload-modal');
            if (el) el.classList.remove('hidden'); 
            loadCreator(); 
        }

        if (event.target.closest('[data-action="logout"]')) {
            try { 
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); 
            } catch(err) { 
                console.warn("Logout request failed silently"); 
            } finally { 
                window.location.replace('/'); 
            }
            return;
        }

        if (event.target.closest('[data-action="profile"]')) loadProfile();
        if (event.target.closest('[data-action="edit-profile"]')) openProfileEditor();
        if (event.target.closest('[data-action="close-profile-edit"]')) {
            const el = $('#profile-edit-panel');
            if (el) el.classList.add('hidden');
        }

        if (event.target.closest('[data-action="notifications"]')) { 
            const el = $('#notification-modal');
            if (el) el.classList.remove('hidden'); 
            await loadNotifications(); 
        }
        
        if (event.target.closest('[data-action="read-all"]')) { 
            try { 
                await api('/notifications/me/read-all', { method: 'PUT' }); 
                await loadNotifications(); 
                refreshNotificationBadge(); 
            } catch (error) { toast(error.message, 'error'); } 
        }
        
        const notification = event.target.closest('[data-read-notification]');
        if (notification) { 
            try { 
                await api(`/notifications/${notification.dataset.readNotification}/read`, { method: 'PUT' }); 
                await loadNotifications(); 
                refreshNotificationBadge(); 
            } catch (error) { toast(error.message, 'error'); } 
        }

        const historyLink = event.target.closest('[data-history-episode]');
        if (historyLink) openHistoryEpisode(historyLink.dataset.historySeries, historyLink.dataset.historyEpisode);

        if (event.target.closest('[data-action="save-current"]')) toggleFavorite();

        const tab = event.target.closest('[data-profile-tab]');
        if (tab) { 
            $$('.profile-tab').forEach(item => item.classList.toggle('active', item === tab));$$
('.profile-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `profile-panel-${tab.dataset.profileTab}`)); 
        }

        const packageButton = event.target.closest('[data-package]');
        if (packageButton) { 
            try { 
                const result = await api('/payment/initialize-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageKey: packageButton.dataset.package }) }); 
                if(result) window.location.href = result.authorizationUrl; 
            } catch (error) { toast(error.message, 'error'); } 
        }

        const tierButton = event.target.closest('[data-tier]');
        if (tierButton) {
            try {
                const res = await api('/vip/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: tierButton.dataset.tier, paymentMethod: 'wallet' }) });
                if (res && state.user) state.user.subscriptionExpiresAt = res.expiresAt;
                const root = $('#modal-root');
                if (root) root.classList.add('hidden');
                toast('Gate Pass activated! You can now watch freely.', 'success');
                loadWallet();
                if (location.hash === '#watch' && state.currentEpisode) openEpisode(state.currentEpisode._id);
            } catch (error) { toast(error.message, 'error'); }
        }

        const rewardBtn = event.target.closest('[data-reward-id]');
        if (rewardBtn && !rewardBtn.disabled) {
            rewardBtn.disabled = true; 
            rewardBtn.textContent = 'Claiming...';
            try {
                await api(`/rewards/${encodeURIComponent(rewardBtn.dataset.rewardId)}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                toast('Reward added to your wallet', 'success'); 
                await loadRewards(); 
                refreshNotificationBadge();
            } catch (error) { 
                rewardBtn.disabled = false; 
                rewardBtn.textContent = 'Claim reward'; 
                toast(error.message, 'error'); 
            }
        }
    } catch (globalError) {
        logFrontendError('click_handler_failure', globalError.message, globalError.stack);
    }
});

const uploadForm = $('#upload-form');
if (uploadForm) uploadForm.addEventListener('submit', submitUpload);

const seriesForm = $('#series-form');
if (seriesForm) seriesForm.addEventListener('submit', submitSeries);

const searchForm = $('#search-form');
if (searchForm) {
    searchForm.addEventListener('submit', event => {
        event.preventDefault();
        const input = event.target.querySelector('input');
        const query = input ? input.value.trim() : '';
        if (query.length < 2) return toast('Enter at least two characters', 'error');
        
        setSection('search');
        const libraryInput = $('#library-search-input');
        if (libraryInput) libraryInput.value = query;
        
        const libForm = $('#library-search-form');
        if (libForm) searchLibrary({ preventDefault: () => {}, target: libForm });
    });
}

const libSearchForm = $('#library-search-form');
if (libSearchForm) libSearchForm.addEventListener('submit', searchLibrary);

const profileForm = $('#profile-form');
if (profileForm) profileForm.addEventListener('submit', saveProfile);

const settingsForm = $('#settings-form');
if (settingsForm) settingsForm.addEventListener('submit', saveSettings);

const commentForm = $('#comment-form');
if (commentForm) {
    commentForm.addEventListener('submit', async event => { 
        event.preventDefault(); 
        const input = $('#comment-input'); 
        const submit = $('#comment-submit'); 
        if (!state.currentEpisode) return toast('Open an episode before commenting', 'error'); 
        if (!input || !input.value.trim()) return toast('Write a comment first', 'error'); 
        if (submit) {
            submit.disabled = true; 
            submit.textContent = 'Posting...'; 
        }
        try { 
            await api('/comments/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId: state.currentEpisode._id, text: input.value.trim() }) }); 
            input.value = ''; 
            await loadComments(state.currentEpisode._id); 
            toast('Comment posted', 'success'); 
        } catch (error) { 
            toast(error.message, 'error'); 
        } finally { 
            if (submit) {
                submit.disabled = false; 
                submit.textContent = 'Post'; 
            }
        } 
    });
}

const becomeCreatorForm = $('#become-creator-form'); if (becomeCreatorForm) {     becomeCreatorForm.addEventListener('submit', async (event) => {         event.preventDefault();         const form = event.target;         const brandInput = form.querySelector('[name="brandName"]');         const bioInput = form.querySelector('[name="bio"]');         const brandName = brandInput ? brandInput.value.trim() : '';         const bio = bioInput ? bioInput.value.trim() : '';         const submitBtn = form.querySelector('button[type="submit"]');                  if (!brandName) return toast('Brand name is required', 'error');                  if (submitBtn) {             submitBtn.disabled = true;             submitBtn.textContent = 'Creating...';         }                  try {             await api('/creators/become-creator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandName, bio }) });             if(state.user) state.user.role = 'CREATOR';             $$('.creator-only').forEach(el => el.classList.remove('hidden'));
            toast('Welcome to Creator Studio!', 'success'); 
            await loadCreator();
        } catch (error) { 
            toast(error.message, 'error'); 
        } finally { 
            if (submitBtn) {
                submitBtn.disabled = false; 
                submitBtn.textContent = 'Start creating'; 
            }
        }
    });
}

setInterval(refreshNotificationBadge, 30000);

window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (['discover', 'search', 'watch', 'history', 'wallet', 'rewards', 'creator', 'admin', 'profile', 'trending', 'continue', 'favorites', 'settings'].includes(name)) {
        setSection(name);
        if (name === 'history') loadHistory();
        if (name === 'trending') loadTrending();
        if (name === 'continue') loadContinue();
        if (name === 'favorites') loadFavorites();
        if (name === 'settings') loadSettings();
    }
});

async function boot() {
    try {
        state.user = await api('/auth/me').catch(() => null); 
        renderHeaderUser(state.user);
        
        if (state.user?.role && ['CREATOR', 'ADMIN'].includes(state.user.role)) {
            $$('.creator-only').forEach(el => el.classList.remove('hidden'));         }         if (state.user?.role === 'ADMIN') {             $$
('.admin-only').forEach(el => el.classList.remove('hidden'));
        }

        ensureClassificationControls(); 
        await loadDiscover().catch(e => console.warn(e)); 
        refreshNotificationBadge().catch(e => console.warn(e)); 
        if(window.AfroStoryAds && window.AfroStoryAds.refresh) window.AfroStoryAds.refresh().catch(e => console.warn(e)); 
        setupLazyLoading(); 
        return true; 
    } catch (error) {
        logFrontendError('boot_failure', error.message, error.stack);
        return true; 
    }
}

(async () => { if (await boot()) setSection(location.hash.slice(1) || 'discover'); })();
