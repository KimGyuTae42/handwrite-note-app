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
- 클래스당 최대 300장으로 제한(가장 큰 클래스도 실제로는 220장 정도라 사실상 전량 사용)
- 최종 13,023장 → `dataset_processed/images.bin`, `labels.bin`, `classes.json`

## 4. 모델 구조 (`2_train.py`)
```
Input(32,32,1)
→ Conv2D(24) → MaxPool
→ Conv2D(48) → MaxPool
→ Conv2D(64)
→ Flatten → Dense(160) → Dropout(0.35)
→ Dense(102, softmax)
```
Keras로 30 epoch 학습, Adam 옵티마이저.

## 5. 결과
- 학습 정확도(accuracy): **93.6%**
- 검증 정확도(val_accuracy): **83.2%**

학습/검증 정확도 차이(약 10%p)는 각 클래스 샘플 수가 많지 않아서(클래스당 최대 220장)
생기는 자연스러운 과적합입니다. 데이터를 더 모으면(특히 `archive__1_`, `archive__3_`까지
포함) 격차를 줄일 수 있습니다.

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
