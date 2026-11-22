const API = '/api';
const jsonHeaders = { 'Content-Type': 'application/json' };

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];

const emailOk = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const codeOk = value => /^\d{6}$/.test(value);
const usernameOk = value => /^[a-zA-Z0-9_]{5,30}$/.test(value);
const passwordOk = value => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);

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

// ==========================================
// SINGLE STATIONARY MUTE/UNMUTE ICON & SECTION ISOLATION
// ==========================================
const MUTE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
const UNMUTE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';

function updateMuteIcon(slideEl, isUnmuted) {
    const btn = slideEl?.querySelector('.slide-sound-btn');
    if (!btn) return;
    btn.innerHTML = isUnmuted ? UNMUTE_ICON_SVG : MUTE_ICON_SVG;
    btn.classList.toggle('is-unmuted', Boolean(isUnmuted));
    btn.setAttribute('aria-label', isUnmuted ? 'Mute video' : 'Unmute video');
    btn.setAttribute('title', isUnmuted ? 'Mute' : 'Unmute');
}

function stopOtherSectionVideos(activeSectionId) {
    document.querySelectorAll('.video-showcase-track').forEach(track => {
        if (track.id === activeSectionId) return;
        track.querySelectorAll('video').forEach(v => {
            v._manualPlaying = false;
            v.pause();
            v.muted = true;
            v.defaultMuted = true;
            const slide = v.closest('.video-showcase-slide');
            if (slide) {
                slide.classList.remove('video-playing');
                updateMuteIcon(slide, false);
            }
        });
    });
}

function stopSiblingVideosInTrack(trackEl, keepVideo) {
    if (!trackEl) return;
    trackEl.querySelectorAll('video').forEach(v => {
        if (v === keepVideo) return;
        v._manualPlaying = false;
        v.pause();
        v.muted = true;
        v.defaultMuted = true;
        const slide = v.closest('.video-showcase-slide');
        if (slide) {
            slide.classList.remove('video-playing');
            updateMuteIcon(slide, false);
        }
    });
}

function mountSingleMuteButton(slideEl) {
    slideEl.querySelectorAll('.slide-sound-btn, .video-sound-pill').forEach(el => el.remove());
    const soundBtn = document.createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'slide-sound-btn';
    soundBtn.innerHTML = MUTE_ICON_SVG;
    soundBtn.setAttribute('aria-label', 'Unmute video');
    soundBtn.setAttribute('title', 'Unmute');
    slideEl.appendChild(soundBtn);
    return soundBtn;
}

// ==========================================
// SECTION 1: WATCH NOW VIDEO CONTROLLER (AUTOPLAY MUTED, ISOLATED)
// ==========================================
function attachWatchNowVideo(slideEl, video, mediaUrl, isActive) {
    if (!video || !mediaUrl) return;
    const trackEl = slideEl.closest('#trending-video-track');

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 1;
    video.loop = true;
    video.playsInline = true;
    video.preload = isActive ? 'auto' : 'metadata';
    video.removeAttribute('autoplay');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    if (mediaUrl.includes('.m3u8') && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true });
        hls.loadSource(mediaUrl);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            if (isActive && slideEl.classList.contains('active')) {
                video.play().catch(() => {});
            }
        });
    } else {
        video.src = mediaUrl;
        video.load();
    }

    const primeFirstFrame = () => {
        if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.5) {
            try { video.currentTime = 0.25; } catch (e) {}
        }
    };

    video.addEventListener('loadedmetadata', primeFirstFrame, { once: true });
    video.addEventListener('loadeddata', primeFirstFrame, { once: true });

    video.addEventListener('playing', () => {
        if (!slideEl.classList.contains('active')) {
            video.pause();
            video.muted = true;
            slideEl.classList.remove('video-playing');
            updateMuteIcon(slideEl, false);
            return;
        }
        stopSiblingVideosInTrack(trackEl, video);
        slideEl.classList.add('video-playing');
    });

    video.addEventListener('pause', () => {
        slideEl.classList.remove('video-playing');
    });

    const soundBtn = mountSingleMuteButton(slideEl);
    soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.muted) {
            stopOtherSectionVideos('trending-video-track');
            stopSiblingVideosInTrack(trackEl, video);
            video.muted = false;
            video.defaultMuted = false;
            video.volume = 1;
            updateMuteIcon(slideEl, true);
            if (video.paused) {
                video.play().then(() => {
                    slideEl.classList.add('video-playing');
                }).catch(() => {});
            }
        } else {
            video.muted = true;
            video.defaultMuted = true;
            updateMuteIcon(slideEl, false);
        }
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    video.muted = true;
                    video.pause();
                    slideEl.classList.remove('video-playing');
                    updateMuteIcon(slideEl, false);
                } else if (slideEl.classList.contains('active') && video.paused) {
                    const announcementPlaying = [...document.querySelectorAll('#video-slides-track video')].some(v => !v.paused);
                    if (!announcementPlaying) {
                        video.muted = true;
                        updateMuteIcon(slideEl, false);
                        video.play().then(() => slideEl.classList.add('video-playing')).catch(() => {});
                    }
                }
            });
        }, { threshold: 0.35 });
        observer.observe(slideEl);
    }

    if (isActive) {
        stopSiblingVideosInTrack(trackEl, video);
        video.play().then(() => slideEl.classList.add('video-playing')).catch(() => {});
    }
}

// ==========================================
// SECTION 3: FEATURED ANNOUNCEMENTS CONTROLLER (MANUAL PLAY ONLY, ISOLATED)
// ==========================================
function attachAnnouncementVideo(slideEl, video, mediaUrl, isActive) {
    if (!video || !mediaUrl) return;
    const trackEl = slideEl.closest('#video-slides-track');

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 1;
    video.loop = true;
    video.playsInline = true;
    video.preload = isActive ? 'auto' : 'metadata';
    video._manualPlaying = false;
    video.removeAttribute('autoplay');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    if (mediaUrl.includes('.m3u8') && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true });
        hls.loadSource(mediaUrl);
        hls.attachMedia(video);
    } else {
        video.src = mediaUrl;
        video.load();
    }

    const primePreviewFrame = () => {
        if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.5) {
            try { video.currentTime = 0.25; } catch (e) {}
        }
    };

    video.addEventListener('loadedmetadata', primePreviewFrame, { once: true });
    video.addEventListener('loadeddata', primePreviewFrame, { once: true });

    video.addEventListener('play', () => {
        if (!slideEl.classList.contains('active') || !video._manualPlaying) {
            video.pause();
            video.muted = true;
            slideEl.classList.remove('video-playing');
            updateMuteIcon(slideEl, false);
            return;
        }
        stopOtherSectionVideos('video-slides-track');
        stopSiblingVideosInTrack(trackEl, video);
        slideEl.classList.add('video-playing');
    });

    video.addEventListener('pause', () => {
        slideEl.classList.remove('video-playing');
    });

    const soundBtn = mountSingleMuteButton(slideEl);
    soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.paused) {
            video._manualPlaying = true;
            stopOtherSectionVideos('video-slides-track');
            stopSiblingVideosInTrack(trackEl, video);
            video.muted = false;
            video.defaultMuted = false;
            video.volume = 1;
            updateMuteIcon(slideEl, true);
            video.play().then(() => {
                slideEl.classList.add('video-playing');
            }).catch(() => {});
            return;
        }

        if (video.muted) {
            stopOtherSectionVideos('video-slides-track');
            video.muted = false;
            video.defaultMuted = false;
            video.volume = 1;
            updateMuteIcon(slideEl, true);
        } else {
            video.muted = true;
            video.defaultMuted = true;
            updateMuteIcon(slideEl, false);
        }
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    video._manualPlaying = false;
                    video.muted = true;
                    video.pause();
                    slideEl.classList.remove('video-playing');
                    updateMuteIcon(slideEl, false);
                }
            });
        }, { threshold: 0.35 });
        observer.observe(slideEl);
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
        if (ssoBtn) {
            const provider = ssoBtn.dataset.sso;
            const label = provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : provider;
            ssoBtn.disabled = true;
            ssoBtn.textContent = `Connecting to ${label}...`;
            alertMessage('info', `Redirecting to ${label} sign-in...`);
            window.location.assign('/api/auth/' + provider);
        }
    });

    // --- Form Submissions ---
    $('reg-password')?.addEventListener('input', event => {
        const value = event.target.value;
        const fb = $('password-feedback');
        if (!window.zxcvbn) return;
        const result = zxcvbn(value);
        const colors = ['#E74C3C','#E74C3C','#D4A017','#2ECC71','#2ECC71'];
        for(let index=0; index<4; index++) {
            const bar = $(`str-bar-${index+1}`);
            if(bar) bar.style.background = value && index < result.score+1 ? colors[result.score] : '#333';
        }
        if (fb) {
            if (!value) {
                fb.textContent = 'Use at least 8 characters with an uppercase letter, lowercase letter, and a number.';
            } else if (!passwordOk(value)) {
                fb.textContent = 'Include 8+ characters, 1 uppercase letter, 1 lowercase letter, and 1 number.';
            } else {
                fb.textContent = result.feedback.warning || 'Strong password ready.';
            }
        }
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

        if (!usernameOk(username)) {
            return alertMessage('error', 'Username must be 5–30 characters using only letters, numbers, or underscores.');
        }
        if (!emailOk(email)) {
            return alertMessage('error', 'Please enter a valid email address.');
        }
        if (!passwordOk(password)) {
            return alertMessage('error', 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a number.');
        }
        if (password !== confirmPw) {
            return alertMessage('error', 'Passwords do not match.');
        }
        if (!termsChecked) {
            return alertMessage('error', 'Please agree to the Terms of Service and Privacy Policy.');
        }
        
        currentAuthEmail = email;
        const btn = event.target.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Create account';
        if(btn) { btn.disabled = true; btn.innerHTML = 'Creating account...'; }

        try {
            const { response, data } = await request('/auth/register', { username, email, password, acceptPolicies: Boolean(termsChecked) }, 'POST');
            
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
        
        if (!codeOk(code)) return alertMessage('error', 'Enter the six-digit reset code.');
        if (!passwordOk(newPassword)) return alertMessage('error', 'New password must be at least 8 characters with an uppercase letter, lowercase letter, and a number.');
        
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
        if (authModal) {
            authModal.classList.add('active');
            document.body.style.overflow = 'hidden';
            show('login');
        }
        alertMessage('error', authError); 
    }

    // ==========================================
    // HOMEPAGE CAROUSELS & CONTENT
    // ==========================================

    // 1. WATCH NOW VIDEO CAROUSEL (COMPLETELY SEPARATE FROM ANNOUNCEMENTS)
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
                    <video ${posterAttr} muted playsinline loop preload="${idx === 0 ? 'auto' : 'metadata'}"></video>
                    <div class="video-carousel-overlay"></div>
                    <button type="button" class="play-pause-btn" aria-label="Play video"><i data-lucide="play" fill="currentColor"></i></button>
                    <div class="video-carousel-content">
                        <span class="badge">${slide.genre ? slide.genre.toUpperCase() : 'TRENDING NOW'}</span>
                        <h3>${slide.title}</h3>
                        <p>${slide.seriesId?.title || ''}</p>
                    </div>
                `;
                this.track.appendChild(slideEl);

                const video = slideEl.querySelector('video');
                const playBtn = slideEl.querySelector('.play-pause-btn');

                attachWatchNowVideo(slideEl, video, mediaUrl, idx === 0);

                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (video.paused) {
                        stopSiblingVideosInTrack(this.track, video);
                        video.play().then(() => slideEl.classList.add('video-playing')).catch(() => {});
                    } else {
                        video.pause();
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

            const currentSlide = slideEls[this.currentIndex];
            const currentVideo = currentSlide?.querySelector('video');
            const keepSoundOn = Boolean(currentVideo && !currentVideo.muted);

            if (currentVideo) {
                currentVideo.pause();
                currentVideo.muted = true;
                currentSlide.classList.remove('video-playing');
                updateMuteIcon(currentSlide, false);
            }

            currentSlide?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            const nextSlide = slideEls[this.currentIndex];
            nextSlide?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');

            const nextVideo = nextSlide?.querySelector('video');
            if (nextVideo) {
                if (keepSoundOn) stopOtherSectionVideos('trending-video-track');
                stopSiblingVideosInTrack(this.track, nextVideo);
                nextVideo.muted = !keepSoundOn;
                nextVideo.defaultMuted = !keepSoundOn;
                nextVideo.volume = 1;
                updateMuteIcon(nextSlide, keepSoundOn);
                nextVideo.play().then(() => nextSlide.classList.add('video-playing')).catch(() => {});
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

    // 3. FEATURED ANNOUNCEMENTS VIDEO SHOWCASE (COMPLETELY SEPARATE, MANUAL PLAY ONLY)
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
                    <video ${posterAttr} muted playsinline loop preload="${idx === 0 ? 'auto' : 'metadata'}"></video>
                    <div class="video-carousel-overlay"></div>
                    <button type="button" class="play-pause-btn" aria-label="Play announcement video"><i data-lucide="play" fill="currentColor"></i></button>
                    <div class="video-carousel-content">
                        <span class="badge">${slide.badgeText || 'FEATURED'}</span>
                        <h3>${slide.title || 'Promotional Video'}</h3>
                        <p>${slide.description || ''}</p>
                    </div>
                `;
                this.track.appendChild(slideEl);

                const video = slideEl.querySelector('video');
                const playBtn = slideEl.querySelector('.play-pause-btn');

                attachAnnouncementVideo(slideEl, video, mediaUrl, idx === 0);

                const toggleAnnouncementPlay = (e) => {
                    e.stopPropagation();
                    if (video.paused) {
                        video._manualPlaying = true;
                        stopOtherSectionVideos('video-slides-track');
                        stopSiblingVideosInTrack(this.track, video);
                        video.muted = false;
                        video.defaultMuted = false;
                        video.volume = 1;
                        updateMuteIcon(slideEl, true);
                        video.play().then(() => {
                            slideEl.classList.add('video-playing');
                        }).catch(() => {
                            video.muted = true;
                            updateMuteIcon(slideEl, false);
                            video.play().then(() => slideEl.classList.add('video-playing')).catch(() => {});
                        });
                    } else {
                        video._manualPlaying = false;
                        video.pause();
                        video.muted = true;
                        slideEl.classList.remove('video-playing');
                        updateMuteIcon(slideEl, false);
                    }
                };

                playBtn.addEventListener('click', toggleAnnouncementPlay);
                video.addEventListener('click', toggleAnnouncementPlay);

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

            const currentSlide = slideEls[this.currentIndex];
            const currentVideo = currentSlide?.querySelector('video');

            if (currentVideo) {
                currentVideo._manualPlaying = false;
                currentVideo.pause();
                currentVideo.muted = true;
                currentSlide.classList.remove('video-playing');
                updateMuteIcon(currentSlide, false);
            }

            currentSlide?.classList.remove('active');
            dotEls[this.currentIndex]?.classList.remove('active');

            this.currentIndex = (idx + this.slides.length) % this.slides.length;

            const nextSlide = slideEls[this.currentIndex];
            nextSlide?.classList.add('active');
            dotEls[this.currentIndex]?.classList.add('active');

            const nextVideo = nextSlide?.querySelector('video');
            if (nextVideo) {
                nextVideo._manualPlaying = false;
                nextVideo.pause();
                nextVideo.muted = true;
                nextSlide.classList.remove('video-playing');
                updateMuteIcon(nextSlide, false);
                if (nextVideo.readyState === 0) nextVideo.load();
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
