// ============ Supabase 클라이언트 ============
// 로그인 / 계정별 데이터 저장·동기화에 사용합니다.
// .env(.local)에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가 채워져 있어야
// 실제로 연결됩니다. 비어있으면 supabase는 null이 되고, app.js가 이를 감지해서
// "로그인 없이 이 기기에서만 사용" 모드로 동작합니다.
//
// app.js는 일반 스크립트(모듈 아님)라 import를 쓸 수 없어서,
// 이 모듈이 로드되자마자 window.__supabase 에 클라이언트를 걸어둡니다.
// (모듈 스크립트는 항상 defer되어 실행되므로, app.js의 DOMContentLoaded
//  콜백이 실행되는 시점에는 이미 window.__supabase가 준비돼 있습니다.)

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

if (!supabase) {
  console.warn("[Supabase] .env(.local)에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가 없어 로컬 전용 모드로 동작합니다.");
}

window.__supabase = supabase;

