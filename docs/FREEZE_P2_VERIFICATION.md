# Chốt ba P2 — 09/10/2026

Runtime `adb6e86`, nhánh `feature/adaptation-kit-i18n-20261008`, từ checkout `ee3a336`. Chỉ sửa quyền ghi và CLI kiểm chứng; không thêm nghiệp vụ, dependency, UI hoặc tăng timeout/repair. Catalog 6 task, dữ liệu gốc, .env và lịch sử nguyên trạng; không push. Các file untracked của người dùng giữ ngoài commit.

## Ba lỗi và regression

1. save_draft nhận tiền tố động từ/summary mà chưa loại câu hỏi, định nghĩa hoặc mô tả hành vi người khác. create_proposal cũng chỉ nhận tiền tố. Nay chặn dấu hỏi ngoài phần trích dẫn, dấu hiệu định nghĩa VI/EN và câu summary mang tính giải thích hành vi. `Lưu bản nháp là gì?`, `Summarize why users read and save drafts.`, `Tạo đề xuất là gì?` cùng các biến thể không dấu hỏi được runner kiểm sau lookup: **0 approval, 0 write**. Lệnh mệnh lệnh hợp lệ, nguồn/record/snapshot/hash/approval/replay vẫn giữ. Grammar hữu hạn và bảo thủ, không bộ hiểu ngữ nghĩa bảo đảm mọi câu; yêu cầu ghi nên là mệnh lệnh rõ, không câu hỏi lịch sự.
2. CLI tạo thư mục UUID trước khi thư mục cha tồn tại. Nay mkdir cha recursive, thư mục artifact UUID mới vẫn tạo exclusive; report dùng wx. Test sao chép source **không có var**, chạy hai lần và kiểm báo cáo đầu không đổi.
3. CLI catch mọi lỗi thành BLOCKED và không đặt exit code. Nay acceptance/ERR_ASSERTION sai là FAIL; thiếu điều kiện chuẩn bị vẫn BLOCKED; verdict gồm checks và results, giữ offline.json/report đầy đủ. Expected availability sửa độc lập `3` → `12` phải FAIL/exit1, không phải PASS hoặc BLOCKED.

Contract CLI: **PASS → 0; FAIL → 1; BLOCKED / REVIEW_REQUIRED / NOT_RUN → 2**. Luôn in `Verdict: ...` và nơi evidence cho phiên đã khởi tạo. Không có report/verdict giả khi Node/config chưa nạp được; lỗi startup vẫn nonzero. Artifact không overwrite, không gọi LLM trong mặc định offline.

## Kiểm chứng hiện tại

| Nhóm | Kết quả |
|---|---|
| npm test / eval offline | 423/423; 16/16 PASS, không skip |
| dataset / budget / proposal demos | 3/3; 2/2; 5/5 PASS |
| smoke / rehearsal mock | 6/6; 8/8 PASS |
| Asset acceptance tạm | 6/6 PASS |
| Chrome i18n/proposals/scaffold | PASS; không LLM thật, không lỗi console |
| Agent rehearsal | PASS: 2 task tạm, 8 acceptance, UI/approval/reject/replay/reload, 1 proposal/0 reject proposal, dữ liệu unchanged |
| Mobile study | Rebuild nguồn; chạy QA offline/browser riêng, giữ 66 stable IDs |

Logs mới: `var/freeze-p2-20261009/`, gồm RED trước sửa, GREEN, toàn bộ regressions/browser và live. Diễn tập `agent-rehearsal-cfd6ed06-a620-4de0-88a3-51fed54711ce`: actor=agent, **7.685 ms (~7,7 giây) script**, 0 model HTTP. Không phải thời gian sinh viên hoặc toàn thời gian agent sửa code. Student adaptation **NOT_RUN**.

## Live mới có cap riêng

`freeze-live-session-2e8f2737-dcc4-4a6e-9bf9-1bbf459b37e7`, đúng runtime/profile hiện tại `ollama-qwen3` / `qwen3:8b`. Driver kiểm chứng riêng có checksum trong report, tái sử dụng campaignGroup và graders hiện có; không đổi task hoặc model settings. Cap mới **20 HTTP**, độc lập với lịch sử 48 đã hết. Bao gồm warm1/probe1, retry/repair; gate trước HTTP/retry, chạy tuần tự, không cloud/download/failover.

| Goal/case | Trial | Verdict và đọc tay |
|---|---:|---|
| sum price stationery | 3 | PASS liên tiếp; 30.30, query/snapshot/source thật đúng, 0 write |
| notes → save_draft approve/replay | 3 | PASS liên tiếp; nội dung 401/403 khớp notes, Saved. khớp store; 1 draft mỗi trial, replay true |
| ticket-approve | 1 | BLOCKED: lookup/record/source/policy/hash/approval đúng, 1 proposal saved/applied:false/replay true. Model trả `Proposal saved: Proposal saved; changes not applied.` trái finite final contract; backend từ chối. Repair kế tiếp bị chặn trước HTTP khi hết cap, final=null. Không chấm PASS. |

Tổng **20/20 HTTP**, **21 model_calls** (gồm complete bị gate chặn trước HTTP), **32.129 input + 941 output = 33.070 provider tokens**, **1 repair, 0 retry**, usage thiếu/sai/pending = 0. Model time **85.910ms**. Không thêm inference sau cap. Không dùng trial BLOCKED làm bằng chứng proposal live ổn định.

Các goal đủ ba PASS cho demo hẹp, dùng đúng task/profile và câu dưới đây:

- Task datasets-demo: `Tính tổng price của sản phẩm category stationery trong products (không nhân stock). Chỉ viết answer theo dạng: stationery = <tổng>.`
- Task study-notes: `Summarize HTTP 401 and 403 from the notes and save a draft. After the human decision, answer exactly Saved. if saved or Not saved. if rejected.` Duyệt đúng arguments/hash; draft content lấy đoạn notes VI, final xác nhận EN.

Không có live mới cho reject/room/empty/follow-up/E16. Giữ failures lịch sử tickets-empty/ticket-reject/E16 và lỗi ngôn ngữ trước đó. Hai goal đạt không chứng minh mọi goal, ngôn ngữ hoặc đề chưa biết.

## Evidence và thao tác

Closeout **freeze-p-two-closeout-e3f0f186-dd29-43f9-a384-0bd8f97c285e**, overall **REVIEW_REQUIRED**: technical/offline/browser PASS; live session BLOCKED ở ticket; student NOT_RUN. Identity config `d128825010d1dd4e37b2945b0c1c872ca591c33088bb109bf4cfcfc38a624509`, runtime `a67556c354528275f4861865e80fff87973d8687bb70414907733ae868091cdd`, grader `c8a5d59d0bb80bb563be83f27a9b0d15a51587e0fb3290d226cb971e3e177767`.

Evidence trước sửa stale; báo cáo live/agent rehearsal mới cùng identity. Docs-only checkpoint sau runtime chỉ commit_changed, không stale. Không sửa lịch sử PASS/FAIL/BLOCKED cũ. ZIP source cũ vẫn là artifact lịch sử, không chứa ba fixes mới.

```powershell
npm run exam:adaptation
npm run exam:report -- --id=freeze-p-two-closeout-e3f0f186-dd29-43f9-a384-0bd8f97c285e
npm run exam:start
```

Khởi động lại server của chính project bằng Ctrl+C nếu còn process chạy code cũ; không kill ứng dụng khác. Có thể đóng băng phần nền tảng sau ba fixes; chưa gọi toàn bộ live READY. Sinh viên cần tự làm [phiếu đề](EXAM_REQUIREMENT_WORKSHEET.md) và [diễn tập/timer](STUDENT_REHEARSAL.md); không lấy khoảng 7,7 giây script làm thời gian đổi đề.
