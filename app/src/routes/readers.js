import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, httpError, parseId } from '../utils/http.js';
import {
  cleanText,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
} from '../utils/validation.js';

const router = Router();

function readReaderForm(body) {
  return {
    full_name: cleanText(body.full_name, 120),
    email: normalizeEmail(body.email).slice(0, 300),
    phone: cleanText(body.phone, 30),
  };
}

function validateReader(formData) {
  const errors = {};

  if (!formData.full_name) errors.full_name = 'Vui lòng nhập họ tên độc giả.';
  else if (formData.full_name.length < 2) errors.full_name = 'Họ tên phải có ít nhất 2 ký tự.';
  else if (formData.full_name.length > 120) errors.full_name = 'Họ tên tối đa 120 ký tự.';

  if (!formData.email) errors.email = 'Vui lòng nhập email.';
  else if (!isValidEmail(formData.email)) errors.email = 'Địa chỉ email không hợp lệ.';

  if (!formData.phone) errors.phone = 'Vui lòng nhập số điện thoại.';
  else if (!isValidPhone(formData.phone)) {
    errors.phone = 'Số điện thoại phải gồm 8–15 chữ số và chỉ dùng ký tự + ( ) - . khoảng trắng.';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// List + search
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const search = `%${q}%`;

    const { rows: readers } = await pool.query(
      `
        SELECT
          r.*,
          COUNT(l.id) FILTER (WHERE l.status = 'borrowed')::integer AS active_loans,
          COUNT(l.id)::integer AS total_loans
        FROM readers r
        LEFT JOIN loans l ON l.reader_id = r.id
        WHERE (
          $1 = ''
          OR r.full_name ILIKE $2
          OR r.email ILIKE $2
          OR r.phone ILIKE $2
        )
        GROUP BY r.id
        ORDER BY lower(r.full_name), r.id
      `,
      [q, search],
    );

    res.render('readers/index', {
      pageTitle: 'Quản lý độc giả',
      pageSubtitle: 'Hồ sơ độc giả và số sách đang mượn của từng người.',
      active: 'readers',
      readers,
      q,
    });
  }),
);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
router.get('/new', (_req, res) => {
  res.render('readers/form', {
    pageTitle: 'Thêm độc giả',
    pageSubtitle: 'Tạo hồ sơ độc giả mới để bắt đầu cho mượn sách.',
    active: 'readers',
    mode: 'create',
    reader: null,
    formData: { full_name: '', email: '', phone: '' },
    errors: {},
  });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const formData = readReaderForm(req.body);
    const errors = validateReader(formData);

    if (Object.keys(errors).length > 0) {
      return res.status(422).render('readers/form', {
        pageTitle: 'Thêm độc giả',
        pageSubtitle: 'Tạo hồ sơ độc giả mới để bắt đầu cho mượn sách.',
        active: 'readers',
        mode: 'create',
        reader: null,
        formData,
        errors,
      });
    }

    try {
      await pool.query(
        'INSERT INTO readers (full_name, email, phone) VALUES ($1, $2, $3)',
        [formData.full_name, formData.email, formData.phone],
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.status(422).render('readers/form', {
          pageTitle: 'Thêm độc giả',
          pageSubtitle: 'Tạo hồ sơ độc giả mới để bắt đầu cho mượn sách.',
          active: 'readers',
          mode: 'create',
          reader: null,
          formData,
          errors: { email: 'Email này đã được đăng ký cho một độc giả khác.' },
        });
      }
      throw error;
    }

    return res.redirect('/readers?notice=reader_created');
  }),
);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
router.get(
  '/:id/edit',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy độc giả.'));

    const { rows } = await pool.query('SELECT * FROM readers WHERE id = $1', [id]);
    const reader = rows[0];
    if (!reader) return next(httpError(404, 'Không tìm thấy độc giả.'));

    return res.render('readers/form', {
      pageTitle: 'Chỉnh sửa độc giả',
      pageSubtitle: 'Cập nhật thông tin liên hệ của độc giả.',
      active: 'readers',
      mode: 'edit',
      reader,
      formData: {
        full_name: reader.full_name,
        email: reader.email,
        phone: reader.phone,
      },
      errors: {},
    });
  }),
);

router.post(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy độc giả.'));

    const formData = readReaderForm(req.body);
    const errors = validateReader(formData);

    if (Object.keys(errors).length > 0) {
      const { rows } = await pool.query('SELECT * FROM readers WHERE id = $1', [id]);
      if (!rows[0]) return next(httpError(404, 'Không tìm thấy độc giả.'));

      return res.status(422).render('readers/form', {
        pageTitle: 'Chỉnh sửa độc giả',
        pageSubtitle: 'Cập nhật thông tin liên hệ của độc giả.',
        active: 'readers',
        mode: 'edit',
        reader: rows[0],
        formData,
        errors,
      });
    }

    try {
      const result = await pool.query(
        'UPDATE readers SET full_name = $1, email = $2, phone = $3 WHERE id = $4',
        [formData.full_name, formData.email, formData.phone, id],
      );
      if (result.rowCount === 0) return next(httpError(404, 'Không tìm thấy độc giả.'));
    } catch (error) {
      if (error.code === '23505') {
        const { rows } = await pool.query('SELECT * FROM readers WHERE id = $1', [id]);
        if (!rows[0]) return next(httpError(404, 'Không tìm thấy độc giả.'));

        return res.status(422).render('readers/form', {
          pageTitle: 'Chỉnh sửa độc giả',
          pageSubtitle: 'Cập nhật thông tin liên hệ của độc giả.',
          active: 'readers',
          mode: 'edit',
          reader: rows[0],
          formData,
          errors: { email: 'Email này đã được đăng ký cho một độc giả khác.' },
        });
      }
      throw error;
    }

    return res.redirect('/readers?notice=reader_updated');
  }),
);

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
router.post(
  '/:id/delete',
  asyncHandler(async (req, res, next) => {
    const id = parseId(req.params.id);
    if (!id) return next(httpError(404, 'Không tìm thấy độc giả.'));

    try {
      const result = await pool.query('DELETE FROM readers WHERE id = $1', [id]);
      if (result.rowCount === 0) return next(httpError(404, 'Không tìm thấy độc giả.'));
    } catch (error) {
      if (error.code === '23503') return res.redirect('/readers?error=reader_has_loans');
      throw error;
    }

    return res.redirect('/readers?notice=reader_deleted');
  }),
);

export default router;
