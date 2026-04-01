const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

// Clerk's middleware automatically reads the token from the frontend,
// verifies it cryptographically, and extracts the user data.
const requireAuth = ClerkExpressRequireAuth({
  // This catches errors (like missing tokens) and sends a clean JSON response
  onError: (err, req, res, next) => {
    console.error("Auth Error:", err.message);
    return res.status(401).json({ error: 'Unauthorized: Please log in again.' });
  }
});

module.exports = requireAuth;
