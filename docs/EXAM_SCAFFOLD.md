# Đổi đề nhanh — checklist một trang

Scaffold tạo cấu hình/dữ liệu/acceptance, không tự giải đề hoặc viết nghiệp vụ mới. Mẫu là **dữ liệu giả lập**. **Chưa đo thời gian đổi đề thực tế trên sinh viên.** [Contract chi tiết và xử lý lỗi](SCAFFOLD_CONTRACT.md).

1. **Đọc đề:** điền bảng yêu cầu → dữ liệu/cột ID → tool → luật → đáp án acceptance. Tự xác định expected, không lấy output tool làm đáp án chuẩn.
2. **Chọn mẫu:** notes (BM25, optional save_draft); dataset-read (query_dataset/compare_counts); proposal (query_dataset/create_proposal, ticket-status/class-room). Bỏ tool và write cases không cần.
3. **Điền spec trong templates/:** ID mới, mission, declarations/assets hoặc file data cũ, examples/labels/cases/expected. Mở `templates/*.spec.json`, dữ liệu và `src/proposals/policies.js` khi cần đối chiếu canonical fields. Version1, tối đa64KiB; không TODO/TBD/CHANGEME/khóa lạ. `id_column` giữ tên cột của đề. `notes_dir` bắt buộc nền, không tự cấp search_notes.
4. **Preview → apply/register:** kiểm tra file/tool/policy; mặc định không ghi/gọi LLM/đọc credentials. --apply tạo mới, --register mới bổ sung catalog. Catalog tối đa8 task, hiện6; mẫu không tự được đăng ký.
5. **Acceptance → npm test:** happy, empty và blocked; nếu write thêm approve/reject/replay. Expected sai phải FAIL; apply chưa kiểm chứng là NOT_RUN. Test sinh ở ngay tests/ được npm test chạy; runner/store thật với scripted model/temp, không phải bằng chứng LLM.
6. **Restart → demo:** Ctrl+C rồi `npm run exam:start`, reload/chọn task/model và chủ động Check model. Cold start local: `npm run exam:model -- --profile=ollama-qwen3 --action=warm`, rồi probe riêng. Mock mặc định không giải tùy ý dataset mới; live cần được kiểm chứng riêng. Chọn cấu hình mới chỉ ảnh hưởng run mới.

**Ví dụ đọc JSON:** sao chép [spec đầy đủ](../templates/dataset-read.spec.json), sửa ID/path/mission/data/expected nếu đã dùng mẫu. `item_key`, cost scale2: supply sum **15.50**; counts supply/device **2/1, gt**; lookup thiếu0; save bị chặn.

```powershell
Copy-Item templates/dataset-read.spec.json templates/my-read.spec.json
npm run exam:scaffold -- --spec=templates/my-read.spec.json --register
npm run exam:scaffold -- --spec=templates/my-read.spec.json --apply --register
npm run exam:acceptance -- --task=exam-inventory
```

**Ví dụ proposal CSV:** [spec đầy đủ](../templates/proposal.spec.json) có class_code/room_code. C1 có30 sinh viên, B202/R2 capacity60 → approve1/reject0/replay không trùng; B201/R3 capacity20 bị chặn, lookup thiếu0. Goal bắt đầu `Create a proposal ... Let the backend check capacity.`; không thêm phủ định ghi vào goal. Proposal không sửa CSV.

```powershell
Copy-Item templates/proposal.spec.json templates/my-room.spec.json
npm run exam:scaffold -- --spec=templates/my-room.spec.json --register
npm run exam:scaffold -- --spec=templates/my-room.spec.json --apply --register
npm run exam:acceptance -- --task=exam-class-proposal
npm test
npm run exam:start
```

Thay ID trong lệnh acceptance theo spec đã điền. Output: `config/<id>.task.json`, assets mới data/, `tests/<id>.acceptance.json`, `tests/<id>.generated.test.js`, `docs/<id>.md`. Task đã tạo cần sửa file/manifest bằng tay rồi kiểm chứng lại; không --force.

**Lỗi thường gặp:** sum thiếu field, filters dùng số thay vì chuỗi, scale sai, ID/path trùng, thiếu expected/coverage/role, null/khóa lạ. Exit1 acceptance FAIL; exit2 lỗi cấu hình/file/apply. Backup ở var/scaffold-backups; rollback giữ user edits và báo retained/publication. Không edit catalog trong lúc apply; lock/hard-link/atomic rename không phải transaction chống editor ngoài hoặc crash recovery tự động.

**Cần viết code + test mới:** join/group-by/formula, action/policy/field mapping mới, booking/timetable/quyền thật, cập nhật dataset gốc hoặc save_draft trích dataset. Mission không tạo chức năng này. Giữ grounding/approval/hash/idempotency/budget/repair/timeout; UI Exam mode và live stability nằm ngoài đợt này.
