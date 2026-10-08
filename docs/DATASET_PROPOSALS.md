# Proposal nội bộ từ dataset

Đợt 2 bổ sung `create_proposal`. Proposal là một bản ghi đề xuất đã được duyệt, **không phải thay đổi đã áp dụng**. Không sửa ticket/lịch/phòng gốc, không gọi dịch vụ bên ngoài. `save_draft` vẫn chỉ hỗ trợ nguồn ghi chú.

## Chạy và trình bày

```powershell
npm run exam:start
npm run demo:proposals
npm run qa:proposals
# Chỉ khi chủ động thử model local đã tải; không cloud
npm run demo:proposals -- --live --profile=ollama-qwen3 --only=ticket-approve,room-blocked --repeat=1 --max-requests=19
```

Trong **Agent**, chọn `proposal-tickets` hoặc `proposal-rooms` và profile đã cấu hình. Chọn example goal, chạy, đọc action/references/changes/reason cùng JSON/hash rồi Approve write hoặc Reject. Reload giữ run đang xem; không tự duyệt hoặc gửi lại goal. **Saved drafts → Saved proposals** hiển thị tối đa 20 proposal và nhãn Not applied. Không có nút Apply.

Mock UI không tự giải hai task này. `demo:proposals` dùng scripted model qua runner thật để chứng minh backend. Chỉ `--live` mới dùng LLM thật; suite local từ chối cloud và không tải model. Suite có 5 case: ticket approve/reject/invalid transition, room approve/insufficient capacity. Nó chủ động đóng vai người duyệt theo case để kiểm thử; model không duyệt.

## Contract tool và bằng chứng

`create_proposal`: `access: write`, `requiresApproval: true`. Root, references và changes đều từ chối trường lạ. Arguments:

```json
{
  "action": "ticket_status",
  "references": [
    {"role": "subject", "dataset_id": "tickets", "record_id": "T2", "source_id": "COPY_EXACT_LOOKUP_SOURCE"}
  ],
  "changes": {"status": "closed"},
  "reason": "User requests an internal status proposal."
}
```

Đây là hình dạng lời gọi; placeholder source phải được thay bằng ID **thực sự trả về**. Model không truyền snapshot, đường dẫn, endpoint, module, approval ID, nơi lưu hoặc công thức. Reason 3–300 ký tự; references 1–2, record ID tối đa 500; changes chỉ có trường/kiểu/enum của policy được bật.

Backend ghi `record_evidence` từ hook `query_dataset.captureEvidence` sau lookup thành công: dataset ID, snapshot version, query source ID và ID của những hàng **thực sự có trong trang trả về**. Đây là dữ liệu riêng trong run lưu trữ, không xuất qua public run API hay thêm toàn bộ bảng vào prompt. Descriptor tối đa bằng maxSteps, mỗi trang tối đa 10 hàng theo giới hạn lookup hiện có. Với 6 steps, tối đa 60 ID; không giữ bản sao đầy đủ của các hàng để cấp quyền ghi.

Reference phải khớp dataset/record/source/version của đúng run và role của policy; backend đối chiếu lại record trong snapshot. Lookup ngoài trang, aggregate count/sum/compare/compare_counts, matched_rows, ghi chú, JSON model tự dựng, source từ run khác đều không đủ bằng chứng. Schema/business rules được kiểm tra trước approval và khi duyệt; execute kiểm tra lại trước store. Không tự sửa arguments sai hay thay source bịa.

Intent ghi dùng grammar nhỏ để dễ vận hành: goal phải bắt đầu bằng `Create a proposal`, `Save a proposal`, `Tạo đề xuất` hoặc `Lưu đề xuất` (có thể thêm Please/Hãy). Text trong quotes/backticks bị loại; yêu cầu phủ định ghi bị chặn. Goal chỉ tra cứu không được tạo approval. Grammar bảo thủ, không hiểu mọi câu tự nhiên hoặc điều kiện phủ định; dùng example goals đã kiểm chứng. Không đưa câu “do not save” vào một goal muốn kiểm thử business rule: nó sẽ bị chặn ngay ở intent.

## Hai policy và cách đổi đề

| Policy code | Action / roles | Changes / luật backend |
|---|---|---|
| `ticket-status` | `ticket_status`; subject ticket | Chỉ `status: open/pending/closed`. open → pending/closed; pending → open/closed; closed terminal. Cùng trạng thái bị chặn. |
| `class-room` | `class_room`; subject class, target room | Chỉ `room` bằng tên phòng đích đã lookup. Phòng khác phòng hiện tại; capacity ≥ students và không âm. BigInt fixed-point theo scale khai báo, không giao tính toán cho LLM. |

Ticket dùng JSON 6 hàng hiện có. Class/room dùng CSV giả lập bổ sung: `proposal-classes.csv` (2 lớp), `proposal-rooms.csv` (4 phòng). c01 có 30 sinh viên ở A101; B202/R4 có 60 chỗ, B201/R3 có 20 chỗ. Không kiểm tra xung đột lịch, quyền giáo vụ hay booking thật.

Khai báo task:

```json
{
  "allowed_tools": ["query_dataset", "create_proposal"],
  "proposal_policies": [
    {"policy_id": "class-room", "datasets": {"subject": "classes", "target": "rooms"}}
  ]
}
```

Đây là phần thêm vào task đầy đủ có data/mission/examples/result labels. `proposal_policies` tùy chọn để task cũ tiếp tục chạy. Task chỉ đọc không tự có quyền ghi. Startup từ chối policy/action không đăng ký, role/mapping sai, cột thiếu/sai kiểu, ticket status không biết, tên phòng đích trùng, hoặc thiếu query_dataset/create_proposal permission.

Chỉ cần đổi config/data/catalog nếu giữ luật và canonical fields: ticket `status:string`; class `room:string, students:number`; target `room:string, capacity:number`. ID column do `id_column` của từng dataset khai báo, không bắt buộc tên `id`; scripted demo và grader đều dùng metadata `idColumn` đã xác thực của task (ví dụ ticket_id/class_code/room_code). JSON không ánh xạ tùy ý field/module/code. Cột mới, transition khác, kiểm tra lịch/quyền hoặc action mới cần sửa policy code rõ ràng tại `src/proposals/policies.js`, schema/check/bind validations và tests; thêm case vào suite, không sửa agent loop. Không tạo DSL. Task fingerprint proposal gồm bytes policy module và snapshot dữ liệu.

## Approval, lưu đúng một lần và restart

Approval giữ contract cũ: run_id + tool + canonical arguments hash; body gửi decision và args_hash. Model không tự tạo key. Chỉ khi duyệt đúng, backend ghi `var/proposals/<approval_id>.json` chứa proposal/run/task/fingerprint/hash/action, references có dataset versions, changes, reason, timestamp và `applied:false`. Key là approval_id: **một bản ghi cho mỗi approval**, không phải dedup nghiệp vụ giữa các run hoặc approval khác nhau.

Store viết temp riêng, fsync/close rồi publish bằng hard link không ghi đè. Hai writer cùng key chỉ một writer tạo file; writer còn lại đọc JSON đã hoàn chỉnh và xác minh run/hash/task fingerprint. Cần filesystem hỗ trợ hard link (đã kiểm chứng trên môi trường Windows hiện tại). Không có fallback ghi thường làm mất tính nguyên tử; lỗi store được báo, không giả thành công. Draft/store cũ giữ nguyên.

Ngay trước publication, execute dùng loader hiện có đọc có giới hạn các file task/dataset backend đã xác thực, so fingerprint với snapshot run. Khác hoặc không đọc/validate được: không lưu, approval failed/not_saved, observation nêu task_changed. Đây là kiểm tra tại thời điểm đọc, **không phải khóa giao dịch** chống người ngoài sửa file ngay sau kiểm tra. Snapshot startup không được gọi là dữ liệu mới nhất. Restart pending vẫn áp dụng task_changed/model_changed/configuration_missing: hủy pending, yêu cầu run mới, không model/write tự động.

Trước side effect, trạng thái executing/unknown được lưu vào run. Timeout/cancel trước publication dùng abort signal; nếu chưa biết có ghi hay không thì outcome unknown. Atomic publication đang bay có thể đã thành công trước timeout. Không tuyên bố chắc “không ghi” ở trường hợp đó. Restart chỉ đọc store theo approval key để reconciliation: khớp → confirmed; không có → not_saved; lỗi/mismatch → unknown. Không chạy lại model/tool. Run running bị ngắt vẫn failed/interrupted; history final cũ có thể vẫn nói unknown trong khi outcome panel đã được reconciliation xác nhận. Replay không tạo thêm file hoặc request.

Sau quyết định proposal, backend business final check yêu cầu `answer` chính xác một trong:

- `Proposal saved; changes not applied.` nếu store xác nhận.
- `Proposal not saved.` nếu reject hoặc xác nhận không ghi.
- `Proposal outcome unknown.` nếu chưa xác định side effect.

Final JSON/source grounding giữ nguyên; answer sai vẫn repair/reject trong giới hạn cũ. Đây là dạng đáp án hẹp cho demo, chưa hỗ trợ mọi cách diễn đạt đa ngôn ngữ. Khi chưa có approval (rule bị chặn), model có thể giải thích lỗi và trích nguồn lookup. UI lấy write outcome từ approval/store result, độc lập với văn xuôi final.

API bổ sung: `GET /api/proposals?limit=20` chỉ đọc, default 20, cho phép 1–50; từ chối path và query fields khác/limit trùng. Trả `{proposals,limit}`. Không API apply hay tool execution trực tiếp. Đây vẫn là ứng dụng demo local theo mô hình tin cậy hiện có, chưa có phân quyền nhiều người dùng.

## Kiểm chứng

Tests bao phủ hai workflows, intent/quyền/evidence/roles/schema/business rules, aggregate/outside-page/fake/other-run sources, approve/reject/hash/replay/concurrent/restart, dataset/config đổi, budget/stop, lỗi filesystem, timeout trước và sau publication. HTTP integration và scripted suite xác minh store/approval/source/data gốc; mutation tests chứng minh grader từ chối proposal/citation/version/action/outcome sai. Browser thật dùng fake HTTP provider, isolated storage/profile; không coi đó là bằng chứng LLM thật.

Kết quả/live accounting của đợt này được cập nhật ở cuối handoff và README. Reports riêng `proposal-suite-*` trong var/exam giữ mọi trial cùng identity/metrics. Evidence `LIVE_PROPOSAL` tách khỏi smoke/readiness ghi chú cũ; chưa được tự gộp vào nhãn demo-ready 3/3 của bộ cũ. Một trial đạt không chứng minh model ổn định; các goal live cũ stale khi runtime/config đổi phải kiểm lại trước thi.
