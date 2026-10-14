import Link from 'next/link';

/**
 * The shared button (IMP-028).
 *
 * Before this existed, the same semantic "primary action" rendered as `bg-primary-600 rounded-md`,
 * `bg-blue-600 rounded-lg`, `bg-blue-600 rounded-xl`, `bg-indigo-600 rounded-lg` and
 * `bg-indigo-600 rounded-full` depending on the page — five radius/hue combinations for one role,
 * across three competing brand blues.
 *
 * Renders an `<a>` when given `href` and a `<button>` otherwise, because a control that navigates
 * must be a link (middle-click, open-in-new-tab, and screen-reader semantics all depend on it).
 */

const VARIANTS = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 border border-transparent',
  secondary: 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 border border-transparent',
  ghost: 'bg-transparent text-primary-700 hover:bg-primary-50 border border-transparent'
};

// min-h values keep every size at or above the 44 px touch target on the two that are used on
// mobile (IMP-034). `sm` is deliberately below it and is for desktop-dense admin tables only.
const SIZES = {
  sm: 'text-sm px-3 py-1.5 min-h-[36px]',
  md: 'text-sm px-4 py-2.5 min-h-[44px]',
  lg: 'text-base px-6 py-3 min-h-[48px]'
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  href,
  type = 'button',
  className = '',
  fullWidth = false,
  ...props
}) => {
  const classes = [
    BASE,
    VARIANTS[variant] || VARIANTS.primary,
    SIZES[size] || SIZES.md,
    fullWidth ? 'w-full' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  if (href) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
};

export default Button;
