const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');

// Make sure to add this to your .env file later!
const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'your_temporary_secret_key';

router.post('/lemon-squeezy', express.raw({ type: 'application/json' }), async (req, res) => {
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
            // Map Lemon Squeezy variant IDs to plan names
            // TODO: Replace with your actual Lemon Squeezy variant IDs
            const variantId = obj.variant_id.toString();
            const variantToPlan = {
                // 'your_starter_variant_id': 'starter',
                // 'your_pro_variant_id': 'pro',
                // 'your_agency_variant_id': 'agency',
            };
            let planName = variantToPlan[variantId] || 'pro'; // Default to pro if variant unknown

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
            console.log(`✅ User ${clerkId} upgraded to ${planName}`);
        } else if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
            await User.findOneAndUpdate(
                { clerkId: clerkId },
                { plan: 'free', lemonSqueezySubscriptionStatus: obj.status }
            );
            console.log(`❌ User ${clerkId} downgraded to free (trial expired)`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
