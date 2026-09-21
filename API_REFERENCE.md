# Afristory API Reference - Complete
Base URL: https://api.afristory.naterlearninghub.me/api
Base URL (Prod): https://afristory.naterlearninghub.me/api

Authentication: Bearer Token
Header: Authorization: Bearer <JWT_TOKEN>

---

### 1. Auth Endpoints (/api/auth)
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh-token
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/auth/me

### 2. User Endpoints (/api/users)
GET    /api/users/me
PUT    /api/users/me
PUT    /api/users/me/password
GET    /api/users/:userId/profile
PUT    /api/users/me/avatar
GET    /api/users/me/stats

### 3. Series Endpoints (/api/series)
POST   /api/series (Requires CREATOR role)
GET    /api/series
GET    /api/series/trending
GET    /api/series/featured
GET    /api/series/:seriesId
PUT    /api/series/:seriesId
DELETE /api/series/:seriesId
GET    /api/series/my/created

### 4. Episode Endpoints (/api/episodes)
POST   /api/episodes/:seriesId
GET    /api/episodes/series/:seriesId
GET    /api/episodes/:episodeId
PUT    /api/episodes/:episodeId
DELETE /api/episodes/:episodeId
POST   /api/episodes/:episodeId/unlock
GET    /api/episodes/:episodeId/comments

### 5. Category / Genre Endpoints (/api/categories)
GET    /api/categories
POST   /api/categories (ADMIN)
PUT    /api/categories/:categoryId (ADMIN)
DELETE /api/categories/:categoryId (ADMIN)

### 6. Library / Favorites / History (/api/library)
GET    /api/library/me/favorites
POST   /api/library/me/favorites/:seriesId
DELETE /api/library/me/favorites/:seriesId
GET    /api/library/me/history
POST   /api/library/me/history/:episodeId
DELETE /api/library/me/history
GET    /api/library/me/following
POST   /api/library/me/follow/:creatorId
DELETE /api/library/me/follow/:creatorId

### 7. Comment & Interaction Endpoints (/api/comments)
POST   /api/comments/episode/:episodeId
GET    /api/comments/episode/:episodeId
PUT    /api/comments/:commentId
DELETE /api/comments/:commentId
POST   /api/comments/:commentId/like

### 8. Payment / Wallet Endpoints (/api/payment)
GET    /api/payment/wallet/me
GET    /api/payment/transactions/me
POST   /api/payment/fund-wallet
POST   /api/payment/verify-transaction
POST   /api/payment/request-payout
GET    /api/payment/payouts/me
POST   /api/payment/unlock/:episodeId

### 9. Notification Endpoints (/api/notifications)
GET    /api/notifications/me?page=1&limit=10&read=false
GET    /api/notifications/me/unread-count
PUT    /api/notifications/:notificationId/read
PUT    /api/notifications/me/read-all
DELETE /api/notifications/:notificationId

### 10. Upload Endpoints (/api/upload)
POST   /api/upload/image
POST   /api/upload/video (Requires CREATOR role)
Content-Type: multipart/form-data
Field: file
DELETE /api/upload/asset/:publicId

### 11. Search & Discovery (/api/search)
GET    /api/search?q=keyword&type=series,episode,user
GET    /api/search/suggestions?q=keyword

### 12. Report Endpoints (/api/reports)
POST   /api/reports
GET    /api/reports/me

### 13. Creator Endpoints (/api/creators)
GET    /api/creators
GET    /api/creators/:creatorId
GET    /api/creators/:creatorId/series
GET    /api/creators/me/earnings
GET    /api/creators/me/analytics

### 14. Admin Endpoints (/api/admin)
Requires: ADMIN role
GET    /api/admin/dashboard/stats
GET    /api/admin/users
PUT    /api/admin/users/:userId/suspend
PUT    /api/admin/users/:userId/unsuspend
GET    /api/admin/series
PUT    /api/admin/series/:seriesId/feature
GET    /api/admin/reports
PUT    /api/admin/reports/:reportId/resolve
PUT    /api/admin/creators/:creatorId/verify
GET    /api/admin/transactions
GET    /api/admin/payouts
PUT    /api/admin/payouts/:payoutId/approve
PUT    /api/admin/payouts/:payoutId/reject
GET    /api/admin/analytics

---

### Status Codes Reference

Series/Episode Status
- DRAFT - Not published yet, only visible to creator
- ONGOING - Active series/episode, visible to all
- COMPLETED - Finished series/episode

Transaction Type
- FUND - Coin purchase / wallet funding
- SPEND - Coin spent on unlock
- PAYOUT - Creator withdrawal
- REFUND - Refunds and adjustments
- AD_REWARD - Reserved for future verified ad networks

Unlock Method
- COIN - Unlocked with coins
- VIP - Unlocked with subscription
- FREE - Free episode
- AD - Reserved for future verified ad networks (AppLovin, AdMob, Unity)

Report Status
- PENDING - Not reviewed
- REVIEWING - Admin reviewing
- RESOLVED - Issue handled
- DISMISSED - Not a violation

User Roles
- USER - Regular reader
- CREATOR - Can upload series/episodes
- ADMIN - Full access

HTTP Status Codes
- 200 OK - Success
- 201 Created - Created successfully
- 400 Bad Request - Invalid input
- 401 Unauthorized - No token / invalid token
- 403 Forbidden - Role not allowed
- 404 Not Found - Resource not found
- 429 Too Many Requests - Rate limited
- 500 Internal Server Error

---

This reference covers all 14 API modules with 60+ endpoints.
For complete implementation details, see README.md and /api-docs (Swagger)
