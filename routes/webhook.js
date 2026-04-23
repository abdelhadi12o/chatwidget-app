const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');

const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-signature'];
        if (!signature) {
            console.error('Missing x-signature header');
            return res.status(401).send('Missing signature');
        }

        // req.body MUST be a raw Buffer for signature verification to work
        if (!Buffer.isBuffer(req.body)) {
            console.error('[Webhook] req.body is not a Buffer - body was parsed by middleware before reaching webhook route');
            return res.status(500).json({ error: 'Internal server error' });
        }

        // Calculate HMAC unconditionally to prevent timing attacks
        // Use a dummy secret if the real one is missing so the math takes the same time
        const hmacSecret = secret || 'dummy_timing_secret';
        const hmac = crypto.createHmac('sha256', hmacSecret);
        hmac.update(req.body);
        const digest = hmac.digest('hex');

        // Check for missing secret AFTER HMAC calculation to equalize response times
        if (!secret) {
            console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment');
            return res.status(500).json({ error: 'Internal server error' });
        }

        const expectedBuf = Buffer.from(digest || '', 'hex');
        const providedBuf = Buffer.from(signature || '', 'hex');

        // Hash both buffers to guarantee identical lengths for timingSafeEqual
        // This completely masks the original length and prevents timing leaks
        const expectedHash = crypto.createHash('sha256').update(expectedBuf).digest();
        const providedHash = crypto.createHash('sha256').update(providedBuf).digest();

        if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
            return res.status(401).json({ error: 'Invalid webhook signature' });
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
            if (variantId === '1565069') {
                planName = 'starter';
            } else if (variantId === '1565060') {
                planName = 'pro';
            } else if (variantId === '1565070') {
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
        console.error('Webhook Error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
