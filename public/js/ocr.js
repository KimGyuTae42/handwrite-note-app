// ============ 인식(OCR) 모듈 ============
// 지금은 Tesseract.js(한글+영어+숫자+기호 인식 가능)를 사용합니다.
// 나중에 5~6차시에서 직접 CNN 모델을 만들면, recognizeCanvasRegion() 함수의
// 내부 구현만 그 모델을 호출하는 코드로 바꿔치기하면 됩니다.
// (반환값 형태 {text, confidence(0~100)} 만 유지하면 나머지 코드는 그대로 동작합니다.)

async function recognizeCanvasRegion(sourceCanvas, bbox, padding = 14) {
  const x = Math.max(0, bbox.x - padding);
  const y = Math.max(0, bbox.y - padding);
  const w = Math.min(sourceCanvas.width - x, bbox.w + padding * 2);
  const h = Math.min(sourceCanvas.height - y, bbox.h + padding * 2);
  if (w <= 2 || h <= 2) return { text: "", confidence: 0 };

  const scale = 3; // 작은 손글씨 영역을 확대해서 인식률을 높임
  const off = document.createElement("canvas");
  off.width = Math.round(w * scale);
  off.height = Math.round(h * scale);
  const octx = off.getContext("2d");
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, off.width, off.height);
  octx.imageSmoothingEnabled = true;
  octx.drawImage(sourceCanvas, x, y, w, h, 0, 0, off.width, off.height);

  try {
    const result = await Tesseract.recognize(off, "eng+kor", { logger: () => {} });
    const text = (result.data.text || "").trim();
    const confidence = result.data.confidence || 0;
    return { text, confidence };
  } catch (err) {
    console.error("OCR 오류:", err);
    return { text: "", confidence: 0 };
  }
}
