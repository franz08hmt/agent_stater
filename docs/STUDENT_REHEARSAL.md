# Diễn tập sinh viên: thiết bị phòng thí nghiệm

**Chưa đo thời gian đổi đề thực tế.** Agent/script chạy được không chứng minh sinh viên làm trong vài phút. Chỉ người làm bài tự ghi actor=student.

Đề giả: thống kê giờ thuê thiết bị theo khoa. Ba bản ghi JSON, khóa **rental_id** (không phải id): R101/Robotics/4, R102/Robotics/7, R103/Biology/3. Hours là số nguyên scale 0. Chỉ đọc; không cập nhật dữ liệu. Expected độc lập: Robotics sum = **11**; R102 lookup = đúng 1 bản ghi Robotics/7; ID missing → **0**, có nguồn của query; save_draft bị **tool_not_allowed**.

Thực hiện trong bản source **giải nén riêng** để không chiếm slot/catalog project chính:

```powershell
Copy-Item templates/rehearsal-rentals.spec.json templates/my-exam.spec.json
# Mở my-exam.spec.json: đọc và tự đối chiếu task, dataset/schema, goals và cases/expected.
npm run exam:scaffold -- --spec=templates/my-exam.spec.json --register
npm run exam:scaffold -- --spec=templates/my-exam.spec.json --apply --register
npm run exam:acceptance -- --task=exam-rentals
npm run exam:start
```

Preview không ghi/call model. Task hiện trong UI sau restart. Dataset task vẫn có notes_dir cấu hình nền, không được cấp search_notes. Scaffold sinh task/data/acceptance manifest/test driver/hướng dẫn; acceptance scripted qua runner/backend, không phải live evidence. Khi file/ID đã tồn tại, **không ghi đè**: đổi task ID và mọi output path nhất quán hoặc dùng bản sao mới.

Tự thực hiện thêm vòng thay đề: thêm R104/Biology/5, sửa acceptance khoa Biology tổng **8**, goal/expected chính xác; giữ rental_id và schema. Ghi rõ file nào sửa tay và lỗi preview/acceptance. Expected lấy từ đề, không lấy output đang test để tạo đáp án. Thiếu expected/TODO chưa được coi ready.

Ghi timer trước đọc đề bằng task có sẵn (target mới chưa đăng ký):

```powershell
npm run exam:timer begin -- --task=rehearsal-rooms --actor=student
# Thay timing-UUID dưới đây bằng timing_id vừa in ra.
npm run exam:timer mark -- --id=timing-UUID --step=read --event=start
npm run exam:timer mark -- --id=timing-UUID --step=read --event=end --note="Target: exam-rentals; đọc đề xong"
```

Sau đó ghi **start/end ngay trước/sau thao tác thật**, theo thứ tự `map`, `config`, `start`, `acceptance`, `demo`, cùng cú pháp; note ghi target task, sửa tay và lỗi. Không chạy sẵn một vòng lặp bấm hết mốc thay cho diễn tập. `show -- --id=timing-UUID` chỉ hoàn tất khi đủ 6 bước; self-recorded còn REVIEW_REQUIRED, không tự PASS.

Trong demo, chọn task mới/profile, bật Exam mode, probe chủ động khi cần. Goal `Sum hours for rentals department Robotics. Answer Robotics = <total>.`; kiểm tra query/source/metrics. Mock generic không hiểu mọi task scaffold: dùng acceptance scripted để kiểm backend hoặc chọn LLM thật; không gọi scripted PASS là live. Với phê duyệt, diễn tập riêng `templates/proposal.spec.json` trong bản sao (class_code/room_code): acceptance approve/reject/replay, UI pending/reload/outcome, original data unchanged. Proposal chỉ lưu đề xuất, không booking/áp dụng.

Bảng mapping phải tự điền: yêu cầu → dataset/cột → tool/permission → rule backend → expected → source/outcome. Nếu cần join/công thức/transition/policy mới ngoài hai policy có sẵn, phải viết code/test; không chỉ đổi mission. Xem [EXAM_ADAPTATION.md](../EXAM_ADAPTATION.md).
