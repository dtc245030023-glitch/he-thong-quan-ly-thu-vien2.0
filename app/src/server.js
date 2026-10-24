import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { closeDatabase, pool, waitForDatabase } from './db.js';
import { csrfToken, verifyCsrf } from './middleware/csrf.js';
import booksRouter from './routes/books.js';
import dashboardRouter from './routes/dashboard.js';
import loansRouter from './routes/loans.js';
import readersRouter from './routes/readers.js';
import { daysBetween, formatDate, initials, stockTone } from './utils/format.js';
import { ERRORS, NOTICES } from './utils/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.set('query parser', 'simple');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

// Template helpers.
app.locals.formatDate = formatDate;
app.locals.initials = initials;
app.locals.stockTone = stockTone;
app.locals.daysBetween = daysBetween;

// Unauthenticated liveness/readiness endpoint used by Docker Compose.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

// Static assets can be cached; HTML responses below are explicitly no-store.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '1h',
    index: false,
  }),
);

app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));

// CSRF: issue a token for GET requests, verify it on all state-changing requests.
app.use(csrfToken);

// Make shared template values available even when a request is rejected by CSRF.
app.use((req, res, next) => {
  const noticeKey = typeof req.query.notice === 'string' ? req.query.notice : '';
  const errorKey = typeof req.query.error === 'string' ? req.query.error : '';

  res.locals.notice = Object.hasOwn(NOTICES, noticeKey) ? NOTICES[noticeKey] : null;
  res.locals.error = Object.hasOwn(ERRORS, errorKey) ? ERRORS[errorKey] : null;
  res.locals.currentYear = new Date().getFullYear();
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(verifyCsrf);

app.use('/', dashboardRouter);
app.use('/books', booksRouter);
app.use('/readers', readersRouter);
app.use('/loans', loansRouter);

app.use((_req, res) => {
  res.status(404).render('error', {
    pageTitle: 'Không tìm thấy trang',
    pageSubtitle: '',
    active: '',
    errorCode: 404,
    errorTitle: 'Không tìm thấy trang',
    errorMessage: 'Đường dẫn bạn truy cập không tồn tại hoặc đã bị di chuyển.',
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  // Errors thrown by body parsing can occur before the common locals middleware.
  res.locals.notice ??= null;
  res.locals.error ??= null;
  res.locals.currentYear ??= new Date().getFullYear();

  const rawStatus = Number(error.status);
  const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  }

  const message =
    status >= 500
      ? 'Hệ thống gặp lỗi khi xử lý yêu cầu. Vui lòng thử lại sau ít phút.'
      : status === 413
        ? 'Dữ liệu gửi lên quá lớn.'
        : error.message || 'Yêu cầu không hợp lệ.';

  return res.status(status).render('error', {
    pageTitle: status === 403 ? 'Yêu cầu bị từ chối' : 'Có lỗi xảy ra',
    pageSubtitle: '',
    active: '',
    errorCode: status,
    errorTitle: status === 403 ? 'Yêu cầu không hợp lệ' : 'Có lỗi xảy ra',
    errorMessage: message,
  });
});

let server;
let shuttingDown = false;

async function start() {
  await waitForDatabase();
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Library Management is listening on port ${PORT}.`);
  });

  server.on('error', (error) => {
    console.error('HTTP server error:', error);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully...`);

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  if (!server) {
    closeDatabase().finally(() => process.exit(0));
    return;
  }

  server.close(() => {
    closeDatabase()
      .catch((error) => console.error('Error closing database pool:', error.message))
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(async (error) => {
  console.error('Unable to start application:', error.message);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
