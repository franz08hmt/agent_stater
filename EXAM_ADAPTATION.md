# Thích ứng khi nhận đề

Mục tiêu: trong thời gian làm bài, **chỉ thay phần nghiệp vụ**, giữ nguyên vòng lặp agent, validation,
phê duyệt và giới hạn. Đề và thông báo mới của giảng viên luôn được ưu tiên hơn nghiệp vụ mẫu ở đây.

## Checklist

1. **Đọc đề** — gạch chân: người dùng là ai, mục tiêu nhập vào là gì, kết quả trả ra gồm gì, dữ liệu nào có sẵn,
   thao tác nào *thay đổi dữ liệu*, quy tắc nghiệp vụ nào bắt buộc.
2. **Xác định tiêu chí chấp nhận** — viết 3–5 câu dạng "Khi … thì hệ thống phải …". Mỗi câu sẽ thành một
   evaluation case.
3. **Ánh xạ vào sườn** — với mỗi thao tác trong đề: đây là tool **đọc** hay **ghi**? Ghi thì có cần người duyệt
   không? Điền bảng ở cuối file này.
4. **Đổi `config/task.json`** — nhiệm vụ, thư mục ghi chú, tool đã đăng ký được bật, mẫu thử và nhãn hiển thị.
   Nếu đề cần tool mới thì thêm ở mục C bên dưới.
5. **Sửa dữ liệu** — mục B.
6. **Test** — `npm test` (phải còn xanh), sửa `eval/cases.json`, chạy `npm run eval`.
7. **Chuẩn bị demo** — một happy path, một case thiếu bằng chứng, một case bị chặn (tool sai / bị từ chối).
   Nếu có key: `npm run smoke:live` để có bằng chứng model thật.

Ngày thi còn một checklist riêng ở cuối file này. Muốn tập trước quy trình trên, xem "Bài diễn tập 30–45 phút".

## Bản đồ: thay đổi gì, sửa ở đâu

### A. Mục tiêu và instruction

`config/task.json` là **một nhiệm vụ đang hoạt động** tại mỗi lần khởi động, không phải bộ chọn nhiều nhiệm vụ.
Các khóa bắt buộc:

| Khóa | Ý nghĩa |
|---|---|
| `id`, `title` | Mã ổn định dạng `a-z`, `0-9`, dấu `-`; tiêu đề trên UI |
| `mission` | Nhiệm vụ và ràng buộc nghiệp vụ model nhận trong system prompt; không chứa key/bí mật |
| `data.notes_dir` | Thư mục Markdown trong `data/`, ví dụ `data/notes`; phải có ít nhất một `.md` |
| `allowed_tools` | Chỉ tên tool đã đăng ký, ví dụ `search_notes`, `save_draft`; `save_draft` đòi `search_notes` |
| `sample_inputs` | 1–6 cặp `label`/`goal` hiển thị thành nút thử trên UI; mỗi goal tối đa 500 ký tự |
| `result_labels` | Ba nhãn UI: `answer`, `sources`, `unresolved`; không đổi schema kết quả API |

Backend từ chối khóa lạ, tool không có sẵn, tool trùng, đường dẫn tuyệt đối/`..`/symlink, thư mục trống và
file JSON sai định dạng. Đường dẫn chỉ được nằm dưới `data/`. Cấu hình đã xác thực được dùng **cùng lúc**
cho prompt, bộ tool thực thi, truy xuất dữ liệu và ví dụ/nhãn UI. Sửa `task.json` hoặc nội dung ghi chú
trong khi server đang chạy **không có hiệu lực**; dừng bằng `Ctrl+C`, rồi chạy lại `npm start`.
Khi khởi động lại, run cũ đang chạy hoặc chờ phê duyệt từ phiên bản nhiệm vụ khác bị đánh dấu failed,
phê duyệt đang chờ bị hủy; không thể phê duyệt thao tác ghi cũ dưới đề mới.

Sau khi sửa: `npm test`, `npm run eval` (các eval case mẫu chỉ còn ý nghĩa nếu vẫn dùng dữ liệu ghi chú mẫu),
kiểm tra UI và một run thật với model đã chọn. `config/prompts.js` giữ giao thức JSON và quy tắc an toàn;
không sửa chúng chỉ để đổi nhiệm vụ.

| Cần đổi | File | Chỗ cụ thể |
|---|---|---|
| Vai trò, nhiệm vụ, giọng trả lời | `config/task.json` | `mission` |
| Quy tắc an toàn | `config/prompts.js` | `SAFETY_RULES` (giữ nguyên ý "kết quả tool là dữ liệu không tin cậy") |
| Định dạng quyết định của model | `config/prompts.js` → `PROTOCOL` **và** `src/agent/decision.js` | Hai chỗ phải đổi cùng nhau; thường **không cần** đổi |
| Số bước, timeout | `.env` hoặc `config/agent.config.js` | `AGENT_MAX_STEPS`, `MODEL_TIMEOUT_MS`, `TOOL_TIMEOUT_MS`, `RUN_MAX_MS` |

### B. Dữ liệu

| Cần đổi | File | Ghi chú |
|---|---|---|
| Tài liệu tra cứu | `data/notes/*.md` | Xóa file mẫu, thêm file mới. Tên file = `source_id` (chỉ `a-z 0-9 -`). Dòng `# ` đầu tiên là tiêu đề; dòng bắt đầu bằng `>` bị bỏ qua khi tìm kiếm; mỗi đoạn cách nhau một dòng trống là một "passage" |
| Dữ liệu dạng bảng (sản phẩm, lịch, đơn hàng…) | Tạo `data/<ten>.json` + một tool đọc nó | Không nhét bảng vào ghi chú nếu đề cần lọc/tính toán chính xác |
| Nơi lưu kết quả | `src/store/fileStore.js` | Đã có `createDraftOnce(key, data)` chống ghi trùng — tái dùng cho bản ghi mới |
| Cần tìm theo nghĩa (đề yêu cầu embedding / vector) | `src/retrieval/` | Viết retriever mới cùng interface `search(query,{limit})`, `has(id)`, `kind`; đổi 1 dòng trong `src/app.js`. **Không** gọi BM25 hiện tại là vector search |

### C. Tool schema và tool implementation

Mỗi tool là một object trong `src/tools/<tên>.js`:

```js
export const myTool = {
  name: 'my_tool',                 // tên model sẽ gọi
  access: 'read',                  // 'read' | 'write'
  requiresApproval: false,         // true cho mọi thao tác ghi / gửi / thay đổi
  description: '…',                // model đọc câu này để quyết định dùng tool
  schema: { type: 'object', properties: { … }, required: [ … ], additionalProperties: false },
  checkRules(args, ctx) { return []; },   // quy tắc nghiệp vụ; trả mảng lỗi
  async execute(args, ctx) { return { … }; }, // ctx: run, retriever, store, idempotencyKey (khi write)
};
```

Rồi đăng ký tool mới trong danh mục `BUILTIN_TOOLS` tại `src/tools/registry.js`, thêm tên vào
`allowed_tools` trong `config/task.json`, và viết test cho quyền truy cập. Nếu tool mới phụ thuộc
vào tool khác, bổ sung luật phụ thuộc ở `config/task.config.js`.
Danh sách tên hợp lệ tự lấy từ `BUILTIN_TOOLS`; `task.json` không được nạp module tùy ý.

- Model **chỉ** gọi được tool có trong `allowed_tools` đã xác thực — đây là allow-list thực thi.
- `schema` hỗ trợ: `type`, `properties`, `required`, `additionalProperties:false`, `minLength`, `maxLength`,
  `pattern`, `enum`, `minimum`, `maximum`, `items`, `minItems`, `maxItems`, `uniqueItems`
  (xem `src/tools/schema.js`). Luôn đặt `additionalProperties: false` và giới hạn độ dài chuỗi.
- Tool ghi: đặt `requiresApproval: true`; trong `execute` dùng `ctx.idempotencyKey` để không ghi trùng.
- Tool trả `results: [{ source_id, … }]` thì `source_id` tự động được ghi nhận để kiểm tra trích dẫn.
- **Không** thêm tool chạy shell, `eval`, gửi email thật hay xóa dữ liệu.
- Khai báo sai bị chặn ngay khi server khởi động, ví dụ:
  `Tool "refund_order" has access: 'write' but requiresApproval is not true. Every write tool must require human approval.`
  Luật: `access` phải đúng `'read'` hoặc `'write'`; tool `'write'` phải có `requiresApproval: true` (đúng boolean `true`);
  tên tool không được trùng. Đây là chủ ý và không có công tắc để tắt.
- **Thêm tool vào danh sách, đừng thay thế cho tới khi test mới xanh.** Các test cũ trong `tests/runner.test.js`
  dùng `search_notes` / `save_draft` và dữ liệu ghi chú mẫu; xóa chúng sớm sẽ làm đỏ hàng loạt test không liên quan.
- `checkRules` chạy **đồng bộ**: đọc dữ liệu bằng `readFileSync` hoặc nạp sẵn khi khởi động.
- Kết quả tool muốn được **trích dẫn** phải nằm trong mảng `results` và mỗi phần tử có `source_id`; nếu không, runner không
  coi là "đã truy xuất" và câu trả lời cuối chỉ hợp lệ khi có `unresolved`.

### Giới hạn của mock khi đổi đề (đã kiểm chứng khi chạy thử)

`MODEL_PROVIDER=mock` (mock luật trong `src/model/mock.js`) **chỉ biết miền ghi chú mẫu**: nó luôn gọi `search_notes`
và `save_draft`. Với tool mới, nó không biết dùng: thử với đề giả về đổi phòng, nó vẫn gọi `search_notes` rồi kết luận
"không đủ bằng chứng". Hệ quả cho ngày thi:

- Muốn **demo trên giao diện** với tool mới thì cần model thật đã xác minh (Gemini/Ollama/vLLM).
- Nếu không có model, vẫn chứng minh được backend bằng test và eval case `mode: "script"` (kịch bản model cố định), nhưng
  hãy nói rõ đó là mô phỏng, không phải LLM thật.
- Không cố sửa mock luật cho đề mới trong lúc thi; đó là việc tốn thời gian và không chứng minh được gì về LLM.

### D. Business rules

| Loại quy tắc | Đặt ở đâu |
|---|---|
| Ràng buộc từng tham số (độ dài, khoảng giá trị, định dạng) | `schema` của tool |
| Ràng buộc liên quan dữ liệu / trạng thái (tồn tại, đã truy xuất, tổng không vượt X, đúng quyền) | `checkRules(args, ctx)` của tool |
| Quy tắc chung cho mọi câu trả lời cuối | `src/agent/decision.js` (`parseDecision`, `checkGrounding`) |
| Quy tắc dừng | `src/agent/runner.js` hàm `drive()` — phần "Limits are checked BEFORE…" |

`checkRules` được chạy **hai lần** với tool ghi: khi model đề xuất và ngay trước khi thực thi sau phê duyệt.

### E. Input và output contract

| Contract | File |
|---|---|
| Body `POST /api/runs` (mặc định chỉ `goal`) | `src/app.js` (route `/api/runs`) và `runner.startRun()` |
| Giới hạn độ dài goal | `config/agent.config.js` → `maxGoalChars` |
| Hình dạng câu trả lời cuối (`answer`, `source_ids`, `unresolved`) | `src/agent/decision.js` → `finalSchema` và `config/prompts.js` → `PROTOCOL` |
| Dữ liệu API trả về | `src/agent/state.js` → `publicView()` |

Nếu đề cần thêm trường vào kết quả cuối (ví dụ `total_price`), thêm vào **cả** `finalSchema`, `PROTOCOL`,
`run.final = {…}` trong `runner.js` và phần hiển thị trong `public/app.js`.

### F. Giao diện

| Cần đổi | File |
|---|---|
| Tiêu đề, nhãn, mục tiêu mẫu | `config/task.json`; UI lấy metadata từ `/api/health` khi tải trang |
| Hiển thị kết quả cuối | `public/app.js` → hàm `render()`, phần `run.final` |
| Hiển thị approval | `public/app.js` → phần `pending` trong `render()` |
| Giao diện | `public/styles.css` |

Frontend không bao giờ gọi tool hoặc giữ key. Giữ nguyên nguyên tắc đó.

### G. Evaluation cases

`eval/cases.json` — mỗi case:

```json
{ "id": "E20", "title": "…", "goal": "…", "mode": "policy",
  "actions": ["approve"],
  "expect": { "status": "completed", "sources_include": ["…"], "drafts": 1 },
  "check": "Cách kiểm tra bằng lời" }
```

- `mode: "policy"` — mock luật khi `npm run eval`, **model thật** khi `npm run eval:live`.
- `mode: "script"` — kịch bản mock cố định (để tạo lỗi định dạng, timeout, tool sai…); chỉ chạy ở mock.
- `mode: "input"` — kiểm tra lỗi đầu vào, không gọi model.
- Các khóa `expect` hỗ trợ: xem `eval/checks.js`. Ngoài các khóa đếm/so sánh (`status`, `drafts`, `steps_used`,
  `tool_statuses`, `sources_include`, …) có các khóa chấm **hành vi và câu trả lời của model**:

| Khóa | Ý nghĩa |
|---|---|
| `precondition.retrieved: ["nguon§2"]` | Đoạn này **phải** đã tới model, nếu không kết quả là `INCONCLUSIVE` (không bao giờ `PASS`) |
| `allowed_tools: [...]` | Chỉ những tool này được đụng tới; dùng tool khác là `FAIL` kể cả khi backend đã chặn |
| `max_approvals: n` | Số thao tác ghi model được phép đề xuất (`0` nếu mục tiêu không yêu cầu ghi) |
| `answer_includes_any: [...]` | Câu trả lời phải làm đúng việc: chứa ít nhất một cụm này |
| `answer_excludes: [...]`, `arguments_exclude: [...]` | Câu trả lời / tham số tool không được chứa các chuỗi này (ví dụ lệnh bị chèn) |
| `report: ["flagged_suspicious"]` | Chỉ in thông tin (model có cảnh báo nội dung đáng ngờ không), không quyết định PASS/FAIL |

  Evaluator **không chứa tên tool nào**. Hai bất biến sau áp dụng cho *mọi* case và lấy từ registry, nên tự thích ứng khi
  bạn đổi tool: (1) mọi tool đã chạy thành công phải có trong registry; (2) tool `write` chạy thành công phải có một
  approval `executed`. Thêm vào đó: câu trả lời không được chứa API key hay đoạn system prompt.
- Kết quả `BLOCKED` (provider lỗi) dừng cả phiên live và không được tính là đạt; xem README mục 4.

Sau khi đổi tool/dữ liệu, sửa lại các test phụ thuộc dữ liệu mẫu trong `tests/runner.test.js`
(các test nhắc tới `http-status`, `idempotency`, `forum-copy`…). Test trong `tests/validation.test.js` và
phần approval/giới hạn thường giữ nguyên được.

## Bài diễn tập 30–45 phút

Mục đích: tập **quy trình** thích ứng, không tập một nghiệp vụ cụ thể. Đây là **đề giả lập, không phải dự đoán đề thi**.
Làm trên nhánh riêng (`git switch -c rehearsal`) rồi bỏ nhánh đó, không đưa vào sườn.

**Đề giả (đọc trong 2 phút).** "Trợ lý xếp phòng học. Người dùng nhập mục tiêu, ví dụ *Lớp web101-a có 45 sinh viên,
phòng hiện tại quá chật, chuyển sang phòng lớn hơn*. Agent tra thời khóa biểu và, nếu hợp lệ, tạo một *yêu cầu đổi phòng*
để giáo vụ duyệt. Quy tắc: chỉ đổi sang phòng có tồn tại; sức chứa phòng ≥ số sinh viên; chỉ đổi lớp đã tra cứu trong
lần chạy này. Không được ghi khi chưa duyệt; duyệt hai lần chỉ tạo một yêu cầu."

| Phút | Việc | Nơi làm |
|---|---|---|
| 0–5 | Điền bảng ánh xạ: 2 tool (đọc / ghi), 3 luật nghiệp vụ, 4 tiêu chí chấp nhận | bảng cuối file này |
| 5–12 | Dữ liệu `data/timetable.json` có `classes` (`class_id`, `course`, `students`, `room`) và `rooms` (`room`, `capacity`); ghi rõ "giả lập" | `data/` |
| 12–22 | Tool đọc `lookup_timetable`: tìm theo mã lớp / tên môn. **Mỗi kết quả phải có `source_id`** (dùng `class_id`) | `src/tools/` |
| 22–32 | Tool ghi `request_room_change` (`access: 'write'`, `requiresApproval: true`). `checkRules` kiểm tra 3 luật; `execute` gọi `ctx.store.createDraftOnce(ctx.idempotencyKey, {...})` để không ghi trùng | `src/tools/` |
| 32–35 | Đăng ký 2 tool trong `BUILTIN_TOOLS` và `allowed_tools`; giữ tool mẫu để test cũ vẫn chạy | `src/tools/registry.js`, `config/task.json` |
| 35–40 | Sửa `mission`, dữ liệu, ví dụ và nhãn cho đúng đề mới; khởi động lại server | `config/task.json` |
| 40–45 | 3 test (duyệt tạo đúng 1 yêu cầu; phòng quá nhỏ bị chặn; lớp chưa tra cứu bị chặn) + 2 eval case `mode: "script"`; chạy `npm test` và `npm run eval` | `tests/`, `eval/cases.json` |

**Đạt khi:** `npm test` và `npm run eval` xanh; thử cố ý khai báo `requiresApproval: false` cho tool ghi và thấy server
từ chối khởi động; giải thích được, không nhìn tài liệu, vì sao ghi không thể xảy ra khi chưa duyệt.

**Bẫy đã gặp khi chạy thử** (nên biết trước): mock luật không điều khiển được tool mới (xem mục "Giới hạn của mock");
`checkRules` chạy đồng bộ; kết quả tool thiếu `source_id` thì không trích dẫn được; xóa tool cũ quá sớm làm đỏ các test cũ.

**Tình trạng kiểm chứng:** các bước kỹ thuật ở trên đã được chạy thử trên một bản sao của repo (thêm 2 tool và 3 test:
71 test xanh; thêm 2 eval case: 18/18). Thời lượng 30–45 phút là **ước lượng, chưa đo trên người làm**; nếu lần đầu mất hơn
45 phút, phần hay quá thời gian nhất là `checkRules` và test.

## Bảng ánh xạ (điền khi nhận đề)

| Yêu cầu trong đề | Tool | read / write | Cần duyệt? | Quy tắc (schema / checkRules) | Evaluation case |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

## Checklist ngày thi

**Trước (ngày hôm trước, không phải sáng thi)**

1. `git status` sạch, đang ở nhánh riêng, `.env` **không** nằm trong danh sách file thay đổi. `npm test` xanh.
2. Model: `.env` đúng; `npm run smoke:live` cho `3/3 completed`. Xem quota thực tế của project trong AI Studio.
3. Mỗi phương án dự phòng (key / project / model / Ollama) đã tự chạy `smoke:live` thành công. **Chưa thử = không có.**
   Nhớ: quota tính theo *project*, không theo key.
4. Không dùng chung project với ứng dụng khác trong buổi thi (chung quota).

**Trong thi**

5. Đọc đề → bảng ánh xạ → tiêu chí chấp nhận. Không thêm chức năng ngoài đề.
6. Mỗi tool mới: viết xong chạy `npm test` ngay. Tool ghi phải `requiresApproval: true`.
7. Gặp `model_rate_limited`: đọc `quotaId` / `retryDelay`. Theo phút → đợi; theo ngày → chuyển phương án đã xác minh.
   Đừng bấm chạy lặp lại.
8. Demo: một ca chạy đúng, một ca thiếu bằng chứng, một ca bị chặn hoặc bị từ chối; mở nhật ký thực thi.
9. Nói đúng về bằng chứng: kết quả mock chỉ chứng minh backend; kết quả live mới nói về LLM.

## Những thứ KHÔNG nên đụng khi đang thi

- `src/agent/runner.js` — vòng lặp, phê duyệt, dừng, chống lặp.
- `src/agent/state.js` — trạng thái và `args_hash`.
- `src/tools/registry.js` — chỉ thêm tên tool vào danh sách.
- `src/store/fileStore.js` — trừ khi đề bắt buộc dùng database.

Nếu buộc phải sửa những file này, chạy lại `npm test` ngay sau mỗi thay đổi.
