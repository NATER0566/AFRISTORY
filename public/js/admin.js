const API_BASE = '/api/admin'; 

// SweetAlert Dark Theme Configuration
const swalConfig = {
    background: '#1a1a2e',
    color: '#fff',
    confirmButtonColor: '#d4a017',
    cancelButtonColor: '#333'
};

// ============================================================================
// BULLETPROOF AUTHENTICATION CHECK
// ============================================================================
window.onload = async () => {
    let isAdmin = false;

    try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const u = JSON.parse(userStr);
            const role = u.role || (u.user && u.user.role);
            if (role && String(role).toUpperCase() === 'ADMIN') isAdmin = true;
        }
    } catch (e) {}

    if (!isAdmin) {
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                const user = data.data || data.user || data;
                if (user && user.role && String(user.role).toUpperCase() === 'ADMIN') isAdmin = true;
            }
        } catch (error) {
            console.error("Backend auth check failed:", error);
        }
    }

    if (!isAdmin) {
        window.location.replace('/');
        return;
    }

    document.getElementById('page-loader').style.display = 'none';
    loadDashboardStats();
};

// ============================================================================
// CORE API WRAPPER
// ============================================================================
async function adminApi(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) options.body = JSON.stringify(body);

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
        Swal.fire({ title: 'Error', text: error.message, icon: 'error', ...swalConfig });
        return null;
    }
}

// ============================================================================
// DIRECT CLOUDINARY UPLOAD
// ============================================================================
async function uploadToCloudinary(file, type) {
    // 1. Get secure signature from server
    const signRes = await fetch(`/api/upload/sign?type=${type}`, { credentials: 'include' }).then(r => r.json());
    if (!signRes || !signRes.data || !signRes.data.signature) throw new Error('Failed to secure upload connection');
    
    const { signature, timestamp, apiKey, cloudName, folder } = signRes.data;
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/${type}/upload`;

    // 2. Upload directly to Cloudinary
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Cloudinary direct upload failed');
    
    const data = await response.json();
    return data.secure_url;
}

// ============================================================================
// DATA LOADERS
// ============================================================================
window.loadDashboardStats = async function() {
    const data = await adminApi('/dashboard/stats');
    if (!data) return; 

    document.getElementById('stats-grid').innerHTML = `
        <div class="card"><h3>Total Users</h3><p>${(data.totalUsers || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Verified Creators</h3><p>${(data.totalCreators || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Total Episodes</h3><p>${(data.totalEpisodes || 0).toLocaleString()}</p></div>
        <div class="card"><h3>Total Transaction Vol</h3><p>◈${(data.totalVolume || 0).toLocaleString()}</p></div>
        <div class="card" style="border-left: 4px solid #e74c3c;">
            <h3>Pending Reports</h3><p>${data.pendingReports || 0}</p>
        </div>
        <div class="card" style="border-left: 4px solid #d4a017;">
            <h3>Pending Payouts</h3><p>${data.pendingPayouts || 0}</p>
        </div>
    `;
};

window.loadUsers = async function() {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading users...</td></tr>';
    
    const data = await adminApi('/users?limit=50');
    if (!data || !data.users || !data.users.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found.</td></tr>';
        return;
    }

    tbody.innerHTML = data.users.map(user => `
        <tr>
            <td><strong>${user.username}</strong></td>
            <td>${user.email}</td>
            <td>${user.role}</td>
            <td><span class="badge badge-${user.isActive ? 'active' : 'suspended'}">${user.isActive ? 'Active' : 'Suspended'}</span></td>
            <td class="action-cell">
                ${user.isActive 
                    ? `<button class="btn btn-danger" onclick="toggleUserStatus('${user._id}', 'suspend')">Suspend</button>`
                    : `<button class="btn btn-success" onclick="toggleUserStatus('${user._id}', 'unsuspend')">Unsuspend</button>`
                }
            </td>
        </tr>
    `).join('');
};

window.toggleUserStatus = async function(userId, action) {
    const { isConfirmed } = await Swal.fire({
        title: 'Are you sure?',
        text: `Do you want to ${action} this user?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: `Yes, ${action}`,
        ...swalConfig
    });
    
    if (!isConfirmed) return;
    const res = await adminApi(`/users/${userId}/${action}`, 'PUT');
    if (res) loadUsers();
};

// --- CREATOR APPROVAL SYSTEM ---
window.loadCreators = async function() {
    const tbody = document.getElementById('creators-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading creators...</td></tr>';
    
    const data = await adminApi('/creators?verified=false');
    if (!data || !data.creators || !data.creators.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending creator applications.</td></tr>';
        return;
    }

    tbody.innerHTML = data.creators.map(c => `
        <tr>
            <td>${c.userId?.username || 'N/A'}<br><small>${c.userId?.email || ''}</small></td>
            <td><strong>${c.brandName || c.penName || 'N/A'}</strong></td>
            <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.bio || 'No bio provided'}</td>
            <td><span class="badge badge-pending">Pending Review</span></td>
            <td class="action-cell">
                <button class="btn btn-success" onclick="verifyCreator('${c._id}')">Approve</button>
                <button class="btn btn-danger" onclick="rejectCreator('${c._id}')">Reject</button>
            </td>
        </tr>
    `).join('');
};

window.verifyCreator = async function(id) {
    const { isConfirmed } = await Swal.fire({
        title: 'Approve Creator?',
        text: 'This grants them full publishing rights on AfroStory.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, Approve',
        ...swalConfig
    });
    
    if (!isConfirmed) return;
    const res = await adminApi(`/creators/${id}/verify`, 'PUT');
    if (res) { 
        Swal.fire({ title: 'Approved!', text: 'Creator can now upload content.', icon: 'success', ...swalConfig });
        loadCreators(); 
        loadDashboardStats(); 
    }
};

window.rejectCreator = async function(id) {
    const { value: reason } = await Swal.fire({
        title: 'Reject Creator',
        input: 'text',
        inputLabel: 'Reason for rejection (this will be sent to the user):',
        inputPlaceholder: 'e.g. Incomplete profile details',
        showCancelButton: true,
        inputValidator: (value) => { if (!value) return 'You need to write a reason!'; },
        ...swalConfig
    });

    if (!reason) return;
    const res = await adminApi(`/creators/${id}/reject`, 'PUT', { reason });
    if (res) { 
        Swal.fire({ title: 'Rejected', text: 'Creator has been removed from the queue.', icon: 'success', ...swalConfig });
        loadCreators(); 
    }
};

// --- BANNERS & SLIDESHOW (IMAGE & VIDEO) ---
window.loadSlides = async function() {
    const tbody = document.getElementById('image-slides-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading image slides...</td></tr>';
    const data = await adminApi('/banners?type=IMAGE');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active image slides.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(slide => `
        <tr>
            <td><img src="${slide.mediaUrl}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px;"></td>
            <td><strong>${slide.title}</strong><br><small>${slide.description}</small></td>
            <td><a href="${slide.targetUrl}" target="_blank" style="color:#d4a017;">${slide.buttonText}</a></td>
            <td><span class="badge badge-active">Live</span></td>
            <td><button class="btn btn-danger" onclick="deleteBanner('${slide._id}', 'image')">Delete</button></td>
        </tr>
    `).join('');
};

window.loadVideoAnnouncements = async function() {
    const tbody = document.getElementById('video-slides-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading video announcements...</td></tr>';
    const data = await adminApi('/banners?type=VIDEO');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active video announcements.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(slide => `
        <tr>
            <td><video src="${slide.mediaUrl}" style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px;" muted></video></td>
            <td><span class="badge badge-pending">${slide.badgeText}</span></td>
            <td><strong>${slide.title}</strong><br><small>${slide.description}</small></td>
            <td><span class="badge badge-active">Live</span></td>
            <td><button class="btn btn-danger" onclick="deleteBanner('${slide._id}', 'video')">Delete</button></td>
        </tr>
    `).join('');
};

window.deleteBanner = async function(id, type) {
    const { isConfirmed } = await Swal.fire({ title: 'Remove Banner?', text: "It will be removed from the homepage.", icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, Delete', ...swalConfig });
    if (!isConfirmed) return;
    const res = await adminApi(`/banners/${id}`, 'DELETE');
    if (res) {
        Swal.fire({ title: 'Deleted', text: 'Banner removed.', icon: 'success', ...swalConfig });
        type === 'image' ? loadSlides() : loadVideoAnnouncements();
    }
};

// Handle Image Form Submission
document.getElementById('slide-upload-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Uploading to Cloudinary...';

    try {
        const file = form.imageFile.files[0];
        const mediaUrl = await uploadToCloudinary(file, 'image');

        btn.textContent = 'Saving Banner...';
        await adminApi('/banners', 'POST', {
            title: form.title.value,
            description: form.description.value,
            buttonText: form.buttonText.value,
            targetUrl: form.targetUrl.value,
            mediaUrl: mediaUrl,
            mediaType: 'IMAGE',
            category: 'PROMO_IMAGE'
        });

        Swal.fire('Success', 'Image banner added to homepage', 'success');
        form.reset();
        loadSlides();
    } catch (err) {
        Swal.fire('Error', err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Upload Image Slide';
    }
});

// Handle Video Form Submission
document.getElementById('video-slide-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Uploading to Cloudinary...';

    try {
        const file = form.videoFile.files[0];
        const mediaUrl = await uploadToCloudinary(file, 'video');

        btn.textContent = 'Saving Announcement...';
        await adminApi('/banners', 'POST', {
            title: form.title.value,
            description: form.description.value,
            badgeText: form.badgeText.value,
            mediaUrl: mediaUrl,
            mediaType: 'VIDEO',
            category: 'PROMO_VIDEO'
        });

        Swal.fire('Success', 'Video announcement added to homepage', 'success');
        form.reset();
        loadVideoAnnouncements();
    } catch (err) {
        Swal.fire('Error', err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Upload Video Announcement';
    }
});

// --- MODERATION & PAYOUTS ---
window.loadReports = async function() {
    const tbody = document.getElementById('reports-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading reports...</td></tr>';
    const data = await adminApi('/reports?status=PENDING');
    if (!data || !data.reports || !data.reports.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending reports.</td></tr>';
        return;
    }
    tbody.innerHTML = data.reports.map(r => `
        <tr>
            <td>${r.reportedBy?.username || 'Unknown'}</td>
            <td><strong>${r.targetType}</strong><br><small>ID: ${r.targetId}</small></td>
            <td>${r.reason}<br><small>${r.description || ''}</small></td>
            <td><span class="badge badge-pending">Action Required</span></td>
            <td class="action-cell">
                <button class="btn btn-danger" onclick="resolveReport('${r._id}', 'remove_content')">Takedown</button>
                <button class="btn btn-primary" onclick="resolveReport('${r._id}', 'dismiss')">Dismiss</button>
            </td>
        </tr>
    `).join('');
};

window.resolveReport = async function(id, action) {
    const { isConfirmed } = await Swal.fire({ title: 'Confirm Action', text: `Apply action: ${action.replace('_', ' ')}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes', ...swalConfig });
    if (!isConfirmed) return;
    const status = action === 'dismiss' ? 'DISMISSED' : 'RESOLVED';
    const res = await adminApi(`/reports/${id}/resolve`, 'PUT', { status, actionTaken: action });
    if (res) { Swal.fire('Resolved', 'Report processed successfully.', 'success'); loadReports(); loadDashboardStats(); }
};

window.loadPayouts = async function() {
    const tbody = document.getElementById('payouts-tbody');
    tbody.innerHTML = '<tr><td colspan="5">Loading withdrawal requests...</td></tr>';
    const data = await adminApi('/payouts?status=PENDING');
    if (!data || !data.payouts || !data.payouts.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No pending payouts.</td></tr>';
        return;
    }
    tbody.innerHTML = data.payouts.map(tx => `
        <tr>
            <td>${tx.userId?.email || 'N/A'}</td>
            <td><strong>₦${tx.amount}</strong></td>
            <td>${tx.metadata?.bankName || 'Wallet'}<br><small>${tx.metadata?.accountNumber || ''}</small></td>
            <td><span class="badge badge-pending">Pending Transfer</span></td>
            <td class="action-cell">
                <button class="btn btn-success" onclick="processPayout('${tx._id}', 'approve')">Mark Paid</button>
                <button class="btn btn-danger" onclick="processPayout('${tx._id}', 'reject')">Decline</button>
            </td>
        </tr>
    `).join('');
};

window.processPayout = async function(id, action) {
    const isApprove = action === 'approve';
    const { value: input } = await Swal.fire({
        title: isApprove ? 'Mark as Paid' : 'Decline Payout',
        input: 'text',
        inputLabel: isApprove ? 'Enter bank transaction reference:' : 'Enter reason for rejection:',
        showCancelButton: true,
        inputValidator: (value) => { if (!value) return 'This field is required!'; },
        ...swalConfig
    });
    if (!input) return;
    const payload = isApprove ? { payoutReference: input } : { reason: input };
    const res = await adminApi(`/payouts/${id}/${action}`, 'PUT', payload);
    if (res) { Swal.fire('Success', `Payout ${action}d successfully.`, 'success'); loadPayouts(); loadDashboardStats(); }
};
