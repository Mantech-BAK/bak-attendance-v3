import colors from 'tailwindcss/colors';

// The one app palette (2026-09-24). Pages should reach for these semantic
// names (via the shared Button / Badge / Alert styles in components/ui.tsx),
// not pick a raw colour ad hoc:
//   brand    (teal)    primary actions, active nav, focus rings, links
//   success  (emerald) approved / completed / saved
//   warning  (amber)  pending / needs attention
//   danger   (rose)   errors, rejected, destructive actions
//   info     (sky)    neutral informational highlights
//   slate             all text, borders, surfaces, and disabled states
// No other hue (violet, purple, pink, indigo, ...) is part of the palette.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: colors.teal,
        success: colors.emerald,
        warning: colors.amber,
        danger: colors.rose,
        info: colors.sky,
      },
    },
  },
  plugins: [],
};
