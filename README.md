# AFROSTORY - Enterprise Digital Storytelling Platform

A production-ready digital storytelling and video streaming platform built with Fastify, MongoDB, and Vanilla JavaScript.

## 🎯 Core Features

- **User Authentication**: Secure JWT-based authentication with HttpOnly cookies
- **Creator Studio**: Upload and manage video series and episodes
- **Dual Monetization**:
  - Premium Coins: Purchase coins via Paystack for episode access
  - Rewarded Ads: Watch ads to unlock episodes (3 daily resets)
- **Video Streaming**: HLS streaming via Cloudinary CDN
- **Watch History**: Track watch progress and completion
- **Comments & Engagement**: Series and episode discussions
- **VIP Subscriptions**: Premium tier access (VIP, GOLD)
- **Admin Dashboard**: Moderation, analytics, and user management
- **Push Notifications**: OneSignal integration for real-time updates

## 🛠️ Technology Stack

- **Backend**: Node.js 20, Fastify 4
- **Database**: MongoDB Atlas + Mongoose ODM
- **Authentication**: JWT, bcryptjs
- **Payments**: Paystack API
- **Media**: Cloudinary (HLS video streaming)
- **Notifications**: OneSignal
- **Real-time**: Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (Tailwind)

## 📋 Prerequisites

- Node.js 20+
- MongoDB Atlas account and cluster
- Paystack account (for payments)
- Cloudinary account (for video/image hosting)
- OneSignal account (for push notifications)

## ⚙️ Environment Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd afrostory
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

4. **Fill in your environment variables in `.env`:**
   ```env
   # Server
   PORT=3000
   NODE_ENV=development

   # Database
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/afrostory?retryWrites=true&w=majority

   # Authentication
   JWT_SECRET=your_super_secret_key_min_32_chars_long

   # Cloudinary
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   CLOUDINARY_URL=cloudinary://key:secret@cloud_name

   # Paystack
   PAYSTACK_SECRET_KEY=sk_live_your_secret_key
   PAYSTACK_PUBLIC_KEY=pk_live_your_public_key

   # OneSignal
   ONESIGNAL_APP_ID=your_app_id
   ONESIGNAL_API_KEY=your_api_key

   # Frontend
   FRONTEND_URL=http://localhost:3000
   ```

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```
Runs with `--watch` for automatic restarts on file changes.

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:3000` (or your configured PORT).

### Verify Server is Running
```bash
curl http://localhost:3000/health
```

## 📁 Project Structure

```
/afrostory
├── /public              # Frontend static files
│   ├── index.html       # Auth page (login/register)
│   ├── app.html         # Main platform SPA
│   ├── /css
│   │   └── style.css    # Master styles
│   └── /js
│       ├── auth.js      # Auth logic
│       ├── main.js      # Core app logic
│       └── ads.js       # Ad integration
│
├── /server
│   ├── server.js        # Fastify server entry point
│   ├── /config          # Third-party integrations
│   │   ├── db.js        # MongoDB
│   │   ├── cloudinary.js
│   │   ├── paystack.js
│   │   └── onesignal.js
│   ├── /middleware      # Auth & access control
│   │   └── auth.js      # JWT verification
│   ├── /models          # Mongoose schemas
│   │   ├── User.js
│   │   ├── Creator.js
│   │   ├── Series.js
│   │   ├── Episode.js
│   │   ├── Wallet.js
│   │   ├── Transaction.js
│   │   ├── Unlock.js
│   │   ├── History.js
│   │   ├── Comment.js
│   │   ├── Notification.js
│   │   ├── Subscription.js
│   │   └── Report.js
│   ├── /routes          # API endpoints
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── creators.js
│   │   ├── series.js
│   │   ├── episodes.js
│   │   ├── wallet.js
│   │   ├── vip.js
│   │   ├── comments.js
│   │   ├── notifications.js
│   │   ├── search.js
│   │   ├── ads.js
│   │   ├── upload.js
│   │   ├── payment.js
│   │   └── admin.js
│   ├── /utils           # Helper functions
│   │   ├── response.js  # Consistent API responses
│   │   └── helpers.js   # Utilities
│   └── /uploads         # Temporary file storage

├── package.json
├── .env.example
└── README.md
```

## 📚 API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Register new user
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /me` - Get current user
- `POST /forgot-password` - Request password reset
- `POST /set-pin` - Set 4-digit PIN

### Users (`/api/users`)
- `GET /:userId` - Get user profile
- `PUT /profile/update` - Update profile
- `GET /all/list` - List all users (paginated)
- `GET /history/watch` - Get watch history
- `GET /ads/remaining` - Check remaining ad unlocks

### Creators (`/api/creators`)
- `GET /:creatorId` - Get creator profile
- `POST /become-creator` - Convert to creator
- `PUT /profile/update` - Update creator profile
- `GET /:creatorId/series` - Get creator's series
- `GET /top/creators` - Top creators list
- `GET /me/profile` - Get my creator profile

### Series (`/api/series`)
- `GET /discover/all` - Discover series
- `GET /:seriesId` - Get series details
- `POST /create` - Create new series
- `PUT /:seriesId/update` - Update series
- `DELETE /:seriesId` - Delete series
- `GET /:seriesId/episodes` - Get series episodes

### Episodes (`/api/episodes`)
- `GET /:episodeId` - Get episode
- `POST /series/:seriesId/create` - Create episode
- `PUT /:episodeId/update` - Update episode
- `DELETE /:episodeId` - Delete episode
- `POST /:episodeId/watch` - Update watch history

### Wallet (`/api/wallet`)
- `GET /me/balance` - Get wallet balance
- `GET /me/transactions` - Get transaction history
- `POST /unlock-episode` - Unlock episode with coins

### VIP (`/api/vip`)
- `GET /plans` - Get subscription plans
- `GET /me/status` - Get subscription status
- `POST /subscribe` - Subscribe to plan
- `POST /cancel` - Cancel subscription

### Ads (`/api/ads`)
- `GET /unlocks/remaining` - Check ad unlocks
- `POST /verify-completion` - Verify ad and unlock episode
- `POST /webhook` - Ad network webhook

### Payment (`/api/payment`)
- `GET /packages` - Get coin packages
- `POST /initialize-transaction` - Start Paystack payment
- `POST /verify-transaction` - Verify payment
- `POST /webhook/paystack` - Paystack webhook
- `POST /request-payout` - Request creator payout

### Upload (`/api/upload`)
- `POST /image` - Upload image
- `POST /video` - Upload video
- `DELETE /asset/:publicId` - Delete from Cloudinary
- `GET /token` - Get upload token

### Comments (`/api/comments`)
- `GET /episode/:episodeId` - Get episode comments
- `POST /create` - Create comment
- `PUT /:commentId` - Update comment
- `DELETE /:commentId` - Delete comment
- `POST /:commentId/like` - Like comment

### Search (`/api/search`)
- `GET /global` - Global search
- `GET /series` - Search series
- `GET /creators` - Search creators
- `GET /trending` - Get trending series

### Admin (`/api/admin`)
- `GET /dashboard/stats` - Dashboard stats
- `GET /users` - List all users
- `PUT /users/:userId/suspend` - Suspend user
- `PUT /users/:userId/unsuspend` - Unsuspend user
- `GET /reports` - Get moderation reports
- `PUT /reports/:reportId/resolve` - Resolve report
- `PUT /creators/:creatorId/verify` - Verify creator
- `GET /analytics` - Get analytics

## 🔐 Security Features

- **HttpOnly Cookies**: JWT stored securely, inaccessible to JavaScript
- **Password Hashing**: bcryptjs with salted hashes
- **PIN Protection**: For high-value operations
- **MongoDB Transactions**: Atomic operations for financial flows
- **Idempotent Webhooks**: Reference IDs prevent duplicate processing
- **RBAC**: Role-based access control (USER, CREATOR, ADMIN)
- **CORS**: Configured for frontend domain

## 💰 Monetization System

### Premium Coins
- Users buy coins via Paystack
- Coins unlock paid episodes
- Creators earn 60% of unlock revenue
- Remaining 40% for platform

### Rewarded Ads
- 3 free ad unlocks per day (resets at midnight)
- Users watch ads to unlock episodes
- Creators earn 20% of normal episode cost
- Grows user engagement and watch time

### VIP Subscriptions
- BASIC: Free tier (default)
- VIP: $9.99/month = 100 coins
- GOLD: $24.99/3 months = 300 coins

## 🎬 Video Streaming

All videos are uploaded to Cloudinary and delivered via HLS (HTTP Live Streaming):
- Adaptive bitrate streaming
- Automatic quality adjustment
- Global CDN distribution
- Secure playback

## 📊 Financial Models

### Decimal128 Precision
All financial calculations use MongoDB's Decimal128 type for accurate decimal arithmetic:
- No floating-point errors
- Precise cent-level calculations
- ACID transactions

### Transaction Types
- `FUND`: Coin purchase
- `SPEND`: Episode unlock with coins
- `AD_REWARD`: Creator reward from ad unlock
- `PAYOUT`: Creator withdrawal
- `REFUND`: Refunds and adjustments

## 🧪 Testing

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test registration
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "securepassword123",
    "confirmPassword": "securepassword123"
  }'

# Test login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "securepassword123"
  }' \
  -c cookies.txt

# Test authenticated endpoint
curl http://localhost:3000/api/users/me \
  -b cookies.txt
```

## 🚀 Deployment

### Render Setup
1. Connect repository to Render
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables (from `.env.example`)
5. Deploy

### Docker (Optional)
```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
```

## 📝 License

Proprietary - All rights reserved

## 🤝 Support

For issues or questions, contact the development team.

---

**Built with ❤️ for African storytellers**
