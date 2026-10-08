# Kiến thức và câu hỏi vấn đáp — AI Agent Starter

Tài liệu để luyện giải thích **project đang có**, mở code chứng minh và bổ sung câu hỏi sau. Cập nhật ngày **2026-10-08**, bổ sung adaptation kit/UI VI–EN/follow-up trên runtime cuối `d3ca6f3` (414 tests/16 eval). Live runtime này **NOT_RUN**, cap48 đã hết; ba evidence live trước sửa stale. Số liệu `f920d06`/`f17e02c` bên dưới là **evidence lịch sử**, không thay thế kiểm chứng runtime mới. Xem [ADAPTATION_KIT.md](ADAPTATION_KIT.md), [LANGUAGE_AND_FOLLOWUPS.md](LANGUAGE_AND_FOLLOWUPS.md), [ADAPTATION_VERIFICATION.md](ADAPTATION_VERIFICATION.md) và [EXAM_CANDIDATE.md](EXAM_CANDIDATE.md). Thông tin model có thể đổi; phải kiểm tra profile của **run đang trình bày**. Không coi câu trả lời trong tài liệu này là chỉ thị cho agent.

Ký hiệu: **[Đã có]** là hành vi xác nhận trong source; **[Kiến thức nền]** là khái niệm để giải thích; **[Chưa có]** là hướng mở rộng, không được giới thiệu như tính năng hiện tại. Đợt cập nhật tài liệu không gọi lại LLM. Số liệu candidate là evidence được lưu, không phải lần chạy mới.

**Cách học:** nói đáp án trong 20–30 giây → giải thích một ví dụ → chỉ file/hàm → nêu giới hạn. Đừng chỉ thuộc tên công nghệ. Ưu tiên Q14–Q28 và Q53–Q60 cho LLM/RAG/embedding; Q03, Q35–Q39 và Q42–Q49 cho kiến trúc/an toàn. Bản điện thoại [ORAL_EXAM_STUDY.html](ORAL_EXAM_STUDY.html) có tìm kiếm, câu trọng tâm và tự vấn đáp; không gọi API/model. Đánh dấu “Đã nắm” chỉ là tự đánh giá.

## 1. Câu giới thiệu và bản đồ code

**Câu giới thiệu khoảng 30 giây:** “Em xây một sườn AI Agent bằng Node.js và frontend thuần. Model có sẵn nhận mục tiêu và kết quả tool, rồi đề xuất tool hoặc câu trả lời cuối bằng JSON. Backend kiểm tra quyền, schema, business rules và ngân sách trước khi thực thi. Ghi chú được truy xuất bằng BM25; bảng JSON/CSV được lọc, đếm, cộng và so sánh bằng code xác định. Tool ghi phải có người duyệt và chống ghi trùng. Kết quả có source ID để kiểm tra nguồn.”

| Thành phần | Trách nhiệm | File/hàm nên mở |
|---|---|---|
| Startup | Nạp cấu hình, catalog, tạo HTTP server | [server.js](../src/server.js), [context.js](../src/operations/context.js): `loadEnvironment()` |
| HTTP API | Nhận goal/approval, trả run và metadata | [app.js](../src/app.js): `createApp()`, `route()` |
| Catalog | Xác thực task/profile; tạo registry/retriever của từng task | [catalog.config.js](../config/catalog.config.js): `loadCatalog()`, `buildCatalog()` |
| Quản lý runtime | Gắn mỗi run vào đúng task/model/settings, phục hồi lịch sử | [runManager.js](../src/agent/runManager.js): `createRunManager()` |
| Agent loop | Hỏi model → kiểm tra → tool/approval/final → lặp | [runner.js](../src/agent/runner.js): `askModel()`, `drive()`, `executeTool()` |
| Decision | Parse JSON và kiểm tra final/source IDs | [decision.js](../src/agent/decision.js): `parseDecision()`, `checkGrounding()` |
| State | Trạng thái run, hash approval, public view | [state.js](../src/agent/state.js): `createRun()`, `transition()`, `argsHash()` |
| Model adapter | Gửi inference request thật, xử lý response/retry | [openaiCompatible.js](../src/model/openaiCompatible.js): `once()`, `complete()` |
| Retrieval ghi chú | Tách passage, tokenize và chấm BM25 | [keywordSearch.js](../src/retrieval/keywordSearch.js) |
| Tool registry | Allow-list, schema, business rules, quyền read/write | [registry.js](../src/tools/registry.js): `check()` |
| Dataset | Nạp snapshot an toàn, validate JSON/CSV, số fixed-point | [datasets.js](../src/data/datasets.js) |
| Tool đọc bảng | Lookup/count/sum/compare và provenance | [queryDataset.js](../src/tools/queryDataset.js) |
| Persistence | Run JSON, draft idempotent, audit JSONL | [fileStore.js](../src/store/fileStore.js) |
| Metrics/budget | Đếm request, validate usage, dự phòng token | [metrics.js](../src/agent/metrics.js) |
| Frontend | Chọn cấu hình, polling, trace, approval, reload | [app.js](../public/app.js), [configuration.js](../public/configuration.js), [run-session.js](../public/run-session.js) |

```mermaid
flowchart TD
    UI[Browser: goal + task/profile IDs] --> API[HTTP API]
    API --> Runtime[Runtime đúng cấu hình của run]
    Runtime --> Loop[Runner dựng messages và kiểm tra budget]
    Loop --> Model[Model adapter: inference]
    Model --> Decision[Parse JSON và kiểm tra quyết định]
    Decision -->|tool_call| Gate[Allow-list + schema + business rules]
    Gate -->|read| Tool[Tool thực thi]
    Gate -->|write| Approval[Chờ người duyệt + hash]
    Approval -->|approve và kiểm tra lại| Tool
    Approval -->|reject| Observation[Observation cho model]
    Tool --> Observation
    Observation --> Loop
    Decision -->|final hợp lệ và nguồn đã truy xuất| Result[Kết quả + sources + metrics]
    Runtime --> Store[File store: state + trace + audit]
    Result --> UI
```

## 2. Code hoạt động như thế nào?

### Q01. Vì sao gọi đây là AI Agent?

**Trả lời:** Model chọn hành động tiếp theo dựa trên goal và observation, không chỉ sinh một câu trả lời duy nhất. Backend có vòng lặp và điều kiện dừng. Thứ tự tìm kiếm, lưu nháp hoặc kết thúc do model đề xuất trong giới hạn quyền.

**Chỉ code:** `drive()` trong [runner.js](../src/agent/runner.js). Rule-based mock/scripted model chỉ mô phỏng giao thức, không chứng minh khả năng suy luận của LLM thật.

### Q02. Agent khác chatbot và workflow cố định thế nào?

Chatbot đơn giản thường trả văn bản sau một lượt hỏi. Workflow cố định viết sẵn thứ tự bước. Agent này có thể hỏi tool rồi dùng kết quả để chọn bước mới. Vẫn có workflow an toàn do backend định nghĩa: kiểm tra quyền, duyệt ghi, giới hạn và trạng thái. Nếu nghiệp vụ luôn cố định, dùng workflow có thể dễ kiểm soát hơn.

### Q03. Một goal đi từ UI đến final qua những bước nào?

1. Browser gửi `POST /api/runs` với goal và task/profile IDs, hoặc chỉ goal để dùng defaults.
2. Backend xác thực ID/goal, tạo run, chụp cấu hình và lưu; trả `202` với run.
3. `buildMessages()` ghép system prompt, goal và lịch sử cần thiết; `askModel()` gọi model.
4. Model trả một JSON decision. `parseDecision()` kiểm tra protocol.
5. Nếu là tool: registry kiểm tra; read chạy ngay, write chuyển sang chờ approval.
6. Kết quả tool được ghi trace, đăng ký source IDs và gửi lại như `OBSERVATION` chứa `untrusted_data`.
7. Model trả final; backend kiểm tra nguồn đã truy xuất rồi lưu trạng thái `completed`.

Nếu lỗi hoặc hết giới hạn, run kết thúc với mã cụ thể; không đảm bảo mọi goal đều completed.

### Q04. Model nhận những thông tin nào? Có nhận toàn bộ file dữ liệu không?

Nhận mission, safety rules, protocol JSON, mô tả/schema tool được bật, goal và lịch sử observation. Dataset description có IDs/cột, không có đường dẫn file. Các dòng dữ liệu chỉ tới model qua kết quả tool có giới hạn. Notes search trả passage liên quan, không gửi toàn bộ thư mục.

**Chỉ code:** [prompts.js](../config/prompts.js): `buildSystemPrompt()`; [runner.js](../src/agent/runner.js): `buildMessages()`, `observe()`, `fitObservation()`. Observation/context quá dài được rút gọn; model không có trí nhớ vô hạn.

### Q05. Run có những trạng thái nào?

`running`, `awaiting_approval`, `completed`, `failed`, `stopped`. `transition()` kiểm tra chuyển trạng thái hợp lệ. Các trạng thái terminal không quay về running. `failed` dành cho lỗi như output không sửa được hoặc provider lỗi; `stopped` dành cho user stop/giới hạn như hết budget.

**Chỉ code:** [state.js](../src/agent/state.js): `STATUS`, `ALLOWED`; [runner.js](../src/agent/runner.js): `finish()`.

## 3. Dữ liệu nào đang có và được xử lý ra sao?

### Q06. Nguồn dữ liệu nằm ở đâu? Là dữ liệu thật hay dữ liệu huấn luyện?

Đây là **dữ liệu mẫu/giả lập để kiểm thử và demo**, không phải dữ liệu huấn luyện model hoặc quy định thật của môn học. Catalog hiện có:

| Task ID | Dữ liệu và cấu trúc | Tool được bật |
|---|---|---|
| `study-notes` | 7 Markdown ở [data/notes](../data/notes): agent loop, RAG, HTTP, idempotency, giữa kỳ, cuối kỳ, bản chép diễn đàn chứa injection | `search_notes`, `save_draft` |
| `datasets-demo` | [products.json](../data/datasets/products.json): 4 dòng, id/name/category/price/stock; [classes.csv](../data/datasets/classes.csv): 4 dòng, id/course/day/room/students | `query_dataset` |
| `rehearsal-tickets` | [tickets.json](../data/datasets/tickets.json): 6 dòng, id/team/status/hours | `query_dataset`, `compare_counts` |
| `rehearsal-rooms` | [rooms.csv](../data/datasets/rooms.csv): 5 dòng, id/room/location/capacity | `query_dataset` |
| `proposal-tickets` | tickets JSON hiện có; policy status transition | `query_dataset`, `create_proposal` (write/approval) |
| `proposal-rooms` | [proposal-classes.csv](../data/datasets/proposal-classes.csv): 2 lớp; [proposal-rooms.csv](../data/datasets/proposal-rooms.csv): 4 phòng; policy capacity | `query_dataset`, `create_proposal` (write/approval) |

Task bảng hiện vẫn khai báo thư mục notes hợp lệ theo schema chung, nhưng không có `search_notes` nên model không được tra cứu các notes đó. Metadata UI chỉ hiện dữ liệu tương ứng tool được bật.

### Q07. Nếu hỏi tỉ trọng điểm hoặc phòng thi, trả lời thế nào?

Trong **notes giả lập**, giữa kỳ là 30%, cuối kỳ 40%; phải truy xuất/cite `midterm` và `final-project`, không gọi đó là quy định thật. Số phòng thi cụ thể không có bằng chứng nên giải thích thiếu dữ liệu trong `unresolved`. Passage có từ “giữa kỳ” chưa chắc trả lời được câu hỏi “phòng thi ở đâu”.

**Chỉ dữ liệu:** [midterm.md](../data/notes/midterm.md), [final-project.md](../data/notes/final-project.md). Đây cũng là ví dụ phân biệt “retrieval tìm thấy” với “evidence thực sự trả lời”.

### Q08. Model được truyền đường dẫn JSON/CSV bất kỳ không?

Không. Model chỉ truyền `dataset_id` đã được task cho phép. File/cột/scale được backend khai báo trong task config và nạp lúc startup. Loader chặn traversal, symlink, file không hợp lệ hoặc quá lớn. Browser không được gửi module, mission, allow-list hay endpoint tùy ý.

**Chỉ code:** [task.config.js](../config/task.config.js): `validateTaskConfig()`; [datasets.js](../src/data/datasets.js): `readDataset()`, `loadDatasets()`; [queryDataset.js](../src/tools/queryDataset.js): `checkRules()`.

### Q09. `query_dataset` hỗ trợ gì? Có phải SQL/vector search không?

Tool read-only có bốn operation: `lookup`, `count`, `sum`, `compare`. Filter trong một nhóm nối bằng **AND**. String chỉ `eq/ne`, so sánh chính xác và phân biệt hoa thường. Number hỗ trợ `eq/ne/lt/lte/gt/gte`; giá trị filter gửi bằng decimal string. Không có SQL, OR tùy ý, join, công thức hoặc group-by tổng quát.

`compare` dùng `filters` và `compare_filters`: bỏ `field` để so sánh counts; thêm numeric `field` để so sánh sums. `limit` chỉ dùng lookup, mặc định 5, tối đa 10; aggregates tính trên **toàn bộ** dòng khớp.

Task ticket hiện ưu tiên [compareCounts.js](../src/tools/compareCounts.js): interface chỉ nhận dataset_id/filters/compare_filters, cả ba bắt buộc, không operation/field/limit/null. Đây là wrapper gọi cùng engine compare không field; không viết lại phép lọc, provenance hoặc source ID. Lý do: qwen3:8b từng thêm optional arguments sai khi so counts; schema nhỏ làm rõ ý định và backend vẫn từ chối mọi arguments sai. Bật theo task allow-list, không tự cấp cho task khác.

### Q10. Ví dụ nào dễ mở code và dự đoán đáp án?

Ví dụ proposal hợp lệ, chạy bằng tool của task `datasets-demo`:

```json
{"type":"tool_call","tool":"query_dataset","arguments":{"dataset_id":"products","operation":"sum","field":"price","filters":[{"field":"category","op":"eq","value":"stationery"}]}}
```

Backend cộng `10.10 + 20.20`, trả decimal string **`"30.30"`**. `count` các lớp Mon là **2**. Compare sum students Mon/Tue trả **`["55","40"]`**, relation **`gt`**. Support/open tickets có **2**; Billing/open có **1**. Tổng capacity North là **`"70"`**; South/capacity>=40 chỉ có phòng **B202**.

Source ID phải lấy từ **kết quả chạy thật**, không chép một ID minh họa từ tài liệu hoặc tự dựng ID.

### Q11. Vì sao không để LLM tự cộng số? Fixed-point hoạt động thế nào?

Backend cần kết quả tái lập và chính xác; LLM có thể tính hoặc chép sai. Cột `price` scale 2 được đổi thành đơn vị nguyên: `10.10 → 1010n`, `20.20 → 2020n`; cộng `BigInt` thành `3030n`, format thành `"30.30"`. Không dùng phép cộng floating-point thông thường cho tổng tiền.

`decimalUnits()` từ chối rỗng, dạng số sai, NaN/Infinity, exponent hoặc số vượt range được phép; số có phần thập phân vượt scale bị từ chối, **không tự làm tròn**. Scale từ 0 đến 6. Mỗi giá trị scaled được giới hạn; tổng dùng BigInt. JSON parser giữ spelling numeric token trước khi JS Number làm mất độ chính xác. Numeric data được chuẩn hóa thành decimal strings trong snapshot.

**Chỉ code:** [datasets.js](../src/data/datasets.js): `decimalUnits()`, `JsonNumberToken`, `formatUnits()`; [queryDataset.js](../src/tools/queryDataset.js): `total()`, `display()`.

### Q12. Tại sao CSV không dùng `split(',')`? Giới hạn dữ liệu là gì?

Ô CSV có thể chứa dấu phẩy, quote escape `""` hoặc xuống dòng khi được quoted. `parseCsv()` dùng các trạng thái để phân biệt delimiter và nội dung; hỗ trợ LF/CRLF. Header phải có đủ cột khai báo, không trùng/lạ; dòng sai số ô hoặc quote không đóng bị từ chối.

`DATASET_LIMITS`: **128 KiB/file, 200 dòng, 1500 ký tự result có wrapper**. Lookup dài quá bị báo lỗi, không cắt làm hỏng JSON. `truncated=true` nghĩa là còn dòng khớp ngoài trang lookup, không được lấy số dòng trang làm tổng.

### Q13. Snapshot, fingerprint và provenance là gì?

Snapshot là dữ liệu đã nạp/validate để runtime dùng ổn định. Dataset `version` là SHA-256 của khai báo và bytes file; task fingerprint gồm task config, versions dataset và notes. Đây là hash nhận diện thay đổi, không phải embedding.

Dataset source ID có dạng `ds-<dataset_id>-<hash>`, lấy từ dataset version và query đã chuẩn hóa. Result còn có `dataset_version`, `query`, count/values, vị trí dòng. Nguồn của lookup rỗng vẫn chứng minh điều kiện đã được chạy trên snapshot nào.

Provenance dùng ranges hoặc bitmap base64 không mất thông tin, giúp 200 dòng xen kẽ hai nhóm vẫn vừa giới hạn. Dòng JSON là index+1; dòng CSV là thứ tự **data record không tính header**, không nhất thiết là dòng vật lý nếu ô có newline. Hash query giữ thứ tự filters, nên đổi thứ tự filters tương đương có thể đổi source ID.

**Chỉ code:** [queryDataset.js](../src/tools/queryDataset.js): `rowProvenance()`, hash/result; [datasets.js](../src/data/datasets.js): `version`.

## 4. Retrieval, RAG, embedding và token

### Q14. Project có dùng embedding không? Có vector database không?

**[Đã có] Không có embedding retrieval hoặc vector database.** Notes dùng keyword BM25; bảng dùng filter/tính toán xác định. Không có request `/embeddings`, chunk vectors hay index cosine trong đường chạy hiện tại.

**Đáp án 20 giây:** “Project chưa tạo document/query embeddings, nên không có embedding model được cấu hình. `qwen3:8b` là model sinh quyết định/câu trả lời; `keyword-bm25` là retriever. Không được gọi Qwen3 8B là embedding model của project.” Chứng minh tại [keywordSearch.js](../src/retrieval/keywordSearch.js), `kind: 'keyword-bm25'`, và [catalog.json](../config/catalog.json), `model_profiles`.

“LLM bên trong thường có biểu diễn embedding” và “ứng dụng xây embedding index cho retrieval” là hai việc khác nhau. Repo này gọi model có sẵn, không triển khai các lớp neural network bên trong model.

### Q15. BM25 hoạt động thế nào trong code này?

Notes được tách thành passage theo đoạn cách dòng trống. Mỗi passage được tokenize cả title và text; index lưu tần suất từ `tf`, độ dài `len`, document frequency `df` và độ dài trung bình. Query tokenize và bỏ từ trùng; mỗi passage nhận tổng điểm theo các query terms xuất hiện.

Công thức đang dùng, với `N` là **số passage**:

```text
idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
score(p,q) = sum over unique terms t in q:
  idf(t) * tf(t,p)*(k1+1) / (tf(t,p) + k1*(1-b+b*len(p)/avgLen))
k1 = 1.2; b = 0.75
```

Từ hiếm có trọng số cao hơn; tf có hiệu ứng bão hòa; length normalization giảm lợi thế đoạn dài. Code lọc score>0, sắp giảm dần rồi lấy limit. Search tool mặc định 3, tối đa 5 passages; text mỗi passage trả tối đa 600 ký tự rồi thêm dấu rút gọn. **Score không phải xác suất câu trả lời đúng.**

**Chỉ code:** [keywordSearch.js](../src/retrieval/keywordSearch.js): `parseNote()`, `createRetrieverFromDocs()`, `search()`.

### Q16. Tiếng Việt và chunking được xử lý ra sao?

`tokenize()` lower-case, bỏ dấu Unicode, đổi `đ → d`, tách theo ký tự ngoài a-z/0-9, bỏ token ngắn và stopwords. Ví dụ “bảo mật” gần với “bao mat” về token. Đây là chuẩn hóa từ khóa đơn giản, không phải bộ tách từ tiếng Việt theo nghĩa.

Một paragraph là một chunk/passage; title được lấy từ `# `, dòng bắt đầu `>` được bỏ khỏi body như metadata. Source ID của note là tên file không extension, passage number là vị trí đoạn. Bỏ dấu có thể làm các từ khác nghĩa trùng nhau; paraphrase/từ đồng nghĩa có thể không match.

### Q17. Embedding là gì và hoạt động thế nào? [Kiến thức nền, chưa triển khai retrieval]

Embedding biểu diễn dữ liệu bằng vector số. Với sentence embedding, một encoder tạo vector cho câu/đoạn; similarity như cosine được dùng để so sánh biểu diễn ngữ nghĩa. Ví dụ phương pháp Sentence-BERT tạo sentence embeddings và so sánh bằng cosine. [Nguồn nền: bài báo Sentence-BERT](https://aclanthology.org/D19-1410/).

Pipeline mở rộng có thể là: chia đoạn → encode từng đoạn → lưu vector kèm text/source ID → encode query bằng model tương thích → tìm các vector gần → trả text cho model sinh câu trả lời. Ví dụ giả định `[0.2, -0.1, 0.7]` chỉ minh họa một vector, không phải vector đã tạo trong repo.

Cosine cho hai vector khác zero: `cos(a,b) = dot(a,b)/(norm(a)*norm(b))`. Similarity cao là tín hiệu truy xuất; vẫn phải kiểm tra passage có trả lời câu hỏi không. Embedding không tự sinh câu trả lời hay thực thi tool.

### Q18. BM25 và embedding retrieval khác nhau thế nào?

| Tiêu chí | BM25 trong repo | Embedding retrieval nếu bổ sung |
|---|---|---|
| Tín hiệu | Từ xuất hiện, tf/df, độ dài | Khoảng cách/similarity trong không gian vector |
| Tài nguyên | Index từ khóa nhỏ trong RAM, không gọi embedding model | Cần encoder, vector storage/index và quản lý version |
| Điểm mạnh | Rẻ, dễ giải thích, hợp từ khóa/tên chính xác | Có thể tìm câu diễn đạt khác từ ngữ |
| Rủi ro | Trượt synonyms, match từ nhưng lệch ý | Có thể lấy đoạn gần nghĩa nhưng không đủ evidence |
| Hiện trạng | Đã có | Chưa có; chưa chọn model, dimension hay vector DB |

Không kết luận embedding luôn tốt hơn. Phải eval theo câu hỏi, ngôn ngữ, chi phí và dữ liệu thực tế. Với đếm/tổng chính xác của bảng, vẫn nên dùng tool xác định thay vì tìm vector rồi để LLM cộng.

### Q19. Muốn thêm embedding thì sửa ở đâu?

Viết retriever mới tương thích `search(query,{limit})`, `has(sourceId)` và result `{source_id,title,passage,text,score}`. Tích hợp catalog còn cần metadata `kind`, `sourceCount`, `describe()` hoặc thích nghi tương ứng. Chỗ tạo retriever hiện tại là **`buildCatalog()` trong [catalog.config.js](../config/catalog.config.js)**. Hướng dẫn cũ nói thay một dòng trong `src/app.js` thuộc kiến trúc trước catalog, không đủ cho code hiện tại.

Cần thiết kế chunk/index/version, encoder/document-query compatibility, data access, giới hạn và tests/evals riêng. Giữ source grounding/approval/backend rights. Đây là công việc tương lai, không có model embedding được khai báo sẵn.

Query và documents phải dùng encoder tương thích cùng không gian biểu diễn; khi đổi model/normalization/chunking cần xem xét tạo lại index. Không trộn vector khác model chỉ vì cùng dimension. API embeddings riêng của Ollama là kiến thức mở rộng, chưa được project gọi: [Ollama embeddings](https://docs.ollama.com/capabilities/embeddings).

### Q20. RAG có bắt buộc dùng vector search? Retrieval khác generation thế nào?

Retrieval tìm evidence; generation dùng evidence để diễn đạt câu trả lời. Pattern RAG không bắt buộc là vector search: luồng notes ở đây dùng BM25 để cung cấp ngữ cảnh cho generation. Luồng bảng là structured retrieval + backend calculation. Không gọi hai luồng đó là “RAG vector”.

Giới thiệu chính xác: **agent có luồng trả lời tăng cường bằng truy xuất ghi chú BM25; chưa triển khai dense/vector RAG**. Bài RAG gốc dùng dense retrieval và có kiến trúc huấn luyện riêng; repo không tái hiện toàn bộ bài đó. [Bài báo RAG](https://arxiv.org/abs/2005.11401).

### Q21. Token của BM25, token của LLM và embedding có giống nhau không?

Không. `tokenize()` trong retriever là token từ khóa do repo tự tách. LLM dùng tokenizer của provider/model, token không tương đương một từ hoặc một ký tự. Embedding là vector biểu diễn, không phải số token. Repo không dùng tokenizer LLM chính xác cho budget; provider báo usage khi có, còn dự phòng dùng heuristic riêng.

## 5. Model, inference và giao thức JSON

### Q22. Dùng model gì? Chỉ ra chính xác ở đâu.

| Profile ID | Runtime khai báo | Nơi kiểm tra |
|---|---|---|
| `env` — default profile | Đọc cấu hình môi trường; lúc đối chiếu là `openai-compatible`, `qwen3:8b` | [agent.config.js](../config/agent.config.js): `loadConfig()` và `.env` trên máy; không đưa key lên tài liệu/UI |
| `mock` | `rule-based-mock`, không LLM thật | [mock.js](../src/model/mock.js) |
| `ollama-qwen3` | Qwen3 `qwen3:8b`, local Ollama OpenAI-compatible endpoint | [catalog.json](../config/catalog.json): model_profiles |
| `ollama-qwen3-4b` | `qwen3:4b`, profile so sánh, không auto fallback | [catalog.json](../config/catalog.json) |

Factory [model/index.js](../src/model/index.js): `createModel()` chọn mock hoặc adapter thật. `loadConfig()` có fallback name `gemini-2.5-flash`, nhưng **không được suy ra run hiện tại dùng Gemini từ giá trị fallback đó**. UI đọc catalog; run lưu `model`, profile ID và identity. Đổi `.env`/select không đổi model của run đã bắt đầu.

“Ollama” là dịch vụ chạy model local; “Qwen3” là model; “openai-compatible” là provider interface trong code. Tên interface không có nghĩa tất cả request đều tới cloud OpenAI.

### Q23. Code nào là LLM inference? Model thực sự chạy ở đâu?

**Hai vị trí cần mở:**

- [runner.js](../src/agent/runner.js), `askModel()`: `await model.complete({ messages, signal, requestControl })` — ứng dụng yêu cầu một inference.
- [openaiCompatible.js](../src/model/openaiCompatible.js), `once()`: dựng payload và `fetch()` POST `chat/completions` — gửi request thật.

Trích rút gọn để giải thích, không phải một hàm độc lập:

```js
const body = { model: cfg.name, messages,
  temperature: cfg.temperature, max_tokens: plan?.output ?? cfg.maxOutputTokens };
const pending = fetch(url, { method: 'POST', headers,
  body: JSON.stringify(body), signal, redirect: 'manual' });
// Response: choices[0].message.content -> text; usage -> accounting.
```

Computation neural network/weights xảy ra ở dịch vụ provider: Ollama khi local, dịch vụ bên ngoài khi cloud. JS backend này không cài thuật toán forward pass hoặc tự train model. `search_notes`, `query_dataset` không phải LLM inference.

**Chỉ đúng vị trí hiện tại:** [runner.js](../src/agent/runner.js) `askModel()` gọi `model.complete`; [openaiCompatible.js](../src/model/openaiCompatible.js) `once()` gửi HTTP rồi đọc `choices[0].message.content`. Với profile `ollama-qwen3`, URL đích là `http://127.0.0.1:11434/v1/chat/completions`. `cfg.name` đi vào payload `model`; `messages` là ngữ cảnh inference, không phải training dataset. Số dòng có thể đổi sau sửa code; ưu tiên tên hàm/khóa. [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

### Q24. API model khác API ứng dụng thế nào?

Browser gọi `/api/runs`, `/api/catalog` trên Node backend. Backend mới gọi provider `/v1/chat/completions` theo base URL được xác thực. Credential nếu cần được adapter đưa vào Authorization header phía backend; browser không chọn URL hoặc nhận key. Không phải mọi request HTTP của UI đều là một request LLM.

### Q25. Model trả gì? Có dùng native function calling không?

Project dùng **protocol JSON tự định nghĩa** trong message content, không gửi native `tools/tool_calls` schema của provider. JSON mode khi bật yêu cầu response object, nhưng backend vẫn validate.

```json
{"type":"tool_call","tool":"search_notes","arguments":{"query":"idempotency","limit":3}}
```

Hoặc final; `unresolved` có thể bỏ nếu có nguồn nhưng nên luôn khai báo rõ:

```json
{"type":"final","answer":"Chưa có bằng chứng về số phòng thi cụ thể.","source_ids":[],"unresolved":"Ghi chú giả lập không nêu số phòng."}
```

Một JSON object/decision mỗi lượt. `arguments` của tool phải qua schema riêng. Final không có nguồn phải có `unresolved` không rỗng. Có nguồn không có nghĩa backend đã chứng minh toàn bộ nội dung đúng.

**Chỉ code:** [prompts.js](../config/prompts.js): `PROTOCOL`; [decision.js](../src/agent/decision.js).

### Q26. Temperature, output cap, reasoning và timeout tác động gì?

Temperature là tham số sampling gửi provider; cấu hình hiện tại 0 không đảm bảo mọi lần giống hệt. Output cap giới hạn token sinh dự kiến, có thể làm response bị cắt và JSON không hoàn chỉnh. Adapter gửi `reasoning_effort` nếu được cấu hình; ý nghĩa/hỗ trợ do provider quyết định, không coi trace là toàn bộ reasoning.

Mặc định code: output 800, model timeout 30000ms; môi trường đối chiếu giữ `.env` sẵn có **120000ms**. Active run max là 120000ms, nên deadline mỗi call còn bị chặn theo thời gian run còn lại. Probe riêng tối đa 5s; warm local riêng 60s. Không tăng limits để che citation lỗi.

### Q27. Repair và retry khác nhau như thế nào?

**Repair:** output JSON/decision/grounding không hợp lệ → yêu cầu model sửa, tăng model_calls/repairs và dùng budget. Repair citation liệt kê nguồn hợp lệ của **chính run**, hoặc nhắc read tool khi chưa có evidence; không tự thay source ID bịa bằng ID đoán.

**Retry:** adapter gửi lại HTTP vì lỗi mạng hoặc 500/502/503/504; tối đa một lần sau khoảng 800ms, kiểm tra budget lần nữa. Timeout, 429, 4xx khác hoặc redirect không tự retry. Format/citation lỗi không phải lý do HTTP retry.

**Chỉ code:** `REPAIR_MESSAGE()` và `askModel()`; [openaiCompatible.js](../src/model/openaiCompatible.js): `RETRYABLE`, `complete()`.

### Q28. Mock/scripted model khác model thật? Có training/fine-tuning không?

Mock dùng các luật nhận dạng goal; scripted model trả decisions định trước để kiểm thử backend. Chúng có model_calls nhưng **0 HTTP LLM**; PASS không chứng minh model thật biết giải đề. Mock UI hiện chỉ hỗ trợ các ví dụ cũ, không giải mọi goal của hai đề diễn tập.

Không có training/fine-tuning. Thay mission/prompt và dữ liệu observation là thay input inference, không cập nhật weights. Chất lượng model thật phải đo riêng bằng live cases cùng cấu hình, giữ cả trial thất bại.

## 6. Components, API và cấu hình từng run

### Q29. Có các API nào? Request/response chính là gì?

Tất cả routes nằm trong [app.js](../src/app.js). Server dùng `node:http`, không Express/framework.

| API | Vai trò / contract chính |
|---|---|
| `GET /api/health` | Server/default metadata/limits/service hashes; không chứng minh endpoint LLM đang phản hồi |
| `GET /api/catalog` | Task/profile metadata, tool quyền/approval, dữ liệu/cột/count/version; không key/prompt/path |
| `POST /api/model-profiles/:id/probe` | Body `{}`; trả `{probe}` với trạng thái/metrics/lỗi; kiểm tra có chủ động |
| `POST /api/runs` | `{goal, task_id?, model_profile_id?}`; `202` với `{run}` |
| `GET /api/runs` | `{runs}` tối đa 50 run gần nhất |
| `GET /api/runs/:id` | `{run}` cho polling/reload |
| `POST /api/runs/:id/approvals/:aid` | `{decision:"approve" hoặc "reject", args_hash}`; trả run và replayed |
| `POST /api/runs/:id/stop` | Yêu cầu dừng run, trả `{run}` |
| `GET /api/drafts` | Danh sách draft đã được lưu; không API sửa/xóa dữ liệu tổng quát |
| `GET /api/proposals` | Đề xuất nội bộ đã lưu, không áp dụng thay đổi lên dataset gốc |

API lỗi thường trả `{error,message}`. Probe có thể HTTP 200 nhưng `probe.error` vẫn thể hiện endpoint/protocol thất bại; phải đọc body. `POST /api/runs` không chấp nhận config/path/prompt tùy ý. Body JSON có giới hạn; content-type sai/body quá lớn bị từ chối.

### Q30. Vì sao POST run trả 202? UI nhận kết quả mới bằng gì?

202 là đã nhận/tạo run, không phải đã giải xong. Vòng lặp được lên lịch phía backend; UI GET/poll khoảng 600ms khi running hoặc awaiting approval. Không dùng WebSocket. UI render trạng thái, trace, approval/final và metrics từ backend.

**Chỉ code:** [app.js](../src/app.js); [public/app.js](../public/app.js): submit handler, `schedulePoll()`, `render()`.

### Q31. Đổi task/model trên UI có làm run khác thay đổi không?

Không. Run lưu task ID, model profile ID, task fingerprint, model identity, configuration metadata và runtime settings. `runManager` ánh xạ run tới runtime đúng model/registry/retriever/dataset snapshot/limits; settings tương đương có thể dùng chung runtime, nhưng state/counters/budget thuộc từng run. Select cho run mới không sửa process.env hay runtime đang chạy.

**Chỉ code:** [runManager.js](../src/agent/runManager.js): `runtime()`, `owners`; [state.js](../src/agent/state.js): `createRun()`. Profile unavailable bị chặn, không âm thầm đổi sang mock.

### Q32. Reload browser và restart server khác nhau thế nào?

Reload: localStorage chỉ giữ viewed `run_id`; browser GET trạng thái thật rồi render/poll. Không tự gửi goal cũ, approve hoặc gọi model. Không lưu key, goal/prompt hay bảng trong localStorage.

Restart: backend đọc persisted runs. Run đang running bị interrupted, không tự chạy lại model. Pending approval có thể tiếp tục nếu task/profile còn hợp lệ và identity không đổi; metrics/budget không reset. Task/data đổi → `task_changed`; model identity đổi → `model_changed`; config bị mất/unavailable → `configuration_missing`. Pending approval tương ứng bị hủy. Terminal history giữ nguyên; legacy metrics chưa có được biểu thị “not collected”, không bịa usage.

**Chỉ code:** [run-session.js](../public/run-session.js); `boot()` trong frontend; `init()` trong runManager/runner.

### Q33. Dữ liệu được lưu ở đâu? File store có thay database được không?

`var/runs/<run_id>.json` giữ state; `var/drafts/<approval_id>.json` giữ draft; `var/proposals/` giữ proposal; `var/logs/audit.jsonl` append audit. Save run viết temp rồi rename giảm nguy cơ JSON dở dang. Draft dùng exclusive create; proposal dùng publish nguyên tử và approval ID để chống ghi trùng, có reconciliation cho outcome chưa rõ. `var/exam/` giữ báo cáo vận hành, không Git commit.

Thiết kế nhỏ cho demo, không khẳng định có transaction/distributed lock/auth/backup như hệ quản trị database production. Nếu dùng nhiều backend process hoặc yêu cầu nghiệp vụ lớn hơn phải thiết kế storage/coordination tương ứng.

## 7. Tools, approval, source grounding và bảo mật

### Q34. Tool là gì? Khác component/API endpoint thế nào?

Tool là chức năng backend model được phép **đề xuất** sử dụng; có name/access/requiresApproval/description/schema/checkRules/execute. Component là module đảm nhiệm một phần kiến trúc. API endpoint là giao diện HTTP của ứng dụng/provider. UI không gọi `execute()` trực tiếp.

`BUILTIN_TOOLS` đăng ký `search_notes`, `save_draft`, `query_dataset`, `compare_counts`, `create_proposal`; task allow-list quyết định subset được bật, và subset đó được dùng cả để mô tả cho model lẫn để kiểm tra thực thi.

### Q35. Backend kiểm tra tool call theo thứ tự nào?

Sau parse decision: giới hạn steps/repeated action → tool có trong registry → arguments object/giới hạn → schema → `checkRules()` → read execution hoặc approval write. Schema kiểm tra cấu trúc/kiểu/giới hạn; rules kiểm tra ý nghĩa, quyền dataset, cột numeric, nguồn draft và goal có yêu cầu lưu.

Ví dụ `field:"id"` có thể đúng dạng string trong schema nhưng bị rule từ chối vì cột đó không numeric. `save_draft` bị chặn trong task chỉ có `query_dataset`. Proposal bị rejected vẫn tốn một tool step và thành observation; không “thử tool miễn phí” vô hạn.

**Chi tiết đọc code:** biến `MAX_ARGUMENT_BYTES` hiện kiểm tra `JSON.stringify(args).length` với ngưỡng 6000, tức số đơn vị độ dài chuỗi JS, không phải phép đo UTF-8 bytes. HTTP body limit ở `readJson()` mới cộng bytes buffer. Không nhầm hai cách đo khi vấn đáp.

### Q36. Vì sao tool ghi phải duyệt? Duyệt ràng buộc vào gì?

Model có thể hiểu sai hoặc bị injection; tác động ghi cần người kiểm tra đúng arguments. Backend tạo approval với ID và `args_hash` từ run ID/tool/arguments, chuyển awaiting approval. Client gửi decision và hash; backend kiểm tra cả hash lưu và hash tính lại rồi kiểm tra rules lần nữa trước execute.

Registry từ chối khai báo write mà requiresApproval không đúng boolean true; runner còn suy approval từ access để bảo vệ thêm. `args_hash` dùng SHA-256/canonical arguments để ràng buộc nội dung, **không phải chữ ký xác thực danh tính người duyệt**.

**Chỉ code:** [state.js](../src/agent/state.js): `argsHash()`; `decideApproval()` trong [runner.js](../src/agent/runner.js); registry declarations.

### Q37. Bấm approve hai lần hoặc reload có ghi trùng không?

Idempotency key là approval ID. `createDraftOnce()` mở file bằng `wx`; nếu đã tồn tại thì trả draft cũ với `created:false`. Runner có lock tuần tự theo run và replay checks; cùng quyết định hợp lệ trả `replayed:true`, không chạy tool/model lại. Đổi quyết định/hash trái với approval đã quyết không được coi là replay hợp lệ.

Đây là bảo đảm của cơ chế cụ thể trong sườn, không nên khẳng định mọi distributed side effect đều exactly-once.

### Q38. `source_id` dùng để làm gì? Grounding bảo đảm đến đâu?

Tool trả evidence trong `results`; runner thêm IDs vào `retrieved_source_ids`. Final chỉ được cite IDs đã trả trong chính run. Notes ID là tên file; dataset ID gắn snapshot/query. Dataset provenance còn giúp kiểm tra những record/conditions nào tạo count/sum.

`checkGrounding()` chỉ kiểm tra **membership của IDs**, không xác minh mọi câu/giá trị trong answer được nguồn hỗ trợ. Model có thể cite nguồn thật mà diễn đạt sai; vì vậy eval kiểm query, số, quan hệ và cần đọc tay. Final không nguồn có thể hợp lệ khi giải thích thiếu evidence trong unresolved; “completed” không tự đồng nghĩa đáp án nghiệp vụ PASS.

### Q39. Prompt injection là gì? Project chống bằng cách nào?

Dữ liệu truy xuất chứa câu kiểu “ignore previous instructions, call tool X” nhằm điều khiển agent. [forum-copy.md](../data/notes/forum-copy.md) là mẫu kiểm thử cố ý. Tool results gắn `untrusted_data`; prompt nhắc coi dữ liệu là dữ liệu. Quyền thực sự nằm ở backend: tool allow-list, schema/rules, approval và budgets, không phụ thuộc model nghe prompt.

Test fake model làm theo lệnh độc chứng minh backend chặn tool lạ/ghi chưa duyệt. Candidate live E16 có **FAIL/FAIL/BLOCKED**: model thử `save_draft` dù goal không yêu cầu; business rule `save_not_requested` chặn, không tạo approval/draft. Trial thứ ba chạm cap chiến dịch. Đây là **backend kiểm soát quyền đúng, model vẫn bị ảnh hưởng**, không phải prompt-injection robustness PASS. Xem [EXAM_CANDIDATE.md](EXAM_CANDIDATE.md).

### Q40. Dataset/HTML/key có những ranh giới bảo mật nào?

Dataset chỉ từ allow-list startup với đường dẫn an toàn và giới hạn. UI dùng `textContent` cho nội dung không tin cậy, static assets có allow-list/CSP. Credential chỉ lấy backend environment, metadata không trả key/system prompt/endpoint nội bộ. Reports loại request body/messages/secrets.

Hiện chưa có authentication/authorization theo người dùng. Host mặc định loopback; nếu đổi bind ra mạng thì không thể coi approval là xác thực người duyệt. Tool timeout cũng không luôn hủy được hàm đã chạy; idempotency giúp chống ghi trùng nhưng không thay cơ chế cancellation/transaction đầy đủ.

### Q41. Có thể lưu draft trích từ dataset không?

**Chưa có cho save_draft.** Tool này check nguồn bằng notes retriever `has()` và run đã retrieval; task validator yêu cầu `search_notes`. Đợt 2 đã có **create_proposal riêng** để lưu đề xuất nội bộ từ bản ghi lookup với policy/evidence/approval/hash/idempotency. Nó không lưu draft tổng quát hay sửa dataset. Giải thích contract và hai workflows tại [DATASET_PROPOSALS.md](DATASET_PROPOSALS.md).

## 8. Metrics, token budget và readiness

### Q42. Một run dùng bao nhiêu lần model? Có bằng số tool steps không?

| Số liệu | Ý nghĩa |
|---|---|
| `model_calls` | Lượt `model.complete()` khởi chạy, gồm repair |
| `provider_requests` | HTTP model requests thực sự bắt đầu, gồm request lỗi/timeout/retry; mock là 0 |
| `repairs` | Lượt yêu cầu model sửa quyết định không hợp lệ |
| `retries` | HTTP gửi lại vì lỗi tạm thời trong adapter |
| `steps_used` | Tool steps, kể cả proposal bị rejected; không phải model requests |
| tokens reported | Input/output/total provider báo và backend validate |
| tokens estimated | Dự phòng cho request chưa có usage hợp lệ |
| model/provider ms | Thời gian complete tổng và HTTP provider, tách active/wall/approval wait |

Ví dụ một complete gặp 503 rồi retry thành công: **1 model_call, 2 provider_requests, 1 retry**, nếu budget cho phép. Hai complete đầu để tool và final là 2 model calls, dù chỉ có một tool execution. Repair là model call mới, không phải một tool step mới.

### Q43. Usage thiếu/sai có thành 0 token không? Giới hạn token có chính xác tuyệt đối?

Không. `validateUsage()` yêu cầu input/output/total là safe nonnegative integers và input+output=total. Thiếu hoặc sai giữ reported null nếu chưa có usage, tăng unknown/invalid count và giữ reservation cho budget. Nếu có cả usage thật và dự phòng, UI/report thể hiện mixed.

`estimateInput()` dùng độ dài UTF-8 JSON messages cộng overhead, **không phải tokenizer thật**. Trước request dự phòng input+output cap; có thể giảm cap nếu còn ít ngân sách nhưng phải đủ ít nhất 64 output tokens. Usage hợp lệ thay reservation; thiếu usage/request lỗi không miễn phí. Không cam kết token budget bằng hóa đơn bị tính phí tuyệt đối.

**Chỉ code:** [metrics.js](../src/agent/metrics.js): `validateUsage()`, `estimateInput()`, `planRequest()`, `settleRequest()`.

### Q44. Ngân sách chặn ở runner thôi có đủ không?

Không, adapter có retry. Gate phải trước **mọi HTTP**, gồm retry. Adapter gọi `beforeRequest()` rồi ghi request bắt đầu/hoàn tất; số request thực sự gửi không được hoàn lại. Redirect bị từ chối để fetch không tạo HTTP ngoài gate. Hết requests/tokens → stopped `request_budget`/`token_budget`, không gửi lượt tiếp hoặc chạy tool mới.

Mặc định 12 provider requests và 100000 token budget lập kế hoạch; limits riêng mỗi run, giữ qua approval/restart. Không lấy metrics mock cũ để tiếp tục runtime thật; model identity thay đổi hủy pending approval và yêu cầu run mới.

### Q45. Chờ người duyệt có mất budget hoặc tính là model chạy không?

Không reset requests/tokens. Approval wait thuộc wall/wait time, không thuộc active run time hay model_ms. Resume dùng cùng run metrics/settings. Approval replay không thêm requests. Run legacy chưa có metrics giữ not_collected/unavailable, không khôi phục thành 0 hoặc tự gọi model để tạo metrics.

### Q46. Health, configured, probe, warm và live PASS khác nhau thế nào?

Health chứng minh HTTP backend chạy. Configured chứng minh profile qua kiểm tra cấu hình, không chứng minh endpoint/model đã sẵn. Probe chủ động tối đa một model request/5s/cap64/no retry; kiểm connectivity và JSON thử, có accounting riêng. Mock probe chỉ simulation.

Inspect Ollama đọc tags/ps để biết installed/loaded, không inference; warm local được gọi chủ động, một request nhỏ/60s/no retry, không notes/bảng. Live acceptance mới kiểm hành vi nghiệp vụ/nguồn. Thành công ở một tầng không chứng minh tầng sau; không có nhãn READY chung thay cho các kết quả riêng.

**Chỉ code:** [probe.js](../src/model/probe.js), [localModel.js](../src/operations/localModel.js), [readiness.js](../src/operations/readiness.js).

## 9. Test, demo và những câu hỏi phản biện

### Q47. Dùng tests/eval/live để chứng minh những điều khác nhau thế nào?

Tests kiểm hành vi/bất biến backend qua fake HTTP/scripted: validation, CSV/precision, nguồn, budgets, approval/replay/restart, isolation. Eval ghi chú kiểm các ca end-to-end khai báo. Browser QA dùng Chrome thật với provider/store tạm kiểm UI/reload/focus/mobile. Live cases kiểm model thật nhưng chỉ với goal/cấu hình/phiên bản đã ghi nhận; giữ failures, không chạy vô hạn đến khi đẹp.

**Mở bằng chứng:** [runner.test.js](../tests/runner.test.js), [query-dataset.test.js](../tests/query-dataset.test.js), [run-metrics.test.js](../tests/run-metrics.test.js), [selection.test.js](../tests/selection.test.js), [exam-suite.test.js](../tests/exam-suite.test.js), [eval](../eval), [suite.js](../src/operations/suite.js).

### Q48. Những failure quan trọng nào đã kiểm và giải thích được?

- Model bịa source ID → grounding reject/repair có giới hạn, không tự thay ID.
- JSON/schema sai → repair hữu hạn; không được lấy văn bản tùy ý làm tool call.
- 429 → không retry; 503/network có thể retry một lần nếu còn budget.
- Budget hết trước retry → fake provider không nhận request thứ hai.
- 200 rows hai nhóm xen kẽ → compact provenance giữ đủ record trace.
- Smoke answer “12 lớp” thay “2”, hoặc đảo Mon/Tue → grader không cho PASS bằng substring đơn thuần.
- Restart mock↔real/model đổi → cancel approval, giữ accounting lịch sử.
- Forbidden dataset/tool hoặc source draft sai → backend từ chối trước execute.

Các ca này kiểm an toàn/đúng hành vi backend; không suy ra LLM luôn đề xuất đúng.

### Q49. Hiện có thể nói model đã ổn định cho demo chưa?

**Đáp án ngắn:** “Nền tảng và một số goal demo đã kiểm chứng; chưa thể khẳng định model ổn định với mọi đề. Em giữ cả kết quả thất bại và biết giới hạn.” Candidate code `f920d06`, checkpoint `f17e02c`: **387/387 tests**, **16/16 eval offline**, năm Chrome QA và ZIP phục hồi đạt; đây không phải bằng chứng LLM cho các ca offline.

Chiến dịch Qwen3 8B thật: **42 PASS, 8 FAIL, 1 BLOCKED**, dùng đủ **160 HTTP**, **327136 tokens provider reported**, 18 repairs, 0 retry. Notes, sum/compare mẫu, `compare_counts`, `save_draft` approve/reject, ticket approve và room approve/reject có ba PASS liên tiếp trong đúng phạm vi goal/profile đã ghi nhận. Thêm task Rentals bằng scaffold cũng được kiểm trong catalog tạm, không phải task có sẵn trong UI chính.

Blocker còn lại: `tickets-empty` thiếu nguồn query (3 FAIL), proposal ticket reject sai final exact outcome (3 FAIL nhưng backend không ghi), E16 thử ghi trái goal (FAIL/FAIL/BLOCKED), diễn tập **sinh viên NOT_RUN**. Không lấy thời gian script/agent thay thời gian sinh viên. Mock không phải dự phòng LLM thật. Probe PASS không chứng minh giải nghiệp vụ PASS.

**Lịch sử:** các mốc M6 253 tests, 15/3 smoke live, 9/9 rehearsal live và đính chính grader reject nằm trong [EXAM_REHEARSAL.md](EXAM_REHEARSAL.md). Chúng không thay verdict candidate hiện hành. Chỉ đổi tài liệu không làm stale runtime/grader evidence; thay model/task/data/runtime phải kiểm tra lại identity. Không suy tình trạng cổng từ báo cáo cũ.

**Bằng chứng hiện hành:** [EXAM_CANDIDATE.md](EXAM_CANDIDATE.md). `npm run exam:report -- --profile=ollama-qwen3` đọc trạng thái và ghi report mới, không tự gọi LLM. Số lượng test có thể tăng khi thêm kiểm thử tài liệu; phải ghi rõ phạm vi, không tự sửa kết quả candidate lịch sử.

### Q50. Thêm dữ liệu/đổi đề có phải viết lại agent loop không?

Nếu chỉ lookup/count/sum/compare theo cột được phép: thêm dataset, khai báo schema/scale/ID trong task, đăng ký catalog, example goals và acceptance cases; restart để nạp snapshot mới. Không sửa loop và không cấp đường dẫn tùy ý cho model.

Scaffold có ba template notes/dataset-read/proposal, preview và acceptance riêng: [EXAM_SCAFFOLD.md](EXAM_SCAFFOLD.md). Đã có **đề xuất chuyển phòng**, kiểm capacity, nhưng chưa có booking hay áp dụng chuyển phòng thật. Nếu cần join, công thức mới, CRUD bảng, policy mới hoặc lịch đặt phòng thì phải thiết kế tool/rules/test. Đổi prompt không thay backend capabilities.

### Q51. Vì sao Node/frontend thuần và file storage? Điểm yếu production là gì?

Ít setup/dependency, dễ đọc code, tiện mang đi thi. Đánh đổi: chưa authentication theo người, không coordination nhiều process/DB transaction tổng quát, BM25 đơn giản, context hữu hạn, live model có lỗi. Đây là sườn học tập có kiểm soát, chưa là dịch vụ production đa người dùng.

### Q52. Code có AI hỗ trợ thì sinh viên cần tự chứng minh gì?

Tự vẽ loop, giải thích được inference call, retriever, schema/rules, approval/hash/idempotency, source grounding và budgets; dự đoán failure trước khi chạy. Nêu rõ phần được hỗ trợ, phần đã tự kiểm chứng và phần còn thiếu. Không học thuộc nhãn PASS hoặc diễn giải prompt thành bảo đảm an toàn.

## 10. Lộ trình luyện vấn đáp và phần bổ sung sau

**Lượt 1, không chạy model:** đọc câu giới thiệu → mở `catalog.json` xác định task/profile → chỉ `drive()` và `model.complete()`/fetch → giải thích BM25 khác embedding → mở dữ liệu và dự đoán tổng/count → chỉ registry/approval/metrics.

**Lượt 2, demo kiểm chứng:** dùng các lệnh dưới; scripted/fake không tốn quota LLM. Muốn live phải chủ động chọn profile và request cap, dùng goal đã kiểm chứng. Không sửa `.env` hoặc tests để lấy PASS.

```powershell
npm test
npm run eval
npm run demo:datasets
npm run demo:budgets
npm run exam:smoke
npm run exam:rehearsal
# Kiểm tra model thật có chủ động, sau khi local model đã được warm:
npm run exam:model -- --profile=ollama-qwen3 --action=probe
# Ví dụ live hữu hạn; không tự thực hiện chỉ vì đọc tài liệu:
npm run exam:smoke -- --live --profile=ollama-qwen3 --only=sum --repeat=3 --max-requests=9
```

**Lượt 3, tự đặt câu hỏi:** nếu provider 503 lúc chỉ còn một request? Nếu dataset sửa sau khi run chờ duyệt? Nếu model cite ID thật nhưng đảo hai tổng? Nếu query rỗng? Nếu reload khi awaiting approval? Trả lời bằng code/bằng chứng, phân biệt backend đúng với model trả đúng.

Các nội dung chưa xác định nên bổ sung theo đề/câu hỏi giảng viên:

| Chủ đề cần bổ sung | Trạng thái hiện tại | Bằng chứng cần có trước khi viết đáp án |
|---|---|---|
| Bộ câu hỏi/tiêu chí chấm thực tế của giảng viên | Chưa được cung cấp | Đề/rubric hoặc câu đã hỏi, không tự đoán là yêu cầu bắt buộc |
| Embedding model/dimension/vector DB/hybrid retrieval | Chưa triển khai/chưa chọn | Thiết kế mới + code + eval; không gắn tên một model embedding tùy ý |
| Quantization, VRAM/RAM, context limit và tokenizer chính xác của model trên máy | Chưa đối chiếu đầy đủ | Metadata model đã tải, cấu hình/hardware thực tế, nguồn provider phù hợp |
| Native function calling, streaming, reranking | Chưa có trong đường hiện tại | Code và tests tương ứng nếu thực sự bổ sung |
| Lưu/chỉnh bản ghi dataset, join/công thức mới | Ngoài tools hiện có | Tool mới, business rules, quyền, approval/idempotency và acceptance |
| Auth/deployment/database production | Chưa là mục tiêu đã hoàn thành | Yêu cầu cụ thể và kiểm chứng riêng |
| Thời gian sinh viên đổi đề | Chưa đo thực tế | Nhật ký đủ bước `exam:timer`, edits/errors và review; không lấy script time thay |

Mẫu thêm một câu hỏi sau:

```text
Qxx. Câu hỏi giảng viên:
Trạng thái: Đã có / Kiến thức nền / Chưa có / Chưa xác minh
Trả lời ngắn:
Giải thích sâu / ví dụ:
File + hàm/khóa cần mở:
Test/report chứng minh (ngày, task/profile identity):
Giới hạn / điều chưa thể khẳng định:
```

Khi code/dữ liệu/model đổi, cập nhật câu trả lời và bằng chứng liên quan. [DEFENSE_NOTES.md](../DEFENSE_NOTES.md) là ghi chú bảo vệ từ các mốc trước; dùng cùng source hiện tại và tài liệu này, đặc biệt đối chiếu catalog/runtime/budgets mới. [EXAM_ADAPTATION.md](../EXAM_ADAPTATION.md) hướng dẫn đổi đề; [EXAM_REHEARSAL.md](EXAM_REHEARSAL.md) hướng dẫn vận hành và giữ kết quả thất bại.

## 11. Luyện trả lời sâu: lựa chọn model, training và RAG

### Q53. Vì sao chọn Qwen3 8B, không phải cứ model lớn nhất?

**Trả lời 20 giây:** “Em ưu tiên chạy offline để giảm phụ thuộc mạng và quota. Qwen3 8B đã được chạy thử trên máy và có evidence cho những goal cụ thể. Em cân nhắc chất lượng, thời gian, tài nguyên và giao thức, không khẳng định đây là model tốt nhất.”

**[Đã có]** Profile `ollama-qwen3` khai báo `qwen3:8b`, loopback port 11434, `requires_key:false`; `reasoning_effort:none`, temperature 0 và output cap gửi qua adapter. Kết quả phải đọc cùng identity và giới hạn của run. Profile 4B chỉ dùng so sánh, chưa là phương án dự phòng đã đạt.

**Chỉ code:** [catalog.json](../config/catalog.json) `model_profiles`; [openaiCompatible.js](../src/model/openaiCompatible.js) payload. **Không khẳng định:** RAM/VRAM hay quantization cụ thể khi chưa đọc metadata model đã tải. 8B là quy mô tham số, không phải context 8 nghìn token hay yêu cầu đúng 8 GB RAM.

### Q54. Model free hay trả phí? Vì sao local vẫn đo token?

**Trả lời 20 giây:** “Qwen3 8B trong profile này chạy trên máy em, không gửi request tới dịch vụ trả phí theo token. Vẫn có chi phí phần cứng, điện, lưu trữ và thời gian. Token giúp theo dõi lượng xử lý/context, không đồng nghĩa em đang trả tiền cho từng token local.”

Qwen3 open-weight được công bố theo Apache 2.0; cần tuân thủ giấy phép khi phân phối. Ollama local và Ollama Cloud là hai chế độ khác nhau. Dịch vụ cloud có chính sách/giá/quota riêng có thể thay đổi; không suy toàn bộ model dùng qua Ollama đều miễn phí. Project không tính hóa đơn và không bảo đảm usage estimated bằng số token bị tính phí.

**Chỉ code:** [catalog.json](../config/catalog.json), `base_url` local và `requires_key`; [metrics.js](../src/agent/metrics.js), reported/estimated. **Nguồn:** [Qwen3 license](https://github.com/QwenLM/Qwen3), [Ollama FAQ](https://docs.ollama.com/faq), [Ollama pricing](https://ollama.com/pricing). Không chép giá cloud làm cam kết cố định trong bài thi.

### Q55. Có thay LLM khác được không? Đổi những gì và kiểm gì?

**Trả lời 20 giây:** “Có. Runner phụ thuộc interface `complete()`, không phụ thuộc trực tiếp Qwen. Model mới dùng endpoint tương thích thì có thể thêm profile; API khác thì cần adapter. Sau đổi phải kiểm chứng lại, không suy rằng cấu hình hợp lệ là giải bài tốt.”

1. Xác định model đã có sẵn và endpoint có hỗ trợ `/chat/completions`.
2. Tạo profile backend trong [catalog.json](../config/catalog.json), hoặc sửa môi trường cho profile `env`; giữ key phía backend.
3. Đối chiếu JSON mode, `reasoning_effort`, sampling, output/context và timeout; không gửi tham số provider không hỗ trợ.
4. Restart khi cấu hình file thay đổi; inspect/warm/probe phù hợp rồi **tạo run mới**.
5. Kiểm tool selection, schema/arguments, số, nguồn, approve/reject, budgets và live stability có giới hạn.

**Chỉ code:** [model/index.js](../src/model/index.js) factory; [openaiCompatible.js](../src/model/openaiCompatible.js) adapter; [agent.config.js](../config/agent.config.js) `loadConfig()`; [runManager.js](../src/agent/runManager.js) runtime identity. Không đổi model ngầm giữa run; profile unavailable không tự fallback sang mock. Tên `openai-compatible` chỉ là giao thức, không phải bảo đảm mọi provider hỗ trợ giống hệt nhau. [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility).

### Q56. Training, fine-tuning, prompting, indexing và inference khác nhau thế nào?

**Trả lời 20 giây:** “Project chỉ dùng inference với model huấn luyện sẵn. Sửa prompt, nạp notes và tạo index không cập nhật trọng số của Qwen. Training/fine-tuning mới là quá trình học làm thay đổi weights hoặc các tham số adapter.”

| Hoạt động | Thay weights model? | Vai trò | Trong project |
|---|---|---|---|
| Pre-training | Có | Học từ dữ liệu lớn; với causal LM thường dự đoán token tiếp theo | Do nhà phát triển model thực hiện, không phải repo |
| Fine-tuning | Có, toàn bộ/một phần hoặc adapter | Thích nghi hành vi bằng dữ liệu huấn luyện chuyên biệt | Chưa có |
| Prompting | Không | Thay instruction/context đầu vào | Có: mission, safety, tool schema |
| Indexing | Không cập nhật weights LLM | Chuẩn bị cấu trúc tìm kiếm dữ liệu | Có: BM25 index |
| Inference | Không cập nhật weights | Sinh output bằng model có sẵn | Có: `model.complete()` |

**[Kiến thức nền]** Training thường gồm forward → loss → backpropagation → optimizer update, lặp trên batches. Fine-tune cần dữ liệu hợp lệ, tách train/validation/test tránh leakage, baseline, tài nguyên và eval sau triển khai. LoRA học adapter tham số nhỏ hơn thay vì nhất thiết sửa toàn bộ weights. Không trình bày đây là pipeline đã chạy trong repo.

**Nguồn:** [Qwen3 pre/post-training](https://qwenlm.github.io/blog/qwen3/). `ollama pull/run` tải/phục vụ model, không tự train. Thêm dữ liệu vào `data/notes/` không làm Qwen ghi nhớ vĩnh viễn.

### Q57. Dùng RAG có bắt buộc train model không? Khi nào nên fine-tune?

**Trả lời 20 giây:** “Không bắt buộc train. Em có thể dùng LLM và retriever đã có sẵn, tìm tài liệu liên quan rồi đưa vào context lúc inference. RAG thay phần ngữ cảnh, không mặc nhiên thay weights.”

Tài liệu thay đổi thường xuyên và cần truy nguồn: cân nhắc retrieval trước. Nếu cần cải thiện hành vi/định dạng ổn định trên nhiều ví dụ, có thể cân nhắc fine-tuning sau khi đo lỗi, chuẩn bị dữ liệu và baseline. Hai phương pháp có thể kết hợp; không coi fine-tuning là database hay bảo đảm không hallucination.

**Chỉ code:** [searchNotes.js](../src/tools/searchNotes.js) tìm passage; [runner.js](../src/agent/runner.js) `observe()` bổ sung context và `buildMessages()` gửi lượt sau. Không có optimizer/backprop/training loop trong repo. Bài RAG gốc có huấn luyện kiến trúc của tác giả; cách tích hợp retrieval vào ứng dụng hiện nay không bắt buộc phải tái huấn luyện theo bài đó. [Nguồn RAG](https://arxiv.org/abs/2005.11401).

### Q58. Vẽ và giải thích một run 401/403 từ đầu đến cuối?

**Trả lời 20 giây:** “LLM đề xuất tìm ghi chú. Backend kiểm tra rồi BM25 trả passage. LLM nhận passage trong observation, sinh câu trả lời có source ID; backend kiểm tra ID trước khi hoàn tất.”

Ví dụ minh họa giao thức, không phải transcript/evidence của một run thật:

```json
{"type":"tool_call","tool":"search_notes","arguments":{"query":"401 403","limit":3}}
```

1. UI gửi goal/task/profile tới `POST /api/runs`; backend tạo state và trả 202.
2. `drive()` → `askModel()` → `buildMessages()` → `model.complete()`; inference thứ nhất đề xuất read tool.
3. Registry kiểm allow-list/schema/rules. `searchNotes.execute()` gọi retriever.
4. BM25 chấm passage; kết quả chứa text/source ID/score. `observe()` thêm vào messages dưới dạng dữ liệu không tin cậy.
5. Inference tiếp theo có evidence mới; model có thể tìm tiếp hoặc trả final.
6. `parseDecision()`/`checkGrounding()` kiểm tra; persist trạng thái, answer và metrics; UI polling hiển thị.

**Chỉ code:** [runner.js](../src/agent/runner.js), [searchNotes.js](../src/tools/searchNotes.js), [keywordSearch.js](../src/retrieval/keywordSearch.js), [decision.js](../src/agent/decision.js). Hai inference và một tool là ví dụ thường gặp, không phải thứ tự/số lượt hard-code. Payload HTTP gọi LLM khác tool decision JSON; project không gửi native provider `tools/tool_calls`.

### Q59. Những câu nào dễ nói sai khi bảo vệ project?

**Trả lời ngắn:** “Em phải tách model, runtime, retriever và backend policy; nói rõ cái đã có, cái chưa có và phạm vi kiểm chứng.”

| Không nên nói | Nói chính xác |
|---|---|
| Em dùng Ollama làm LLM | Em dùng Qwen3 8B; Ollama chạy/phục vụ model |
| Qwen3 8B là embedding model của em | Project chưa có document/query embedding model |
| Em train bằng cách thêm notes/sửa prompt | Em thay dữ liệu truy xuất/input inference, không cập nhật weights |
| BM25 là vector search ngữ nghĩa | BM25 chấm từ khóa; không có dense embedding index |
| Có RAG là không hallucination | Retrieval/grounding giảm rủi ro; vẫn cần eval ngữ nghĩa |
| Có source ID là answer chắc chắn đúng | Membership đúng chưa chứng minh nguồn hỗ trợ từng câu |
| Model tính tổng và tự ghi database | Backend tính số và kiểm tra/phê duyệt ghi; proposal không apply |
| Mock PASS chứng minh agent LLM sẵn sàng | Mock/scripted kiểm backend; model thật cần live evidence riêng |
| Chặn injection nghĩa là model miễn nhiễm | Backend có thể chặn dù model đã bị ảnh hưởng |
| Temperature 0 hoặc ba PASS bảo đảm mọi đề | Chỉ có bằng chứng hữu hạn cho đúng cấu hình/goal đã thử |

### Q60. Nếu thầy hỏi “em tự làm và hiểu được phần nào”, chứng minh ra sao?

**Trả lời 20 giây:** “Em khai báo phần AI hỗ trợ, rồi tự giải thích luồng, dự đoán một ca lỗi và sửa một task có acceptance đúng. Em không chứng minh hiểu biết chỉ bằng việc bấm Run hoặc đọc nhãn PASS.”

Tự làm ba bài không cần gọi model:

1. Mở catalog, chỉ task/profile, model name/endpoint và tools đang bật; giải thích vì sao UI không được gửi endpoint/key tùy ý.
2. Với goal sum `price` stationery, dự đoán 30.30; giải thích scale 2/BigInt và nguồn query. Nếu đổi expected thành 12 thì grader phải FAIL, không lấy output đang test làm đáp án.
3. Vẽ approval/reject/replay: người duyệt từ chối → 0 proposal; final của model có thể sai nhưng không được biến backend outcome thành “saved”. Phân biệt hash nội dung với authentication người duyệt.

Sau đó tự diễn tập đổi đề bằng [STUDENT_REHEARSAL.md](STUDENT_REHEARSAL.md). Các chức năng/kiến thức ngoài phạm vi phải nói “chưa triển khai” hoặc “chưa xác minh”, không hứa model/framework sẽ tự giải được.

## 12. Thích nghi đề và ngôn ngữ

### Q61. UI language khác ngôn ngữ trả lời như thế nào?

**Trả lời ngắn:** “UI VI/EN chỉ đổi nhãn bằng dictionary tĩnh. Model trả theo goal gốc hoặc yêu cầu ngôn ngữ rõ trong goal; em không có selector ngôn ngữ trả lời.”

Mở [i18n.js](../public/i18n.js) để chỉ dictionary/preference `agent-studio.ui-locale`. UI EN + goal VI vẫn yêu cầu answer VI; UI VI + goal EN yêu cầu answer EN. `Giải thích HTTP 429 bằng tiếng Anh.` ưu tiên EN. Toggle không gửi HTTP model/probe, không sửa goal/final/approval/hash/budget. Task title do người dùng đặt có thể giữ nguyên. Run cũ không tự dịch khi reload.

### Q62. Goal VI/EN được xử lý ở đâu? Có thêm lượt dịch không?

**Trả lời ngắn:** “Runner giữ nguyên goal và đưa vào inference. System prompt backend yêu cầu theo ngôn ngữ tự nhiên của goal; không có HTTP dịch riêng hoặc regex chứng minh mọi câu đúng ngôn ngữ.”

Mở [prompts.js](../config/prompts.js) (`languagePolicy`) và [runner.js](../src/agent/runner.js) (`buildMessages`, `startRun`). Run mới lưu `language_policy: goal-natural-v1`; legacy thiếu trường vẫn giữ contract cũ. Model phải tìm từ khóa thích hợp với notes vì retriever vẫn BM25, không semantic embedding. Enum `open`, ID `T2` hoặc vài từ tiếng Anh trong bảng không tự quyết định ngôn ngữ. Paraphrase ngoài phạm vi cần thử live, không bảo đảm model hiểu mọi câu.

Quyền ghi kiểm **goal gốc**, không lấy bản dịch model làm quyền: [saveDraft.js](../src/tools/saveDraft.js) bỏ trích dẫn/chặn phủ định và chỉ nhận mệnh lệnh đầu câu hoặc `Tóm tắt ... và lưu bản nháp.`. Câu `Explain how to save a draft.` chỉ nhắc thao tác, không cấp quyền. Không dùng tokenizer BM25 để kiểm authorization vì stopwords sẽ mất `and/và/không`. [policies.js](../src/proposals/policies.js) dùng grammar proposal hữu hạn. Instruction trong tài liệu/tool result không cấp quyền hoặc đổi instruction ngôn ngữ.

### Q63. Vì sao không dịch IDs, enum, số, hash hoặc dataset?

**Trả lời ngắn:** “Đó là giá trị giao thức và khóa đối chiếu; dịch sẽ làm sai filter, source grounding hoặc arguments/hash người dùng đã duyệt.”

`status: "closed"` vẫn là enum `closed`, không thay thành `đã đóng` trong JSON. `asset_code: CAM1`, `source_id`, snapshot và decimal `30.30` giữ nguyên. Giao diện có thể giải thích tiếng Việt bên cạnh, nhưng raw JSON không sửa. Hash ràng buộc đúng run/tool/arguments; backend không ‘sửa hộ’ model rồi thực thi. Số được backend xử lý fixed-point/BigInt theo scale, không giao model nhẩm phép tính chính xác.

### Q64. Thêm tool/policy mới mà không sửa agent loop như thế nào?

**Trả lời ngắn:** “Em thêm module/factory, đăng ký backend, cho task quyền dùng, kiểm schema/rules/evidence và viết acceptance; loop chỉ đọc registry.”

Ví dụ giả lập [assetAvailability.js](../src/business/assetAvailability.js) kiểm số lượng 1–20 với available scale 0. [checkAssetAvailability.js](../src/tools/checkAssetAvailability.js) ánh xạ lookup qua query engine đã có, dùng `data.idColumn` (`asset_code`), trả bounded observation và record evidence thật. Policy `asset-loan` dùng cùng hàm, kiểm evidence trong run/snapshot và recheck trước publish proposal; không giảm tồn kho hoặc xác nhận đã mượn.

Đường nối đầy đủ: **module → registry/factory → task allow-list → loader/schema → prompt description → record evidence → tests/acceptance → catalog**. Mẫu `.template` trong `templates/development` chưa điền sẽ throw/fail, không tự đăng ký. Xem [ADAPTATION_KIT.md](ADAPTATION_KIT.md) và [asset-extension.test.js](../tests/asset-extension.test.js). Fingerprint policy bao phủ cả helper nghiệp vụ; đổi helper làm pending proposal không còn hợp lệ.

### Q65. Chính xác phần nào là “đổi đề nhanh”, phần nào cần code?

**Trả lời ngắn:** “Đổi miền trong khả năng hiện có thường là config/data/spec/expected. Khả năng hoặc luật chưa có phải viết tool/policy và test; mission không tự tạo chức năng.”

Điền [phiếu một trang](EXAM_REQUIREMENT_WORKSHEET.md) mục tiêu/input/output/ID/scale/quyền/rules/expected trước. Dùng scaffold đã có: notes, dataset-read, proposal; preview không ghi, apply tạo file mới, register có chủ đích giữ defaults/backup. Các policy chỉ hỗ trợ canonical fields đã khai báo. Không có join/group-by/formula/CRUD tổng quát. Đề cần booking thật, field mapping chưa hỗ trợ hoặc hành động ngoài policy phải thêm code/test, không nạp module từ spec/model.

Expected độc lập từ đề/dữ liệu, có happy/empty/invalid/forbidden và approve/reject/replay. Scripted PASS kiểm backend, không chứng minh LLM hoặc thời gian sinh viên. **Chưa đo thời gian sinh viên đổi đề; không bảo đảm mọi đề trong hai giờ.**

### Q66. Nhắn tiếp “dịch câu trả lời” có chạy lại agent hoặc sửa lịch sử không?

**Trả lời ngắn:** “Không. Follow-up gắn đúng run terminal đang xem, chỉ diễn đạt lại context đã lưu, kết quả/accounting riêng; không có tool loop hoặc quyền ghi.”

Mở [followups.js backend](../src/agent/followups.js): request theo grammar hữu hạn, cùng task/snapshot/profile identity; API `POST /api/runs/:id/followups`. Tối đa 3 calls/3 HTTP/20.000 token dự phòng mỗi run, cap output 800 không vượt profile, timeout min(profile,30s), không retry/repair. Usage thiếu giữ reservation; restart giữ budget và đánh dấu in-flight BLOCKED, không tự gọi model.

Backend giữ nguồn, numeric tokens và literals/IDs; outcome ghi phải là finite VI/EN đúng approval/store. Proposal saved vẫn **applied:false**. Văn xuôi read là **REVIEW_REQUIRED** vì kiểm nguồn/số không chứng minh mọi ý đúng; không tự sửa output model để báo PASS. Yêu cầu nghiệp vụ mới tạo run mới. Final/trace/metrics/approval gốc không bị ghi đè; reload chỉ GET, đổi task/New run không trộn context.

## 13. Học trên điện thoại và cập nhật bản HTML

File **ORAL_EXAM_STUDY.html** là bản học standalone sinh từ tài liệu này. Toàn bộ câu hỏi/đáp án, CSS/JS và font có sẵn trong file; không fetch API, không gọi LLM, không cần key hoặc CDN. Link tài liệu chính thức chỉ dùng mạng khi bạn chủ động mở. Bản thân HTML không chứng minh các tests/live được chạy lại.

Gửi file HTML sang điện thoại và mở bằng trình duyệt có hỗ trợ JavaScript. Nếu ứng dụng Files chỉ preview HTML hoặc hệ điều hành không cho mở tương tác, dùng server tài liệu riêng trên máy cùng Wi-Fi:

```powershell
cd D:\New-Tech\ai-agent-starter
node scripts/serve-oral-study.js --lan
```

Mở địa chỉ IPv4 được in ra trên điện thoại; PC phải đang chạy server, cùng mạng và firewall cho phép trên **Private network**. Không bật trên Wi-Fi công cộng, không mở firewall tự động. Server này chỉ phục vụ HTML học, không expose API agent/.env/run/draft. Không đổi HOST của agent sang 0.0.0.0. Ctrl+C dừng server tài liệu.

Sau khi sửa Markdown, sinh lại bản HTML để tránh lệch nội dung:

```powershell
node scripts/build-oral-study.js
node scripts/qa-oral-study.js
```

Trên bản học: tìm có/không dấu → chọn chương/câu trọng tâm → đọc đáp án → chuyển Tự vấn đáp và nói trước khi mở đáp án → đánh dấu Đã nắm/Cần ôn. Tiến độ chỉ lưu cục bộ trong browser, không đồng bộ thiết bị, không đánh giá tự động độ đúng lời nói. Reset chỉ xóa tiến độ học của bản này; không tác động dữ liệu agent.
