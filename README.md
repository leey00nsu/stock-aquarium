# KIS Stock Aquarium

한국투자증권(KIS) 형태의 실시간 체결 데이터를 큰 3D 수조 안의 물고기로 표현한 React + React Three Fiber 데모입니다. 기본 실행에서는 MSW의 WebSocket handler가 1초마다 가짜 시세 메시지를 전송합니다.

## 데이터 표현

- 매수 체결: 오른쪽으로 헤엄치는 초록 물고기
- 매도 체결: 왼쪽으로 헤엄치는 빨간 물고기
- 대형 매수·매도: 별도 고래·상어 없이 같은 물고기를 크게 렌더링
- 거래량 급증: 물고기와 수중 입자의 이동 속도 증가
- 변동성 급증: 카메라 흔들림과 수중 폭풍
- 거래정지: 모든 물고기 이동 정지와 얼음 오버레이
- 수조·식물·장식: 업로드된 `Fish Tank.glb`를 고정 배경으로 사용하며 시세에 영향받지 않음

## 사용 모델

```text
public/models/fish-tank.glb  # 큰 수조와 내부 장식
public/models/fish.glb       # 스켈레톤 Swim 애니메이션 물고기
```

물고기 모델의 원본 Swim 애니메이션을 재생하며, 체결 방향에 따라 Body 재질만 매수/매도 색으로 바꿉니다. 대형 체결은 동일 모델의 스케일만 키웁니다.

## 기술 구성

- React 19 + TypeScript + Vite
- React Three Fiber, Drei, Three.js
- MSW 2 WebSocket interception (`ws.link`)
- Zustand
- Kibo UI의 `Ticker`, `Status`, `Pill` 구조
- shadcn/ui CSS 변수 기반의 원본 중립 색상
- Tailwind CSS
- Pretendard Variable CDN

## 실행

```bash
npm install
npm run dev
```

검증:

```bash
npm run lint
npm run build
```

## Mock WebSocket

브라우저는 아래 URL에 WebSocket으로 연결합니다.

```text
/ws/kis/domestic-stock
```

연결 후 구독 메시지를 보냅니다.

```json
{"type":"subscribe","symbol":"005930"}
```

MSW는 1초마다 다음 형태를 전송합니다.

```json
{
  "type": "market",
  "data": {
    "header": {
      "tr_id": "H0STCNT0",
      "tr_key": "005930",
      "sequence": "42",
      "timestamp": "2026-07-16T00:00:00.000Z"
    },
    "body": {
      "output": {
        "stck_shrn_iscd": "005930",
        "hts_kor_isnm": "삼성전자",
        "stck_prpr": "73400",
        "prdy_vrss": "600",
        "prdy_ctrt": "0.82",
        "acml_vol": "12043120",
        "cntg_vol": "140",
        "tday_rltv": "112.4",
        "trht_yn": "N",
        "ccld_dvsn": "1",
        "total_askp_rsqn": "48100",
        "total_bidp_rsqn": "52900"
      }
    }
  }
}
```

## 실제 KIS로 교체

기본 설정:

```env
VITE_ENABLE_MSW=true
```

실제 연동 시:

```env
VITE_ENABLE_MSW=false
VITE_KIS_WS_URL=wss://your-kis-gateway.example.com/ws/kis/domestic-stock
```

브라우저가 KIS에 직접 인증하지 않도록 서버 측 gateway를 두는 구조를 권장합니다. gateway가 실제 KIS WebSocket 체결 메시지를 이 프로젝트의 `KisRealtimeFrame`으로 정규화하면 프론트의 3D·상태 관리 코드는 바꾸지 않아도 됩니다. 정규화 경계는 `src/api/kis/client.ts`입니다.

## 주요 디렉터리

```text
src/
  api/kis/          # WebSocket URL, KIS 형태 타입, 도메인 변환
  mocks/            # MSW WebSocket handler와 가짜 시장 상태
  components/
    aquarium/       # R3F 수조, GLB 물고기, 해류와 폭풍
    kibo-ui/        # Kibo UI 기반 composable UI
    ui/             # shadcn 호환 기본 UI
  store/            # 시장 상태와 물고기 큐
public/models/      # 업로드된 GLB 모델
```

## 자산

GLB 파일은 사용자가 업로드한 자산을 그대로 포함합니다. 배포 전에 원본 모델의 라이선스 조건을 확인하세요.
