export const SITE_NAME = 'Stock Aquarium';
export const SITE_DESCRIPTION = '국내·미국 주식의 실시간 체결 흐름을 3D 물고기와 최근 매수·매도 체결 비율로 탐색하는 시장 데이터 시각화 서비스입니다.';

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_URL = new URL(
  configuredSiteUrl && /^https?:\/\//.test(configuredSiteUrl)
    ? configuredSiteUrl
    : 'http://localhost:3000',
);
