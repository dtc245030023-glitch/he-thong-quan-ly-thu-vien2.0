export const NOTICES = Object.freeze({
  book_created: 'Đã thêm sách mới vào thư viện.',
  book_updated: 'Đã cập nhật thông tin sách.',
  book_deleted: 'Đã xoá sách khỏi thư viện.',
  reader_created: 'Đã thêm độc giả mới.',
  reader_updated: 'Đã cập nhật thông tin độc giả.',
  reader_deleted: 'Đã xoá độc giả.',
  loan_created: 'Đã lập phiếu mượn sách.',
  loan_returned: 'Đã ghi nhận trả sách và cập nhật kho.',
});

export const ERRORS = Object.freeze({
  book_has_loans: 'Không thể xoá sách vì đã có lịch sử mượn. Hãy giữ lại để bảo toàn dữ liệu.',
  reader_has_loans: 'Không thể xoá độc giả vì đã có lịch sử mượn. Hãy giữ lại để bảo toàn dữ liệu.',
  book_unavailable: 'Sách này hiện không còn bản sao nào để mượn.',
  loan_already_exists: 'Độc giả này đang mượn một bản của đầu sách đã chọn.',
  already_returned: 'Phiếu mượn này đã được trả trước đó.',
  not_found: 'Không tìm thấy dữ liệu được yêu cầu.',
});
