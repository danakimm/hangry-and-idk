# 오늘 뭐 먹지? — 메뉴 룰렛

메뉴 룰렛을 돌리고 현재 위치 주변의 식당을 검색하는 토이 프로젝트입니다.

- 운영 주소: <https://hangry-and-idk.site>
- 로그인: Firebase Authentication의 Google 로그인
- 실행 환경: vinext 기반 Cloudflare Workers

## 주요 기능

- 기본 메뉴 및 직접 추가한 메뉴로 룰렛 실행
- 브라우저 위치 정보를 이용한 주변 식당 검색
- Firebase Google 로그인과 자체 `HttpOnly` 세션 쿠키
- 로그인 사용자별 식당 검색 Rate Limit(30회/60초)
- 좌표 정규화 기반 5분 Cloudflare Edge 캐시
- Cloudflare WAF를 설정한 경우 IP 기반 짧은 burst 1차 차단

## 사전 준비

- Node.js `>=22.13.0`
- npm
- X.509 인증 테스트 실행을 위한 OpenSSL
- Firebase 프로젝트와 Web App
- Kakao Developers 애플리케이션
- 배포 시 Cloudflare 계정과 Wrangler 로그인

## 설치

```bash
npm install
```

로그인과 식당 검색을 사용하려면 아래 환경 설정을 먼저 완료해야 합니다.

## Firebase Console 설정

### 1. Web App 등록

Firebase Console에서 **Project Settings → Your Apps → Web(`</>`)**을 선택해 Web App을 등록합니다.

### 2. Google 로그인 활성화

**Authentication → Sign-in method → Google**에서 Google 공급자를 활성화합니다.

### 3. Authorized domains 등록

**Authentication → Settings → Authorized domains**에 다음 도메인을 등록합니다.

- 운영: `hangry-and-idk.site`
- 로컬 로그인 테스트 시: `localhost`

Firebase Admin SDK와 서비스 계정 키는 사용하지 않습니다.

## 환경변수

### 브라우저 공개 설정

프로젝트 루트의 `.env.local`에 다음 값을 설정합니다. 이 값들은 브라우저 빌드에 포함되는 공개 설정이며, `AUTH_SESSION_SECRET`이나 Kakao REST API 키를 이 파일에 넣지 않습니다.

```env
NEXT_PUBLIC_FIREBASE_API_KEY=<Firebase Web App apiKey>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>
NEXT_PUBLIC_FIREBASE_APP_ID=<Firebase Web App appId>
NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY=<Kakao JavaScript key>
```

`NEXT_PUBLIC_*` 값은 빌드 시점에 필요합니다. 값을 변경한 뒤에는 다시 빌드하고 배포해야 합니다.

### Worker 일반 환경값

다음 값은 [vite.config.ts](./vite.config.ts)의 Worker `vars`에 설정돼 있습니다.

```text
APP_ORIGIN=https://hangry-and-idk.site
FIREBASE_PROJECT_ID=hangry-and-idk
```

Firebase 프로젝트나 운영 도메인을 변경하면 두 값도 함께 수정합니다.

### 로컬 Worker Secret

로컬 개발에서는 Git에서 제외되는 `.dev.vars`에 다음 값을 설정합니다.

```env
AUTH_SESSION_SECRET=<충분히 긴 무작위 값>
KAKAO_REST_API_KEY=<Kakao REST API key>
```

세션 Secret은 다음과 같이 생성할 수 있습니다.

```bash
openssl rand -base64 48
```

생성한 Secret은 채팅, 문서 또는 Git에 저장하지 않습니다.

### 운영 Worker Secret

운영 Secret은 Cloudflare에 별도로 등록합니다. 먼저 빌드해 Wrangler 배포 설정을 생성한 뒤 등록합니다.

```bash
npm run build
npx wrangler secret put AUTH_SESSION_SECRET
npx wrangler secret put KAKAO_REST_API_KEY
```

`AUTH_SESSION_SECRET`을 교체하면 기존 로그인 세션이 모두 무효화됩니다.

## 로컬 실행

```bash
npm run dev
```

로컬에서 실제 Google 로그인을 시험하려면 Firebase Authorized domains에 `localhost`가 있어야 하며, Worker의 `APP_ORIGIN`도 브라우저에서 접속하는 로컬 origin과 일치해야 합니다.

## 검증

```bash
npm run lint
npm test
npm run build
```

테스트 범위에는 다음 항목이 포함됩니다.

- Firebase X.509 공개키와 ID Token claim 검증
- 자체 세션 생성·변조·만료·로그아웃
- 세션 교환 API의 Origin 검증
- Firebase UID 기반 Rate Limit 키
- 비로그인 `401`과 제한 초과 `429`/`Retry-After`
- Edge 캐시, Kakao timeout/error 회귀
- WAF 비JSON 오류 응답 처리

## 배포

Wrangler에 로그인돼 있는지 확인합니다.

```bash
npx wrangler whoami
```

Cloudflare Workers에 빌드하고 배포합니다.

```bash
npm run deploy
```

현재 Worker 설정은 `hangry-and-idk.site` 커스텀 도메인에 직접 배포되므로 별도 staging 환경 없이 운영 사이트가 갱신됩니다.

## 배포 후 확인

1. Google 로그인 팝업이 정상 완료되는지 확인합니다.
2. `omuo_session` 쿠키에 `HttpOnly`, `Secure`, `SameSite=Lax`가 설정됐는지 확인합니다.
3. 로그인 후 식당 검색이 정상 동작하는지 확인합니다.
4. 로그아웃 후 세션과 식당 API 접근이 차단되는지 확인합니다.
5. Worker 로그에 Firebase ID Token이나 세션 쿠키가 기록되지 않는지 확인합니다.

## 구조

- **프레임워크**: Next.js App Router + vinext
- **브라우저 인증**: Firebase Web SDK + Google 로그인 팝업
- **서버 인증**: Firebase ID Token 검증 후 자체 서명 세션 발급
- **세션**: 24시간 `HttpOnly`, `Secure`, `SameSite=Lax` 쿠키
- **API 보호**: `/api/restaurants` 로그인 필수
- **Rate Limit**: Firebase UID 해시 기준 30회/60초
- **검색**: Kakao Local API
- **캐시**: 좌표 소수점 4자리 정규화 기반 5분 Edge 캐시

## 명령어

- `npm run dev`: 로컬 개발 서버
- `npm run build`: vinext 프로덕션 빌드
- `npm run deploy`: 빌드 후 Cloudflare Workers 운영 환경에 배포
- `npm test`: 인증·세션·식당 검색·사용자 테스트
- `npm run lint`: ESLint
- `npm run d1:migrations:apply`: 로컬 D1에 migration 적용
- `npm run d1:migrations:list`: 로컬 D1에 적용되지 않은 migration 목록 확인
- `npm run d1:migrations:apply:remote`: 원격 D1에 migration 적용 (운영 승인 후)

## 관련 문서

- [Firebase Console 설정 가이드](./docs/firebase-console-setup.md)
- [Firebase 인증 및 Rate Limit 구현 계획](./docs/firebase-auth-rate-limit-plan.md)
- [vinext 문서](https://github.com/cloudflare/vinext)
