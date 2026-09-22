-- ============================================================
-- 손글씨 인식 노트 - Supabase 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 내용을
-- 그대로 붙여넣고 Run 하세요. (한 번만 실행하면 됩니다)
-- ============================================================

-- 계정(user) 하나당 폴더/노트/템플릿/폰트/설정을 통째로 JSON 하나에 저장합니다.
-- 학교 프로젝트 프로토타입 단계라 테이블을 잘게 나누는 대신
-- "계정별 데이터 저장 → 동기화"가 실제로 되는 것부터 간단하게 구현한 구조입니다.
-- (나중에 폴더/노트 등을 각각 테이블로 정규화하고 싶으면 이 테이블 구조를
--  참고해서 확장하면 됩니다.)

create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 행 단위 보안(RLS) 켜기: 각 계정은 자기 데이터만 읽고 쓸 수 있게 합니다.
alter table public.user_data enable row level security;

create policy "select own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "update own data"
  on public.user_data for update
  using (auth.uid() = user_id);
