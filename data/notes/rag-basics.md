# RAG — Retrieval-Augmented Generation

> DỮ LIỆU MẪU GIẢ LẬP — ghi chú học tập dùng để kiểm thử starter, không phải tài liệu chính thức.

RAG cho mô hình ngôn ngữ đọc các đoạn tài liệu được truy xuất tại thời điểm hỏi, thay vì chỉ dựa vào kiến thức đã học. Quy trình gồm hai pha: pha lập chỉ mục (nạp tài liệu, chia đoạn, tạo chỉ mục) và pha truy vấn (tìm đoạn liên quan, ghép vào ngữ cảnh, sinh câu trả lời kèm trích dẫn).

Truy xuất có thể dùng tìm kiếm từ khóa như BM25 hoặc tìm kiếm ngữ nghĩa bằng embedding và vector index. Tìm kiếm từ khóa đơn giản, dễ giải thích nhưng bỏ sót khi câu hỏi dùng từ khác với tài liệu.

Nếu không đoạn nào hỗ trợ câu trả lời, hệ thống phải nói là không đủ bằng chứng thay vì tự bịa. Mỗi ý trong câu trả lời nên gắn source_id của đoạn đã dùng.
