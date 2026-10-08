# Phiếu phân tích đề — một trang

Điền trước khi sửa code. Dữ liệu/mẫu trong project là giả lập; expected phải tự xác định từ đề, không lấy output tool làm đáp án.

| Yêu cầu | Điền theo đề |
|---|---|
| Mục tiêu; điều bắt buộc; ngoài phạm vi | |
| Input → output; file/dữ liệu được cung cấp | |
| Dataset ID; ID column; columns/type/numeric scale | |
| Tool đọc / tính toán / ghi tối thiểu | |
| Điều kiện nghiệp vụ backend phải kiểm | |
| Ghi thật hay chỉ proposal? Quyền nào được cấp? | |
| Expected độc lập: số, nhóm, record/source/snapshot | |
| Happy / empty / invalid / forbidden | |
| Nếu ghi: approval / reject / replay / lỗi store | |
| Goal demo VI/EN; model; request/token/step giới hạn | |
| Phần cần sửa tay; lỗi; thời điểm bắt đầu/kết thúc | |

**Đổi miền:** thường config/data/spec/expected. **Thêm khả năng:** code/tool/policy/tests. Mission không tự cấp quyền hoặc tạo chức năng. Booking/CRUD thật, join/công thức hoặc policy mới chưa được triển khai phải ghi rõ và viết code/test; không dùng prompt để giả lập quyền.

1. Chọn template notes / dataset-read / proposal đã có; điền spec, dữ liệu và acceptance. Mở `config/catalog.json`, task JSON, spec/dataset và manifest expected; tool/policy mới mở `src/tools/registry.js`, `config/task.config.js`, module/policy/test liên quan.
2. Preview → sửa lỗi → apply/register có chủ đích; không ghi đè file cũ. Xem [ADAPTATION_KIT.md](ADAPTATION_KIT.md) cho đường nối đăng ký.
3. Chạy acceptance scripted qua runner thật; kiểm nguồn, rules, approval/replay và data unchanged. Scripted PASS không phải LLM PASS.
4. Restart, chọn task/profile trên UI, inspect/warm/probe chủ động rồi demo; đọc trace, answer/source/metrics và outcome thật.
5. Dùng `npm run exam:timer` theo [STUDENT_REHEARSAL.md](STUDENT_REHEARSAL.md); người diễn tập mới ghi actor=student. Chưa diễn tập thật → student NOT_RUN, không lấy thời gian script/agent làm thời gian sinh viên.
