// UI-owned strings only. Never pass goal/answer/data/model names/raw diagnostics
// to this dictionary. English phrases are stable keys; values are static Vietnamese.
export const VI = Object.freeze({
  'Search allowed notes using BM25 keywords.': 'Tra cứu ghi chú được phép bằng từ khóa BM25.',
  'Lookup, filter, count, sum and compare allowed dataset snapshots.': 'Tra cứu, lọc, đếm, cộng và so sánh snapshot bảng được phép.',
  'Compare record counts of two groups in one dataset.': 'So sánh số lượng bản ghi của hai nhóm trong cùng dataset.',
  'Save a draft from note sources after approval.': 'Lưu bản nháp từ nguồn ghi chú sau phê duyệt.',
  'Save an internal proposal after approval; changes are not applied.': 'Lưu đề xuất nội bộ sau phê duyệt; chưa áp dụng thay đổi.',
  'Check available equipment quantity; no actual loan or booking.': 'Kiểm tra số lượng thiết bị khả dụng; không cho mượn hoặc đặt chỗ thật.',
  'Rephrase this result': 'Diễn đạt lại kết quả này', 'Rephrase request': 'Yêu cầu diễn đạt lại', 'Rephrase': 'Diễn đạt lại', 'Rephrasing…': 'Đang diễn đạt lại…',
  'Translate the previous answer into English.': 'Giải thích lại bằng tiếng Việt.',
  'This result only; no tools or new business work. Separate budget: 3 calls per run.': 'Chỉ kết quả này; không gọi tool hoặc làm nghiệp vụ mới. Ngân sách riêng: 3 lượt mỗi run.',
  'Separate follow-up session': 'Phiên diễn đạt lại riêng', 'Read manually: numeric/source checks do not verify every prose claim.': 'Cần đọc tay: kiểm số/nguồn không xác minh mọi phát biểu trong văn xuôi.',
  'Source {id}': 'Nguồn {id}', 'UI language': 'Ngôn ngữ giao diện',
  'Skip to agent workspace': 'Đến khu làm việc của agent', 'Exam mode': 'Chế độ thi', 'Standard': 'Tiêu chuẩn', 'Exam': 'Thi',
  'Creation': 'Tạo agent', 'Easily Create': 'Dễ dàng tạo', 'Complex Agent': 'Agent đa bước', 'Configure. Run. Inspect.': 'Cấu hình. Chạy. Kiểm tra.',
  'Workspace highlights': 'Điểm nổi bật', 'Simplified concepts': 'Khái niệm đơn giản', 'Goals, knowledge, tools, results.': 'Mục tiêu, kiến thức, công cụ, kết quả.',
  'Real-time debugging': 'Theo dõi trực tiếp', 'Inspect decisions and approvals.': 'Kiểm tra quyết định và phê duyệt.',
  'AI agent workspace': 'Khu làm việc AI agent', 'Workspace navigation': 'Điều hướng khu làm việc', 'Agent Studio home': 'Trang chính Agent Studio',
  'Workspace': 'Khu làm việc', 'Overview': 'Tổng quan', 'Agent': 'Agent', 'Dialogue': 'Hội thoại', 'Saved drafts': 'Bản nháp đã lưu', 'Local-first': 'Ưu tiên cục bộ',
  'Agent profile': 'Hồ sơ agent', 'Robotic cat agent avatar': 'Ảnh đại diện robot mèo', 'Model': 'Model', 'Knowledge': 'Dữ liệu', 'Retrieval': 'Truy xuất',
  'Write policy': 'Quy tắc ghi', 'Checking model…': 'Đang kiểm tra model…', 'Loading…': 'Đang tải…', 'Checking…': 'Đang kiểm tra…',
  'No drafts yet.': 'Chưa có bản nháp.', 'No drafts yet. ': 'Chưa có bản nháp. ', 'Open Agent': 'Mở Agent', ' to create one.': ' để tạo bản nháp.',
  'Saved proposals': 'Đề xuất đã lưu', 'Internal records only. Changes are not applied.': 'Chỉ là đề xuất nội bộ. Chưa áp dụng thay đổi.', 'No proposals yet.': 'Chưa có đề xuất.',
  '01 / Configure': '01 / Cấu hình', 'Define the agent goal': 'Nhập mục tiêu cho agent', 'Run configuration': 'Cấu hình lượt chạy', 'Task': 'Nhiệm vụ', 'Model profile': 'Hồ sơ model',
  'Loading tasks…': 'Đang tải nhiệm vụ…', 'Loading models…': 'Đang tải model…', 'Loading backend configuration…': 'Đang tải cấu hình backend…', 'Model connectivity check': 'Kiểm tra kết nối model',
  'Check model': 'Kiểm tra model', 'Connection details': 'Chi tiết kết nối', 'Enabled tools & data': 'Công cụ và dữ liệu được bật', 'Tools': 'Công cụ', 'Allowed data': 'Dữ liệu được phép',
  'Data is untrusted. save_draft supports note sources only; dataset citations cannot be saved yet.': 'Dữ liệu không phải chỉ dẫn. save_draft chỉ hỗ trợ nguồn ghi chú; chưa lưu bản nháp từ nguồn bảng.',
  'Goal': 'Mục tiêu', 'Describe a task for this agent.': 'Mô tả nhiệm vụ cho agent.', ' / 500 characters': ' / 500 ký tự', 'Run agent': 'Chạy agent', 'Stop run': 'Dừng lượt chạy', 'New run': 'Lượt chạy mới',
  'Try a course scenario': 'Thử tình huống mẫu', 'Example goals': 'Mục tiêu mẫu', 'Write approval': 'Phê duyệt ghi', 'Every write tool requires human approval.': 'Mọi công cụ ghi đều cần người phê duyệt.',
  '02 / Observe': '02 / Theo dõi', 'Dialogue & execution': 'Hội thoại và thực thi', 'Agent conversation': 'Hội thoại agent', 'No run yet': 'Chưa có lượt chạy', 'Current run': 'Lượt chạy đang xem',
  'Status': 'Trạng thái', 'Active time': 'Thời gian hoạt động', 'Provider requests': 'Request tới provider', 'Write approval required': 'Cần phê duyệt ghi', 'Tool: ': 'Công cụ: ', '. Review the exact arguments.': '. Hãy kiểm tra tham số chính xác.',
  'Approve write': 'Phê duyệt ghi', 'Reject': 'Từ chối', 'Exact arguments & hash': 'Tham số và hash đầy đủ', 'Argument hash: ': 'Hash tham số: ', 'Answer': 'Câu trả lời', 'Sources': 'Nguồn', 'Unresolved': 'Chưa xác định',
  'Run & token details': 'Chi tiết lượt chạy và token', 'Steps': 'Bước', 'Model activity': 'Hoạt động model', 'Run timing': 'Thời gian lượt chạy', 'Tokens': 'Token', 'Token breakdown': 'Chi tiết token', 'Run ID': 'Run ID',
  'Execution trace': 'Nhật ký thực thi', 'Model decisions, tool calls, approvals, and execution results': 'Quyết định model, lời gọi công cụ, phê duyệt và kết quả thực thi', 'Step': 'Bước', 'Type': 'Loại', 'Tool': 'Công cụ', 'Arguments': 'Tham số', 'Result': 'Kết quả',
  'Running': 'Đang chạy', 'Awaiting approval': 'Chờ phê duyệt', 'Completed': 'Hoàn tất', 'Failed': 'Thất bại', 'Stopped': 'Đã dừng', 'Unavailable': 'Không có dữ liệu', 'unavailable': 'không có dữ liệu',
  'Mock': 'Mô phỏng', 'Live': 'Model thật', 'configured': 'đã cấu hình', 'Read-only': 'Chỉ đọc', 'approval required': 'cần phê duyệt', 'write tool(s), approval required': 'công cụ ghi, cần phê duyệt', 'note sources': 'nguồn ghi chú', 'datasets': 'bảng dữ liệu',
  'Selections locked for this active run. ': 'Cấu hình bị khóa cho lượt chạy này. ', 'Applies to the next run. ': 'Áp dụng cho lượt chạy mới. ', 'Backend configured; model ': 'Backend đã cấu hình; model ', 'configuration valid': 'cấu hình hợp lệ',
  'Connection: not checked. A probe sends at most one request.': 'Chưa kiểm tra kết nối. Mỗi lần kiểm tra gửi tối đa một request.', 'usage unavailable': 'không có dữ liệu usage', 'provider tokens': 'token provider báo',
  'Mock simulation; no real LLM connection checked': 'Mô phỏng; chưa kiểm tra kết nối LLM thật', 'Endpoint responded; probe JSON protocol valid': 'Endpoint phản hồi; giao thức JSON thử hợp lệ',
  'This does not guarantee task answers.': 'Không bảo đảm câu trả lời nghiệp vụ đúng.', 'HTTP request(s)': 'HTTP request', 'Checked': 'Đã kiểm tra lúc', 'Allowed note sources': 'Nguồn ghi chú được phép', 'showing': 'hiển thị', 'of': 'trên', 'passages': 'đoạn',
  'records': 'bản ghi', 'snapshot': 'snapshot', 'decimals': 'chữ số thập phân', 'No data sources enabled.': 'Chưa bật nguồn dữ liệu.', 'Model unavailable': 'Model không khả dụng', 'Connection not checked': 'Chưa kiểm tra kết nối', 'Mock simulation': 'Mô phỏng', 'Probe protocol valid': 'Giao thức thử hợp lệ', 'Probe unavailable': 'Không kiểm tra được model',
  'Changes': 'Thay đổi đề xuất', 'Reason': 'Lý do', 'Action': 'Hành động', 'Subject': 'Bản ghi chính', 'Target': 'Bản ghi đích', 'Not applied': 'Chưa áp dụng', 'Internal proposal only; changes are not applied.': 'Chỉ là đề xuất nội bộ; chưa áp dụng thay đổi.',
  'This run': 'Lượt chạy này', 'Legacy task': 'Nhiệm vụ cũ', 'Legacy model': 'Model cũ', 'Legacy profile': 'Hồ sơ cũ', 'Model not recorded': 'Chưa ghi nhận model', 'Viewing': 'Đang xem', 'Next run': 'Lượt chạy mới',
  'No source cited — read the unresolved explanation.': 'Không trích nguồn — xem giải thích phần chưa xác định.', 'Backend unavailable': 'Backend không khả dụng', 'Proposals unavailable': 'Không đọc được đề xuất',
  'Draft saved.': 'Đã lưu bản nháp.', 'Draft not saved — approval rejected.': 'Không lưu bản nháp — phê duyệt bị từ chối.', 'Draft not saved — write failed.': 'Không lưu bản nháp — ghi thất bại.', 'Draft not saved — run stopped.': 'Không lưu bản nháp — lượt chạy đã dừng.',
  'Proposal saved. Changes not applied.': 'Đã lưu đề xuất. Chưa áp dụng thay đổi.', 'Proposal not saved.': 'Không lưu đề xuất.', 'Proposal outcome unknown. Check saved proposals or reconcile after restart.': 'Chưa xác định kết quả lưu đề xuất. Kiểm tra danh sách hoặc đối soát sau restart.',
  'Unavailable — not collected': 'Không có dữ liệu — chưa thu thập', 'This saved run predates metrics collection.': 'Lượt chạy cũ chưa có cơ chế thu thập số liệu.',
  'provider reported': 'provider báo', 'estimated / reserved': 'ước lượng / dự phòng', 'mixed': 'hỗn hợp', 'budget': 'ngân sách', 'Mock, no HTTP': 'Mô phỏng, không HTTP', 'Provider reported input': 'Input provider báo', 'output': 'output', 'calls': 'lượt gọi', 'repairs': 'lượt sửa', 'retries': 'lượt gửi lại', 'waiting': 'chờ duyệt', 'total': 'tổng',
  'Mock token reservations are simulated. ': 'Dự phòng token mock là mô phỏng. ', 'Token budget uses estimates when usage is missing; billed tokens may differ.': 'Ngân sách dùng ước lượng khi thiếu usage; token tính phí có thể khác.', ' Timing was interrupted by restart.': ' Đo thời gian bị gián đoạn do restart.',
  'Saved run ID is invalid. You can start a new run.': 'Run ID đã lưu không hợp lệ. Có thể tạo lượt chạy mới.', 'Could not restore the viewed run': 'Không khôi phục được lượt chạy đang xem', 'You can start a new run.': 'Có thể tạo lượt chạy mới.',
  'Retrieved chunks': 'Đoạn đã truy xuất', 'Print retrieved chunks': 'In các đoạn đã truy xuất', 'Retrieved chunks unavailable': 'Không đọc được các đoạn đã truy xuất',
  'No chunk was retrieved in this run.': 'Lượt chạy này chưa truy xuất được đoạn nào.', 'Search': 'Lần tìm', 'Index': 'Chỉ mục', 'chunk(s) given to the model': 'đoạn đã đưa cho model',
  'weaker match(es) dropped by the size budget': 'kết quả yếu hơn bị bỏ do giới hạn kích thước', 'rank': 'hạng', 'cosine': 'cosine', 'chunk': 'đoạn', 'chars': 'ký tự', 'cited in the answer': 'được trích trong câu trả lời',
  'Semantic match': 'Khớp ngữ nghĩa', 'Required context': 'Ngữ cảnh bắt buộc', 'Semantic match + required context': 'Khớp ngữ nghĩa + ngữ cảnh bắt buộc',
  'Embedding requests': 'Request embedding', 'embedding HTTP request(s)': 'HTTP request embedding', 'input tokens': 'token đầu vào', 'input tokens unavailable': 'không có dữ liệu token đầu vào', 'failed': 'thất bại',
  'Embedding model': 'Model embedding', 'Cited sources': 'Nguồn được trích', 'none': 'không có', 'Vector index': 'Chỉ mục vector', 'KB chunks': 'đoạn KB', 'ready': 'sẵn sàng', 'dimensions': 'chiều',
  'sections': 'mục', 'vector cosine': 'vector cosine', 'missing': 'chưa có', 'invalid': 'không hợp lệ', 'stale_kb': 'KB đã đổi', 'stale_config': 'cấu hình đã đổi',
  'The vector index is not ready; build it, then restart the server.': 'Chỉ mục vector chưa sẵn sàng; hãy tạo chỉ mục rồi khởi động lại server.',
});
let locale = 'en';
export const TOOL_HINTS = Object.freeze({ search_notes: 'Search allowed notes using BM25 keywords.', query_dataset: 'Lookup, filter, count, sum and compare allowed dataset snapshots.',
  compare_counts: 'Compare record counts of two groups in one dataset.', save_draft: 'Save a draft from note sources after approval.',
  create_proposal: 'Save an internal proposal after approval; changes are not applied.', check_asset_availability: 'Check available equipment quantity; no actual loan or booking.' });
export const currentLocale = () => locale;
export function setLocale(value) { locale = ['vi','en'].includes(value) ? value : 'en'; }
const ERRORS = { request_budget: ['Request budget exhausted.', 'Hết ngân sách request.'], token_budget: ['Token planning budget exhausted.', 'Hết ngân sách dự phòng token.'],
  invalid_model_output: ['Model output or citation invalid.', 'Output hoặc nguồn model không hợp lệ.'], model_timeout: ['Model timed out.', 'Model quá thời gian.'],
  model_rate_limited: ['Provider rate limited.', 'Provider giới hạn tần suất.'], model_unavailable: ['Model unavailable.', 'Model không khả dụng.'],
  task_changed: ['Task/data changed; start a new run.', 'Nhiệm vụ/dữ liệu đổi; tạo lượt chạy mới.'], model_changed: ['Model changed; start a new run.', 'Model đổi; tạo lượt chạy mới.'],
  configuration_missing: ['Configuration missing.', 'Thiếu cấu hình.'], user_stopped: ['Stopped by user.', 'Người dùng đã dừng.'], run_timeout: ['Run timed out.', 'Lượt chạy quá thời gian.'],
  invalid_configuration: ['Select a valid configuration.', 'Chọn cấu hình hợp lệ.'], profile_unavailable: ['Profile unavailable.', 'Hồ sơ model không khả dụng.'],
  invalid_followup: ['Only rephrasing is supported; create a new run for business work.', 'Chỉ hỗ trợ diễn đạt lại; tạo run mới cho nghiệp vụ.'],
  followup_busy: ['A follow-up is in progress.', 'Đang có lượt diễn đạt lại.'], followup_budget: ['Follow-up budget exhausted.', 'Hết ngân sách diễn đạt lại.'],
  followup_context: ['Stored context is unavailable.', 'Không đủ ngữ cảnh đã lưu.'], configuration_changed: ['Original configuration changed.', 'Cấu hình gốc đã đổi.'],
  invalid_followup_output: ['Follow-up output failed validation.', 'Kết quả diễn đạt lại không hợp lệ.'], interrupted: ['Interrupted; not automatically restarted.', 'Bị gián đoạn; không tự chạy lại.'],
  timeout: ['Model timed out.', 'Model quá thời gian.'], unavailable: ['Model unavailable.', 'Model không khả dụng.'], rate_limited: ['Provider rate limited.', 'Provider giới hạn tần suất.'] };
export function errorExplanation(code) { return ERRORS[code]?.[locale === 'vi' ? 1 : 0] ?? ''; }
export function t(key, args = {}) {
  const message = locale === 'vi' ? VI[key] ?? key : key;
  return message.replace(/\{([a-z]+)\}/g, (_,name) => args[name] ?? `{${name}}`);
}
export function readLocale(storage) { try { const v=storage.getItem('agent-studio.ui-locale'); return ['vi','en'].includes(v) ? v : 'en'; } catch { return 'en'; } }
export function rememberLocale(storage, value) { if (!['vi','en'].includes(value)) return; try { storage.setItem('agent-studio.ui-locale', value); } catch { /* UI still works. */ } }
export function setupLocale(document, storage, onChange) {
  const select=document.getElementById('ui-locale');
  function apply(value) {
    setLocale(value); select.value=currentLocale(); document.documentElement.lang=currentLocale();
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent=t(el.dataset.i18n);
    for (const attr of ['placeholder','aria-label','title','alt']) for (const el of document.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute?.(`data-i18n-${attr}`) ?? el.dataset.i18nPlaceholder));
    onChange();
  }
  apply(readLocale(storage));
  select.addEventListener('change', () => { rememberLocale(storage, select.value); apply(select.value); });
}
