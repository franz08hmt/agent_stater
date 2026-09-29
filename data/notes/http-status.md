# HTTP status codes thường gặp

> DỮ LIỆU MẪU GIẢ LẬP — ghi chú học tập dùng để kiểm thử starter, không phải tài liệu chính thức.

Nhóm 2xx báo thành công. 200 OK dùng khi đọc hoặc cập nhật thành công. 201 Created dùng khi POST tạo ra tài nguyên mới và nên kèm header Location trỏ tới tài nguyên đó.

401 Unauthorized nghĩa là server chưa xác định được người gọi là ai: thiếu token, token hết hạn hoặc sai chữ ký. 403 Forbidden nghĩa là server đã biết người gọi là ai nhưng người đó không có quyền thực hiện hành động. Tóm lại: 401 là lỗi xác thực (authentication), 403 là lỗi phân quyền (authorization).

400 Bad Request dùng khi request sai cú pháp. 422 Unprocessable Content dùng khi cú pháp đúng nhưng dữ liệu vi phạm quy tắc, ví dụ quantity âm. 409 Conflict dùng khi request xung đột với trạng thái hiện tại, ví dụ tạo trùng một bản ghi đã tồn tại.
