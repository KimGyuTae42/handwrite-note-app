# 손글씨 인식 CNN - 학습 과정

Tesseract.js(범용 OCR) 대신, 이 프로젝트 전용으로 직접 학습시킨 CNN입니다.
`public/assets/model/handwriting-cnn/`에 결과물이 들어있고, 앱은 이 모델을 1순위로
쓰고(신뢰도가 기준 미만이면) Tesseract.js를 보조로 사용합니다.

## 1. 사용한 데이터

업로드해주신 4개 데이터셋 중 2개를 사용했습니다:

| 파일 | 데이터셋 | 사용 여부 |
|---|---|---|
| `archive.zip` | 한글 자모 손글씨 (hangul_characters_v1) | ✅ 사용 |
| `archive__2_.zip` | HASY v2 (손글씨 기호/숫자/영문자 32×32) | ✅ 사용 |
| `archive__1_.zip` | 숫자 손글씨 (augmented, 0~9) | ❌ 미사용 |
| `archive__3_.zip` | CROHME류 수식 기호 데이터셋 (4GB+) | ❌ 미사용 |

**미사용 이유**: `archive__2_`(HASY)에 숫자·기호가 이미 포함돼 있어 역할이 겹치고,
`archive__1_`/`archive__3_`은 용량이 매우 커서(각각 수백 MB~수 GB) 이 환경의 시간·디스크
제약상 이번엔 포함하지 않았습니다. 나중에 클래스를 늘리고 싶으면 `1_preprocess.py`에
같은 방식으로 로더를 추가해서 재학습하면 됩니다 (아래 "재학습/확장" 참고).

## 2. 최종 클래스 (102개)

- 한글 자모 30개: ㄱㄲㄴㄷㄹㅁㅂㅃㅅㅆㅇㅈㅊㅋㅌㅍㅎ, ㅏㅐㅑㅒㅓㅔㅗㅛㅜㅠㅡㅣㅖ
- 영문 대문자 26개(A~Z), 소문자 26개(a~z)
- 숫자 10개(0~9)
- 기호 10개: `+ - < > [ ] { } | /`

> 완성형 한글(가, 나, 힣 같은 음절 전체)은 학습하지 않았습니다 — 조합 가능한 음절 수가
> 11,000개가 넘어서 이번 범위를 벗어납니다. 지금은 **자모 단위**로 인식해서 화면에는
> 낱자(ㄱ, ㅏ 등)로 표시됩니다. 완성형 음절 인식은 별도 프로젝트급 작업이라 다음 단계로
> 남겨두는 게 좋습니다.

## 3. 전처리 (`1_preprocess.py`)
- 각 이미지를 그레이스케일로 읽고, 정사각형으로 패딩한 뒤 32×32로 리사이즈
- 학습 직전 흑백 반전 정규화(잉크=1, 배경=0)를 적용해 손글씨 신경망 관례를 따름
- 클래스당 최대 300장으로 제한(실제로는 클래스마다 10~150장 정도로 꽤 불균형함)
- 최종 13,023장 → `dataset_processed/images.bin`, `labels.bin`, `classes.json`

## 4. 데이터 증강 + 모델 구조 (`2_train.py`) — v2에서 개선된 부분

처음 모델(train/val 정확도 93.6%/83.2%)을 보니 클래스 불균형이 가장 큰 약점이었습니다
(적은 클래스는 10장밖에 없어서 검증 정확도를 깎아먹음). 그래서:

- **데이터 증강**: 검증셋을 먼저 떼어놓은 뒤(원본만, 증강 안 함), 학습셋에서
  - 모든 이미지마다 회전(±12°)·이동(±2px)·확대축소(0.9~1.1배)를 적용한 증강본을 2장씩 추가
  - 샘플이 적은 클래스(10~100장)는 180장이 될 때까지 증강본을 더 추가해서 불균형을 완화
  - 결과: 학습 샘플이 11,069장 → **33,207장**으로 늘어남
- **모델에 BatchNormalization 추가**로 학습을 더 안정적으로:
```
Input(32,32,1)
→ Conv2D(32) → BatchNorm → ReLU → MaxPool
→ Conv2D(64) → BatchNorm → ReLU → MaxPool
→ Conv2D(96) → BatchNorm → ReLU
→ Flatten → Dense(192) → Dropout(0.4)
→ Dense(102, softmax)
```
- EarlyStopping(val_accuracy 기준, patience 7) + ReduceLROnPlateau로 Adam 학습률 자동 조정

## 5. 결과

| | v1 (이전) | v2 (현재) |
|---|---|---|
| 학습 데이터 | 13,023장 (증강 없음) | 11,069 + 증강 22,138 = 33,207장 |
| 모델 | BatchNorm 없음 | BatchNorm 추가 |
| 학습 정확도 | 93.6% | 91.8% |
| **검증 정확도** | 83.2% | **89.4%** |

검증 정확도가 **83.2% → 89.4%**로 6.2%p 올랐고, 학습/검증 정확도 차이도
10.4%p → 2.4%p로 크게 줄었습니다(= 과적합이 줄고 더 일반화가 잘 됨). 16번째 에폭 근처에서
가장 좋았고, 그 이후로는 학습 정확도만 계속 오르고 검증 정확도는 제자리걸음(과적합 시작)이라
그 지점의 가중치를 최종 모델로 썼습니다.

여전히 `archive__1_`(숫자 증강), `archive__3_`(수식기호, 4GB+)는 포함하지 않았습니다 — 지금
정확도 개선은 증강만으로 달성한 것이라 더 필요하면 "7. 재학습/확장"을 참고해 데이터를 추가하세요.

## 6. tfjs 변환 (`3_convert_to_legacy_h5.py`, `4_convert_to_tfjs.py`)
Keras 3(`.keras`) → 레거시 Keras 2 형식(`.h5`) → `tensorflowjs_converter`로
브라우저용 `model.json` + 가중치(`.bin`)로 변환. 결과물이
`public/assets/model/handwriting-cnn/`에 들어있고, 이게 앱이 실제로 불러다 쓰는 파일입니다.

## 7. 재학습 / 확장하고 싶다면
1. Kaggle 등에서 원본 데이터셋을 다시 받아서 `dataset_raw/` 아래 같은 구조로 풀기
   (`jamo/`, `alnum/`, `symbols/`)
2. 새 데이터(숫자 증강본, 수식 기호 등)를 추가하려면 `1_preprocess.py`에 로더 몇 줄 추가
3. `python 1_preprocess.py` → `python 2_train.py` → `python 3_convert_to_legacy_h5.py`
   → `python 4_convert_to_tfjs.py` 순서로 실행
4. 나온 `tfjs_model/` 내용물을 `public/assets/model/handwriting-cnn/`에 덮어쓰기

필요 패키지: `tensorflow`, `tf_keras`, `tensorflowjs`, `pillow`, `numpy` (전부 pip 설치 가능).
