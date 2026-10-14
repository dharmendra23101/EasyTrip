/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      // Without these, `font-serif` resolved to the generic system serif and the Playfair Display
      // stylesheet the detail page downloaded was never applied — a paid-for request with no
      // visual effect. `font-inter` was worse: an undefined class, so it did nothing at all
      // (IMP-028). Declaring the families here is what makes the loaded fonts reachable.
      // The families are resolved through the CSS variables `next/font` generates in `_app.jsx`
      // (IMP-041) rather than by name. Naming them directly would still work in the browser but
      // only because the fonts happened to be installed or already fetched; the variable points
      // at the self-hosted, build-time file. System stacks stay as the fallback.
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        serif: [
          'var(--font-playfair)',
          'ui-serif',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'serif'
        ]
      },
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          // Darkened from #0284c7 for WCAG AA (IMP-084). `primary-600` is the app's primary button
          // background and its link colour, and white-on-#0284c7 measured 4.10:1 — below the 4.5:1
          // required for normal-size text, so every primary button and every link failed AA.
          // #0277b4 measures 4.88:1 in both directions (white on it, and it as text on white),
          // keeps the same hue, and stays lighter than 700 so the ramp is still monotonic.
          //
          // Fixing the token rather than ~50 call sites means the whole app moves at once and
          // cannot drift back one button at a time.
          600: '#0277b4',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e'
        },
        secondary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a'
        }
      }
    }
  },
  plugins: []
};
