const cookie = require('cookie');

const REFERRAL_COOKIE_NAME = 'referral_code';
const MAX_AGE_DAYS = 90;

function referralHandler(req, res, next) {
  let referralCode = null;

  // 1. Check for /ref/:code or /:spell/ref/:code
  const pathParts = req.path.split('/').filter(p => p);
  const refIndex = pathParts.indexOf('ref');

  if (refIndex !== -1 && refIndex + 1 < pathParts.length) {
    referralCode = pathParts[refIndex + 1];
    
    // Clean the URL by redirecting
    const originalPath = req.path;
    const newPath = originalPath.substring(0, originalPath.indexOf('/ref/'));
    
    res.cookie(REFERRAL_COOKIE_NAME, referralCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // 90 days
      sameSite: 'lax'
    });
    
    return res.redirect(newPath || '/');
  }

  // 2. Check for query parameter ?ref=code
  if (req.query.ref) {
    referralCode = req.query.ref;
  }

  // If a referral code is found from any source, set it in the cookie
  if (referralCode) {
    res.cookie(REFERRAL_COOKIE_NAME, referralCode, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // 90 days
      sameSite: 'lax'
    });
  }

  next();
}

module.exports = {
  referralHandler
}; 