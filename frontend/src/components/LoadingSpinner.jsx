import React from 'react';

const LoadingSpinner = ({ size = 'medium', color = 'primary' }) => {
  // Size classes
  const sizeClasses = {
    small: 'w-6 h-6 border-2',
    medium: 'w-10 h-10 border-3',
    large: 'w-16 h-16 border-4'
  };

  // Color classes
  const colorClasses = {
    primary: 'border-primary-500 border-t-transparent',
    white: 'border-white border-t-transparent',
    gray: 'border-gray-300 border-t-transparent'
  };

  // An unrecognised colour used to produce `undefined` in the class string, so the element rendered
  // with no border at all — an invisible spinner rather than a broken-looking one, which is why it
  // went unnoticed (IMP-032). Falling back to `primary` means a typo degrades to a visible spinner.
  const sizeClass = sizeClasses[size] || sizeClasses.medium;
  const colorClass = colorClasses[color] || colorClasses.primary;

  return (
    <div
      className={`${sizeClass} ${colorClass} rounded-full animate-spin`}
      role="status"
      aria-label="Loading"
    ></div>
  );
};

export default LoadingSpinner;
