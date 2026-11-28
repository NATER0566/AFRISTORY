const API = '/api';
const PREVIEW_LIMIT = 5; // Seconds of gripping hook preview before the video locks
const state = { 
    user: null, profile: null, wallet: null, rewards: null, series: [], 
    currentSeries: null, currentEpisode: null, hls: null, 
    recommendedEpisodes: [], feedEpisodes: [],
    coinRateNaira: 10, // Default Naira equivalent per Story Coin (auto-calibrated from /payment/packages)
    viewingSeriesId: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function emitAppEvent(name, detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {}
}

/* ============================================================================ */
/* ADMIN VISIBILITY CHECKER */
/* ============================================================================ */
function applyAdminVisibility() {
    let isAdmin = false;
    
    if (state.user && String(state.user.role).toUpperCase() === 'ADMIN') {
        isAdmin = true;
    } else {
        try {
            const token = localStorage.getItem('token');
            if (token) {
                const payload = JSON.parse(atob(token.split('.')[1]));
                const role = payload.role || (payload.user && payload.user.role);
                if (role && String(role).toUpperCase() === 'ADMIN') isAdmin = true;
            }
        } catch (e) {}
    }

    const desktopBtn = $('#desktop-admin-btn');
    if (desktopBtn) {
        desktopBtn.classList.toggle('hidden', !isAdmin);
        desktopBtn.style.display = isAdmin ? 'flex' : 'none';
    }

    const mobileBtn = $('#mobile-admin-btn');
    if (mobileBtn) {
        mobileBtn.classList.toggle('hidden', !isAdmin);
        mobileBtn.style.display = isAdmin ? 'flex' : 'none';
    }
}

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
    const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Unknown';
    if (event.reason?.name === 'AbortError' || msg.includes('interrupted by a call to pause')) return;
    logFrontendError('unhandled_promise', msg, event.reason ? event.reason.stack : '');
});

/* ============================================================================ */
/* NON-BLOCKING API WRAPPER */
/* ============================================================================ */
const api = async (path, options = {}) => {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeout) > 0 ? Number(options.timeout) : 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const method = (options.method || 'GET').toUpperCase();
    
    const startTime = performance.now();

    try {
        const { timeout, isExplicitLogout, ...restOptions } = options;
        const fetchOptions = {
            credentials: 'include',
            signal: controller.signal,
            ...restOptions
        };

        // Prevent stale browser caching on dynamic GET requests (notifications, balances, feeds)
        if (method === 'GET' && !fetchOptions.cache) {
            fetchOptions.cache = 'no-store';
        }

        const response = await fetch(`${API}${path}`, fetchOptions);
        
        const duration = performance.now() - startTime;
        if (duration > 3000) {
            logFrontendError('performance_warning', `Slow API call: ${path} took ${Math.round(duration)}ms`, '');
        }

        const data = await response.json().catch(() => ({}));
        
        if (response.status === 401) { 
            if (isExplicitLogout) window.location.replace('/');
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

/* ============================================================================ */
/* HOOK PREVIEW & EPISODE ORDER HELPERS */
/* ============================================================================ */
function getEpisodeHookStart(episode) {
    if (!episode) return 0;
    if (Number.isFinite(Number(episode.hookStart)) && Number(episode.hookStart) > 0) {
        return Number(episode.hookStart);
    }
    const rawUrl = episode.mediaUrl || episode.videoUrl || episode.hlsUrl || '';
    const hashMatch = String(rawUrl).match(/#t=(\d+(?:\.\d+)?)/i);
    if (hashMatch) return Number(hashMatch[1]) || 0;
    return 0;
}

function getCleanMediaUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    return rawUrl.split('#')[0];
}

function getEpisodeCardVideoUrl(episode) {
    const cleanUrl = getCleanMediaUrl(episode?.mediaUrl || episode?.videoUrl || episode?.hlsUrl || '');
    if (!cleanUrl || cleanUrl.includes('.m3u8')) return '';
    const hookStart = getEpisodeHookStart(episode);
    return `${cleanUrl}#t=${hookStart},${hookStart + 5}`;
}

function sortSeriesEpisodes(episodes) {
    return [...episodes].sort((a, b) => {
        const numA = Number(a.episodeNumber);
        const numB = Number(b.episodeNumber);
        if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
            return numA - numB;
        }
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
}

function isSeriesCompleted(series) {
    if (!series) return false;
    return Boolean(
        series.isCompleted === true ||
        series.completed === true ||
        String(series.status || '').toUpperCase() === 'COMPLETED'
    );
}

/* ============================================================================ */
/* FORMATTERS */
/* ============================================================================ */
function formatRating(rating, count) {
    if (!count || count === 0) return '★ No ratings';
    return `★ ${Number(rating).toFixed(1)} (${count})`;
}

function formatViews(views) {
    const v = Number(views) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toString();
}

function formatNaira(amount) {
    const num = Number(amount) || 0;
    return `₦${num.toLocaleString(undefined, { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatFileSize(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${Math.round(b / 1024)} KB`;
    return `${b} B`;
}

function formatDurationSeconds(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

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

let discoverLoaded = false;
let suppressHashSync = false;

function getActiveSectionName() {
    const activeSection = document.querySelector('.app-section:not(.hidden)');
    if (activeSection && activeSection.id?.startsWith('section-')) {
        return activeSection.id.replace('section-', '');
    }
    return location.hash.slice(1) || 'discover';
}

function setSection(name) {
    if (!name) return;

    if (name !== 'watch' && state.currentEpisode) {
        const activeVideo = currentlyPlaying || document.querySelector('.feed-video-card video');
        if (activeVideo) {
            saveProgressFeed(state.currentEpisode, activeVideo, false, true);
            activeVideo.pause();
        }
    }

    $$('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== `section-${name}`));
    $$('.nav-item[data-section]').forEach(item => item.classList.toggle('active', item.dataset.section === name));
    $('#genre-filter')?.closest('.discover-filters')?.classList.toggle('hidden', name !== 'discover');
    $('#save-current')?.classList.toggle('hidden', name !== 'watch');
    $$('.modal-root').forEach(m => m.classList.add('hidden'));
    
    $('#mobile-more-sheet')?.classList.add('hidden');
    
    if (location.hash.slice(1) !== name) {
        suppressHashSync = true;
        location.hash = name;
        setTimeout(() => { suppressHashSync = false; }, 0);
    }

    if (name === 'discover' && !discoverLoaded) loadDiscover();
    if (name === 'watch' && (!state.currentEpisode || !$('#tiktok-feed')?.children.length)) openDefaultFeed();
    if (name === 'wallet') loadWallet();
    if (name === 'rewards') loadRewards();
    if (name === 'creator') loadCreator();
    if (name === 'history') loadHistory();
    if (name === 'continue') loadContinue();
    if (name === 'favorites') loadFavorites();
    if (name === 'trending') loadTrending();
    if (name === 'settings') loadSettings();

    window.AfroStoryAds?.refresh?.().catch?.(() => {});
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
            const anchor = access.closest('label') || access;
            anchor.insertAdjacentHTML('beforebegin', `<label>Genre<select id="upload-genre" name="genre" required><option value="">Choose genre</option>${options(episodeGenres)}</select></label><label>Cultural category<select id="upload-cultural-category" name="culturalCategory" required><option value="">Choose culture</option>${options(culturalCategories)}</select></label><label>Language<select id="upload-language" name="language" required><option value="">Choose language</option>${options(episodeLanguages)}</select></label><label>Tags<input name="tags" maxlength="300" placeholder="family, tradition, village"></label>`);
        }
    }
}

function card(series, opts = {}) { 
    const completed = isSeriesCompleted(series);
    const statusBadge = completed
        ? `<span class="card-tag" style="background: rgba(34, 197, 94, 0.92); color: #09150e; font-weight: 800;">✓ COMPLETED</span>`
        : `<span class="card-tag">${esc(series.genre || 'SERIES')}</span>`;

    const creatorControls = opts.showCreatorControls
        ? `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #262626; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <span style="font-size: 11px; font-weight: 700; color: ${completed ? '#22c55e' : '#d4a017'};">${completed ? '● Completed Series' : '● Ongoing Series'}</span>
                <button type="button" class="button button-quiet" data-action="toggle-series-complete" data-series-id="${esc(series._id)}" data-completed="${completed ? 'true' : 'false'}" style="padding: 5px 10px; font-size: 11px; border-color: ${completed ? '#444' : '#d4a017'}; color: ${completed ? '#ccc' : '#ffd24c'};">
                    ${completed ? 'Reopen Series' : 'Mark Completed'}
                </button>
           </div>`
        : '';

    return `<article class="series-card" data-series-id="${esc(series._id)}">
        <div class="card-image" style="background-image:url('${image(series.coverImage)}')">
            ${statusBadge}
        </div>
        <div class="card-body">
            <h3>${esc(series.title)}</h3>
            <p>${esc(series.language || 'English')} &nbsp; · &nbsp; ${esc(series.genre || 'Story')}${completed ? ' &nbsp; · &nbsp; <strong style="color:#22c55e;">Completed</strong>' : ''}</p>
            ${creatorControls}
        </div>
    </article>`; 
}

function episodeCard(episode, tagOverride = null) { 
    const series = episode.seriesId || {}; 
    const creator = series.creatorId || {}; 
    const previewVideoUrl = getEpisodeCardVideoUrl(episode);
    const tagLabel = tagOverride || esc(episode.genre || 'EPISODE');
    const previewVideoHtml = previewVideoUrl 
        ? `<video class="card-preview-video" src="${esc(previewVideoUrl)}" muted autoplay loop playsinline preload="metadata"></video>` 
        : '';

    return `<article class="series-card episode-card" data-episode-id="${esc(episode._id)}">
        <div class="card-image" style="background-image:url('${image(series.coverImage)}')">
            ${previewVideoHtml}
            <span class="card-tag">${tagLabel}</span>
        </div>
        <div class="card-body">
            <h3>${esc(episode.title)}</h3>
            <p>${esc(series.title || 'Story')} · ${esc(episode.culturalCategory || 'African story')}</p>
            <p>${esc(creator.brandName || '')} · ${esc(episode.language || 'English')} · ${Math.max(1, Math.round(Number(episode.duration || 0) / 60))} min</p>
        </div>
    </article>`; 
}

async function loadDiscover() {
    try {
        discoverLoaded = true;
        state.viewingSeriesId = null;
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
            seriesGrid.innerHTML = state.series.map(s => card(s)).join('') || '<p>No stories match this filter.</p>';
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

/* ============================================================================ */
/* SERIES COMPLETION / STATUS MANAGEMENT */
/* ============================================================================ */
async function toggleSeriesCompletion(seriesId, currentCompleted) {
    if (!seriesId) return;
    const nextCompleted = !Boolean(currentCompleted);
    const nextStatus = nextCompleted ? 'COMPLETED' : 'ONGOING';

    $$(`[data-action="toggle-series-complete"][data-series-id="${seriesId}"]`).forEach(btn => {
        btn.disabled = true;
        btn.textContent = 'Updating...';
    });

    try {
        const payload = {
            isCompleted: nextCompleted,
            completed: nextCompleted,
            status: nextStatus
        };

        const updatedRes = await api(`/series/${encodeURIComponent(seriesId)}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .catch(() => api(`/series/${encodeURIComponent(seriesId)}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }))
        .catch(() => api(`/series/${encodeURIComponent(seriesId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }));

        const updatedSeries = updatedRes?.series || updatedRes || {};
        if (state.currentSeries && String(state.currentSeries._id) === String(seriesId)) {
            state.currentSeries = { ...state.currentSeries, ...payload, ...updatedSeries };
        }
        state.series = state.series.map(s => String(s._id) === String(seriesId) ? { ...s, ...payload, ...updatedSeries } : s);

        emitAppEvent('afrostory:series-updated', { seriesId, isCompleted: nextCompleted, status: nextStatus });
        toast(nextCompleted ? 'Series marked as Completed!' : 'Series reopened as Ongoing!', 'success');

        await syncAfterContentMutation({ seriesId });
    } catch (error) {
        toast(error.message || 'Could not update series status', 'error');
        $$(`[data-action="toggle-series-complete"][data-series-id="${seriesId}"]`).forEach(btn => {
            btn.disabled = false;
            btn.textContent = currentCompleted ? 'Reopen Series' : 'Mark Completed';
        });
    }
}

/* ============================================================================ */
/* TIKTOK STYLE FEED & BOLD FOLLOW ICON BADGE */
/* ============================================================================ */
function buildFollowBadgeMarkup(isFollowing) {
    if (isFollowing) {
        return `<div class="follow-badge-icon" aria-label="Following" style="position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: #22c55e; color: #ffffff; border: 2px solid #0b0b0b; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.9); display: flex; align-items: center; justify-content: center; z-index: 6; transition: transform 0.18s ease, background 0.2s ease;">
            <svg viewBox="0 0 24 24" width="13" height="13" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>`;
    }
    return `<div class="follow-badge-icon" aria-label="Follow" style="position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%); width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #ffd24c 0%, #d4a017 100%); color: #0b0b0b; border: 2px solid #0b0b0b; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 0 1.5px rgba(255, 210, 76, 0.45); display: flex; align-items: center; justify-content: center; z-index: 6; transition: transform 0.18s ease, background 0.2s ease;">
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="#0b0b0b" stroke-width="4.2" stroke-linecap="round" fill="none" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    </div>`;
}

function ensureUnmutePill(videoEl) {
    const cardEl = videoEl?.closest('.feed-video-card');
    if (!cardEl || cardEl.querySelector('.unmute-pill')) return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'unmute-pill';
    pill.innerHTML = '🔇 Tap for sound';
    pill.addEventListener('click', (e) => {
        e.stopPropagation();
        videoEl.muted = false;
        videoEl.play().catch(() => {});
        pill.remove();
    });
    cardEl.appendChild(pill);
}

function safePlay(videoEl) {
    if (!videoEl) return;
    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            if (!videoEl.muted) {
                videoEl.closest('.feed-video-card')?.querySelector('.unmute-pill')?.remove();
            }
        }).catch((err) => {
            if (err.name === 'AbortError') return;
            if (!videoEl.muted) {
                videoEl.muted = true;
                videoEl.play().then(() => ensureUnmutePill(videoEl)).catch(() => {});
            }
        });
    }
}

function seekToHookIfNeeded(videoEl, episode) {
    if (!videoEl || !episode) return;
    if (!episode.hasAccess) {
        const hookStart = getEpisodeHookStart(episode);
        if (hookStart > 0 && videoEl.currentTime < hookStart) {
            try {
                if (Number.isFinite(videoEl.duration) && hookStart < videoEl.duration - 2) {
                    videoEl.currentTime = hookStart;
                }
            } catch (e) {}
        }
    } else if (Number(episode.lastPosition) > 1 && videoEl.currentTime < 1) {
        try {
            if (Number.isFinite(videoEl.duration) && Number(episode.lastPosition) < videoEl.duration - 2) {
                videoEl.currentTime = Number(episode.lastPosition);
            }
        } catch (e) {}
    }
}

function attachVideoSource(videoEl, episode = null) {
    if (!videoEl || videoEl.dataset.loaded === 'true') return;
    const rawMediaUrl = videoEl.dataset.mediaUrl || '';
    const actualMediaUrl = getCleanMediaUrl(rawMediaUrl);
    if (!actualMediaUrl) return;
    videoEl.dataset.loaded = 'true';

    if (actualMediaUrl.includes('.m3u8')) {
        if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = actualMediaUrl;
        } else if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls();
            hls.loadSource(actualMediaUrl);
            hls.attachMedia(videoEl);
            videoEl._hls = hls;
        } else {
            videoEl.src = actualMediaUrl;
        }
    } else {
        videoEl.src = actualMediaUrl;
    }

    if (episode) {
        videoEl.addEventListener('loadedmetadata', () => seekToHookIfNeeded(videoEl, episode), { once: true });
    }
}

function cleanupFeedVideos() {
    $$('#tiktok-feed video').forEach(video => {
        try {
            video.pause();
            if (video._hls) {
                video._hls.destroy();
                video._hls = null;
            }
            video.removeAttribute('src');
            video.load();
        } catch (e) {}
    });
}

let currentlyPlaying = null;
const feedObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const video = entry.target.querySelector('video');
        if (!video) return;
        
        if (entry.isIntersecting) {
            if (currentlyPlaying && currentlyPlaying !== video) {
                currentlyPlaying.pause();
            }
            const epId = entry.target.dataset.episodeId;
            const epData = state.feedEpisodes.find(e => String(e._id) === String(epId)) || {};
            attachVideoSource(video, epData);
            seekToHookIfNeeded(video, epData);
            safePlay(video);
            currentlyPlaying = video;

            // Preload only the immediate next video to avoid network congestion
            const nextCard = entry.target.nextElementSibling;
            if (nextCard) {
                const nextEpId = nextCard.dataset.episodeId;
                const nextEpData = state.feedEpisodes.find(e => String(e._id) === String(nextEpId)) || null;
                attachVideoSource(nextCard.querySelector('video'), nextEpData);
            }
            
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
            await openEpisode(feedData.episodes[0]._id, feedData.episodes);
        } else if (feedContainer) {
            feedContainer.innerHTML = '<p style="text-align:center; margin-top:50px;">No stories available right now.</p>';
        }
    } catch (e) { 
        toast('Could not load feed.', 'error'); 
    } finally { 
        isFetchingFeed = false; 
    }
} 

async function openSeries(id, options = {}) {
    try {
        const [rawSeries, episodesData] = await Promise.all([
            api(`/series/${id}`).catch(() => null),
            api(`/series/${id}/episodes?limit=100`).catch(() => ({}))
        ]);
        
        const seriesInfo = rawSeries?.series || rawSeries;
        if (!seriesInfo || !seriesInfo._id) throw new Error("Could not load series details");

        const episodes = sortSeriesEpisodes(episodesData.episodes || []).map(ep => ({
            ...ep,
            seriesId: (ep.seriesId && typeof ep.seriesId === 'object') ? ep.seriesId : seriesInfo
        }));

        state.currentSeries = seriesInfo;
        state.viewingSeriesId = String(seriesInfo._id);
        discoverLoaded = true;

        if (!options.silent) {
            $$('.app-section').forEach(section => section.classList.toggle('hidden', section.id !== 'section-discover'));
            $$('.nav-item[data-section]').forEach(item => item.classList.toggle('active', item.dataset.section === 'discover'));
            $('#genre-filter')?.closest('.discover-filters')?.classList.remove('hidden');
            $('#save-current')?.classList.add('hidden');
            if (location.hash.slice(1) !== 'discover') {
                suppressHashSync = true;
                location.hash = 'discover';
                setTimeout(() => { suppressHashSync = false; }, 0);
            }
        }

        $$('#section-discover .section-heading').forEach(el => el.classList.add('hidden'));
        const creatorGrid = $('#creator-grid');
        if (creatorGrid) creatorGrid.classList.add('hidden');

        const completed = isSeriesCompleted(seriesInfo);
        const ownerUserId = seriesInfo.creatorId?.userId?._id || seriesInfo.creatorId?.userId || seriesInfo.userId;
        const isOwner = Boolean(state.user && ownerUserId && String(ownerUserId) === String(state.user._id));

        const featured = $('#featured-series');
        if (featured) {
            featured.innerHTML = `
                <article class="featured-card" style="background-image: linear-gradient(to top, rgba(17,17,17,1) 0%, rgba(17,17,17,0.4) 100%), url('${image(seriesInfo.coverImage)}')">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:20px; position:relative; z-index:10;">
                        <button class="button button-quiet" data-action="back-to-discover">← Back to Series</button>
                        ${completed ? '<span style="background:rgba(34,197,94,0.2); border:1px solid #22c55e; color:#22c55e; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px;">✓ Completed Series</span>' : '<span style="background:rgba(212,160,23,0.16); border:1px solid rgba(212,160,23,0.5); color:#ffd24c; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px;">● Ongoing Series</span>'}
                    </div>
                    <p class="eyebrow" style="position: relative; z-index: 10;">${esc(seriesInfo.genre || 'SERIES')}</p>
                    <h2 style="position: relative; z-index: 10;">${esc(seriesInfo.title)}</h2>
                    <p style="position: relative; z-index: 10; max-width: 600px;">${esc(seriesInfo.description || 'No description available.')}</p>
                    <p style="color:#d4a017; margin-top:10px; position: relative; z-index: 10;">${esc(seriesInfo.language || 'English')} &nbsp; · &nbsp; ${esc(seriesInfo.genre || 'Story')} &nbsp; · &nbsp; ${episodes.length} Episode${episodes.length === 1 ? '' : 's'}</p>
                    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:15px; position:relative; z-index:10;">
                        ${episodes.length > 0 ? `<button class="button button-primary" data-episode-id="${esc(episodes[0]._id)}">Play Episode 1</button>` : ''}
                        ${isOwner ? `<button type="button" class="button button-quiet" data-action="toggle-series-complete" data-series-id="${esc(seriesInfo._id)}" data-completed="${completed ? 'true' : 'false'}">${completed ? 'Reopen Series' : 'Mark Series Completed'}</button>` : ''}
                    </div>
                </article>
            `;
        }
        
        const seriesGrid = $('#series-grid');
        if (seriesGrid) {
            if (episodes.length > 0) {
                seriesGrid.innerHTML = episodes.map((episode, index) => episodeCard(episode, `EPISODE ${episode.episodeNumber || (index + 1)}`)).join('');
            } else {
                seriesGrid.innerHTML = '<p style="grid-column: 1/-1;">This story has no episodes yet.</p>';
            }
        }
        
        if (!options.silent) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    } catch(e) { 
        if (!options.silent) toast('Could not open story.', 'error'); 
    }
}

let activeFeedRequestId = 0;

async function openEpisode(id, preloadedEpisodes = null) {
    const requestId = ++activeFeedRequestId;
    try {
        cleanupFeedVideos();
        currentlyPlaying = null;

        state.currentEpisode = { _id: id }; 
        setSection('watch');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        const feedContainer = $('#tiktok-feed');
        if (!feedContainer) return;
        feedObserver.disconnect();
        feedContainer.innerHTML = '<div class="feed-loading"></div>'; 

        const rawEp = await api(`/episodes/${id}`).catch(() => null);
        if (requestId !== activeFeedRequestId) return;

        const currentEp = rawEp?.episode || rawEp || {};
        if (!currentEp._id) currentEp._id = id;

        const targetSeriesId = (currentEp.seriesId && typeof currentEp.seriesId === 'object')
            ? currentEp.seriesId._id
            : (currentEp.seriesId || state.currentSeries?._id || null);

        let episodes = [];

        if (Array.isArray(preloadedEpisodes) && preloadedEpisodes.length > 0) {
            const startIndex = preloadedEpisodes.findIndex(ep => String(ep._id) === String(id));
            const ordered = startIndex > 0 ? preloadedEpisodes.slice(startIndex) : [...preloadedEpisodes];
            const filtered = ordered.filter(ep => String(ep._id) !== String(id));
            episodes = [currentEp, ...filtered];
        } else {
            const [seriesRes, feedRes] = await Promise.all([
                targetSeriesId ? api(`/series/${targetSeriesId}/episodes?limit=100`).catch(() => ({})) : Promise.resolve({}),
                api('/episodes/feed?sort=trending&limit=15').catch(() => ({}))
            ]);
            if (requestId !== activeFeedRequestId) return;

            const rawSeriesEpisodes = sortSeriesEpisodes(seriesRes?.episodes || []);
            const seriesMeta = (currentEp.seriesId && typeof currentEp.seriesId === 'object')
                ? currentEp.seriesId
                : (state.currentSeries && String(state.currentSeries._id) === String(targetSeriesId) ? state.currentSeries : null);

            const normalizedSeriesEpisodes = rawSeriesEpisodes.map((ep, idx) => ({
                ...ep,
                episodeNumber: ep.episodeNumber || (idx + 1),
                seriesId: (ep.seriesId && typeof ep.seriesId === 'object') ? ep.seriesId : (seriesMeta || ep.seriesId)
            }));

            const clickedIdx = normalizedSeriesEpisodes.findIndex(ep => String(ep._id) === String(id));
            let seriesQueue = [];
            if (clickedIdx !== -1) {
                const mergedFirst = {
                    ...normalizedSeriesEpisodes[clickedIdx],
                    ...currentEp,
                    episodeNumber: currentEp.episodeNumber || normalizedSeriesEpisodes[clickedIdx].episodeNumber,
                    seriesId: (currentEp.seriesId && typeof currentEp.seriesId === 'object')
                        ? currentEp.seriesId
                        : normalizedSeriesEpisodes[clickedIdx].seriesId
                };
                seriesQueue = [mergedFirst, ...normalizedSeriesEpisodes.slice(clickedIdx + 1)];
            } else {
                const fallbackFirst = {
                    ...currentEp,
                    seriesId: (currentEp.seriesId && typeof currentEp.seriesId === 'object') ? currentEp.seriesId : (seriesMeta || currentEp.seriesId)
                };
                seriesQueue = [fallbackFirst, ...normalizedSeriesEpisodes.filter(ep => String(ep._id) !== String(id))];
            }

            const seriesEpisodeIds = new Set(normalizedSeriesEpisodes.map(ep => String(ep._id)));
            seriesEpisodeIds.add(String(id));

            const discoveryEpisodes = (feedRes?.episodes || []).filter(ep => {
                if (seriesEpisodeIds.has(String(ep._id))) return false;
                const epSeriesId = (ep.seriesId && typeof ep.seriesId === 'object') ? ep.seriesId._id : ep.seriesId;
                return !targetSeriesId || String(epSeriesId) !== String(targetSeriesId);
            });

            episodes = [...seriesQueue, ...discoveryEpisodes];
        }

        const hasActiveVip = Boolean(state.user?.subscriptionExpiresAt && new Date(state.user.subscriptionExpiresAt) > new Date());
        if (hasActiveVip) {
            episodes = episodes.map(ep => ({ ...ep, hasAccess: true }));
        }

        state.feedEpisodes = episodes;
        if (episodes[0]) {
            state.currentEpisode = episodes[0];
            state.currentSeries = (episodes[0].seriesId && typeof episodes[0].seriesId === 'object')
                ? episodes[0].seriesId
                : (state.currentSeries || { _id: episodes[0].seriesId });
        }

        feedContainer.innerHTML = ''; 

        episodes.forEach((episode, index) => { 
            const actualMediaUrl = episode.mediaUrl || episode.videoUrl || episode.hlsUrl || ''; 
            const hookStart = getEpisodeHookStart(episode);
            const previewEnd = hookStart + PREVIEW_LIMIT;
            
            const cardEl = document.createElement('div'); 
            cardEl.className = 'feed-video-card'; 
            cardEl.dataset.episodeId = episode._id; 
            
            let lockScreen = ''; 
            
            if (!episode.hasAccess) { 
                lockScreen = `
                <div class="feed-lock-overlay hidden" id="lock-${episode._id}"> 
                    <span class="lock-icon">◈</span> 
                    <h3>Premium Story</h3> 
                    <p>You've reached the end of the free preview. Unlock now to watch the full episode from the beginning.</p> 
                    
                    <div style="display:flex; flex-direction:column; gap:12px; width: 85%; max-width: 300px;">
                        <button type="button" id="waterfall-ad-btn-${episode._id}" data-robins-rewarded data-action="waterfall-ad-unlock" data-episode-id="${episode._id}" class="button button-accent" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.5" fill="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> 
                            <span>Watch Ad to Unlock</span>
                        </button>

                        <button type="button" class="button" data-action="unlock-current" style="width:100%;">
                            Use ${episode.coinCost || 10} Coins
                        </button>
                    </div>
                </div>`; 
            } 

            const creatorObj = episode.seriesId?.creatorId || {};
            const creatorId = creatorObj._id || '';
            const creatorImgUrl = creatorObj.profileImage || creatorObj.userId?.profileImage;
            const fallbackInitial = esc((creatorObj.brandName || 'A')[0].toUpperCase());
            const profileDisplayHtml = creatorImgUrl 
                ? `<img src="${image(creatorImgUrl)}" alt="${esc(creatorObj.brandName || 'Creator')}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;">` 
                : `<span style="font-weight:800; color:#fff; font-size:18px; line-height:1;">${fallbackInitial}</span>`;

            const epNumText = episode.episodeNumber ? `Episode ${episode.episodeNumber} · ` : '';
            const isFollowing = Boolean(episode.isFollowing); 
            const followIconBadge = buildFollowBadgeMarkup(isFollowing);

            cardEl.innerHTML = `
                <video preload="${index <= 1 ? 'auto' : 'none'}" loop playsinline ${episode.hasAccess ? 'controls' : ''}></video> 
                ${lockScreen} 
                <div class="feed-overlay"> 
                    <h3 style="margin:0; font-size:18px; font-weight:700;">${esc(episode.title)}</h3> 
                    <p style="margin:4px 0 0 0; font-size:14px; opacity:0.9;">@${esc(creatorObj.brandName || 'AfroStory')} · ${epNumText}${esc(episode.seriesId?.title || '')}</p> 
                    <p class="feed-stats-line" style="margin:4px 0 0 0; font-size:12px; color:#d4a017;">
                        ${formatRating(episode.rating, episode.ratingCount)} &nbsp;·&nbsp; 👁 ${formatViews(episode.totalViews || 0)} views
                    </p>
                </div> 
                <div class="feed-sidebar"> 
                    <button type="button" class="feed-action-btn" data-action="follow-creator" data-creator="${esc(creatorId)}" ${isFollowing || !creatorId ? 'disabled style="pointer-events:none; opacity:1;"' : 'style="opacity:1;"'} title="${isFollowing ? 'Following Creator' : 'Follow Creator'}"> 
                        <div style="width: 48px; height: 48px; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; position: relative; overflow: visible;">
                            <div style="width: 46px; height: 46px; border-radius: 50%; overflow: hidden; border: 2.5px solid #ffffff; background: #222; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 12px rgba(0, 0, 0, 0.75);">
                                ${profileDisplayHtml}
                            </div>
                            ${creatorId ? followIconBadge : ''}
                        </div>
                    </button>
                    <button type="button" class="feed-action-btn" data-action="toggle-like" data-episode-id="${episode._id}" title="Like"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="${episode.isLiked ? '#e74c3c' : 'none'}" color="${episode.isLiked ? '#e74c3c' : 'currentColor'}"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> 
                        <span class="like-count-text">${formatViews(episode.likeCount || 0)}</span> 
                    </button>
                    <button type="button" class="feed-action-btn" data-action="rate-episode" data-episode-id="${episode._id}" title="Rate"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> 
                        <span>Rate</span> 
                    </button>
                    <button type="button" class="feed-action-btn" data-action="save-current" title="Save to Favorites"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> 
                        <span>Save</span> 
                    </button>
                    <button type="button" class="feed-action-btn" onclick="document.getElementById('comments-sheet').classList.remove('hidden')" title="Comments"> 
                        <svg viewBox="0 0 24 24" width="30" height="30" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> 
                        <span>Reply</span> 
                    </button> 
                </div>`; 
            
            const videoEl = cardEl.querySelector('video'); 
            videoEl.dataset.mediaUrl = actualMediaUrl;

            if (index <= 1) {
                attachVideoSource(videoEl, episode);
            }

            let hasTrackedView = false;
            let lastSavedBucket = -1;

            if (!episode.hasAccess) { 
                videoEl.addEventListener('timeupdate', () => { 
                    if (!hasTrackedView && (videoEl.currentTime - hookStart) >= 5) {
                        hasTrackedView = true;
                        api(`/episodes/${episode._id}/record-view`, { method: 'POST' }).catch(() => {});
                    }

                    if (episode.hasAccess) return; 
                    
                    if (videoEl.currentTime >= previewEnd) { 
                        if (Math.abs(videoEl.currentTime - previewEnd) > 1) {
                            videoEl.currentTime = previewEnd; 
                        }
                        videoEl.pause(); 
                        videoEl.removeAttribute('controls'); 
                        const lockUI = cardEl.querySelector(`#lock-${episode._id}`);
                        if (lockUI) lockUI.classList.remove('hidden'); 
                    } 
                }); 
                videoEl.addEventListener('seeked', () => { 
                    if (episode.hasAccess) return;
                    if (videoEl.currentTime >= previewEnd) { 
                        videoEl.pause(); 
                        videoEl.currentTime = previewEnd; 
                        videoEl.removeAttribute('controls'); 
                        const lockUI = cardEl.querySelector(`#lock-${episode._id}`);
                        if (lockUI) lockUI.classList.remove('hidden'); 
                    } 
                }); 
            } else {
                videoEl.addEventListener('timeupdate', () => { 
                    if (!hasTrackedView && videoEl.currentTime > 5) {
                        hasTrackedView = true;
                        api(`/episodes/${episode._id}/record-view`, { method: 'POST' }).catch(() => {});
                    }

                    // Save watch progress every 5 seconds and detect completion even on looped videos
                    const bucket = Math.floor(videoEl.currentTime / 5);
                    if (bucket > lastSavedBucket && videoEl.currentTime > 1) {
                        lastSavedBucket = bucket;
                        const dur = (videoEl.duration && Number.isFinite(videoEl.duration)) ? videoEl.duration : (episode.duration || 0);
                        const isDone = dur > 0 && (videoEl.currentTime / dur) >= 0.92;
                        saveProgressFeed(episode, videoEl, isDone);
                    }
                });
            }
            
            videoEl.addEventListener('pause', () => saveProgressFeed(episode, videoEl, false, true)); 
            videoEl.addEventListener('ended', () => saveProgressFeed(episode, videoEl, true, true)); 
            
            feedContainer.appendChild(cardEl); 
            feedObserver.observe(cardEl); 
        }); 
    } catch (error) {
        logFrontendError('open_episode_failed', error.message, error.stack);
        toast('Failed to load feed', 'error');
    }
}

function unlockFeedEpisodeInDOM(episodeId) {
    const epData = state.feedEpisodes.find(e => String(e._id) === String(episodeId));
    if (epData) epData.hasAccess = true;
    if (state.currentEpisode && String(state.currentEpisode._id) === String(episodeId)) {
        state.currentEpisode.hasAccess = true;
    }

    const lockUI = document.getElementById(`lock-${episodeId}`);
    if (lockUI) {
        lockUI.classList.add('hidden');
        const videoEl = lockUI.parentElement?.querySelector('video');
        if (videoEl) {
            videoEl.currentTime = 0;
            videoEl.setAttribute('controls', 'true');
            safePlay(videoEl);
        }
    }
    emitAppEvent('afrostory:episode-unlocked', { episodeId });
}

const saveProgressTimers = new Map();
async function saveProgressFeed(episode, video, completed = false, immediate = false) {
    if (!episode || !episode._id || (!completed && video.currentTime === 0)) return;
    const epKey = String(episode._id);
    
    const sendProgress = async () => {
        saveProgressTimers.delete(epKey);
        const durationToUse = (video.duration && Number.isFinite(video.duration)) ? video.duration : (Number(episode.duration) || 60);
        const rawPct = completed ? 100 : Math.min(100, Math.round((video.currentTime / durationToUse) * 100));
        const isCompleted = Boolean(completed || rawPct >= 92);
        const watchedPercentage = isCompleted ? 100 : rawPct;

        try {
            await api(`/episodes/${episode._id}/watch`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    lastPosition: isCompleted ? 0 : video.currentTime, 
                    watchedPercentage, 
                    completed: isCompleted 
                }) 
            });
            const activeTab = getActiveSectionName();
            if (activeTab === 'history') loadHistory();
            if (activeTab === 'continue') loadContinue();
        } catch {}
    };

    const existingTimer = saveProgressTimers.get(epKey);
    if (existingTimer) clearTimeout(existingTimer);

    if (immediate) {
        await sendProgress();
    } else {
        saveProgressTimers.set(epKey, setTimeout(sendProgress, 800));
    }
}

/* ============================================================================ */
/* PREMIUM EPISODE UNLOCK (COINS) */
/* ============================================================================ */
async function unlockEpisode() {
    if (!state.currentEpisode) return;
    try {
        const hasActiveSubscription = state.user?.subscriptionExpiresAt && new Date(state.user.subscriptionExpiresAt) > new Date();
        if (hasActiveSubscription) {
            unlockFeedEpisodeInDOM(state.currentEpisode._id);
            toast('✓ This episode is included in your VIP subscription!', 'success');
            return;
        }

        if (window.Swal) { 
            const result = await Swal.fire({ 
                title: '🎬 Premium Story', 
                html: `<p style="font-size:15px; margin-top:15px;">Use <strong style="color:#d4a017;">${state.currentEpisode.coinCost || 10} coins</strong> to unlock permanently.</p>`, 
                showCancelButton: true, 
                confirmButtonText: `💰 Unlock (${state.currentEpisode.coinCost || 10} Coins)`, 
                cancelButtonText: 'Cancel', 
                confirmButtonColor: '#d4a017', 
                background: '#1b1b1b', 
                color: '#f5f5f5', 
                allowOutsideClick: false, 
                allowEscapeKey: false 
            }); 
            
            if (!result.isConfirmed) return; 
        } 
        
        const unlockRes = await api('/wallet/unlock-episode', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ episodeId: state.currentEpisode._id, method: 'COIN' }) 
        }); 
        
        if (!unlockRes) return toast('Failed to unlock (not enough coins)', 'error');
        
        unlockFeedEpisodeInDOM(state.currentEpisode._id);
        toast('✨ Episode unlocked! Enjoy the story!', 'success'); 

        // Live sync wallet balance, transactions & notifications in the background
        Promise.all([loadWallet(), loadRewards(), refreshNotificationBadge()]).catch(() => {});
    } catch (error) { toast(error.message, 'error'); }
}

let lastCommentsEpisodeId = null;
async function loadComments(id, force = false) { 
    if (!id || (!force && lastCommentsEpisodeId === id)) return;
    lastCommentsEpisodeId = id;
    try { 
        const result = await api(`/comments/episode/${id}?limit=50`) || {}; 
        const render = comment => {
            const username = comment.userId?.username || 'Story lover';
            return `<article class="comment"><span class="comment-meta">${esc(username)}</span><p>${esc(comment.text)}</p><button type="button" class="text-button" data-reply-comment="${esc(comment._id)}" data-reply-user="${esc(username)}">Reply</button>${comment.replies?.length ? `<div class="comment-replies">${comment.replies.map(render).join('')}</div>` : ''}</article>`;
        }; 
        const commentsList = $('#comments-list');
        if (commentsList) commentsList.innerHTML = (result.comments || []).map(render).join('') || '<p>Be the first to share a thought.</p>'; 
        
        const input = $('#comment-input');
        const submit = $('#comment-submit');
        if (input && submit) {
            input.placeholder = 'Share what this story brought up for you...'; 
            input.disabled = false; 
            submit.disabled = false; 
        }
    } catch (error) { 
        lastCommentsEpisodeId = null;
        toast(error.message, 'error'); 
    } 
} 

/* ============================================================================ */
/* WALLET & MONEY DISPLAY (LIVE SYNCED & HIGH-CLARITY LEDGER) */
/* ============================================================================ */
function ensureWalletSummaryBanner(walletInfo) {
    const walletSection = $('#section-wallet');
    if (!walletSection) return;

    let summaryBox = $('#wallet-live-summary');
    if (!summaryBox) {
        summaryBox = document.createElement('div');
        summaryBox.id = 'wallet-live-summary';
        summaryBox.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0 22px; padding: 14px; background: linear-gradient(135deg, rgba(212, 160, 23, 0.12), rgba(20, 20, 20, 0.95)); border: 1px solid rgba(212, 160, 23, 0.35); border-radius: 12px;';

        const transList = $('#transactions-list');
        const anchor = transList?.closest('.panel, .card, .section-card') || transList;
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(summaryBox, anchor);
        } else {
            walletSection.appendChild(summaryBox);
        }
    }

    const hasActiveVip = Boolean(state.user?.subscriptionExpiresAt && new Date(state.user.subscriptionExpiresAt) > new Date());
    const vipText = hasActiveVip
        ? `VIP Active · Until ${new Date(state.user.subscriptionExpiresAt).toLocaleDateString()}`
        : 'Standard Pass';

    summaryBox.innerHTML = `
        <div style="background: rgba(15, 15, 15, 0.85); border: 1px solid #2b2b2b; border-radius: 10px; padding: 12px 14px;">
            <span style="display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #999; margin-bottom: 4px;">Available Balance</span>
            <strong style="display: block; font-size: 20px; font-weight: 800; color: #ffd24c; line-height: 1.2;">${walletInfo.storyCoins.toLocaleString()} <span style="font-size: 12px; font-weight: 600; color: #e5e5e5;">Coins</span></strong>
            <small style="display: block; margin-top: 4px; font-size: 12px; color: #2ecc71; font-weight: 600;">Value ≈ ${formatNaira(walletInfo.estimatedNaira)}</small>
        </div>
        <div style="background: rgba(15, 15, 15, 0.85); border: 1px solid #2b2b2b; border-radius: 10px; padding: 12px 14px;">
            <span style="display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #999; margin-bottom: 4px;">Total Earned</span>
            <strong style="display: block; font-size: 20px; font-weight: 800; color: #2ecc71; line-height: 1.2;">+${walletInfo.totalEarned.toLocaleString()} <span style="font-size: 12px; font-weight: 600; color: #e5e5e5;">Coins</span></strong>
            <small style="display: block; margin-top: 4px; font-size: 12px; color: #aaa;">Rewards & Creator Earnings</small>
        </div>
        <div style="background: rgba(15, 15, 15, 0.85); border: 1px solid #2b2b2b; border-radius: 10px; padding: 12px 14px;">
            <span style="display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #999; margin-bottom: 4px;">Total Spent</span>
            <strong style="display: block; font-size: 20px; font-weight: 800; color: #f5f5f5; line-height: 1.2;">${walletInfo.totalSpent.toLocaleString()} <span style="font-size: 12px; font-weight: 600; color: #aaa;">Coins</span></strong>
            <small style="display: block; margin-top: 4px; font-size: 12px; color: #d4a017; font-weight: 600;">${esc(vipText)}</small>
        </div>
    `;
}

function renderWalletTransactionRow(item) {
    const rawType = String(item.type || item.category || 'TRANSACTION').toUpperCase();
    const isSpend = rawType === 'SPEND' || rawType === 'DEBIT' || rawType === 'UNLOCK' || Number(item.amount) < 0;
    const absAmount = Math.abs(Number(item.amount || 0));

    let badgeLabel = rawType.replaceAll('_', ' ');
    let badgeBg = 'rgba(212, 160, 23, 0.16)';
    let badgeColor = '#ffd24c';
    let iconSymbol = '◈';

    if (rawType.includes('PURCHASE') || rawType.includes('DEPOSIT') || rawType.includes('TOPUP')) {
        badgeLabel = 'COIN PURCHASE';
        badgeBg = 'rgba(46, 204, 113, 0.16)';
        badgeColor = '#2ecc71';
        iconSymbol = '💳';
    } else if (rawType.includes('REWARD') || rawType.includes('BONUS') || rawType.includes('EARN')) {
        badgeLabel = 'REWARD EARNED';
        badgeBg = 'rgba(46, 204, 113, 0.16)';
        badgeColor = '#2ecc71';
        iconSymbol = '✦';
    } else if (rawType.includes('VIP') || rawType.includes('PASS') || rawType.includes('SUB')) {
        badgeLabel = 'VIP GATE PASS';
        badgeBg = 'rgba(212, 160, 23, 0.2)';
        badgeColor = '#ffd24c';
        iconSymbol = '👑';
    } else if (isSpend) {
        badgeLabel = 'STORY UNLOCK';
        badgeBg = 'rgba(231, 76, 60, 0.16)';
        badgeColor = '#ff7675';
        iconSymbol = '🎬';
    }

    const nairaRaw = item.nairaAmount ?? item.amountNaira ?? item.fiatAmount ?? null;
    const nairaSubtext = (nairaRaw != null && Number(nairaRaw) > 0)
        ? `<small style="display: block; font-size: 11px; color: #aaa; margin-top: 2px;">${formatNaira(nairaRaw)}</small>`
        : '';

    const sign = isSpend ? '-' : '+';
    const amountColor = isSpend ? '#ff7675' : '#2ecc71';

    return `
        <div class="data-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 12px; border-bottom: 1px solid #242424; background: rgba(255,255,255,0.015); border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                <div style="width: 38px; height: 38px; border-radius: 10px; background: ${badgeBg}; color: ${badgeColor}; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.06);">
                    ${iconSymbol}
                </div>
                <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                        <strong style="color: #f5f5f5; font-size: 14px; font-weight: 700;">${esc(item.description || badgeLabel)}</strong>
                        <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 999px; background: ${badgeBg}; color: ${badgeColor};">${esc(badgeLabel)}</span>
                    </div>
                    <p style="margin: 0; font-size: 12px; color: #999;">${esc(formatDateTime(item.createdAt))}</p>
                </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
                <span class="data-value" style="display: block; font-size: 15px; font-weight: 800; color: ${amountColor};">${sign}${absAmount.toLocaleString()} Coins</span>
                ${nairaSubtext}
            </div>
        </div>
    `;
}

async function loadWallet() { 
    try { 
        const [rawWallet = {}, rawTransactions = {}, rawPackages = null] = await Promise.all([
            api('/wallet/me/balance').catch(() => ({})),
            api('/wallet/me/transactions?limit=30').catch(() => ({})),
            api('/payment/packages').catch(() => null)
        ]); 

        if (rawPackages && typeof rawPackages === 'object') {
            const pkgList = Object.values(rawPackages).filter(p => Number(p?.coins) > 0 && Number(p?.naira) > 0);
            if (pkgList.length > 0) {
                state.coinRateNaira = Number(pkgList[0].naira) / Number(pkgList[0].coins);
            }
        }

        const walletObj = rawWallet?.wallet || rawWallet || {};
        const storyCoins = Number(walletObj.storyCoins ?? walletObj.balance ?? walletObj.coins ?? 0);
        const totalEarned = Number(walletObj.totalEarned ?? walletObj.earned ?? 0);
        const totalSpent = Number(walletObj.totalSpent ?? walletObj.spent ?? 0);
        const estimatedNaira = Number(walletObj.nairaBalance ?? walletObj.fiatBalance ?? (storyCoins * state.coinRateNaira));

        state.wallet = { storyCoins, totalEarned, totalSpent, estimatedNaira };

        const balEl = $('#wallet-balance');
        if (balEl) balEl.textContent = storyCoins.toLocaleString(); 
        
        const earnEl = $('#wallet-earned');
        if (earnEl) earnEl.textContent = totalEarned.toLocaleString(); 

        const rewardsBalEl = $('#rewards-balance');
        if (rewardsBalEl) rewardsBalEl.textContent = storyCoins.toLocaleString();

        $$('[data-wallet-balance]').forEach(el => { el.textContent = storyCoins.toLocaleString(); });
        $$('[data-wallet-earned]').forEach(el => { el.textContent = totalEarned.toLocaleString(); });
        $$('[data-wallet-spent]').forEach(el => { el.textContent = totalSpent.toLocaleString(); });
        $$('[data-wallet-naira]').forEach(el => { el.textContent = formatNaira(estimatedNaira); });

        ensureWalletSummaryBanner(state.wallet);
        
        const txArray = Array.isArray(rawTransactions)
            ? rawTransactions
            : (rawTransactions.transactions || rawTransactions.data || []);

        const transList = $('#transactions-list');
        if (transList) {
            transList.innerHTML = txArray.length > 0
                ? txArray.map(renderWalletTransactionRow).join('')
                : '<p style="color:#999; padding: 14px 0;">No transactions yet. Claim daily rewards or top up coins to get started.</p>'; 
        }

        emitAppEvent('afrostory:wallet-updated', state.wallet);
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
    else { action = `${socialUrl ? `<a href="${esc(socialUrl)}" target="_blank" class="button button-quiet">Visit ${esc(reward.metadata?.platform || 'official account')}</a>` : ''}<button class="button button-accent reward-action" data-reward-id="${esc(reward._id)}" data-robins-rewarded>Claim reward</button>`; }
    
    return `<article class="reward-card reward-state-${stateVal.toLowerCase()}"><p class="eyebrow">${esc(reward.category || 'MISSION')}</p><h3>${esc(reward.name)}</h3><p class="muted">${esc(reward.description || '')}</p><div class="reward-meta">+${Number(reward.rewardAmount).toLocaleString()} Coins</div><div class="reward-state-label">${isSocial ? (stateVal === 'CLAIMED' ? 'COMPLETED' : 'AVAILABLE') : esc(stateVal.replaceAll('_', ' '))}</div>${action}</article>`;
}

async function loadRewards() {
    try {
        const result = await api('/rewards/me') || {};
        state.rewards = result;
        const balanceVal = Number(result.balance ?? state.wallet?.storyCoins ?? 0);
        
        const balEl = $('#rewards-balance');
        if (balEl) balEl.textContent = balanceVal.toLocaleString();

        const walletBalEl = $('#wallet-balance');
        if (walletBalEl) walletBalEl.textContent = balanceVal.toLocaleString();
        
        const currentStreak = $('#reward-current-streak');
        if (currentStreak) currentStreak.textContent = Number(result.streak?.currentStreak || 0);
        
        const bestStreak = $('#reward-best-streak');
        if (bestStreak) bestStreak.textContent = Number(result.streak?.bestStreak || 0);
        
        const daily = result.daily;
        const rewards = result.rewards || [];
        
        const dailyCard = $('#daily-reward-card');
        if (dailyCard) {
            dailyCard.innerHTML = daily ? `<p class="eyebrow">DAILY CHECK-IN</p><h2>${daily.claimed ? 'Check-in complete' : 'Your daily reward is ready'}</h2><p class="muted">${esc(daily.description || 'Return each day to keep your streak alive.')}</p><div class="reward-meta">+${Number(daily.rewardAmount).toLocaleString()} coins</div>${daily.claimed ? '<div class="reward-state">Come back after the next calendar day.</div>' : `<button class="button button-accent reward-action" data-reward-id="${esc(daily._id)}" data-robins-rewarded>Claim today</button>`}` : '<p>Daily check-in is not available right now.</p>';
        }

        const social = rewards.filter(reward => reward.type === 'SOCIAL' || reward.category === 'social');
        const socialGrid = $('#social-rewards-grid');
        if (socialGrid) socialGrid.innerHTML = social.map(renderRewardCard).join('') || '<p>No active social missions right now.</p>';
        
        const standardGrid = $('#rewards-grid');
        if (standardGrid) standardGrid.innerHTML = rewards.filter(reward => !social.includes(reward) && (!daily || reward._id !== daily._id)).map(renderRewardCard).join('') || '<p>No active missions right now.</p>';
        
        const histContainer = $('#rewards-history');
        if (histContainer) {
            histContainer.innerHTML = (result.history || []).map(item => `<div class="data-row"><div><strong>${esc(item.description || 'Reward activity')}</strong><p>${esc(formatDateTime(item.createdAt))}</p></div><span class="data-value ${item.type === 'SPEND' ? '' : 'reward-positive'}">${item.type === 'SPEND' ? '-' : '+'}${Number(item.amount || 0).toLocaleString()} Coins</span></div>`).join('') || '<p>Your reward history will appear here.</p>';
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

                let followAction = '';
                if (f.isMutual || f.isFollowing) {
                    followAction = `<button class="button button-quiet" style="padding: 4px 10px; font-size:11px;" disabled>Following</button>`;
                } else if (f.isCreator && f._id) {
                    followAction = `<button class="button button-accent" style="padding: 4px 10px; font-size:11px;" data-action="follow-creator" data-creator="${esc(f._id)}">Follow Back</button>`;
                } else {
                    followAction = `<button class="button button-accent" style="padding: 4px 10px; font-size:11px;" data-action="follow-user" data-user="${esc(f.userId)}">Follow Back</button>`;
                }

                return `<div class="data-row" style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid #222;">
                    <div style="width:40px; height:40px; border-radius:50%; background:#444; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${avatar}</div>
                    <div style="flex:1; min-width:0; text-align:left;">
                        <strong style="display:block; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(f.displayName || f.username)}</strong>
                        <p style="margin:0; font-size:12px; color:#888;">@${esc(f.username)}</p>
                        ${mutualBadge}
                    </div>
                    <div>${followAction}</div>
                </div>`;
            }).join('') || '<p style="text-align:center; color:#888; padding: 20px;">You have no followers yet.</p>';
        }
    } catch(e) {
        toast(e.message, 'error');
        const root = $('#modal-root');
        if (root) root.classList.add('hidden');
    }
}

/* ============================================================================ */
/* CREATOR APPROVAL FLOW & LIVE STUDIO SYNC */
/* ============================================================================ */
async function handleCreatorSubmit(event) {
    event.preventDefault();                           
    const form = event.target;                           
    const brandName = form.brandName.value.trim();                           
    const bio = form.bio.value.trim();                           
    const terms = form.terms.checked;
    const submitBtn = form.querySelector('button[type="submit"]');                                    
    
    if (!terms) return toast('You must agree to the Creator Guidelines', 'error');
    if (!brandName) return toast('Creator Name is required', 'error');                                    
    if (!bio) return toast('Content description is required', 'error');                                    
    
    if (submitBtn) {                                       
        submitBtn.disabled = true;                                       
        submitBtn.textContent = 'Submitting Application...';                           
    }                                    
    
    try {                                       
        await api('/creators/become-creator', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ brandName, bio }) 
        });                                       
        
        toast('Application submitted for review!', 'success'); 
        await loadCreator();
    } catch (error) { 
        toast(error.message, 'error'); 
    } finally { 
        if (submitBtn) {
            submitBtn.disabled = false; 
            submitBtn.textContent = 'Submit Creator Application'; 
        }
    }
}

async function loadCreator(preferredSeriesId = null) { 
    try { 
        const dashboard = $('#creator-dashboard');
        const onboarding = $('#creator-onboarding');
        const pending = $('#creator-pending');
        
        if (!dashboard || !onboarding || !pending) return;

        const creator = await api('/creators/me/profile'); 
        
        if (creator && creator.applicationStatus === 'REJECTED') {
            dashboard.classList.add('hidden');
            pending.classList.add('hidden');
            onboarding.classList.remove('hidden');
            
            injectCreatorForm(creator.brandName, creator.rejectionReason);
            return;
        }

        if (creator && creator.applicationStatus === 'PENDING') {
            dashboard.classList.add('hidden');
            onboarding.classList.add('hidden');
            pending.classList.remove('hidden');
            return; 
        }

        if (creator && (creator.applicationStatus === 'APPROVED' || creator.isVerified === true)) {
            onboarding.classList.add('hidden');
            pending.classList.add('hidden');
            dashboard.classList.remove('hidden');
            state.profile = null; // Ensure profile tab reflects approved creator status

            if (!sessionStorage.getItem('creatorWelcomeSeen')) {
                let welcomeScreen = $('#creator-welcome-screen');
                if (!welcomeScreen) {
                    welcomeScreen = document.createElement('div');
                    welcomeScreen.id = 'creator-welcome-screen';
                    welcomeScreen.style.cssText = 'position:absolute; inset:0; background:#111; z-index:50; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; text-align:center; min-height: 60vh; border-radius: 12px; border: 1px solid #333;';
                    welcomeScreen.innerHTML = `
                        <div style="font-size:60px; margin-bottom:20px;">🎉</div>
                        <h2 style="color:#d4a017; font-size:32px; font-weight:800; font-family:'Space Grotesk', sans-serif; margin-bottom:15px;">Congratulations!</h2>
                        <p style="color:#ccc; font-size:16px; max-width:400px; line-height:1.6; margin-bottom:30px;">Your creator account has been successfully approved! You now have full access to upload your stories, connect with fans, and monetize your content on AfroStory.</p>
                        <button class="button button-primary" style="padding:15px 30px; font-size:16px;" onclick="document.getElementById('creator-welcome-screen').remove(); sessionStorage.setItem('creatorWelcomeSeen', 'true');">Start Uploading Content</button>
                    `;
                    dashboard.style.position = 'relative';
                    dashboard.appendChild(welcomeScreen);
                }
            }

            const series = await api(`/creators/${creator._id}/series?limit=100`) || {}; 
            const seriesList = series.series || [];
            const statsContainer = $('#creator-stats');
            if (statsContainer) {
                statsContainer.innerHTML = [
                    ['TOTAL VIEWS', creator.totalViews, ''],
                    ['UNIQUE VIEWERS', creator.uniqueViewers || 0, ''],
                    ['RETURNING VIEWERS', creator.returningViewers || 0, ''],
                    ['TOTAL EARNINGS', creator.totalEarnings, ''], 
                    ['FOLLOWERS', creator.totalFollowers, 'data-action="view-followers" style="cursor:pointer; text-decoration: underline; text-decoration-color: #d4a017;" title="Click to view and follow back"'], 
                    ['SERIES', seriesList.length, '']
                ].map(item => `<div class="stat-card" ${item[2] || ''}><span class="eyebrow">${item[0]}</span><strong>${Number(item[1] || 0).toLocaleString()}</strong></div>`).join(''); 
            }

            const seriesGrid = $('#my-series-grid');
            if (seriesGrid) {
                seriesGrid.innerHTML = seriesList.map(item => card(item, { showCreatorControls: true })).join('') || '<p>Create your first series.</p>'; 
            }
            
            const uploadSelect = $('#upload-series');
            if (uploadSelect) {
                const previousVal = preferredSeriesId || uploadSelect.value;
                uploadSelect.innerHTML = seriesList.map(item => `<option value="${esc(item._id)}">${esc(item.title)}${isSeriesCompleted(item) ? ' (Completed)' : ''}</option>`).join('');
                if (previousVal && seriesList.some(s => String(s._id) === String(previousVal))) {
                    uploadSelect.value = previousVal;
                }
            }

            emitAppEvent('afrostory:creator-updated', { creator, seriesCount: seriesList.length });
        }
    } catch (error) { 
        const dashboard = $('#creator-dashboard');
        const onboarding = $('#creator-onboarding');
        const pending = $('#creator-pending');

        if (dashboard) dashboard.classList.add('hidden');
        if (pending) pending.classList.add('hidden');
        if (onboarding) {
            onboarding.classList.remove('hidden');
            injectCreatorForm();
        }
    } 
}

function injectCreatorForm(existingBrandName = '', rejectionReason = '') {
    const onboarding = $('#creator-onboarding');
    if (!onboarding) return;

    let alertHtml = '';
    if (rejectionReason) {
        alertHtml = `
            <div style="background: rgba(231, 76, 60, 0.1); border: 1px solid #e74c3c; color: #e74c3c; padding: 15px; border-radius: 8px; margin-bottom: 24px; text-align: left;">
                <strong style="display:block; margin-bottom:5px; font-size:15px;">Application Update Required</strong>
                <span style="font-size:14px; line-height:1.4;">${esc(rejectionReason)}</span>
            </div>
        `;
    }

    const prefillName = existingBrandName || state.user?.profile?.displayName || state.user?.username || '';

    onboarding.innerHTML = `
        <p class="eyebrow">SHARE YOUR VOICE</p>
        <h2 style="margin-bottom:10px;">Become a creator</h2>
        <p style="color: #999; margin-bottom: 24px;">Join AfroStory to share your original African stories with the world.</p>
        
        ${alertHtml}

        <form id="become-creator-form" class="stack-form" style="text-align: left;">
            <div class="form-group" style="margin-bottom:16px;">
                <label style="display:block; color:#ccc; margin-bottom:6px; font-size:13px; font-weight:600;">Creator Name</label>
                <input name="brandName" required maxlength="100" placeholder="The name displayed on your stories..." value="${esc(prefillName)}" style="width:100%; padding:12px; background:#111; border:1px solid #444; color:#fff; border-radius:6px;">
            </div>
            
            <div class="form-group" style="margin-bottom:20px;">
                <label style="display:block; color:#ccc; margin-bottom:6px; font-size:13px; font-weight:600;">Brief Description of Your Content</label>
                <textarea name="bio" required maxlength="500" rows="3" placeholder="e.g. I create short serialized Tiv stories based on village life, culture, and traditional experiences." style="width:100%; padding:12px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-family:inherit;"></textarea>
            </div>

            <label style="display:flex; gap:12px; align-items:flex-start; cursor:pointer; margin-bottom:24px;">
                <input type="checkbox" name="terms" required style="margin-top:4px; width:18px; height:18px; accent-color:#d4a017;">
                <span style="color:#999; font-size:13px; line-height:1.5;">I agree to AfroStory's Creator Guidelines. I confirm that I will only upload original content or content I have the legal right to use.</span>
            </label>

            <button class="button button-primary" type="submit" style="width: 100%; padding:14px; font-size:15px;">Submit Creator Application</button>
        </form>
    `;

    $('#become-creator-form').addEventListener('submit', handleCreatorSubmit);
}

/* ============================================================================ */
/* DIRECT CLOUD UPLOAD WITH CIRCULAR PROGRESS RING & AUTO-REFRESH SYNC */
/* ============================================================================ */
function emitUploadLifecycle(eventName, detail = {}) {
    emitAppEvent(eventName, detail);
}

function getLocalVideoMetadata(file) {
    return new Promise((resolve) => {
        if (!file || !file.type?.startsWith('video/')) return resolve({ duration: 0, width: 0, height: 0 });
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        const objectUrl = URL.createObjectURL(file);
        const cleanup = () => {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            tempVideo.remove();
        };
        tempVideo.onloadedmetadata = () => {
            const meta = {
                duration: Number.isFinite(tempVideo.duration) ? Math.round(tempVideo.duration) : 0,
                width: tempVideo.videoWidth || 0,
                height: tempVideo.videoHeight || 0
            };
            cleanup();
            resolve(meta);
        };
        tempVideo.onerror = () => {
            cleanup();
            resolve({ duration: 0, width: 0, height: 0 });
        };
        tempVideo.src = objectUrl;
    });
}

function normalizePlayableVideoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    if (rawUrl.includes('cloudinary.com') && /\.(mov|mkv|avi|webm)(\?.*)?$/i.test(rawUrl)) {
        return rawUrl.replace(/\.(mov|mkv|avi|webm)(\?.*)?$/i, '.mp4$2');
    }
    return rawUrl;
}

const UPLOAD_RING_RADIUS = 24;
const UPLOAD_RING_CIRCUMFERENCE = 2 * Math.PI * UPLOAD_RING_RADIUS;

function ensureUploadTelemetryUI(form, prefix) {
    if (!form) return null;
    let box = form.querySelector(`#${prefix}-telemetry-box`);
    if (!box) {
        const submitBtn = form.querySelector('button[type="submit"]');
        box = document.createElement('div');
        box.id = `${prefix}-telemetry-box`;
        box.className = 'hidden';
        box.style.cssText = 'margin: 14px 0; padding: 14px; background: rgba(20, 20, 20, 0.92); backdrop-filter: blur(10px); border: 1px solid rgba(212, 160, 23, 0.35); border-radius: 12px; text-align: left;';
        box.innerHTML = `
            <div id="${prefix}-file-details" style="font-size: 12px; color: #bbb; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;"></div>
            <div id="${prefix}-progress-wrap" class="hidden" style="display: flex; align-items: center; gap: 14px;">
                <div style="position: relative; width: 60px; height: 60px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                    <svg viewBox="0 0 60 60" width="60" height="60" style="transform: rotate(-90deg);">
                        <circle cx="30" cy="30" r="${UPLOAD_RING_RADIUS}" stroke="#262626" stroke-width="5" fill="none"></circle>
                        <circle id="${prefix}-ring-circle" cx="30" cy="30" r="${UPLOAD_RING_RADIUS}" stroke="#d4a017" stroke-width="5" stroke-linecap="round" fill="none" stroke-dasharray="${UPLOAD_RING_CIRCUMFERENCE.toFixed(2)}" stroke-dashoffset="${UPLOAD_RING_CIRCUMFERENCE.toFixed(2)}" style="transition: stroke-dashoffset 0.2s ease, stroke 0.25s ease;"></circle>
                    </svg>
                    <strong id="${prefix}-percent-text" style="position: absolute; font-size: 12px; font-weight: 800; color: #ffd24c;">0%</strong>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div id="${prefix}-stage-text" style="font-size: 13px; color: #f5f5f5; font-weight: 700; margin-bottom: 6px;">Preparing upload...</div>
                    <div style="width: 100%; height: 6px; background: #262626; border-radius: 999px; overflow: hidden; margin-bottom: 6px;">
                        <div id="${prefix}-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #b8860b, #d4a017, #f1c40f); border-radius: 999px; transition: width 0.2s ease;"></div>
                    </div>
                    <div id="${prefix}-transfer-stats" style="font-size: 11px; color: #999; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                        <span id="${prefix}-bytes-text">0 MB / 0 MB</span>
                        <span id="${prefix}-speed-text">Calculating speed...</span>
                    </div>
                </div>
            </div>
        `;
        if (submitBtn) {
            submitBtn.parentNode.insertBefore(box, submitBtn);
        } else {
            form.appendChild(box);
        }
    }

    return {
        box,
        fileDetails: box.querySelector(`#${prefix}-file-details`),
        progressWrap: box.querySelector(`#${prefix}-progress-wrap`),
        ringCircle: box.querySelector(`#${prefix}-ring-circle`),
        stageText: box.querySelector(`#${prefix}-stage-text`),
        percentText: box.querySelector(`#${prefix}-percent-text`),
        progressBar: box.querySelector(`#${prefix}-progress-bar`),
        bytesText: box.querySelector(`#${prefix}-bytes-text`),
        speedText: box.querySelector(`#${prefix}-speed-text`)
    };
}

function syncNativeAppHtmlRings(form, clampedPercent, stage, isError, isSuccess) {
    if (!form) return;
    const modal = form.closest('.modal, .modal-root') || form;
    const ringContainer = modal.querySelector('[data-upload-ring], #upload-progress-ring, #upload-progress-container');
    if (ringContainer) ringContainer.classList.remove('hidden');

    const ringStrokeColor = isError ? '#e74c3c' : (isSuccess ? '#2ecc71' : '#d4a017');
    modal.querySelectorAll('circle[data-ring-progress], .upload-ring-progress, #upload-ring-circle').forEach(circle => {
        const r = Number(circle.getAttribute('r')) || UPLOAD_RING_RADIUS;
        const circ = 2 * Math.PI * r;
        circle.style.strokeDasharray = `${circ.toFixed(2)}`;
        circle.style.strokeDashoffset = `${(circ * (1 - clampedPercent / 100)).toFixed(2)}`;
        circle.style.stroke = ringStrokeColor;
    });

    modal.querySelectorAll('[data-upload-percent], #upload-ring-percent').forEach(el => {
        el.textContent = `${clampedPercent}%`;
    });

    if (stage) {
        modal.querySelectorAll('[data-upload-stage], #upload-ring-stage').forEach(el => {
            el.textContent = stage;
        });
    }
}

function updateUploadTelemetry(ui, { percent = 0, stage = '', bytesText = '', speedText = '', isError = false, isSuccess = false } = {}) {
    if (!ui) return;
    ui.box.classList.remove('hidden');
    ui.progressWrap.classList.remove('hidden');
    ui.progressWrap.style.display = 'flex';

    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const activeColor = isError ? '#e74c3c' : (isSuccess ? '#2ecc71' : '#d4a017');

    ui.percentText.textContent = `${clamped}%`;
    ui.percentText.style.color = isError ? '#e74c3c' : (isSuccess ? '#2ecc71' : '#ffd24c');

    if (ui.ringCircle) {
        const offset = UPLOAD_RING_CIRCUMFERENCE * (1 - clamped / 100);
        ui.ringCircle.style.strokeDashoffset = `${offset.toFixed(2)}`;
        ui.ringCircle.style.stroke = activeColor;
    }

    ui.progressBar.style.width = `${clamped}%`;
    ui.progressBar.style.background = isError
        ? '#e74c3c'
        : (isSuccess ? '#2ecc71' : 'linear-gradient(90deg, #b8860b, #d4a017, #f1c40f)');

    if (stage) ui.stageText.textContent = stage;
    if (bytesText !== undefined) ui.bytesText.textContent = bytesText;
    if (speedText !== undefined) ui.speedText.textContent = speedText;

    syncNativeAppHtmlRings(ui.box.closest('form'), clamped, stage, isError, isSuccess);
}

function resetUploadTelemetry(form, prefix) {
    if (!form) return;
    delete form.dataset.uploading;
    const box = form.querySelector(`#${prefix}-telemetry-box`);
    if (box) {
        box.classList.add('hidden');
        const progressWrap = box.querySelector(`#${prefix}-progress-wrap`);
        if (progressWrap) progressWrap.classList.add('hidden');
        const fileDetails = box.querySelector(`#${prefix}-file-details`);
        if (fileDetails) fileDetails.innerHTML = '';
        const ringCircle = box.querySelector(`#${prefix}-ring-circle`);
        if (ringCircle) ringCircle.style.strokeDashoffset = `${UPLOAD_RING_CIRCUMFERENCE.toFixed(2)}`;
    }
    const modal = form.closest('.modal, .modal-root') || form;
    const ringContainer = modal.querySelector('[data-upload-ring], #upload-progress-ring, #upload-progress-container');
    if (ringContainer) ringContainer.classList.add('hidden');
}

async function bindFileSelectionPreviews() {
    const seriesCoverInput = $('#series-form input[name="cover"]');
    if (seriesCoverInput && !seriesCoverInput.dataset.previewBound) {
        seriesCoverInput.dataset.previewBound = 'true';
        seriesCoverInput.addEventListener('change', () => {
            const file = seriesCoverInput.files?.[0];
            const form = $('#series-form');
            const ui = ensureUploadTelemetryUI(form, 'series');
            if (!ui) return;
            if (!file) {
                resetUploadTelemetry(form, 'series');
                return;
            }
            ui.box.classList.remove('hidden');
            ui.progressWrap.classList.add('hidden');
            ui.fileDetails.innerHTML = `<span>🖼 <strong>${esc(file.name)}</strong></span><span style="color:#d4a017; font-weight:600;">${formatFileSize(file.size)}</span>`;
        });
    }

    const episodeVideoInput = $('#upload-form input[name="video"]');
    if (episodeVideoInput && !episodeVideoInput.dataset.previewBound) {
        episodeVideoInput.dataset.previewBound = 'true';
        episodeVideoInput.addEventListener('change', async () => {
            const file = episodeVideoInput.files?.[0];
            const form = $('#upload-form');
            const ui = ensureUploadTelemetryUI(form, 'episode');
            if (!ui) return;
            if (!file) {
                resetUploadTelemetry(form, 'episode');
                return;
            }
            ui.box.classList.remove('hidden');
            ui.progressWrap.classList.add('hidden');
            ui.fileDetails.innerHTML = `<span>🎬 <strong>${esc(file.name)}</strong></span><span style="color:#d4a017; font-weight:600;">${formatFileSize(file.size)} · Reading duration...</span>`;

            const meta = await getLocalVideoMetadata(file);
            form.dataset.localDuration = String(meta.duration || 0);
            const extraBits = [formatFileSize(file.size)];
            if (meta.duration > 0) extraBits.push(formatDurationSeconds(meta.duration));
            if (meta.width > 0 && meta.height > 0) extraBits.push(`${meta.width}×${meta.height}`);
            ui.fileDetails.innerHTML = `<span>🎬 <strong>${esc(file.name)}</strong></span><span style="color:#d4a017; font-weight:600;">${extraBits.join(' · ')}</span>`;
        });
    }
}

async function uploadAsset(path, file, onProgress = null) { 
    const isVideo = path.includes('video');
    if (typeof onProgress === 'function') {
        onProgress({ percent: 2, stage: 'Step 1/3 · Securing cloud upload...', loaded: 0, total: file.size, speedBps: 0, etaSeconds: null });
    }

    const signRes = await api(`/upload/sign?type=${isVideo ? 'video' : 'image'}`);
    const cloudName = signRes?.cloudName || signRes?.cloud_name;
    const apiKey = signRes?.apiKey || signRes?.api_key;
    
    if (!signRes || !signRes.signature || !cloudName || !apiKey) {
        throw new Error('Failed to secure upload connection');
    }

    const resourceType = isVideo ? 'video' : 'image';
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', signRes.timestamp);
    formData.append('signature', signRes.signature);
    if (signRes.folder) formData.append('folder', signRes.folder);
    if (signRes.uploadPreset || signRes.upload_preset) {
        formData.append('upload_preset', signRes.uploadPreset || signRes.upload_preset);
    }
    if (signRes.publicId || signRes.public_id) {
        formData.append('public_id', signRes.publicId || signRes.public_id);
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const startedAt = performance.now();

        xhr.open('POST', cloudinaryUrl, true);
        xhr.withCredentials = false;
        xhr.timeout = 10 * 60 * 1000;

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || typeof onProgress !== 'function') return;
            const rawRatio = event.total > 0 ? (event.loaded / event.total) : 0;
            const mappedPercent = Math.min(88, Math.max(5, Math.round(5 + rawRatio * 83)));
            const elapsedSec = Math.max(0.25, (performance.now() - startedAt) / 1000);
            const speedBps = event.loaded / elapsedSec;
            const remainingBytes = Math.max(0, event.total - event.loaded);
            const etaSeconds = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : null;

            onProgress({
                percent: mappedPercent,
                rawPercent: Math.round(rawRatio * 100),
                stage: `Step 2/3 · Uploading ${isVideo ? 'video' : 'cover image'} (${Math.round(rawRatio * 100)}%)...`,
                loaded: event.loaded,
                total: event.total,
                speedBps,
                etaSeconds
            });
        };

        xhr.upload.onload = () => {
            if (typeof onProgress === 'function') {
                onProgress({
                    percent: 90,
                    rawPercent: 100,
                    stage: `Step 2/3 · Processing ${isVideo ? 'video' : 'image'} on cloud...`,
                    loaded: file.size,
                    total: file.size,
                    speedBps: 0,
                    etaSeconds: 0
                });
            }
        };

        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) {}

            if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
                resolve({
                    url: data.secure_url,
                    mediaUrl: data.secure_url,
                    secure_url: data.secure_url,
                    publicId: data.public_id,
                    format: data.format || '',
                    duration: Number(data.duration) || 0
                });
            } else {
                const msg = data.error?.message || `Cloud upload failed (${xhr.status})`;
                reject(new Error(msg));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload. Check your internet connection and try again.'));
        xhr.ontimeout = () => reject(new Error('Upload timed out. Please try again on a stronger connection.'));

        xhr.send(formData);
    });
}

async function syncAfterContentMutation({ seriesId = null } = {}) {
    discoverLoaded = false;
    state.feedEpisodes = [];

    const tasks = [
        loadCreator(seriesId || null),
        refreshNotificationBadge()
    ];

    if ($('#notification-modal') && !$('#notification-modal').classList.contains('hidden')) {
        tasks.push(loadNotifications());
    }

    const activeSection = getActiveSectionName();
    if (activeSection === 'discover') {
        if (state.viewingSeriesId && (!seriesId || String(state.viewingSeriesId) === String(seriesId))) {
            tasks.push(openSeries(state.viewingSeriesId, { silent: true }));
        } else {
            tasks.push(loadDiscover());
        }
    } else if (activeSection === 'trending') {
        tasks.push(loadTrending());
    } else if (activeSection === 'watch') {
        tasks.push(openDefaultFeed());
    }

    await Promise.allSettled(tasks);
}

async function submitSeries(event) { 
    event.preventDefault(); 
    const form = event.target; 
    if (form.dataset.uploading === 'true') return;

    const submit = form.querySelector('button[type="submit"]'); 
    const values = new FormData(form); 
    const cover = values.get('cover'); 
    
    if (!cover?.size) return toast('Choose a cover image', 'error'); 
    
    const ui = ensureUploadTelemetryUI(form, 'series');
    if (ui) {
        ui.fileDetails.innerHTML = `<span>🖼 <strong>${esc(cover.name)}</strong></span><span style="color:#d4a017; font-weight:600;">${formatFileSize(cover.size)}</span>`;
    }

    form.dataset.uploading = 'true';
    submit.disabled = true; 
    submit.textContent = 'Uploading series...';
    updateUploadTelemetry(ui, {
        percent: 2,
        stage: 'Step 1/3 · Preparing series upload...',
        bytesText: `0 MB / ${formatFileSize(cover.size)}`,
        speedText: 'Starting...'
    });
    emitUploadLifecycle('afrostory:upload-progress', { kind: 'series', percent: 2, stage: 'Step 1/3 · Preparing series upload...' });
    
    try { 
        const upload = await uploadAsset('/upload/image', cover, (p) => {
            const speedLabel = p.speedBps > 0
                ? `${formatFileSize(p.speedBps)}/s${p.etaSeconds != null ? ` · ~${p.etaSeconds}s left` : ''}`
                : 'Finalizing image...';
            updateUploadTelemetry(ui, {
                percent: p.percent,
                stage: p.stage,
                bytesText: `${formatFileSize(p.loaded)} / ${formatFileSize(p.total)}`,
                speedText: speedLabel
            });
            emitUploadLifecycle('afrostory:upload-progress', { kind: 'series', percent: p.percent, stage: p.stage, loaded: p.loaded, total: p.total });
        }); 

        updateUploadTelemetry(ui, {
            percent: 94,
            stage: 'Step 3/3 · Creating series & updating studio...',
            bytesText: `${formatFileSize(cover.size)} / ${formatFileSize(cover.size)}`,
            speedText: 'Saving details...'
        });
        emitUploadLifecycle('afrostory:upload-progress', { kind: 'series', percent: 94, stage: 'Step 3/3 · Creating series...' });

        const isCompleted = values.get('completed') === 'on' || values.get('isCompleted') === 'on';

        const createdRes = await api('/series/create', { 
            method: 'POST', 
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                title: values.get('title'), 
                description: values.get('description'), 
                coverImage: upload.url, 
                genre: values.get('genre'), 
                language: values.get('language'), 
                tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), 
                isPublished: values.get('publish') === 'on', 
                isPremiumExclusive: values.get('premium') === 'on',
                isCompleted,
                status: isCompleted ? 'COMPLETED' : 'ONGOING'
            }) 
        }); 

        const createdSeries = createdRes?.series || createdRes || {};
        updateUploadTelemetry(ui, {
            percent: 100,
            stage: '✓ Series created successfully!',
            bytesText: `${formatFileSize(cover.size)} / ${formatFileSize(cover.size)}`,
            speedText: 'Complete',
            isSuccess: true
        });
        emitUploadLifecycle('afrostory:upload-complete', { kind: 'series', series: createdSeries });
        
        const modal = $('#series-modal');
        if (modal) modal.classList.add('hidden'); 
        form.reset(); 
        resetUploadTelemetry(form, 'series');
        await syncAfterContentMutation({ seriesId: createdSeries._id || null });
        toast('Series created! Studio & library updated automatically.', 'success'); 
    } catch (error) { 
        updateUploadTelemetry(ui, {
            percent: 100,
            stage: `Upload failed: ${error.message}`,
            speedText: 'Stopped',
            isError: true
        });
        emitUploadLifecycle('afrostory:upload-error', { kind: 'series', message: error.message });
        toast(error.message, 'error'); 
    } finally { 
        delete form.dataset.uploading;
        submit.disabled = false; 
        submit.textContent = 'Create series'; 
    } 
}

async function submitUpload(event) { 
    event.preventDefault(); 
    const form = event.target; 
    if (form.dataset.uploading === 'true') return;

    const submit = form.querySelector('button[type="submit"]'); 
    const values = new FormData(form); 
    const seriesId = values.get('seriesId'); 
    const file = values.get('video'); 
    const genre = values.get('genre'); 
    const culturalCategory = values.get('culturalCategory'); 
    const language = values.get('language'); 
    const hookStart = Math.max(0, Math.floor(Number(values.get('hookStart')) || 0));
    
    if (!seriesId || !file?.size) return toast('Choose a series and video', 'error'); 
    if (!genre || !culturalCategory || !language) return toast('Choose a genre, cultural category, and language', 'error'); 

    const localDuration = Number(form.dataset.localDuration || 0) || (await getLocalVideoMetadata(file)).duration;
    const ui = ensureUploadTelemetryUI(form, 'episode');
    if (ui) {
        const metaParts = [formatFileSize(file.size)];
        if (localDuration > 0) metaParts.push(formatDurationSeconds(localDuration));
        ui.fileDetails.innerHTML = `<span>🎬 <strong>${esc(file.name)}</strong></span><span style="color:#d4a017; font-weight:600;">${metaParts.join(' · ')}</span>`;
    }
    
    form.dataset.uploading = 'true';
    submit.disabled = true; 
    submit.textContent = 'Uploading episode...'; 
    updateUploadTelemetry(ui, {
        percent: 2,
        stage: 'Step 1/3 · Securing cloud upload...',
        bytesText: `0 MB / ${formatFileSize(file.size)}`,
        speedText: 'Starting...'
    });
    emitUploadLifecycle('afrostory:upload-progress', { kind: 'episode', percent: 2, stage: 'Step 1/3 · Securing cloud upload...' });
    
    try { 
        const upload = await uploadAsset('/upload/video', file, (p) => {
            const speedLabel = p.speedBps > 0
                ? `${formatFileSize(p.speedBps)}/s${p.etaSeconds != null ? ` · ~${p.etaSeconds}s left` : ''}`
                : 'Processing video...';
            updateUploadTelemetry(ui, {
                percent: p.percent,
                stage: p.stage,
                bytesText: `${formatFileSize(p.loaded)} / ${formatFileSize(p.total)}`,
                speedText: speedLabel
            });
            emitUploadLifecycle('afrostory:upload-progress', { kind: 'episode', percent: p.percent, stage: p.stage, loaded: p.loaded, total: p.total });
        }); 

        const rawMediaUrl = upload.hlsUrl || upload.mediaUrl || upload.secure_url || upload.url; 
        const baseMediaUrl = normalizePlayableVideoUrl(rawMediaUrl);
        if (!baseMediaUrl || !/^https?:\/\/.+/i.test(baseMediaUrl)) {
            throw new Error('Cloud storage did not return a playable video URL'); 
        }

        const mediaUrl = hookStart > 0 ? `${baseMediaUrl}#t=${hookStart}` : baseMediaUrl;
        const access = values.get('access'); 
        const rawCoinCost = values.get('coinCost');
        const coinCost = (rawCoinCost !== null && rawCoinCost !== '' && Number.isFinite(Number(rawCoinCost)))
            ? Math.max(0, Number(rawCoinCost))
            : 10;
        const finalDuration = Math.max(1, Math.round(Number(upload.duration) || localDuration || 0));
        const markSeriesCompleted = values.get('completeSeries') === 'on' || values.get('isSeriesCompleted') === 'on';

        updateUploadTelemetry(ui, {
            percent: 95,
            stage: 'Step 3/3 · Publishing episode & updating feed...',
            bytesText: `${formatFileSize(file.size)} / ${formatFileSize(file.size)}`,
            speedText: 'Saving episode...'
        });
        emitUploadLifecycle('afrostory:upload-progress', { kind: 'episode', percent: 95, stage: 'Step 3/3 · Saving episode...' });
        
        const createdEpRes = await api(`/episodes/series/${encodeURIComponent(seriesId)}/create`, { 
            method: 'POST', 
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                title: values.get('title'), 
                description: values.get('description'), 
                mediaUrl, 
                thumbnailUrl: null,
                hookStart,
                genre, 
                culturalCategory, 
                language, 
                tags: String(values.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), 
                duration: finalDuration, 
                coinCost, 
                isFree: false, 
                adUnlockable: access === 'Ad', 
                isPublished: values.get('publish') === 'on',
                completeSeries: markSeriesCompleted
            }) 
        }); 

        if (markSeriesCompleted) {
            await toggleSeriesCompletion(seriesId, false).catch(() => {});
        }

        const createdEpisode = createdEpRes?.episode || createdEpRes || {};
        updateUploadTelemetry(ui, {
            percent: 100,
            stage: '✓ Upload complete! Episode is live.',
            bytesText: `${formatFileSize(file.size)} / ${formatFileSize(file.size)}`,
            speedText: 'Complete',
            isSuccess: true
        });
        emitUploadLifecycle('afrostory:upload-complete', { kind: 'episode', seriesId, episode: createdEpisode });
        
        const modal = $('#upload-modal');
        if (modal) modal.classList.add('hidden'); 
        form.reset(); 
        delete form.dataset.localDuration;
        resetUploadTelemetry(form, 'episode');
        await syncAfterContentMutation({ seriesId });
        toast('Upload successful! Your episode is live across your studio & feed.', 'success'); 
    } catch (error) { 
        updateUploadTelemetry(ui, {
            percent: 100,
            stage: `Upload failed: ${error.message}`,
            speedText: 'Stopped',
            isError: true
        });
        emitUploadLifecycle('afrostory:upload-error', { kind: 'episode', message: error.message });
        toast(error.message, 'error'); 
    } finally { 
        delete form.dataset.uploading;
        submit.disabled = false; 
        submit.textContent = 'Upload episode'; 
    } 
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
                    <div style="width: 90px; height: 60px; border-radius: 6px; background-color: #333; background-image: url('${image(item.seriesId?.coverImage)}'); background-size: cover; background-position: center; flex-shrink: 0;"></div>
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
                    <div style="width: 90px; height: 60px; border-radius: 6px; background-color: #333; background-image: url('${image(item.seriesId?.coverImage)}'); background-size: cover; background-position: center; flex-shrink: 0;"></div>
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
        if (seriesId && seriesId !== 'undefined') {
            const rawSeries = await api(`/series/${seriesId}`).catch(() => null);
            const series = rawSeries?.series || rawSeries;
            if (series) state.currentSeries = series;
        }
        await openEpisode(episodeId); 
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
    if (avatarEl) {
        const cacheBust = avatar ? `${avatar}${avatar.includes('?') ? '&' : '?'}t=${Date.now()}` : null;
        avatarEl.innerHTML = cacheBust ? `<img src="${image(cacheBust)}" alt="">` : esc((details.displayName || user.username || 'A')[0].toUpperCase());
    }
    
    const coverEl = $('#profile-cover');
    if (coverEl && details.coverUrl) {
        const coverBust = `${details.coverUrl}${details.coverUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        coverEl.style.backgroundImage = `linear-gradient(120deg,#111b,#1118),url('${image(coverBust)}')`;
    }
    
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
        if (profile) {
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
    
    const form = $('#profile-form');
    const nameInput = $('#profile-display-name-input');
    if (nameInput) nameInput.value = profile.displayName || user.username || '';
    
    const usernameInput = $('#profile-username');
    if (usernameInput) usernameInput.value = user.username || ''; 
    
    const emailInput = $('#profile-email');
    if (emailInput) emailInput.value = user.email || '';

    if (form) {
        const bioField = form.querySelector('[name="bio"]');
        if (bioField) bioField.value = profile.bio || '';
        const countryField = form.querySelector('[name="country"]');
        if (countryField) countryField.value = profile.country || '';
        const regionField = form.querySelector('[name="region"]');
        if (regionField) regionField.value = profile.region || '';
        const langField = form.querySelector('[name="preferredLanguage"]');
        if (langField) langField.value = profile.preferredLanguage || '';
    }
    
    const editPanel = $('#profile-edit-panel');
    if (editPanel) {
        editPanel.classList.remove('hidden'); 
        editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/* ============================================================================ */
/* NOTIFICATIONS, BADGE RECONCILIATION & DELETION SYNC */
/* ============================================================================ */
const DELETED_NOTIF_STORAGE_KEY = 'afrostory_deleted_notifications';

function getDeletedNotificationIds() {
    try {
        const raw = JSON.parse(localStorage.getItem(DELETED_NOTIF_STORAGE_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch (e) {
        return new Set();
    }
}

function rememberDeletedNotificationIds(ids) {
    try {
        const existing = [...getDeletedNotificationIds()];
        const merged = [...new Set([...existing, ...ids.map(String)])].slice(-200);
        localStorage.setItem(DELETED_NOTIF_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}
}

function setNotificationBadgeCount(count) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    $$('#notification-badge, [data-notification-badge]').forEach(badge => {
        badge.textContent = String(safeCount);
        badge.classList.toggle('hidden', safeCount === 0);
    });
    emitAppEvent('afrostory:notifications-updated', { unreadCount: safeCount });
}

function ensureNotificationClearAllButton() {
    const readAllBtn = $('#notification-modal [data-action="read-all"]');
    if (!readAllBtn) return;
    const parent = readAllBtn.parentElement;
    if (parent && !parent.querySelector('[data-action="clear-notifications"]')) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'text-button';
        clearBtn.dataset.action = 'clear-notifications';
        clearBtn.style.cssText = 'color: #e74c3c; margin-left: 10px;';
        clearBtn.textContent = 'Clear all';
        readAllBtn.insertAdjacentElement('afterend', clearBtn);
    }
}

async function loadNotifications() { 
    try { 
        ensureNotificationClearAllButton();
        const result = await api('/notifications/me?limit=50') || {}; 
        const deletedIds = getDeletedNotificationIds();
        const rawList = Array.isArray(result.notifications) ? result.notifications : [];
        const visibleList = rawList.filter(item => item && !deletedIds.has(String(item._id)));

        const unreadInList = visibleList.filter(item => !item.read).length;
        setNotificationBadgeCount(unreadInList);

        const listEl = $('#notification-list');
        if (listEl) {
            listEl.innerHTML = visibleList.map(item => `
                <article class="notification-item ${item.read ? '' : 'notification-unread'}" data-notification-id="${esc(item._id)}">
                    <span class="notification-item-icon">✧</span>
                    <div class="notification-item-content">
                        <strong>${esc(item.title)}</strong>
                        <p>${esc(item.message || '')}</p>
                        <time>${new Date(item.createdAt).toLocaleString()}</time>
                    </div>
                    <div class="notification-item-actions" style="display:flex; align-items:center; gap:8px;">
                        ${item.read ? '' : `<button type="button" class="text-button" data-read-notification="${esc(item._id)}">Read</button>`}
                        <button type="button" class="text-button" style="color:#e74c3c;" data-delete-notification="${esc(item._id)}" title="Delete notification">Delete</button>
                    </div>
                </article>
            `).join('') || '<p>No new notifications</p>'; 
        }
    } catch (error) { toast(error.message, 'error'); } 
}

async function refreshNotificationBadge() { 
    try { 
        const result = await api('/notifications/me/unread-count') || {}; 
        const serverUnread = Math.max(0, Number(result.unreadCount ?? result.count ?? result.unread ?? 0) || 0);
        const deletedIds = getDeletedNotificationIds();

        if (serverUnread > 0 && deletedIds.size > 0) {
            const listRes = await api('/notifications/me?limit=50').catch(() => null);
            if (listRes && Array.isArray(listRes.notifications)) {
                const realUnread = listRes.notifications.filter(n => n && !n.read && !deletedIds.has(String(n._id))).length;
                setNotificationBadgeCount(realUnread);
                return;
            }
        }

        setNotificationBadgeCount(serverUnread);
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
        const seriesHtml = (result.series?.data || []).map(s => card(s)).join('');
        const episodesHtml = (result.episodes?.data || []).map(ep => episodeCard(ep)).join('');
        if (resEl) resEl.innerHTML = (seriesHtml + episodesHtml) || '<p>No stories matched your search.</p>';
    } catch (error) { toast(error.message, 'error'); }
} 

async function loadTrending() { 
    try { 
        const result = await api('/search/trending') || {}; 
        const listEl = $('#trending-list');
        if (listEl) listEl.innerHTML = (result.trending || []).map(ep => episodeCard(ep)).join('') || '<p>No trending episodes yet.</p>'; 
    } catch (error) { toast(error.message, 'error'); } 
} 

async function loadFavorites() {
    try {
        const result = await api('/favorites') || {};
        const list = result.favorites || result.data || result || [];
        const favEl = $('#favorites-list');
        if (favEl) favEl.innerHTML = list.map(s => card(s)).join('') || '<p>Save stories from the player to build your library.</p>';
    } catch (error) { toast(error.message, 'error'); }
} 

async function toggleFavorite() { 
    if (!state.currentSeries) return toast('Open a story first', 'error'); 
    try { 
        const result = await api(`/favorites/${state.currentSeries._id}/toggle`, { method: 'POST' }); 
        if (result) {
            toast(result.saved ? 'Added to favorites' : 'Removed from favorites', 'success');
            loadFavorites().catch(() => {});
        }
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
    const notifEl = $('#settings-notifications');     
    localStorage.setItem('afrostory-settings', JSON.stringify({          
        language: langEl ? langEl.value : 'en',          
        notifications: notifEl ? notifEl.checked : true      
    }));      
    toast('Settings saved', 'success');  
}

/* ============================================================================ */ 
/* GLOBAL EVENT DELEGATION & WATERFALL AD TRIGGERS */ 
/* ============================================================================ */  
document.addEventListener('change', event => {     
    try {         
        const targetId = event.target.id;         
        if (['genre-filter', 'sort-filter', 'cultural-filter', 'language-filter'].includes(targetId)) {             
            loadDiscover();         
        }     
    } catch (e) {         
        logFrontendError('filter_change_error', e.message, e.stack);     
    } 
});  

document.addEventListener('click', async event => {     
    try {         
        // Rewarded ad clicks are handled directly by public/js/ads.js
        if (event.target.closest('[data-robins-rewarded], [data-rs-rewarded]')) {
            return;
        }

        if (event.target.closest('#mobile-more-btn')) {
            event.preventDefault();
            applyAdminVisibility();
            $('#mobile-more-sheet')?.classList.remove('hidden');
            return;
        }

        if (event.target.id === 'mobile-more-sheet' || event.target.closest('.sheet-item')) {
            $('#mobile-more-sheet')?.classList.add('hidden');
        }

        const toggleCompleteBtn = event.target.closest('[data-action="toggle-series-complete"]');
        if (toggleCompleteBtn) {
            event.preventDefault();
            event.stopPropagation();
            const sId = toggleCompleteBtn.dataset.seriesId;
            const isComp = toggleCompleteBtn.dataset.completed === 'true';
            await toggleSeriesCompletion(sId, isComp);
            return;
        }

        const section = event.target.closest('[data-section]');          
        if (section) setSection(section.dataset.section);                  
        
        const series = event.target.closest('[data-series-id]');          
        if (series) openSeries(series.dataset.seriesId);                  
        
        const episodeRow = event.target.closest('[data-episode-id]');          
        if (episodeRow && !episodeRow.closest('.feed-video-card')) openEpisode(episodeRow.dataset.episodeId);          
        
        if (event.target.closest('[data-action="view-followers"]')) loadFollowersList();          

        const likeBtn = event.target.closest('[data-action="toggle-like"]');
        if (likeBtn && !likeBtn.disabled) {
            event.preventDefault();
            const epId = likeBtn.dataset.episodeId;
            likeBtn.disabled = true;
            try {
                const res = await api(`/episodes/${epId}/like/toggle`, { method: 'POST' });
                if (res) {
                    const svg = likeBtn.querySelector('svg');
                    const span = likeBtn.querySelector('.like-count-text');
                    if (res.isLiked) {
                        svg.setAttribute('fill', '#e74c3c');
                        svg.setAttribute('color', '#e74c3c');
                    } else {
                        svg.setAttribute('fill', 'none');
                        svg.setAttribute('color', 'currentColor');
                    }
                    span.textContent = formatViews(res.likeCount || 0);
                    const epObj = state.feedEpisodes.find(e => String(e._id) === String(epId));
                    if (epObj) {
                        epObj.isLiked = res.isLiked;
                        epObj.likeCount = res.likeCount;
                    }
                }
            } catch (err) { toast(err.message, 'error'); }
            finally { likeBtn.disabled = false; }
        }

        const rateBtn = event.target.closest('[data-action="rate-episode"]');
        if (rateBtn) {
            event.preventDefault();
            const epId = rateBtn.dataset.episodeId;
            if (window.Swal) {
                const { value: rating } = await Swal.fire({
                    title: 'Rate this story',
                    input: 'select',
                    inputOptions: { '5': '5 Stars - Excellent', '4': '4 Stars - Good', '3': '3 Stars - Average', '2': '2 Stars - Poor', '1': '1 Star - Terrible' },
                    inputPlaceholder: 'Select a rating',
                    showCancelButton: true,
                    background: '#1b1b1b', color: '#f5f5f5', confirmButtonColor: '#d4a017'
                });
                if (rating) {
                    try {
                        const rateRes = await api(`/episodes/${epId}/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: Number(rating) }) });
                        const epObj = state.feedEpisodes.find(e => String(e._id) === String(epId));
                        if (epObj) {
                            const prevCount = Number(epObj.ratingCount || 0);
                            const prevAvg = Number(epObj.rating || 0);
                            epObj.ratingCount = Number(rateRes?.ratingCount ?? (prevCount + 1));
                            epObj.rating = Number(rateRes?.rating ?? (((prevAvg * prevCount) + Number(rating)) / Math.max(1, epObj.ratingCount)));
                            const feedCard = document.querySelector(`.feed-video-card[data-episode-id="${epId}"] .feed-stats-line`);
                            if (feedCard) {
                                feedCard.innerHTML = `${formatRating(epObj.rating, epObj.ratingCount)} &nbsp;·&nbsp; 👁 ${formatViews(epObj.totalViews || 0)} views`;
                            }
                        }
                        toast('Rating saved successfully!', 'success');
                    } catch (err) { toast(err.message, 'error'); }
                }
            } else {
                toast('Rating system is initializing, try again.', 'info');
            }
        }

        const replyCommentBtn = event.target.closest('[data-reply-comment]');
        if (replyCommentBtn) {
            event.preventDefault();
            const input = $('#comment-input');
            const username = replyCommentBtn.dataset.replyUser || '';
            if (input) {
                input.focus();
                if (username && !input.value.startsWith(`@${username}`)) {
                    input.value = `@${username} ${input.value}`.trimStart();
                }
            }
        }

        const followBtn = event.target.closest('[data-action="follow-creator"]');         
        if (followBtn && !followBtn.disabled) {             
            event.preventDefault();             
            const creatorId = followBtn.dataset.creator;                          
            if (creatorId && creatorId !== 'undefined') {                 
                $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                    btn.disabled = true;
                    btn.style.pointerEvents = 'none';
                    const iconBadge = btn.querySelector('.follow-badge-icon');
                    if (iconBadge) {
                        iconBadge.innerHTML = '<span style="font-size:10px; font-weight:900; color:#0b0b0b;">···</span>';
                    }
                    if (btn.tagName.toLowerCase() === 'button' && !iconBadge) {
                        btn.textContent = 'Updating...';
                    }
                });

                try {
                    const res = await api(`/creators/${creatorId}/follow`, { method: 'POST' });
                    
                    if (res && res.alreadyFollowing) {
                        toast('You already follow this creator', 'info');
                    } else {
                        toast('Following creator!', 'success');
                    }

                    state.feedEpisodes.forEach(ep => {
                        if (String(ep.seriesId?.creatorId?._id) === String(creatorId)) {
                            ep.isFollowing = true;
                        }
                    });

                    $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                        const iconBadge = btn.querySelector('.follow-badge-icon');
                        if (iconBadge) {
                            iconBadge.outerHTML = buildFollowBadgeMarkup(true);
                        }
                        if (btn.tagName.toLowerCase() === 'button' && !iconBadge) {
                            btn.textContent = 'Following';
                        }
                    });

                    emitAppEvent('afrostory:follow-updated', { creatorId, isFollowing: true });
                    loadCreator().catch(() => {});
                } catch (error) { 
                    toast(error.message, 'error'); 
                    $$(`[data-action="follow-creator"][data-creator="${creatorId}"]`).forEach(btn => {
                        btn.disabled = false;
                        btn.style.pointerEvents = 'auto';
                        const iconBadge = btn.querySelector('.follow-badge-icon');
                        if (iconBadge) {
                            iconBadge.outerHTML = buildFollowBadgeMarkup(false);
                        }
                        if (btn.tagName.toLowerCase() === 'button' && !iconBadge) {
                            btn.textContent = 'Follow Back';
                        }
                    });
                }
            }
        }

        const followUserBtn = event.target.closest('[data-action="follow-user"]');
        if (followUserBtn && !followUserBtn.disabled) {
            event.preventDefault();
            const targetUserId = followUserBtn.dataset.user;
            
            if (targetUserId && targetUserId !== 'undefined') {
                $$(`[data-action="follow-user"][data-user="${targetUserId}"]`).forEach(btn => {
                    btn.disabled = true;
                    btn.style.pointerEvents = 'none';
                    btn.textContent = 'Updating...';
                });

                try {
                    const res = await api(`/users/${targetUserId}/follow`, { method: 'POST' });
                    
                    if (res && res.alreadyFollowing) {
                        toast('You already follow this user', 'info');
                    } else {
                        toast('Following user!', 'success');
                    }

                    $$(`[data-action="follow-user"][data-user="${targetUserId}"]`).forEach(btn => {
                        btn.textContent = 'Following';
                    });
                    loadCreator().catch(() => {});
                } catch (error) { 
                    toast(error.message, 'error'); 
                    $$(`[data-action="follow-user"][data-user="${targetUserId}"]`).forEach(btn => {
                        btn.disabled = false;
                        btn.style.pointerEvents = 'auto';
                        btn.textContent = 'Follow Back';
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
            if ($('#upload-form')?.dataset.uploading === 'true') {
                return toast('Episode upload is in progress — please wait until it completes.', 'info');
            }
            const el = $('#upload-modal');
            if (el) el.classList.add('hidden');
        }
        if (event.target.closest('[data-action="close-series"]') || event.target.id === 'series-modal') {
            if ($('#series-form')?.dataset.uploading === 'true') {
                return toast('Series creation is in progress — please wait until it completes.', 'info');
            }
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
            bindFileSelectionPreviews();
        }
        if (event.target.closest('[data-action="open-upload"]')) { 
            const el = $('#upload-modal');
            if (el) el.classList.remove('hidden'); 
            bindFileSelectionPreviews();
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
                $$('#notification-list .notification-unread').forEach(el => {
                    el.classList.remove('notification-unread');
                    el.querySelector('[data-read-notification]')?.remove();
                });
                setNotificationBadgeCount(0);

                await api('/notifications/me/read-all', { method: 'PUT' }).catch(() =>
                    api('/notifications/me/read-all', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    })
                );
            } catch (error) { toast(error.message, 'error'); } 
        }
        
        const notification = event.target.closest('[data-read-notification]');
        if (notification) { 
            const notifId = notification.dataset.readNotification;
            try { 
                const itemEl = notification.closest('.notification-item');
                if (itemEl) itemEl.classList.remove('notification-unread');
                notification.remove();
                const remainingUnread = $$('#notification-list .notification-unread').length;
                setNotificationBadgeCount(remainingUnread);

                await api(`/notifications/${encodeURIComponent(notifId)}/read`, { method: 'PUT' }).catch(() =>
                    api(`/notifications/${encodeURIComponent(notifId)}/read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    })
                );
            } catch (error) { toast(error.message, 'error'); } 
        }

        const deleteNotifBtn = event.target.closest('[data-delete-notification]');
        if (deleteNotifBtn) {
            event.preventDefault();
            const notifId = deleteNotifBtn.dataset.deleteNotification;
            if (notifId) {
                rememberDeletedNotificationIds([notifId]);
                const itemEl = deleteNotifBtn.closest('.notification-item');
                if (itemEl) itemEl.remove();

                const listEl = $('#notification-list');
                if (listEl && !listEl.querySelector('.notification-item')) {
                    listEl.innerHTML = '<p>No new notifications</p>';
                }
                const remainingUnread = $$('#notification-list .notification-unread').length;
                setNotificationBadgeCount(remainingUnread);

                api(`/notifications/${encodeURIComponent(notifId)}`, { method: 'DELETE' })
                    .catch(() => api(`/notifications/me/${encodeURIComponent(notifId)}`, { method: 'DELETE' }))
                    .catch(() => api(`/notifications/${encodeURIComponent(notifId)}/read`, { method: 'PUT' }))
                    .catch(() => {});
            }
        }

        const unreadRow = event.target.closest('.notification-item.notification-unread');
        if (unreadRow && !event.target.closest('button')) {
            const readBtn = unreadRow.querySelector('[data-read-notification]');
            if (readBtn) readBtn.click();
        }

        if (event.target.closest('[data-action="clear-notifications"]')) {
            event.preventDefault();
            const allIds = $$('#notification-list [data-notification-id]').map(el => el.dataset.notificationId).filter(Boolean);
            if (allIds.length > 0) {
                rememberDeletedNotificationIds(allIds);
            }
            const listEl = $('#notification-list');
            if (listEl) listEl.innerHTML = '<p>No new notifications</p>';
            setNotificationBadgeCount(0);

            api('/notifications/me/all', { method: 'DELETE' })
                .catch(() => api('/notifications/all', { method: 'DELETE' }))
                .catch(() => api('/notifications/me/read-all', { method: 'PUT' }))
                .catch(() => {});
            toast('Notifications cleared', 'success');
        }

        const historyLink = event.target.closest('[data-history-episode]');
        if (historyLink) openHistoryEpisode(historyLink.dataset.historySeries, historyLink.dataset.historyEpisode);

        if (event.target.closest('[data-action="save-current"]')) toggleFavorite();

        const tab = event.target.closest('[data-profile-tab]');
        if (tab) { 
            $$('.profile-tab').forEach(item => item.classList.toggle('active', item === tab));
            $$('.profile-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `profile-panel-${tab.dataset.profileTab}`)); 
        }

        const packageButton = event.target.closest('[data-package]');
        if (packageButton) { 
            try { 
                const result = await api('/payment/initialize-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageKey: packageButton.dataset.package }) }); 
                if (result) window.location.href = result.authorizationUrl; 
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

                // Automatically unlock all loaded feed videos in-place and sync wallet
                state.feedEpisodes.forEach(ep => {
                    if (!ep.hasAccess) unlockFeedEpisodeInDOM(ep._id);
                });
                await Promise.all([loadWallet(), loadRewards(), refreshNotificationBadge()]);
            } catch (error) { toast(error.message, 'error'); }
        }
    } catch (globalError) {
        logFrontendError('click_handler_failure', globalError.message, globalError.stack);
    }
});

/* ============================================================================ */
/* ROBINS ADS REWARDED & ANTI-FREEZE LIFECYCLE HANDLERS */
/* ============================================================================ */
function pauseFeedForAd() {
    try {
        if (currentlyPlaying && !currentlyPlaying.paused) {
            currentlyPlaying.pause();
        }
        $$('#tiktok-feed video').forEach(v => {
            if (!v.paused) v.pause();
        });
    } catch (e) {}
}

function resetRewardedAdButtons(event) {
    const rawTarget = event?.target;
    const btn = (rawTarget && typeof rawTarget.closest === 'function')
        ? (rawTarget.closest('[data-robins-rewarded], [data-rs-rewarded]') || rawTarget)
        : null;

    const targets = btn ? [btn] : $$('[data-robins-loading], [data-rs-loading]');
    targets.forEach(el => {
        delete el.dataset.robinsLoading;
        delete el.dataset.rsLoading;
        delete el.dataset.robinsVerifying;
        el.disabled = false;
        if (el.dataset.originalHtml) {
            el.innerHTML = el.dataset.originalHtml;
        }
    });
}

async function handleRewardedAdComplete(event) {
    const rawTarget = event?.target;
    const btn = (rawTarget && typeof rawTarget.closest === 'function')
        ? (rawTarget.closest('[data-robins-rewarded], [data-rs-rewarded]') || rawTarget)
        : (event?.detail?.button || null);
    if (!btn) return;

    if (btn.dataset?.robinsVerifying === 'true') return;
    if (btn.dataset) btn.dataset.robinsVerifying = 'true';

    const receipt = {
        provider: 'robinsads',
        websiteId: '6b06e5d10354f7305a5bc51b',
        zoneId: '9824292',
        ...(event.detail || {})
    };

    try {
        // 1. Episode Unlock Logic
        if (btn.dataset?.action === 'waterfall-ad-unlock' || (btn.id && btn.id.startsWith('waterfall-ad-btn-'))) {
            const episodeId = btn.dataset.episodeId || state.currentEpisode?._id;
            if (!episodeId) return;

            const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
            btn.dataset.originalHtml = originalHtml;

            delete btn.dataset.robinsLoading;
            delete btn.dataset.rsLoading;
            btn.disabled = true;
            btn.innerHTML = 'Verifying ad...';

            try {
                await api('/wallet/unlock-episode', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ episodeId, method: 'AD', provider: 'ROBINS_ADS', receipt }) 
                });

                toast('Ad verified! Unlocking episode...', 'success');
                unlockFeedEpisodeInDOM(episodeId);
                Promise.all([loadWallet(), refreshNotificationBadge()]).catch(() => {});
            } catch (error) {
                toast('Ad verification failed. You must watch the full ad to unlock.', 'error');
                btn.disabled = false;
                btn.innerHTML = originalHtml || 'Watch Ad to Unlock';
            }
            return;
        }

        // 2. Reward Claim Logic
        if (btn.dataset?.rewardId) {
            const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
            btn.dataset.originalHtml = originalHtml;

            delete btn.dataset.robinsLoading;
            delete btn.dataset.rsLoading;
            btn.disabled = true;
            btn.textContent = 'Verifying ad...';
            
            try {
                await api(`/rewards/${encodeURIComponent(btn.dataset.rewardId)}/claim`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ method: 'AD', provider: 'ROBINS_ADS', receipt }) 
                });
                
                toast('Reward verified and added to your wallet!', 'success'); 
                await Promise.all([loadRewards(), loadWallet(), refreshNotificationBadge()]); 
            } catch (error) { 
                toast('Ad verification failed. You must watch the full ad to claim.', 'error');
                btn.disabled = false; 
                btn.innerHTML = originalHtml; 
            }
        }
    } finally {
        if (btn.dataset) delete btn.dataset.robinsVerifying;
    }
}

['robins:start', 'rs:start'].forEach(evt => {
    document.addEventListener(evt, pauseFeedForAd);
    window.addEventListener(evt, pauseFeedForAd);
});

['robins:closed', 'rs:closed', 'robins:error', 'rs:error'].forEach(evt => {
    document.addEventListener(evt, resetRewardedAdButtons);
    window.addEventListener(evt, resetRewardedAdButtons);
});

['robins:rewarded', 'rs:rewarded'].forEach(evt => {
    document.addEventListener(evt, handleRewardedAdComplete);
    window.addEventListener(evt, handleRewardedAdComplete);
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
            await loadComments(state.currentEpisode._id, true); 
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

/* ============================================================================ */
/* EVENT-DRIVEN & BACKGROUND SYNCHRONIZATION ENGINE */
/* ============================================================================ */
let isSyncingLiveState = false;

async function syncLiveAppState() {
    if (isSyncingLiveState || !state.user || document.visibilityState !== 'visible') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const isUploading = $('#upload-form')?.dataset.uploading === 'true' || $('#series-form')?.dataset.uploading === 'true';
    if (isUploading) return;

    isSyncingLiveState = true;
    try {
        await refreshNotificationBadge();

        if ($('#notification-modal') && !$('#notification-modal').classList.contains('hidden')) {
            await loadNotifications();
        }

        const activeSection = getActiveSectionName();
        if (activeSection === 'wallet') {
            await loadWallet();
        } else if (activeSection === 'rewards') {
            await loadRewards();
        } else if (activeSection === 'creator') {
            await loadCreator();
        } else if (activeSection === 'history') {
            await loadHistory();
        } else if (activeSection === 'continue') {
            await loadContinue();
        }
    } catch (e) {
    } finally {
        isSyncingLiveState = false;
    }
}

setInterval(syncLiveAppState, 25000);

window.addEventListener('focus', syncLiveAppState);
window.addEventListener('online', syncLiveAppState);
window.addEventListener('afrostory:sync-requested', syncLiveAppState);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        syncLiveAppState();
    }
});

window.addEventListener('hashchange', () => {
    if (suppressHashSync) return;
    const name = location.hash.slice(1);
    if (['discover', 'search', 'watch', 'history', 'wallet', 'rewards', 'creator', 'admin', 'profile', 'trending', 'continue', 'favorites', 'settings'].includes(name)) {
        setSection(name);
    }
});

window.addEventListener('webpushr_subscriber_id', function(e) {
    if (e.detail) {
        localStorage.setItem('afrostory_webpushr_sid', e.detail);
        if (state.user) {
            api('/notifications/push/register', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ sid: e.detail }) 
            }).catch(err => logFrontendError('webpushr_event_registration', err.message, ''));
        }
    }
});

async function boot() {
    try {
        state.user = await api('/auth/me').catch(() => null); 
        renderHeaderUser(state.user);
        applyAdminVisibility();
        
        if (state.user) {
            try {
                const savedSid = localStorage.getItem('afrostory_webpushr_sid');
                if (savedSid) {
                    api('/notifications/push/register', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ sid: savedSid }) 
                    }).catch(err => logFrontendError('webpushr_cache_registration', err.message, ''));
                }

                if (typeof window.webpushr === 'function') {
                    window.webpushr('fetch_id', function (sid) {
                        if (sid) {
                            localStorage.setItem('afrostory_webpushr_sid', sid);
                            api('/notifications/push/register', { 
                                method: 'POST', 
                                headers: { 'Content-Type': 'application/json' }, 
                                body: JSON.stringify({ sid }) 
                            }).catch(err => logFrontendError('webpushr_active_registration', err.message, ''));
                        }
                    });
                }
            } catch (err) {
                logFrontendError('webpushr_initialization', err.message, '');
            }
        }

        ensureClassificationControls(); 
        bindFileSelectionPreviews();
        const initialSection = location.hash.slice(1) || 'discover';
        if (initialSection === 'discover') {
            await loadDiscover().catch(e => console.warn(e)); 
        }
        // Pre-warm wallet & notification badge immediately on boot so values are ready instantly
        Promise.allSettled([
            refreshNotificationBadge(),
            state.user ? loadWallet() : Promise.resolve()
        ]);
        setupLazyLoading();
        window.AfroStoryAds?.refresh?.().catch?.(() => {});
        return true; 
    } catch (error) {
        logFrontendError('boot_failure', error.message, error.stack);
        return true; 
    }
}

(async () => { if (await boot()) setSection(location.hash.slice(1) || 'discover'); })();
