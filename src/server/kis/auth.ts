import 'server-only';

export type KisEnvironment = 'prod' | 'vps';

const REST_URLS: Record<KisEnvironment, string> = {
  prod: 'https://openapi.koreainvestment.com:9443',
  vps: 'https://openapivts.koreainvestment.com:29443',
};

let accessTokenCache: { token: string; expiresAt: number } | null = null;
let accessTokenRequest: Promise<string> | null = null;
let approvalKeyCache: { key: string; expiresAt: number } | null = null;
let approvalKeyRequest: Promise<string> | null = null;

export function getKisEnvironment(): KisEnvironment {
  return process.env.KIS_ENV === 'vps' ? 'vps' : 'prod';
}

export function getKisRestUrl() {
  return REST_URLS[getKisEnvironment()];
}

export function getKisCredentials() {
  const appkey = process.env.KIS_APP_KEY?.trim();
  const appsecret = process.env.KIS_APP_SECRET?.trim();
  if (!appkey || !appsecret) {
    throw new Error('KIS_APP_KEY와 KIS_APP_SECRET을 서버 환경변수에 설정해 주세요.');
  }
  return { appkey, appsecret };
}

async function requestAccessToken() {
  const { appkey, appsecret } = getKisCredentials();
  const response = await fetch(`${getKisRestUrl()}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, appsecret }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`KIS 접근토큰 발급에 실패했습니다. (${response.status})`);
  }
  const ttl = Math.min(Number(body.expires_in) || 86_400, 23 * 60 * 60);
  accessTokenCache = { token: body.access_token, expiresAt: Date.now() + ttl * 1_000 };
  return body.access_token;
}

export function getKisAccessToken() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return Promise.resolve(accessTokenCache.token);
  }
  accessTokenRequest ??= requestAccessToken().finally(() => {
    accessTokenRequest = null;
  });
  return accessTokenRequest;
}

async function requestApprovalKey() {
  const { appkey, appsecret } = getKisCredentials();
  const response = await fetch(`${getKisRestUrl()}/oauth2/Approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain', charset: 'UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, secretkey: appsecret }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = JSON.parse(responseText) as { error_description?: string; message?: string; msg1?: string };
      detail = errorBody.msg1 || errorBody.message || errorBody.error_description || '';
    } catch {
      detail = '';
    }
    throw new Error(`KIS WebSocket 접속키 발급에 실패했습니다. (${response.status}${detail ? `: ${detail}` : ''})`);
  }
  const body = JSON.parse(responseText) as { approval_key?: string };
  if (!body.approval_key) throw new Error('KIS 응답에 WebSocket 접속키가 없습니다.');
  approvalKeyCache = { key: body.approval_key, expiresAt: Date.now() + 23 * 60 * 60 * 1_000 };
  return body.approval_key;
}

export function getKisApprovalKey() {
  if (approvalKeyCache && approvalKeyCache.expiresAt > Date.now()) {
    return Promise.resolve(approvalKeyCache.key);
  }
  approvalKeyRequest ??= requestApprovalKey().finally(() => {
    approvalKeyRequest = null;
  });
  return approvalKeyRequest;
}
