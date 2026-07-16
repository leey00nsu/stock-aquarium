# KIS Stock Aquarium

한국투자증권(KIS) 실시간 체결 데이터를 큰 3D 수조 안의 물고기로 표현한 Next.js + React Three Fiber 애플리케이션입니다. KIS App Key와 App Secret은 Next.js 서버에서만 사용하며 브라우저 번들에는 포함하지 않습니다. 기본 실행에서는 Next.js 서버가 1초마다 KIS 형태의 목 시세를 전송합니다.

## 데이터 표현

- 매수 체결: 오른쪽으로 헤엄치는 빨간 물고기
- 매도 체결: 왼쪽으로 헤엄치는 파란 물고기
- 체결 규모: 종목별 최근 40개 체결량의 백분위에 따라 같은 물고기를 0.6~2.5배로 렌더링
- 급격한 체결 증가: 250ms 동안 매수·매도 체결을 각각 합산하고 초당 최대 10마리만 생성
- 렌더링 상한: 80마리 고정 객체 풀을 재사용하며, 풀이 가득 차면 같은 방향 체결을 합산해 대기
- 거래량 급증: 물고기와 수중 입자의 이동 속도 증가
- 변동성 급증: 카메라 흔들림과 수중 폭풍
- 거래정지: 모든 물고기 이동 정지와 얼음 오버레이
- 수조·식물·장식: 업로드된 `Fish Tank.glb`를 고정 배경으로 사용하며 시세에 영향받지 않음

## 사용 모델

```text
public/models/fish-tank.glb  # 큰 수조와 내부 장식
public/models/fish.glb       # 스켈레톤 Swim 애니메이션 물고기
```

물고기 모델의 원본 Swim 애니메이션을 재생하며, 체결 방향에 따라 Body 재질만 매수/매도 색으로 바꿉니다. 체결량은 종목별 최근 분포 안에서 비교하므로 유동성이 다른 종목도 일관된 크기 범위로 표현됩니다.

물고기는 생성될 때마다 GLB를 복제하지 않습니다. 시작 시 80개를 준비해 재사용하고, 모든 이동과 애니메이션 믹서는 하나의 프레임 루프에서 갱신합니다. 순간 체결이 생성 한도를 넘으면 데이터를 버리지 않고 매수·매도 방향별 수량과 체결 횟수로 합쳐 다음 빈 물고기에 반영합니다. 화면 경계를 벗어난 물고기만 풀로 반환합니다.

## 기술 구성

- Next.js 16 App Router + React 19 + TypeScript
- React Three Fiber, Drei, Three.js
- Next.js Route Handler + Server-Sent Events
- 서버 전용 단일 KIS WebSocket 게이트웨이와 SSE 팬아웃
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

## 환경 설정

`.env.example`을 `.env.local`로 복사합니다.

```bash
cp .env.example .env.local
```

기본 목 데이터:

```env
KIS_ENABLE_MOCK=true
```

실제 KIS 실전투자 데이터:

```env
KIS_ENABLE_MOCK=false
KIS_ENV=prod
KIS_APP_KEY=발급받은_앱키
KIS_APP_SECRET=발급받은_앱시크릿
```

모의투자는 `KIS_ENV=vps`로 변경하고 모의투자용 App Key와 App Secret을 입력합니다. `KIS_` 환경변수는 서버 전용입니다. 키 이름에 `NEXT_PUBLIC_`을 붙이면 브라우저에 노출되므로 사용하지 마세요.

실시간 스트림은 장시간 연결을 유지하므로 정적 호스팅이 아닌 Node.js 서버 또는 컨테이너 환경에서 `npm run build && npm run start`로 운영해야 합니다.

## 실시간 데이터 흐름

브라우저는 같은 출처의 SSE Route Handler를 구독합니다.

```text
GET /api/kis/stream?symbol=005930
```

서버는 목 데이터를 생성하거나, 실제 KIS WebSocket의 국내주식 실시간 체결가 `H0STCNT0`을 구독한 뒤 프론트가 사용하는 형태로 정규화합니다. 한 서버 프로세스에서 KIS WebSocket은 하나만 열고, 종목별 체결을 모든 SSE 접속자에게 재배포합니다. 같은 종목을 100명이 보고 있어도 KIS 구독은 한 건입니다.

구독·해지 명령은 150ms 간격으로 순차 전송하며, KIS 연결이 끊기면 지수 백오프로 재연결한 뒤 현재 사용자가 보고 있는 종목만 다시 구독합니다. SSE 연결에는 15초마다 keep-alive를 전송합니다. 운영 상태는 키나 인증 정보를 노출하지 않는 다음 API로 확인할 수 있습니다.

```text
GET /api/kis/status
```

## 서비스 종목 41개와 캐시

서버는 KIS 공식 KOSPI·KOSDAQ·KONEX 종목 마스터 ZIP을 내려받아 종목명, 코드, 전일 시가총액을 구성합니다. 이 중 주식(`ST`)이며 우선주가 아닌 종목을 시가총액 순으로 정렬해 상위 41개만 서비스합니다. 순위는 마스터 캐시가 갱신될 때 자동으로 바뀝니다. 종목 검색은 이 41개 안에서만 동작합니다.

```text
GET /api/stocks?q=삼성전자&limit=50
```

마스터 목록은 두 단계로 캐시합니다.

1. 서버 메모리에 24시간 보관하여 검색, 상위 41개 계산과 종목 검증에 즉시 사용합니다.
2. `.cache/kis-stocks.json`에도 저장하여 서버 재시작 후 다시 다운로드하지 않습니다.

캐시가 만료되면 세 마스터 파일을 한 번만 병렬로 갱신합니다. 동시에 여러 요청이 와도 같은 갱신 작업을 공유하며, 다운로드가 실패하면 기존 디스크 캐시를 계속 사용하고 5분 후 다시 시도합니다. 실시간 스트림은 요청된 종목이 현재 상위 41개 안에 있을 때만 KIS 구독을 시작하므로 한 앱키의 실시간 등록 한도를 넘지 않습니다.

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

## 주요 디렉터리

```text
src/
  app/              # Next.js 페이지와 KIS SSE Route Handler
  api/kis/          # 브라우저 스트림 클라이언트와 데이터 변환
  server/kis/       # 서버 전용 인증, KIS WebSocket 연결과 파싱
  mocks/            # 서버에서 사용하는 가짜 시장 상태
  components/
    aquarium/       # R3F 수조, GLB 물고기, 해류와 폭풍
    kibo-ui/        # Kibo UI 기반 composable UI
    ui/             # shadcn 호환 기본 UI
  store/            # 시장 상태와 물고기 큐
public/models/      # 업로드된 GLB 모델
```

## 자산

GLB 파일은 사용자가 업로드한 자산을 그대로 포함합니다. 배포 전에 원본 모델의 라이선스 조건을 확인하세요.
