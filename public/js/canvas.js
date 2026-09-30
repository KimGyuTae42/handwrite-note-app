// ============ 필기 캔버스 엔진 ============
// note.strokes : [{id, tool, color, width, opacity, points:[{x,y}], groupId, converted}]
// note.texts   : [{id, x, y, w, h, text, color, fontFamily, fontSize}]

class InkEngine {
  constructor(canvasEl, overlayEl, textLayerEl, stageEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.overlay = overlayEl;
    this.octx = overlayEl.getContext("2d");
    this.textLayer = textLayerEl;
    this.stage = stageEl; // 확대/축소 변환이 적용되는 래퍼(펜/터치 좌표 계산에는 영향 없음)

    this.note = null;
    this.tool = "pen-fountain";
    this.color = "#111111";
    this.width = 4;

    this.drawing = false;
    this.currentStroke = null;
    this.lassoPoints = null;
    this.selection = { strokeIds: new Set(), textIds: new Set() };
    this.dragStart = null;
    this.dragOrigPositions = null;
    this.selectedTextBoxId = null; // 클릭으로 선택된 텍스트박스 (이동/크기조절 대상)
    this.editingTextId = null; // 더블클릭으로 편집(타이핑) 중인 텍스트박스

    // 팜 리젝션 / 핀치줌 상태
    this.penActive = false; // Apple Pencil 등 펜이 현재 눌려있는지
    this.activeTouches = new Map(); // pointerId -> {x,y} (touch만)
    this.pinchActive = false;
    this.pinchStart = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.onZoomChange = null; // callback(zoom)

    this.groupTimers = new Map(); // groupId -> timeout
    this.lastGroupId = null;
    this.lastStrokeEndTime = 0;
    this.lastStrokeBBox = null;

    this.undoStack = [];
    this.redoStack = [];

    this.onGroupReady = null; // callback(groupId)
    this.onChange = null; // callback() - fired after any mutation, for autosave

    this._bindEvents();
  }

  setNote(note) {
    this.note = note;
    this.selection.strokeIds.clear();
    this.selection.textIds.clear();
    this.selectedTextBoxId = null;
    this.editingTextId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.resetZoom();
    this.redrawAll();
  }

  resetZoom() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._applyZoomTransform();
  }

  _applyZoomTransform() {
    if (this.stage) {
      this.stage.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
    if (this.onZoomChange) this.onZoomChange(this.zoom);
  }

  resize(w, h) {
    for (const c of [this.canvas, this.overlay]) {
      c.width = w;
      c.height = h;
    }
    this.redrawAll();
  }

  // ---------- 스냅샷 (undo/redo) ----------
  snapshot() {
    if (!this.note) return;
    this.undoStack.push(JSON.stringify({ strokes: this.note.strokes, texts: this.note.texts }));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length || !this.note) return;
    const cur = JSON.stringify({ strokes: this.note.strokes, texts: this.note.texts });
    this.redoStack.push(cur);
    const prev = JSON.parse(this.undoStack.pop());
    this.note.strokes = prev.strokes;
    this.note.texts = prev.texts;
    this.redrawAll();
    this._fireChange();
  }

  redo() {
    if (!this.redoStack.length || !this.note) return;
    const cur = JSON.stringify({ strokes: this.note.strokes, texts: this.note.texts });
    this.undoStack.push(cur);
    const next = JSON.parse(this.redoStack.pop());
    this.note.strokes = next.strokes;
    this.note.texts = next.texts;
    this.redrawAll();
    this._fireChange();
  }

  _fireChange() {
    if (this.onChange) this.onChange();
  }

  // ---------- 좌표 ----------
  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    // rect는 확대/축소(transform: scale) 이후의 화면상 크기이므로, 캔버스 내부 실제
    // 해상도(this.canvas.width/height) 비율로 환산해야 줌 상태와 무관하게 정확한 좌표가 나옵니다.
    // pressure: Apple Pencil/S Pen처럼 실제 필압을 지원하는 기기는 0~1 사이 값을 주고,
    // 마우스/무압력 터치는 눌려있는 동안 0.5로 고정된 값을 줍니다(Pointer Events 스펙).
    const pressure = typeof e.pressure === "number" ? e.pressure : 0.5;
    return {
      x: (cx - rect.left) * (this.canvas.width / rect.width),
      y: (cy - rect.top) * (this.canvas.height / rect.height),
      pressure,
    };
  }

  // ---------- 이벤트 바인딩 ----------
  _bindEvents() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => this._pointerDown(e));
    window.addEventListener("pointermove", (e) => this._pointerMove(e));
    window.addEventListener("pointerup", (e) => this._pointerUp(e));
    window.addEventListener("pointercancel", (e) => this._pointerUp(e));
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement.tagName !== "INPUT" &&
          !document.activeElement.classList.contains("text-el")) {
        if (this.selection.strokeIds.size || this.selection.textIds.size) {
          e.preventDefault();
          this.deleteSelection();
        } else if (this.selectedTextBoxId && !this.editingTextId) {
          e.preventDefault();
          this.snapshot();
          this.note.texts = this.note.texts.filter((t) => t.id !== this.selectedTextBoxId);
          this.selectedTextBoxId = null;
          this.redrawAll();
          this._fireChange();
        }
      }
    });
  }

  // 터치 접촉 면적(CSS px 기준)이 이보다 크면 손가락이 아니라 손바닥일 가능성이 높다고 보고 무시합니다.
  // (기기마다 편차가 있어 보수적으로 잡은 값 - 필요하면 조정 가능)
  static PALM_CONTACT_THRESHOLD = 70;

  _looksLikePalm(e) {
    const w = e.width || 0;
    const h = e.height || 0;
    return Math.max(w, h) > InkEngine.PALM_CONTACT_THRESHOLD;
  }

  // ---------- 팜 리젝션 / 핀치줌 게이팅 ----------
  // 실제 그리기 로직(_handleDrawPointerDown)으로 넘기기 전에, 입력이 펜인지/터치인지에
  // 따라 걸러냅니다: 펜 사용 중엔 터치를 전부 무시(팜 리젝션), 터치가 2개 이상이면
  // 그리기 대신 핀치줌으로 처리합니다.
  _pointerDown(e) {
    if (!this.note) return;

    if (e.pointerType === "pen") {
      this.penActive = true;
      this._handleDrawPointerDown(e);
      return;
    }

    if (e.pointerType === "touch") {
      if (this.penActive) return; // 펜으로 쓰는 중엔 손바닥 등 터치를 무시

      if (this.activeTouches.size === 0 && this._looksLikePalm(e)) {
        return; // 첫 접촉부터 접촉 면적이 비정상적으로 크면(손바닥 추정) 아예 무시
      }

      this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activeTouches.size === 1) {
        this._handleDrawPointerDown(e); // 손가락 한 개 = 필기로 간주
        return;
      }
      if (this.activeTouches.size === 2) {
        this._cancelInProgressStroke(); // 방금 손가락 하나로 시작됐던 획은 취소
        this._startPinch();
        return;
      }
      return; // 손가락 3개 이상은 무시
    }

    this._handleDrawPointerDown(e); // 마우스 등
  }

  _cancelInProgressStroke() {
    if (this.currentStroke) {
      this.note.strokes = this.note.strokes.filter((s) => s !== this.currentStroke);
      this.currentStroke = null;
    }
    this.lassoPoints = null;
    this.dragStart = null;
    this.drawing = false;
    this._clearOverlay();
    this.redrawAll();
  }

  _startPinch() {
    const pts = Array.from(this.activeTouches.values());
    const [a, b] = pts;
    this.pinchActive = true;
    this.pinchStart = {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  _updatePinch() {
    const pts = Array.from(this.activeTouches.values());
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const s = this.pinchStart;

    this.zoom = Math.min(4, Math.max(0.5, s.zoom * (dist / s.dist)));
    this.panX = s.panX + (midX - s.midX);
    this.panY = s.panY + (midY - s.midY);
    this._applyZoomTransform();
  }

  _handleDrawPointerDown(e) {
    const p = this._getPos(e);

    // 캔버스(빈 공간)를 클릭하면 선택된/편집 중이던 텍스트박스는 해제
    if (this.selectedTextBoxId || this.editingTextId) {
      this.selectedTextBoxId = null;
      this.editingTextId = null;
      this.redrawAll();
    }

    if (this.tool === "lasso") {
      // 이미 선택된 영역 안을 클릭하면 드래그 이동 시작
      if (this._pointInSelection(p)) {
        this.dragStart = p;
        this.dragOrigPositions = this._captureSelectionPositions();
        return;
      }
      this.selection.strokeIds.clear();
      this.selection.textIds.clear();
      this.lassoPoints = [p];
      this.drawing = true;
      return;
    }

    if (this.tool === "eraser") {
      this.snapshot();
      this.drawing = true;
      this.eraseAt(p.x, p.y, this.width * 2);
      return;
    }

    if (this.tool === "select") {
      return; // 텍스트 요소는 자체 DOM 클릭으로 편집
    }

    // 펜류 (fountain / brush / highlighter)
    this.snapshot();
    this.drawing = true;
    const isHighlight = this.tool === "highlighter";
    const groupId = isHighlight ? null : this._resolveGroupId(p);
    this.currentStroke = {
      id: uid(),
      tool: this.tool,
      color: this.color,
      width: isHighlight ? Math.max(this.width * 2.2, 14) : this.width,
      opacity: isHighlight ? 0.35 : this.tool === "pen-brush" ? 0.9 : 1,
      points: [p],
      groupId,
      converted: false,
      pointerType: e.pointerType, // "pen"이면 필압 기반으로 두께를 다르게 그림
    };
    this.note.strokes.push(this.currentStroke);
    this._drawStroke(this.currentStroke);
  }

  _pointerMove(e) {
    if (e.pointerType === "touch") {
      if (this.penActive) return; // 팜 리젝션: 펜 사용 중엔 손가락 입력 무시

      if (this.activeTouches.has(e.pointerId)) {
        this.activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this.activeTouches.size >= 2) {
        if (this.pinchActive) this._updatePinch();
        return; // 손가락이 2개 이상이면 그리기는 절대 진행하지 않음
      }
    }

    if (!this.drawing || !this.note) return;
    const p = this._getPos(e);

    if (this.tool === "lasso") {
      if (this.dragStart) {
        const dx = p.x - this.dragStart.x, dy = p.y - this.dragStart.y;
        this._applyDrag(dx, dy);
        return;
      }
      if (this.lassoPoints) {
        this.lassoPoints.push(p);
        this._drawLassoPreview();
      }
      return;
    }

    if (this.tool === "eraser") {
      // getCoalescedEvents: 브라우저가 화면 주사율에 맞춰 pointermove를 줄여 보내더라도,
      // 펜/터치 하드웨어가 실제로 감지한 중간 지점들을 전부 받아와서 빠르게 지울 때 빈틈이 안 생기게 함
      for (const ev of this._eventsFor(e)) {
        const pp = this._getPos(ev);
        this.eraseAt(pp.x, pp.y, this.width * 2);
      }
      return;
    }

    if (this.currentStroke) {
      // 위와 같은 이유로, 실제 하드웨어 샘플을 전부 점으로 남겨야 (특히 빠르게 휘갈겨 쓸 때)
      // 선이 뚝뚝 끊기지 않고 부드럽게 이어집니다. (Apple Pencil, S Pen 모두 지원)
      for (const ev of this._eventsFor(e)) {
        this.currentStroke.points.push(this._getPos(ev));
      }
      this.redrawAll(); // 단순하지만 안정적인 재렌더링
    }
  }

  // pointermove 이벤트 하나에 딸려온(브라우저가 합쳐 보낸) 실제 하드웨어 샘플들을 꺼내옵니다.
  // 지원 안 하는 브라우저에서는 이벤트 자기 자신만 담긴 배열을 돌려줍니다.
  _eventsFor(e) {
    if (typeof e.getCoalescedEvents === "function") {
      const list = e.getCoalescedEvents();
      if (list && list.length) return list;
    }
    return [e];
  }

  _pointerUp(e) {
    if (e.pointerType === "pen") {
      this.penActive = false;
    }
    if (e.pointerType === "touch") {
      this.activeTouches.delete(e.pointerId);
      if (this.activeTouches.size < 2) {
        this.pinchActive = false;
        this.pinchStart = null;
      }
      if (this.activeTouches.size > 0) return; // 손가락이 아직 남아있으면(핀치 종료 등) 그리기 마무리 로직은 건너뜀
    }

    if (!this.note) return;

    if (this.tool === "lasso") {
      if (this.dragStart) {
        this.dragStart = null;
        this.dragOrigPositions = null;
        this._fireChange();
        return;
      }
      if (this.lassoPoints && this.lassoPoints.length > 2) {
        this._finishLasso();
      }
      this.lassoPoints = null;
      this.drawing = false;
      this._clearOverlay();
      return;
    }

    if (this.tool === "eraser") {
      this.drawing = false;
      this._fireChange();
      return;
    }

    if (this.currentStroke) {
      const s = this.currentStroke;
      if (s.points.length < 2) s.points.push({ x: s.points[0].x + 0.1, y: s.points[0].y + 0.1 });
      this.lastGroupId = s.groupId;
      this.lastStrokeEndTime = Date.now();
      this.lastStrokeBBox = this._bboxOfPoints(s.points);
      this.currentStroke = null;
      this.drawing = false;

      if (s.groupId) this._scheduleRecognition(s.groupId);
      this._fireChange();
    }
  }

  // ---------- 그룹핑 로직 ----------
  _resolveGroupId(p) {
    const now = Date.now();
    const timeOk = now - this.lastStrokeEndTime < 1300;
    let distOk = false;
    if (this.lastStrokeBBox) {
      const b = this.lastStrokeBBox;
      const cx = Math.max(b.x - 60, Math.min(p.x, b.x + b.w + 60));
      const cy = Math.max(b.y - 40, Math.min(p.y, b.y + b.h + 40));
      distOk = cx === p.x && cy === p.y; // p가 확장된 bbox 안에 있으면 true
    }
    if (this.lastGroupId && timeOk && distOk) return this.lastGroupId;
    return uid();
  }

  _bboxOfPoints(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, w: Math.max(maxX - minX, 4), h: Math.max(maxY - minY, 4) };
  }

  _scheduleRecognition(groupId) {
    if (this.groupTimers.has(groupId)) clearTimeout(this.groupTimers.get(groupId));
    const t = setTimeout(() => {
      this.groupTimers.delete(groupId);
      if (this.onGroupReady) this.onGroupReady(groupId);
    }, 800);
    this.groupTimers.set(groupId, t);
  }

  // 지금 바로 미변환 그룹 전체 인식 (수동 변환 버튼)
  convertAllPending() {
    const groupIds = new Set();
    for (const s of this.note.strokes) {
      if (s.groupId && !s.converted) groupIds.add(s.groupId);
    }
    groupIds.forEach((gid) => {
      if (this.groupTimers.has(gid)) { clearTimeout(this.groupTimers.get(gid)); this.groupTimers.delete(gid); }
      if (this.onGroupReady) this.onGroupReady(gid);
    });
    return groupIds.size;
  }

  // groupId에 속한 미변환 스트로크들의 bbox
  groupBBox(groupId) {
    const pts = [];
    for (const s of this.note.strokes) {
      if (s.groupId === groupId && !s.converted) pts.push(...s.points);
    }
    if (!pts.length) return null;
    return this._bboxOfPoints(pts);
  }

  // 그룹을 텍스트로 교체
  replaceGroupWithText(groupId, text, fontFamily) {
    this.snapshot();
    const bbox = this.groupBBox(groupId);
    if (!bbox) return;
    let color = this.color;
    for (const s of this.note.strokes) {
      if (s.groupId === groupId && !s.converted) { color = s.color; s.converted = true; }
    }
    this.note.strokes = this.note.strokes.filter((s) => !(s.groupId === groupId && s.converted));
    this.note.texts.push({
      id: uid(),
      x: bbox.x,
      y: bbox.y - bbox.h * 0.15,
      w: Math.max(bbox.w * 1.15, 40),
      h: bbox.h * 1.4,
      text,
      color,
      fontFamily: fontFamily || "inherit",
      fontSize: Math.max(bbox.h * 0.85, 12),
    });
    this.redrawAll();
    this._fireChange();
  }

  // 그룹을 그대로 유지 (낮은 신뢰도) - 다음 그룹 판정에 영향 없도록 groupId 소멸
  keepGroupAsInk(groupId) {
    for (const s of this.note.strokes) {
      if (s.groupId === groupId) s.groupId = null;
    }
  }

  // ---------- 지우개 ----------
  eraseAt(x, y, radius) {
    let changed = false;
    const result = [];
    for (const s of this.note.strokes) {
      const runs = [[]];
      let local = false;
      for (const p of s.points) {
        if (Math.hypot(p.x - x, p.y - y) <= radius) {
          local = true;
          if (runs[runs.length - 1].length) runs.push([]);
        } else runs[runs.length - 1].push(p);
      }
      if (!local) { result.push(s); continue; }
      changed = true;
      for (const run of runs) if (run.length > 1) result.push({ ...s, id: uid(), points: run });
    }
    if (changed) this.note.strokes = result;

    const remainTexts = this.note.texts.filter((t) => {
      const hit = x >= t.x - 4 && x <= t.x + t.w + 4 && y >= t.y - 4 && y <= t.y + t.h + 4;
      return !hit;
    });
    if (remainTexts.length !== this.note.texts.length) { this.note.texts = remainTexts; changed = true; }

    if (changed) this.redrawAll();
  }

  // ---------- 올가미 ----------
  _drawLassoPreview() {
    this._clearOverlay();
    const ctx = this.octx;
    ctx.save();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    this.lassoPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  _finishLasso() {
    const path = new Path2D();
    this.lassoPoints.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    path.closePath();
    const ctx = this.octx;

    for (const s of this.note.strokes) {
      const c = this._centerOf(s.points);
      if (ctx.isPointInPath(path, c.x, c.y)) this.selection.strokeIds.add(s.id);
    }
    for (const t of this.note.texts) {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      if (ctx.isPointInPath(path, cx, cy)) this.selection.textIds.add(t.id);
    }
    this.redrawAll();
  }

  _centerOf(points) {
    let sx = 0, sy = 0;
    for (const p of points) { sx += p.x; sy += p.y; }
    return { x: sx / points.length, y: sy / points.length };
  }

  _pointInSelection(p) {
    if (!this.selection.strokeIds.size && !this.selection.textIds.size) return false;
    const box = this._selectionBBox();
    if (!box) return false;
    return p.x >= box.x - 10 && p.x <= box.x + box.w + 10 && p.y >= box.y - 10 && p.y <= box.y + box.h + 10;
  }

  _selectionBBox() {
    let pts = [];
    for (const s of this.note.strokes) if (this.selection.strokeIds.has(s.id)) pts.push(...s.points);
    for (const t of this.note.texts) if (this.selection.textIds.has(t.id)) {
      pts.push({ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.h });
    }
    if (!pts.length) return null;
    return this._bboxOfPoints(pts);
  }

  _captureSelectionPositions() {
    return {
      strokes: this.note.strokes.filter((s) => this.selection.strokeIds.has(s.id)).map((s) => s.points.map((p) => ({ ...p }))),
      texts: this.note.texts.filter((t) => this.selection.textIds.has(t.id)).map((t) => ({ x: t.x, y: t.y })),
    };
  }

  _applyDrag(dx, dy) {
    let si = 0;
    for (const s of this.note.strokes) {
      if (!this.selection.strokeIds.has(s.id)) continue;
      const orig = this.dragOrigPositions.strokes[si++];
      s.points = orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    let ti = 0;
    for (const t of this.note.texts) {
      if (!this.selection.textIds.has(t.id)) continue;
      const orig = this.dragOrigPositions.texts[ti++];
      t.x = orig.x + dx; t.y = orig.y + dy;
    }
    this.redrawAll();
  }

  deleteSelection() {
    if (!this.selection.strokeIds.size && !this.selection.textIds.size) return;
    this.snapshot();
    this.note.strokes = this.note.strokes.filter((s) => !this.selection.strokeIds.has(s.id));
    this.note.texts = this.note.texts.filter((t) => !this.selection.textIds.has(t.id));
    this.selection.strokeIds.clear();
    this.selection.textIds.clear();
    this.redrawAll();
    this._fireChange();
  }

  _clearOverlay() {
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  // ---------- 렌더링 ----------
  _drawStroke(s) {
    const ctx = this.ctx;
    const pts = s.points;
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.tool === "highlighter") ctx.globalCompositeOperation = "multiply";

    if (s.pointerType === "pen") {
      // Apple Pencil / S Pen: 구간마다 필압(pressure)에 따라 두께를 다르게 그려서
      // 진짜 손글씨처럼 힘 주는 대로 굵기가 변하게 함
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const pressure = ((p0.pressure ?? 0.5) + (p1.pressure ?? 0.5)) / 2;
        ctx.lineWidth = Math.max(0.6, s.width * (0.4 + pressure));
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    } else {
      // 마우스/일반 터치: 점들을 부드러운 곡선(2차 베지어)으로 이어서 각져 보이지 않게 함
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    }

    ctx.restore();
  }

  redrawAll() {
    if (!this.note) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // highlighter는 먼저 그려서 다른 잉크 밑에 깔리게
    for (const s of this.note.strokes) if (s.tool === "highlighter") this._drawStroke(s);
    for (const s of this.note.strokes) if (s.tool !== "highlighter") this._drawStroke(s);
    if (this.currentStroke) this._drawStroke(this.currentStroke);

    // 선택 표시
    this._clearOverlay();
    const box = this._selectionBBox();
    if (box) {
      const ctx = this.octx;
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
      ctx.restore();
    }

    this._renderTextLayer();
  }

  _renderTextLayer() {
    this.textLayer.innerHTML = "";
    for (const t of this.note.texts) {
      const isEditing = this.editingTextId === t.id;
      const isSelected = this.selectedTextBoxId === t.id;

      const box = document.createElement("div");
      box.className = "text-box" + (isSelected ? " selected" : "") + (isEditing ? " editing" : "");
      box.style.left = t.x + "px";
      box.style.top = t.y + "px";
      box.style.width = t.w + "px";
      box.style.height = t.h + "px";

      const content = document.createElement("div");
      content.className = "text-el";
      content.contentEditable = isEditing ? "true" : "false";
      content.spellcheck = false;
      content.style.color = t.color;
      content.style.fontFamily = t.fontFamily;
      content.style.fontSize = t.fontSize + "px";
      content.textContent = t.text;
      content.addEventListener("input", () => {
        t.text = content.textContent;
        this._fireChange();
      });
      content.addEventListener("blur", () => {
        if (this.editingTextId === t.id) {
          this.editingTextId = null;
          this.redrawAll();
          this._fireChange();
        }
      });
      content.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._enterTextEditMode(t.id);
      });
      box.appendChild(content);

      const handle = document.createElement("div");
      handle.className = "resize-handle";
      box.appendChild(handle);

      box.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (e.target === handle) {
          this._startResizeText(t, e);
          return;
        }
        if (isEditing) return; // 편집 중이면 평소처럼 클릭해서 커서 위치 이동
        this._selectTextBox(t.id);
        this._startDragText(t, e);
      });

      this.textLayer.appendChild(box);
    }

    if (this.editingTextId) {
      const el = this.textLayer.querySelector(".text-box.editing .text-el");
      if (el) {
        el.focus();
        this._placeCaretAtEnd(el);
      }
    }
  }

  _selectTextBox(id) {
    if (this.selectedTextBoxId === id && !this.editingTextId) return; // 이미 선택돼 있으면 다시 그리지 않음(더블클릭 인식 보존)
    this.selectedTextBoxId = id;
    this.editingTextId = null;
    this.redrawAll();
  }

  _enterTextEditMode(id) {
    this.selectedTextBoxId = null;
    this.editingTextId = id;
    this.redrawAll();
  }

  _placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _startDragText(t, e) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = t.x;
    const origY = t.y;
    let moved = false;
    const onMove = (ev) => {
      if (!moved) { this.snapshot(); moved = true; }
      t.x = origX + (ev.clientX - startX);
      t.y = origY + (ev.clientY - startY);
      this.redrawAll();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) this._fireChange();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  _startResizeText(t, e) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = t.w;
    const origH = t.h;
    const origFont = t.fontSize;
    let moved = false;
    const onMove = (ev) => {
      if (!moved) { this.snapshot(); moved = true; }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      t.w = Math.max(24, origW + dx);
      t.h = Math.max(14, origH + dy);
      t.fontSize = Math.max(8, origFont * (t.h / origH));
      this.redrawAll();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) this._fireChange();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
}
