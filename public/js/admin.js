const API_BASE = '/api/admin'; 

// SweetAlert Dark Theme Configuration
const swalConfig = {
    background: '#1b1b1b',
    color: '#f5f5f5',
    confirmButtonColor: '#d4a017',
    cancelButtonColor: '#333'
};

const $ = selector => document.querySelector(selector); const $$ = selector => [...document.querySelectorAll(selector)];

// ============================================================================
// CORE API WRAPPER (FIXED FOR FASTIFY EMPTY BODY ERROR)
// ============================================================================
async function adminApi(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    };
    
    // FIX: Fastify throws "Body cannot be empty" if Content-Type is JSON but no body exists.
    if (body) {
        options.body = JSON.stringify(body);
    } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        options.body = '{}'; 
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        
        if (response.status === 401 || response.status === 403) {
            window.location.replace('/');
            return null;
        }
        
        const result = await response.json();
        if (!result.success) throw new Error(result.message || 'API Error');
        return result.data !== undefined ? result.data : result;
    } catch (error) {
        console.error("Admin API Error:", error);
        if (window.Swal) Swal.fire({ title: 'Error', text: error.message, icon: 'error', ...swalConfig });
        return null;
    }
}

// ============================================================================
// DIRECT CLOUDINARY UPLOAD
// ============================================================================
async function uploadToCloudinary(file, type) {
    const signRes = await fetch(`/api/upload/sign?type=${type}`, { credentials: 'include' }).then(r => r.json());
    if (!signRes || !signRes.data || !signRes.data.signature) throw new Error('Failed to secure upload connection');
    
    const { signature, timestamp, apiKey, cloudName, folder } = signRes.data;
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/${type}/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Cloudinary direct upload failed');
    }
    
    const data = await response.json();
    return data.secure_url;
}

// ============================================================================
// DATA LOADERS
// ============================================================================
async function loadDashboardStats() {
    const data = await adminApi('/dashboard/stats');
    if (!data) return; 

    const grid = $('#stats-grid');
    if (!grid) return;

    grid.innerHTML = `
        <div class="card"><h3>Total Users</h3><p>${(data.totalUsers || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Verified Creators</h3><p>${(data.totalCreators || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Total Episodes</h3><p>${(data.totalEpisodes || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Total Transaction Vol</h3><p>₦${(data.totalVolume || 0).toLocaleString()}</p></div>
        <div class="card" style="border-left: 4px solid #e74c3c;">
            <h3>Pending Reports</h3><p>${data.pendingReports || 0}</p>
        </div>
        <div class="card" style="border-left: 4px solid #d4a017;">
            <h3>Pending Payouts</h3><p>${data.pendingPayouts || 0}</p>
        </div>
    `;
}

window.loadUsers = async function() {
    const tbody = $('#users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading users...</td></tr>';
    
    const data = await adminApi('/users?limit=50');
    if (!data || !data.users || !data.users.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = data.users.map(user => `
        <tr>
            <td><strong>${user.username || 'Unknown'}</strong></td>
            <td>${user.email || 'No email'}</td>
            <td>${user.role || 'USER'}</td>
            <td><span class="badge badge-${user.isActive ? 'active' : 'suspended'}">${user.isActive ? 'Active' : 'Suspended'}</span></td>
            <td class="action-cell">
                ${user.isActive 
                    ? `<button class="btn btn-danger" data-action="toggle-user" data-id="${user._id}" data-type="suspend">Suspend</button>`
                    : `<button class="btn btn-success" data-action="toggle-user" data-id="${user._id}" data-type="unsuspend">Unsuspend</button>`
                }
            </td>
        </tr>
    `).join('');
};

window.loadCreators = async function() {
    const tbody = $('#creators-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading creators...</td></tr>';
    
    const data = await adminApi('/creators?verified=false');
    if (!data || !data.creators || !data.creators.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending creator applications.</td></tr>';
        return;
    }

    tbody.innerHTML = data.creators.map(c => `
        <tr>
            <td>${c.userId?.username || 'N/A'}<br><small style="color:#aaa;">${c.userId?.email || ''}</small></td>
            <td><strong>${c.brandName || c.penName || 'N/A'}</strong></td>
            <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color:#aaa;">${c.bio || 'No bio provided'}</td>
            <td><span class="badge badge-pending">Pending Review</span></td>
            <td class="action-cell">
                <button class="btn btn-success" data-action="approve-creator" data-id="${c._id}">Approve</button>
                <button class="btn btn-danger" data-action="reject-creator" data-id="${c._id}">Reject</button>
            </td>
        </tr>
    `).join('');
};

window.loadSlides = async function() {
    const tbody = $('#image-slides-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading image slides...</td></tr>';
    
    const data = await adminApi('/banners?type=IMAGE');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active image slides.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(slide => `
        <tr>
            <td><img src="${slide.mediaUrl}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px; border: 1px solid #444;"></td>
            <td><strong style="color:#fff;">${slide.title}</strong><br><small style="color:#aaa;">${slide.description || ''}</small></td>
            <td><a href="${slide.targetUrl || '#'}" target="_blank" style="color:#d4a017; text-decoration:none;">${slide.buttonText || 'Link'}</a></td>
            <td><span class="badge badge-active">Live</span></td>
            <td><button class="btn btn-danger" data-action="delete-banner" data-id="${slide._id}" data-type="image">Delete</button></td>
        </tr>
    `).join('');
};

window.loadVideoAnnouncements = async function() {
    const tbody = $('#video-slides-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading video announcements...</td></tr>';
    
    const data = await adminApi('/banners?type=VIDEO');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active video announcements.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(slide => `
        <tr>
            <td><video src="${slide.mediaUrl}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px; border: 1px solid #444;" muted></video></td>
            <td><span class="badge badge-pending">${slide.badgeText || 'UPDATE'}</span></td>
            <td><strong style="color:#fff;">${slide.title}</strong><br><small style="color:#aaa;">${slide.description || ''}</small></td>
            <td><span class="badge badge-active">Live</span></td>
            <td><button class="btn btn-danger" data-action="delete-banner" data-id="${slide._id}" data-type="video">Delete</button></td>
        </tr>
    `).join('');
};

window.loadReports = async function() {
    const tbody = $('#reports-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading reports...</td></tr>';
    
    const data = await adminApi('/reports?status=PENDING');
    if (!data || !data.reports || !data.reports.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending reports.</td></tr>';
        return;
    }
    tbody.innerHTML = data.reports.map(r => `
        <tr>
            <td>${r.reportedBy?.username || 'Unknown'}</td>
            <td><strong style="color:#fff;">${r.targetType}</strong><br><small style="color:#aaa;">ID: ${r.targetId}</small></td>
            <td>${r.reason}<br><small style="color:#aaa;">${r.description || ''}</small></td>
            <td><span class="badge badge-pending">Action Required</span></td>
            <td class="action-cell">
                <button class="btn btn-danger" data-action="resolve-report" data-id="${r._id}" data-resolve="remove_content">Takedown</button>
                <button class="btn btn-primary" data-action="resolve-report" data-id="${r._id}" data-resolve="dismiss">Dismiss</button>
            </td>
        </tr>
    `).join('');
};

window.loadPayouts = async function() {
    const tbody = $('#payouts-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading withdrawal requests...</td></tr>';
    
    const data = await adminApi('/payouts?status=PENDING');
    if (!data || !data.payouts || !data.payouts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending payouts.</td></tr>';
        return;
    }
    tbody.innerHTML = data.payouts.map(tx => `
        <tr>
            <td>${tx.userId?.email || 'N/A'}</td>
            <td><strong style="color:#2ecc71;">₦${tx.amount}</strong></td>
            <td>${tx.metadata?.bankName || 'Wallet'}<br><small style="color:#aaa;">${tx.metadata?.accountNumber || ''}</small></td>
            <td><span class="badge badge-pending">Pending Transfer</span></td>
            <td class="action-cell">
                <button class="btn btn-success" data-action="process-payout" data-id="${tx._id}" data-process="approve">Mark Paid</button>
                <button class="btn btn-danger" data-action="process-payout" data-id="${tx._id}" data-process="reject">Decline</button>
            </td>
        </tr>
    `).join('');
};

// ============================================================================
// GLOBAL EVENT DELEGATION (CLICKS & FORMS)
// ============================================================================
document.addEventListener('click', async event => {
    try {
        // Toggle User Status
        const toggleUserBtn = event.target.closest('[data-action="toggle-user"]');
        if (toggleUserBtn) {
            const userId = toggleUserBtn.dataset.id;
            const action = toggleUserBtn.dataset.type;
            const { isConfirmed } = await Swal.fire({ title: 'Are you sure?', text: `Do you want to ${action} this user?`, icon: 'warning', showCancelButton: true, confirmButtonText: `Yes, ${action}`, ...swalConfig });
            if (!isConfirmed) return;
            const res = await adminApi(`/users/${userId}/${action}`, 'PUT');
            if (res) loadUsers();
        }

        // Approve Creator
        const approveCreatorBtn = event.target.closest('[data-action="approve-creator"]');
        if (approveCreatorBtn) {
            const id = approveCreatorBtn.dataset.id;
            const { isConfirmed } = await Swal.fire({ title: 'Approve Creator?', text: 'This grants them full publishing rights on AfroStory.', icon: 'question', showCancelButton: true, confirmButtonText: 'Yes, Approve', ...swalConfig });
            if (!isConfirmed) return;
            const res = await adminApi(`/creators/${id}/verify`, 'PUT');
            if (res) { 
                Swal.fire({ title: 'Approved!', text: 'Creator can now upload content.', icon: 'success', ...swalConfig });
                loadCreators(); loadDashboardStats(); 
            }
        }

        // Reject Creator
        const rejectCreatorBtn = event.target.closest('[data-action="reject-creator"]');
        if (rejectCreatorBtn) {
            const id = rejectCreatorBtn.dataset.id;
            const result = await Swal.fire({ title: 'Reject Creator', input: 'text', inputLabel: 'Reason for rejection (this will be sent to the user):', inputPlaceholder: 'e.g. Incomplete profile details', showCancelButton: true, inputValidator: (value) => { if (!value) return 'You need to write a reason!'; }, ...swalConfig });
            if (!result.isConfirmed || !result.value) return;
            const res = await adminApi(`/creators/${id}/reject`, 'PUT', { reason: result.value });
            if (res) { 
                Swal.fire({ title: 'Rejected', text: 'Creator has been removed from the queue.', icon: 'success', ...swalConfig });
                loadCreators(); 
            }
        }

        // Delete Banner
        const deleteBannerBtn = event.target.closest('[data-action="delete-banner"]');
        if (deleteBannerBtn) {
            const id = deleteBannerBtn.dataset.id;
            const type = deleteBannerBtn.dataset.type;
            const { isConfirmed } = await Swal.fire({ title: 'Remove Banner?', text: "It will be permanently removed from the homepage.", icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, Delete', ...swalConfig });
            if (!isConfirmed) return;
            const res = await adminApi(`/banners/${id}`, 'DELETE');
            if (res) {
                Swal.fire({ title: 'Deleted', text: 'Banner removed.', icon: 'success', ...swalConfig });
                type === 'image' ? loadSlides() : loadVideoAnnouncements();
            }
        }

        // Resolve Report
        const resolveReportBtn = event.target.closest('[data-action="resolve-report"]');
        if (resolveReportBtn) {
            const id = resolveReportBtn.dataset.id;
            const action = resolveReportBtn.dataset.resolve;
            const { isConfirmed } = await Swal.fire({ title: 'Confirm Action', text: `Apply action: ${action.replace('_', ' ')}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes', ...swalConfig });
            if (!isConfirmed) return;
            const status = action === 'dismiss' ? 'DISMISSED' : 'RESOLVED';
            const res = await adminApi(`/reports/${id}/resolve`, 'PUT', { status, actionTaken: action });
            if (res) { 
                Swal.fire({title: 'Resolved', text: 'Report processed successfully.', icon: 'success', ...swalConfig}); 
                loadReports(); loadDashboardStats(); 
            }
        }

        // Process Payout
        const processPayoutBtn = event.target.closest('[data-action="process-payout"]');
        if (processPayoutBtn) {
            const id = processPayoutBtn.dataset.id;
            const action = processPayoutBtn.dataset.process;
            const isApprove = action === 'approve';
            const result = await Swal.fire({ title: isApprove ? 'Mark as Paid' : 'Decline Payout', input: 'text', inputLabel: isApprove ? 'Enter bank transaction reference:' : 'Enter reason for rejection:', showCancelButton: true, inputValidator: (value) => { if (!value) return 'This field is required!'; }, ...swalConfig });
            if (!result.isConfirmed || !result.value) return;
            const payload = isApprove ? { payoutReference: result.value } : { reason: result.value };
            const res = await adminApi(`/payouts/${id}/${action}`, 'PUT', payload);
            if (res) { 
                Swal.fire({title: 'Success', text: `Payout ${action}d successfully.`, icon: 'success', ...swalConfig}); 
                loadPayouts(); loadDashboardStats(); 
            }
        }
    } catch (e) {
        console.error('Click Handler Error:', e);
    }
});

document.addEventListener('submit', async event => {
    // Handle Image Banner Upload
    if (event.target.id === 'slide-upload-form') {
        event.preventDefault(); // INSTANTLY PREVENT PAGE REFRESH
        const form = event.target;
        const btn = form.querySelector('button');
        const originalText = btn.textContent;
        btn.disabled = true; btn.textContent = 'Uploading Image...';

        try {
            const fileInput = form.imageFile;
            if (!fileInput || !fileInput.files[0]) throw new Error("Please select an image file.");
            
            const mediaUrl = await uploadToCloudinary(fileInput.files[0], 'image');

            btn.textContent = 'Saving...';
            await adminApi('/banners', 'POST', {
                title: form.title.value,
                description: form.description.value,
                buttonText: form.buttonText.value,
                targetUrl: form.targetUrl.value,
                mediaUrl: mediaUrl,
                mediaType: 'IMAGE',
                category: 'PROMO_IMAGE'
            });

            Swal.fire('Success', 'Image banner added to homepage', 'success', swalConfig);
            form.reset();
            loadSlides();
        } catch (err) {
            Swal.fire('Error', err.message, 'error', swalConfig);
        } finally {
            btn.disabled = false; btn.textContent = originalText;
        }
    }

    // Handle Video Announcement Upload
    if (event.target.id === 'video-slide-form') {
        event.preventDefault(); // INSTANTLY PREVENT PAGE REFRESH
        const form = event.target;
        const btn = form.querySelector('button');
        const originalText = btn.textContent;
        btn.disabled = true; btn.textContent = 'Uploading Video...';

        try {
            const fileInput = form.videoFile;
            if (!fileInput || !fileInput.files[0]) throw new Error("Please select a video file.");
            
            const mediaUrl = await uploadToCloudinary(fileInput.files[0], 'video');

            btn.textContent = 'Saving...';
            await adminApi('/banners', 'POST', {
                title: form.title.value,
                description: form.description.value,
                badgeText: form.badgeText.value,
                mediaUrl: mediaUrl,
                mediaType: 'VIDEO',
                category: 'PROMO_VIDEO'
            });

            Swal.fire('Success', 'Video announcement added', 'success', swalConfig);
            form.reset();
            loadVideoAnnouncements();
        } catch (err) {
            Swal.fire('Error', err.message, 'error', swalConfig);
        } finally {
            btn.disabled = false; btn.textContent = originalText;
        }
    }
});

// ============================================================================
// BOOT
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) throw new Error("Not logged in");
        const data = await response.json();
        const user = data.data || data.user || data;
        if (!user || String(user.role).toUpperCase() !== 'ADMIN') throw new Error("Not an admin");
    } catch (error) {
        window.location.replace('/');
        return;
    }

    const loader = $('#page-loader');
    if (loader) loader.style.display = 'none';
    
    loadDashboardStats();
});
