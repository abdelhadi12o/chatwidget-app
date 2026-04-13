const User = require('../models/User');

// Plan Limits Configuration
const PLAN_LIMITS = {
    free: { maxBots: 10, maxMessages: 20000 }, // Trial: same limits as Agency for 7 days
    starter: { maxBots: 1, maxMessages: 1000 },
    pro: { maxBots: 3, maxMessages: 5000 },
    agency: { maxBots: 10, maxMessages: 20000 }
};

const checkSubscription = async (req, res, next) => {
    try {
        // Assume req.auth.userId contains the Clerk ID from the Clerk middleware
        const clerkId = req.auth?.userId || req.user?.clerkId;
        if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

        // 1. Find or Create User
        let user = await User.findOne({ clerkId });
        if (!user) {
            user = await User.create({ clerkId });
        }

        // 2. Attach user and limits to request
        req.dbUser = user;
        req.planLimits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

        // 3. The 7-Day Trial Lockout Logic
        if (user.plan === 'free') {
            const isTrialExpired = Date.now() > new Date(user.trialEndsAt).getTime();
            if (isTrialExpired) {
                return res.status(403).json({
                    error: 'TRIAL_EXPIRED',
                    message: 'Your 7-day free trial has expired. Please upgrade your plan to continue using Ultramora.'
                });
            }
        }

        // 4. If Pro/Agency, or Trial is still active, let them pass
        next();
    } catch (error) {
        console.error('Subscription Middleware Error:', error);
        res.status(500).json({ error: 'Server error checking subscription status' });
    }
};

module.exports = { checkSubscription, PLAN_LIMITS };
