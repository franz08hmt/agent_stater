# Thích ứng khi nhận đề

## Chốt candidate và diễn tập riêng (đợt 5)

- Quy trình vận hành một trang: [EXAM_DAY_CHECKLIST](docs/EXAM_DAY_CHECKLIST.md). Quy trình phục hồi nguồn offline: [EXAM_RECOVERY](docs/EXAM_RECOVERY.md). Evidence mới và các failure: [EXAM_CANDIDATE](docs/EXAM_CANDIDATE.md).
- Mẫu mới `templates/rehearsal-rentals.spec.json`: JSON khóa `rental_id`, phép sum hours, lookup theo khóa, zero matches và cổng write bị chặn. Expected 11/đúng R102/0/tool_not_allowed xác định từ đề; không lấy tool output làm expected. Chỉ tạo/register trong bản sao, không chiếm slot catalog thật. [Bài tự diễn tập](docs/STUDENT_REHEARSAL.md) hướng dẫn đổi số liệu/goal/expected bằng tay và timer read/map/config/start/acceptance/demo; thời gian sinh viên vẫn chưa đo.
- `npm run qa:rehearsal` là **AGENT REHEARSAL**: scaffold preview/apply/register → acceptance → browser Exam mode → read/proposal approve/reject/replay/reload. Scripted model, 0 model HTTP; không actor=student, không live evidence. Task tạm giữ scope/fingerprint riêng.
- `npm run exam:campaign -- --profile=ollama-qwen3 --repeat=3 --cap=160`: chọn profile local đã xác thực; warm/probe tách accounting, rồi notes/dataset/draft, count/empty, ticket/room proposal, scaffold và E16. Repeat 1..3, cap 1..160; retry/repair cũng tiêu cap tại adapter. Không tải model, cloud hoặc tăng giới hạn run. Cap hết → NOT_RUN. Chuỗi PASS xét từng case/identity trong cùng campaign; failure và phần cần đọc tay được giữ.
- Fingerprint grader bao gồm eval/checks.js, eval/cases.json, driver campaign và spec rehearsal dùng trong live; mọi src/config JS vẫn thuộc runtime fingerprint. Sửa docs không stale chỉ vì commit khác. Kiểm tra report cũ bằng `exam:report -- --id=...`, không dùng PASS stale cho đề/model mới.
- Đóng gói sau checkpoint sạch bằng `npm run exam:package`, rồi `npm run exam:restore-check -- --id=<ID vừa in>`. Không đưa `.env`, history hoặc model weights vào ZIP; không overwrite artifact. Restore mock không cần cài dependency/Internet, nhưng LLM thật vẫn cần Ollama/model cài sẵn.
- Ba trial đúng của một goal không chứng minh mọi đề chưa biết. Proposal chỉ lưu nội bộ; không đổi nguồn/booking. Dataset save_draft, join/group-by/công thức/action/policy mới vẫn cần code và tests; đợt chốt không mở rộng nghiệp vụ.

## Demo bằng Exam mode (đợt 4)

Sau acceptance và restart, bấm **Exam mode** trên header, chọn task/profile, nhập Goal hoặc example rồi Run. Desktop trên 960px đặt cấu hình và kết quả cạnh nhau; mobile xếp Configure → Result. Overview/Agent/Dialogue cùng workbench trong Exam, hash vẫn xác định mục điều hướng/focus; Saved drafts mở danh sách draft/proposal riêng. Bấm lại để về Standard (mặc định).

Tools/data và mô tả policy mở ở **Enabled tools & data** trước Run. Approval hiện action, subject/target/record/source/snapshot, changes và reason; mở **Exact arguments & hash** nếu cần JSON/hash đầy đủ. Chỉ approve sau khi đọc; saved proposal luôn Not applied. Requests/status/active time/answer/sources hiện trực tiếp; **Run & token details** chứa usage, estimates, repairs/retries, Run ID/goal; trace ở phần riêng. Không suy saved từ lời model hoặc completed từ một tool thành công.

Preference enum lưu riêng với run_id. Mode/New run/reload không đổi runtime của run, không tự probe/approve/chạy lại model. Active run khóa goal/select/examples; completed cho chọn cấu hình của run tiếp theo, còn header/Result luôn ghi rõ run lịch sử. Kết quả probe chỉ chứng minh thời điểm thử, mất cache khi reload; không fullscreen tự động hoặc nút fullscreen trong đợt này. Xem [hướng dẫn và QA](docs/EXAM_MODE.md), chạy `npm run qa:exam` bằng Chrome local/fake HTTP/store tạm, không cloud.

## Template đổi đề nhanh (đợt 3)

Dùng [checklist một trang](docs/EXAM_SCAFFOLD.md) và [contract chi tiết](docs/SCAFFOLD_CONTRACT.md). Sao chép `templates/notes.spec.json`, `dataset-read.spec.json` hoặc `proposal.spec.json` thành spec mới trong templates; tự điền mission/data/schema/tools/examples/cases và expected độc lập. Không TODO, key/model/endpoint hoặc trường lạ. Dữ liệu là assets mới có file/content hoặc tham chiếu file data hiện có; id_column tùy chọn được giữ, proposal có canonical fields và role mapping của đúng policy đăng ký.

```powershell
npm run exam:scaffold -- --spec=templates/my-read.spec.json --register
npm run exam:scaffold -- --spec=templates/my-read.spec.json --apply --register
npm run exam:acceptance -- --task=exam-inventory
npm test
```

Thay ID theo spec. Mặc định preview; --apply tạo mới config/task, data assets, acceptance manifest, top-level test driver và task guide. --register thêm catalog có backup, giữ defaults/profiles/tasks, không tự mở rộng 8 slots. Không overwrite; task đã tạo cần sửa file/manifest bằng tay có chủ đích rồi kiểm chứng lại. Xem đường dẫn/thứ tự file ở preview. Lỗi apply chỉ rollback file của lượt đó còn nguyên hash/inode, giữ và báo file người dùng sửa; không sửa editor catalog khi đang publish. Lock/backup và giới hạn atomicity/hard-link/crash recovery được mô tả trong contract.

Acceptance chạy runner/registry/store thật trong temp với scripted model và limits offline cố định, không gọi LLM hoặc dùng .env; chấm expected kết quả/query/snapshot/record/citation, approve/reject/replay và data không đổi. Manifest cần happy, empty/missing và blocked; proposal và notes ghi nháp thêm approve/reject. Apply chưa chạy acceptance luôn NOT_RUN, không tự nhận ready. `npm run qa:scaffold` kiểm chứng spec→apply/register trong project tạm→acceptance→task/UI trên Chrome desktop/mobile; không chiếm slot catalog thật.

Restart server bằng Ctrl+C rồi `npm run exam:start`, reload UI và chọn task/profile; chỉ chủ động probe/warm/live. Mock dataset mặc định không giải tùy ý goal task mới. Mẫu JSON đọc dùng item_key, hai CSV proposal dùng class_code/room_code; ticket-status JSON ticket_id được regression kiểm chứng. notes_dir bắt buộc nền, không cấp thêm search_notes. Proposal không áp dụng CSV/JSON; save_draft vẫn notes-only. Join/formula/timetable/booking/action/policy/field mapping mới cần code và test, không chỉ sửa mission.

Mốc lịch sử đợt 3: 370 tests, eval16, datasets3/budgets2/smoke6/rehearsal8/proposal5 và Chrome scaffold đạt; live NOT_RUN, không cloud. Đợt 4 hiện đã bổ sung Exam mode như hướng dẫn trên; chưa kết luận model ổn định/sẵn sàng thi trên đề mới và chưa đo thời gian sinh viên đổi đề.

## Proposal từ dataset (đợt 2)

Hướng dẫn đầy đủ: [docs/DATASET_PROPOSALS.md](docs/DATASET_PROPOSALS.md). Hai task mới `proposal-tickets` và `proposal-rooms` bật query_dataset + create_proposal, không thay defaults/task/data cũ. Dataset lookup phải thực sự trả từng record trong đúng trang; aggregates/source từ run khác không cấp quyền ghi. Model đề xuất action/references/changes/reason, backend kiểm schema/policy/evidence/intent rồi dừng chờ duyệt đúng hash. Chỉ lưu proposal nội bộ, không sửa dataset.

Task thêm `proposal_policies: [{policy_id:"ticket-status",datasets:{subject:"tickets"}}]` hoặc class-room với subject/target IDs. Giữ canonical fields và luật hiện có thì chủ yếu đổi file data, task và catalog. Luật/field mới cần sửa policy backend + schema/bind/check/tests và cases, không nạp code hoặc field mapping tùy ý từ JSON. Bắt đầu goal bằng “Create a proposal” hoặc “Tạo đề xuất”; phủ định/quoted instructions không cho ghi. Restart để nạp cấu hình mới; pending bị hủy nếu task/data/policy/model đổi.

`npm run demo:proposals` chạy 5 ca scripted qua runner; `npm run qa:proposals` dùng browser thật/fake provider. Live chỉ local: `npm run demo:proposals -- --live --profile=ollama-qwen3 --only=ticket-approve,room-blocked --repeat=1 --max-requests=19`; nếu warm riêng 1 request thì tổng cap 20. CLI đóng vai người duyệt theo case, UI vẫn cần người bấm. Backend buộc final proposal status đúng dạng declared sau approval, không suy store outcome từ answer.includes. Chỉ dùng evidence mới và đọc cả repair/failure; 1 trial không chứng minh ổn định.

## Khởi động và diễn tập đổi đề (mục 6)

Quy trình chi tiết, hai đề giả có đáp án và lệnh ghi thời gian: [docs/EXAM_REHEARSAL.md](docs/EXAM_REHEARSAL.md). Không xóa các task/eval cũ khi thêm đề mới.

1. Mở đúng project: `npm run exam:start`; từ terminal khác thư mục dùng `node D:\New-Tech\ai-agent-starter\scripts\exam-start.js`. Launcher xác thực Node >=22.12.0/catalog và health+catalog, foreground/Ctrl+C. Đúng server cùng project thì reuse; configuration stale phải restart terminal gốc. Port owner khác hoặc server cũ thiếu identity: BLOCKED, không tự kill/đổi `.env`.
2. Chọn profile backend, chủ động `npm run exam:model -- --profile=ollama-qwen3 --action=inspect`, rồi `--action=warm`, rồi `--action=probe`. Inspection là metadata GET, không LLM. Warm tối đa 1 HTTP/64 output/60s, không retry; probe vẫn 5s, cả hai accounting riêng. Thiếu model/service thì người dùng tự xử lý; không tự tải. Startup/mở UI không gọi cloud.
3. Đề A `rehearsal-tickets`: JSON, team/status, count/compare; đề B `rehearsal-rooms`: CSV, location/capacity, lookup/sum. Schema và ID ở từng `config/rehearsal-*.task.json`, đăng ký trong catalog; default giữ nguyên. Đổi đề chủ yếu thêm data/task/catalog và acceptance cases, không sửa runner. Cộng theo scale khai báo, filters chính xác/phân biệt hoa thường. So sánh số lượng bỏ field; aggregates bỏ limit; lookup rỗng vẫn trích nguồn query.
4. `npm run exam:rehearsal` chạy 8 acceptance cases scripted qua runner. `npm run exam:smoke` chạy 6 tình huống gồm approval/replay. Model thật: `npm run exam:smoke -- --live --profile=ollama-qwen3 --repeat=3 --max-requests=60`; chọn ca bằng `--only=...`. Repeat 1..5, cap phiên 1..200, kiểm tra trước mọi HTTP/retry; giữ tất cả trial, không ghép cấu hình khác nhau để lấy 3 PASS. Cloud cần chủ động truyền thêm `--cloud` và max request rõ ràng.
5. Tự diễn tập cả hai đề: `npm run exam:timer -- begin --task=rehearsal-tickets --actor=student`, rồi `mark --id=ID --step=read --event=start|end --note=...`; lặp `map,config,start,acceptance,demo`, cuối cùng `show --id=ID`. Ghi file sửa bằng tay/lỗi. Session đủ bước là REVIEW_REQUIRED, không tự gọi PASS; agent/script time không được tính là student time. **Chưa đo thời gian đổi đề thực tế** trong đợt này.
6. Xem `npm run exam:report -- --profile=ollama-qwen3`. Report ở `var/exam/` bị Git bỏ qua, có commit/task/data/profile/runtime fingerprints, metrics và failure. PASS/FAIL/BLOCKED/REVIEW_REQUIRED/NOT_RUN riêng; report cũ stale nếu cấu hình/dữ liệu/runtime/suite đổi. Runtime identity hash tên và nội dung các JavaScript modules dưới `src/` và `config/`, cùng yêu cầu Node engine, nên gồm cả metrics/grounding/schema/loader/run manager. Commit chỉ sửa tài liệu không stale; `commit_changed` vẫn được ghi. Reports giữ failure nhưng không key/system prompt/HTTP body/root path. Mốc script có elapsed_ms, không suy ra số phút làm bài.

Trước buổi thi: chạy tests/eval/dataset/budget/browser QA, warm/probe local rồi 3 trial liên tiếp của đúng goal demo với cùng fingerprint; đọc tay answer/source/trace. Bộ chấm xác minh query/evidence/số/dạng đáp án, không bảo đảm mọi ngữ nghĩa. Backend vẫn chặn citation bịa; repair citation chỉ nhắc nguồn hợp lệ của chính run hoặc yêu cầu đọc khi chưa có bằng chứng, không tự thay nguồn. Không tăng maxRepairs/maxSteps/timeout để giấu lỗi. Reports lưu timeout thực tế: đợt M6 dùng `.env` sẵn có 120000ms, khác mặc định 30000ms; không sửa `.env`. HTTP redirect bị từ chối, không âm thầm gửi thêm request ngoài accounting.

Mock UI chỉ có các ví dụ cũ; các đề rehearsal/proposal dùng scripted suite hoặc live đã kiểm chứng. `save_draft` vẫn notes-only; hai policy proposal đã có hỗ trợ status ticket và capacity chuyển phòng ở mức đề xuất. Áp dụng thay đổi thật, join, booking hoặc công thức ngoài count/sum/compare cần thiết kế/test bổ sung. Xem kết quả mới nhất ở cuối handoff; các mốc M6 là lịch sử.

Smoke approval chấm xác nhận `Saved.`/`Not saved.` theo approval state, observation tool, draft count và replay, không bắt nguồn ghi chú cho câu chỉ báo trạng thái. Tuyên bố ngược outcome bị FAIL; final trình bày kiến thức HTTP vẫn cần nguồn ghi chú. Nội dung ngoài dạng xác nhận được giữ REVIEW_REQUIRED để đọc tay. Grounding của runner không đổi: source ID bịa vẫn bị chặn, final source_ids rỗng vẫn phải giải thích unresolved. Lookup rỗng từ bảng có nguồn query, khác với xác nhận trạng thái approval.

## Ngân sách trước ngày thi (mục 4)

Đặt giới hạn trong `.env` hiện có hoặc biến môi trường phiên chạy; **không chép đè `.env`**. Mặc định `AGENT_MAX_PROVIDER_REQUESTS=12`, `AGENT_TOKEN_BUDGET=100000`, `MODEL_MAX_OUTPUT_TOKENS=800`, `AGENT_MAX_REPAIRS=2`, `MODEL_TIMEOUT_MS=30000`, `RUN_MAX_MS=120000`. Config sai bị từ chối startup. Chạy mock/fake trước, sau đó smoke nhỏ với endpoint local hoặc provider đã được cho phép dùng quota; cân chỉnh theo context/dataset thực tế.

Contract đầy đủ ở [README: metrics/ngân sách](README.md#metrics-và-ngân-sách-mỗi-run-mục-4). Requests là giới hạn cứng tại **mỗi HTTP**, kể cả retry. Token là lập ngân sách: input theo byte UTF-8 + overhead, output dự phòng theo cap, tối thiểu 64; usage hợp lệ thay dự phòng, thiếu/sai/lỗi giữ dự phòng. Đừng nói số ước lượng là token chính xác hoặc bảo đảm hóa đơn. UI phân biệt provider reported / estimated / mixed / unavailable; mock không gửi HTTP.

Ngân sách đã chụp trong run không đổi khi sửa env/restart/duyệt; tạo run mới để dùng giới hạn mới. Thời gian chờ duyệt thuộc wall/wait, không thuộc active timeout. Approval replay không tốn thêm ngân sách. Hết ngân sách: run stopped với `request_budget`/`token_budget`, không gửi lượt tiếp và không thực thi tool mới; approve khi không đủ budget sẽ không ghi. Run legacy chỉ đọc với metrics chưa thu thập; approval legacy cần run mới. Không dùng tự chạy lại model để khôi phục.

Kiểm chứng nhanh:

```powershell
npm test
npm run eval
npm run demo:datasets
npm run demo:budgets  # normal: 2 requests, completed; budget: 1 request, stopped
npm run qa:metrics    # Chromium local, profile/store tạm; CHROME_PATH nếu cần
npm run qa:configuration  # selector, probe, reload, approval/replay
```

Mốc mục 5 ngày 2026-10-07: 222 test / 16 eval / 3 dataset scripted / 2 demo budgets đạt; Chrome QA metrics và configuration/reload/probe đạt desktop/mobile. Mốc live sau sửa P1: tổng sản phẩm Ollama qwen3:8b **2/3**, một lần bịa nguồn bị chặn sau repair. Không dùng kết quả scripted hoặc các lần live đúng để tuyên bố LLM luôn chọn đúng tool.

Đổi `provider`, tên model hoặc chế độ mock khi restart sẽ hủy approval của run đang hoạt động và kết thúc `failed/model_changed`; phải tạo run mới. Metrics/budget lịch sử giữ nguyên, không đổi cờ mock để ghép số liệu của hai model. Run đã kết thúc vẫn đọc được; đổi task vẫn có `task_changed`, model không đổi vẫn tiếp tục approval bình thường. Kiểm tra độ ổn định của ca sản phẩm bằng `npm run demo:datasets -- --live --only=products --repeat=3`, đọc cả verdict/query/source_id; giới hạn repeat 1–5, cloud vẫn bị script từ chối. Không nâng repair hoặc bỏ kiểm tra nguồn để lấy PASS.

Mục tiêu: trong thời gian làm bài, **chỉ thay phần nghiệp vụ**, giữ nguyên vòng lặp agent, validation,
phê duyệt và giới hạn. Đề và thông báo mới của giảng viên luôn được ưu tiên hơn nghiệp vụ mẫu ở đây.

## Checklist

1. **Đọc đề** — gạch chân: người dùng là ai, mục tiêu nhập vào là gì, kết quả trả ra gồm gì, dữ liệu nào có sẵn,
   thao tác nào *thay đổi dữ liệu*, quy tắc nghiệp vụ nào bắt buộc.
2. **Xác định tiêu chí chấp nhận** — viết 3–5 câu dạng "Khi … thì hệ thống phải …". Mỗi câu sẽ thành một
   evaluation case.
3. **Ánh xạ vào sườn** — với mỗi thao tác trong đề: đây là tool **đọc** hay **ghi**? Ghi thì có cần người duyệt
   không? Điền bảng ở cuối file này.
4. **Thêm/sửa file task được đăng ký trong `config/catalog.json`** — nhiệm vụ, dữ liệu, tool đã đăng ký được bật, mẫu thử và nhãn hiển thị. Giữ task ghi chú mẫu để các eval cũ còn chạy.
   Nếu đề cần tool mới thì thêm ở mục C bên dưới.
5. **Sửa dữ liệu** — mục B.
6. **Test** — `npm test` (phải còn xanh), sửa `eval/cases.json`, chạy `npm run eval`.
7. **Chuẩn bị demo** — một happy path, một case thiếu bằng chứng, một case bị chặn (tool sai / bị từ chối).
   Nếu có key: `npm run smoke:live` để có bằng chứng model thật.

Ngày thi còn một checklist riêng ở cuối file này. Muốn tập trước quy trình trên, xem "Bài diễn tập 30–45 phút".

## Bản đồ: thay đổi gì, sửa ở đâu

### A.0. Đăng ký, chọn và kiểm tra cấu hình trên UI (mục 5)

1. Tạo `config/<exam-task>.json` theo schema task hiện có. Khai báo dataset ID/file/cột trong `data.datasets`, chỉ bật tool thật. Thêm `{ "id": "exam-task", "file": "config/exam-task.json" }` vào `tasks` của `config/catalog.json`; ID phải trùng file task. Không nhận path hoặc module từ browser. Đổi default task nếu muốn request goal-only dùng đề mới.
2. Model profile mặc định `env` dùng `.env` hiện có; `mock` dùng offline; `ollama-qwen3` dùng local. Thêm profile ở backend theo ví dụ README: ID/label/provider/name/base_url và tùy chọn json_mode/reasoning_effort/requires_key. Key chỉ qua `api_key_env` tham chiếu biến môi trường; không literal key, không sửa `.env` qua UI. Profile thiếu key/name/endpoint unavailable, không fallback.
3. Restart. Mọi file task/data/danh mục được xác thực trước listen. Browser chỉ thấy metadata task/tools/data/profile cần thiết, không mission/prompt/key/tên biến secret/endpoint/đường dẫn máy. Không tự probe hoặc tải model khi mở trang.
4. Trong **Agent**, chọn task/model, đọc **Tools & allowed data**, bấm Example goal. Metadata bảng có columns/record count/version; note có ID/title/passages, tối đa 40 nguồn hiển thị. Chưa có preview hàng dữ liệu. `save_draft` chỉ hỗ trợ nguồn ghi chú; task dataset demo read-only.
5. Bấm **Check model** khi muốn thử: mock là simulation 0 HTTP; live tối đa 1 HTTP, không retry, timeout tối đa 5 giây, output cap 64. Usage/probe accounting riêng ghi audit, thiếu usage là unavailable/dự phòng. Đọc timestamp và phân biệt config valid, endpoint responded, protocol valid. Probe không chứng minh giải đúng nghiệp vụ; cold Ollama có thể timeout, warm xong có thể chủ động bấm lại.
6. Bấm Run, xem cấu hình lịch sử/metrics/trace/approval trong Dialogue. Selector khóa khi run active; đổi lựa chọn sau khi kết thúc chỉ ảnh hưởng run tiếp theo. New run xóa goal và viewed run_id ở browser, không xóa lịch sử backend.

`POST /api/runs` nhận `{goal, task_id?, model_profile_id?}`; chỉ goal vẫn tương thích default. `GET /api/catalog` trả danh mục an toàn. `POST /api/model-profiles/:id/probe` chỉ nhận `{}`; `GET /api/runs/:id` trả snapshot metadata lịch sử. Manager load store một lần rồi chia runtime theo IDs đã lưu; mỗi runtime có model/registry/retriever/dataset snapshot/limits riêng. Không sửa process.env theo select.

Reload lưu duy nhất run_id trong localStorage rồi GET/poll backend, không gửi lại goal, không approve hoặc gọi LLM. Running tiếp tục polling, pending hiện đúng arguments/hash, terminal hiện kết quả/lỗi/metrics đã lưu. ID sai/mất có thông báo cho tạo mới. Sau reload terminal, select cho run mới trở về default; Dialogue vẫn hiển thị cấu hình lịch sử.

Restart phục hồi pending theo cấu hình của chính run và ngân sách cũ. Task/profile mất hoặc unavailable → `configuration_missing`; task/data đổi → `task_changed`; identity model đổi (provider/name/mock/profile/endpoint/options; không credentials) → `model_changed`. Hủy pending, giữ lịch sử counters/token/model và không gọi model/ghi. Terminal không bị viết lại. Running bị gián đoạn vẫn `interrupted`, không tự chạy lại. Legacy chưa có IDs dùng defaults rồi đối chiếu fingerprint/model; thiếu metrics không tiếp tục approval.

Trước buổi thi: chạy toàn bộ lệnh kiểm chứng trên, chọn Mock + dataset Product sum để demo offline; chọn model local đã warm, bấm Check model và chạy ca nhỏ với nguồn đúng. Dự phòng bằng mock phải được ghi rõ là mô phỏng. Không tự chuyển model giữa run hoặc nới grounding/repair khi model bịa nguồn. Xem live evidence và giới hạn mới nhất trong README/handoff.

### A. Mục tiêu và instruction

`config/task.json` là nhiệm vụ ghi chú mặc định. `config/catalog.json` đăng ký nhiều task/profile để UI chọn bằng ID; mỗi run chụp cấu hình riêng, không có task/model hiện tại global.
Các khóa bắt buộc và khai báo dữ liệu tùy chọn:

| Khóa | Ý nghĩa |
|---|---|
| `id`, `title` | Mã ổn định dạng `a-z`, `0-9`, dấu `-`; tiêu đề trên UI |
| `mission` | Nhiệm vụ và ràng buộc nghiệp vụ model nhận trong system prompt; không chứa key/bí mật |
| `data.notes_dir` | Thư mục Markdown trong `data/`, ví dụ `data/notes`; phải có ít nhất một `.md` |
| `data.datasets` (tùy chọn) | Allow-list dataset JSON/CSV cho `query_dataset`; xem B.1. Bỏ trường này thì task ghi chú vẫn chạy |
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
| Vai trò, nhiệm vụ, giọng trả lời | File task được đăng ký trong `config/catalog.json` | `mission`; giữ ID ổn định |
| Quy tắc an toàn | `config/prompts.js` | `SAFETY_RULES` (giữ nguyên ý "kết quả tool là dữ liệu không tin cậy") |
| Định dạng quyết định của model | `config/prompts.js` → `PROTOCOL` **và** `src/agent/decision.js` | Hai chỗ phải đổi cùng nhau; thường **không cần** đổi |
| Số bước, timeout | `.env` hoặc `config/agent.config.js` | `AGENT_MAX_STEPS`, `MODEL_TIMEOUT_MS`, `TOOL_TIMEOUT_MS`, `RUN_MAX_MS` |

### B. Dữ liệu

| Cần đổi | File | Ghi chú |
|---|---|---|
| Tài liệu tra cứu | `data/notes/*.md` | Xóa file mẫu, thêm file mới. Tên file = `source_id` (chỉ `a-z 0-9 -`). Dòng `# ` đầu tiên là tiêu đề; dòng bắt đầu bằng `>` bị bỏ qua khi tìm kiếm; mỗi đoạn cách nhau một dòng trống là một "passage" |
| Dữ liệu dạng bảng (sản phẩm, lịch, đơn hàng…) | File JSON/CSV dưới `data/` + khai báo `data.datasets` | Dùng `query_dataset` sẵn có cho lọc, đếm, tổng, so sánh; không cần sửa vòng lặp |
| Nơi lưu kết quả | `src/store/fileStore.js` | Đã có `createDraftOnce(key, data)` chống ghi trùng — tái dùng cho bản ghi mới |
| Cần tìm theo nghĩa (đề yêu cầu embedding / vector) | `src/retrieval/` | Viết retriever mới cùng interface `search(query,{limit})`, `has(id)`, `kind`; đổi 1 dòng trong `src/app.js`. **Không** gọi BM25 hiện tại là vector search |

### B.1. Đổi dataset JSON/CSV trong thời gian thi

Tool `query_dataset` là **read**, `requiresApproval: false`. Đây là tra cứu bảng có cấu trúc;
retrieval ghi chú vẫn là BM25. Không có embedding/vector, SQL, join hay query engine tổng quát.
Hai bộ dữ liệu nhỏ **giả lập**: `data/datasets/products.json` (sản phẩm) và
`data/datasets/classes.csv` (lịch học). Task mẫu đầy đủ nằm ở `config/datasets-demo.task.json`;
task ghi chú mặc định trong `config/task.json` vẫn giữ nguyên.

Khi nhận đề:

1. Đặt dữ liệu vào `data/<ten>.json` hoặc `.csv`, UTF-8. JSON là mảng object phẳng;
   CSV có header đúng các cột khai báo, hỗ trợ dấu phẩy trong ô quoted, quote escape `""`, LF/CRLF,
   xuống dòng trong ô quoted và BOM UTF-8. Header thiếu/trùng/lạ, số ô sai, quote lỗi đều bị từ chối.
2. Thêm `data.datasets` vào `config/task.json`, giữ `data.notes_dir` hợp lệ (kể cả khi chỉ dùng bảng).
   Chỉ các dataset trong mảng này được phép đọc. Ví dụ:

```json
{
  "notes_dir": "data/notes",
  "datasets": [{
    "id": "products",
    "file": "data/datasets/products.json",
    "id_column": "id",
    "columns": [
      { "name": "id", "type": "string" },
      { "name": "name", "type": "string" },
      { "name": "category", "type": "string" },
      { "name": "price", "type": "number", "scale": 2 },
      { "name": "stock", "type": "number", "scale": 0 }
    ]
  }]
}
```

3. Thêm `query_dataset` vào `allowed_tools`; đổi `mission` sang trả lời từ kết quả tool đó,
   trích nguồn, giải thích dữ liệu thiếu và không coi trang lookup bị cắt là toàn bộ tập dữ liệu.
   Sửa `sample_inputs` cho đề mới. Không cần sửa runner/prompt protocol/final contract.
4. Khởi động lại server. Startup từ chối cấu hình/dữ liệu sai, đường dẫn tuyệt đối, `..`, backslash,
   symlink/junction ở file hoặc thư mục cha, file không thường, file ngoài `data/`, extension ngoài
   `.json`/`.csv`, file >128 KiB, >200 bản ghi, >16 cột hoặc >6 dataset.
   `query_dataset` được bật mà không có dataset thì startup cũng thất bại. `task.json` không nạp code.
5. Viết acceptance cases cho đề mới, chạy test và thử model thật đã xác minh.

Mỗi bản ghi phải có đúng các cột, ID kiểu string không rỗng và duy nhất. Cột chỉ có `string` hoặc
`number`; ô string tối đa 500 ký tự, không tự trim hay đổi chữ hoa/thường. ID dataset dùng
`a-z 0-9 -` (bắt đầu bằng chữ, tối đa 40 ký tự); tên cột dùng `a-z 0-9 _` (bắt đầu bằng chữ).
Dataset được nạp thành snapshot bất biến lúc startup. Sửa file khi server đang chạy chưa có hiệu lực;
fingerprint task chứa phiên bản dữ liệu nên restart sau đổi bảng cũng vô hiệu hóa run/approval cũ.

**Contract arguments** (mọi khóa ngoài schema đều bị backend từ chối):

| Trường | Quy tắc |
|---|---|
| `dataset_id` | Bắt buộc, ID trong `data.datasets`; model không truyền đường dẫn |
| `operation` | Bắt buộc: `lookup`, `count`, `sum`, `compare` |
| `filters` | Tùy chọn, mặc định `[]` = mọi hàng; tối đa 8 điều kiện AND `{field, op, value}` |
| `op`, `value` trong điều kiện | `eq/ne` cho string (khớp chính xác, phân biệt hoa/thường); số có thêm `lt/lte/gt/gte`; `value` luôn là string |
| `field` | Cột number bắt buộc với `sum`; tùy chọn với `compare`; cấm với lookup/count |
| `compare_filters` | Bắt buộc riêng cho compare: điều kiện nhóm thứ hai; `[]` so với toàn bộ dataset |
| `limit` | Chỉ lookup: integer 1–10, mặc định 5; trả hàng theo thứ tự file, có `truncated` rõ ràng |

`count`/`sum` dùng **tất cả** hàng khớp, không dùng riêng trang lookup. `compare` so số lượng hai nhóm
nếu không có field, hoặc so hai tổng nếu có field; trả `values: [trái, phải]` và `relation: eq/lt/gt`.
Hai nhóm độc lập, có thể giao nhau. Không có hàng khớp: lookup rỗng, count = 0, sum = chuỗi zero đúng scale;
vẫn có nguồn chứng minh điều kiện đã được chạy trên snapshot này.

Ví dụ lời gọi:

```json
{"dataset_id":"products","operation":"lookup","filters":[{"field":"stock","op":"gt","value":"0"}],"limit":2}
{"dataset_id":"products","operation":"sum","field":"price","filters":[{"field":"category","op":"eq","value":"stationery"}]}
{"dataset_id":"classes","operation":"compare","field":"students","filters":[{"field":"day","op":"eq","value":"Mon"}],"compare_filters":[{"field":"day","op":"eq","value":"Tue"}]}
```

**Độ chính xác số:** `scale` là 0–6 (mặc định 0), số thập phân dạng thường với dấu `-` tùy chọn;
không chấp nhận khoảng trắng, ô rỗng/null/boolean, hex, dấu phân cách hàng nghìn, exponent, NaN/Infinity
hay quá nhiều chữ số sau dấu chấm. Không làm tròn, không đổi ô sai thành 0. JSON nhận số hoặc chuỗi số;
token số gốc được giữ trước khi chuyển thành Number để không mất chữ số. CSV dùng chuỗi ô.
Mỗi giá trị sau nhân `10^scale` phải nằm trong ±9007199254740991; tổng dùng BigInt và có thể vượt
phạm vi này. Dữ liệu số trong kết quả và tổng được chuẩn hóa thành **chuỗi thập phân** đúng scale;
count vẫn là integer. Đơn vị tiền/học sinh do cột và mission xác định. Không tự nhân price với stock,
không cộng chéo các đơn vị hoặc scale.

Kết quả là `{count: 1, results: [evidence]}`. `count` bên ngoài đếm evidence, không đếm bản ghi;
số bản ghi nằm ở `matched_count`. Evidence chứa `source_id` dạng `ds-<dataset_id>-<hash>`,
`dataset_id`, `dataset_version` (SHA-256 khai báo + bytes file), `query` đã chuẩn hóa,
`matched_rows` (truy vết ordinal đánh số **từ 1**), và giá trị/hàng trả về.
Compare có thêm `compared_count`/`compared_rows`. JSON ordinal = index mảng +1;
CSV ordinal không tính header, không phải số dòng vật lý khi ô chứa newline. Lookup trả cả ordinal
và record có cột ID. `passage: 1` chỉ là marker tương thích evidence hiện tại; truy vết hàng dùng ordinal.
Nguồn ổn định với cùng snapshot và query chuẩn hóa; đổi dữ liệu/điều kiện sẽ đổi nguồn.
Runner tiếp tục ghi nhận nguồn trong chính run và chặn citation bịa qua contract final hiện có.

Truy vết chọn biểu diễn ngắn hơn giữa mảng đoạn đóng `[đầu, cuối]` và bitmap không mất thông tin:
`{"encoding":"bitmap-lsb0-base64","total_rows":200,"bits":"..."}`.
Giải mã `bits` bằng Base64; ordinal `n` nằm ở byte `floor((n-1)/8)`, bit `(n-1)%8`,
bit thấp nhất là bit 0. Chỉ đọc đến `total_rows`; bit 1 nghĩa là hàng thuộc nhóm.
Với 200 hàng xen kẽ, hai nhóm vẫn giữ đủ 100 vị trí mỗi nhóm, cùng phiên bản/điều kiện/kết quả;
không cần thay đổi tập điều kiện để so sánh. Source ID không phụ thuộc cách mã hóa vị trí hàng.

Kết quả tính cả wrapper observation bị giới hạn **1.500 ký tự**, dưới giới hạn mặc định 1.800 của runner.
Quá dài thì tool báo lỗi rõ, không cắt âm thầm: giảm `limit` cho lookup hoặc dùng điều kiện tương đương
ngắn hơn. Giới hạn vẫn áp dụng cho bản ghi lookup lớn hoặc bản thân phần điều kiện quá dài.
Không có sort, OR, tìm gần đúng, group-by, join, date arithmetic hay công thức tùy ý;
so sánh nhóm là hai tập điều kiện rõ ràng, đáp ứng bộ ví dụ nhỏ.

Kiểm chứng riêng, không sửa assertions của 16 eval ghi chú:

```powershell
npm test
npm run eval
npm run demo:datasets          # 3 run scripted qua runner thực: tổng 30.30, đếm 2, so tổng 55 > 40
npm run demo:datasets -- --live # chỉ model thật local trong .env; script từ chối cloud
```

Demo dùng task mẫu và thư mục lưu trữ tạm, không thay `config/task.json`, `.env` hay dữ liệu run hiện có.
Test `tests/dataset-agent.test.js` còn chạy qua HTTP thật: đề xuất → kiểm tra backend → observation
→ final có nguồn; có ca dataset ngoài allow-list, tool bị tắt và citation bịa.
Mock luật ghi chú vẫn không tự biết gọi tool mới; scripted demo chỉ chứng minh backend.

Smoke đối chiếu **evidence được trích** với kết quả backend của query mong đợi trên cùng snapshot:
source ID, dataset/version, điều kiện, hàng và phép tính đều phải khớp. Chấm toàn bộ token số,
phân biệt `2` với `12`, `2.5` hay `-2`; compare kiểm tra từng tổng gắn đúng nhóm và quan hệ.
Demo yêu cầu dạng answer hẹp: `stationery = 30.30.`, `Mon = 2 lớp.`,
`Mon = 55; Tue = 40; Mon > Tue.`. Chỉ dạng được chấm chắc và evidence đúng mới là `PASS`.
Văn xuôi ngoài dạng này, thiếu liên kết nhóm/quan hệ hoặc có văn bản `unresolved` là
`REVIEW_REQUIRED` — cần đọc tay, không tính PASS. Số/query/evidence sai là `FAIL`.
Exit code: 0 = mọi ca PASS, 1 = có FAIL, 3 = không FAIL nhưng có REVIEW_REQUIRED.
PASS chỉ xác nhận evidence và dạng trả lời được hỗ trợ; ngữ nghĩa diễn đạt tự do vẫn cần đọc tay.
Regression tests bao gồm 200 hàng xen kẽ qua cả tool và runner, `12 lớp`, tổng Mon/Tue bị đảo,
quan hệ sai, số không khớp ranh giới, nguồn/query/version sai và văn xuôi chưa chấm chắc.

Đã chạy ngày **2026-10-07**, Windows/Node **24.13.0**: `npm test` **144/144**, `npm run eval`
**16/16** (giữ nguyên ca ghi chú), `npm run demo:datasets` **3/3** scripted.
`npm run demo:datasets -- --live` với Ollama local **qwen3:8b** hoàn thành **3/3**:
model tự đề xuất sum → final `30.30`, count → final `2`, compare → final hai tổng `55` và `40`,
đều trích nguồn tool trả về. Đây là lượt trước khi siết bộ chấm; đã đọc tay thấy số và nguồn đúng,
không dùng kết quả chấm cũ để chứng minh bộ chấm mới. Chưa xác minh model cloud hay đề/dataset khác.

Sau hai sửa lỗi P2, ngày **2026-10-07**: `npm test` **156/156**, eval ghi chú **16/16**,
demo scripted **3/3 PASS**. Smoke Ollama local `qwen3:8b` với bộ chấm mới **3/3 PASS**,
0 FAIL, 0 REVIEW_REQUIRED: `stationery = 30.30`, `Mon = 2 lớp`,
`Mon = 55; Tue = 40; Mon > Tue`, nguồn/query/snapshot khớp reference evidence.
Chỉ các dạng answer hẹp trên được chấm tự động; không suy rộng thành khả năng chấm ngữ nghĩa mọi câu trả lời.

`save_draft` hiện chỉ chấp nhận nguồn ghi chú, chưa lưu được bản nháp trích nguồn dataset.
Nếu đề yêu cầu lưu kết quả từ bảng, cần mở rộng quy tắc nguồn của tool ghi và thêm regression tests
cho grounding, approval và idempotency; mục JSON/CSV chỉ cung cấp tool đọc.

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
| Tiêu đề, nhãn, mục tiêu mẫu | File task trong danh mục; UI lấy `/api/catalog`, Dialogue dùng snapshot của run |
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

## Đề cần so sánh số lượng hai nhóm

Thêm `compare_counts` vào `allowed_tools` của task, khai báo các dataset/cột/scale trong `data.datasets` và đăng ký task ID trong `config/catalog.json`. Có thể chỉ bật `compare_counts`; thêm `query_dataset` nếu đề cần lookup/count/sum. Startup từ chối tool bảng không có dataset. Task mặc định không tự có quyền mới. Restart server để nạp snapshot mới; run đang hoạt động thuộc cấu hình đã đổi bị xử lý theo cơ chế `task_changed` hiện có.

Tool chỉ đọc, không cần approval; tất cả ba arguments đều bắt buộc. Ví dụ **hình dạng** (thay ID/cột/giá trị theo đề):

```json
{
  "type": "tool_call",
  "tool": "compare_counts",
  "arguments": {
    "dataset_id": "items",
    "filters": [{ "field": "group", "op": "eq", "value": "A" }],
    "compare_filters": [{ "field": "group", "op": "eq", "value": "B" }]
  }
}
```

`[]` chọn toàn bộ dữ liệu. Các điều kiện là AND; nhóm có thể giao nhau, không bị loại trừ lẫn nhau. Chuỗi eq/ne phân biệt hoa thường; numeric value là chuỗi decimal đúng scale, dùng cùng operators và giới hạn tối đa 8 điều kiện mỗi nhóm như `query_dataset`. Không gửi operation/field/limit/null/đường dẫn/khóa lạ; backend từ chối, không tự sửa arguments. `values[0]` thuộc filters, `values[1]` thuộc compare_filters; relation so trái với phải. Phép cộng và so tổng dùng `query_dataset` với field numeric, không dùng tool này.

Kết quả dùng lại engine/provenance/source ID của query_dataset, kể cả nhóm rỗng. Final phải chép nguồn đã trả trong chính run. Viết acceptance qua runner: kiểm tra điều kiện/snapshot, hai count, gán đúng nhóm, relation, citation và không write. Case tham khảo `tickets-compare` trong `src/operations/cases.js`; grader lấy reference từ tool khai báo trong case. Ghi nguồn dataset qua `save_draft` vẫn chưa được hỗ trợ.

Khi sửa logic chấm readiness, bổ sung dependency ngoài `src/config` vào danh sách `GRADER_FILES` ở `src/operations/context.js`. Hiện danh sách có `eval/checks.js`, cases và suite; hash tên+nội dung theo thứ tự ổn định. Bản sao project dùng để kiểm thử phải có `eval/`. Không hash .env/var/.git/tài liệu; docs-only commit không làm stale.
