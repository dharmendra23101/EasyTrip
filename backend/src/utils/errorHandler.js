const { validationResult } = require('express-validator');
const logger = require('./logger');
const { poolStats, isConnectionTimeout } = require('../config/db');

/**
 * Normalizes an express-validator error into { field, message }.
 * Submitted values are deliberately not echoed back.
 */
const toFieldError = (error) => ({
  field: error.path || error.param || error.type || 'body',
  message: error.msg
});

/**
 * Route middleware: short-circuits to 400 with a structured field-error list
 * when any express-validator chain on the route failed.
 */
const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  res.status(400).json({
    message: 'Validation failed',
    errors: result.array({ onlyFirstError: true }).map(toFieldError)
  });
};

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  // A pool timeout is annotated with the pool's occupancy (`FV-021`). Without it the line reads
  // "timeout exceeded when trying to connect" — which is the same sentence whether the database is
  // unreachable, cold-starting, or healthy and simply out of connections. `waiting > 0` is what
  // separates the third case from the first two, and it is only knowable at the moment it happens.
  if (isConnectionTimeout(err)) {
    logger.error(
      { err, pool: poolStats() },
      'Database connection timed out — pool occupancy attached'
    );
  } else {
    logger.error({ err }, 'Unhandled error reached the error handler');
  }

  // Handle Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File is too large. Maximum size is 5MB' });
    }
    return res.status(400).json({ message: 'Error uploading file', error: err.message });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  // Default error response.
  // Only an error that deliberately carries a client-facing 4xx status is safe to echo.
  // Anything else is unexpected — a pg failure, say — and its message names tables,
  // columns and constraints, which is reconnaissance material (SECURITY_AUDIT 10.4).
  // The full error is already on the server log above.
  const status = Number.isInteger(err.status) ? err.status : 500;
  const isClientError = status >= 400 && status < 500;

  res.status(status).json({
    message: isClientError && err.message ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { error: err.message } : {}),
    timestamp: new Date().toISOString()
  });
};

module.exports = { errorHandler, handleValidationErrors };
