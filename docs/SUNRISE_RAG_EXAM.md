# Bài thi RAG: Sunrise Family Clinic (KB-B)

MSSV 22110068 · KB-B *Sunrise Family Clinic — Patient Guide (2026 Edition)* · 11 section · nhánh `feature/sunrise-rag-exam-20261009`.

Tài liệu này là hợp đồng vận hành của bài thi. Mọi mục dưới đây ghi rõ **đã kiểm chứng bằng gì** và **chưa kiểm chứng gì**. Không có câu nào trong đây tuyên bố “đã đúng mọi câu hỏi” hay “grounding bảo đảm sự thật”.

## 1. Trạng thái một dòng

| Phần | Trạng thái |
| --- | --- |
| Code RAG, UI debug, in chunk, CLI, grader, tests, QA browser | Hoàn thành và kiểm chứng offline/browser (số liệu ở mục 8) |
| **Embedding thật `embeddinggemma`** | **Đã cài và đã chạy thật** (768 chiều; digest ghi trong index). Index thật tạo bằng 1 request; truy xuất thật đo trên 16 câu: **15/16** đủ section cần thiết (mục 8.4). **Chưa chạy end-to-end LLM + embedding thật** |
| LLM thật `qwen3:8b` | Chạy local ở chế độ **HYBRID** (LLM thật + embedding **giả**), 8 câu, mục 8.3. Cap generation của đợt đã dùng 22/24 nên **chưa chạy cùng embedding thật** |
| Model dự phòng `qwen3:4b` | Warm và probe giao thức **PASS**; một câu Sunrise thật trả JSON không hợp lệ ở lượt cuối và chưa kịp repair do hết cap. **Chưa xác minh là dự phòng dùng được** |
| Push / nộp form | Nhánh đã được push lên `origin` theo yêu cầu của bạn; **nộp form/doc là việc của bạn** |

## 2. Danh tính (identity) của hệ thống

| Thành phần | Giá trị |
| --- | --- |
| LLM sinh câu trả lời | Ollama local **`qwen3:8b`** (profile `ollama-qwen3`, `http://127.0.0.1:11434/v1/`, `reasoning_effort: none`, output cap 800) |
| LLM dự phòng | `qwen3:4b` (profile `ollama-qwen3-4b`, local) · hoặc profile `env` (Gemini/OpenAI-compatible trong `.env`; quota tính theo **project**, có thể 429 và không retry tự động) |
| Embedding model | **`embeddinggemma`** qua Ollama `POST /api/embed` (`truncate:false`, `keep_alive:"3h"`, timeout 15 s). Không dùng `qwen3` làm embedding |
| Template embedding | query: `task: search result \| query: {text}` · document: `title: {title} \| text: {text}` · `preprocessing_version: embeddinggemma-v1` |
| Chunker | `markdown-section-v1`: mỗi section `## N.` là một chunk nếu ≤ 1200 ký tự; dài hơn thì tách theo khối → hàng bảng (lặp header) → mục danh sách (giữ câu dẫn) → câu → cắt cứng |
| Kích thước chunk | **max 1200 ký tự, overlap 100 ký tự** (đo bằng **ký tự**, không phải token). Overlap chỉ giữa các phần của *cùng một* section bị tách |
| Kết quả chunk thật | **11 chunk**, mỗi section một chunk, lớn nhất 709 ký tự (`kb-b-s04-c1`), nhỏ nhất 84 (`kb-b-s09-c1`). `source_id` dạng `kb-b-sNN-cM` |
| Vector store | JSON `var/rag/sunrise-clinic-rag/index.json` (Git-ignored), ghi atomic (temp + fsync + validate + rename), `index_id` = sha256 nội dung |
| Tìm kiếm | **Exact cosine** trên vector đã chuẩn hóa: duyệt hết N chunk, mỗi chunk d chiều ⇒ **O(N×d)**. Không ANN, không HNSW, không claim tốc độ |
| Chính sách ngữ cảnh | top-k = **3** theo cosine **+** section **1** và **10** do backend luôn thêm (đánh dấu `required`, loại trùng); tối đa 6 chunk / 6000 ký tự trong một observation |
| Ngân sách embedding | **3 HTTP embedding/run**, đếm trước khi gọi, không retry, tách khỏi số liệu LLM |

KB được copy nguyên văn vào `data/sunrise/KB-B_Sunrise-Family-Clinic-Patient-Guide.md` (checksum `83c7f209ef8be61d…` sau chuẩn hóa LF). Hai điểm bẫy của KB: bảng phí section 4 ghi da liễu **450,000** nhưng section 10 (hiệu lực 1/10/2026) **ghi đè thành 500,000**; Bao Viet bị **tạm ngưng direct billing ở Thu Duc**, vẫn dùng ở District 1.

## 3. Yêu cầu đề → cài đặt → kiểm chứng

| # | Yêu cầu đề | Cài đặt | Kiểm chứng |
| --- | --- | --- | --- |
| 1 | Chunk KB | `src/rag/chunker.js` (`chunkMarkdown`) | `tests/rag-chunker.test.js` (7); 11 chunk trên KB thật |
| 2 | Embedding thật + vector store | `src/rag/embedding.js`, `indexBuilder.js`, `vectorIndex.js`; `npm run rag:index` | Code/test bằng Ollama giả (`tests/rag-embedding|index.test.js`). Embedding thật: index thật + đo truy xuất 16 câu (mục 8.4) |
| 3 | Chatbot với LLM thật | `src/agent/*` + tool `search_kb` (`src/tools/searchKb.js`), task `config/sunrise.task.json` | Hybrid live `qwen3:8b` (mục 8.3); tests với model script |
| 4 | Hiện nguồn section/chunk của từng câu trả lời | UI “Sources”: `10. Updates (…) — kb-b-s10-c1`; `GET /api/runs/:id/retrieval` | `tests/rag-agent.test.js`, `npm run qa:rag` |
| 5 | KB không có đáp án ⇒ nói không biết | Mission + `source_ids: []` + `unresolved`; backend chặn trích nguồn chưa từng được hiển thị | S18/V18 (mock), S18 hybrid live PASS; tests grounding |
| 6 | Hiện và in chunk đã truy xuất | “Retrieved chunks” + nút **Print retrieved chunks** (`public/retrieval-view.js`); CLI `npm run rag:retrieve` | `tests/retrieval-view.test.js`, Chromium print-media + `printToPDF` trong `qa:rag` |
| 7 | README: LLM, embedding, chunk size, cách chạy | `README.md` mục “Bài thi RAG” và tài liệu này | Xem mục 2 và mục 5 |
| 8 | Model/provider dự phòng | `qwen3:4b` local, profile `env` | Mục 1: dự phòng **chưa xác minh đầy đủ** |
| 9 | Chạy câu mới, đổi nhỏ, giải thích | Mục 6 (đổi nhỏ) và `docs/ORAL_EXAM_KNOWLEDGE.md` Q67–Q76 | Tests cho `top_k` (không cần index lại), `chunk.max_chars` (index cũ bị chặn) |

## 4. Luồng một câu hỏi

```
goal ──► LLM đề xuất {"type":"tool_call","tool":"search_kb","arguments":{"query":"…"}}
          │  backend kiểm allow-list + schema (query 2..300 ký tự) + index sẵn sàng
          ▼
   embed query (1 HTTP /api/embed, đếm trước) ──► cosine với 11 vector ──► top-3
          │  + section 1 và 10 (required) ──► loại trùng ──► đóng gói ≤ 6000 ký tự
          ▼
   observation (đúng các chunk này, kèm source_id / section / match / rank / score) ──► LLM
          ▼
   LLM trả {"type":"final","answer":…,"source_ids":[…],"unresolved":…}
          │  backend: source_ids ⊆ các chunk đã hiển thị CỦA RUN NÀY; chưa search ⇒ bị từ chối
          ▼
   UI: câu trả lời + “section — source_id” + khối “Retrieved chunks” (đọc từ lưu trữ, không gọi model)
```

Điểm cần nói được khi vấn đáp: **ledger = đúng các chunk đã đưa cho model** (không phải kết quả tìm kiếm thô); nếu một observation sẽ bị cắt thì run dừng với lỗi thay vì âm thầm bỏ chunk; chunk required không bao giờ bị bỏ, chunk semantic yếu nhất bị bỏ trước khi hết ngân sách ký tự.

## 5. Chạy thật, từng bước (PowerShell)

```powershell
Set-Location D:\New-Tech\ai-agent-starter
ollama list                                   # cần thấy qwen3:8b và embeddinggemma
ollama pull embeddinggemma                    # BẠN tự chạy (≈622 MB). Tôi không tự tải
npm run rag:index -- --task=sunrise-clinic-rag     # 1 HTTP embedding, in index_id/digest/dimension
npm run rag:retrieve -- --task=sunrise-clinic-rag --query="What is the current dermatology fee?"
npm run exam:start                            # khởi động lại SAU khi có index; chọn task "Sunrise Clinic RAG" + Qwen3 8B
```

- Thiếu model: `rag:index`/`rag:retrieve` in `BLOCKED: … ollama pull embeddinggemma` và thoát mã 3, không gọi gì. Chưa có index: UI hiện lệnh cần chạy, nút Run bị tắt, `POST /api/runs` trả `409 index_not_ready`.
- Index chỉ do lệnh `rag:index` tạo. Server, reload, đổi ngôn ngữ UI, đổi task không bao giờ embed KB.
- Đổi KB, kích thước chunk, embedding model, template hoặc code chunk/embedding/vector ⇒ index cũ bị coi là **stale** (`stale_kb` / `stale_config`), run đang chạy lúc restart bị đánh `task_changed`.
- Xem chunk: mở “Retrieved chunks” trong khối kết quả; **Print retrieved chunks** in đúng một tờ chunk (toàn văn, không bị cắt layout). Debug một câu hỏi không qua LLM: `rag:retrieve` (in toàn bộ xếp hạng, chunk nào được đưa cho model).
- Đánh giá tự động (chỉ local, không cloud, tuần tự):

```powershell
npm run rag:eval -- --profile=mock                              # harness offline: embedding giả + trả lời viết tay (chỉ chứng minh wiring)
npm run rag:eval -- --profile=ollama-qwen3 --live --plan        # preflight metadata, không gửi request LLM/embedding thật
npm run rag:eval -- --profile=ollama-qwen3 --live               # phiên live thật (cần embeddinggemma + index); 8 câu ưu tiên, cap 24+24
npm run rag:eval -- --profile=ollama-qwen3 --live --fake-embeddings --only=S01,S18   # HYBRID, được gắn nhãn, KHÔNG xác minh embeddinggemma
```

Mã thoát: `0` mọi case PASS · `1` có FAIL · `2` dùng sai tham số · `3` BLOCKED · `4` cần đọc tay/chưa chạy hết. Báo cáo ở `var/rag-eval/` (Git-ignored), mỗi phiên một UUID mới.

## 6. Đổi nhỏ trực tiếp khi thầy yêu cầu

| Yêu cầu | File / giá trị | Sau đó | Đã có test |
| --- | --- | --- | --- |
| Lấy nhiều chunk hơn (`top_k` 3 → 4) | `config/sunrise.task.json` → `retrieval.top_k` (phải còn `top_k + số section required ≤ context.max_chunks`) | Chỉ **khởi động lại server**. **Không** cần `rag:index` | `tests/rag-agent.test.js` (đổi `top_k` không làm stale) |
| Chunk nhỏ/lớn hơn | `retrieval.chunking.max_chars` (200–4000), `overlap_chars` | `npm run rag:index -- --task=sunrise-clinic-rag` rồi restart. Chưa index lại ⇒ UI báo `stale_config` | `tests/rag-agent.test.js` (chunk size ⇒ stale) |
| Bắt buộc section khác | `retrieval.required_sections` (tối đa 4) | Restart | declaration validation |
| Cho phép/không cho trích nhiều nguồn | prompt trong `mission` của `config/sunrise.task.json` | Restart; fingerprint đổi nên run cũ không còn hợp lệ | — |
| Đổi KB sang file khác | `data/sunrise/<file>.md` + `kb_file` + `required_sections` + `sample_inputs` | `rag:index`, restart | tests KB checksum ⇒ stale |

Mẹo: sau mỗi sửa chạy `npm test` (hoặc ít nhất `node --test tests/rag-agent.test.js`) rồi `npm run rag:retrieve` với một câu hỏi để thấy ngay tác động.

Catalog chỉ còn **1 slot task trống** (7/8): không dùng `exam:scaffold` thêm hai task cùng lúc.

## 7. Chính sách ngôn ngữ

Goal tiếng Việt ⇒ trả lời tiếng Việt; goal tiếng Anh ⇒ trả lời tiếng Anh; nếu goal nói rõ ngôn ngữ trả lời (ví dụ “Hãy trả lời bằng tiếng Anh”) thì yêu cầu đó thắng. Ngôn ngữ **giao diện** (VI/EN) độc lập với ngôn ngữ trả lời, không có bộ chọn ngôn ngữ trả lời và không có lượt dịch (không HTTP phụ). Query embedding là chuỗi mà model viết; `embeddinggemma` là model đa ngôn ngữ và đã đo trên 3 câu hỏi tiếng Việt (V01, V02, V18): cả ba lấy đúng section tiếng Anh cần thiết (mục 8.4). Mẫu nhỏ, chưa phải thống kê.

## 8. Kết quả kiểm chứng (tách riêng offline / browser / live)

### 8.1 Offline (không gọi Ollama, không cloud)

- `npm test`: **507/507 đạt** (trước nhánh này README ghi 423). Gồm test chunker/embedding/index/retriever/runner với **Ollama giả HTTP**, test grader có **mutation** (thử cố tình phá chấm điểm số bằng khớp chuỗi con ⇒ test bắt được), test campaign/cap/BLOCKED/NOT_RUN và CLI.
- `npm run eval`: 16/16 (case cũ của agent, không phải Sunrise). Các demo/script cũ vẫn đạt với catalog 7 task: `demo:datasets` 3/3, `demo:budgets`, `demo:proposals`, `exam:smoke -- --profile=mock`, `exam:rehearsal -- --profile=mock`, `exam:adaptation`.
- `npm run rag:eval -- --profile=mock`: 27/27 PASS. **Ý nghĩa:** wiring, quy tắc grounding và grader hoạt động với embedding giả (hashed bag-of-words) và trả lời viết tay. **Không phải bằng chứng về LLM hay embedding thật.**
- Bộ chấm `eval/sunrise-acceptance.json`: 27 case, giá trị kỳ vọng viết tay từ KB (không lấy từ output tool/model); VI, EN và hai chiều chéo ngôn ngữ. Check cứng (tiền, nguồn bắt buộc, dữ kiện bịa, ngôn ngữ) có thể FAIL; check mềm (từ ngữ) chỉ cho `REVIEW_REQUIRED`. Số tiền được parse thành số (450,000 = 450.000 = 450k), không khớp bằng `includes`.

### 8.2 Browser (Chromium thật, Ollama giả, LLM script)

`npm run qa:rag` — 5 kịch bản: thiếu index; câu trả lời hoàn tất (in chunk, VI/EN, Exam mode, reload); KB không có đáp án; embedding lỗi; reload khi đang chạy. Kiểm ở 1366×768 và 390 px (không tràn ngang), bàn phím (Enter mở details, Tab tới nút in, focus nhìn thấy), media `print` + `printToPDF`, chuyển ngôn ngữ/chế độ và reload **không** sinh request model/embedding mới. Các QA cũ (`qa:metrics`, `qa:configuration`, `qa:exam`, `qa:i18n`, `qa:proposals`, `qa:scaffold`, `qa:rehearsal`) vẫn PASS sau thay đổi UI; riêng `qa:scaffold` và `qa:rehearsal` phải bỏ task Sunrise khỏi bản copy cô lập vì catalog tối đa 8 task. Bản học `ORAL_EXAM_STUDY.html` được sinh lại (76 câu, 14 chương) và `qa-oral-study` đạt.

### 8.3 Live local — chỉ HYBRID (LLM thật, embedding GIẢ)

Phiên `qwen3:8b` trên 8 câu ưu tiên, embedding là bag-of-words băm (test double). **Không dùng để kết luận về embeddinggemma.** Tổng generation HTTP **18/24** (warm 1 + probe 1 + 16 cho 8 câu, 0 repair, 0 retry), embedding giả 9 (1 index + 8 query).

| Case | Kết quả tự động | Đọc tay (tôi đã đọc từng câu trả lời) |
| --- | --- | --- |
| S01 phí da liễu hiện tại | PASS | 500,000 VND, nêu section 10 ghi đè — đúng |
| S02 Bao Viet ở Thu Duc | REVIEW | Nội dung đúng (tạm ngưng, trả trước nhận hóa đơn). REVIEW vì encoder **giả** không truy xuất section 5 |
| S03 District 1 còn Bao Viet | PASS | Đúng |
| S09 follow-up telehealth 7 ngày | REVIEW | **Câu trả lời tự mâu thuẫn**: mở đầu “Yes … is free”, sau đó nói “telehealth follow-ups are not free”. Lỗi lập luận của `qwen3:8b`; check mềm bắt được |
| S15 hiệu thuốc Thu Duc Chủ nhật | **FAIL** | Encoder giả không truy xuất section 2 (giờ mở cửa) nên mô hình nói “không có giờ cụ thể”: lỗi **truy xuất**, không phải lỗi bịa của LLM |
| S07 khám tổng quát bé 5 tuổi | PASS | 200,000 VND đúng, nhưng diễn đạt rối (“250,000 VND with 20% off”) và thêm thông tin thừa (cardiology, Bao Viet) |
| S18 không có trong KB | PASS | Từ chối đúng, `source_ids: []`, có `unresolved` |
| X01 hỏi tiếng Việt, trả lời tiếng Anh | PASS | Đúng ngôn ngữ và số tiền |

Mỗi câu đạt 1 lần duy nhất; **chưa có case nào đạt 3 lần liên tiếp nên chưa gọi là demo-ready**.

Model dự phòng `qwen3:4b` (cap riêng 4 HTTP): warm PASS, probe giao thức PASS; câu S01 thật: lượt cuối trả JSON không hợp lệ, cần repair nhưng đã chạm cap phiên nên run dừng `request_budget`. Tổng cả hai phiên **22/24** generation HTTP; còn 2.

### 8.4 Truy xuất thật với `embeddinggemma` (không gọi LLM sinh câu trả lời)

Sau khi cài model và `rag:index` (1 request, khởi động nguội 31 s), tôi chạy 16 câu hỏi của bộ acceptance qua retriever sản phẩm, dùng **chính câu hỏi làm query** (LLM tự viết query nên kết quả thật có thể khác). Chi phí: 16 request embedding (tổng 17/24 embedding thật), ~0,7 s/query khi model đã nạp, 0 gọi LLM. Báo cáo: `var/rag-eval/real-retrieval-check.json`.

| Case | Cần section | Top-3 theo cosine | Kết luận |
| --- | --- | --- | --- |
| S01, X01, X02, V01 (phí da liễu) | 4, 10 | 4, 10, 8 | đủ (câu VI và câu chéo ngôn ngữ cũng đủ) |
| S02, S03, V02 (Bao Viet) | 5, 10 | 5 và 10 đều nằm trong top-3 | đủ, kể cả câu tiếng Việt |
| S09, S07, S05, S14, S16 | 4 / 4 / 2 / 7 / 6 | đứng đầu | đủ |
| S11 (thành viên + da liễu) | 8, 10, 4 | 8, 4, 10 | đủ |
| S18, V18 (không có trong KB) | không có | 4, 6, 10 / 4, 10, 8 | đúng là không có đáp án; điểm cao nhất chỉ 0,36–0,42 |
| **S15** (hiệu thuốc Thu Duc Chủ nhật) | 2, 9 | **2, 7, 1** | **TRƯỢT:** section 9 xếp hạng 4 (0,420), sau section 7 (0,522) và section 1 (0,461) |

Hai điều rút ra:

- **Section 1 là required nên cũng chiếm một slot của top-3** ở S15. Với `top_k: 4` (chỉ sửa `config/sunrise.task.json` rồi restart), tập top-4 của 16 câu trên là tập cha của top-3 nên S15 cũng đủ section 9; cái giá là thêm một chunk (~100–700 ký tự) mỗi lượt. **Đề xuất này chưa được thử với LLM** và tôi chưa áp dụng.
- **Điểm cosine không thể dùng làm ngưỡng "không biết"**: câu không có đáp án (S18 0,363, V18 0,420) có điểm gần các câu có đáp án (S05 0,427, V02 0,437). Việc nói "không biết" dựa vào nội dung chunk do LLM đọc, nên vẫn cần kiểm bằng `rag:eval --live`.

**Rủi ro vận hành đã quan sát:** lần nạp model đầu tiên mất 10–31 s (đo thật: 31 s khi tạo index, 10,3 s khi chạy `rag:retrieve` lúc model đã bị gỡ), trong khi tool `search_kb` chỉ chờ 5 s. Ban đầu profile đặt `keep_alive: "30m"`; vì bài thi dài 120 phút và thầy có thể hỏi sau hơn 30 phút không dùng, đã đổi thành `"3h"` (chỉ là tham số gửi cho Ollama, không đổi timeout của tool, không làm index stale). Nếu Ollama vừa khởi động lại hoặc model đã bị gỡ khỏi bộ nhớ thì query đầu vẫn có thể hết giờ. Kiểm tra bằng `curl http://127.0.0.1:11434/api/ps` (cột `expires_at`). **Trước giờ thi chạy một lệnh `npm run rag:retrieve -- --task=sunrise-clinic-rag --query="warm up"`** để nạp sẵn.

## 9. Giới hạn và rủi ro đã biết

0. **Digest model đổi ⇒ phải tạo lại index.** Đã xảy ra thật: sau khi tôi tạo index, Ollama báo hai mục `embeddinggemma:latest` với digest khác (kèm một mục `llamacpp:…`) và `rag:retrieve` từ chối index cũ (`The installed embeddinggemma … differs from the one that built the index`). Chạy lại `npm run rag:index -- --task=sunrise-clinic-rag` (1 request) rồi restart server; điểm cosine đo lại **y hệt** (0,5570 / 0,5183 / 0,3559 cho câu S01) nên các số đo ở 8.4 vẫn đúng. Đây là kiểm tra an toàn đang hoạt động, không phải lỗi.
1. **Chưa chạy LLM + embedding thật cùng nhau.** Truy xuất thật đã đo (mục 8.4) nhưng dùng câu hỏi làm query; LLM tự viết query nên có thể khác. Các kết quả LLM ở mục 8.3 dùng encoder giả. Bước tiếp theo: `rag:eval --live` (phiên mới, cần bạn đồng ý vì cap 24 generation của đợt này đã dùng 22; thêm `--embedding-spent=16` để cap embedding tính cả 16 query đo ở mục 8.4).
2. **Backend giữ section 1 và 10** luôn có trong ngữ cảnh. Đây là chính sách vì section 10 ghi đè các section khác, không phải do cosine. Nếu thầy đổi KB, hãy đổi `required_sections`.
3. **Grounding chỉ đảm bảo nguồn trích đã từng được hiển thị**, không đảm bảo câu trả lời đúng. PASS tự động không kiểm mọi mệnh đề văn xuôi (xem S09, S07).
4. `qwen3:8b` có thể tự mâu thuẫn hoặc thêm thông tin thừa; `qwen3:4b` có thể trả JSON hỏng. Không nới repair/timeout để che lỗi.
5. Index nằm trong `var/` (Git-ignored): máy khác phải `rag:index` lại. Đổi index bắt buộc khởi động lại server.
6. Nếu chạy nhiều lần `search_kb`, observation cũ có thể bị rút gọn bởi giới hạn ngữ cảnh tổng; ledger khi đó có thể chứa ID mà model không còn thấy đầy đủ. Mission yêu cầu tìm một lần.
7. Cây làm việc luôn tính là “modified” trong báo cáo vì `docs/EXAM_AGENT_CONTINUATION_HANDOFF.md` và `.agents/` có sẵn chưa được theo dõi; tôi không commit chúng.

## 10. Lệnh kiểm chứng đã dùng (chạy lại được)

```powershell
npm test                                   # 507 tests
npm run eval                               # 16 case cũ
npm run rag:eval -- --profile=mock         # 27/27, chỉ wiring
npm run qa:rag                             # Chromium thật, 5 kịch bản
npm run exam:smoke -- --profile=mock
npm run exam:rehearsal -- --profile=mock
node scripts/build-oral-study.js; node scripts/qa-oral-study.js
```

Báo cáo live/hybrid nằm trong `var/rag-eval/` (Git-ignored): `rag-eval-hybrid-4c0844fa-…json` (8 câu, `qwen3:8b`) và `rag-eval-hybrid-7b6166b1-…json` (dự phòng `qwen3:4b`, 1 câu). Cả hai ghi commit, danh tính LLM, embedding **giả**, số HTTP từng run và câu trả lời đầy đủ.
