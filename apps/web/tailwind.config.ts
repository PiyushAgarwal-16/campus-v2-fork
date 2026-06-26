import type { Config } from 'tailwindcss';

/**
 * Tailwind design tokens — the single mapping of UI_GUIDELINES.md to code.
 * Colors are driven by CSS variables (see styles/globals.css) so the theme
 * inverts by swapping variable values only; structure never changes (§4).
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand (§3) — Orange is constant across themes.
        brand: {
          DEFAULT: '#F97316',
          foreground: '#FFFFFF',
        },
        // Semantic tokens map to CSS variables (light/dark values in globals.css).
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        surface: 'hsl(var(--surface) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        divider: 'hsl(var(--divider) / <alpha-value>)',
        disabled: 'hsl(var(--disabled) / <alpha-value>)',
        // Semantic states (§3) — constant across themes.
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Typography scale (§5).
        h1: ['1.875rem', { lineHeight: '1.2', fontWeight: '700' }],
        h2: ['1.5rem', { lineHeight: '1.25', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['1rem', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['0.875rem', { lineHeight: '1.4', fontWeight: '400' }],
        small: ['0.75rem', { lineHeight: '1.3', fontWeight: '500' }],
      },
      borderRadius: {
        // Corner radius scale (§7): 6–8–12–16.
        tooltip: '6px',
        button: '8px',
        input: '8px',
        card: '12px',
        dialog: '16px',
      },
      spacing: {
        // 8-point grid (§6) — named tokens alongside Tailwind's default scale.
        'space-1': '4px',
        'space-2': '8px',
        'space-3': '12px',
        'space-4': '16px',
        'space-5': '20px',
        'space-6': '24px',
        'space-8': '32px',
        'space-12': '48px',
        'space-16': '64px',
      },
    },
  },
  plugins: [],
};

export default config;
