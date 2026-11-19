const API = '/api';
const jsonHeaders = { 'Content-Type': 'application/json' };

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];

const emailOk = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const codeOk = value => /^\d{6}$/.test(value);

let currentAuthEmail = '';

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
async function request(path, body = null, method = 'POST') {
    const options = { method, headers: jsonHeaders, credentials: 'include' };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${API}${path}`, options);
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

function show(mode) {
    ['login', 'register', 'forgot', 'reset', 'verify', 'pin'].forEach(name => {
        const form = $(`${name}-form`);
        if (form) form.classList.toggle('hidden', name !== mode);
    });
}

function alertMessage(icon, title) {
    if (window.Swal) {
        Swal.fire({
            toast: true, position: 'center', showConfirmButton: false, timer: 4500, icon: icon, title: title,
            background: '#1B1B1B', color: '#F5F5F5', customClass: { popup: 'border border-gray-700 shadow-2xl', title: 'big-title' }
        });
    } else {
        alert(title);
    }
}

function redirect() { window.location.assign('/app.html'); }

async function checkSession() {
    try { 
        const { response } = await request('/auth/me', null, 'GET'); 
        if (response.ok) redirect(); 
    } catch { /* Stay on public page */ }
}

const safeImage = value => {
    if (!value) return 'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e?auto=format&fit=crop&w=800&q=70';
    if (value.includes('unsplash.com')) {
        try { const u = new URL(value); u.searchParams.set('w', '800'); return u.toString(); } catch(e){}
    }
    if (value.includes('cloudinary.com')) return value.replace('/upload/', '/upload/q_auto,w_800/');
    return value;
};

// Helper: attach MP4 or HLS stream and force immediate frame visibility + muted autoplay
function attachAndAutoplayVideo(slideEl, video, mediaUrl, isActive) {
    if (!video || !mediaUrl) return;

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');

    if (mediaUrl.includes('.m3u8') && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true });
        hls.loadSource(mediaUrl);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            if (isActive) video.play().catch(() => {});
        });
    } else {
        video.src = mediaUrl;
    }

    video.addEventListener('loadeddata', () => {
        slideEl.classList.add('video-live');
        if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.5) {
            try { video.currentTime = 0.25; } catch (e) {}
        }
    }, { once: true });

    video.addEventListener('playing', () => {
        slideEl.classList.add('video-live');
    });

    if (isActive) {
        video.play().then(() => slideEl.classList.add('video-live')).catch(() => {});
    }
}

// ==========================================
// DOM CONTENT LOADED - INITIALIZE ALL
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        checkSession();
    }

    if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
    }

    // --- Header Scroll Effect ---
    window.addEventListener('scroll', () => {
        const header = $('main-header');
        if (header) {
            if (window.scrollY > 50) header.classList.add('scrolled');
            else header.classList.remove('scrolled');
        }
    });

    // --- Auth Modal Triggers ---
    const authModal = $('auth-modal');
    document.addEventListener('click', (e) => {
        const openBtn = e.target.closest('[data-open-auth]');
        if (openBtn) {
            e.preventDefault();
            if (authModal) {
                authModal.classList.add('active');
                document.body.style.overflow = 'hidden';
                show(openBtn.dataset.openAuth || 'register');
            }
        }
    });

    $('close-modal-btn')?.addEventListener('click', () => {
        authModal.classList.remove('active');
        document.body.style.overflow = '';
    });

    authModal?.addEventListener('click', (e) => {
        if(e.target === authModal) {
           authModal.classList.remove('active');
           document.body.style.overflow = '';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && authModal && authModal.classList.contains('active')) {
            authModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });

    // --- Global Click Listeners for Auth Actions ---
    document.addEventListener('click', event => {
        const modeBtn = event.target.closest('[data-mode]');
        if (modeBtn) show(modeBtn.dataset.mode);

        const toggleBtn = event.target.closest('[data-password-toggle]');
        if (toggleBtn) {
            const input = $(toggleBtn.dataset.passwordToggle.replace('#', ''));
            if (input) {
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                toggleBtn.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
                toggleBtn.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}" width="18" height="18"></i>`;
                if (window.lucide) window.lucide.createIcons();
            }
        }

        const ssoBtn = event.target.closest('[data-sso]');
        if (ssoBtn) window.location.assign('/api/auth/' + ssoBtn.dataset.sso);
    });

    // --- Form Submissions ---
    $('reg-password')?.addEventListener('input', event => {
        if (!window.zxcvbn) return;
        const result = zxcvbn(event.target.value);
        const colors = ['#E74C3C','#E74C3C','#D4A017','#2ECC71','#2ECC71'];
        for(let index=0; index<4; index++) {
            const bar = $(`str-bar-${index+1}`);
            if(bar) bar.style.background = index < result.score+1 ? colors[result.score] : '#444';
        }
        const fb = $('password-feedback');
        if(fb) fb.textContent = result.feedback.warning || result.feedback.suggestions[0] || '';
    });

    $('login-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const email = $('login-email').value.trim().toLowerCase();
        const password = $('login-password').value;
        
        if (!emailOk(email)) {
            alertMessage('error', 'Please enter a valid email address.');
            return;
        }
        if (!password) {
            alertMessage('error', 'Please enter your password.');
            return;
        }
        
        currentAuthEmail = email;
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Sign in';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Signing in...'; }
        
        try {
            const { response, data } = await request('/auth/login', { email, password, rememberMe: $('remember-me')?.checked }, 'POST');
            
            if (response.ok) {
                redirect();
            } else if (response.status === 403 && data.code === 'UNVERIFIED') {
                show('verify');
                alertMessage('info', 'Verification required');
            } else {
                alertMessage('error', data.message || 'Invalid credentials');
            }
        } catch (err) {
            alertMessage('error', 'Network error. Please check your connection.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    });

    $('register-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const username = $('reg-username').value.trim();
        const email = $('reg-email').value.trim().toLowerCase();
        const password = $('reg-password').value;
        const confirmPw = $('reg-confirm')?.value;
        const termsChecked = $('reg-terms')?.checked;
        const score = window.zxcvbn ? zxcvbn(password).score : 3;

        if (
            !/^[a-zA-Z0-9_.\s]{3,30}$/.test(username) || 
            !emailOk(email) || 
            password !== confirmPw || 
            !termsChecked || 
            score < 2
        ) {
            return alertMessage('error', 'Please check your registration details and try again.');
        }
        
        currentAuthEmail = email;
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Create account';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Creating account...'; }

        try {
            const { response, data } = await request('/auth/register', { username, email, password }, 'POST');
            
            if (response.ok) {
                show('verify');
                alertMessage('success', data.message || 'Account created. Enter your code');
            } else {
                alertMessage('error', data.message || 'Registration failed');
            }
        } catch (err) {
            alertMessage('error', 'Network error. Please try again.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    });

    $('forgot-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const email = $('forgot-email').value.trim().toLowerCase();
        if (!emailOk(email)) return alertMessage('error', 'Enter a valid email');
        
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Send reset code';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Sending...'; }

        try {
            const { response, data } = await request('/auth/forgot-password', { email }, 'POST');
            
            if (response.ok) {
                currentAuthEmail = email;
                show('reset');
                alertMessage('success', data.message || 'Reset code sent');
            } else {
                alertMessage('error', data.message || 'Could not send reset code');
            }
        } catch (err) {
            alertMessage('error', 'Network error. Please try again.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    });

    $('reset-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const code = $('reset-code').value.trim();
        const newPassword = $('reset-password').value;
        
        if (!codeOk(code) || newPassword.length < 6) return alertMessage('error', 'Enter a valid code and password');
        
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Update password';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Updating...'; }

        try {
            const { response, data } = await request('/auth/reset-password', { email: currentAuthEmail, code, newPassword }, 'POST');
            
            if (response.ok) {
                show('login');
                alertMessage('success', data.message || 'Password updated');
            } else {
                alertMessage('error', data.message || 'Reset failed');
            }
        } catch (err) {
            alertMessage('error', 'Network error. Please try again.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    });

    $('verify-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const code = $('verify-code').value.trim();
        if (!codeOk(code)) return alertMessage('error', 'Enter the six-digit code');
        
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Verify account';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Verifying...'; }

        try {
            const { response, data } = await request('/auth/verify-email', { email: currentAuthEmail, code }, 'POST');
            
            if (response.ok) {
                redirect();
            } else {
                alertMessage('error', data.message || 'Invalid or expired code');
            }
        } catch (err) {
            alertMessage('error', 'Network error. Please try again.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    });

    $('resend-otp')?.addEventListener('click', async (event) => {
        if (!currentAuthEmail) return alertMessage('error', 'Email session lost');
        
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Sending...';

        try {
            const { response, data } = await request('/auth/resend-otp', { email: currentAuthEmail }, 'POST');
            alertMessage(response.ok ? 'success' : 'error', data.message || (response.ok ? 'New code sent' : 'Could not resend code'));
        } catch (err) {
            alertMessage('error', 'Network error. Please try again.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    const authError = new URLSearchParams(window.location.search).get('authError'); 
    if (authError) { 
        window.history.replaceState({}, '', '/'); 
        alertMessage('error', authError); 
    }

    // ==========================================
    // HOMEPAGE CAROUSELS & CONTENT
    // ==========================================

    // 1. TRENDING VIDEO CAROUSEL (AUTO-VISIBLE & AUTO-PLAYING)
    class TrendingVideoCarousel {
        constructor() {
            this.slides = [];
            this.currentIndex = 0;
            this.track = document.getElementById('trending-video-track');
            this.dotsContainer = document.getElementById('trend-vid-dots');
            
            document.getElementById('trend-vid-next')?.addEventListener('click', () => this.goToSlide(this.currentIndex + 1));
            document.getElementById('trend-vid-prev')?.addEventListener('click', () => this.goToSlide(this.currentIndex - 1));
        }

        async init() {
            if(!this.track) return;
            try {
                const res = await fetch('/api/episodes/feed?sort=trending&limit=5');
                if (!res.ok) return;
                const data = await res.json();
                
                if (data && data.success && data.data && data.data.episodes) {
                    this.slides = data.data.episodes.filter(ep => ep.mediaUrl || ep.hlsUrl || ep.videoUrl);
                    if (this.slides.length > 0) {
                        this.render();
                    }
                }
            } catch(e) { console.error('Trending video carousel failed', e); }
        }

        render() {
            this.track.innerHTML = '';
            this.dotsContainer.innerHTML = '';

            this.slides.forEach((slide, idx) => {
                const slideEl = document.createElement('div');
                slideEl.className = `video-showcase-slide ${idx === 0 ? 'active' : ''}`;
                
                const mediaUrl = slide.mediaUrl || slide.hlsUrl || slide.videoUrl || '';
                const posterAttr = (slide.thumbnailUrl || slide.seriesId?.coverImage)
                    ? `poster="${safeImage(slide.thumbnailUrl || slide.seriesId?.coverImage)}"`
                    : '';
                
                slideEl.innerHTML = `
                    <video ${posterAttr} muted autoplay playsinline loop preload="auto"></video>
                    <div class="video-carousel-overlay"></div>
                    <button class="play-pause-btn" aria-label="Play video"><i data-lucide="play" fill="currentColor"></i></button>
                    <div class="video-carousel-content">
                        <span class="badge">${slide.genre ? slide.genre.toUpperCase() : 'TRENDING NOW'}</span>
                        <h3>${slide.title}</h3>
                        <p>${slide.seriesId?.title || ''}</p>
                    </div>
                `;
                this.track.appendChild(slideEl);

                const video = slideEl.querySelector('video');
                const playBtn = slideEl.querySelector('.play-pause-btn');

                attachAndAutoplayVideo(slideEl, video, mediaUrl, idx === 0);

                playBtn.addEventListener('click', () => {
                    if (video.paused) {
                        this.track.querySelectorAll('video').forEach(v => v.pause());
                        video.play().then(() => slideEl.classList.add('video-live')).catch(() => {});
                    } else {
                        video.pause();
                        slideEl.classList.remove('video-live');
                    }
                });

                const dot = document.createElement('div');
                dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
                dot.onclick = () => this.goToSlide(idx);
                this.dotsContainer.appendChild(dot);
            });
            if (window.lucide) window.lucide.createIcons();
        }

        goToSlide(idx) {
            if (this.slides.length === 0) return;
            const slideEls = this.track.querySelectorAll('.video-showcase-slide');
            const dotEls = this.dotsContainer.querySelectorAll('.carousel-dot');

            const currentVideo = slideEls[this.currentIndex]?.querySelector('video');
            if (currentVideo) currentVideo.pause();

            slideEls[this.currentIndex]?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            const nextSlide = slideEls[this.currentIndex];
            nextSlide?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');

            const nextVideo = nextSlide?.querySelector('video');
            if (nextVideo) {
                nextVideo.play().then(() => nextSlide.classList.add('video-live')).catch(() => {});
            }
        }
    }

    // 2. ADMIN IMAGE SLIDESHOW
    class ImageCarousel {
        constructor() {
            this.slides = [];
            this.currentIndex = 0;
            this.interval = null;
            this.track = document.getElementById('image-slides-track');
            this.dotsContainer = document.getElementById('img-slide-dots');
            
            document.getElementById('img-slide-next')?.addEventListener('click', () => this.goToSlide(this.currentIndex + 1));
            document.getElementById('img-slide-prev')?.addEventListener('click', () => this.goToSlide(this.currentIndex - 1));
        }

        async init() {
            if(!this.track) return;
            try {
                const res = await fetch('/api/admin/banners?type=IMAGE');
                if (!res.ok) return;
                const data = await res.json();
                const payload = data.data || data;
                if (payload && payload.length > 0) {
                    this.slides = payload;
                    this.render();
                    this.start();
                }
            } catch(e) { console.error('Image carousel failed', e); }
        }

        render() {
            this.track.innerHTML = '';
            this.dotsContainer.innerHTML = '';

            this.slides.forEach((slide, idx) => {
                const slideEl = document.createElement('div');
                slideEl.className = `carousel-slide ${idx === 0 ? 'active' : ''}`;
                slideEl.style.backgroundImage = `url('${safeImage(slide.mediaUrl)}')`;
                slideEl.innerHTML = `
                    <div class="carousel-overlay"></div>
                    <div class="carousel-content text-left">
                        <h2>${slide.title || ''}</h2>
                        <p>${slide.description || ''}</p>
                        ${slide.targetUrl ? `<a href="${slide.targetUrl}" class="btn-solid inline-flex self-start" ${slide.targetUrl.startsWith('/') ? 'data-open-auth="register"' : ''}>${slide.buttonText || 'Learn More'}</a>` : ''}
                    </div>
                `;
                this.track.appendChild(slideEl);

                const dot = document.createElement('div');
                dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
                dot.onclick = () => this.goToSlide(idx);
                this.dotsContainer.appendChild(dot);
            });
        }

        goToSlide(idx) {
            if (this.slides.length === 0) return;
            const slideEls = this.track.querySelectorAll('.carousel-slide');
            const dotEls = this.dotsContainer.querySelectorAll('.carousel-dot');

            slideEls[this.currentIndex]?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            slideEls[this.currentIndex]?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');

            clearInterval(this.interval);
            this.start();
        }

        start() {
            this.interval = setInterval(() => this.goToSlide(this.currentIndex + 1), 6000);
        }
    }

    // 3. ADMIN VIDEO SHOWCASE (FIXED: USES .video-showcase-slide + AUTO-VISIBLE VIDEO)
    class AdminVideoCarousel {
        constructor() {
            this.slides = [];
            this.currentIndex = 0;
            this.track = document.getElementById('video-slides-track');
            this.dotsContainer = document.getElementById('vid-slide-dots');
            
            document.getElementById('vid-slide-next')?.addEventListener('click', () => this.goToSlide(this.currentIndex + 1));
            document.getElementById('vid-slide-prev')?.addEventListener('click', () => this.goToSlide(this.currentIndex - 1));
        }

        async init() {
            if(!this.track) return;
            try {
                const res = await fetch('/api/admin/banners?type=VIDEO');
                if (!res.ok) return;
                const data = await res.json();
                const payload = data.data || data;
                if (payload && payload.length > 0) {
                    this.slides = payload;
                    this.render();
                }
            } catch(e) { console.error('Admin Video carousel failed', e); }
        }

        render() {
            this.track.innerHTML = '';
            this.dotsContainer.innerHTML = '';

            this.slides.forEach((slide, idx) => {
                const slideEl = document.createElement('div');
                slideEl.className = `video-showcase-slide ${idx === 0 ? 'active' : ''}`;
                
                const mediaUrl = slide.mediaUrl || '';
                const posterAttr = slide.thumbnailUrl ? `poster="${safeImage(slide.thumbnailUrl)}"` : '';
                
                slideEl.innerHTML = `
                    <video ${posterAttr} muted autoplay playsinline loop preload="auto"></video>
                    <div class="video-carousel-overlay"></div>
                    <button class="play-pause-btn" aria-label="Play video"><i data-lucide="play" fill="currentColor"></i></button>
                    <div class="video-carousel-content">
                        <span class="badge">${slide.badgeText || 'FEATURED'}</span>
                        <h3>${slide.title || 'Promotional Video'}</h3>
                        <p>${slide.description || ''}</p>
                    </div>
                `;
                this.track.appendChild(slideEl);

                const video = slideEl.querySelector('video');
                const playBtn = slideEl.querySelector('.play-pause-btn');

                attachAndAutoplayVideo(slideEl, video, mediaUrl, idx === 0);

                playBtn.addEventListener('click', () => {
                    if (video.paused) {
                        this.track.querySelectorAll('video').forEach(v => v.pause());
                        video.play().then(() => slideEl.classList.add('video-live')).catch(() => {});
                    } else {
                        video.pause();
                        slideEl.classList.remove('video-live');
                    }
                });

                const dot = document.createElement('div');
                dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
                dot.onclick = () => this.goToSlide(idx);
                this.dotsContainer.appendChild(dot);
            });
            if (window.lucide) window.lucide.createIcons();
        }

        goToSlide(idx) {
            if (this.slides.length === 0) return;
            const slideEls = this.track.querySelectorAll('.video-showcase-slide');
            const dotEls = this.dotsContainer.querySelectorAll('.carousel-dot');

            const currentVideo = slideEls[this.currentIndex]?.querySelector('video');
            if (currentVideo) currentVideo.pause();

            slideEls[this.currentIndex]?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            const nextSlide = slideEls[this.currentIndex];
            nextSlide?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');

            const nextVideo = nextSlide?.querySelector('video');
            if (nextVideo) {
                nextVideo.play().then(() => nextSlide.classList.add('video-live')).catch(() => {});
            }
        }
    }

    // 4. TRENDING CONTENT GRID
    const renderContentCard = (ep) => {
        const seriesTitle = ep.seriesId?.title || 'Story';
        return `
          <button class="content-card text-left" data-open-auth="register">
            <img src="${safeImage(ep.thumbnailUrl || ep.seriesId?.coverImage)}" alt="${ep.title}">
            <div class="card-play-btn"><i data-lucide="play" fill="currentColor"></i></div>
            <div class="card-overlay">
                <span style="color: #F5B82E; font-size: 11px; font-weight: 900; letter-spacing: 1px; margin-bottom: 8px; display: block; text-transform: uppercase;">${ep.genre || 'TRENDING'}</span>
                <h3 class="card-title">${ep.title}</h3>
                <div class="card-meta">
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${seriesTitle}</span>
                    <span class="text-accent font-extrabold">Watch →</span>
                </div>
            </div>
          </button>
        `;
    };

    async function loadTrendingContent() {
        const feed = document.getElementById('trending-feed');
        if(!feed) return;
        
        try {
            const response = await fetch('/api/episodes/feed?sort=trending&limit=10');
            if(!response.ok) return;
            const data = await response.json();
            
            if (data && data.success && data.data && data.data.episodes) {
                const episodes = data.data.episodes;
                feed.innerHTML = episodes.map(renderContentCard).join('');
                if (window.lucide) window.lucide.createIcons();
            }
        } catch (error) { console.error("Failed to load trending content", error); }
    }

    // Trigger Initializers
    if(document.getElementById('image-slides-track')) new ImageCarousel().init();
    if(document.getElementById('trending-video-track')) new TrendingVideoCarousel().init();
    if(document.getElementById('video-slides-track')) new AdminVideoCarousel().init();
    if(document.getElementById('trending-feed')) loadTrendingContent();
});
