const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { handleValidationErrors } = require('../utils/errorHandler');
const newsletterController = require('../controllers/newsletterController');

const subscribeRules = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .bail()
    .isEmail()
    .withMessage('Please enter a valid email address')
    .bail()
    // Below the column's VARCHAR(255) so an over-long address is a 400 rather than a database error.
    .isLength({ max: 254 })
    .withMessage('Email must be at most 254 characters')
    // Only case-folds the domain and strips nothing else. Full normalisation would collapse
    // Gmail dot-aliases, which are different addresses as far as a subscriber is concerned.
    .normalizeEmail({
      all_lowercase: true,
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    }),
  body('source')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Source must be text')
    .bail()
    .trim()
    .isLength({ max: 40 })
    .withMessage('Source must be at most 40 characters')
];

// Public: subscribing cannot require an account, since the footer form is on every page including
// the ones signed-out visitors see. Abuse is bounded by the newsletter rate limiter in app.js.
router.post('/', subscribeRules, handleValidationErrors, newsletterController.subscribe);

module.exports = router;
