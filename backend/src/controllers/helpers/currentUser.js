/** The verified caller, as attached by the auth middleware. */
const getCurrentUser = (req) => {
  return req.user?.uid || 'anonymous_user';
};

const getCurrentUserName = (req) => {
  return req.user?.name || 'Anonymous User';
};

// Public review payloads must not carry Firebase uids or email addresses (SECURITY_AUDIT M7).
// The author id is a stable digest scoped to one place, so a user's reviews can still be
// correlated within that place without publishing the identifier auth accepts.

module.exports = { getCurrentUser, getCurrentUserName };
