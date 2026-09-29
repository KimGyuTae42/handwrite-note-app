// ============ UI 전용 로직 (내부 기능 없음) ============
// 지금은 필기 엔진(canvas.js)이나 인식(ocr.js), 저장(db.js)을 연결하지 않고
// 화면 전환 / 폴더·노트 정리 / 설정 화면 UI만 실제로 동작하게 만듭니다.
// 데이터는 새로고침하면 사라지는 메모리(state) 안에만 있습니다.
//
// 단, 템플릿(PDF)과 폰트(TTF) 업로드는 실제로 동작합니다:
// - 템플릿 PDF는 pdf.js로 각 페이지를 이미지로 렌더링해서 사용합니다.
// - 폰트 TTF는 FontFace API로 실제 로드해서 화면에 그 글꼴로 보여줍니다.

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// 기본 제공 템플릿 (PDF에서 만든 6종 - 모든 계정에 항상 제공되는 내장 템플릿)
const BUNDLED_TEMPLATES = [
  { id: "t01", name: "모눈 (전체)", img: "assets/templates/template-01.png" },
  { id: "t02", name: "모눈 (2단)", img: "assets/templates/template-02.png" },
  { id: "t03", name: "모눈 (점그리드 2단)", img: "assets/templates/template-03.png" },
  { id: "t04", name: "모눈 (4분할)", img: "assets/templates/template-04.png" },
  { id: "t05", name: "모눈 (인덱스탭)", img: "assets/templates/template-05.png" },
  { id: "t06", name: "모눈 (본문 짧게)", img: "assets/templates/template-06.png" },
];
const BUNDLED_TEMPLATE_IDS = new Set(BUNDLED_TEMPLATES.map((t) => t.id));

// 기본 제공 폰트 (사용자가 올려준 TTF 2개를 미리 내장 - 모든 계정에 항상 제공)
const BUNDLED_FONTS = [
  { id: "font1", name: "그리운X국한박 오춘기 김작가", file: "assets/fonts/font-01.ttf", family: "customFont_font1" },
  { id: "font2", name: "온글잎 박다현체", file: "assets/fonts/font-02.ttf", family: "customFont_font2" },
];
const BUNDLED_FONT_IDS = new Set(BUNDLED_FONTS.map((f) => f.id));

function loadBundledFonts() {
  BUNDLED_FONTS.forEach((f) => {
    const face = new FontFace(f.family, `url(${f.file})`);
    face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch((e) => console.error("폰트 로드 실패:", f.name, e));
  });
}

const state = {
  user: null, // Supabase 로그인 사용자 (null이면 로컬 전용 모드)
  folders: [
    { id: "f-doc", name: "문서", parentId: null },
    { id: "f-math", name: "수학", parentId: "f-doc" },
    { id: "f-sci", name: "과학", parentId: "f-doc" },
  ],
  notes: [
    { id: "n1", name: "미적1", folderId: "f-math", trashed: false, templateId: "t01", strokes: [], texts: [] },
    { id: "n2", name: "미적2", folderId: "f-math", trashed: false, templateId: "t03", strokes: [], texts: [] },
    { id: "n3", name: "물리", folderId: "f-sci", trashed: false, templateId: "t02", strokes: [], texts: [] },
    { id: "n4", name: "화학", folderId: "f-sci", trashed: false, templateId: "t04", strokes: [], texts: [] },
  ],
  templates: [...BUNDLED_TEMPLATES],
  fonts: BUNDLED_FONTS.map((f) => ({ id: f.id, name: f.name, family: f.family })),
  settings: { defaultTemplateId: "t01", defaultFontId: "font1", threshold: 80 },
  expanded: new Set(["f-doc", "f-math", "f-sci"]),
  currentFolderId: "f-doc",
  showTrash: false,
  searchTerm: "",
  openTabs: [],
  activeNoteId: null,
};

const PALETTE = ["#111111", "#2563eb", "#e11d48"];

// ---------- 화면 전환 ----------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
}

// ---------- 그리드 페이퍼 배경(플레이스홀더 템플릿) ----------
function gridPaperDataUri() {
  const w = 1000, h = 1400, cell = 28;
  let lines = "";
  for (let x = 0; x <= w; x += cell) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#eef0f4" stroke-width="1"/>`;
  for (let y = 0; y <= h; y += cell) lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#eef0f4" stroke-width="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${lines}</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ---------- 노트 캔버스에 템플릿 배경 적용 (실제 이미지 크기에 맞춰 캔버스 크기도 조정) ----------
function applyNoteTemplate(noteId) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return;
  if (!note.strokes) note.strokes = [];
  if (!note.texts) note.texts = [];

  const tmpl = state.templates.find((t) => t.id === note.templateId);
  const stage = document.getElementById("canvas-stage");
  const bgImg = document.getElementById("template-bg");
  const ink = document.getElementById("ink-canvas");
  const lasso = document.getElementById("lasso-overlay");
  const textLayer = document.getElementById("text-layer");

  const applySize = (w, h) => {
    stage.style.width = w + "px";
    stage.style.height = h + "px";
    [bgImg, textLayer].forEach((el) => {
      el.style.width = w + "px";
      el.style.height = h + "px";
    });
    ink.style.width = w + "px";
    ink.style.height = h + "px";
    lasso.style.width = w + "px";
    lasso.style.height = h + "px";
    if (engine) engine.resize(w, h);
  };

  if (tmpl && tmpl.img) {
    bgImg.onload = () => {
      applySize(bgImg.naturalWidth, bgImg.naturalHeight);
      if (engine) engine.setNote(note);
    };
    bgImg.src = tmpl.img;
  } else {
    bgImg.onload = null;
    bgImg.src = gridPaperDataUri();
    applySize(1000, 1400);
    if (engine) engine.setNote(note);
  }
}

function activateNote(id) {
  state.activeNoteId = id;
  renderTabs();
  applyNoteTemplate(id);
}

// ============ 로그인 / 계정별 저장·동기화 (Supabase) ============
function getClient() {
  return window.__supabase || null;
}

let syncTimer = null;
function scheduleSync() {
  if (!state.user) return; // 로컬 전용 모드에서는 저장하지 않음
  clearTimeout(syncTimer);
  syncTimer = setTimeout(saveUserData, 700);
}

async function saveUserData() {
  const client = getClient();
  if (!client || !state.user) return;
  const payload = {
    folders: state.folders,
    notes: state.notes,
    templates: state.templates.filter((t) => !BUNDLED_TEMPLATE_IDS.has(t.id)),
    fonts: state.fonts.filter((f) => !BUNDLED_FONT_IDS.has(f.id)),
    settings: state.settings,
  };
  const { error } = await client.from("user_data").upsert({
    user_id: state.user.id,
    data: payload,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("동기화 실패:", error);
}

function defaultFolders() {
  return [{ id: "f-doc", name: "문서", parentId: null }];
}

async function loadUserData() {
  const client = getClient();
  const { data, error } = await client
    .from("user_data")
    .select("data")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (error) {
    console.error("불러오기 실패:", error);
    alert("데이터를 불러오지 못했습니다. supabase/schema.sql을 SQL Editor에서 실행했는지 확인해주세요.");
    state.folders = defaultFolders();
    state.notes = [];
  } else if (data && data.data) {
    const d = data.data;
    state.folders = d.folders && d.folders.length ? d.folders : defaultFolders();
    state.notes = d.notes || [];
    state.templates = [...BUNDLED_TEMPLATES, ...(d.templates || [])];
    state.fonts = [...BUNDLED_FONTS.map((f) => ({ id: f.id, name: f.name, family: f.family })), ...(d.fonts || [])];
    state.settings = { ...state.settings, ...(d.settings || {}) };
    reloadCustomFontFaces();
  } else {
    // 첫 로그인: 빈 상태로 시작하고 즉시 저장
    state.folders = defaultFolders();
    state.notes = [];
    state.templates = [...BUNDLED_TEMPLATES];
    state.fonts = BUNDLED_FONTS.map((f) => ({ id: f.id, name: f.name, family: f.family }));
    await saveUserData();
  }

  state.currentFolderId = "f-doc";
  state.expanded = new Set(["f-doc"]);
  state.showTrash = false;
  state.searchTerm = "";
  state.openTabs = [];
  state.activeNoteId = null;
}

function reloadCustomFontFaces() {
  state.fonts.forEach((f) => {
    if (f.dataUrl) {
      const face = new FontFace(f.family, `url(${f.dataUrl})`);
      face.load().then((loaded) => document.fonts.add(loaded)).catch((e) => console.error(e));
    }
  });
}

async function initAuth() {
  const client = getClient();

  if (!client) {
    document.getElementById("auth-form-area").classList.add("hidden");
    document.getElementById("auth-not-configured").classList.remove("hidden");
    document.getElementById("auth-skip-btn").addEventListener("click", () => {
      switchView("list");
      renderAll();
    });
    switchView("auth");
    renderAccountInfo();
    return;
  }

  document.getElementById("auth-login-btn").addEventListener("click", () => handleAuthSubmit("login"));
  document.getElementById("auth-signup-btn").addEventListener("click", () => handleAuthSubmit("signup"));
  document.getElementById("auth-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAuthSubmit("login");
  });

  client.auth.onAuthStateChange((_event, session) => {
    if (session && session.user && (!state.user || state.user.id !== session.user.id)) {
      onLoggedIn(session.user);
    }
  });

  try {
    const { data } = await client.auth.getSession();
    if (data && data.session && data.session.user) {
      await onLoggedIn(data.session.user);
      return;
    }
  } catch (e) {
    console.error(e);
  }
  switchView("auth");
}

async function handleAuthSubmit(mode) {
  const client = getClient();
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  hideAuthError();
  if (!email || !password) { showAuthError("이메일과 비밀번호를 입력해주세요."); return; }

  try {
    if (mode === "signup") {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        showAuthError("가입 확인 메일을 보냈어요. 메일함을 확인한 뒤 로그인해주세요.", true);
        return;
      }
    } else {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) {
    showAuthError(translateAuthError(e.message));
  }
}

function translateAuthError(msg) {
  if (!msg) return "로그인에 실패했습니다.";
  if (msg.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (msg.includes("already registered")) return "이미 가입된 이메일입니다. 로그인해주세요.";
  if (msg.includes("Password should be")) return "비밀번호는 6자 이상이어야 합니다.";
  return msg;
}

function showAuthError(msg, isInfo) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.style.color = isInfo ? "var(--muted)" : "#e11d48";
  el.classList.remove("hidden");
}
function hideAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}

async function onLoggedIn(user) {
  state.user = user;
  await loadUserData();
  renderAll();
  renderAccountInfo();
  switchView("list");
}

async function logout() {
  const client = getClient();
  if (client) await client.auth.signOut();
  state.user = null;
  state.openTabs = [];
  state.activeNoteId = null;
  document.getElementById("auth-email").value = "";
  document.getElementById("auth-password").value = "";
  hideAuthError();
  switchView("auth");
}

function renderAccountInfo() {
  const wrap = document.getElementById("account-info");
  if (!wrap) return;
  if (state.user) {
    wrap.innerHTML = `
      <p class="hint">${escapeHtml(state.user.email)} 계정으로 로그인됨<br/>다른 기기에서 같은 계정으로 로그인하면 노트가 그대로 동기화됩니다.</p>
      <button class="btn plain" id="logout-btn">로그아웃</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", logout);
  } else {
    wrap.innerHTML = `<p class="hint">로그인하지 않은 상태입니다. (이 기기에만 저장되고 동기화되지 않아요)</p>`;
  }
}

// ---------- 폴더 트리(사이드바) ----------
function renderFolderTree() {
  const root = document.getElementById("folder-tree");
  root.innerHTML = "";
  const topFolders = state.folders.filter((f) => f.parentId === "f-doc");
  topFolders.forEach((f) => root.appendChild(renderFolderNode(f)));
}

function renderFolderNode(folder) {
  const childFolders = state.folders.filter((f) => f.parentId === folder.id);
  const childNotes = state.notes.filter((n) => n.folderId === folder.id && !n.trashed);
  const hasChildren = childFolders.length + childNotes.length > 0;
  const isExpanded = state.expanded.has(folder.id);

  const wrap = document.createElement("div");

  const row = document.createElement("div");
  row.className = "folder-item" + (folder.id === state.currentFolderId && !state.showTrash ? " active" : "");
  row.innerHTML = `<span class="caret">${hasChildren ? (isExpanded ? "▾" : "▸") : ""}</span>📁 ${escapeHtml(folder.name)}`;
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    state.showTrash = false;
    state.searchTerm = "";
    document.getElementById("search-input").value = "";
    state.currentFolderId = folder.id;
    if (hasChildren) {
      if (isExpanded) state.expanded.delete(folder.id);
      else state.expanded.add(folder.id);
    }
    renderAll();
  });
  row.addEventListener("dblclick", async (e) => {
    e.stopPropagation();
    const name = await promptModal("폴더 이름 바꾸기", folder.name);
    if (name) { folder.name = name; renderAll(); }
  });
  wrap.appendChild(row);

  if (hasChildren && isExpanded) {
    const childWrap = document.createElement("div");
    childWrap.className = "folder-children";
    childFolders.forEach((cf) => childWrap.appendChild(renderFolderNode(cf)));
    childNotes.forEach((note) => {
      const nRow = document.createElement("div");
      nRow.className = "folder-item";
      nRow.innerHTML = `<span class="caret"></span>📝 ${escapeHtml(note.name)}`;
      nRow.addEventListener("click", (e) => { e.stopPropagation(); openNote(note.id); });
      childWrap.appendChild(nRow);
    });
    wrap.appendChild(childWrap);
  }
  return wrap;
}

// ---------- 노트/폴더 그리드(메인) ----------
function renderGrid() {
  const grid = document.getElementById("note-grid");
  const emptyHint = document.getElementById("empty-hint");
  const nameLabel = document.getElementById("current-folder-name");
  grid.innerHTML = "";

  let folders = [];
  let notes = [];

  if (state.searchTerm) {
    nameLabel.textContent = `"${state.searchTerm}" 검색 결과`;
    notes = state.notes.filter((n) => !n.trashed && n.name.toLowerCase().includes(state.searchTerm.toLowerCase()));
  } else if (state.showTrash) {
    nameLabel.textContent = "휴지통";
    notes = state.notes.filter((n) => n.trashed);
  } else {
    const cur = state.folders.find((f) => f.id === state.currentFolderId);
    nameLabel.textContent = cur ? cur.name : "문서";
    folders = state.folders.filter((f) => f.parentId === state.currentFolderId);
    notes = state.notes.filter((n) => n.folderId === state.currentFolderId && !n.trashed);
  }

  folders.forEach((f) => grid.appendChild(makeGridCell({ type: "folder", id: f.id, name: f.name })));
  notes.forEach((n) => grid.appendChild(makeGridCell({ type: "note", id: n.id, name: n.name })));

  emptyHint.classList.toggle("hidden", folders.length + notes.length > 0);
  document.getElementById("new-btn").classList.toggle("hidden", state.showTrash || !!state.searchTerm);
}

function makeGridCell({ type, id, name }) {
  const cell = document.createElement("div");
  cell.className = "grid-cell " + type;

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.textContent = type === "folder" ? "📁" : "📝";

  const del = document.createElement("button");
  del.className = "cell-del";
  del.title = state.showTrash ? "완전히 삭제" : "휴지통으로 이동";
  del.textContent = "🗑";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    if (type === "folder") {
      if (confirm(`"${name}" 폴더와 그 안의 노트를 모두 휴지통으로 옮길까요?`)) trashFolder(id);
    } else if (state.showTrash) {
      state.notes = state.notes.filter((n) => n.id !== id);
      renderAll();
    } else {
      const note = state.notes.find((n) => n.id === id);
      note.trashed = true;
      renderAll();
    }
  });
  icon.appendChild(del);

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = name;

  cell.appendChild(icon);
  cell.appendChild(label);

  cell.addEventListener("click", () => {
    if (type === "folder") {
      state.currentFolderId = id;
      state.expanded.add(id);
      renderAll();
    } else if (state.showTrash) {
      const note = state.notes.find((n) => n.id === id);
      note.trashed = false;
      renderAll();
    } else {
      openNote(id);
    }
  });
  cell.addEventListener("dblclick", async (e) => {
    e.stopPropagation();
    if (state.showTrash) return;
    const item = type === "folder" ? state.folders.find((f) => f.id === id) : state.notes.find((n) => n.id === id);
    const newName = await promptModal("이름 바꾸기", item.name);
    if (newName) { item.name = newName; renderAll(); }
  });

  return cell;
}

function trashFolder(folderId) {
  const childFolderIds = state.folders.filter((f) => f.parentId === folderId).map((f) => f.id);
  state.notes.forEach((n) => { if (n.folderId === folderId || childFolderIds.includes(n.folderId)) n.trashed = true; });
  state.folders = state.folders.filter((f) => f.id !== folderId);
  if (state.currentFolderId === folderId) state.currentFolderId = "f-doc";
  renderAll();
}

// ---------- 상단 네비게이션 ----------
function goBackFolder() {
  if (state.showTrash || state.searchTerm) {
    state.showTrash = false;
    state.searchTerm = "";
    document.getElementById("search-input").value = "";
    state.currentFolderId = "f-doc";
    renderAll();
    return;
  }
  const cur = state.folders.find((f) => f.id === state.currentFolderId);
  if (cur && cur.parentId) {
    state.currentFolderId = cur.parentId;
    renderAll();
  }
}

// ---------- 새 폴더 / 새 노트 만들기 ----------
function openChoiceModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>새로 만들기</h3>
      <div class="modal-actions" style="justify-content:center;gap:10px;">
        <button class="btn primary" id="choice-folder">📁 새 폴더</button>
        <button class="btn primary" id="choice-note">📝 새 노트</button>
      </div>
      <div class="modal-actions" style="justify-content:center;">
        <button class="btn plain" id="choice-cancel">취소</button>
      </div>
    </div>`;
  document.getElementById("modal-root").appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#choice-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#choice-folder").onclick = async () => {
    overlay.remove();
    const name = await promptModal("새 폴더 이름", "새 폴더");
    if (name) { state.folders.push({ id: uid(), name, parentId: state.currentFolderId }); state.expanded.add(state.currentFolderId); renderAll(); }
  };
  overlay.querySelector("#choice-note").onclick = async () => {
    overlay.remove();
    const result = await newNoteModal();
    if (result) {
      const note = { id: uid(), name: result.name, folderId: state.currentFolderId, trashed: false, templateId: result.templateId, strokes: [], texts: [] };
      state.notes.push(note);
      state.expanded.add(state.currentFolderId);
      renderAll();
      openNote(note.id);
    }
  };
}

// 새 노트 이름 + 템플릿(위 PDF에서 만든 14종) 선택 모달
function newNoteModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let selectedTemplateId = state.settings.defaultTemplateId;

    const pickHtml = state.templates
      .map(
        (t) => `<div class="template-pick${t.id === selectedTemplateId ? " selected" : ""}" data-id="${t.id}" title="${escapeHtml(t.name)}">
          ${t.img ? `<img src="${t.img}" alt="${escapeHtml(t.name)}"/>` : ""}
        </div>`
      )
      .join("");

    overlay.innerHTML = `
      <div class="modal-box" style="width:420px;">
        <h3>새 노트 만들기</h3>
        <input type="text" class="text-input" id="note-name-input" placeholder="노트 이름" style="width:100%;" />
        <div class="hint" style="margin-top:12px;">템플릿 선택</div>
        <div class="template-pick-row" id="template-pick-row">${pickHtml}</div>
        <div class="modal-actions">
          <button class="btn plain" id="note-cancel">취소</button>
          <button class="btn primary" id="note-ok">만들기</button>
        </div>
      </div>`;
    document.getElementById("modal-root").appendChild(overlay);

    overlay.querySelectorAll(".template-pick").forEach((el) => {
      el.addEventListener("click", () => {
        overlay.querySelectorAll(".template-pick").forEach((x) => x.classList.remove("selected"));
        el.classList.add("selected");
        selectedTemplateId = el.dataset.id;
      });
    });

    const input = overlay.querySelector("#note-name-input");
    input.value = "새 노트";
    input.focus();
    input.select();

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#note-cancel").onclick = () => close(null);
    overlay.querySelector("#note-ok").onclick = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      close({ name, templateId: selectedTemplateId });
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") overlay.querySelector("#note-ok").click();
      if (e.key === "Escape") close(null);
    });
  });
}

function promptModal(title, defaultVal = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>${escapeHtml(title)}</h3>
        <input type="text" class="text-input" id="prompt-input" placeholder="이름 입력" />
        <div class="modal-actions">
          <button class="btn plain" id="prompt-cancel">취소</button>
          <button class="btn primary" id="prompt-ok">확인</button>
        </div>
      </div>`;
    document.getElementById("modal-root").appendChild(overlay);
    const input = overlay.querySelector("#prompt-input");
    input.value = defaultVal;
    input.focus();
    input.select();
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("#prompt-cancel").onclick = () => close(null);
    overlay.querySelector("#prompt-ok").onclick = () => close(input.value.trim() || null);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value.trim() || null);
      if (e.key === "Escape") close(null);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 노트 편집 화면 (탭 / 도구모음 - 시각적 UI만) ----------
function openNote(id) {
  if (!state.openTabs.includes(id)) state.openTabs.push(id);
  switchView("note");
  activateNote(id);
}

function closeTab(id) {
  state.openTabs = state.openTabs.filter((t) => t !== id);
  if (state.activeNoteId === id) {
    state.activeNoteId = state.openTabs.length ? state.openTabs[state.openTabs.length - 1] : null;
  }
  if (!state.openTabs.length) {
    switchView("list");
    renderAll();
  } else {
    renderTabs();
  }
}

function renderTabs() {
  const tabsEl = document.getElementById("tabs");
  tabsEl.innerHTML = "";
  state.openTabs.forEach((id) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    const tab = document.createElement("div");
    tab.className = "tab" + (id === state.activeNoteId ? " active" : "");
    tab.innerHTML = `<span class="tab-name">📝 ${escapeHtml(note.name)}</span><span class="tab-close">✕</span>`;
    tab.querySelector(".tab-name").addEventListener("click", () => activateNote(id));
    tab.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });
    tabsEl.appendChild(tab);
  });
}

// 도구 버튼 - 클릭 시 선택 표시만 (실제 그리기 기능은 다음 단계)
const THICKNESS_PRESETS = [2, 6, 14];
const THICKNESS_DOT_SIZES = [8, 14, 22];
let currentThickness = THICKNESS_PRESETS[1];

function initToolbar() {
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (engine) engine.tool = btn.dataset.tool;
    });
  });
  document.querySelector('.tool-btn[data-tool="pen-fountain"]').classList.add("active");

  const dotsWrap = document.getElementById("thickness-dots");
  THICKNESS_PRESETS.forEach((thickness, i) => {
    const dot = document.createElement("button");
    dot.className = "dot-btn" + (i === 1 ? " selected" : "");
    dot.style.width = THICKNESS_DOT_SIZES[i] + "px";
    dot.style.height = THICKNESS_DOT_SIZES[i] + "px";
    dot.title = thickness + "px";
    dot.addEventListener("click", () => {
      currentThickness = thickness;
      if (engine) engine.width = thickness;
      document.querySelectorAll(".dot-btn").forEach((d) => d.classList.remove("selected"));
      dot.classList.add("selected");
    });
    dotsWrap.appendChild(dot);
  });

  const swatchWrap = document.getElementById("color-swatches");
  PALETTE.forEach((color, i) => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (i === 0 ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
      document.getElementById("color-picker").value = color;
      if (engine) engine.color = color;
    });
    swatchWrap.appendChild(sw);
  });
  document.getElementById("add-color-btn").addEventListener("click", () => document.getElementById("color-picker").click());
  document.getElementById("color-picker").addEventListener("input", (e) => {
    document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
    if (engine) engine.color = e.target.value;
  });

  document.getElementById("style-toggle-btn").addEventListener("click", () => {
    document.getElementById("style-pill").classList.toggle("hidden");
  });

  document.getElementById("undo-btn").addEventListener("click", () => engine && engine.undo());
  document.getElementById("redo-btn").addEventListener("click", () => engine && engine.redo());

  document.getElementById("convert-btn").addEventListener("click", () => {
    if (!engine) return;
    const n = engine.convertAllPending();
    if (n === 0) flashOcrStatus("변환할 손글씨가 없어요");
  });
}

function flashOcrStatus(msg) {
  const el = document.getElementById("ocr-status");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => { el.classList.add("hidden"); el.textContent = "인식 중…"; }, 1200);
}

// ---------- 필기 엔진 + 손글씨 인식 연결 ----------
let engine = null;
let ocrActiveCount = 0;

function showOcrStatus() {
  ocrActiveCount++;
  document.getElementById("ocr-status").textContent = "인식 중…";
  document.getElementById("ocr-status").classList.remove("hidden");
}
function hideOcrStatus() {
  ocrActiveCount = Math.max(0, ocrActiveCount - 1);
  if (ocrActiveCount === 0) document.getElementById("ocr-status").classList.add("hidden");
}

function initEngine() {
  engine = new InkEngine(
    document.getElementById("ink-canvas"),
    document.getElementById("lasso-overlay"),
    document.getElementById("text-layer"),
    document.getElementById("canvas-stage")
  );
  engine.tool = "pen-fountain";
  engine.color = PALETTE[0];
  engine.width = currentThickness;

  engine.onChange = () => scheduleSync();

  engine.onZoomChange = (z) => {
    const pill = document.getElementById("zoom-pill");
    if (Math.abs(z - 1) < 0.01) {
      pill.classList.add("hidden");
    } else {
      pill.classList.remove("hidden");
      pill.textContent = Math.round(z * 100) + "%";
    }
  };
  document.getElementById("zoom-pill").addEventListener("click", () => engine.resetZoom());

  engine.onGroupReady = async (groupId) => {
    const bbox = engine.groupBBox(groupId);
    if (!bbox) return;
    showOcrStatus();
    try {
      const threshold = state.settings.threshold || 80;
      let result = null;

      // 1순위: 직접 학습한 CNN (한글 자모/영문/숫자/기호에 특화)
      if (cnnModel) {
        try {
          result = await recognizeWithCNN(engine.canvas, bbox);
        } catch (e) {
          console.error("CNN 인식 오류:", e);
        }
      }

      // CNN이 없거나 신뢰도가 낮으면 Tesseract(범용 OCR)로 한 번 더 시도해서 더 나은 쪽 채택
      if (!result || !result.text || result.confidence < threshold) {
        const fallback = await recognizeCanvasRegion(engine.canvas, bbox);
        if (!result || fallback.confidence > result.confidence) result = fallback;
      }

      if (result && result.text && result.confidence >= threshold) {
        const fontDef = state.fonts.find((f) => f.id === state.settings.defaultFontId);
        const fontFamily = fontDef ? `"${fontDef.family}", sans-serif` : "inherit";
        engine.replaceGroupWithText(groupId, result.text, fontFamily);
      } else {
        engine.keepGroupAsInk(groupId);
      }
    } catch (e) {
      console.error("인식 오류:", e);
      engine.keepGroupAsInk(groupId);
    } finally {
      hideOcrStatus();
    }
  };
}

// ---------- 설정 화면 (시각적 UI만) ----------
function renderTemplateList() {
  const wrap = document.getElementById("template-list");
  wrap.innerHTML = "";
  state.templates.forEach((t) => {
    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.gap = "4px";

    const thumb = document.createElement("div");
    thumb.className = "thumb" + (t.id === state.settings.defaultTemplateId ? " selected" : "");
    if (t.img) {
      const img = document.createElement("img");
      img.src = t.img;
      img.alt = t.name;
      thumb.appendChild(img);
    } else {
      thumb.style.background = "repeating-linear-gradient(0deg,#fff,#fff 9px,#eef0f4 10px)";
      thumb.style.display = "flex";
      thumb.style.alignItems = "center";
      thumb.style.justifyContent = "center";
    }

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      state.templates = state.templates.filter((x) => x.id !== t.id);
      renderTemplateList();
      scheduleSync();
    });
    thumb.appendChild(del);
    thumb.addEventListener("click", () => { state.settings.defaultTemplateId = t.id; renderTemplateList(); scheduleSync(); });

    const label = document.createElement("div");
    label.style.fontSize = "11px";
    label.style.color = "var(--muted)";
    label.textContent = t.name;

    box.appendChild(thumb);
    box.appendChild(label);
    wrap.appendChild(box);
  });
}

function renderFontList() {
  const wrap = document.getElementById("font-list");
  wrap.innerHTML = "";
  state.fonts.forEach((f) => {
    const chip = document.createElement("div");
    chip.className = "font-chip" + (f.id === state.settings.defaultFontId ? " selected" : "");

    const preview = document.createElement("div");
    preview.style.fontFamily = `"${f.family}", sans-serif`;
    preview.style.fontSize = "16px";
    preview.textContent = "가나다 Ab 123";

    const label = document.createElement("div");
    label.style.fontSize = "10px";
    label.style.color = "var(--muted)";
    label.style.marginTop = "3px";
    label.style.maxWidth = "110px";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.style.whiteSpace = "nowrap";
    label.textContent = f.name;

    chip.appendChild(preview);
    chip.appendChild(label);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      state.fonts = state.fonts.filter((x) => x.id !== f.id);
      if (state.settings.defaultFontId === f.id) state.settings.defaultFontId = state.fonts[0]?.id || null;
      renderFontList();
      scheduleSync();
    });
    chip.appendChild(del);
    chip.addEventListener("click", () => { state.settings.defaultFontId = f.id; renderFontList(); scheduleSync(); });
    wrap.appendChild(chip);
  });
}

// ---------- 실제 업로드 처리 ----------
async function handleTemplateUpload(file) {
  const btn = document.getElementById("add-template-btn");
  const originalText = btn.textContent;
  btn.textContent = "PDF 변환 중…";
  btn.disabled = true;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const baseName = file.name.replace(/\.pdf$/i, "");
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      state.templates.push({
        id: uid(),
        name: pdf.numPages > 1 ? `${baseName} p${i}` : baseName,
        img: dataUrl,
      });
    }
    renderTemplateList();
    scheduleSync();
  } catch (err) {
    console.error(err);
    alert("PDF를 템플릿으로 변환하지 못했습니다. (" + err.message + ")");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleFontUpload(file) {
  const btn = document.getElementById("add-font-btn");
  const originalText = btn.textContent;
  btn.textContent = "글꼴 불러오는 중…";
  btn.disabled = true;
  try {
    const dataUrl = await fileToDataUrl(file);
    const family = "customFont_" + uid();
    const face = new FontFace(family, `url(${dataUrl})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    state.fonts.push({ id: uid(), name: file.name.replace(/\.ttf$/i, ""), family, dataUrl });
    renderFontList();
    scheduleSync();
  } catch (err) {
    console.error(err);
    alert("폰트를 불러오지 못했습니다. TTF 파일이 맞는지 확인해주세요. (" + err.message + ")");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initSettings() {
  renderTemplateList();
  renderFontList();
  renderAccountInfo();

  document.getElementById("add-template-btn").addEventListener("click", () => document.getElementById("template-file-input").click());
  document.getElementById("template-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleTemplateUpload(file);
    e.target.value = "";
  });

  document.getElementById("add-font-btn").addEventListener("click", () => document.getElementById("font-file-input").click());
  document.getElementById("font-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleFontUpload(file);
    e.target.value = "";
  });

  const thresholdRange = document.getElementById("threshold-range");
  const thresholdValue = document.getElementById("threshold-value");
  thresholdRange.value = state.settings.threshold;
  thresholdValue.textContent = state.settings.threshold + "%";
  thresholdRange.addEventListener("input", () => {
    thresholdValue.textContent = thresholdRange.value + "%";
    state.settings.threshold = Number(thresholdRange.value);
    scheduleSync();
  });
}

// ---------- 전체 다시 그리기 ----------
function renderAll() {
  renderFolderTree();
  renderGrid();
  scheduleSync();
}

// ---------- 초기화 ----------
document.addEventListener("DOMContentLoaded", () => {
  loadBundledFonts();
  initCNN();

  // 목록 화면
  document.getElementById("back-btn").addEventListener("click", goBackFolder);
  document.getElementById("new-btn").addEventListener("click", openChoiceModal);
  document.getElementById("settings-btn").addEventListener("click", () => switchView("settings"));
  document.getElementById("trash-btn").addEventListener("click", () => {
    state.showTrash = true;
    state.searchTerm = "";
    document.getElementById("search-input").value = "";
    renderAll();
  });
  document.getElementById("search-btn").addEventListener("click", () => {
    document.getElementById("search-bar").classList.toggle("hidden");
    document.getElementById("search-input").focus();
  });
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.searchTerm = e.target.value.trim();
    renderGrid();
  });

  // 설정 화면
  document.getElementById("settings-back-btn").addEventListener("click", () => switchView("list"));
  initSettings();

  // 노트 화면
  document.getElementById("home-btn").addEventListener("click", () => switchView("list"));
  initEngine();
  initToolbar();

  initAuth();
});
