const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');

// Make sure to add this to your .env file later!
const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'your_temporary_secret_key';

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-signature'];
        if (!signature) return res.status(401).send('Missing signature');

        const hmac = crypto.createHmac('sha256', secret);
        const digest = Buffer.from(hmac.update(req.body).digest('hex'), 'utf8');
        const signatureBuffer = Buffer.from(signature, 'utf8');

        if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const payload = JSON.parse(req.body.toString());
        const eventName = payload.meta.event_name;
        const obj = payload.data.attributes;

        // This expects you to pass ?custom[clerk_id]=user_123 in your checkout link
        const clerkId = payload.meta.custom_data?.clerk_id;

        if (!clerkId) {
            console.warn('Webhook received but no clerk_id found in custom_data');
            return res.status(200).send('OK');
        }

        if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
            const variantId = obj.variant_id.toString();
            let planName = 'free';

            // Map Lemon Squeezy Variant IDs to Database Plans
            if (variantId === '1526060') {
                planName = 'starter';
            } else if (variantId === '1526083') {
                planName = 'pro';
            } else if (variantId === '1526085') {
                planName = 'agency';
            }

            await User.findOneAndUpdate(
                { clerkId: clerkId },
                {
                    plan: obj.status === 'active' ? planName : 'free',
                    lemonSqueezyCustomerId: obj.customer_id,
                    lemonSqueezySubscriptionId: payload.data.id,
                    lemonSqueezySubscriptionStatus: obj.status
                },
                { upsert: true, new: true }
            );
            console.log(`✅ User ${clerkId} upgraded to ${planName} (Variant: ${variantId})`);
        } else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
            await User.findOneAndUpdate(
                { clerkId: clerkId },
                {
                    plan: 'free',
                    lemonSqueezySubscriptionStatus: obj.status
                },
                { new: true }
            );
            console.log(`🚫 User ${clerkId} subscription cancelled. Downgraded to free plan.`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
