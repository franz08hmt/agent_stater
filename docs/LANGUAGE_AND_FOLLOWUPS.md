# Ngôn ngữ giao diện và diễn đạt lại

Agent Studio có một lựa chọn **UI language: EN / VI**. Mặc định EN để giữ giao diện cũ. Preference `agent-studio.ui-locale` chỉ chứa `en` hoặc `vi`; storage lỗi fallback EN. Toggle không gọi model/probe, không sửa goal, source, arguments/hash, final hoặc budget. Tên task/dataset tự đặt, enum, ID, raw JSON và chẩn đoán provider giữ nguyên.

## Goal và câu trả lời

Không có selector ngôn ngữ trả lời hoặc trường HTTP `answer_language`. Run mới giữ `language_policy: goal-natural-v1`, một instruction backend yêu cầu trả theo ngôn ngữ tự nhiên của goal gốc; yêu cầu rõ trong goal được ưu tiên. Không thêm lượt dịch. UI EN có thể nhận goal VI, UI VI có thể nhận goal EN. IDs hoặc vài từ kỹ thuật không quyết định ngôn ngữ. Đây là instruction cho LLM, không phải bộ phân loại ngôn ngữ bảo đảm mọi paraphrase.

- `HTTP 429 có nghĩa gì?`
- `Explain HTTP 429.`
- `Giải thích HTTP 429 bằng tiếng Anh.`
- `Explain HTTP 429 in Vietnamese.`

BM25 vẫn tìm từ khóa, không embedding. Model cần đặt query theo từ khóa trong notes. Quyền ghi vẫn kiểm goal gốc, bỏ phần trích dẫn và chặn phủ định. Proposal dùng grammar `Create a proposal ...` / `Tạo đề xuất ...`; mission/data không cấp quyền.

Proposal final phải là đúng một câu tương đương outcome backend:

| Outcome | EN | VI |
|---|---|---|
| saved, applied:false | Proposal saved; changes not applied. | Đã lưu đề xuất; chưa áp dụng thay đổi. |
| not_saved | Proposal not saved. | Không lưu đề xuất. |
| unknown | Proposal outcome unknown. | Chưa xác định được kết quả lưu đề xuất. |

Run cũ thiếu language_policy vẫn dùng xác nhận proposal EN, không dịch lịch sử. Draft có các xác nhận `Saved.` / `Đã lưu bản nháp.`, `Not saved.` / `Không lưu bản nháp.`, `Draft outcome unknown.` / `Chưa xác định được kết quả lưu bản nháp.`. Backend chặn câu xác nhận hữu hạn trái outcome; các final draft tóm tắt kiến thức trước đây vẫn tương thích, văn xuôi rộng hơn cần đọc tay. UI luôn lấy write outcome từ approval/store, không từ câu model.

## Nhắn tiếp tối thiểu

Sau final mở **Rephrase this result / Diễn đạt lại kết quả này** và nhập một câu được hỗ trợ:

- `Giải thích lại bằng tiếng Việt.`
- `Nói ngắn gọn hơn bằng tiếng Việt.`
- `Translate the previous answer into English.`
- `Rephrase the previous answer in Vietnamese.`

API `POST /api/runs/:id/followups` chỉ nhận `{ "request": "..." }`; `GET` cùng URL đọc trạng thái. Cần đúng run terminal có final, task/snapshot và profile identity còn khớp. Legacy thiếu identity bị chặn. Yêu cầu nghiệp vụ mới phải tạo run mới. Không gọi tools, approval, lưu draft/proposal hoặc apply. Context chỉ gồm goal/final gốc, literals từ evidence đã trả và outcome đã xác nhận, tối đa 6.000 ký tự; không chuyển cả dataset/prompt lên browser.

Kết quả riêng trong `var/followups/<run_id>.json`, giữ nguyên final/trace/metrics/run lịch sử. Mỗi run có ngân sách follow-up riêng: tối đa **3 complete / 3 HTTP / 20.000 token dự phòng**, output tối đa 800 (không vượt profile), timeout min(profile timeout, 30 giây), **không retry hoặc repair**. Model thật đi qua gate trước HTTP; usage thiếu giữ reservation, không coi 0. Metrics trong mỗi kết quả là snapshot **tích lũy của phiên follow-up**, không cộng vào run gốc và không cộng lặp các snapshot để tính tổng.

Backend kiểm protocol, exact nguồn, numeric literals/IDs/literals đã có và finite outcome. Văn xuôi read nhận `REVIEW_REQUIRED` vì các guard không chứng minh mọi ngữ nghĩa; đọc tay trước demo. Sai số/nguồn/outcome bị FAIL, không tự sửa thành đáp án chuẩn. Restart không chạy lại inference; in-flight thành BLOCKED/interrupted, giữ request và reservation. Reload chỉ GET; New run xóa ngữ cảnh đang xem, không xóa lịch sử. Một server process cho một storage root.
