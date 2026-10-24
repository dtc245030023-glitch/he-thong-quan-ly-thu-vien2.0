import crypto from 'node:crypto';

const COOKIE_NAME = 'csrf_token';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function parseCookies(header) {
  const cookies = Object.create(null);
  if (typeof header !== 'string') return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies instead of failing the whole request.
    }
  }

  return cookies;
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Issues a random CSRF token in an HttpOnly, SameSite=Lax cookie and exposes
 * it to EJS templates as `csrfToken`. No server-side session store is needed.
 */
export function csrfToken(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[COOKIE_NAME];

  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      maxAge: 2 * 60 * 60 * 1000,
    });
  }

  res.locals.csrfToken = token;
  next();
}

/**
 * Double-submit cookie verification for every state-changing request.
 */
export function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookies = parseCookies(req.headers.cookie);
  const submitted = typeof req.body?._csrf === 'string' ? req.body._csrf : '';

  if (!TOKEN_PATTERN.test(submitted) || !safeEqual(cookies[COOKIE_NAME], submitted)) {
    const error = new Error('Phiên làm việc đã hết hạn hoặc yêu cầu không hợp lệ. Vui lòng thử lại.');
    error.status = 403;
    return next(error);
  }

  return next();
}
