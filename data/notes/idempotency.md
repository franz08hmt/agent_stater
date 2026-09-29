# Idempotency và chống ghi trùng

> DỮ LIỆU MẪU GIẢ LẬP — ghi chú học tập dùng để kiểm thử starter, không phải tài liệu chính thức.

Một thao tác là idempotent nếu gọi một lần hay nhiều lần đều để lại cùng một trạng thái. GET, PUT và DELETE được thiết kế idempotent. POST thì không: gửi lại cùng một POST có thể tạo ra hai bản ghi.

Khi mạng chập chờn, client thường retry. Để retry an toàn, client gửi kèm một idempotency key duy nhất cho mỗi thao tác. Server lưu key cùng kết quả; nếu nhận lại cùng key thì trả về kết quả cũ thay vì tạo bản ghi mới.
