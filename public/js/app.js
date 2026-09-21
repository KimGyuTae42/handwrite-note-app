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

// 기본 제공 폰트 (사용자가 올려준 TTF 2개를 미리 내장)
const BUNDLED_FONTS = [
  { id: "font1", name: "그리운X국한박 오춘기 김작가", file: "assets/fonts/font-01.ttf", family: "customFont_font1" },
  { id: "font2", name: "온글잎 박다현체", file: "assets/fonts/font-02.ttf", family: "customFont_font2" },
];

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
  folders: [
    { id: "f-doc", name: "문서", parentId: null },
    { id: "f-math", name: "수학", parentId: "f-doc" },
    { id: "f-sci", name: "과학", parentId: "f-doc" },
  ],
  notes: [
    { id: "n1", name: "미적1", folderId: "f-math", trashed: false, templateId: "t01" },
    { id: "n2", name: "미적2", folderId: "f-math", trashed: false, templateId: "t03" },
    { id: "n3", name: "물리", folderId: "f-sci", trashed: false, templateId: "t02" },
    { id: "n4", name: "화학", folderId: "f-sci", trashed: false, templateId: "t04" },
  ],
  // PDF(_1__모눈__grid__1__blue_chalk.pdf)의 6페이지를 기본 템플릿으로 사용
  templates: [
    { id: "t01", name: "모눈 (전체)", img: "assets/templates/template-01.png" },
    { id: "t02", name: "모눈 (2단)", img: "assets/templates/template-02.png" },
    { id: "t03", name: "모눈 (점그리드 2단)", img: "assets/templates/template-03.png" },
    { id: "t04", name: "모눈 (4분할)", img: "assets/templates/template-04.png" },
    { id: "t05", name: "모눈 (인덱스탭)", img: "assets/templates/template-05.png" },
    { id: "t06", name: "모눈 (본문 짧게)", img: "assets/templates/template-06.png" },
  ],
  // TTF 업로드로 받은 폰트 (실제 파일을 FontFace로 로드해서 사용)
  fonts: [
    { id: "font1", name: "그리운X국한박 오춘기 김작가", family: "customFont_font1" },
    { id: "font2", name: "온글잎 박다현체", family: "customFont_font2" },
  ],
  settings: { defaultTemplateId: "t01", defaultFontId: "font1" },
  expanded: new Set(["f-doc", "f-math", "f-sci"]),
  currentFolderId: "f-doc",
  showTrash: false,
  searchTerm: "",
  openTabs: [],
  activeNoteId: null,
};

const PALETTE = ["#111111", "#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#9333ea"];

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
  const tmpl = state.templates.find((t) => t.id === note.templateId);
  const bgImg = document.getElementById("template-bg");
  const ink = document.getElementById("ink-canvas");
  const lasso = document.getElementById("lasso-overlay");
  const textLayer = document.getElementById("text-layer");

  const applySize = (w, h) => {
    [bgImg, ink, lasso, textLayer].forEach((el) => {
      el.style.width = w + "px";
      el.style.height = h + "px";
    });
    ink.width = w;
    ink.height = h;
    lasso.width = w;
    lasso.height = h;
  };

  if (tmpl && tmpl.img) {
    bgImg.onload = () => applySize(bgImg.naturalWidth, bgImg.naturalHeight);
    bgImg.src = tmpl.img;
  } else {
    bgImg.onload = null;
    bgImg.src = gridPaperDataUri();
    applySize(1000, 1400);
  }
}

function activateNote(id) {
  state.activeNoteId = id;
  renderTabs();
  applyNoteTemplate(id);
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
      const note = { id: uid(), name: result.name, folderId: state.currentFolderId, trashed: false, templateId: result.templateId };
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
function initToolbar() {
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  document.querySelector('.tool-btn[data-tool="select"]').classList.add("active");

  const thicknessRange = document.getElementById("thickness-range");
  const thicknessValue = document.getElementById("thickness-value");
  thicknessRange.addEventListener("input", () => { thicknessValue.textContent = thicknessRange.value + "px"; });

  const swatchWrap = document.getElementById("color-swatches");
  PALETTE.forEach((color, i) => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (i === 0 ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
      document.getElementById("color-picker").value = color;
    });
    swatchWrap.appendChild(sw);
  });
  document.getElementById("color-picker").addEventListener("input", () => {
    document.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
  });
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
    });
    thumb.appendChild(del);
    thumb.addEventListener("click", () => { state.settings.defaultTemplateId = t.id; renderTemplateList(); });

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
    });
    chip.appendChild(del);
    chip.addEventListener("click", () => { state.settings.defaultFontId = f.id; renderFontList(); });
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
    const buf = await file.arrayBuffer();
    const family = "customFont_" + uid();
    const face = new FontFace(family, buf);
    const loaded = await face.load();
    document.fonts.add(loaded);
    state.fonts.push({ id: uid(), name: file.name.replace(/\.ttf$/i, ""), family });
    renderFontList();
  } catch (err) {
    console.error(err);
    alert("폰트를 불러오지 못했습니다. TTF 파일이 맞는지 확인해주세요. (" + err.message + ")");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function initSettings() {
  renderTemplateList();
  renderFontList();

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
  thresholdRange.addEventListener("input", () => { thresholdValue.textContent = thresholdRange.value + "%"; });
}

// ---------- 전체 다시 그리기 ----------
function renderAll() {
  renderFolderTree();
  renderGrid();
}

// ---------- 초기화 ----------
document.addEventListener("DOMContentLoaded", () => {
  loadBundledFonts();

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
  initToolbar();

  renderAll();
  switchView("list");
});
