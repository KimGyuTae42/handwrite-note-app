// ============ Supabase 클라이언트 (2단계에서 사용) ============
// 지금 당장은 어디서도 import 하지 않습니다. 7차시 "서버·DB 추가" 단계에서
// import { supabase } from "./supabaseClient.js" 로 불러와 사용하면 됩니다.
//
// 사용 전 준비:
// 1) npm install (package.json에 @supabase/supabase-js 이미 포함되어 있음)
// 2) .env.example을 복사해 .env 파일을 만들고 Supabase 프로젝트의
//    URL / anon public key를 채워 넣기
// 3) index.html에서 이 파일을 불러올 스크립트를 <script type="module"> 로 추가

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
