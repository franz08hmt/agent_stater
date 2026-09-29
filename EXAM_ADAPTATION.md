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
4. **Thêm hoặc thay tool** — mục C bên dưới.
5. **Sửa dữ liệu** — mục B.
6. **Test** — `npm test` (phải còn xanh), sửa `eval/cases.json`, chạy `npm run eval`.
7. **Chuẩn bị demo** — một happy path, một case thiếu bằng chứng, một case bị chặn (tool sai / bị từ chối).
   Nếu có key: `npm run smoke:live` để có bằng chứng model thật.

## Bản đồ: thay đổi gì, sửa ở đâu

### A. Mục tiêu và instruction

| Cần đổi | File | Chỗ cụ thể |
|---|---|---|
| Vai trò, nhiệm vụ, giọng trả lời | `config/prompts.js` | `TASK_INSTRUCTIONS` |
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

Rồi đăng ký trong `src/tools/registry.js`:

```js
export function createToolRegistry(tools = [searchNotes, saveDraft, myTool]) {
```

- Model **chỉ** gọi được tool có trong danh sách này — đây là allow-list.
- `schema` hỗ trợ: `type`, `properties`, `required`, `additionalProperties:false`, `minLength`, `maxLength`,
  `pattern`, `enum`, `minimum`, `maximum`, `items`, `minItems`, `maxItems`, `uniqueItems`
  (xem `src/tools/schema.js`). Luôn đặt `additionalProperties: false` và giới hạn độ dài chuỗi.
- Tool ghi: đặt `requiresApproval: true`; trong `execute` dùng `ctx.idempotencyKey` để không ghi trùng.
- Tool trả `results: [{ source_id, … }]` thì `source_id` tự động được ghi nhận để kiểm tra trích dẫn.
- **Không** thêm tool chạy shell, `eval`, gửi email thật hay xóa dữ liệu.

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
| Tiêu đề, nhãn, mục tiêu mẫu | `public/index.html` (các nút `data-goal` trong `.samples`) |
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
- Các khóa `expect` hỗ trợ: xem hàm `check()` trong `eval/run-eval.js`.

Sau khi đổi tool/dữ liệu, sửa lại các test phụ thuộc dữ liệu mẫu trong `tests/runner.test.js`
(các test nhắc tới `http-status`, `idempotency`, `forum-copy`…). Test trong `tests/validation.test.js` và
phần approval/giới hạn thường giữ nguyên được.

## Bảng ánh xạ (điền khi nhận đề)

| Yêu cầu trong đề | Tool | read / write | Cần duyệt? | Quy tắc (schema / checkRules) | Evaluation case |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

## Những thứ KHÔNG nên đụng khi đang thi

- `src/agent/runner.js` — vòng lặp, phê duyệt, dừng, chống lặp.
- `src/agent/state.js` — trạng thái và `args_hash`.
- `src/tools/registry.js` — chỉ thêm tên tool vào danh sách.
- `src/store/fileStore.js` — trừ khi đề bắt buộc dùng database.

Nếu buộc phải sửa những file này, chạy lại `npm test` ngay sau mỗi thay đổi.
