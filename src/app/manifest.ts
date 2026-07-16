import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#14181d',
    theme_color: '#071b39',
    lang: 'ko-KR',
    icons: [{
      src: '/stock-aquarium-icon.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    }],
  };
}
