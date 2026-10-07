# AI Agent Starter — kiến thức và bản đồ bàn giao

> Mục đích: cung cấp ngữ cảnh cho một agent khác tiếp tục phát triển **đúng project hiện có**, không viết lại sườn hoặc làm mất các ràng buộc an toàn. Đây là tài liệu định hướng; trước khi sửa, agent phải đọc code và test liên quan vì code là nguồn xác nhận cuối cùng.

**Mốc mục 6 hiện tại:** 253 tests, 16 eval, 3 dataset demos, 2 budget demos và Chrome QA desktop/mobile đạt. Có launcher/warm/two-domain rehearsal/timer/readiness CLI. Live còn FAIL và port 8787 chưa xác minh owner; chưa đo thời gian đổi đề thực tế. Xem phần mục 6 cuối file và [quy trình vận hành](docs/EXAM_REHEARSAL.md); không dùng các mốc lịch sử dưới đây để tuyên bố toàn bộ LLM ổn định.

## 1. Phạm vi và trạng thái hiện tại

- Project: `D:\New-Tech\ai-agent-starter`, môn *New Technologies in Software Engineering*.
- Snapshot đã push: nhánh `feature/exam-ready-snapshot-20261007`, commit `2dc82f8`, repo `https://github.com/franz08hmt/agent_stater`. Tài liệu bàn giao này được tạo **sau** snapshot đó; không mặc định coi nó đã được commit/push.
- Mục tiêu của sườn: khi nhận đề thi chưa biết trước, thay **nhiệm vụ, dữ liệu và công cụ nghiệp vụ**, giữ ổn định vòng lặp agent, hợp đồng API, kiểm tra quyền, phê duyệt và test nền.
- Nghiệp vụ hiện tại chỉ là ví dụ: hỏi đáp từ ghi chú học tập và, khi người dùng yêu cầu rõ, lưu bản nháp sau phê duyệt. Dữ liệu mẫu không phải thông tin chính thức của kỳ thi.
- Stack: Node.js `>=22.12`, JavaScript ES modules, `node:http`, HTML/CSS/JS thuần, lưu JSON cục bộ. `package.json` không có dependency; không cần `npm install`, Vite, React hay Tailwind để chạy project này.
- Mặc định server chỉ nghe `127.0.0.1:8787`. Giao diện, font Poppins, Heroicons và ảnh robot được phục vụ từ file cục bộ. `.env` và `var/` bị Git bỏ qua.

### Điều đã kiểm chứng tại mốc bàn giao

Mốc lịch sử snapshot: 82 tests; trước sửa P1 mục 4: 184 tests. Mốc sau sửa P1 đổi model khi restart ngày 2026-10-07: `npm test` **193/193**, `npm run eval` **16/16**, dataset scripted **3/3**; fake HTTP budget demos **2/2**, Chrome thật desktop/mobile normal/stop/approval **3/3**. Ollama `qwen3:8b` dataset live trước đó **2/3**: count/compare đúng, sum FAIL do model bịa nguồn, backend chặn sau hai repair; usage 4278/6006/3062 tokens, requests 3/4/2. Thử lại riêng sum ba lần sau sửa P1 cũng **2/3**: một lần bịa `products-12345` bị chặn, hai lần đúng `30.30` và source `ds-products-db151dcee06f7c46`. Chưa ổn định cho demo live; đây không phải một bộ `eval:live` hoàn chỉnh đạt.

Một số số liệu trong `README.md` (ví dụ số test cũ) và ghi chú lịch sử trong `DEFENSE_NOTES.md` có thể chưa được cập nhật theo snapshot mới. Khi có mâu thuẫn, kiểm tra **source → test/eval chạy lại → tài liệu**; không suy luận trạng thái hiện tại từ một câu ghi chú cũ.

## 2. Hiểu đúng mô hình Agent

Ứng dụng này **không huấn luyện một mô hình mới**. Nó dùng model đã có để đề xuất **một quyết định mỗi lượt**:

```text
Người dùng nhập goal
  → backend tạo run và gửi mission + tool descriptions + quan sát cho model
  → model trả JSON: tool_call hoặc final
  → backend parse, kiểm tra schema/quy tắc/nguồn/quyền/giới hạn
  → nếu là tool đọc: thực thi, đưa kết quả trở lại model và lặp
  → nếu là tool ghi: dừng chờ người duyệt đúng arguments
  → khi final hợp lệ hoặc gặp điều kiện dừng: lưu kết quả/trạng thái
```

Điểm phân biệt với workflow cố định: thứ tự tool **do model chọn theo quan sát mới**, không phải một chuỗi `search → save → answer` hard-code trong backend. Điểm phân biệt với chatbot thuần: model có thể **đề xuất gọi công cụ**, nhưng không được trực tiếp thực thi hoặc tự cấp quyền. Mock rule-based trong `src/model/mock.js` chỉ mô phỏng giao diện này để test offline; mock pass không phải bằng chứng năng lực LLM.

Phần truy xuất hiện dùng **BM25 theo từ khóa**, không có embedding/vector database. Nguồn được trích dẫn phải từng xuất hiện trong kết quả truy xuất của chính run đó. Kiểm tra này chỉ xác nhận *nguồn đã được truy xuất*, **chưa xác nhận nội dung nguồn thật sự chứng minh từng mệnh đề**; cần eval và đọc thủ công.

## 3. Bản đồ file và ranh giới trách nhiệm

| Khu vực | File chính | Vai trò |
|---|---|---|
| Khởi động/cấu hình | `src/server.js`, `config/agent.config.js`, `config/catalog.config.js`, `config/catalog.json`, các file task | Nạp `.env`, xác thực danh mục task/profile trước listen; mỗi run giữ runtime/giới hạn riêng. |
| HTTP và UI | `src/app.js`, `public/index.html`, `public/app.js`, `public/workspace-view.js`, `public/styles.css` | Route API, CSP, file tĩnh; nhập goal, điều hướng Overview/Agent/Dialogue/Saved drafts, hiển thị trạng thái, trace, duyệt/từ chối. Browser không chứa key và không gọi tool trực tiếp. |
| Vòng lặp | `src/agent/runner.js`, `src/agent/state.js`, `src/agent/decision.js` | Quyết định một bước/lượt; giới hạn, trạng thái, nguồn, phê duyệt, chống lặp và khôi phục an toàn. Đây là **lõi ổn định**, tránh sửa khi chỉ đổi đề. |
| Model | `src/model/openaiCompatible.js`, `src/model/mock.js`, `config/prompts.js` | Một adapter thật theo `/chat/completions`, mock để test; prompt giao thức JSON và quy tắc an toàn. |
| Công cụ | `src/tools/registry.js`, `src/tools/schema.js`, `src/tools/searchNotes.js`, `src/tools/saveDraft.js` | Danh mục/allow-list, schema, business rules, tool đọc và tool ghi mẫu. |
| Dữ liệu/lưu trữ | `data/notes/*.md`, `src/retrieval/keywordSearch.js`, `src/store/fileStore.js`, `var/` | Ghi chú, BM25, run/draft/audit JSON. `var/` là dữ liệu chạy cục bộ, không phải mã nguồn. |
| Kiểm chứng | `tests/*.test.js`, `eval/cases.json`, `eval/checks.js`, `eval/run-eval.js`, `scripts/smoke-live.js` | Unit/HTTP tests, ca đánh giá mock/live, thử model thật. |

Luồng khởi động: `src/server.js` → `loadConfig()` → `loadCatalog()` (loadTaskConfig/schema/fingerprint cho từng task; tạo adapter/profile nhưng không HTTP) → `createApp()` → store + runManager → load lịch sử một lần, chia runtime theo IDs đã lưu → runner.init(batch của chính runtime) → listen. Task/danh mục sai làm startup thất bại; profile thiếu cấu hình/key unavailable, không mock fallback.

## 4. Cấu hình nhiệm vụ: nên đổi ở đâu khi nhận đề

`config/task.json` có `id`, `title`, `mission`, `data.notes_dir`, `allowed_tools`, `sample_inputs`, `result_labels`, datasets tùy chọn. Đây là task ghi chú mặc định; `config/catalog.json` đăng ký task ghi chú/dataset và profile env/mock/Ollama. UI chọn bằng ID từ `GET /api/catalog`; thay file/data cần restart, không hot reload. Mỗi run dùng task/model snapshot riêng.

`config/task.config.js` từ chối trường lạ, tool chưa đăng ký/trùng, đường dẫn ra ngoài `data/`, symlink, thư mục ghi chú không có Markdown và JSON sai. Nó tạo `fingerprint` từ task và nội dung ghi chú. Khi khởi động lại sau khi đổi nhiệm vụ/dữ liệu, run cũ đang `running` hoặc `awaiting_approval` không được âm thầm tiếp tục; pending approval của phiên bản cũ bị hủy.

Thứ tự thay đổi an toàn khi có đề:

1. Trích yêu cầu thành **input, output, dữ liệu, tool đọc/ghi, quy tắc nghiệp vụ và 3–5 acceptance cases**. Không đoán tính năng ngoài đề.
2. Thay `mission`, `sample_inputs`, nhãn và thư mục dữ liệu trong `config/task.json`. Chỉ bật tool đã có thật trong `src/tools/registry.js`.
3. Nếu đề cần lọc/tính toán chính xác trên bảng JSON/CSV, tạo tool đọc chuyên dụng; không ép BM25 làm phép tính hay truy vấn cấu trúc.
4. Nếu cần tool mới: tạo object tool, đăng ký vào `BUILTIN_TOOLS`, thêm tên trong `allowed_tools`, rồi thêm test/eval cho happy path, lỗi dữ liệu, quyền và phê duyệt.
5. Khởi động lại, chạy test, eval, rồi một run thật với model sẽ dùng khi thi.

Một tool mới theo contract hiện có:

```js
export const exampleTool = {
  name: 'example_tool',
  access: 'read', // hoặc 'write'
  requiresApproval: false, // phải là boolean true cho mọi tool write
  description: 'Mục đích và lúc dùng tool',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  checkRules(args, ctx) { return []; }, // đồng bộ; trả mảng lỗi
  async execute(args, ctx) { return { results: [] }; },
};
```

`ctx` có `run`, `retriever`, `store`; với tool ghi sau phê duyệt còn có `idempotencyKey`. Nếu câu trả lời phải trích nguồn, tool đọc cần trả `results` chứa `source_id`. Đừng xóa tool mẫu quá sớm: nhiều test nền vẫn dùng chúng. Sau khi nhiệm vụ ổn định mới chủ động di chuyển hoặc viết lại các test phụ thuộc fixture mẫu.

## 5. Các bất biến không được phá

1. **Model output là dữ liệu không tin cậy.** Chỉ chấp nhận JSON `tool_call` hoặc `final` qua `src/agent/decision.js`; lỗi định dạng được sửa tối đa số lần cấu hình, không thực thi tự do.
2. **Allow-list và schema do backend thực thi.** `registry.check()` kiểm tra tên tool, arguments, schema và `checkRules`. Nội dung trong tài liệu truy xuất cũng là dữ liệu không tin cậy, không được cấp quyền hay thay system prompt.
3. **Mọi thao tác ghi cần người duyệt.** `access: 'write'` bắt buộc `requiresApproval: true`; registry từ chối khai báo sai lúc khởi động. Runner còn tự dựng cổng phê duyệt từ `access` để phòng vệ nhiều lớp. Không thêm lối tắt ghi qua frontend/API khác.
4. **Phê duyệt gắn đúng yêu cầu.** `args_hash` là SHA-256 của `run_id + tool + arguments` chuẩn hóa; quyết định duyệt phải trùng `approval_id` và hash. Quy tắc được kiểm tra lại ngay trước khi chạy tool ghi.
5. **Ghi không trùng.** `save_draft` dùng `approval_id` làm idempotency key; store tạo file bằng chế độ `wx`. Gửi lại cùng quyết định trả `replayed`, không sinh bản ghi thứ hai. Tool ghi mới cần bảo đảm idempotency tương đương.
6. **Nguồn và giới hạn.** `final.source_ids` chỉ gồm nguồn đã truy xuất trong run; nếu không có nguồn thì `unresolved` phải giải thích thiếu gì. Số bước, repair, timeout, kích thước input/context/output và hành động lặp có giới hạn phía backend.
7. **Chuyển trạng thái hợp lệ.** `running → awaiting_approval → running → completed/failed/stopped` (hoặc `running` đi thẳng tới trạng thái kết thúc). Mọi đổi trạng thái đi qua `transition()`; không tự sửa JSON run để “chạy tiếp”.

Nếu buộc thay protocol kết quả, sửa **đồng bộ** `config/prompts.js`, `src/agent/decision.js`, chỗ ghi `run.final` trong `runner.js`, UI và test. Nếu đề không bắt buộc, giữ contract `answer`, `source_ids`, `unresolved`.

## 6. API và một luồng demo

| API | Ý nghĩa |
|---|---|
| `GET /api/health` | Model, giới hạn, kiểu retrieval và metadata task; **không trả key**. |
| `POST /api/runs` `{ "goal": "..." }` | Tạo run, trả HTTP 202; backend xử lý nền. |
| `GET /api/runs`, `GET /api/runs/:id` | Liệt kê và đọc trạng thái/trace/kết quả. |
| `POST /api/runs/:id/approvals/:approvalId` `{ "decision": "approve" | "reject", "args_hash": "..." }` | Phê duyệt hoặc từ chối đúng đề xuất đang chờ. |
| `POST /api/runs/:id/stop` | Yêu cầu dừng; pending write bị hủy. |
| `GET /api/drafts` | Đọc các bản nháp đã lưu. |

Ví dụ “Tóm tắt về idempotency và lưu bản nháp”: model đề xuất `search_notes` → backend trả passages → model đề xuất `save_draft` → backend kiểm tra nguồn và chờ duyệt → người dùng duyệt đúng hash → lưu tối đa một draft → model mới được kết luận. Nếu người dùng chỉ yêu cầu “tóm tắt”, tool ghi bị business rule từ chối. Nếu bị từ chối duyệt, không có draft.

Frontend polling mỗi **600 ms** khi `running` hoặc `awaiting_approval`; có điều hướng view, badge Mock/Live, Run/New run/Stop, trace, approval và metrics. Mục 5 thêm selector task/model, metadata tool/data, probe chủ động và phục hồi viewed run_id sau reload. Mục 6 có launcher CLI; chưa có cost/quota chung hoặc CRUD dữ liệu.

## 7. Chạy và kiểm chứng

```powershell
cd D:\New-Tech\ai-agent-starter
node -v                         # yêu cầu >= 22.12
Copy-Item .env.example .env     # chỉ lần đầu; không ghi đè .env đang dùng
npm start                       # http://127.0.0.1:8787 theo mặc định
```

`.env` chọn `MODEL_PROVIDER=mock` (offline, không có LLM thật) hoặc `openai-compatible` với endpoint Gemini/Ollama/vLLM/OpenAI. Với Ollama cục bộ, model cần được tải trước và `MODEL_API_KEY` có thể để trống. Với cloud cần key hợp lệ và quota. Không chép key vào source, test, tài liệu, Git hay trình duyệt. Không tự động thay `.env` của người dùng.

```powershell
npm test                         # unit + HTTP; phải đạt trước/sau thay đổi
npm run eval                     # 16 ca mock của nghiệp vụ mẫu
npm run smoke:live              # chỉ khi .env trỏ tới model thật
npm run eval:live -- --only=E10,E11,E16  # live có thể tốn quota
```

Trong live eval: `PASS` là đạt, `FAIL` là sai, `INCONCLUSIVE` là chưa tạo được điều kiện để kết luận, `BLOCKED` là provider/quota/mạng cản trở, **không được gọi BLOCKED là PASS**. Mock/eval mẫu chỉ còn ý nghĩa nguyên vẹn khi vẫn dùng nghiệp vụ và fixture ghi chú mẫu. Với đề mới, sửa `eval/cases.json` và assertions cho đúng yêu cầu; không xóa test an toàn chỉ để lấy màu xanh.

## 8. Giới hạn và thứ tự phát triển tiếp

- **Đã có:** task config được xác thực; backend agent loop; mock + một adapter LLM; BM25; tool registry; approval/idempotency; UI demo; test/eval offline.
- **Đã bổ sung mục 3–4:** `query_dataset` JSON/CSV với count/sum/compare và provenance; per-run metrics, ngân sách request/token, UI metrics. Regression 200 hàng xen kẽ và smoke sai số/đảo nhóm được giữ nguyên.
- **Đã có mục 5:** task/model selector từ danh mục backend, runtime/snapshot theo run, metadata tool/data, model probe tối đa một HTTP và reload không gọi LLM/ghi lại.
- **Mục 6 đã thêm:** launcher kiểm tra môi trường, warm local có accounting, hai đề diễn tập và nhật ký bấm giờ. Sinh viên chưa diễn tập được đo thực tế.
- **Chưa có:** lưu draft trích nguồn dataset; preview hàng/CRUD; quota chung tài khoản hoặc tính tiền theo hóa đơn.
- Hạn chế hiện hữu: không có đăng nhập (mặc định chỉ local); lưu file JSON không phù hợp nhiều người dùng đồng thời; BM25 có thể bỏ sót câu hỏi diễn đạt khác; kiểm tra grounding không chứng minh câu trả lời đúng ngữ nghĩa; tool timeout có thể hoàn tất ngầm nên thao tác ghi phải idempotent.
- Thứ tự tiếp theo phụ thuộc đề: ưu tiên test sát nghiệp vụ, cấu hình/launcher hoặc diễn tập; chỉ bổ sung ghi dataset khi đề cần. Tránh thêm framework/dependency hoặc đổi nền lưu trữ nếu đề không cần.

### Contract và chỗ sửa của mục 4

- `src/agent/metrics.js`: metrics version 1 và ngân sách snapshot. `model_calls` đếm complete đã khởi chạy; `provider_requests` đếm HTTP thật bắt đầu; `repairs` đếm lượt complete sửa output sai; `retries` đếm HTTP gửi lại do mạng/5xx. Chặn trước gửi không tăng request/retry; mock đếm calls nhưng 0 HTTP.
- `tokens.reported.input/output/total` giữ null đến khi có usage hợp lệ (safe integer không âm, đủ ba trường, total=input+output). Usage thiếu/sai không thành 0. `tokens.estimated` giữ dự phòng input/output, `budget_used` là reported + estimated. `tokens.status` phân biệt provider reported/estimated/mixed/unavailable, các bộ đếm request có/mất/sai/pending usage giải thích độ bất định.
- `model_ms` gồm complete/backoff, `provider_ms` HTTP/read response, `active_ms` hoạt động, `approval_wait_ms` chờ duyệt kể cả restart, `wall_ms` toàn đời. `timing_incomplete` đánh dấu gián đoạn; không bịa thời gian request chết giữa chừng.
- `src/model/openaiCompatible.js` nhận requestControl của runner: gate trước **từng** fetch/retry, start/end accounting và persist. 429 không retry; mạng/5xx tối đa một lần; backoff có thể bị abort. Standalone complete ngoài run không nằm trong ngân sách run.
- `config/agent.config.js`/`.env.example`: requests mặc định 12 (cứng), token 100000 (ước lượng). Input = byte UTF-8 JSON messages + 128 + 32/messages, output dự phòng cap mỗi lượt có thể giảm tới 64. Usage hợp lệ thay dự phòng; lỗi/thiếu usage giữ dự phòng. Không có tokenizer, không cam kết token bị tính phí tuyệt đối.
- `runner.js`/`state.js` lưu metrics qua store cũ. Stop ngân sách = `stopped/request_budget` hoặc `token_budget`, giữ tool/trace. Approval không reset budget; kiểm tra trước write khi tiếp tục; replay không tăng counters. Legacy = `not_collected`, approval legacy dừng `metrics_unavailable`. Giữ interrupted/task_changed, không tự rerun model.
- P1 đã sửa trong `runner.init()`: so sánh provider/name/is_mock của `run.model` với model hiện tại. Khác thì run đang hoạt động thành failed/model_changed, hủy pending approval, không HTTP/mock call/write; giữ counters, tokens, limits và model/mock label lịch sử. Run terminal không bị sửa; model không đổi tiếp tục bình thường; task_changed ưu tiên nếu cả task/model đổi. Legacy running thiếu model metadata vẫn interrupted; pending approval thiếu model metadata bị hủy. Không chỉ lật metrics.is_mock.
- 9 regression mới trong `tests/run-metrics.test.js` phủ mock→HTTP, HTTP→mock, tên HTTP, provider riêng, cờ mock riêng, model mock/HTTP không đổi với fresh instance, terminal history và run HTTP mới budget=1 chặn retry. `scripts/demo-datasets.js` hỗ trợ `--only=products|classes --repeat=1..5` để thử độ ổn định mà không thay grounding/maxRepairs. Kết quả ba trial products: requests 3/2/2, reported tokens 4278/2920/2920, repairs 2/0/0; PASS hai trial sau, FAIL trial đầu được giữ nguyên.
- UI: `public/run-metrics.js`, `public/app.js`, `public/index.html`, static route/health trong `src/app.js`. Không đổi final/decision/schema/tool nghiệp vụ/fileStore.
- Tests mới: `tests/metrics.test.js`, `tests/run-metrics.test.js`, `tests/metrics-ui.test.js`. `npm run demo:budgets` dùng fake HTTP: normal completed với 2/12 requests và 30 provider tokens; stopped 1/1 với 15 provider tokens, giữ bước search. `npm run qa:metrics` dùng Chrome/Edge thật qua native CDP vì phiên không có browser MCP; `CHROME_PATH` tùy chọn. Không dependency, profile/store tạm, screenshot ở temp.
- Xem [README metrics](README.md#metrics-và-ngân-sách-mỗi-run-mục-4) và [EXAM_ADAPTATION](EXAM_ADAPTATION.md) trước ngày thi. Các giới hạn theo từng run không thay quota chung/daily provider; không bảo đảm kế toán nếu máy chết trước snapshot request-start được lưu.

### Contract và kiểm chứng mục 5 (2026-10-07)

Mốc chốt mục 5: 222 tests đạt. Hai regression chốt cuối giữ legacy run không metrics ở trạng thái chưa thu thập và cộng đúng wall/wait khi cấu hình pending bị mất. Phát hiện thêm lỗi phân loại run deadline khi Date.now lệch nhịp với timer: giữ assertion cũ, thêm test clock frozen, runner nhận diện deadline signal để stopped/run_timeout thay vì failed/model_timeout. Không tăng timeout hoặc nới giới hạn.

- Danh mục: `config/catalog.json`/`catalog.config.js`. Task ID → `config/<file>.json` được phép, schema/fingerprint/dataset safety cũ giữ nguyên. Thêm task/file dữ liệu rồi đăng ký ID, không sửa agent loop. Tối đa 8 task/10 profile, danh mục 24 KiB. Profile env giữ `.env`; profile bổ sung chỉ đọc credentials qua biến môi trường được backend khai báo, không kế thừa key/endpoint của env. UI không nhận/gửi path, module, endpoint, mission hoặc allow-list.
- Metadata `GET /api/catalog`: defaults, task/title/examples/result labels; tool name/description/read-write/approval thực từ registry; note source IDs/title/passages (tối đa 40), dataset columns/row count/version; profile ID/label/provider/name/Mock-Live/configured-unavailable/reason. Không key, tên biến secret, system prompt, endpoint hoặc đường dẫn máy. Không preview hàng hoặc đưa file đầy đủ lên browser. `save_draft` chỉ nguồn ghi chú.
- `POST /api/runs` thêm task_id/model_profile_id tùy chọn; goal-only vẫn default. `state.js` lưu IDs, model_identity, configuration metadata/limits và runtime_settings; API bỏ messages/fingerprints/identity/settings nội bộ. `runManager.js` load store một lần, chia owners/runtimes theo IDs + limits/timeout; runner.init chỉ nhận batch của chính runtime. Không process.env/current task/model global theo select. Hai cấu hình độc lập registry/retriever/data/model/budget, đổi select không sửa run cũ.
- Restart: tìm ID lưu trong run. Thiếu task/profile hoặc unavailable → failed/configuration_missing, hủy pending. Task fingerprint khác → task_changed; identity model khác → model_changed (provider/name/mock/profile/endpoint/options, không credentials). Giữ model label/counters/token/limits; không trộn mock/thật. Terminal load read-only và approval replay không tạo runtime/write/request. Running gián đoạn vẫn interrupted; không tự gọi LLM để khôi phục. Legacy không IDs dùng defaults và các check cũ; thiếu metrics không tiếp tục approval.
- `POST /api/model-profiles/:id/probe` body `{}`: `src/model/probe.js` dùng input cố định, một HTTP tối đa, retry=false, timeout min(config,5000), output 64, ngân sách riêng 4096 estimated. Trả probe ID/timestamp/mock/endpoint_responded/protocol_ok/error/metrics, append audit riêng. Usage thiếu null + dự phòng. Mock simulation không HTTP; không kiểm chứng LLM thật. 200 thiếu content cũng đánh dấu endpoint responded/protocol fail. Probe không chứng minh giải đúng nghiệp vụ hoặc độ ổn định tương lai.
- UI: `public/configuration.js` dựng select/metadata bằng textContent, không XSS từ nội dung dữ liệu; khóa select khi active/probing. `public/run-session.js` chỉ lưu viewed run_id; app GET/poll sau reload, không gửi lại goal/approve. Terminal dùng metadata lịch sử, select cho run mới có thể default sau reload. Invalid/missing ID có thông báo, New run giữ lịch sử backend. Poppins/Heroicons/local assets giữ nguyên.
- Mock trong `src/model/mock.js` hỗ trợ ba example goals dataset offline, giá trị/source lấy đúng observation. Goal khác trả unresolved, không phải bộ giải đề bằng LLM. Không nới grounding, repair hoặc thêm dependency.
- Kiểm chứng: **222/222 npm tests**, **16/16 eval**, **3/3 dataset scripted**, **2/2 budget demos**. Tests mới catalog/selection/run-session; regressions 200 hàng, smoke sai số/đảo nhóm, bịa citation, model_changed và chặn retry trước request giữ nguyên. Chrome thật qua native CDP (browser MCP không có), profile/storage tạm: selector/data/tools/examples/Mock-Live-unavailable, keyboard/focus, desktop1280/mobile390; reload running/pending/terminal, approval/reject/replay, probe success/503/429/timeout/invalid protocol/usage thiếu và error/budget stop. `npm run qa:configuration`: 7 probe HTTP + 8 run HTTP đều fake, không cloud; một GET404 chủ động kiểm tra missing run, không lỗi browser khác. `npm run qa:metrics` vẫn giữ assertions, chỉ dùng instant scroll để click đúng sau form dài hơn.
- Live local đợt mục 5: probe Ollama qwen3:8b đầu **timeout 5s**, 1 HTTP, usage unavailable (dự phòng400); sau hai dataset run, probe thứ hai **protocol/connectivity valid**, 1 HTTP, usage **42 input + 6 output = 48**, ~2.2s. Tổng sản phẩm thử hai lần: **1/2 PASS**, lần đầu bịa products-12345 và bị chặn (3 HTTP/4278 tokens/2 repairs), lần sau query đúng và trả stationery=30.30/source ds-products-db151dcee06f7c46 (2 HTTP/2920 tokens/0 repair). Không cloud. Chưa ổn định để bảo đảm demo live; chưa chạy full eval:live trong đợt này.
- Trước buổi thi: npm start → chọn Task/Model → đọc metadata → Check model chủ động → Example goal → Run → kiểm tra nguồn/metrics → duyệt đúng hash nếu có. Model cần cài/tải/warm từ trước; ứng dụng không làm tự động. Probe cold start timeout phải đọc là timeout; có thể chủ động kiểm tra lại sau warm. Offline mock là dự phòng demo backend, không bằng chứng LLM. Xem README/EXAM_ADAPTATION phần mục5 cho API/thêm profile và giới hạn.

File thêm/sửa riêng đợt mục5 (các thay đổi mục3–4 sẵn có giữ nguyên):

- Config: `config/catalog.json`, `config/catalog.config.js`; cập nhật comment `config/task.config.js`.
- Backend: `src/server.js`, `src/app.js`, `src/agent/runManager.js`, `src/agent/runner.js`, `src/agent/state.js`, `src/model/probe.js`, `src/model/openaiCompatible.js`, `src/model/mock.js`, `src/retrieval/keywordSearch.js`.
- UI: `public/configuration.js`, `public/run-session.js`, `public/app.js`, `public/index.html`, `public/styles.css` (run-metrics cũ tái sử dụng).
- Kiểm thử/demo: `tests/catalog.test.js`, `tests/selection.test.js`, `tests/run-session.test.js`, `tests/runner.test.js`; `scripts/configurationDemoFixture.js`, `scripts/browserQa.js`, `scripts/qa-configuration-browser.js`, `scripts/qa-metrics-browser.js` (instant scroll), `package.json` (`qa:configuration`).
- Tài liệu: `README.md`, `EXAM_ADAPTATION.md`, file handoff này. Không sửa .env, xóa var, commit/push hoặc thêm dependency.

## 9. Quy tắc làm việc cho agent nhận bàn giao

1. Đọc `README.md`, `EXAM_ADAPTATION.md`, `config/task.json`, rồi **chỉ** các source/test liên quan nhiệm vụ mới. Kiểm tra `git status` và giữ nguyên mọi thay đổi sẵn có của người dùng.
2. Nêu giả định và phạm vi trước khi sửa. Nếu yêu cầu mới xung đột bất biến ở mục 5, báo rõ và xin quyết định; không âm thầm nới lỏng bảo vệ.
3. Làm từng lát nhỏ: test thất bại có chủ đích → sửa tối thiểu → `npm test` → eval phù hợp → live smoke nếu có model thật → kiểm tra UI bằng browser khi sửa giao diện.
4. Không sửa `runner.js`, `state.js`, `decision.js`, `fileStore.js` chỉ để “đổi đề”. Nếu bắt buộc, thêm test cho approval, idempotency, grounding, giới hạn và restart trước khi kết luận.
5. Theo yêu cầu mới của người dùng: **commit local sau mỗi đợt hoàn tất và kiểm chứng để lưu tiến trình**. Rà soát diff/secret, chỉ stage file liên quan; giữ `.env`, runtime `var/` và skill local ngoài commit. Không push, đổi nhánh, xóa `var/`, ghi đè `.env` hoặc thay project khác nếu chưa được yêu cầu riêng. Repo GitHub là **public**; rà soát dữ liệu riêng và secret trước mọi lần push.
6. Thư mục `.agents/` hiện là dữ liệu local chưa tracked; `.agents/AGENTS.md` mang tên **LogiRoute VN**, không khớp project này. Không tự coi các quy tắc logistics trong đó là đặc tả nghiệp vụ của AI Agent Starter. Nếu môi trường tự động áp dụng nó, nêu xung đột để người dùng xử lý.

### Mục 6 — launcher và diễn tập, 2026-10-07

Tài liệu vận hành: [docs/EXAM_REHEARSAL.md](docs/EXAM_REHEARSAL.md); README/EXAM_ADAPTATION đã cập nhật. Các checkpoint local: `962369d` launcher/warm; `0b18d15` citation repair; `6e78148` rehearsal/timer/readiness; `22c181f` phân biệt model evidence/profile so sánh; `505ae1d` chặn redirect và ghi settings thực tế. Xem `git log` để lấy checkpoint cuối của docs và kết quả kiểm chứng. Giữ nhánh `feature/exam-ready-snapshot-20261007`; chưa push. `.agents/` untracked có sẵn được giữ nguyên, không stage; không viết `.env`, xóa run/draft thật hoặc sửa project khác.

**Contract/vị trí:**

- `package.json`: exam:start/model/smoke/rehearsal/timer/report. `scripts/exam-start.js` và `src/operations/context.js` lấy root từ file URL, kiểm tra engine package, nạp env/catalog theo cơ chế cũ. Server cũng dùng loader này, không phụ thuộc cwd. Không cài/tải/chạy admin/cloud khi startup.
- `src/operations/launcher.js`: bind thử cổng, free→spawn Node foreground, chờ health+catalog; own project→reuse/cảnh báo configuration stale; foreign/unverified owner→BLOCKED, không kill/đổi port. Chỉ dừng child do mình tạo, Ctrl+C; spawn windowsHide. `src/app.js` nhận service metadata tùy chọn; health thêm name/project hash/configuration hash, không root path. Test child server thật dùng project/store tạm, không tranh store của server thật.
- `src/model/probe.js` tách shared checkProfile; probe cap 64/5s/1 HTTP không retry giữ nguyên. `src/operations/localModel.js`: loopback-only profile ID, GET tags/ps kiểm tra installed/loaded, lệnh pull chỉ hướng dẫn; explicit warm cap64/60s/1 HTTP không retry, input connectivity cố định, metrics riêng, usage thiếu null+dự phòng. Các CLI checks không gửi notes/dataset. Protocol failure=FAIL, mạng/timeout/rate limit=BLOCKED; mock simulation không HTTP và không live evidence.
- `src/operations/suite.js` chạy runner/registry/retriever/store thật với model scripted hoặc profile thật; store tạm riêng. Repeat1..5, cap phiên1..200 áp dụng trước mọi HTTP/retry; cloud phải chủ động chọn và đặt max-requests. Blocked giữ planned cases NOT_RUN, mọi FAIL/REVIEW_REQUIRED được giữ. Report lưu quyết định/tool/evidence/query/versions/source IDs và metrics, không messages/request body. Source IDs phải xuất hiện đầy đủ trong messages tới model; không tự sửa citation.
- `src/operations/cases.js`: 6 smoke cases và 8 acceptance rehearsal (4 mỗi miền); exact query/evidence/decimal values, whole numeric tokens, assignments/relations và declared final forms. Ngữ nghĩa ngoài dạng được chấm phải đọc tay. Rejected draft smoke vẫn yêu cầu note citation như acceptance hiện tại; backend không ghi/replay đúng nhưng final bỏ nguồn sẽ bị smoke FAIL, không được gộp vào PASS.
- `src/operations/reports.js`: append-only IDs dưới var/exam, statuses PASS/FAIL/BLOCKED/REVIEW_REQUIRED/NOT_RUN; sanitizer key/prompt/root/endpoint/request body. Context giữ commit/dirty, task/data/profile/protocol/suite fingerprints, caps/reasoning/budgets. `reportFreshness` conservative theo toàn catalog/config/protocol/suite; thêm profile/task không liên quan cũng có thể làm evidence cũ stale. Commit docs-only được ghi commit_changed riêng. Không suy ra external model weights/service còn nguyên từ hash config.
- `src/operations/readiness.js`: đọc tối đa50 reports, tách server/configured/probed/warmed, offline/live/student timing, excludes stale; accounting chỉ fresh checks cùng profile (không phải tổng toàn lịch sử). Report IDs vẫn giữ failure cũ/stale. Overall port unverified=BLOCKED, live failure=FAIL khi server đã xác minh; khi chưa review diễn tập người thì REVIEW_REQUIRED, không có global READY.
- `src/operations/timing.js`/exam:timer: append-only start/end read,map,config,start,acceptance,demo, notes≤500; student/agent actor phân biệt; timestamp/config hash từng mốc, clock lùi từ chối; mỗi session một operator. Chưa đủ bước NOT_RUN; đủ bước self-recorded REVIEW_REQUIRED, không tự chứng minh sinh viên hoàn thành trong số phút đó.
- Minimal prompt changes `config/prompts.js` + một call site `runner.js`: yêu cầu read trước factual final/copy nguyên source ID; grounding repair liệt kê **nguồn của chính run**, tối đa1000 ký tự, hoặc yêu cầu read khi chưa có nguồn. Không thay final/decision/grounding/schema, không tăng maxRepairs/maxSteps/timeouts. Có regression tests cho chưa retrieval, nguồn hợp lệ và bound.
- `src/model/openaiCompatible.js`: fetch redirect manual; 3xx bị từ chối, không follow/retry. Repro trước sửa: một request accounting nhưng hai HTTP thực tế. Regression warm/runner giữ một request, target không bị gọi, tool không chạy; không biến redirect thành request miễn phí. Báo cáo trước sửa adapter stale, đã chạy lại kiểm chứng cuối.
- Hai task mới `config/rehearsal-tickets.task.json`, `config/rehearsal-rooms.task.json`, đăng ký catalog; datasets tickets.json (6, JSON) và rooms.csv (5, CSV). Scale0, query_dataset read-only, task/default/dữ liệu cũ giữ nguyên. Mission làm rõ count compare không field/limit và query rỗng vẫn có nguồn; không hard-code đáp án trong đường live. UI mock không giải đề mới; dùng scripted acceptance/live. Profile bổ sung ollama-qwen3-4b chỉ so sánh model đã tải sẵn; không thay default hoặc failover.

**Kiểm chứng thực tế:**

- **253/253 tests**, **16/16 notes eval**, **3/3 dataset scripted**, **2/2 budget fake HTTP**. Regression source200rows, numeric smoke, model_changed/retry gate/approval snapshots giữ nguyên. 31 tests bổ sung M6 ở exam-launcher/model/prompt/readiness/report/suite/timing; catalog test mở rộng task IDs, không bỏ task cũ.
- Chrome thật desktop1280/mobile390: qa:metrics/qa:configuration PASS, thêm metadata hai task; keyboard/focus/loading/errors/reload/approval/replay/budgetstop. Configuration có 7 fake probe+8 fake run HTTP, metrics6 fake HTTP; không cloud. Không thêm UI warm/readiness, chỉ CLI.
- Scripted smoke **6/6**, rehearsal **8/8** (191/225ms script, 0 HTTP LLM). Thời gian này **không** là thời gian student hoặc agent triển khai.
- Launcher gọi bằng đường dẫn tuyệt đối từ System32 đúng root. Thực tế port8787 có owner/server cũ thiếu service identity: **BLOCKED**; chỉ GET kiểm tra, không kill. Người dùng cần Ctrl+C đúng terminal gốc rồi exam:start. Free/own/foreign port và startup/shutdown child thật đã được tests xác minh với fixture/store tạm.
- Model8B warm cuối **1HTTP/48tokens/9152ms**, probe sau warm **1HTTP/48tokens/488ms**, 0 retry; usage provider reported. Profile ollama-qwen3 identity `7867f9fea9937415429deaebcbc1043a2aac9d7441edf08991d9c948457833bf`, name qwen3:8b, temperature0, output800, reasoning_effort none; limits12/100000/6steps/2repair. Timeout model thực tế120000ms lấy từ `.env` sẵn có, khác mặc định30000ms; không sửa `.env` hoặc tăng timeout. Context report lưu limits/model_timeout_ms và options/timeout của từng profile để tái hiện.
- Baseline sum tiếng Anh và tiếng Việt đều3/3 (6HTTP mỗi bộ), không sửa câu trả lời nghiệp vụ. Baseline notes3/3 FAIL bỏ read và bịa ID; hướng dẫn chung vẫn3FAIL, citation repair giúp3PASS với9HTTP. Phiên trung gian `smoke-16009a9d-bccc-4383-a595-cc6cab8476a7`18/18,45HTTP,59329tokens,3repair,148868ms; **không** dùng để che kết quả mới nhất.
- **Smoke cuối8B** `smoke-86bf8286-619f-4684-8cb6-17466c736102`: **15PASS/3FAIL**,45/60HTTP,59366tokens,3repair/0retry,149842ms. Notes/sum/compare/missing/approve mỗi ca3 liên tiếp. Reject0/3 vì final source_ids trống; approval/replay/no-write vẫn đúng. Không gọi toàn model ổn định.
- **Rehearsal cuối8B** `rehearsal-d060d8f3-2279-4cbe-a6fa-05dd088f8d32`: **9PASS/9FAIL**,36/48HTTP,51486tokens,0repair/retry,123854ms. tickets-count/rooms-lookup/rooms-sum mỗi ca3PASS. tickets-compare thêm field:id/limit khiến rejected rồi repeated_action; tickets-empty/rooms-empty query đúng, model bỏ source query. Before/after mission vẫn9/18; không chỉnh tiếp vô hạn. Hai phiên cuối có source IDs đầy đủ trong messages cho mọi trial có evidence; trial chưa có nguồn giữ null.
- **So sánh4B, lịch sử stale sau sửa adapter** `rehearsal-de000b87-17e5-4a2b-bbad-ffb0e4c1d853`: **6PASS/3FAIL/3REVIEW_REQUIRED/6NOT_RUN**,48/48HTTP,82044tokens,21repair/0retry,75506ms. tickets-count/rooms-lookup3PASS; rooms-sum/empty NOT_RUN vì budget; chưa đạt làm model dự phòng.
- Verification `verification-50364efb-95ce-4fea-a241-a6882bf0318d`; final warm/probe IDs có trong EXAM_REHEARSAL. Readiness ở var/exam nhận diện stale, không lưu secret/prompt/path. Fresh scope8B tại chốt:83HTTP,110948provider tokens,3repair/0retry,0 missing usage; đây chỉ warm/probe + smoke/rehearsal cuối, không phải toàn thử nghiệm.
- **NOT_RUN:** thời gian sinh viên đổi đề thực tế; thời gian agent triển khai không bắt đầu stopwatch riêng; full eval:live/cloud; một buổi demo UI trực tiếp bởi sinh viên. `save_draft` vẫn không nhận dataset source. Token budget vẫn estimated/reserved, không bảo đảm token bị tính phí tuyệt đối khi usage thiếu.

**Trước thi:** tự restart server8787, inspect/warm/probe đúng profile, chạy lại3 trial của goal sẽ trình bày/read source, tự làm cả hai đề và ghi6 bước/error/edit bằng exam:timer. Chỉ demo live các ca đã3PASS; phần lỗi cần model/goal được kiểm chứng thêm, hoặc scripted demo có nhãn. Đề cần ghi từ bảng/join/công thức ngoài tool hiện tại cần tool mới, không chỉ chỉnh config. Không tăng repair hay bỏ grounding để lấy PASS.

### Đoạn khởi động ngắn cho box khác

> Hãy làm việc trong `D:\New-Tech\ai-agent-starter`. Đọc `AGENT_STARTER_KNOWLEDGE_HANDOFF.md` trước, sau đó đối chiếu `README.md`, `EXAM_ADAPTATION.md` và code/test liên quan. Giữ nguyên backend agent loop, allow-list, phê duyệt mọi tool ghi, `args_hash`, idempotency, grounding và giới hạn. Chỉ sửa phạm vi của yêu cầu mới, không đụng `.env`, `var/` hoặc project khác. Trước khi thay đổi, trình bày mapping yêu cầu → dữ liệu/tool/test; sau đó kiểm tra `npm test`, eval thích hợp và browser/live nếu liên quan. Commit local sau mỗi đợt đã kiểm chứng để lưu tiến trình; không push nếu chưa được yêu cầu riêng.
