# 손글씨 인식 노트 - 개발 환경 설정 가이드

이 문서는 1차시(준비 단계)에서 해야 할 **GitHub / Vercel / Supabase 기본 환경 세팅**만 다룹니다.
기능 구현은 사용자가 요청할 때마다 순서대로 진행합니다.

---

## 0. 사전 준비물

- Node.js 18 이상 (터미널에서 `node -v` 로 확인)
- Git
- GitHub 계정
- Vercel 계정 (GitHub 계정으로 그냥 로그인 가능)
- Supabase 계정 (GitHub 계정으로 그냥 로그인 가능)

---

## 1. 로컬에서 실행해보기

압축을 푼 폴더에서:

```bash
npm install
npm run dev
```

터미널에 뜨는 주소(보통 `http://localhost:5173`)를 브라우저로 열면 지금까지 만든 화면이 보입니다.
파일을 수정하면 자동으로 새로고침됩니다 (Vite 개발 서버).

> 왜 `index.html`을 그냥 더블클릭해서 열면 안 되나요?
> `file://` 로 열면 브라우저 보안 정책 때문에 IndexedDB, 모듈 import 같은 기능이 막힙니다.
> 항상 `npm run dev` (또는 나중엔 배포된 Vercel 주소)로 접속하세요.

---

## 2. GitHub 저장소 만들기

```bash
cd handwrite-note-app
git init
git add .
git commit -m "chore: 프로젝트 초기 세팅 (Vite + 화면 뼈대)"
```

GitHub 웹사이트에서 새 저장소를 만든 뒤 (README 없이 빈 저장소로),
저장소 페이지에 나오는 안내를 따라 연결합니다:

```bash
git remote add origin https://github.com/<내-아이디>/handwrite-note-app.git
git branch -M main
git push -u origin main
```

`.gitignore`에 `node_modules`, `dist`, `.env` 가 이미 등록되어 있어서
불필요한 파일은 올라가지 않습니다.

이후로는 기능을 하나씩 완성할 때마다:
```bash
git add .
git commit -m "feat: 기능 설명"
git push
```

---

## 3. Vercel 배포 연결

1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. **Add New → Project** 클릭
3. 방금 만든 `handwrite-note-app` 저장소 선택 → **Import**
4. Framework Preset이 자동으로 **Vite**로 잡힙니다 (Build Command: `vite build`, Output: `dist`) — 그대로 두면 됩니다.
5. **Deploy** 클릭

배포가 끝나면 `https://handwrite-note-app-xxxx.vercel.app` 같은 주소가 생기고,
이후 `main` 브랜치에 `git push`할 때마다 자동으로 재배포됩니다.

> 지금 단계(프론트만 있는 상태)에서는 환경변수를 넣지 않아도 정상 배포됩니다.
> Supabase를 실제로 연결하는 7차시에 3번 아래 항목을 진행하면 됩니다.

---

## 4. Supabase 프로젝트 만들기 (지금은 준비만)

1. https://supabase.com 접속 → GitHub 계정으로 로그인
2. **New Project** 클릭 → 프로젝트 이름, DB 비밀번호(안전하게 따로 저장), 리전은 **Northeast Asia (Seoul)** 선택
3. 프로젝트가 만들어지면 좌측 메뉴 **Project Settings → API** 에서 아래 두 값을 확인:
   - `Project URL`
   - `anon public` key

4. 로컬 프로젝트 루트에 `.env` 파일을 만들고 `.env.example`을 참고해 값을 채웁니다:

```bash
cp .env.example .env
```
```
VITE_SUPABASE_URL=여기에 Project URL
VITE_SUPABASE_ANON_KEY=여기에 anon public key
```

`.env`는 `.gitignore`에 포함되어 있어 **절대 GitHub에 올라가지 않습니다.**

5. Vercel에도 같은 값을 등록해야 배포된 사이트에서도 Supabase에 연결됩니다:
   Vercel 프로젝트 → **Settings → Environment Variables** 에서
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 를 각각 추가 → **Redeploy**

6. `@supabase/supabase-js` 패키지와 `js/supabaseClient.js` 파일은 이미 준비되어 있습니다.
   지금은 어디서도 사용하지 않는 상태이고, 계획서 7차시("서버·DB 추가")에서
   실제 테이블(폴더, 노트, 템플릿, 폰트, 설정)을 만들고 이 클라이언트로 연결할 예정입니다.

---

## 지금 프로젝트 구조

```
handwrite-note-app/
├─ index.html          모든 화면(목록/설정/노트편집) 구조
├─ css/style.css        전체 스타일
├─ public/js/           일반 스크립트 (그대로 배포됨)
│   ├─ db.js            IndexedDB 저장소
│   ├─ canvas.js        필기 엔진 (펜/지우개/올가미/그룹핑)
│   └─ ocr.js           손글씨 인식 (Tesseract.js)
├─ js/supabaseClient.js Supabase 연결 준비 (7차시부터 사용)
├─ public/assets/       템플릿 PDF, TTF 폰트 저장용 (2차시부터 사용)
├─ vite.config.js
├─ package.json
├─ .env.example
└─ .gitignore
```

> `js/app.js` (화면들을 실제로 연결하는 코드)는 아직 없습니다.
> 다음 기능부터 하나씩 순서대로 만들면서 `public/js/app.js`로 추가할 예정입니다.
