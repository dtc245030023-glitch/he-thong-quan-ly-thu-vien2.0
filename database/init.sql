-- ============================================================================
-- Library management schema and demo data
-- Chạy tự động một lần khi Docker tạo volume PostgreSQL mới.
-- ============================================================================

CREATE TABLE IF NOT EXISTS books (
    id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title             VARCHAR(255) NOT NULL,
    author            VARCHAR(255) NOT NULL,
    isbn              VARCHAR(32)  NOT NULL UNIQUE,
    category          VARCHAR(100) NOT NULL DEFAULT 'Khác',
    total_copies      INTEGER      NOT NULL CHECK (total_copies BETWEEN 1 AND 10000),
    available_copies  INTEGER      NOT NULL CHECK (available_copies BETWEEN 0 AND total_copies),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS readers (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name   VARCHAR(120) NOT NULL,
    email       VARCHAR(254) NOT NULL UNIQUE,
    phone       VARCHAR(30)  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loans (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    reader_id    INTEGER NOT NULL REFERENCES readers(id) ON DELETE RESTRICT,
    borrowed_at  DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date     DATE NOT NULL,
    returned_at  DATE,
    status       VARCHAR(16) NOT NULL DEFAULT 'borrowed'
                 CHECK (status IN ('borrowed', 'returned')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT loans_dates_valid CHECK (due_date >= borrowed_at),
    CONSTRAINT loans_returned_date_valid CHECK (returned_at IS NULL OR returned_at >= borrowed_at),
    CONSTRAINT loans_status_consistent CHECK (
        (status = 'borrowed' AND returned_at IS NULL)
        OR (status = 'returned' AND returned_at IS NOT NULL)
    )
);

-- Một độc giả không mượn trùng cùng một đầu sách khi phiếu trước chưa trả.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_loan_book_reader
    ON loans (book_id, reader_id)
    WHERE status = 'borrowed';

CREATE INDEX IF NOT EXISTS idx_loans_status_due ON loans (status, due_date);
CREATE INDEX IF NOT EXISTS idx_loans_book ON loans (book_id);
CREATE INDEX IF NOT EXISTS idx_loans_reader ON loans (reader_id);

-- ----------------------------------------------------------------------------
-- Demo data
-- ----------------------------------------------------------------------------
INSERT INTO books (title, author, isbn, category, total_copies, available_copies)
VALUES
    ('Nhà giả kim', 'Paulo Coelho', '9786041234567', 'Văn học', 5, 5),
    ('Sapiens: Lược sử loài người', 'Yuval Noah Harari', '9786047890123', 'Lịch sử', 4, 4),
    ('Lập trình Node.js', 'Vũ Trọng Hiếu', '9786043334445', 'Công nghệ', 3, 3),
    ('Clean Code', 'Robert C. Martin', '9780132350884', 'Công nghệ', 3, 3),
    ('Tư duy nhanh và chậm', 'Daniel Kahneman', '9786045678901', 'Kỹ năng', 4, 4),
    ('Dế Mèn phiêu lưu ký', 'Tô Hoài', '9786041112223', 'Thiếu nhi', 6, 6),
    ('Kinh tế học vi mô', 'N. Gregory Mankiw', '9786049998887', 'Kinh tế', 2, 2),
    ('Đắc nhân tâm', 'Dale Carnegie', '9786045556669', 'Kỹ năng', 3, 3)
ON CONFLICT (isbn) DO NOTHING;

INSERT INTO readers (full_name, email, phone)
VALUES
    ('Nguyễn Minh Anh', 'minhanh@example.com', '0901234567'),
    ('Trần Hoàng Nam', 'hoangnam@example.com', '0912345678'),
    ('Lê Thu Trang', 'thutrang@example.com', '0987654321'),
    ('Phạm Gia Huy', 'giahuy@example.com', '0977123456'),
    ('Đỗ Khánh Linh', 'khanhlinh@example.com', '0966456789')
ON CONFLICT (email) DO NOTHING;

-- Phiếu đang mượn (một phiếu quá hạn để minh hoạ dashboard).
INSERT INTO loans (book_id, reader_id, borrowed_at, due_date, status)
SELECT b.id, r.id, CURRENT_DATE - 12, CURRENT_DATE - 2, 'borrowed'
FROM books b, readers r
WHERE b.isbn = '9786041234567' AND r.email = 'minhanh@example.com'
  AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.book_id = b.id AND l.reader_id = r.id AND l.status = 'borrowed'
  );

INSERT INTO loans (book_id, reader_id, borrowed_at, due_date, status)
SELECT b.id, r.id, CURRENT_DATE - 5, CURRENT_DATE + 9, 'borrowed'
FROM books b, readers r
WHERE b.isbn = '9786047890123' AND r.email = 'hoangnam@example.com'
  AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.book_id = b.id AND l.reader_id = r.id AND l.status = 'borrowed'
  );

INSERT INTO loans (book_id, reader_id, borrowed_at, due_date, status)
SELECT b.id, r.id, CURRENT_DATE - 3, CURRENT_DATE + 11, 'borrowed'
FROM books b, readers r
WHERE b.isbn = '9780132350884' AND r.email = 'thutrang@example.com'
  AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.book_id = b.id AND l.reader_id = r.id AND l.status = 'borrowed'
  );

-- Phiếu đã trả.
INSERT INTO loans (book_id, reader_id, borrowed_at, due_date, returned_at, status)
SELECT b.id, r.id, CURRENT_DATE - 30, CURRENT_DATE - 16, CURRENT_DATE - 18, 'returned'
FROM books b, readers r
WHERE b.isbn = '9786043334445' AND r.email = 'giahuy@example.com'
  AND NOT EXISTS (
      SELECT 1 FROM loans l
      WHERE l.book_id = b.id AND l.reader_id = r.id
        AND l.borrowed_at = CURRENT_DATE - 30
  );

-- Đồng bộ số bản sao còn lại với các phiếu đang mượn.
UPDATE books b
SET available_copies = GREATEST(
    0,
    b.total_copies - COALESCE((
        SELECT COUNT(*)::integer
        FROM loans l
        WHERE l.book_id = b.id AND l.status = 'borrowed'
    ), 0)
);
