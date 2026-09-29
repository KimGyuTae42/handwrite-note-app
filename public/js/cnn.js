// ============ CNN 손글씨 인식 모듈 ============
// training/ 폴더에서 직접 학습시킨 모델(102개 클래스: 한글 자모/영문/숫자/기호)을
// 사용합니다. Tesseract.js보다 이 프로젝트의 손글씨 스타일에 특화되어 있어 먼저
// 시도하고, 신뢰도가 낮으면 app.js에서 Tesseract.js로 한 번 더 시도합니다.
//
// 처리 순서: 그룹 영역을 잘라서 → 세로 방향 잉크가 없는 구간(칸)을 기준으로
// 글자 하나씩 분리 → 각 글자를 32x32로 맞춰 모델에 통과 → 예측된 문자를 이어붙임.
// (붙여 쓴 필기체처럼 글자가 서로 붙어있으면 분리가 안 될 수 있습니다 - 프로토타입 한계)

let cnnModel = null;
let cnnClasses = null;
let cnnLoadPromise = null;

function initCNN() {
  if (!window.tf) {
    console.warn("[CNN] tf.js가 로드되지 않아 CNN 인식을 사용할 수 없습니다. (Tesseract만 사용)");
    return Promise.resolve(null);
  }
  cnnLoadPromise = (async () => {
    try {
      const [model, classes] = await Promise.all([
        tf.loadLayersModel("assets/model/handwriting-cnn/model.json"),
        fetch("assets/model/handwriting-cnn/classes.json").then((r) => r.json()),
      ]);
      cnnModel = model;
      cnnClasses = classes;
      console.log(`[CNN] 모델 로드 완료 (${classes.classNames.length}개 클래스)`);
      return model;
    } catch (e) {
      console.error("[CNN] 모델 로드 실패:", e);
      return null;
    }
  })();
  return cnnLoadPromise;
}

// 그룹 영역 안에서 세로줄 기준으로 잉크가 끊기는 지점을 찾아 글자 단위 박스로 분리
function extractGlyphBoxes(sourceCanvas, bbox, padding = 6) {
  const x = Math.max(0, Math.floor(bbox.x - padding));
  const y = Math.max(0, Math.floor(bbox.y - padding));
  const w = Math.min(sourceCanvas.width - x, Math.ceil(bbox.w + padding * 2));
  const h = Math.min(sourceCanvas.height - y, Math.ceil(bbox.h + padding * 2));
  if (w <= 1 || h <= 1) return [];

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, w, h);
  octx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  const data = octx.getImageData(0, 0, w, h).data;

  const colHasInk = new Array(w).fill(false);
  for (let cx = 0; cx < w; cx++) {
    for (let cy = 0; cy < h; cy++) {
      const idx = (cy * w + cx) * 4;
      const a = data[idx + 3];
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (a > 10 && brightness < 200) {
        colHasInk[cx] = true;
        break;
      }
    }
  }

  const minGap = Math.max(2, Math.round(h * 0.06));
  const segments = [];
  let start = -1;
  let gapRun = 0;
  for (let cx = 0; cx < w; cx++) {
    if (colHasInk[cx]) {
      if (start === -1) start = cx;
      gapRun = 0;
    } else if (start !== -1) {
      gapRun++;
      if (gapRun >= minGap) {
        segments.push([start, cx - gapRun]);
        start = -1;
        gapRun = 0;
      }
    }
  }
  if (start !== -1) segments.push([start, w - 1]);

  return segments
    .filter(([s, e]) => e >= s)
    .map(([s, e]) => ({ x: x + s, y, w: Math.max(1, e - s + 1), h }));
}

async function recognizeWithCNN(sourceCanvas, bbox) {
  if (!cnnModel || !cnnClasses) return null;
  const glyphBoxes = extractGlyphBoxes(sourceCanvas, bbox);
  if (!glyphBoxes.length) return { text: "", confidence: 0 };

  const size = cnnClasses.imageSize || 32;
  let text = "";
  let confSum = 0;

  for (const g of glyphBoxes) {
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    octx.fillStyle = "#fff";
    octx.fillRect(0, 0, size, size);

    // 학습 전처리와 동일하게: 정사각형 비율을 유지하며 가운데 정렬해서 리사이즈
    const side = Math.max(g.w, g.h);
    const scale = size / side;
    const scaledW = g.w * scale;
    const scaledH = g.h * scale;
    const dx = (size - scaledW) / 2;
    const dy = (size - scaledH) / 2;
    octx.drawImage(sourceCanvas, g.x, g.y, g.w, g.h, dx, dy, scaledW, scaledH);

    const { displayChar, confidence } = tf.tidy(() => {
      let t = tf.browser.fromPixels(off, 1).toFloat().div(255);
      t = tf.sub(1, t); // 잉크=1, 배경=0 (학습 때와 동일)
      t = t.expandDims(0);
      const pred = cnnModel.predict(t);
      const probs = pred.dataSync();
      let maxIdx = 0;
      let maxP = -1;
      for (let i = 0; i < probs.length; i++) {
        if (probs[i] > maxP) { maxP = probs[i]; maxIdx = i; }
      }
      return { displayChar: cnnClasses.displayChars[maxIdx], confidence: maxP * 100 };
    });

    text += displayChar;
    confSum += confidence;
  }

  return { text, confidence: glyphBoxes.length ? confSum / glyphBoxes.length : 0 };
}
