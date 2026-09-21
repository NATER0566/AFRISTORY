# AFROSTORY - Enterprise Digital Storytelling Platform

A production-ready digital storytelling and video streaming platform built with Fastify, MongoDB, and Vanilla JavaScript.

## 🎯 Core Features

*   **User Authentication:** Secure JWT-based authentication with HttpOnly cookies
*   **Creator Studio:** Upload and manage video series and episodes
*   **Monetization & Access:**
    *   **Premium Coins:** Purchase coins via Paystack for episode access
    *   **VIP Subscriptions:** Premium tier access (VIP, GOLD) for unlimited streaming
    *   **Sponsored Messages:** Adscod display advertising network integration
*   **Video Streaming:** HLS streaming via Cloudinary CDN with secure authoritative endpoints
*   **Watch History:** Track watch progress and completion
*   **Comments & Engagement:** Series and episode discussions
*   **Admin Dashboard:** Moderation, analytics, and user management
*   **Push Notifications:** OneSignal integration for real-time updates

## 🛠️ Technology Stack

*   **Backend:** Node.js 20, Fastify 4
*   **Database:** MongoDB Atlas + Mongoose ODM
*   **Authentication:** JWT, bcryptjs
*   **Payments:** Paystack API
*   **Media:** Cloudinary (HLS video streaming)
*   **Notifications:** OneSignal
*   **Frontend:** Vanilla JavaScript, HTML5, CSS3 (Tailwind)

## 📋 Prerequisites

*   Node.js 20+
*   MongoDB Atlas account and cluster
*   Paystack account (for payments)
*   Cloudinary account (for video/image hosting)
*   OneSignal account (for push notifications)
*   Adscod account (for platform advertising)

## ⚙️ Environment Setup

1. Clone the repository:
```bash
git clone <repo-url>
cd afrostory
