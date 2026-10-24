import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../utils/http.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [statsResult, recentLoansResult] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::integer FROM books) AS book_titles,
          (SELECT COALESCE(SUM(total_copies), 0)::integer FROM books) AS total_copies,
          (SELECT COALESCE(SUM(available_copies), 0)::integer FROM books) AS available_copies,
          (SELECT COUNT(*)::integer FROM readers) AS reader_count,
          (SELECT COUNT(*)::integer FROM loans WHERE status = 'borrowed') AS active_loans,
          (SELECT COUNT(*)::integer FROM loans
            WHERE status = 'borrowed' AND due_date < CURRENT_DATE) AS overdue_loans
      `),
      pool.query(`
        SELECT
          l.id,
          l.borrowed_at,
          l.due_date,
          b.title,
          b.author,
          r.full_name,
          r.email,
          (l.due_date < CURRENT_DATE) AS overdue
        FROM loans l
        JOIN books b ON b.id = l.book_id
        JOIN readers r ON r.id = l.reader_id
        WHERE l.status = 'borrowed'
        ORDER BY (l.due_date < CURRENT_DATE) DESC, l.due_date ASC
        LIMIT 6
      `),
    ]);

    const stats = statsResult.rows[0];
    const availablePercent =
      stats.total_copies > 0
        ? Math.round((stats.available_copies / stats.total_copies) * 100)
        : 0;

    res.render('dashboard', {
      pageTitle: 'Tổng quan thư viện',
      pageSubtitle: 'Theo dõi kho sách và các phiếu mượn đang lưu hành.',
      active: 'dashboard',
      stats,
      availablePercent,
      recentLoans: recentLoansResult.rows,
    });
  }),
);

export default router;
