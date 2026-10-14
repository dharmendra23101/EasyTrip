/** Static content and animation variants for the landing page. */

/**
 * Slide transition. `direction` is passed as the custom prop so enter and exit mirror each other:
 * a forward move enters from the right and exits left, a backward move the reverse.
 */
export const CAROUSEL_VARIANTS = {
  enter: (direction) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0
  }),
  center: {
    x: 0,
    opacity: 1
  },
  exit: (direction) => ({
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0
  })
};

/**
 * Category tile backgrounds, indexed by position.
 *
 * Written out in full rather than composed from a colour name, because Tailwind's JIT scanner
 * reads source text: `from-${color}-500` generates nothing at all. The same mistake was fixed in
 * the share menu (IMP-079).
 */
export const CATEGORY_GRADIENTS = [
  'bg-gradient-to-br from-orange-500 to-red-500',
  'bg-gradient-to-br from-purple-500 to-pink-500',
  'bg-gradient-to-br from-pink-500 to-rose-500',
  'bg-gradient-to-br from-green-500 to-emerald-500',
  'bg-gradient-to-br from-blue-500 to-indigo-500',
  'bg-gradient-to-br from-yellow-500 to-orange-500',
  'bg-gradient-to-br from-gray-600 to-gray-800',
  'bg-gradient-to-br from-cyan-500 to-blue-500'
];
