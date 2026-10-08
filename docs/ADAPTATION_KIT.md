# Bộ dụng cụ thích nghi đề thi

Phiếu độc lập một trang: [EXAM_REQUIREMENT_WORKSHEET.md](EXAM_REQUIREMENT_WORKSHEET.md). Hướng dẫn dưới đây giải thích các điểm mở rộng và cách kiểm chứng.

Điền bảng này trước khi sửa code. Dữ liệu mẫu là giả lập; thời gian sinh viên đổi đề **chưa đo**.

| Mục cần quyết định | Nội dung của đề (tự điền) |
|---|---|
| Mục tiêu, yêu cầu bắt buộc và ngoài phạm vi | |
| Input → output; file/dữ liệu được cung cấp | |
| Dataset ID; ID column; columns/type/numeric scale | |
| Đọc/tính toán bằng tool nào; ghi bằng tool nào | |
| Điều kiện backend phải kiểm tra | |
| Ghi thật hay proposal nội bộ; approval/reject/replay | |
| Expected độc lập (tự tính từ đề/dữ liệu) | |
| Happy / empty / invalid / forbidden | |
| Goal demo VI và EN; request/token/step giới hạn | |

**Đổi miền** với luật đã có: config/data/spec/expected. **Thêm khả năng**: module/tool/policy/code/tests. Mission không cấp quyền hoặc tạo chức năng. Scaffold hiện có là đường duy nhất tạo task; notes_dir nền vẫn bắt buộc, không đồng nghĩa có quyền search_notes.

## Đường nối khi thêm tool/policy

1. Sao chép tài nguyên `templates/development/*.template`; phần chưa điền cố ý throw/fail, không đăng ký hoặc chạy như acceptance.
2. Tool hoàn chỉnh có name/access/requiresApproval/description/schema/checkRules/execute. Schema required/optional rõ, additionalProperties:false. Chỉ dùng snapshot ID đã validate; không path/module/endpoint/code từ model.
3. Đăng ký module + factory trong `src/tools/registry.js`; loader `config/task.config.js` kiểm dependencies/cột; task allowed_tools opt-in. Factory description/schema được prompt nhận tự động. Kết quả `results[].source_id` + provenance có giới hạn; hook captureEvidence chỉ những record thực sự trả về.
4. Policy code trong `src/proposals/policies.js`: ID/action/roles/changes/check/startup validation. Dùng lại create_proposal evidence/recheck/approval/hash/store/reconciliation. Thêm dependency helper vào policyFingerprint; verifyCurrent phải nhận thay đổi helper trên đĩa.
5. Test registry → runner → observation → final và HTTP khi API liên quan. Thêm expected độc lập vào acceptance; chỉ thêm adapter grader hữu hạn cho output mới, không module JS từ spec. Đăng ký catalog sau preview/apply nếu cần, không bật quyền cho task cũ.

## Ví dụ hữu hạn: thiết bị

`src/business/assetAvailability.js` dùng decimalUnits/BigInt; `check_asset_availability` gọi lại query_dataset lookup, không sao chép lọc/provenance. Arguments `{dataset_id,record_id,quantity}`; integer 1–20. Kết quả có rows/query/snapshot/source, available/requested/eligible. Policy `asset-loan`, action `asset_loan`, subject có available:number scale0, changes chỉ quantity; tồn đủ mới hợp lệ. ID column mẫu là asset_code. Không giảm tồn kho, booking hoặc xác nhận đã mượn.

`templates/asset-loan.spec.json` có expected 3 available/2 requested/eligible true, missing, invalid, approve1/reject0/replay, quantity4 bị chặn. Test triển khai trong project/catalog/store tạm; catalog thật giữ 6 task.

Fingerprint policy có thêm business helper, nên pending run dùng policy fingerprint cũ có thể bị hủy với `task_changed` khi restart; tạo run mới dưới cấu hình đã kiểm chứng. Completed history giữ nguyên; không chạy lại model, reset metrics/budget hoặc sửa approval cũ để tiếp tục. Đây là invalidation cấu hình theo cơ chế hiện có, không migration dữ liệu.

Khi chủ động đăng ký một task mới:

```powershell
npm run exam:scaffold -- --spec=templates/asset-loan.spec.json --register
npm run exam:scaffold -- --spec=templates/asset-loan.spec.json --apply --register
npm run exam:acceptance -- --task=exam-assets
npm run exam:start
```

Không apply mẫu nếu ID/file đã tồn tại; copy spec và đổi ID/path/expected theo đề. Tools bật: query_dataset/check_asset_availability/create_proposal; policy chỉ asset-loan. Read-only có thể bỏ create_proposal/policy, dùng template dataset-read và cases tương ứng. Mẫu phát triển cần code/test trước khi dùng, không phải generator tự viết luật.

Acceptance scripted chứng minh backend/orchestration, **không** chứng minh LLM. Văn xuôi ngoài dạng chấm chắc cần REVIEW_REQUIRED. Ghi đúng outcome từ approval/store, giữ bản ghi gốc; luật lịch/booking/quyền hoặc action khác vẫn cần code và test.
