# Scaffold v1: contract và quyết định triển khai

CLI nhỏ, backend-owned, Node built-ins; không wizard/framework/HTTP editor. Dùng schema/loader/task fingerprint/registry/policies sẵn có thay vì tạo một cấu hình task thứ hai. Preview dùng overlay nội bộ `Map<relative file, UTF-8 content>`; HTTP/task JSON không thể bật overlay. Sau publish load lại file thật và đối chiếu fingerprint.

## Spec và quyền

Root chỉ gồm `version: 1`, `template: notes|dataset-read|proposal`, `task`, `assets`, `cases`; tất cả bắt buộc, trường lạ bị từ chối. `task` giữ nguyên schema `config/task.config.js`: ID/title/mission/data/allowed_tools/sample_inputs/result_labels và optional proposal_policies. Scaffold giới hạn ID 40 ký tự ASCII slug; tên Windows reserved/traversal/link/junction bị từ chối. Assets tối đa 8, content 32.000 ký tự mỗi file, toàn spec 64 KiB. Asset phải là dataset được khai báo hoặc `.md` trực tiếp trong notes_dir. Dữ liệu hiện có chỉ tham chiếu dưới data; không copy `.env`, secret/model settings hay module từ spec.

| Template | Allow-list được chọn | Điều kiện |
|---|---|---|
| notes | search_notes, tùy chọn save_draft | Không dataset/policy; write cần approve/reject cases |
| dataset-read | query_dataset và/hoặc compare_counts | Ít nhất một dataset; không write/policy |
| proposal | query_dataset + create_proposal | Đúng một policy đã đăng ký, chính xác role mapping |

Ví dụ mapping ticket: `proposal_policies: [{"policy_id":"ticket-status","datasets":{"subject":"tickets"}}]`; dataset cần status:string và id_column tùy tên. Status open/pending/closed theo luật backend. Phòng: `[{"policy_id":"class-room","datasets":{"subject":"classes","target":"rooms"}}]`; classes cần room:string/students:number, rooms cần room:string/capacity:number. ID columns độc lập. Không field mapping hoặc policy executable từ spec. Goal examples và proposal acceptance cần positive imperative được `proposalRequested` chấp nhận.

## Acceptance manifest và driver

Manifest `{version:1, task_id, cases}`; 3–10 cases, ID duy nhất. Các trường không thuộc kind bị từ chối; không TODO hoặc expected tự sinh. Template samples trong `templates/*.spec.json` là ví dụ JSON hoàn chỉnh có đáp án giả lập cố định.

| kind | Trường ngoài id/kind/goal | expected |
|---|---|---|
| read / empty notes | tool, args, answer; empty thêm unresolved | result_count, sources; happy thêm contains |
| read / empty dataset | tool, args, answer | matched_count và record_ids khi lookup; value (chuỗi decimal) khi count/sum; compared_count/values (2 chuỗi có thứ tự)/relation khi compare |
| blocked | tool, args | code: tool_not_allowed/invalid_arguments/rule_violation; optional error_contains |
| draft | args (search), draft {title,content}, decision | drafts: 1 approve hoặc 0 reject; sources |
| proposal | action, references [{role,dataset_id,record_id}], changes, decision | proposals: 0/1; outcome: saved/not_saved/blocked; blocked cần error_contains |

References acceptance không có source_id tự viết: scripted model lấy **source thật** từ observation lookup. Đây là orchestration test của model mô phỏng; backend vẫn kiểm tra record/page/run/version/hash/policy và store thật. Count/sum không được cấp evidence ghi. Runner/model production không sửa arguments hoặc citation hộ model.

Coverage bắt buộc happy + empty/missing + blocked; proposal và notes có save_draft thêm approve/reject/replay. Empty dataset vẫn trích nguồn query 0 matches; empty notes không có nguồn và cần unresolved. Preview kiểm tra schema/rules của lời gọi, mapping/coverage; **không thực thi tool để tạo expected**. Acceptance kiểm chứng kết quả so expected được khai báo, query/snapshot/ID column/source được trích, approval/tool/store, replay và unchanged dataset/config. Proposal grader tái sử dụng `gradeProposal`, không viết thuật toán policy mới.

`tests/<id>.generated.test.js` ở top-level được `node --test tests/*.test.js` phát hiện; import driver `src/scaffold/acceptance.js`. Store và run thật dùng temp riêng cho từng case; mọi case chạy và giữ verdict. Report PASS/FAIL/BLOCKED/REVIEW_REQUIRED/NOT_RUN, task fingerprint + dataset versions/ID columns, metrics per case, provider_requests, script elapsed và student_timing NOT_RUN. Không có live/model inference HTTP; usage mock không biến thành provider-reported 0.

Offline driver dùng limits cố định: 6 steps, 2 repairs, 1.800 observation chars, 14.000 context chars, 12 provider requests, 100.000 estimated token budget, model timeout 2 giây cho scripted. Đây không thay đổi .env/limits của run UI thật và không chứng minh cấu hình quota live cụ thể. Final text của read case do người viết spec cung cấp cho scripted model; PASS kiểm tra backend/evidence, không đánh giá khả năng model thật diễn đạt/giải đề. Probe/live phải kiểm chứng riêng.

## Publication và tương thích

Preview mặc định chỉ đọc; CLI root lấy từ script, không từ cwd. Có thể chạy từ PowerShell bất kỳ bằng `node D:\New-Tech\ai-agent-starter\scripts\exam-scaffold.js --spec=templates/my-read.spec.json`. Spec JSON local nằm trong project templates. `npm --prefix D:\New-Tech\ai-agent-starter run exam:scaffold -- --spec=templates/my-read.spec.json` là cách tương đương.

Apply chỉ tạo file mới config/data/tests/docs. ID/output tồn tại bị từ chối; không có --force/update. Đổi task đã tạo bằng sửa file/task/manifest có chủ đích rồi kiểm chứng lại; restart áp dụng cơ chế task_changed/model_changed/configuration_missing hiện có, pending không tự resume dưới snapshot khác.

Register chỉ khi --register; --register không kèm --apply vẫn là preview. Validate prospective catalog bằng loader, giữ nguyên model_profiles/defaults/entries cũ; không đọc credential environment, không probe profile. Chặn catalog >8 tasks/24 KiB; task >16 KiB/dataset >128 KiB/200 rows vẫn theo loader. Preview/apply chưa kiểm chứng runtime profile có key hay model endpoint phản hồi: UI/startup/probe xử lý riêng.

Catalog dùng cooperative lock `config/scaffold-register.lock`, hash/inode check và atomic rename; backup UUID trong var/scaffold-backups, Gitignored. Không promise transaction với editor ngoài hay power-loss recovery tự động. Rollback chỉ file mới còn nguyên inode/hash; ghi chẩn đoán trạng thái publish và retained files. Không rollback task files khi catalog đã publish hoặc publication chưa rõ. Không sửa/xóa file có sẵn, catalog người khác hoặc thư mục rộng.

Test bằng project copy không chứa .env/var/.git, storage/browser profile tạm; QA spec→preview→apply/register→load catalog→acceptance→UI. UI và API không đổi. Mock mặc định có phạm vi dataset cũ; fixture QA dùng scripted model riêng, không phải live proof.
