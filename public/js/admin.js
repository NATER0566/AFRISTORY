const API_BASE = '/api/admin'; 

// ============================================================================
// BULLETPROOF AUTHENTICATION CHECK
// ============================================================================
window.onload = async () => {
    let isAdmin = false;

    // 1. Quick check: Look in local storage first to prevent loading delays
    try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const u = JSON.parse(userStr);
            const role = u.role || (u.user && u.user.role);
            if (role && String(role).toUpperCase() === 'ADMIN') {
                isAdmin = true;
            }
        }
    } catch (e) {}

    // 2. Concrete check: Verify with the backend using the secure cookie
    if (!isAdmin) {
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (response.ok) {
                const data = await response.json();
                const user = data.data || data.user || data;
                if (user && user.role && String(user.role).toUpperCase() === 'ADMIN') {
                    isAdmin = true;
                }
            }
        } catch (error) {
            console.error("Backend auth check failed:", error);
        }
    }

    // 3. The Bounce: If still not verified as admin, bounce instantly to index
    if (!isAdmin) {
        window.location.replace('/');
        return;
    }

    // If verification passes, reveal the dashboard
    document.getElementById('page-loader').style.display = 'none';
    loadDashboardStats();
};

// ============================================================================
// CORE API WRAPPER
// ============================================================================
async function adminApi(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        credentials: 'include', // Ensures the secure auth cookie is sent
        headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        
        // If backend rejects the secure cookie, bounce to index
        if (response.status === 401 || response.status === 403) {
            window.location.replace('/');
            return null;
        }
        
        const result = await response.json();
        if (!result.success) throw new Error(result.message || 'API Error');
        return result.data;
    } catch (error) {
        console.error("Admin API Error:", error);
        alert('Action failed: ' + error.message);
        return null;
    }
}

// ============================================================================
// UI & TAB NAVIGATION
// ============================================================================
window.switchTab = function(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    if (event && event.target) {
        event.target.classList.add('active');
    }
};

// ============================================================================
// DATA LOADERS
// ============================================================================
window.loadDashboardStats = async function() {
    const data = await adminApi('/dashboard/stats');
    if (!data) return; 

    document.getElementById('stats-grid').innerHTML = `
        <div class="card"><h3>Total Users</h3><p>${data.totalUsers.toLocaleString()}</p></div>
        <div class="card"><h3>Verified Creators</h3><p>${data.totalCreators.toLocaleString()}</p></div>
        <div class="card"><h3>Total Episodes</h3><p>${data.totalEpisodes.toLocaleString()}</p></div>
        <div class="card"><h3>Total Transaction Vol</h3><p>₦${data.totalVolume}</p></div>
        <div class="card" style="border-left: 4px solid #dc3545;">
            <h3>Pending Reports</h3><p>${data.pendingReports}</p>
        </div>
        <div class="card" style="border-left: 4px solid #ff5722;">
            <h3>Pending Payouts</h3><p>${data.pendingPayouts}</p>
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
            <td>
                ${user.isActive 
                    ? `<button class="btn btn-danger" onclick="toggleUserStatus('${user._id}', 'suspend')">Suspend</button>`
                    : `<button class="btn btn-success" onclick="toggleUserStatus('${user._id}', 'unsuspend')">Unsuspend</button>`
                }
            </td>
        </tr>
    `).join('');
};

window.toggleUserStatus = async function(userId, action) {
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;
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
            <td>${c.penName || c.userId?.username || 'N/A'}</td>
            <td>${c.socialLinks ? Object.values(c.socialLinks).join(', ') : 'None provided'}</td>
            <td><span class="badge badge-pending">Pending Review</span></td>
            <td>
                <button class="btn btn-success" onclick="verifyCreator('${c._id}')">Approve</button>
                <button class="btn btn-danger" onclick="rejectCreator('${c._id}')">Reject</button>
            </td>
        </tr>
    `).join('');
};

window.verifyCreator = async function(id) {
    if (!confirm('Approve this creator? This grants them full publishing rights on AfroStory.')) return;
    const res = await adminApi(`/creators/${id}/verify`, 'PUT');
    if (res) { 
        alert('Creator Approved! They can now upload content.'); 
        loadCreators(); 
        loadDashboardStats(); 
    }
};

window.rejectCreator = async function(id) {
    const reason = prompt('Reason for rejection (this will be sent to the user):');
    if (reason === null) return;
    const res = await adminApi(`/creators/${id}/reject`, 'PUT', { reason });
    if (res) { 
        alert('Creator Rejected.'); 
        loadCreators(); 
    }
};

// --- MODERATION ---
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
            <td>
                <button class="btn btn-danger" onclick="resolveReport('${r._id}', 'remove_content')">Takedown Content</button>
                <button class="btn btn-primary" onclick="resolveReport('${r._id}', 'dismiss')">Dismiss</button>
            </td>
        </tr>
    `).join('');
};

window.resolveReport = async function(id, action) {
    if (!confirm(`Apply action: ${action.replace('_', ' ')}?`)) return;
    const status = action === 'dismiss' ? 'DISMISSED' : 'RESOLVED';
    const res = await adminApi(`/reports/${id}/resolve`, 'PUT', { status, actionTaken: action });
    if (res) { alert('Report processed.'); loadReports(); loadDashboardStats(); }
};

// --- PAYOUTS ---
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
            <td>
                <button class="btn btn-success" onclick="processPayout('${tx._id}', 'approve')">Mark Paid</button>
                <button class="btn btn-danger" onclick="processPayout('${tx._id}', 'reject')">Decline & Refund</button>
            </td>
        </tr>
    `).join('');
};

window.processPayout = async function(id, action) {
    const promptText = action === 'approve' ? 'Enter bank transaction reference:' : 'Enter reason for rejection:';
    const input = prompt(promptText);
    if (input === null) return;

    const payload = action === 'approve' ? { payoutReference: input } : { reason: input };
    const res = await adminApi(`/payouts/${id}/${action}`, 'PUT', payload);
    if (res) { alert(`Payout ${action}d successfully.`); loadPayouts(); loadDashboardStats(); }
};
