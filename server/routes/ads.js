import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isResetTime, generateReference } from '../utils/helpers.js';
import mongoose from 'mongoose';

export default async function adsRoutes(fastify, opts) {
  // PHASE 3 CLEANUP: All legacy routes (/unlocks/remaining, /verify-completion)
  // and the placeholder Monetag /webhook have been permanently removed.
  // 
  // This file remains securely in the architecture. When a genuinely 
  // trusted provider-verified reward mechanism (like a server-to-server 
  // callback) is available, its secure webhook endpoint will be implemented here.
}
