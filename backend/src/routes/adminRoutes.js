const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { isAdmin } = require('../utils/authMiddleware');
const { handleValidationErrors } = require('../utils/errorHandler');
const { getAllAdmins, addAdmin, removeAdmin } = require('../controllers/adminController');
const { listReports, resolveReports } = require('../controllers/moderationController');
const { getAnalytics } = require('../controllers/analyticsController');
const { listAuditEntries } = require('../controllers/auditController');
const { STATUSES, RESOLUTIONS, MAX_LIMIT } = require('../models/moderationModel');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { MAX_LIMIT: AUDIT_MAX_LIMIT } = require('../models/auditModel');

// Place CRUD is registered once, in placeRoutes.js. It used to be declared here as
// well, with a different multer storage engine, and only the `/api` mount order in
// app.js decided which one ran.

// Admin management routes
router.get('/admins', isAdmin, getAllAdmins);
router.post(
  '/admins',
  isAdmin,
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid email address is required')
    .bail()
    .isLength({ max: 254 })
    .withMessage('Email must be at most 254 characters'),
  handleValidationErrors,
  addAdmin
);
router.delete(
  '/admins/:email',
  isAdmin,
  param('email').trim().isEmail().withMessage('A valid email address is required'),
  handleValidationErrors,
  removeAdmin
);

// ---------------------------------------------------------------------------
// Review moderation (IMP-111, ADR-036)
// ---------------------------------------------------------------------------
// `review_reports` has been written to since IMP-019 and read by nothing. These are the consumer
// that makes the report button's "this has been reported for moderation" true.
//
// Deliberately NOT here: a route that deletes a review. Removal goes through the existing
// `DELETE /api/places/:id/reviews/:reviewId`, which now allows admins — one delete path, as
// IMP-117 insisted, rather than two statements that must agree about cascades forever.
router.get(
  '/reports',
  isAdmin,
  [
    query('status')
      .optional({ values: 'falsy' })
      .isIn(STATUSES)
      .withMessage(`status must be one of: ${STATUSES.join(', ')}`),
    query('limit')
      .optional({ values: 'falsy' })
      .isInt({ min: 1, max: MAX_LIMIT })
      .withMessage(`limit must be between 1 and ${MAX_LIMIT}`),
    query('offset').optional({ values: 'falsy' }).isInt({ min: 0 })
  ],
  handleValidationErrors,
  listReports
);

router.patch(
  '/reports/reviews/:reviewId',
  isAdmin,
  [
    param('reviewId').isInt({ min: 1 }).withMessage('Review id must be a positive integer'),
    // Enumerated from the model, so a resolution the database's CHECK constraint would reject
    // cannot pass validation here. `open` is deliberately absent: this endpoint resolves, and
    // re-opening a handled report is a different action nobody has asked for.
    body('resolution')
      .exists({ values: 'falsy' })
      .withMessage('resolution is required')
      .bail()
      .isIn(RESOLUTIONS)
      .withMessage(`resolution must be one of: ${RESOLUTIONS.join(', ')}`)
  ],
  handleValidationErrors,
  resolveReports
);

// ---------------------------------------------------------------------------
// Analytics (IMP-111, ADR-037)
// ---------------------------------------------------------------------------
router.get(
  '/analytics',
  isAdmin,
  query('days')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 90 })
    .withMessage('days must be between 1 and 90'),
  handleValidationErrors,
  getAnalytics
);

// ---------------------------------------------------------------------------
// Audit log (PE-013, ADR-056)
// ---------------------------------------------------------------------------
// The reader `ADR-022` required before this table was allowed to be created. Read-only on purpose:
// there is no route that edits or deletes an entry, because an audit trail an admin can rewrite
// records nothing. Rows leave only by a retention policy, which does not exist yet and whose
// trigger is a real deployment.
router.get(
  '/audit',
  isAdmin,
  [
    query('action')
      .optional({ values: 'falsy' })
      .isIn(AUDIT_ACTIONS)
      .withMessage(`action must be one of: ${AUDIT_ACTIONS.join(', ')}`),
    query('limit')
      .optional({ values: 'falsy' })
      .isInt({ min: 1, max: AUDIT_MAX_LIMIT })
      .withMessage(`limit must be between 1 and ${AUDIT_MAX_LIMIT}`),
    query('offset').optional({ values: 'falsy' }).isInt({ min: 0 })
  ],
  handleValidationErrors,
  listAuditEntries
);

module.exports = router;
