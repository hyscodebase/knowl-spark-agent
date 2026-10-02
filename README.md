# KNOWL — 문서 검색 RAG 에이전트

PDF·DOCX·TXT·PPTX를 업로드하고 질문에 필요한 문서 조각을 검색해 근거와 함께 답변하는 웹 앱입니다. 문서 처리·검색·답변 단계를 나누어 확인할 수 있습니다.

## 주요 기능

- 인증과 사용자별 문서 업로드(파일당 최대 25MB)
- 텍스트 추출·청킹·상태 표시, 문서 재인덱싱·삭제
- 파일명·유형 등 검색 필터
- 키워드 후보 검색, LLM 재정렬, 근거 기반 답변
- 질문 이력과 문서 관리 화면

현재 서버 구현은 **키워드 검색**입니다. UI에 남아 있는 pgvector·임베딩 관련 표현과 달리 `process-document`는 임베딩 없이 텍스트 청크를 저장하고, `query-agent`는 `match_chunks_keyword` RPC로 후보를 검색합니다.

## 로컬 실행

Node.js 22.12 이상과 npm이 필요합니다.

```bash
git clone https://github.com/hyscodebase/knowl-spark-agent.git
cd knowl-spark-agent
npm ci
# 아래 환경 설정을 먼저 준비한 뒤 실행합니다.
npm run dev
```

접속 주소는 터미널에 표시되는 Vite 개발 서버 URL을 사용합니다.

## 백엔드 설정

루트에 `.env.local`을 만들고 본인의 프로젝트 값으로 설정합니다.

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`supabase/migrations/`의 문서·청크·검색 RPC·정책·Storage 설정을 개발용 프로젝트에 준비하세요. `process-document`, `query-agent` 함수를 배포하고 Auth와 `documents` Storage 버킷을 연결합니다.

`query-agent`의 LLM 호출에는 `LOVABLE_API_KEY`가 필요합니다. 두 함수는 Supabase 서버 기본 환경도 읽습니다. 스캔 PDF에 대한 OCR 파이프라인은 이 함수에 포함되어 있지 않아 텍스트 추출 가능 여부를 확인해야 합니다.

서버 전용 API 키와 `SUPABASE_SERVICE_ROLE_KEY`는 Edge Functions의 환경에만 설정합니다. 프론트엔드의 `VITE_` 변수에는 넣지 마세요. [Supabase 환경변수 안내](https://supabase.com/docs/guides/functions/secrets)를 참고하세요.

## 기술과 코드

React 19, TanStack Start·Router, Vite 7, Tailwind CSS 4, Supabase를 사용합니다. `vite.config.ts`는 `@lovable.dev/vite-tanstack-config`가 기본 플러그인을 구성합니다.

| 경로 | 역할 |
|---|---|
| [src/routes/index.tsx](src/routes/index.tsx) | 검색 대시보드 |
| [src/routes/documents.tsx](src/routes/documents.tsx) | 문서 상태·재처리·삭제 |
| [src/components/agent/](src/components/agent/) | 업로드·질의·이력·파이프라인 UI |
| [supabase/functions/](supabase/functions/) | 문서 추출과 검색·답변 |
| [wrangler.jsonc](wrangler.jsonc) | Cloudflare/TanStack 서버 어댑터 설정 |

## 개발 명령

| 명령 | 역할 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint 검사 |
| `npm run preview` | 빌드 결과 미리보기 |

실제 스크립트 정의는 [package.json](package.json)에 있습니다.

배포 시에는 TanStack Start 서버 출력과 Cloudflare 어댑터 구성을 확인하세요. 단순한 Vite SPA와 같은 정적 배포 방식으로 가정하지 않습니다.
