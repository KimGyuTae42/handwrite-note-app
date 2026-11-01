# 개발 환경 설정 가이드 (GitHub · Vercel · Supabase)

이 문서는 **GitHub / Vercel / Supabase 환경 세팅**을 터미널(Git 명령어) 없이
**웹사이트 클릭만으로** 끝내는 방법입니다. 프로젝트 소개는 [README](../README.md)를 보세요.

---

## 0. 사전 준비물

- GitHub 계정 (https://github.com)
- Vercel 계정 (GitHub 계정으로 바로 로그인 가능)
- Supabase 계정 (GitHub 계정으로 바로 로그인 가능)
- 압축 해제 프로그램 (다운받은 zip 풀기용 - Windows/Mac 기본 기능으로 충분)

---

## 1. GitHub 저장소 만들고 파일 업로드하기 (드래그 앤 드롭)

1. https://github.com/new 접속
2. **Repository name**에 `handwrite-note-app` 입력
3. Public/Private 아무거나 선택 (개인 프로젝트면 Private 추천)
4. README, .gitignore, license는 **모두 체크 해제**한 채로 **Create repository** 클릭
   (빈 저장소로 만들어야 업로드가 깔끔합니다)
5. 저장소가 만들어지면 뜨는 페이지에서 **"uploading an existing file"** 링크 클릭
   (놓쳤다면 저장소 화면 위쪽 **Add file → Upload files** 버튼으로도 갈 수 있어요)
6. 다운받은 zip 파일의 압축을 먼저 풀어서 `handwrite-note-app` 폴더를 준비합니다
7. 그 폴더 **안에 있는 내용물**(`index.html`, `css`, `public`, `js`, `package.json` 등)을
   전부 선택해서 브라우저의 점선 박스 영역으로 **통째로 드래그**합니다
   - ⚠️ `handwrite-note-app` 폴더 자체를 드래그하지 말고, **그 안의 파일/폴더들**을 드래그하세요
     (폴더째 올리면 저장소 안에 `handwrite-note-app/handwrite-note-app/...`처럼 한 겹 더 생겨요)
   - `node_modules`, `dist` 폴더는 원래 없으니 신경 안 쓰셔도 됩니다
8. 아래 **Commit changes** 영역에 커밋 메시지(예: `초기 프로젝트 업로드`) 입력 후
   **Commit changes** 버튼 클릭

이제 GitHub 저장소에 코드가 올라갔습니다. 이후 제가 새 기능을 만들어드리면,
같은 방식으로 **Add file → Upload files**에서 바뀐 파일들을 다시 드래그해서 올리면 됩니다
(기존 파일과 같은 경로면 자동으로 덮어써집니다).

---

## 2. Vercel로 배포하기

1. https://vercel.com 접속 → **Continue with GitHub**로 로그인
2. **Add New → Project** 클릭
3. 방금 만든 `handwrite-note-app` 저장소를 찾아서 **Import** 클릭
   (목록에 안 보이면 **Adjust GitHub App Permissions**로 저장소 접근을 허용해주세요)
4. Framework Preset이 자동으로 **Vite**로 인식됩니다
   (Build Command: `vite build`, Output Directory: `dist`) — 그대로 두면 됩니다
5. **Deploy** 클릭

몇 분 뒤 `https://handwrite-note-app-xxxx.vercel.app` 같은 주소가 생성됩니다.
빌드(`npm install` → `npm run build`)는 전부 Vercel 서버에서 자동으로 처리되므로,
**내 컴퓨터에서 npm 명령어를 실행할 필요가 없습니다.**

이후 GitHub 저장소에 파일을 새로 업로드(1번 방법)할 때마다 Vercel이 자동으로 재배포합니다.

---

## 3. Supabase 프로젝트 만들기 (지금은 준비만)

1. https://supabase.com 접속 → **Continue with GitHub**로 로그인
2. **New Project** 클릭
3. 프로젝트 이름 입력, DB 비밀번호는 안전한 곳에 따로 저장, 리전은
   **Northeast Asia (Seoul)** 선택 → **Create new project**
4. 생성이 끝나면 왼쪽 메뉴 **Project Settings → API Keys**로 이동해서 아래 값을 확인해두세요
   (지금 당장 어디 입력할 필요는 없고, 나중에 실제로 연결할 때 씁니다):
   - **Project URL**
   - **Publishable key** (`sb_publishable_...`로 시작) — 예전 프로젝트라면 이름이 **anon public** key로 보일 수도 있어요, 같은 역할입니다.

이 값들은 **7차시(서버·DB 추가)** 단계에서 실제로 연결할 때 사용합니다.
그때 Vercel 웹사이트의 **Settings → Environment Variables**에서
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 등록하는 방법도 웹에서 그대로 진행할 수 있어요.

---

## 4. 로그인 + 계정별 데이터 저장/동기화 켜기

지금 앱은 로그인 기능이 실제로 붙어있어요. 아래 두 가지만 해주면 바로 동작합니다.

### 4-1. 이메일 로그인 켜기
Supabase 대시보드 → **Authentication → Providers → Email** 이 기본적으로 켜져 있어요.
테스트를 빠르게 하고 싶다면 같은 화면에서 **Confirm email** 옵션을 꺼두면
회원가입 후 이메일 인증 없이 바로 로그인할 수 있습니다 (나중에 실제로 배포할 땐 다시 켜는 걸 추천해요).

### 4-2. 데이터 테이블 만들기
Supabase 대시보드 → **SQL Editor → New query**에 이 프로젝트의 `supabase/schema.sql` 파일
내용을 그대로 붙여넣고 **Run** 하세요. (계정별로 데이터를 분리해서 저장하는 테이블 하나와,
"내 데이터만 보이게" 하는 보안 규칙(RLS)이 만들어집니다.)

### 4-3. .env(.local) 확인
`.env` 또는 `.env.local`에 Supabase **Project URL**과 키가 채워져 있어야 해요
(`.env.local`을 쓰면 `.env`보다 우선 적용되고, 둘 다 git에는 올라가지 않습니다).
키 변수명은 `VITE_SUPABASE_PUBLISHABLE_KEY` (최근 프로젝트) 또는 `VITE_SUPABASE_ANON_KEY`
(예전 프로젝트) 둘 중 아무거나 써도 코드가 알아서 인식합니다 — 둘 다 넣을 필요는 없어요.
Vercel에 배포했다면 **Settings → Environment Variables**에도 같은 값을 등록하고 재배포해주세요.

이렇게 해두면:
- 처음 방문 시 로그인 화면이 뜨고, 이메일/비밀번호로 회원가입·로그인할 수 있어요.
- 로그인하면 내 폴더/노트/추가한 템플릿·폰트가 Supabase에 저장돼요 (수정할 때마다 자동 저장, 0.7초 정도 디바운스).
- 다른 기기(또는 다른 브라우저)에서 같은 계정으로 로그인하면 저장된 데이터를 그대로 불러와서 이어서 쓸 수 있어요 — 이게 기기 간 동기화입니다.
- `.env`를 아직 안 채웠다면 로그인 화면에서 "로그인 없이 이 기기에서만 써보기"를 눌러 예전처럼 로컬 전용으로 계속 써볼 수 있어요.

---

## (선택) 로컬 미리보기가 필요하다면

지금 만든 화면을 GitHub에 올리기 전에 내 컴퓨터에서 먼저 보고 싶다면 아래 명령어가 필요합니다
(이 부분만은 터미널 사용이 꼭 필요해요):

```bash
npm install
npm run dev
```

하지만 필수는 아닙니다 — 그냥 GitHub에 업로드하면 Vercel이 알아서 빌드/배포해주기 때문에,
매번 Vercel 배포 주소로 결과를 확인하셔도 됩니다.

---

---

## 자주 만나는 오류

| 증상 | 원인 / 해결 |
|---|---|
| 로그인 화면에 **Failed to fetch** | 서버에 연결 자체를 못 한 것. ① Supabase 프로젝트가 **일시정지(Paused)** 됐는지 확인하고 Restore project ② 브라우저에서 `https://<프로젝트>.supabase.co/auth/v1/health`가 열리는지 확인 ③ Vercel 환경변수 `VITE_SUPABASE_URL`에 끝 `/`나 공백이 없는지 확인 후 **Redeploy** ④ 학교 와이파이가 막는 경우 핫스팟으로 시도 |
| 로그인 후 **PGRST205 / Could not find the table 'public.user_data'** | 테이블이 없거나 API 캐시가 아직 갱신 안 됨. Supabase **SQL Editor**에서 `supabase/schema.sql` 실행 → 이어서 `NOTIFY pgrst, 'reload schema';` 실행 후 몇십 초 기다렸다가 다시 로그인 |
| 로그인 화면에 "Supabase 연동이 아직 설정되지 않았어요" | `.env.local`(또는 Vercel 환경변수)에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`(또는 `VITE_SUPABASE_ANON_KEY`)가 없음. 값을 넣고 개발 서버를 **다시 시작**(Vercel은 Redeploy) |
| `npm run dev`는 되는데 글자 인식이 안 됨 | 인식 라이브러리(Tesseract.js, TensorFlow.js, pdf.js)를 CDN에서 불러오므로 인터넷 연결이 필요 |
