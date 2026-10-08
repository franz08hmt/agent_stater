# Đóng gói và phục hồi offline

Từ candidate đã commit, PowerShell:

```powershell
Set-Location D:\New-Tech\ai-agent-starter
npm run exam:package
npm run exam:restore-check -- --id=exam-source-UUID-được-in-ra
```

Thay toàn bộ `exam-source-UUID-được-in-ra` bằng ID thực. Package CLI hiện dùng PowerShell/.NET có sẵn trên Windows; runtime dùng Node >=22.12.0. Không cài package/framework mới.

Mỗi lượt tạo `var/packages/exam-source-<UUID>/ai-agent-starter.zip`, `artifact-manifest.json` và source staging riêng; không overwrite artifact cũ. Trong ZIP có `PACKAGE_MANIFEST.json`: commit, identity, Node requirement và SHA256/tổng byte của từng file. Manifest không tự hash chính nó; manifest và ZIP được hash trong artifact manifest bên ngoài. Giữ cả ZIP và artifact manifest khi sao lưu.

Include source/config/dữ liệu giả lập/tests/templates/eval/docs/scripts/UI và licenses font/icon local, `.env.example`. Exclude `.env` thật, `.git`, `.agents`, `var`/history/browser profiles/screenshots tạm/model weights và node_modules. Credential đã cấu hình xuất hiện trong file include thì từ chối; đây không thay thế việc đọc lại source trước khi chia sẻ. Thư mục/file link bị từ chối. Không đưa config local bí mật vào task hoặc source.

Restore check xác minh SHA256 ZIP/manifest, giải nén vào thư mục tạm riêng, kiểm tra mọi file, rồi chạy **code của bản giải nén**: Node requirement, HTTP health/catalog/static assets, workflow read có nguồn, proposal approve/replay đúng một lần và nguyên trạng dataset. Dùng mock/scripted backend, 0 model HTTP, không npm install/Internet. Hard-link atomic publication phải hoạt động; không đổi thành ghi không nguyên tử nếu filesystem thiếu hỗ trợ. Test không chứng minh LLM thật, screen reader hoặc mọi filesystem.

Để phục hồi khi thi:

1. Giữ project/run data/local config hiện tại riêng; không `reset --hard`, xóa `var`, hoặc checkout branch khác để phục hồi vội.
2. Kiểm tra `Get-FileHash -Algorithm SHA256 .\ai-agent-starter.zip` khớp artifact manifest. Giải nén vào **thư mục mới**, không phủ lên workspace đang có thay đổi.
3. Cài sẵn Node phù hợp. Chép `.env.example` thành `.env` trong **bản mới** chỉ nếu chưa có local config; tự nhập cấu hình local cần thiết. Không dùng credentials trong artifact.
4. Bắt đầu mock bằng `$env:MODEL_PROVIDER='mock'` và `npm run exam:start`; chọn profile Mock rõ ràng. Kiểm tra root/cổng/catalog và read/proposal. Script xác định root theo vị trí của nó.
5. Khi cần LLM local, Ollama và đúng model phải được cài/tải riêng trước; inspect/warm/probe chủ động. Bản ZIP không chứa model weights. Gỡ env override mock của terminal nếu muốn profile env dùng local thật; hoặc chọn profile `ollama-qwen3` rõ ràng.
6. Lịch sử không có trong source bundle. Nếu cần dữ liệu run cũ, giữ backup riêng và đối chiếu task/model identity, reconciliation; không tự chạy lại model hoặc approval. Không hứa một lệnh sẽ khôi phục mọi dữ liệu người dùng.

Report cũ phải đọc bằng `npm run exam:report -- --id=<report-id>` trong đúng project. Config/runtime/grader đổi → stale; commit chỉ docs có thể commit_changed nhưng không stale. Artifact không chứa history/report runtime; báo cáo kiểm chứng của phiên hiện tại nằm riêng trong `var/exam`.
