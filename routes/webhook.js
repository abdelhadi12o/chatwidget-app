const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');

const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        if (!secret) {
            console.error('LEMON_SQUEEZY_WEBHOOK_SECRET is not set in environment');
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-signature'];
        if (!signature) {
            console.error('Missing x-signature header');
            return res.status(401).send('Missing signature');
        }

        // req.body MUST be a raw Buffer for signature verification to work
        if (!Buffer.isBuffer(req.body)) {
            console.error('[Webhook] req.body is not a Buffer - body was parsed by middleware before reaching webhook route');
            return res.status(500).json({ error: 'Server configuration error - body already parsed' });
        }

        // Verify signature using raw body buffer
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(req.body);
        const digest = hmac.digest('hex');

        // Use timing-safe comparison
        const digestBuffer = Buffer.from(digest, 'utf8');
        const signatureBuffer = Buffer.from(signature, 'utf8');

        if (digestBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
            console.error('Signature mismatch: Invalid webhook signature');
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
