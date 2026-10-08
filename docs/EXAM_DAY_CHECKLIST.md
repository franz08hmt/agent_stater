# Checklist mở máy và trình bày

Đây là checklist vận hành, không phải tuyên bố mọi đề/model đều đã READY. Kết quả candidate và giới hạn: [EXAM_CANDIDATE.md](EXAM_CANDIDATE.md). Dữ liệu mẫu là giả lập.

1. Mở đúng project. PowerShell: `Set-Location D:\New-Tech\ai-agent-starter`; `node --version` (cần >=22.12.0); `git status --short`. Giữ thay đổi local.
2. `npm run exam:start`. Script xác định root từ vị trí script, kiểm tra catalog/cổng, chờ health/catalog. Giữ terminal foreground; Ctrl+C chỉ dừng server launcher tạo. Nếu server được reuse, dừng ở terminal gốc. Server stale/owner không rõ: tự kiểm tra, không kill theo số cổng.
3. `npm run exam:model -- --profile=ollama-qwen3 --action=inspect`. Ollama/model phải cài/tải trước; lệnh không tự tải. Profile configured chưa chứng minh endpoint hoạt động.
4. Chủ động warm: `npm run exam:model -- --profile=ollama-qwen3 --action=warm`; rồi `npm run exam:model -- --profile=ollama-qwen3 --action=probe`. Mỗi thao tác tối đa 1 model HTTP, không retry, accounting riêng; warm <=60s, probe <=5s. Không gọi cloud. Probe chỉ chứng minh giao thức thử ở thời điểm đó.
5. Mở URL launcher in ra. Bật **Exam mode** trên header, chọn task và profile **Local Ollama Qwen3 8B**; xem Tools/Data/Policy trong details. Mock là mô phỏng.
6. Nhập goal của đúng task, Run. Đọc status thật, answer, đầy đủ source ID, requests/giới hạn và thời gian. Tokens chi tiết có thể provider reported/estimated/mixed/unavailable; không suy unavailable = 0.
7. Nếu có approval: đọc action, subject/target, changes, reason, nguồn/snapshot; mở raw JSON/hash khi cần. Approve hoặc Reject đúng quyết định. Proposal saved — changes not applied. Không có chức năng Apply.
8. Reload phải khôi phục run, không gửi lại goal/tự approve. Đối chiếu outcome backend/store, không tin riêng văn xuôi “saved”. New run giữ lịch sử và mode preference.

| Vấn đề | Thao tác |
| --- | --- |
| Cổng occupied/server stale | Đọc URL/identity; tự đóng đúng terminal nếu phù hợp, rồi restart. Không đổi `.env` hoặc kill ứng dụng khác tự động. |
| Ollama chưa chạy/model chưa tải/cold start | Mở Ollama; inspect. Nếu thiếu, tự tải trước buổi thi theo tên được báo. Warm chủ động rồi probe lại; không tăng probe timeout. |
| Timeout/rate limit | Giữ run/report lỗi, kiểm tra kết nối và quota. 429 không retry. Run mới chỉ khi đã hiểu nguyên nhân. |
| Arguments/citation sai | Xem trace/schema/source ID nguyên vẹn. Backend phải chặn; không thay citation đoán hoặc nới grounding/repair. |
| Request/token budget stop | Xem mã lỗi và số liệu. HTTP cap cứng; token cap dự phòng ước lượng khi usage thiếu. Thu hẹp goal/context phù hợp, không tiếp tục run vượt cap. |
| Proposal outcome unknown | Kiểm tra proposal theo approval ID/hash và reconciliation khi restart; không tuyên bố chắc “không ghi”, không tạo bản sao thay thế tùy tiện. |
| Catalog đủ 8 slot/spec hoặc expected sai | Preview trước; dùng project rehearsal riêng khi thử. Sửa schema/expected theo đề; không xóa task người dùng để lấy slot. |

Khi nhận đề, mở **`templates/my-exam.spec.json`**, **`config/catalog.json`**, task/dataset/acceptance/docs do preview liệt kê. Nếu cần nghiệp vụ mới, mở `src/tools/registry.js` hoặc `src/proposals/policies.js` và tests tương ứng; mission không tạo quyền/policy mới. Không cần sửa runner để thêm task.

Đóng băng tính năng sau kiểm chứng. Có lỗi mới thì giữ evidence, sửa tối thiểu và chạy lại nhóm ảnh hưởng trên identity mới. [Phục hồi](EXAM_RECOVERY.md), [diễn tập sinh viên](STUDENT_REHEARSAL.md).
