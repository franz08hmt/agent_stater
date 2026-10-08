# Kiểm chứng adaptation kit + VI/EN — 08/10/2026

**Lịch sử đợt 08/10.** Runtime mới adb6e86 và phiên live có ngân sách mới ngày 09/10 được ghi riêng trong [FREEZE_P2_VERIFICATION.md](FREEZE_P2_VERIFICATION.md); không ghép streak hoặc sửa các kết quả cũ bên dưới.

Nhánh `feature/adaptation-kit-i18n-20261008`, từ `34ec8a1`. Checkpoints `8d662ff` (kit), `dce8458` (UI), `8fcfc58` (follow-up), `bb79ede` (QA/campaign), `f4442ab`, `15cd8c0`, `e46f4b5` (runtime được thử live cuối). **Runtime cuối `d3ca6f3`** siết quyền save_draft: nhắc từ save/lưu không phải yêu cầu ghi. Bản sửa đầu dùng tokenizer retrieval làm mất `and/và/không`; regression tests bắt lỗi và đã thay bằng normalization giữ conjunction/negation, kiểm grammar mệnh lệnh hữu hạn, không thay tokenizer BM25. Test bao phủ direct/summary imperative, quoted/negated/narrative/question, và runner lookup rồi chặn approval/ghi. UI probe-loading được sửa ở `e04e0f3`. Catalog thật giữ 6 task; .env/data/run cũ không đổi, chưa push. `.agents/` và `EXAM_AGENT_CONTINUATION_HANDOFF.md` của thao tác khác giữ ngoài commit.

## Offline và Chrome thật

| Kiểm chứng | Kết quả |
|---|---|
| npm test / eval | 414/414; 16/16, không skip |
| dataset / budget / proposal demo | 3/3; 2/2; 5/5 |
| smoke / rehearsal mock | 6/6; 8/8 |
| Thiết bị scaffold tạm | 6/6, asset_code, approve/reject/replay và data unchanged |
| Chrome metrics/configuration/proposals/scaffold/Exam | PASS, fake provider/storage |
| Chrome i18n/follow-up | PASS, 1366×768/1920×1080/390/320; 15 fake HTTP (gồm 1 probe chủ động), 0 LLM thật |
| Mobile study | 66 câu, 13 chương; offline/file:///keyboard/storage lỗi/320–1920 PASS, 0 API/model/CDN |

Logs riêng: `var/adaptation-kit-20261008/`; screenshot TEMP được in trong từng log. 1366×768: Run khoảng y646–688, Approve/Reject y471–515, trong viewport. Toggle/reload không thêm model/probe/write; goal, args/hash, sources, final/history giữ nguyên. Follow-up reload chỉ GET, New run không trộn context. QA cũ chọn EN và thêm đúng một key locale vào whitelist.

Báo cáo tổng mới **adaptation-closeout-b29851c3-e9bc-4372-88a7-a735edf3bbdf** có danh sách 63 file, task/data/profile identities, counters và freshness từng evidence. Configuration identity `c43a959c87fdfce17bb1b56d641df4cb96356d647ccf38d34da06b94edcbef23`; runtime `4245e9107f24011ab9a2c5bae77fc33b1122ad202723195480ce38aff665421c`; grader `345c9229bece8f1a7025edcca81272392c711e6040e8770ce3ba1a9f451f02d1`. Docs-only commit làm commit_changed, không stale. Overall **REVIEW_REQUIRED**, technical/offline/browser PASS, fresh live NOT_RUN, student NOT_RUN. Đọc bằng:

```powershell
npm run exam:report -- --id=adaptation-closeout-b29851c3-e9bc-4372-88a7-a735edf3bbdf
```

Eval cũ ghi tên cố định `var/eval-mock.json`; các lượt đầu đã thay file đó theo hành vi cũ. Đã đổi sang `var/evaluations/eval-<mode>-<UUID>.json` với wx, không ghi đè tiếp. Readiness lịch sử nguyên trạng; kết quả cuối trước sửa được sao lưu riêng.

## Live local — không ghép candidate

Profile ollama-qwen3/qwen3:8b, giữ temperature/reasoning/output/timeouts/budgets. **48/48 HTTP**, gồm 3 warm + 3 probe và repair/retry: **83.511 input + 2.276 output = 85.787 provider tokens**, 1 repair, 0 retry, không thiếu usage. Tổng model time 180.230ms. Không cloud/download/failover.

| Runtime | HTTP | Kết quả |
|---|---:|---|
| f4442ab | 36 | 6 PASS máy (ticket approve/reject VI/EN; asset approve/insufficient), 7 REVIEW_REQUIRED. Đọc tay: follow-up EN trả VI FAIL; rút gọn copy nguyên FAIL; read EN tự thêm `$` REVIEW_REQUIRED; EN→VI dịch literal stationery FAIL. |
| 15cd8c0 | 6 | Dịch EN đúng sau bỏ goal cũ khỏi context; rút gọn vẫn copy nguyên, FAIL đọc tay. |
| e46f4b5 | 6 | Read VI 30.30/nguồn đúng; dịch EN đúng; rút gọn `Tổng giá các sản phẩm stationery là 30.30.` đúng trong một trial. Máy giữ REVIEW_REQUIRED; đọc tay PASS phạm vi này. |

Evidence đầy đủ và không sửa trial cũ:

- `verification-d2b4da9d-d6d2-4b5f-bf89-b433f199eb4e` (f4442ab).
- `verification-8b6abc60-bd1b-4a6c-bb36-fbecfa09093d` (15cd8c0).
- `verification-f981a1ef-e8e5-41f0-839f-63a69eb49bc3` (e46f4b5).

Sửa save authorization ở **d3ca6f3 làm cả ba evidence live trên stale**. Runtime cuối **live NOT_RUN / bị chặn bởi cap đã hết**, không gọi thêm HTTP để săn PASS. Docs-only commit sau runtime vẫn là commit_changed, không stale. Chưa có streak3 hoặc full ma trận/proposal fresh trên runtime cuối. Room/unknown live NOT_RUN. Giữ FAIL/BLOCKED tickets-empty/ticket-reject/E16 lịch sử; một trial ticket-reject mới không chứng minh hết lỗi hoặc injection robustness.

## Giới hạn và thao tác

Đổi miền dùng worksheet + scaffold hiện có; luật/tool mới cần code/test, không mission-only. Xem [ADAPTATION_KIT.md](ADAPTATION_KIT.md). Tool check_asset_availability và policy asset-loan dùng chung business function, query/evidence/approval/store; proposal đúng một lần và **không apply**, file gốc unchanged. Mock chung vẫn chỉ hỗ trợ ba goal dataset cũ.

Một UI locale, không answer_language selector; goal quyết định answer qua instruction. Follow-up riêng cho run terminal: 3 calls/3 HTTP/20.000 token dự phòng, timeout min(profile,30s), output min(profile,800), no retry/repair. Ngữ nghĩa read luôn REVIEW_REQUIRED; check nguồn/số/ID không chứng minh mọi câu. Xem [LANGUAGE_AND_FOLLOWUPS.md](LANGUAGE_AND_FOLLOWUPS.md).

```powershell
npm run exam:adaptation
npm run qa:i18n
npm run exam:start
node scripts/build-oral-study.js
node scripts/qa-oral-study.js
```

Live chỉ khi chủ động `npm run exam:adaptation -- --live --cap=48`; ngân sách đợt hiện tại đã hết, không gọi tiếp để săn PASS. Student adaptation **NOT_RUN**, chưa đo; thời gian script/live/agent không phải thời gian sinh viên. **Extension/backend/UI đã kiểm chứng; live readiness và diễn tập sinh viên cần chốt riêng**, chưa toàn bộ READY.
