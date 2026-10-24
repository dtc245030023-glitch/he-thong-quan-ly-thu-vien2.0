import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, httpError, parseId } from '../utils/http.js';
import {
  cleanText,
  isValidIsbn,
  parseInteger,
} from '../utils/validation.js';

const router = Router();

function readBookForm(body) {
  return {
    title: cleanText(body.title, 255),
    author: cleanText(body.author, 255),
    isbn: cleanText(body.isbn, 32),
    category: cleanText(body.category, 100) || 'Khác',
    total_copies:
      typeof body.total_copies === 'string' ? body.total_copies.trim().slice(0, 10) : '',
  };
}

function validateBook(formData, borrowedCopies = 0) {
  const errors = {};

  if (!formData.title) errors.title = 'Vui lòng nhập tên sách.';
  else if (formData.title.length > 255) errors.title = 'Tên sách tối đa 255 ký tự.';

  if (!formData.author) errors.author = 'Vui lòng nhập tên tác giả.';
  else if (formData.author.length > 255) errors.author = 'Tên tác giả tối đa 255 ký tự.';

  if (!formData.isbn) errors.isbn = 'Vui lòng nhập ISBN.';
  else if (!isValidIsbn(formData.isbn)) {
    errors.isbn = 'ISBN phải gồm 10 hoặc 13 chữ số (có thể dùng dấu gạch ngang).';
  }

  if (formData.category.length > 100) errors.category = 'Thể loại tối đa 100 ký tự.';

  const totalCopies = parseInteger(formData.total_copies);
  if (totalCopies === null || totalCopies < 1 || totalCopies > 10_000) {
    errors.total_copies = 'Tổng số bản sao phải là số nguyên từ 1 đến 10.000.';
  } else if (totalCopies < borrowedCopies) {
    errors.total_copies = `Không thể giảm xuống dưới ${borrowedCopies} bản vì hiện đang có ${borrowedCopies} bản được mượn.`;
  }

  return { errors, totalCopies };
}

function bookFormData(book) {
  return {
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    total_copies: String(book.total_copies),
  };
}

// ---------------------------------------------------------------------------
// List + search
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const search = `%${q}%`;

    const { rows: books } = await pool.query(
      `
        SELECT
          b.*,
          (b.total_copies - b.available_copies) AS borrowed_copies
        FROM books b
        WHERE (
          $1 = ''
          OR b.title ILIKE $2
          OR b.author ILIKE $2
          OR b.isbn ILIKE $2
          OR b.category ILIKE $2
        )
        ORDER BY lower(b.title), b.id
      `,
      [q, search],
    );

    res.render('books/index', {
      pageTitle: 'Quản lý sách',
      pageSubtitle: 'Thêm, cập nhật và theo dõi số lượng bản sao trong kho.',
      active: 'books',
      books,
      q,
    });
  }),
);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
router.get('/new', (req, res) => {
  res.render('books/form', {
    pageTitle: 'Thêm sách mới',
    pageSubtitle: 'Bổ sung một đầu sách vào kho của thư viện.',
    active: 'books',
    mode: 'create',
    book: null,
    formData: {
      title: '',
      author: '',
      isbn: '',
      category: 'Khác',
      total_copies: '1',
    },
    errors: {},
    borrowedCopies: 0,
  });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const formData = readBookForm(req.body);
    const { errors, totalCopies } = validateBook(formData);

    if (Object.keys(errors).length > 0) {
      return res.status(422).render('books/form', {
        pageTitle: 'Thêm sách mới',
        pageSubtitle: 'Bổ sung một đầu sách vào kho của thư viện.',
        active: 'books',
        mode: 'create',
        book: null,
        formData,
        errors,
        borrowedCopies: 0,
      });
    }

    try {
      await pool.query(
        `
          INSERT INTO books (title, author, isbn, category, total_copies, available_copies)
          VALUES ($1, $2, $3, $4, $5, $5)
        `,
        [formData.title, formData.author, formData.isbn, formData.category, totalCopies],
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.status(422).render('books/form', {
          pageTitle: 'Thêm sách mới',
          pageSubtitle: 'Bổ sung một đầu sách vào kho của thư viện.',
          active: 'books',
          mode: 'create',
          book: null,
          formData,
          errors: { isbn: 'ISBN này đã tồn tại trong hệ thống.' },
          borrowedCopies: 0,
        });
      }
      throw error;
    }

    return res.redirect('/books?notice=book_created');
  }),
);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
router.get(
  '/:id/edit',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy sách.'));

    const { rows } = await pool.query('SELECT * FROM books WHERE id = $1', [id]);
    const book = rows[0];
    if (!book) return next(httpError(404, 'Không tìm thấy sách.'));

    const borrowedCopies = book.total_copies - book.available_copies;

    return res.render('books/form', {
      pageTitle: 'Chỉnh sửa sách',
      pageSubtitle: 'Cập nhật thông tin và số lượng bản sao.',
      active: 'books',
      mode: 'edit',
      book,
      formData: bookFormData(book),
      errors: {},
      borrowedCopies,
    });
  }),
);

router.post(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy sách.'));

    const formData = readBookForm(req.body);
    const client = await pool.connect();
    let currentBook = null;
    let borrowedCopies = 0;

    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM books WHERE id = $1 FOR UPDATE', [id]);
      currentBook = rows[0];

      if (!currentBook) {
        await client.query('ROLLBACK');
        return next(httpError(404, 'Không tìm thấy sách.'));
      }

      borrowedCopies = currentBook.total_copies - currentBook.available_copies;
      const { errors, totalCopies } = validateBook(formData, borrowedCopies);

      if (Object.keys(errors).length > 0) {
        await client.query('ROLLBACK');
        return res.status(422).render('books/form', {
          pageTitle: 'Chỉnh sửa sách',
          pageSubtitle: 'Cập nhật thông tin và số lượng bản sao.',
          active: 'books',
          mode: 'edit',
          book: currentBook,
          formData,
          errors,
          borrowedCopies,
        });
      }

      await client.query(
        `
          UPDATE books
          SET title = $1,
              author = $2,
              isbn = $3,
              category = $4,
              total_copies = $5,
              available_copies = $6
          WHERE id = $7
        `,
        [
          formData.title,
          formData.author,
          formData.isbn,
          formData.category,
          totalCopies,
          totalCopies - borrowedCopies,
          id,
        ],
      );

      await client.query('COMMIT');
      return res.redirect('/books?notice=book_updated');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});

      if (error.code === '23505' && currentBook) {
        return res.status(422).render('books/form', {
          pageTitle: 'Chỉnh sửa sách',
          pageSubtitle: 'Cập nhật thông tin và số lượng bản sao.',
          active: 'books',
          mode: 'edit',
          book: currentBook,
          formData,
          errors: { isbn: 'ISBN này đã tồn tại trong hệ thống.' },
          borrowedCopies,
        });
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
router.post(
  '/:id/delete',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy sách.'));

    try {
      const result = await pool.query('DELETE FROM books WHERE id = $1', [id]);
      if (result.rowCount === 0) return next(httpError(404, 'Không tìm thấy sách.'));
    } catch (error) {
      if (error.code === '23503') return res.redirect('/books?error=book_has_loans');
      throw error;
    }

    return res.redirect('/books?notice=book_deleted');
  }),
);

export default router;
