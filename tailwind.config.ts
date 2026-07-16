import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    container: { center: true, padding: '1.5rem' },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        icon: 'hsl(var(--icon-foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'price-up-flash': {
          '0%': { color: 'inherit', transform: 'scale(1)', textShadow: 'none' },
          '25%, 55%': { color: '#f87171', transform: 'scale(1.18)', textShadow: '0 0 14px rgb(248 113 113 / 0.55)' },
          '100%': { color: 'inherit', transform: 'scale(1)', textShadow: 'none' },
        },
        'price-down-flash': {
          '0%': { color: 'inherit', transform: 'scale(1)', textShadow: 'none' },
          '25%, 55%': { color: '#60a5fa', transform: 'scale(1.18)', textShadow: '0 0 14px rgb(96 165 250 / 0.55)' },
          '100%': { color: 'inherit', transform: 'scale(1)', textShadow: 'none' },
        },
        'status-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.75' },
          '80%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
      animation: {
        'price-up-flash': 'price-up-flash 520ms cubic-bezier(.2,.8,.2,1)',
        'price-down-flash': 'price-down-flash 520ms cubic-bezier(.2,.8,.2,1)',
        'status-ping': 'status-ping 1.8s cubic-bezier(0,0,.2,1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
