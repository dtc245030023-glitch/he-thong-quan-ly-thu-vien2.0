import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, httpError, parseId } from '../utils/http.js';
import {
  addDaysIso,
  compareIsoDates,
  isIsoDate,
  parseInteger,
  todayIso,
} from '../utils/validation.js';

const router = Router();

const FILTERS = new Set(['active', 'overdue', 'returned', 'all']);

const FILTER_SQL = {
  active: "l.status = 'borrowed'",
  overdue: "l.status = 'borrowed' AND l.due_date < CURRENT_DATE",
  returned: "l.status = 'returned'",
  all: 'TRUE',
};

const FILTER_ORDER = {
  active: 'l.due_date ASC, l.id ASC',
  overdue: 'l.due_date ASC, l.id ASC',
  returned: 'l.returned_at DESC, l.id DESC',
  all: 'l.borrowed_at DESC, l.id DESC',
};

function readLoanForm(body) {
  return {
    book_id: typeof body.book_id === 'string' ? body.book_id.trim().slice(0, 20) : '',
    reader_id: typeof body.reader_id === 'string' ? body.reader_id.trim().slice(0, 20) : '',
    due_date: typeof body.due_date === 'string' ? body.due_date.trim().slice(0, 10) : '',
  };
}

function validateLoan(formData) {
  const errors = {};
  const today = todayIso();
  const maxDueDate = addDaysIso(today, 365);

  if (parseInteger(formData.book_id) === null) errors.book_id = 'Vui lòng chọn sách.';
  if (parseInteger(formData.reader_id) === null) errors.reader_id = 'Vui lòng chọn độc giả.';

  if (!isIsoDate(formData.due_date)) errors.due_date = 'Hạn trả không hợp lệ.';
  else if (compareIsoDates(formData.due_date, today) < 0) {
    errors.due_date = 'Hạn trả không được trước ngày hôm nay.';
  } else if (compareIsoDates(formData.due_date, maxDueDate) > 0) {
    errors.due_date = 'Hạn trả không được xa hơn 365 ngày kể từ hôm nay.';
  }

  return errors;
}

async function renderLoanForm(res, { formData, errors, status = 200 }) {
  const [booksResult, readersResult] = await Promise.all([
    pool.query(`
      SELECT id, title, author, available_copies
      FROM books
      WHERE available_copies > 0
      ORDER BY lower(title), id
    `),
    pool.query('SELECT id, full_name, email FROM readers ORDER BY lower(full_name), id'),
  ]);

  const today = todayIso();

  return res.status(status).render('loans/form', {
    pageTitle: 'Lập phiếu mượn',
    pageSubtitle: 'Chọn sách còn trong kho và độc giả cần mượn.',
    active: 'loans',
    books: booksResult.rows,
    readers: readersResult.rows,
    formData,
    errors,
    today,
    maxDueDate: addDaysIso(today, 365),
  });
}

// ---------------------------------------------------------------------------
// List + filters
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = typeof req.query.status === 'string' && FILTERS.has(req.query.status)
      ? req.query.status
      : 'active';

    const [loansResult, countsResult] = await Promise.all([
      pool.query(`
        SELECT
          l.id,
          l.borrowed_at,
          l.due_date,
          l.returned_at,
          l.status,
          b.title,
          b.author,
          b.isbn,
          r.full_name,
          r.email,
          (l.status = 'borrowed' AND l.due_date < CURRENT_DATE) AS overdue
        FROM loans l
        JOIN books b ON b.id = l.book_id
        JOIN readers r ON r.id = l.reader_id
        WHERE ${FILTER_SQL[filter]}
        ORDER BY ${FILTER_ORDER[filter]}
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'borrowed')::integer AS active,
          COUNT(*) FILTER (
            WHERE status = 'borrowed' AND due_date < CURRENT_DATE
          )::integer AS overdue,
          COUNT(*) FILTER (WHERE status = 'returned')::integer AS returned,
          COUNT(*)::integer AS total
        FROM loans
      `),
    ]);

    res.render('loans/index', {
      pageTitle: 'Mượn / trả sách',
      pageSubtitle: 'Lập phiếu mượn mới và ghi nhận sách được trả.',
      active: 'loans',
      loans: loansResult.rows,
      counts: countsResult.rows[0],
      filter,
    });
  }),
);

// ---------------------------------------------------------------------------
// Create a loan
// ---------------------------------------------------------------------------
router.get(
  '/new',
  asyncHandler(async (_req, res) => {
    const today = todayIso();
    await renderLoanForm(res, {
      formData: {
        book_id: '',
        reader_id: '',
        due_date: addDaysIso(today, 14),
      },
      errors: {},
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const formData = readLoanForm(req.body);
    const errors = validateLoan(formData);

    if (Object.keys(errors).length > 0) {
      return renderLoanForm(res, { formData, errors, status: 422 });
    }

    const bookId = parseInteger(formData.book_id);
    const readerId = parseInteger(formData.reader_id);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const bookResult = await client.query(
        'SELECT id, title, available_copies FROM books WHERE id = $1 FOR UPDATE',
        [bookId],
      );
      const book = bookResult.rows[0];

      if (!book) {
        await client.query('ROLLBACK');
        return renderLoanForm(res, {
          formData,
          errors: { book_id: 'Sách đã chọn không tồn tại.' },
          status: 422,
        });
      }

      if (book.available_copies < 1) {
        await client.query('ROLLBACK');
        return renderLoanForm(res, {
          formData,
          errors: { book_id: 'Sách này vừa được mượn hết. Vui lòng chọn sách khác.' },
          status: 422,
        });
      }

      const readerResult = await client.query('SELECT id FROM readers WHERE id = $1', [readerId]);
      if (!readerResult.rows[0]) {
        await client.query('ROLLBACK');
        return renderLoanForm(res, {
          formData,
          errors: { reader_id: 'Độc giả đã chọn không tồn tại.' },
          status: 422,
        });
      }

      await client.query(
        `
          INSERT INTO loans (book_id, reader_id, borrowed_at, due_date, status)
          VALUES ($1, $2, CURRENT_DATE, $3, 'borrowed')
        `,
        [bookId, readerId, formData.due_date],
      );

      await client.query(
        `
          UPDATE books
          SET available_copies = available_copies - 1
          WHERE id = $1 AND available_copies > 0
        `,
        [bookId],
      );

      await client.query('COMMIT');
      return res.redirect('/loans?status=active&notice=loan_created');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});

      if (error.code === '23505') {
        return renderLoanForm(res, {
          formData,
          errors: { book_id: 'Độc giả này đang mượn một bản của đầu sách đã chọn.' },
          status: 422,
        });
      }

      throw error;
    } finally {
      client.release();
    }
  }),
);

// ---------------------------------------------------------------------------
// Return a book
// ---------------------------------------------------------------------------
router.post(
  '/:id/return',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy phiếu mượn.'));

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const loanResult = await client.query(
        'SELECT id, book_id, status FROM loans WHERE id = $1 FOR UPDATE',
        [id],
      );
      const loan = loanResult.rows[0];

      if (!loan) {
        await client.query('ROLLBACK');
        return next(httpError(404, 'Không tìm thấy phiếu mượn.'));
      }

      if (loan.status !== 'borrowed') {
        await client.query('ROLLBACK');
        return res.redirect('/loans?status=returned&error=already_returned');
      }

      await client.query(
        `
          UPDATE loans
          SET status = 'returned', returned_at = CURRENT_DATE
          WHERE id = $1
        `,
        [id],
      );

      await client.query(
        `
          UPDATE books
          SET available_copies = LEAST(total_copies, available_copies + 1)
          WHERE id = $1
        `,
        [loan.book_id],
      );

      await client.query('COMMIT');
      return res.redirect('/loans?status=active&notice=loan_returned');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

export default router;
