const API = '/api';
const jsonHeaders = { 'Content-Type': 'application/json' };

const $ = id => document.getElementById(id); const $$ = selector => [...document.querySelectorAll(selector)];

const emailOk = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const codeOk = value => /^\d{6}$/.test(value);

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
    document.querySelectorAll('[data-open-auth]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (authModal) {
                authModal.classList.add('active');
                document.body.style.overflow = 'hidden'; 
                show(btn.dataset.openAuth);
            }
        });
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

    // --- Form Submissions (Syntax Fixed) ---
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
        if (!emailOk(email)) return alertMessage('error', 'Enter a valid email');
        
        currentAuthEmail = email;
        const btn = event.target.querySelector('button[type="submit"]');
        if(btn) btn.disabled = true;
        
        const { response, data } = await request('/auth/login', { email, password, rememberMe: $('remember-me')?.checked }, 'POST');
        if(btn) btn.disabled = false;
        
        if (response.ok) redirect();
        else if (response.status === 403 && data.code === 'UNVERIFIED') {
            show('verify');
            alertMessage('info', 'Verification required');
        } else {
            alertMessage('error', data.message || 'Invalid credentials');
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
            return alertMessage('error', 'Check your registration details');
        }
        
        currentAuthEmail = email;
        const btn = event.target.querySelector('button[type="submit"]');
        if(btn) btn.disabled = true;

        const { response, data } = await request('/auth/register', { username, email, password }, 'POST');
        if(btn) btn.disabled = false;

        if (response.ok) {
            show('verify');
            alertMessage('success', 'Account created. Enter your code');
        } else {
            alertMessage('error', data.message || 'Registration failed');
        }
    });

    $('forgot-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const email = $('forgot-email').value.trim().toLowerCase();
        if (!emailOk(email)) return alertMessage('error', 'Enter a valid email');
        
        const btn = event.target.querySelector('button[type="submit"]');
        if(btn) btn.disabled = true;

        const { response, data } = await request('/auth/forgot-password', { email }, 'POST');
        if(btn) btn.disabled = false;

        if (response.ok) {
            currentAuthEmail = email;
            show('reset');
            alertMessage('success', 'Reset code sent');
        } else {
            alertMessage('error', data.message || 'Could not send reset code');
        }
    });

    $('reset-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const code = $('reset-code').value.trim();
        const newPassword = $('reset-password').value;
        
        if (!codeOk(code) || newPassword.length < 6) return alertMessage('error', 'Enter a valid code and password');
        
        const btn = event.target.querySelector('button[type="submit"]');
        if(btn) btn.disabled = true;

        const { response, data } = await request('/auth/reset-password', { email: currentAuthEmail, code, newPassword }, 'POST');
        if(btn) btn.disabled = false;

        if (response.ok) {
            show('login');
            alertMessage('success', 'Password updated');
        } else {
            alertMessage('error', data.message || 'Reset failed');
        }
    });

    $('verify-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const code = $('verify-code').value.trim();
        if (!codeOk(code)) return alertMessage('error', 'Enter the six-digit code');
        
        const btn = event.target.querySelector('button[type="submit"]');
        if(btn) btn.disabled = true;

        const { response, data } = await request('/auth/verify-email', { email: currentAuthEmail, code }, 'POST');
        if(btn) btn.disabled = false;

        if (response.ok) redirect();
        else alertMessage('error', data.message || 'Invalid or expired code');
    });

    $('resend-otp')?.addEventListener('click', async () => {
        if (!currentAuthEmail) return alertMessage('error', 'Email session lost');
        const { response, data } = await request('/auth/resend-otp', { email: currentAuthEmail }, 'POST');
        alertMessage(response.ok ? 'success' : 'error', data.message || (response.ok ? 'New code sent' : 'Could not resend code'));
    });

    const authError = new URLSearchParams(window.location.search).get('authError'); 
    if (authError) { 
        window.history.replaceState({}, '', '/'); 
        alertMessage('error', authError); 
    }

    // ==========================================
    // HOMEPAGE CAROUSELS & CONTENT
    // ==========================================

    // 1. ADMIN IMAGE SLIDESHOW
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
                const res = await fetch('/api/admin/slides?type=image');
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
                slideEl.style.backgroundImage = `url('${safeImage(slide.imageUrl)}')`;
                slideEl.innerHTML = `
                    <div class="carousel-overlay"></div>
                    <div class="carousel-content text-left">
                        <h2 class="text-3xl md:text-4xl font-bold font-display mb-3 text-white">${slide.title || ''}</h2>
                        <p class="text-gray-300 mb-6 text-lg max-w-md">${slide.description || ''}</p>
                        ${slide.buttonLink ? `<a href="${slide.buttonLink}" class="btn-solid inline-block self-start" ${slide.buttonLink.startsWith('/') ? 'data-open-auth="login"' : ''}>${slide.buttonText || 'Learn More'}</a>` : ''}
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

    // 2. ADMIN VIDEO SHOWCASE
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
                const res = await fetch('/api/admin/slides?type=video');
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
                slideEl.className = `carousel-slide ${idx === 0 ? 'active' : ''}`;
                
                const mediaUrl = slide.videoUrl || '';
                
                slideEl.innerHTML = `
                    <video src="${mediaUrl}" poster="${safeImage(slide.thumbnailUrl)}" playsinline loop></video>
                    <div class="video-carousel-overlay"></div>
                    <button class="play-pause-btn" aria-label="Play video"><i data-lucide="play" fill="currentColor"></i></button>
                    <div class="video-carousel-content">
                        <span class="badge">${slide.category || 'FEATURED'}</span>
                        <h3 class="text-white font-display text-2xl font-bold">${slide.title || 'Promotional Video'}</h3>
                        <p class="text-gray-300 text-sm mt-1 max-w-lg">${slide.caption || ''}</p>
                    </div>
                `;
                this.track.appendChild(slideEl);

                // Video Play/Pause Logic
                const video = slideEl.querySelector('video');
                const playBtn = slideEl.querySelector('.play-pause-btn');
                const overlay = slideEl.querySelector('.video-carousel-overlay');

                playBtn.addEventListener('click', () => {
                    if (video.paused) {
                        this.track.querySelectorAll('video').forEach(v => v.pause());
                        this.track.querySelectorAll('.play-pause-btn').forEach(btn => btn.style.opacity = '1');
                        this.track.querySelectorAll('.video-carousel-overlay').forEach(ov => ov.style.opacity = '1');
                        
                        video.play();
                        playBtn.style.opacity = '0'; 
                        overlay.style.opacity = '0'; 
                    } else {
                        video.pause();
                        playBtn.style.opacity = '1';
                        overlay.style.opacity = '1';
                    }
                });

                video.addEventListener('ended', () => {
                    playBtn.style.opacity = '1';
                    overlay.style.opacity = '1';
                });

                const dot = document.createElement('div');
                dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
                dot.onclick = () => {
                    video.pause(); 
                    playBtn.style.opacity = '1';
                    overlay.style.opacity = '1';
                    this.goToSlide(idx);
                };
                this.dotsContainer.appendChild(dot);
            });
            if (window.lucide) window.lucide.createIcons();
        }

        goToSlide(idx) {
            if (this.slides.length === 0) return;
            const slideEls = this.track.querySelectorAll('.carousel-slide');
            const dotEls = this.dotsContainer.querySelectorAll('.carousel-dot');

            const currentVideo = slideEls[this.currentIndex]?.querySelector('video');
            if (currentVideo) {
                currentVideo.pause();
                slideEls[this.currentIndex].querySelector('.play-pause-btn').style.opacity = '1';
                slideEls[this.currentIndex].querySelector('.video-carousel-overlay').style.opacity = '1';
            }

            slideEls[this.currentIndex]?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            slideEls[this.currentIndex]?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');
        }
    }

    // 3. TRENDING CONTENT GRID
    const renderContentCard = (ep) => {
        const seriesTitle = ep.seriesId?.title || 'Story';
        return `
          <button class="content-card text-left" data-open-auth="login">
            <div class="card-img-wrap">
              <img src="${safeImage(ep.thumbnailUrl || ep.seriesId?.coverImage)}" alt="${ep.title}">
            </div>
            <div class="card-info">
              <h3 class="card-title text-white">${ep.title}</h3>
              <div class="card-meta">
                <span>${seriesTitle}</span>
                <span class="text-accent flex items-center gap-1"><i data-lucide="play-circle" width="14"></i> Watch</span>
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
    if(document.getElementById('video-slides-track')) new AdminVideoCarousel().init();
    if(document.getElementById('trending-feed')) loadTrendingContent();
});
