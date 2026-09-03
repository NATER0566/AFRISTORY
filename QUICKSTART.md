# AFROSTORY - Quick Start Guide

## 🚀 Get Running in 5 Minutes

### Step 1: Install Dependencies
```bash
cd c:\Users\USER\AFRISTORY
npm install
```

### Step 2: Configure Environment
Open `.env` and update with your actual credentials:

```env
# MongoDB Atlas
MONGO_URI=mongodb+srv://your_user:your_password@your_cluster.mongodb.net/afrostory?retryWrites=true&w=majority

# JWT Secret (keep this safe!)
JWT_SECRET=your_32_char_minimum_secret_key_change_this

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=get_from_cloudinary_dashboard
CLOUDINARY_API_SECRET=get_from_cloudinary_dashboard

# Paystack (Nigeria payment)
PAYSTACK_SECRET_KEY=sk_live_from_paystack
PAYSTACK_PUBLIC_KEY=pk_live_from_paystack

# OneSignal (push notifications)
ONESIGNAL_APP_ID=from_onesignal
ONESIGNAL_API_KEY=from_onesignal
```

### Step 3: Start Server
```bash
npm run dev
```

You should see:
```
🚀 AFROSTORY Backend running on port 3000
✅ MongoDB connected successfully
```

### Step 4: Test It Works
```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-22T10:30:45.123Z"}
```

## 📝 First API Call - Register a User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "SecurePass123!",
    "confirmPassword": "SecurePass123!"
  }'
```

Response:
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "testuser",
    "email": "test@example.com",
    "role": "USER"
  },
  "statusCode": 201
}
```

The JWT token is automatically stored in an HttpOnly cookie! ✅

## 🔐 Login & Use Protected Routes

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }' \
  -c cookies.txt \
  -b cookies.txt

# The -c and -b flags save and send cookies
# Token is now in HttpOnly cookie!
```

```bash
# Get current user (protected - needs cookie)
curl http://localhost:3000/api/auth/me \
  -b cookies.txt

# Response:
# {
#   "success": true,
#   "data": {
#     "userId": "507f1f77bcf86cd799439011",
#     "username": "testuser",
#     "email": "test@example.com",
#     "role": "USER"
#   }
# }
```

## 💡 Key Features to Test

### 1. Become a Creator
```bash
curl -X POST http://localhost:3000/api/creators/become-creator \
  -H "Content-Type: application/json" \
  -d '{
    "brandName": "My Stories",
    "bio": "I tell African stories",
    "socialLinks": {
      "twitter": "@mystories",
      "instagram": "@mystories"
    }
  }' \
  -b cookies.txt
```

### 2. Create a Series
```bash
curl -X POST http://localhost:3000/api/series/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My First Series",
    "description": "A gripping tale",
    "coverImage": "https://example.com/cover.jpg",
    "tags": ["drama", "african"],
    "genre": "Drama"
  }' \
  -b cookies.txt
```

### 3. Create an Episode
```bash
curl -X POST http://localhost:3000/api/episodes/series/[SERIES_ID]/create \
  -H "Content-Type: application/json" \
  -d '{
    "episodeNumber": 1,
    "title": "Episode 1: The Beginning",
    "description": "It all started...",
    "mediaUrl": "https://cloudinary.com/video.m3u8",
    "duration": 1800,
    "isFree": false,
    "coinCost": 10,
    "adUnlockable": true
  }' \
  -b cookies.txt
```

### 4. Check Wallet Balance
```bash
curl http://localhost:3000/api/wallet/me/balance \
  -b cookies.txt
```

### 5. Discover Series
```bash
curl "http://localhost:3000/api/series/discover/all?page=1&limit=10"
```

### 6. Search Content
```bash
curl "http://localhost:3000/api/search/global?q=drama&type=series"
```

## 🎬 File Structure

```
/afrostory
├── /public              ← Frontend files go here (next step)
├── /server              ← Backend (current - complete!)
│   ├── server.js        ← Entry point
│   ├── /config          ← 3rd party configs
│   ├── /models          ← 11 database models
│   ├── /routes          ← 14 API modules
│   ├── /middleware      ← Auth protection
│   └── /utils           ← Helpers
├── package.json         ← Dependencies
├── .env                 ← Your secrets (DON'T COMMIT)
└── README.md            ← Full documentation
```

## 🔑 Important Environment Variables

| Variable | Purpose | Where to Get |
|----------|---------|-------------|
| `MONGO_URI` | Database connection | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) |
| `JWT_SECRET` | Token signing key | Generate: `openssl rand -base64 32` |
| `CLOUDINARY_*` | Video hosting | [Cloudinary](https://cloudinary.com) |
| `PAYSTACK_SECRET_KEY` | Payment processing | [Paystack](https://dashboard.paystack.com) |
| `ONESIGNAL_*` | Push notifications | [OneSignal](https://onesignal.com) |

## 🐛 Troubleshooting

### "MongoDB connected" not showing?
- Check `MONGO_URI` in .env
- Ensure IP is whitelisted in MongoDB Atlas
- Verify credentials are correct

### 401 Unauthorized on protected routes?
- Make sure you're sending cookies with `-b cookies.txt`
- Cookie must be in HttpOnly format (automatic)
- JWT might have expired (7 day default)

### "Cloudinary API error"?
- Verify API credentials in .env
- Check Cloudinary dashboard for active account
- Ensure file format is supported

### CORS errors?
- Add your frontend URL to `.env` FRONTEND_URL
- Make sure it matches exactly (protocol, domain, port)

## 📈 Monitor Activity

```bash
# Watch logs in real-time
npm run dev

# Logs show:
# ✅ Route registrations
# ✅ Database connections
# ✅ API requests/responses
# ✅ Errors with full stack traces
```

## ✨ Production Checklist

Before deploying:
- [ ] Change JWT_SECRET to something secure
- [ ] Set NODE_ENV=production
- [ ] Use MongoDB Atlas (not local)
- [ ] Configure real Cloudinary account
- [ ] Set up Paystack production keys
- [ ] Add HTTPS to FRONTEND_URL
- [ ] Enable CORS only for your domain
- [ ] Set all .env variables on deployment platform
- [ ] Test payment flow end-to-end
- [ ] Backup database strategy
- [ ] Monitor logs and errors

## 🎯 Next: Build the Frontend

The backend is complete! Now create:
- `public/index.html` - Login/register page
- `public/app.html` - Main platform SPA
- `public/js/auth.js` - Auth logic
- `public/js/main.js` - App logic
- `public/js/ads.js` - Ad SDK integration
- `public/css/style.css` - Tailwind styles

Frontend will:
1. Load index.html by default
2. User logs in → gets JWT cookie
3. Redirects to app.html
4. Client-side routing (no page reloads)
5. API calls auto-include JWT cookie
6. Lightning-fast SPA experience

## 💬 API Response Format

All API responses follow this format:

```json
{
  "success": true/false,
  "message": "Description",
  "data": {},
  "statusCode": 200
}
```

Error responses:
```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400,
  "details": "Optional error details"
}
```

---

**You now have a production-ready backend! 🎉**

Questions? Check `README.md` for full API documentation.
