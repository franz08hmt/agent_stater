# Exam mode — vận hành và bằng chứng UI

Exam mode dùng đúng form, selectors, state và API hiện có. **Standard là mặc định** để giữ cách sử dụng trước đây; bấm **Exam mode** ở header để bật/tắt. Không thêm fullscreen trong đợt này. Không tự probe, gọi model, approve hoặc chạy lại goal khi đổi mode/reload.

```text
Agent Studio + pet | Viewed task/model/status            [Exam mode]
Navigation | Configure / Goal           | Result / Execution
           | Task + model + probe state | Historical run configuration
           | Tools & data (details)     | Status / active time / requests
           | Goal + Run / Stop/New run | Approval or answer/write outcome
           | Example goals             | Sources / errors
           |                           | Tokens / raw args+hash / trace (details)
```

Trên desktop >960px Configure và Result cạnh nhau; mobile/thấp hơn xếp navigation → Configure → Result. Overview, Agent và Dialogue cùng workbench trong Exam; hash xác định nav hiện hành và heading focus khi chủ động điều hướng. Saved drafts vẫn là view riêng cho drafts/proposals; bấm Agent/Dialogue để quay lại. Standard giữ các view cũ. Visibility dùng `hidden` thực tế, không giả hiển thị panel đang bị state/ARIA ẩn.

## Thao tác demo

1. Chạy `npm run exam:start`, mở URL đã xác minh; bật Exam mode.
2. Chọn task/model, xem Mock/Live/configured/unavailable và **Enabled tools & data**. Mô tả tool/policy lấy từ registry backend, data có columns/row count/snapshot. `save_draft` vẫn notes-only; proposal không apply dataset.
3. Nếu cần kết nối LLM thật, warm local qua CLI rồi chủ động **Check model**. Trạng thái ngắn có thời điểm kiểm tra; **Connection details** có protocol/accounting/usage. Probe không chứng minh model giải đúng đề; cache chỉ tồn tại trong phiên trang.
4. Điền Goal hoặc bấm example. Run luôn nằm trước examples. Trong active run goal/select/examples bị khóa; Stop không thay cấu hình. Header/Result ghi **Viewing** metadata lịch sử, cấu hình bên trái ghi rõ locked hoặc áp dụng run tiếp theo.
5. Đọc kết quả và nguồn đầy đủ; mở **Run & token details** hoặc **Execution trace** khi vấn đáp. Reported/estimated/mixed/unavailable giữ formatter backend; không có tính token/cost mới ở browser.
6. Nếu chờ approval, đọc tool/action, subject/target/record ID, changes, reason, source/snapshot. **Exact arguments & hash** chứa raw JSON/hash đầy đủ. Approve/Reject gửi đúng decision + hash backend, không chỉnh arguments. Write outcome theo approval/store: saved — changes not applied, not saved hoặc unknown. Saved proposals ghi Not applied, không có nút Apply.

`agent-studio.ui-mode` trong localStorage chỉ chứa `standard`/`exam`; lỗi storage/giá trị sai về Standard. `agent-studio.viewed-run` giữ run_id riêng. New run không xóa mode/histories backend. Reload GET/polling đúng run; không tự approve hoặc gửi goal. Pending/running khóa theo run; terminal có thể chọn task/profile của run mới, metadata kết quả cũ vẫn riêng. Goal được phục hồi từ backend một lần, không overwritten mỗi poll. Details và focus giữ khi polling; reload mở lại details ở trạng thái mặc định đóng. Thông báo status/outcome chỉ cập nhật khi giá trị đổi.

## Kiểm chứng 2026-10-08

```powershell
npm test
npm run eval
npm run demo:datasets
npm run demo:budgets
npm run demo:proposals
npm run qa:metrics
npm run qa:configuration
npm run qa:proposals
npm run qa:scaffold
npm run qa:exam
```

Chrome/Chromium local, CDP native, profile/store tạm, provider fake/scripted; không sửa catalog thật và không quota cloud. `CHROME_PATH` chỉ cần khi browser không ở đường dẫn mặc định. QA mới lưu exact viewport screenshots/measurements/accounting tại thư mục temp được in khi kết thúc; report FAIL được lưu khi assertions lỗi. Helper QA cũ vẫn giữ default full-page capture, QA Exam yêu cầu `fullPage:false` và height chính xác.

| Nhóm | Kết quả thực tế | HTTP fake trong nhóm QA cuối |
|---|---|---:|
| Tests / note eval | 378/378, 0 skipped / 16/16 | Không tổng hợp request unit tests |
| Dataset / budget / proposal demos | 3/3 / 2/2 / 5/5 | Demos là scope riêng |
| Metrics browser | normal/budget/approval, desktop/mobile | 6 |
| Configuration browser | selections, probe variants, reload/approval/replay | 15 (7 probes + 8 run) |
| Proposal browser | approve/reject/store failure/blocked, 5 cases | 17 |
| Scaffold browser | 2 generated tasks + 8 acceptance cases | 0 |
| Exam browser | mode/layout/reload/errors/budget/proposal/unknown/keyboard | 16 (2 probes + 14 run) |

Tổng năm QA cuối: **54 fake HTTP, 0 real LLM HTTP**. Mode/reload/replay tạo **0 request model/probe bổ sung**; run đang chạy tiếp tục các lượt đã được cho phép. Đây là accounting của batch cuối, không tính thành tổng tất cả lần debug/test. Probe thiếu usage giữ unavailable; failed probe không retry. Unknown write fixture không được gắn saved.

Tại **1366×768**, scrollY=0: Goal y510–604; Run y633.5–677.5; Approve/Reject chuyển phòng y483–527. Action/changes và nút duyệt thực sự có bounding rect trong viewport. **1920×1080**, **390×844**, overflow checks **320px và 900px** đạt. Screenshot trước triển khai và sau kiểm chứng ở `var/ui-exam-20261008-c179513/` (Git ignored), cùng `exam-qa.json`/`verification.json`. Đã inspect hình đúng viewport; không dùng capture toàn trang để chứng minh fit.

QA bao phủ Notes/dataset/proposal, Mock/Live/unavailable; mode trước/trong/sau run; running/pending/completed/failed/stopped reload; New run/preference; examples/tool/data details; room approve, ticket reject, replay, unknown outcome, saved Not applied; raw args/hash/snapshot; Tab/focus/polling và console/network clean. Chỉ room proposal approve tạo 1 proposal trong fixture Exam; reject/unknown không thêm, các stores/profiles tạm được dọn sau QA. Dataset/catalog/.env thật giữ nguyên.

**Giới hạn:** không có live stability mới trong đợt UI; chưa thử screen reader thật, mọi browser/OS/zoom hay Fullscreen API. Nội dung rất dài vẫn cần cuộn trang/details; không cắt bỏ raw parameters/errors/source IDs. Chưa đo thời gian sinh viên đổi đề. Room happy/reject và repeat live để đợt chốt tổng; không gọi mock hoặc layout PASS là LLM ready. Thay static routes trong `src/app.js` thuộc runtime fingerprint, nên kiểm tra stale của reports cũ trước khi dùng làm bằng chứng live.
