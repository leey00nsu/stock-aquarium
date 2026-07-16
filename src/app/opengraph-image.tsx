import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

export const alt = 'Stock Aquarium — 실시간 주식 체결을 물고기로 시각화';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'nodejs';

export default async function OpenGraphImage() {
  const [icon, pretendard] = await Promise.all([
    readFile(new URL('./icon.png', import.meta.url)),
    readFile(new URL('./fonts/Pretendard-Bold.otf', import.meta.url)),
  ]);
  const iconSource = `data:image/png;base64,${icon.toString('base64')}`;
  const fontData = pretendard.buffer.slice(
    pretendard.byteOffset,
    pretendard.byteOffset + pretendard.byteLength,
  ) as ArrayBuffer;

  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: 'radial-gradient(circle at 28% 20%, #123b69 0%, #071b39 42%, #030b18 100%)',
        color: '#f8fafc',
        display: 'flex',
        fontFamily: 'Pretendard',
        height: '100%',
        padding: '72px 86px',
        width: '100%',
      }}
    >
      <img
        alt=""
        height={330}
        src={iconSource}
        style={{ borderRadius: '76px', boxShadow: '0 28px 70px rgba(0,0,0,.42)' }}
        width={330}
      />
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: '68px' }}>
        <div style={{ color: '#7dd3fc', fontSize: 28, fontWeight: 700, letterSpacing: '0.16em' }}>
          LIVE MARKET VISUALIZATION
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-0.04em', marginTop: '18px' }}>
          Stock Aquarium
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: 'Pretendard', data: fontData, style: 'normal', weight: 700 }],
    },
  );
}
