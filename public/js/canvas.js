// ============ 필기 캔버스 엔진 ============
// note.strokes : [{id, tool, color, width, opacity, points:[{x,y}], groupId, converted}]
// note.texts   : [{id, x, y, w, h, text, color, fontFamily, fontSize}]

class InkEngine {
  constructor(canvasEl, overlayEl, textLayerEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.overlay = overlayEl;
    this.octx = overlayEl.getContext("2d");
    this.textLayer = textLayerEl;

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
    this.undoStack = [];
    this.redoStack = [];
    this.redrawAll();
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
    return { x: cx - rect.left, y: cy - rect.top };
  }

  // ---------- 이벤트 바인딩 ----------
  _bindEvents() {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => this._pointerDown(e));
    window.addEventListener("pointermove", (e) => this._pointerMove(e));
    window.addEventListener("pointerup", (e) => this._pointerUp(e));
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement.tagName !== "INPUT" &&
          !document.activeElement.classList.contains("text-el")) {
        if (this.selection.strokeIds.size || this.selection.textIds.size) {
          e.preventDefault();
          this.deleteSelection();
        }
      }
    });
  }

  _pointerDown(e) {
    if (!this.note) return;
    const p = this._getPos(e);

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
    };
    this.note.strokes.push(this.currentStroke);
    this._drawStroke(this.currentStroke);
  }

  _pointerMove(e) {
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
      this.eraseAt(p.x, p.y, this.width * 2);
      return;
    }

    if (this.currentStroke) {
      this.currentStroke.points.push(p);
      this.redrawAll(); // 단순하지만 안정적인 재렌더링
    }
  }

  _pointerUp(e) {
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
    if (s.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.tool === "highlighter") ctx.globalCompositeOperation = "multiply";
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
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
      const div = document.createElement("div");
      div.className = "text-el";
      div.contentEditable = "true";
      div.spellcheck = false;
      div.style.left = t.x + "px";
      div.style.top = t.y + "px";
      div.style.minWidth = t.w + "px";
      div.style.color = t.color;
      div.style.fontFamily = t.fontFamily;
      div.style.fontSize = t.fontSize + "px";
      div.textContent = t.text;
      div.addEventListener("input", () => {
        t.text = div.textContent;
        this._fireChange();
      });
      div.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.textLayer.appendChild(div);
    }
  }
}
