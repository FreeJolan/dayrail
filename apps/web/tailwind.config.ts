import type { Config } from 'tailwindcss';
import dayrailPreset from '@dayrail/ui/tailwind-preset';

export default {
  presets: [dayrailPreset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
