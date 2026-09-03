# AFROSTORY API Reference

## Response Format

All endpoints return standardized JSON:

```json
{
  "success": true,
  "message": "Description of result",
  "data": {},
  "statusCode": 200
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request successful |
| 201 | Created - Resource created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - No/invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limit |
| 500 | Server Error - Internal error |

---

## Auth Endpoints (`/api/auth`)

### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "string (3-30 chars)",
  "email": "string (valid email)",
  "password": "string (min 8 chars)",
  "confirmPassword": "string (must match password)"
}
```
**Response (201):**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "userId": "ObjectId",
    "username": "string",
    "email": "string",
    "role": "USER"
  }
}
```

### Login
```http
POST /api/auth/login
Content-Type: application/json
Cookie: auto-set with HttpOnly JWT

{
  "email": "string",
  "password": "string"
}
```
**Response (200):** Same as register. Token in HttpOnly cookie.

### Logout
```http
POST /api/auth/logout
```
Clears JWT cookie.

### Get Current User
```http
GET /api/auth/me
Cookie: token=<jwt>
```

### Forgot Password
```http
POST /api/auth/forgot-password
{
  "email": "string"
}
```

### Set PIN (for secure operations)
```http
POST /api/auth/set-pin
Cookie: token=<jwt>

{
  "pin": "string (exactly 4 digits)",
  "confirmPin": "string (must match)"
}
```

---

## User Endpoints (`/api/users`)

### Get User Profile
```http
GET /api/users/:userId
```
**Response:**
```json
{
  "user": { ... },
  "wallet": {
    "storyCoins": number,
    "lockedEarnings": number,
    "totalWithdrawn": number,
    "totalEarned": number
  }
}
```

### Update Profile
```http
PUT /api/users/profile/update
Cookie: token=<jwt>

{
  "username": "string (optional)",
  "email": "string (optional)",
  "profileImage": "string URL (optional)"
}
```

### List All Users
```http
GET /api/users/all/list?page=1&limit=10
```

### Get Watch History
```http
GET /api/users/history/watch?page=1&limit=10
Cookie: token=<jwt>
```

### Check Ad Unlocks Remaining
```http
GET /api/users/ads/remaining
Cookie: token=<jwt>

Response: { adUnlocksRemaining: number, adUnlocksResetDate: ISO-8601 }
```

---

## Creator Endpoints (`/api/creators`)

### Get Creator Profile
```http
GET /api/creators/:creatorId
```

### Become a Creator
```http
POST /api/creators/become-creator
Cookie: token=<jwt>

{
  "brandName": "string (required)",
  "bio": "string (optional)",
  "socialLinks": {
    "twitter": "string",
    "instagram": "string",
    "facebook": "string",
    "tiktok": "string",
    "youtube": "string",
    "website": "string"
  }
}
```

### Update Creator Profile
```http
PUT /api/creators/profile/update
Cookie: token=<jwt>

{
  "brandName": "string",
  "bio": "string",
  "socialLinks": { ... },
  "profileImage": "string URL",
  "coverImage": "string URL",
  "bankAccount": {
    "accountNumber": "string",
    "bankCode": "string",
    "accountName": "string"
  }
}
```

### Get Creator's Series
```http
GET /api/creators/:creatorId/series?page=1&limit=10
```

### Get Top Creators
```http
GET /api/creators/top/creators?limit=10
```

### Get My Creator Profile
```http
GET /api/creators/me/profile
Cookie: token=<jwt>
```

---

## Series Endpoints (`/api/series`)

### Discover Series
```http
GET /api/series/discover/all?page=1&limit=10&genre=Drama&sort=newest
```
Sort options: `newest`, `trending`, `rating`

### Get Series Details
```http
GET /api/series/:seriesId
```

### Create Series
```http
POST /api/series/create
Cookie: token=<jwt>
Requires: CREATOR role

{
  "title": "string (required)",
  "description": "string",
  "coverImage": "string URL (required)",
  "tags": ["string", "string"],
  "genre": "string",
  "language": "string"
}
```

### Update Series
```http
PUT /api/series/:seriesId/update
Cookie: token=<jwt>

{
  "title": "string",
  "description": "string",
  "coverImage": "string URL",
  "tags": ["string"],
  "status": "ONGOING|COMPLETED|DRAFT",
  "genre": "string",
  "language": "string",
  "isPublished": boolean
}
```

### Delete Series
```http
DELETE /api/series/:seriesId
Cookie: token=<jwt>
```
Also deletes all episodes.

### Get Series Episodes
```http
GET /api/series/:seriesId/episodes?page=1&limit=10
```

---

## Episode Endpoints (`/api/episodes`)

### Get Episode
```http
GET /api/episodes/:episodeId
```

### Create Episode
```http
POST /api/episodes/series/:seriesId/create
Cookie: token=<jwt>

{
  "episodeNumber": number,
  "title": "string",
  "description": "string",
  "mediaUrl": "string HLS URL (from Cloudinary)",
  "thumbnailUrl": "string URL",
  "duration": number (seconds),
  "isFree": boolean,
  "coinCost": number (default 10),
  "adUnlockable": boolean (default true)
}
```

### Update Episode
```http
PUT /api/episodes/:episodeId/update
Cookie: token=<jwt>

{
  "title": "string",
  "description": "string",
  "mediaUrl": "string",
  "thumbnailUrl": "string",
  "duration": number,
  "isFree": boolean,
  "coinCost": number,
  "adUnlockable": boolean,
  "isPublished": boolean
}
```

### Delete Episode
```http
DELETE /api/episodes/:episodeId
Cookie: token=<jwt>
```

### Update Watch History
```http
POST /api/episodes/:episodeId/watch
Cookie: token=<jwt>

{
  "lastPosition": number (seconds),
  "watchedPercentage": number (0-100),
  "completed": boolean
}
```

---

## Wallet Endpoints (`/api/wallet`)

### Get Balance
```http
GET /api/wallet/me/balance
Cookie: token=<jwt>

Response: {
  "storyCoins": number,
  "lockedEarnings": number,
  "totalWithdrawn": number,
  "totalEarned": number
}
```

### Get Transactions
```http
GET /api/wallet/me/transactions?page=1&limit=10
Cookie: token=<jwt>
```

### Unlock Episode with Coins
```http
POST /api/wallet/unlock-episode
Cookie: token=<jwt>

{
  "episodeId": "ObjectId"
}
```
Deducts coins, awards 60% to creator, creates Unlock record.

---

## VIP Endpoints (`/api/vip`)

### Get Plans
```http
GET /api/vip/plans

Response: {
  "VIP": { price: 9.99, coins: 100, duration: 30 },
  "GOLD": { price: 24.99, coins: 300, duration: 90 }
}
```

### Get Subscription Status
```http
GET /api/vip/me/status
Cookie: token=<jwt>

Response: {
  "isSubscribed": boolean,
  "subscription": {
    "tier": "VIP|GOLD|BASIC",
    "expiresAt": "ISO-8601",
    "renewalDate": "ISO-8601"
  }
}
```

### Subscribe
```http
POST /api/vip/subscribe
Cookie: token=<jwt>

{
  "tier": "VIP|GOLD"
}
```

### Cancel Subscription
```http
POST /api/vip/cancel
Cookie: token=<jwt>
```

---

## Comment Endpoints (`/api/comments`)

### Get Episode Comments
```http
GET /api/comments/episode/:episodeId?page=1&limit=10
```
Returns nested threads with replies.

### Create Comment
```http
POST /api/comments/create
Cookie: token=<jwt>

{
  "episodeId": "ObjectId",
  "text": "string (max 1000 chars)",
  "parentCommentId": "ObjectId (optional, for replies)"
}
```

### Update Comment
```http
PUT /api/comments/:commentId
Cookie: token=<jwt>

{
  "text": "string"
}
```

### Delete Comment
```http
DELETE /api/comments/:commentId
Cookie: token=<jwt>
```

### Like Comment
```http
POST /api/comments/:commentId/like
Cookie: token=<jwt>
```

---

## Search Endpoints (`/api/search`)

### Global Search
```http
GET /api/search/global?q=drama&type=series&page=1&limit=10
```
Type: `series`, `creators`, `episodes` (optional - all if omitted)

### Search Series
```http
GET /api/search/series?q=drama&genre=Drama&sort=relevance&page=1&limit=10
```
Sort: `relevance`, `trending`, `rating`

### Search Creators
```http
GET /api/search/creators?q=john&page=1&limit=10
```

### Get Trending
```http
GET /api/search/trending?limit=10
```

---

## Ad Endpoints (`/api/ads`)

### Check Remaining Unlocks
```http
GET /api/ads/unlocks/remaining
Cookie: token=<jwt>

Response: {
  "adUnlocksRemaining": number,
  "adUnlocksResetDate": "ISO-8601"
}
```

### Verify Ad Completion
```http
POST /api/ads/verify-completion
Cookie: token=<jwt>

{
  "episodeId": "ObjectId",
  "adPayload": {
    "nonce": "string from ad network",
    "timestamp": number,
    "signature": "string from ad network"
  }
}
```

---

## Payment Endpoints (`/api/payment`)

### Get Coin Packages
```http
GET /api/payment/packages

Response: {
  "STARTER": { coins: 100, price: 10.0, naira: 4750 },
  "GROWTH": { coins: 300, price: 25.0, naira: 12000 },
  "PREMIUM": { coins: 1000, price: 75.0, naira: 35000 },
  "ELITE": { coins: 3000, price: 200.0, naira: 95000 }
}
```

### Initialize Payment
```http
POST /api/payment/initialize-transaction
Cookie: token=<jwt>

{
  "packageKey": "STARTER|GROWTH|PREMIUM|ELITE"
}

Response: {
  "authorizationUrl": "https://checkout.paystack.com/...",
  "accessCode": "string",
  "reference": "PAY_..."
}
```

### Verify Payment
```http
POST /api/payment/verify-transaction
Cookie: token=<jwt>

{
  "reference": "PAY_..."
}
```
Returns new coin balance if successful.

### Request Payout
```http
POST /api/payment/request-payout
Cookie: token=<jwt>

{
  "amount": number,
  "bankCode": "string (from Paystack)",
  "accountNumber": "string"
}
```

---

## Notification Endpoints (`/api/notifications`)

### Get Notifications
```http
GET /api/notifications/me?page=1&limit=10&read=false
Cookie: token=<jwt>
```

### Get Unread Count
```http
GET /api/notifications/me/unread-count
Cookie: token=<jwt>
```

### Mark as Read
```http
PUT /api/notifications/:notificationId/read
Cookie: token=<jwt>
```

### Mark All as Read
```http
PUT /api/notifications/me/read-all
Cookie: token=<jwt>
```

### Delete Notification
```http
DELETE /api/notifications/:notificationId
Cookie: token=<jwt>
```

---

## Upload Endpoints (`/api/upload`)

### Upload Image
```http
POST /api/upload/image
Cookie: token=<jwt>
Content-Type: multipart/form-data

file: <binary image>

Response: {
  "url": "https://cloudinary.com/...",
  "publicId": "string"
}
```

### Upload Video
```http
POST /api/upload/video
Cookie: token=<jwt>
Content-Type: multipart/form-data
Requires: CREATOR role

file: <binary video>

Response: {
  "url": "https://cloudinary.com/...",
  "hlsUrl": "https://cloudinary.com/....m3u8",
  "publicId": "string",
  "duration": number
}
```

### Delete Asset
```http
DELETE /api/upload/asset/:publicId
Cookie: token=<jwt>
```

### Get Upload Token
```http
GET /api/upload/token
Cookie: token=<jwt>

For client-side uploads
```

---

## Admin Endpoints (`/api/admin`)
**Requires: ADMIN role**

### Get Dashboard Stats
```http
GET /api/admin/dashboard/stats
Cookie: token=<jwt>
```

### List Users
```http
GET /api/admin/users?page=1&limit=10&role=CREATOR
Cookie: token=<jwt>
```

### Suspend User
```http
PUT /api/admin/users/:userId/suspend
Cookie: token=<jwt>
```

### Unsuspend User
```http
PUT /api/admin/users/:userId/unsuspend
Cookie: token=<jwt>
```

### Get Reports
```http
GET /api/admin/reports?page=1&limit=10&status=PENDING
Cookie: token=<jwt>
```

### Resolve Report
```http
PUT /api/admin/reports/:reportId/resolve
Cookie: token=<jwt>

{
  "status": "RESOLVED|DISMISSED",
  "adminNotes": "string",
  "actionTaken": "suspend|remove_content|none"
}
```

### Verify Creator
```http
PUT /api/admin/creators/:creatorId/verify
Cookie: token=<jwt>
```

### Get Analytics
```http
GET /api/admin/analytics?startDate=2024-01-01&endDate=2024-01-31
Cookie: token=<jwt>
```

---

## Common Query Parameters

| Param | Type | Default | Example |
|-------|------|---------|---------|
| `page` | number | 1 | ?page=2 |
| `limit` | number | 10 | ?limit=20 (max 100) |
| `sort` | string | varies | ?sort=trending |
| `genre` | string | - | ?genre=Drama |
| `type` | string | - | ?type=series |
| `read` | boolean | - | ?read=true |
| `status` | string | - | ?status=PENDING |

---

## Status Codes Reference

### Series/Episode Status
- `DRAFT` - Not published yet
- `ONGOING` - Active series/episode
- `COMPLETED` - Finished series/episode

### Transaction Type
- `FUND` - Coin purchase
- `SPEND` - Coin spent on unlock
- `AD_REWARD` - Creator reward from ad
- `PAYOUT` - Creator withdrawal

### Unlock Method
- `COIN` - Unlocked with coins
- `AD` - Unlocked with ad
- `VIP` - Unlocked with subscription
- `FREE` - Free episode

### Report Status
- `PENDING` - Not reviewed
- `REVIEWING` - Admin reviewing
- `RESOLVED` - Issue handled
- `DISMISSED` - Not a violation

---

This reference covers all 14 API modules with 60+ endpoints. For complete implementation details, see `README.md`.
