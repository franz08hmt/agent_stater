# Vòng lặp Agent và điều kiện dừng

> DỮ LIỆU MẪU GIẢ LẬP — ghi chú học tập dùng để kiểm thử starter, không phải tài liệu chính thức.

Agent nhận một mục tiêu, sau đó lặp lại: quan sát trạng thái, chọn hành động, thực thi công cụ, nhận kết quả và cập nhật trạng thái. Điểm khác workflow cố định là bước tiếp theo do mô hình chọn dựa trên kết quả vừa nhận.

Mỗi agent cần điều kiện dừng rõ ràng: đạt mục tiêu, hết số bước tối đa, hết thời gian hoặc gặp lỗi không khắc phục được. Các giới hạn này do hệ thống kiểm soát, không để mô hình tự quyết.
