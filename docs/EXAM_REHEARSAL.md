# Mục 6: mở máy, kiểm tra và diễn tập đổi đề

**Đợt 1 ngày 2026-10-08:** 271 tests và mọi nhóm offline đạt; `compare_counts` live qwen3:8b đạt tickets-compare **3/3**, 6 HTTP, 0 repair/retry. Đợt này chỉ kiểm chứng lại live ticket compare; evidence 18/18 smoke trước đây đã stale sau đổi runtime/task/grader. Xem phần cuối; không dùng số hoặc blocker lịch sử làm trạng thái hiện tại.

Hai đề dưới đây là **dữ liệu giả lập**, không phải dự đoán đề thi. Dùng engine `query_dataset` hiện có; ticket có thêm interface nhỏ `compare_counts` để so số lượng, không thêm join hoặc công thức tùy ý. `save_draft` chỉ nhận nguồn ghi chú. Nếu đề thật yêu cầu ghi từ bảng, cần một tool ghi với business rules, approval và idempotency riêng.

## Mở máy → warm → kiểm tra → UI

```powershell
cd D:\New-Tech\ai-agent-starter
node -v                         # >=22.12.0 theo package.json
npm run exam:start              # foreground; Ctrl+C dừng server do launcher tạo
```

Từ terminal đang ở thư mục khác, dùng đường dẫn script:

```powershell
node D:\New-Tech\ai-agent-starter\scripts\exam-start.js
```

Root lấy từ vị trí script; `.env` hiện có được nạp bằng cơ chế cũ, biến môi trường terminal có ưu tiên. Catalog/task/dataset/profile được xác thực trước startup. Cổng lấy từ `PORT` (mặc định 8787), bind từ `HOST` (mặc định loopback). Launcher chờ cả health và catalog rồi mới in URL. Không gọi LLM, cài package, tải model, sửa `.env` hoặc kill tiến trình khác.

Cổng có server cùng project: tái sử dụng; nếu configuration fingerprint khác, yêu cầu dừng/restart server trong terminal gốc. Cổng có ứng dụng khác hoặc server cũ thiếu `health.service.project_id`: **BLOCKED**, người vận hành tự kiểm tra/dừng đúng ứng dụng. Không tự đổi cổng. `GET /api/health` thêm service name và các hash project/configuration; không trả đường dẫn root.

Mở terminal thứ hai, chủ động kiểm tra/warm profile đã đăng ký:

```powershell
npm run exam:model -- --profile=ollama-qwen3 --action=inspect
npm run exam:model -- --profile=ollama-qwen3 --action=warm
npm run exam:model -- --profile=ollama-qwen3 --action=probe
```

`inspect` chỉ đọc `/api/tags` và `/api/ps` trên Ollama local, báo installed/loaded, số metadata GET, **0 model requests**. Thiếu model thì in tên và lệnh `ollama pull "qwen3:8b"` để người dùng tự quyết định chạy; script không tải. Service chưa chạy thì người dùng tự mở Ollama.

`warm` chỉ dành cho profile thật ở localhost/127.0.0.1/::1 đã được backend xác thực, sau inspection xác nhận model đã tải. Tối đa **1 HTTP model request**, retry=false, output cap 64, input connectivity cố định, timeout 60 giây hữu hạn; không gửi ghi chú/bảng hoặc chạy tool. Có metrics riêng, usage thiếu giữ null + estimated reservation. Model có thể bị unload sau thời gian keep-alive của Ollama: warm lại chủ động khi cần. Warm không làm tăng timeout probe: **probe vẫn tối đa 5 giây**. Mock probe ghi simulation, không kiểm chứng kết nối thật. CLI model check không cho endpoint tùy ý hoặc gọi cloud.

Mở URL launcher in, chọn đúng Task và Model trong Configuration, đọc tools/data/example, bấm **Check model** nếu cần kiểm tra lại, rồi chạy goal. Server running, profile configured, endpoint responded, protocol valid và live acceptance PASS là các trạng thái riêng. Một probe/warm thành công không chứng minh model luôn giải đúng đề. Đổi lựa chọn chỉ ảnh hưởng run mới; reload chỉ GET/poll run đã lưu, không tự approve hay gọi lại LLM.

## Đề A — support tickets, JSON

“Xây trợ lý tra cứu/thống kê ticket hỗ trợ giả lập. Cho phép lọc chính xác theo team/status, đếm và so sánh hai tập. Câu trả lời phải trích nguồn snapshot/query. Không truy cập dataset khác hoặc ghi dữ liệu.”

- Task `rehearsal-tickets`, config `config/rehearsal-tickets.task.json`, dataset ID `tickets`, file `data/datasets/tickets.json`.
- 6 bản ghi; `id`, `team`, `status` kiểu string; `hours` numeric scale 0 (cộng chính xác nguyên). Team/status phân biệt hoa thường. Bật read tools `query_dataset` và `compare_counts`; tool sau chỉ nhận dataset_id/filters/compare_filters, hai arrays bắt buộc, không operation/field/limit/null.
- Input: goal ngôn ngữ tự nhiên hoặc quyết định scripted trong acceptance suite. Output: contract final cũ `answer`, `source_ids`, `unresolved`; observation có dataset version/query và kết quả backend tính, source ID đầy đủ được chép nguyên.

| Case ID | Input / query cần chứng minh | Đáp án xác định |
|---|---|---|
| `tickets-count` | Count team Support AND status open | `Count = 2.` + source |
| `tickets-compare` | Compare count open Support versus open Billing | `Support = 2; Billing = 1; Support > Billing.` + source |
| `tickets-empty` | Lookup status cancelled, limit 5 | 0 rows, `Empty = yes.` + nguồn của điều kiện rỗng |
| `tickets-blocked` | Model scripted đề xuất dataset rooms | Backend từ chối trước execute, không approval/write; không có nguồn rooms |

## Đề B — phòng học, CSV

“Xây trợ lý tìm phòng học giả lập theo location và capacity; đếm hoặc cộng capacity của tập được chỉ định. Không xếp lịch, đặt phòng, join hoặc tự tính công thức. Phải có nguồn của snapshot/query; không ghi dữ liệu.”

- Task `rehearsal-rooms`, config `config/rehearsal-rooms.task.json`, dataset ID `rooms`, file `data/datasets/rooms.csv`.
- 5 bản ghi; `id`, `room`, `location` string; `capacity` numeric scale 0. Header phải đúng schema. Dùng parser CSV cũ hỗ trợ quoted comma/escaped quote/CRLF.
- Input/output cùng contract đề A; backend thực hiện so sánh số và tổng, LLM diễn đạt kết quả.

| Case ID | Input / query cần chứng minh | Đáp án xác định |
|---|---|---|
| `rooms-lookup` | Lookup South AND capacity >=40, limit 5 | Chỉ B202, `Rooms = B202.` + source |
| `rooms-sum` | Sum capacity, location North | `Total = 70.` + source |
| `rooms-empty` | Lookup capacity >=1000, limit 5 | 0 rows, `Empty = yes.` + nguồn điều kiện |
| `rooms-blocked` | Model scripted đề xuất save_draft | Tool ngoài allow-list bị từ chối, không ghi, không approval |

Hai task cũ và default IDs giữ nguyên. Hai task mới đã có example goals/labels để xem trên UI. Rule-based Mock của UI chỉ hỗ trợ các ví dụ cũ; **không giải hai đề mới**. Dùng scripted suite để chứng minh backend offline hoặc model thật đã được kiểm chứng để demo UI.

## Chạy acceptance và live có giới hạn

```powershell
npm run exam:rehearsal            # 8 cases, runner/registry/store thật, scripted model
npm run exam:smoke                # 6 tình huống cũ, gồm approve/reject/replay
npm run exam:smoke -- --live --profile=ollama-qwen3 --repeat=3 --max-requests=60
npm run exam:rehearsal -- --live --profile=ollama-qwen3 --only=tickets-count,tickets-compare,tickets-empty,rooms-lookup,rooms-sum,rooms-empty --repeat=3 --max-requests=48
```

Chọn `--only=<case IDs>` và `--repeat=1..5`. Request cap toàn phiên 1..200, mặc định 40, kiểm tra **trước mọi HTTP/retry**; đồng thời mỗi run vẫn có giới hạn riêng. BLOCKED dừng thử live tiếp theo, giữ các ca chưa chạy ở NOT_RUN. FAIL/REVIEW_REQUIRED không bị giấu; mọi trial trong phiên được giữ. Forced forbidden proposals là kiểm chứng scripted, không ép LLM thật phải làm sai nên không có live PASS cho hai ca blocked.

Cloud chỉ khi người vận hành chủ động chọn profile backend đã cấu hình và truyền cả `--live --cloud --profile=ID --max-requests=N`. Không có cloud call khi startup/mở UI/đổi select; đợt triển khai này không dùng cloud. Các command smoke dùng store tạm riêng, không đưa draft smoke vào lịch sử thật hoặc xóa `var/`.

PASS của smoke kiểm tra tool/evidence/query/snapshot, số theo token đầy đủ, gán đúng tổng/quan hệ và dạng đáp án khai báo. Văn phong ngoài dạng đã kiểm tra là REVIEW_REQUIRED; ngữ nghĩa rộng hơn vẫn cần đọc tay. `demo_ready_cases` chỉ gồm live case đạt 3 trial liên tiếp trong cùng phiên/cấu hình, không ghép trial của nhiều cấu hình để tạo một PASS.

## Đo thời gian sinh viên đổi đề

Không lấy vài trăm ms scripted evaluation làm thời gian đổi đề. Không có số phút bảo đảm. Đợt triển khai này **chưa đo thời gian đổi đề thực tế**; thời gian agent triển khai cũng chưa được bấm giờ riêng. Script reports giữ `elapsed_ms` và `timing_kind=script_execution`; timer là nhật ký tự ghi, luôn cần review.

Tự làm mỗi đề một lần, không nhìn đáp án trước. Bắt đầu session, chép timing ID được in:

```powershell
npm run exam:timer -- begin --task=rehearsal-tickets --actor=student
npm run exam:timer -- mark --id=timing-<UUID> --step=read --event=start
# Đọc đề rồi ghi kết thúc, lỗi/việc sửa bằng tay trong note (tối đa 500 ký tự)
npm run exam:timer -- mark --id=timing-<UUID> --step=read --event=end --note="Read problem; no edits; no errors"
```

Lặp start/end đúng thứ tự 6 bước:

| Step | Việc thực hiện bằng tay và bằng chứng cần ghi |
|---|---|
| `read` | Đọc đề, xác định điều được/không được làm |
| `map` | Ánh xạ yêu cầu → cột dữ liệu → operation/filters → rules → acceptance cases |
| `config` | Tạo/đổi file dữ liệu và schema/task, đăng ký catalog ID; ghi file tương đối đã sửa và lỗi parsing/validation |
| `start` | Khởi động/restart chính server, đọc health/catalog/task/version; model inspection/warm/probe chủ động |
| `acceptance` | Chạy đúng case của đề; giữ cả thất bại và chỉnh sửa, không xóa assertions an toàn |
| `demo` | Chạy một luồng UI, giải thích tool validation, dữ liệu/nguồn, metrics, thiếu bằng chứng hoặc thao tác bị chặn |

```powershell
npm run exam:timer -- show --id=timing-<UUID>
```

Sau đó làm đề B với session `--task=rehearsal-rooms` mới. Chỉ một người/CLI ghi mỗi session, không ghi song song. Nhật ký append-only ở `var/exam/timings/`; mỗi mốc giữ configuration hash lúc ghi, note và timestamp. Thời gian là tự ghi bằng đồng hồ máy, clock lùi bị từ chối, không phải đo độc lập năng lực sinh viên. `actor=agent` dành cho thao tác agent, không được tính là student time. Session đủ 6 bước vẫn REVIEW_REQUIRED; session chưa đủ là NOT_RUN. Không ghi key/prompt/nội dung bảng vào note.

Nếu đề mới cần thay dữ liệu: thêm file trong `data/`, schema/scale/ID trong task JSON; thêm task ID → file được phép trong `config/catalog.json`; tạo acceptance cases bằng đáp án xác định; restart server, chọn task mới, kiểm tra fingerprint/source. Không sửa agent loop, không nhận đường dẫn từ model/browser. Khi thay task/data hoặc profile identity, pending approval cũ của cấu hình bị ảnh hưởng bị hủy theo cơ chế mục 5; terminal history giữ nguyên.

## Báo cáo và checklist trước demo

```powershell
npm test
npm run eval
npm run demo:datasets
npm run demo:budgets
npm run qa:metrics
npm run qa:configuration
npm run exam:report -- --profile=ollama-qwen3
npm run exam:report -- --id=smoke-<UUID>
```

`var/exam/*.json` được Git bỏ qua. Mỗi report có ID riêng, timestamp/commit/working-tree state, Node/platform/port, task/data fingerprints, profile identity/cap/reasoning, kết quả và accounting. Không lưu key, headers, system prompt, HTTP request body hoặc root path. Case reports giữ quyết định JSON/tool/query, nguồn đã trả/được trích, lỗi và counters; `observation_source_ids_complete` kiểm tra ID đầy đủ có tới messages gửi model. Token provider reported tách với estimated reservation, usage thiếu không thành 0. Request cap là cứng; token budget vẫn là ước lượng, không bảo đảm hóa đơn tuyệt đối.

Readiness đọc tối đa 50 report gần nhất, tách configured/probed/warmed, offline/live/student timing. Có PASS, FAIL, BLOCKED, REVIEW_REQUIRED, NOT_RUN; không gộp thành READY. Overall vẫn REVIEW_REQUIRED khi chưa có diễn tập người dùng được đọc lại; cổng không xác minh được là BLOCKED dù live đúng. Reports cũ bị đánh dấu stale khi task/data/profile/options/budget/runtime hoặc suite/grader đổi; không dùng làm bằng chứng sẵn sàng hiện tại. Runtime identity bao phủ tên và nội dung JavaScript modules dưới `src/` và `config/`, cùng Node engine; gồm metrics, grounding, schema, loader, run manager và storage, cả modules mới. Đổi commit riêng được ghi `commit_changed`, không tự coi một docs-only commit làm dữ liệu stale. Report không tự phát hiện mọi thay đổi dịch vụ/model weights bên ngoài; kiểm tra lại trước demo.

Checklist: đúng project/Node → đúng server/cổng → chọn đúng task/model/Mock-Live → đọc schema/version/tools → inspect/warm/probe chủ động → 3 trial liên tiếp của **đúng goal sẽ trình bày** → đọc tay đáp án/nguồn → tập approve/reject riêng bằng task ghi chú → ghi thời gian cả hai đề → xem readiness và xử lý FAIL/BLOCKED/NOT_RUN → checkpoint local sau kiểm chứng. Không push khi chưa được yêu cầu.

Nếu yêu cầu join, đặt/chuyển phòng, sửa ticket, tính công thức chưa cung cấp cột có thể cộng hoặc ghi kết quả bảng: cần thiết kế/test tool mới theo backend rules; không cố sửa mission để biến tool đọc thành tool ghi.

## Kết quả thực tế mục 6, 2026-10-07

Node 24.13.0, Windows; catalog cuối có 4 task, 4 profile. Profiles local `ollama-qwen3` và `ollama-qwen3-4b` dùng hai model **đã tải sẵn**, temperature 0, reasoning_effort none, output cap 800; không cloud/download/failover. Profile 4B chỉ để so sánh có chọn chủ động, không đổi default. Giới hạn run giữ 12 HTTP/100000 estimated tokens/6 tool steps/2 repairs. Timeout model thực tế **120000ms từ `.env` sẵn có**, khác mặc định 30000ms; agent không sửa `.env` hoặc tăng timeout. Probe vẫn 5s, warm riêng 60s. Reports ghi rõ limits/timeout/temperature/json mode để tái hiện đúng cấu hình.

| Nhóm | Kết quả |
|---|---|
| Tests/eval/demos | 253/253; 16/16 notes; 3/3 dataset scripted; 2/2 budget fake HTTP |
| Browser | Chrome thật, desktop 1280/mobile 390; metrics và configuration/reload/probe/approval đạt; thêm metadata hai task mới; 7 fake probe +8 fake run HTTP ở configuration, 6 fake HTTP ở metrics |
| Scripted mới | 6/6 smoke, 8/8 rehearsal; 0 HTTP LLM, 191/225ms script; không phải student time |
| Launcher | Root-independent từ System32; free/own/foreign ports và foreground child thật trong project/store tạm đạt. Port thật 8787 có owner/server cũ chưa xác minh: BLOCKED; không kill/reuse nhầm |
| Local warm/probe 8B | PASS, mỗi thao tác 1 HTTP/48 provider tokens, 0 retries; cold warm 9152ms, probe 488ms; probe vẫn 5s |
| Smoke 8B catalog cuối | **15 PASS, 3 FAIL**, 45/60 HTTP, 59366 provider tokens, 3 repairs/0 retries, 149842ms. Notes/sum/compare/missing/approve đạt 3 liên tiếp; reject final bỏ nguồn note nên FAIL theo acceptance dù backend không ghi/replay đúng |
| Rehearsal 8B catalog cuối | **9 PASS, 9 FAIL**, 36/48 HTTP, 51486 provider tokens, 0 repair/retry, 123854ms. tickets-count/rooms-lookup/rooms-sum đạt 3 liên tiếp; tickets-compare repeated_action, hai empty cases bỏ nguồn query |
| So sánh 4B, lịch sử stale sau sửa adapter | **6 PASS, 3 FAIL, 3 REVIEW_REQUIRED, 6 NOT_RUN**, dùng đủ 48/48 HTTP, 82044 provider tokens, 21 repairs/0 retries, 75506ms. Chỉ tickets-count/rooms-lookup đạt 3 liên tiếp; không chọn làm model dự phòng đã ổn định |
| Diễn tập sinh viên | NOT_RUN — **chưa đo thời gian đổi đề thực tế**; không suy ra thời gian người làm từ elapsed_ms |

Trước sửa prompt, notes 8B ba lần bỏ retrieval và bịa note IDs. Hướng dẫn chung chép source chưa đủ; repair nhắc chưa có evidence/phải gọi read tool mới giúp notes đạt 3 lần, mỗi lần một repair. Một phiên trung gian smoke đạt 18/18 nhưng **không thay** verdict 15/18 mới nhất. Mission mới làm rõ count compare bỏ field/limit và empty lookup vẫn có nguồn; before/after rehearsal vẫn 9/18, nên dừng chỉnh prompt. Các trial lỗi, grader versions và report stale đều được giữ. Ở hai phiên cuối, mọi trial có evidence đều xác nhận source ID đầy đủ trong observation gửi model; trial chưa có nguồn giữ null, không giả thành true.

Kiểm thử thêm phát hiện fetch tự follow redirect làm một request được đếm thành hai HTTP thực tế. Adapter nay dùng `redirect: manual`: 3xx bị từ chối, không follow/retry, vẫn ghi một request và usage chưa xác định. Regression qua warm và runner chứng minh URL đích không nhận request, tool không chạy. Báo cáo trước thay đổi adapter được đánh dấu stale; các số cuối dưới đây đã chạy lại sau sửa.

Accounting fresh scope 8B: **83 HTTP, 110948 provider tokens, 3 repairs, 0 retries**, không thiếu usage; gồm warm/probe và hai phiên live cuối. Đây không phải tổng toàn bộ baseline/thử nghiệm. Failure cũ vẫn nằm trong report lịch sử và được đánh dấu stale.

Evidence IDs để đọc chi tiết bằng `exam:report -- --id=...`:

- Kiểm chứng offline: `verification-50364efb-95ce-4fea-a241-a6882bf0318d`.
- Scripted smoke/rehearsal: `smoke-cc306732-e5a9-4289-9171-8b35326d80af`, `rehearsal-55ab5605-20e4-4ad8-b03b-76fc3e3cb976`.
- Smoke cuối 8B: `smoke-86bf8286-619f-4684-8cb6-17466c736102`.
- Rehearsal cuối 8B: `rehearsal-d060d8f3-2279-4cbe-a6fa-05dd088f8d32`.
- So sánh 4B: `rehearsal-de000b87-17e5-4a2b-bbad-ffb0e4c1d853`.
- Warm/probe cuối 8B: `warm-af940e86-1e90-4cbd-9eff-28b071c67afb`, `probe-96f63da8-1118-44c9-9fea-975424b7885f`.

Chỉ trình bày live các goal được đánh dấu 3 PASS liên tiếp sau khi tự đọc tay source/answer lần nữa. Ca failed dùng để giải thích giới hạn hoặc demo scripted có nhãn rõ. Để sẵn sàng đi thi còn cần tự restart đúng server 8787, diễn tập cả hai đề có timing và chọn/xác minh model cho các ca live còn lỗi. Toàn bộ `eval:live`, cloud và một lượt diễn tập UI bằng sinh viên chưa được kiểm chứng trong mục 6.

## Sau review P2, 2026-10-08

Checkpoint `6fb21e5` sửa hai P2 và test timing race; `c575717` chỉ làm rõ instruction, không thêm nghiệp vụ. Không đổi `.env`, schema/final contract, grounding, repairs/steps/timeouts hoặc dữ liệu mẫu.

- Approval grader đối chiếu approval state, observation `save_draft`, draft count và replay. Final chỉ `Saved.`/`Not saved.` không cần source ghi chú; tuyên bố ngược outcome bị FAIL. HTTP knowledge vẫn cần note citation, nội dung khác cần đọc tay. Backend vẫn yêu cầu unresolved nếu final không có source. Scripted approval cũng trả source_ids rỗng để exercise đúng trường hợp này.
- Runtime hash mở rộng thay cho danh sách 5 file cũ. Regression sửa thuật toán dự phòng token trong bản sao tạm làm report stale, và commit Git chỉ chứa tài liệu vẫn fresh/commit_changed. Report cũ trước thay đổi không bị xóa.
- Full suite ban đầu 259/260 vì fixture response delay 300ms đã kết thúc trước lúc đọc snapshot dưới tải. Thay bằng response gate giữ HTTP đang bay tới khi đọc xong; assertions về persistence/reservation/restart vẫn nguyên. Full suite sau đó **260/260**.
- Baseline live hữu hạn ba ca lỗi: **0 PASS/9 FAIL**,18 HTTP/25692 provider tokens/79135ms. Compare trả field:null/limit:10 rồi lặp; empty finals bỏ nguồn mặc dù ID đã tới model.
- Một lần chỉnh instruction chung: optional keys không dùng phải bỏ, không null; result có zero matches vẫn là query evidence cần cite. Không hard-code câu trả lời/IDs. Không chỉnh tiếp sau kết quả below.

| Kiểm chứng trên cấu hình cuối | Kết quả |
|---|---|
| Offline | **260/260 tests**, **16/16 eval notes**, **3/3 dataset demo**, **2/2 budgets**, **6/6 smoke scripted**, **8/8 rehearsal scripted** |
| Chrome fake provider | Configuration desktop/mobile/reload/approval/probe PASS:7 fake probe+8 fake run HTTP; metrics PASS:6 fake HTTP |
| Full smoke 8B repeat3 | **18/18 PASS**,45/60 HTTP,61606 provider tokens,3 repairs/0 retry,163596ms; notes/sum/compare/missing/approve/reject từng ca3 liên tiếp |
| Ba ca lỗi sau instruction | **4 PASS/2 FAIL/3 REVIEW_REQUIRED**,18/30 HTTP,27243 tokens,0 repair/retry,80599ms. rooms-empty3PASS; tickets-compare1PASS/2repeated_action; tickets-empty3REVIEW_REQUIRED |
| Ba ca dương tính hai đề | **9/9 PASS**,18/24 HTTP,27240 tokens,0 repair/retry,69076ms: tickets-count/rooms-lookup/rooms-sum từng ca3 liên tiếp |
| Live UI hai đề | **2/2 PASS**,4 HTTP/6015 provider tokens,0 repair/retry; Chrome1280/390, reload khi running giữ cùng run, một run/task, answer/source/metrics đúng, không ghi dữ liệu và không lỗi console/network |
| Warm/probe cuối | Model installed+loaded; mỗi thao tác1 HTTP/48 provider tokens/0 retry; warm787ms, probe440ms. Probe cold trước đó bị timeout được giữ, không gộp PASS |
| Server | Launcher đã chạy đúng project/configuration trên8787; health/catalog PASS, không LLM lúc startup. Sau QA chỉ dừng server do lượt này tạo; chạy lại exam:start để mở UI |
| Readiness | **FAIL** do tickets-compare chưa đạt3 liên tiếp; tickets-empty giữ REVIEW_REQUIRED. Không còn blocker owner cổng cũ |

Tickets-empty hiện trả `answer:"Empty"`, source đúng của status cancelled/limit5, unresolved rỗng. Đọc tay xác nhận query trả 0 tickets; không đạt dạng answer `Empty = yes` đã khai báo nên **không tự đổi REVIEW_REQUIRED thành PASS**. Mọi trial có evidence ở phiên cuối đều nhận source IDs đầy đủ trong messages.

Diễn tập đã làm **bởi agent**, dùng task/data có sẵn, không triển khai miền mới: 6 mốc read/map/config/start/acceptance/demo, mỗi đề acceptance scripted4/4 rồi demo UI live count/sum. Ticket **9280ms**, phòng **7993ms**; bao gồm thao tác tự động và inference, không phải thời gian sinh viên đọc đề/viết cấu hình. Agent timing vẫn cần review và `student_adaptation=NOT_RUN`. **Chưa đo thời gian đổi đề thực tế bởi sinh viên**.

Evidence ở `var/exam/`, đọc bằng `exam:report -- --id=...`:

- Offline cuối: `verification-584c0225-6515-46a8-85a7-7dcbd5b97c6e`.
- Full smoke: `smoke-f5c8a787-9a32-49a9-9b85-040b473170c2`.
- Baseline lỗi: `rehearsal-62db1fdb-1c5e-4ccc-a418-6396f1e8f72f` (stale sau instruction, giữ nguyên FAIL).
- Sau instruction: `rehearsal-560cf8f8-f593-4ecb-846b-f0b9c8fb59b2`.
- Ca dương tính: `rehearsal-788d27f5-a1e5-4bb4-aa15-6fc8d7198087`.
- UI/timing: `agent-ui-rehearsal-57133dd9-1cb6-457a-9062-3c4c2f261957`; sessions `timing-f5e526c0-b767-4653-a361-95a3cfe83f5a`, `timing-afc9003d-f16b-43c7-bb22-e3b5a0512397`.
- Warm/probe: `warm-d9665bde-ea71-4a2f-ad34-ac4a9553b025`, `probe-39d15298-8f78-458b-99b5-ce1d39353268`.
- Toàn lượt review: `review-campaign-51578acf-f3c8-49b2-988c-75a15ee439f7`, **117 HTTP/159880 provider tokens/3 repairs/0 retry**, có **1 request thiếu usage, 400 estimated reservation**; gồm baseline stale/probe timeout/UI, không che các lần lỗi. Không cloud. Readiness accounting riêng chỉ83 HTTP/116185 tokens của fresh suites/warm/probe, không gồm UI/baseline stale.

Để chốt đi thi: chỉ chọn những goal đã3PASS trên cùng cấu hình và đọc lại câu trả lời/nguồn. Compare ticket cần model/goal được kiểm chứng thêm; ticket empty cần review dạng trả lời. Sinh viên tự làm cả hai đề với timer/edit/error notes; không dùng 9 giây của agent để ước lượng thời gian bài thi. Full live eval/injection và model weights bên ngoài vẫn không được bảo đảm bởi hash.

## Đợt 1 — interface so số lượng và chốt kiểm chứng

Checkpoint code `f7bb5c9` (fixture/fingerprint), `699aa48` (tool/ticket/grader integration). `compare_counts` dùng engine cũ; xem contract và JSON shape trong [EXAM_ADAPTATION.md](../EXAM_ADAPTATION.md). Không sửa runner, grounding, approval/idempotency, budgets, repair limits hoặc timeout production. Query_dataset cũ vẫn hỗ trợ lookup/count/sum/compare; task mặc định và hai dataset mẫu cũ giữ nguyên.

Fixture persistence cũ tái hiện FAIL khi durable save bị trì hoãn 2600 ms: hết vòng polling trong lúc snapshot còn 0 request. Fixture mới có các gates request-received/save-entered/atomic-save-completed/response; chỉ release response sau khi đọc được pending snapshot. Deadline riêng fixture 20 giây lớn hơn test deadline 10 giây để không kết thúc request trước assertions; không thay production. Giữ request=1, pending reservation=1, restart interrupted, budget/unknown usage và provider không bị gọi lại.

Fingerprint hash tên+nội dung của `eval/checks.js`, cases, suite theo thứ tự ổn định; dependency khác trong src/config được runtime hash bao phủ. Grader checks không import thêm dependency ngoài cây runtime. Copy fixtures có eval/. Regression đổi grader/runtime làm stale, docs-only Git commit chỉ commit_changed. Không hash secret/var/.git/docs.

| Kiểm chứng | Kết quả thực tế |
|---|---|
| npm test | 271/271, 0 skipped |
| Eval ghi chú | 16/16, mock/backend evidence |
| Demo dataset / ngân sách | 3/3 scripted / 2/2 fake HTTP |
| Smoke / rehearsal mock | 6/6 / 8/8, 0 HTTP LLM |
| Warm local 8B | PASS, 1 HTTP, 48 provider tokens, 13222 ms |
| tickets-compare live | 3/3 liên tiếp, 6 HTTP, 13638 provider tokens, 28982 ms script |
| Browser / live các case khác | NOT_RUN trong đợt này; không thay UI |
| Thời gian sinh viên đổi đề | NOT_RUN, chưa đo thực tế |

Profile `ollama-qwen3`, name qwen3:8b, identity `7867f9fea9937415429deaebcbc1043a2aac9d7441edf08991d9c948457833bf`; output800, temperature0, JSON mode, reasoning none. Task fingerprint `69e96236ba6239d59207bf5729b83ffa965d5051003c1534eefee2de02147f47`, dataset version `369ed3dab97b530d8f965f08f5a1fb1f87907b5074b3dd30e6f8922b8c04e346`. Existing run limits12 HTTP/100000 estimated token budget/6 steps/2 repairs và model timeout120000 ms giữ nguyên; không sửa .env. Trials thật tự chọn compare_counts, chỉ gửi dataset_id/filters/compare_filters, đúng hai nhóm, nhận [2,1]/gt, cite nguồn đã trả đầy đủ; không repair/retry. Thứ tự filters có thể khác acceptance; grader kiểm tra cùng điều kiện AND và source thực của query đó. Đọc tay cả ba final thấy đúng số/quan hệ và không có nội dung bổ sung ngoài form; unresolved chỉ whitespace.

Chỉ chạy một suite live, giữ mọi trial. Warm riêng1 HTTP nên suite đặt cap11 để cả đợt không vượt12:

```powershell
npm run exam:model -- --profile=ollama-qwen3 --action=warm
npm run exam:rehearsal -- --live --profile=ollama-qwen3 --only=tickets-compare --repeat=3 --max-requests=11
```

Tổng warm+suite **7/12 HTTP, 13686 provider tokens, 42122 ms model time, 0 repairs/retries/unknown usage**. Không probe thêm, cloud hoặc tải model. PASS chỉ cho scope này, không tuyên bố model ổn định toàn bộ.

Reports giữ ở var/exam, đọc bằng `npm run exam:report -- --id=<ID>`:

- Live: `rehearsal-beeba670-a0ea-4538-949a-544a03dc5712`.
- Warm: `warm-b48b825d-9861-49a7-bb50-051876ad3585`.
- Scripted: `smoke-a8f478eb-ca9d-464c-9ade-22521e91ab7a`, `rehearsal-853c299b-b294-414d-87e7-720572aa0b45`.
- Offline verification: `verification-a0dbd684-6a7a-4a5c-b80c-391896170d10`.
- Tổng scope đợt1: `round-one-a30a21d0-2c3b-4fdd-9d9c-08e6b58422ac`; exam_readiness REVIEW_REQUIRED, other live/student/browser NOT_RUN. Báo cáo thất bại cũ không bị xóa và được nhận diện stale; docs-only checkpoint cuối không làm evidence mới stale.

Không còn blocker trong phạm vi đợt1 để bắt đầu một đợt proposal từ dataset riêng. Chưa chốt sẵn sàng đi thi: cần sinh viên tự diễn tập có timer và kiểm chứng goal định demo trên cấu hình mới. Ticket empty trước đây còn REVIEW_REQUIRED; chưa thử lại trong đợt này. Save_draft vẫn chưa nhận nguồn dataset; đề yêu cầu ghi từ bảng cần tool ghi/approval/idempotency riêng, không coi read wrapper này đã giải quyết.
