# Hệ thống Quản lý Thư viện

Ứng dụng web quản lý thư viện thu nhỏ: quản lý sách, độc giả và nghiệp vụ mượn/trả sách. Toàn bộ hệ thống chạy bằng Docker Compose, gồm Node.js/Express, PostgreSQL 16, pgAdmin 4 và Nginx làm reverse proxy.

## 1. Kiến trúc hệ thống

```
                        ┌──────────────────────────────┐
   Trình duyệt  ──────► │  nginx (80/443)              │
                        │  Reverse proxy + headers      │
                        └───────────┬──────────────────┘
                                    │ app-network (bridge, isolated)
                 ┌──────────────────┼───────────────────┐
                 ▼                  ▼                   ▼
        ┌────────────────┐  ┌──────────────┐  ┌────────────────┐
        │ app            │  │ db           │  │ pgadmin        │
        │ Node.js/Express│  │ PostgreSQL 16│  │ pgAdmin 4      │
        │ :3000 (nội bộ) │  │ :5432 (nội bộ)│ │ :5050 (nội bộ) │
        └────────────────┘  └──────────────┘  └────────────────┘
                 ▲                  ▲                   │
                 └──── kết nối DB ──┘                   │
                                    └───── quản trị ────┘
```

Chỉ service `nginx` được publish cổng ra máy host. `app`, `db` và `pgadmin` chỉ giao tiếp trong mạng `app-network`.

| Service    | Image / Build            | Cổng nội bộ | Truy cập từ ngoài             |
|------------|--------------------------|-------------|-------------------------------|
| `nginx`    | `nginx/Dockerfile`       | 80, 443     | `http://localhost`, `https://localhost` |
| `app`      | `app/Dockerfile`         | 3000        | Qua Nginx tại `/`             |
| `db`       | `postgres:16-alpine`     | 5432        | Không publish ra host         |
| `pgadmin`  | `dpage/pgadmin4:9.8`     | 5050        | Qua Nginx tại `/pgadmin/`     |

## 2. Cấu trúc thư mục

```
.
├── app/
│   ├── src/
│   │   ├── middleware/csrf.js      # CSRF double-submit cookie
│   │   ├── routes/                # dashboard, books, readers, loans
│   │   ├── utils/                 # validation, format, http, messages
│   │   ├── db.js                  # PostgreSQL pool + retry
│   │   └── server.js              # Express app
│   ├── views/                     # EJS templates (server-rendered)
│   ├── public/                    # CSS, JS, favicon
│   ├── Dockerfile
│   └── package.json
├── database/
│   └── init.sql                   # Schema, ràng buộc, dữ liệu mẫu
├── nginx/
│   ├── conf.d/default.conf        # Virtual hosts :80 và :443
│   ├── snippets/                  # Security headers + CSP
│   ├── 40-generate-self-signed-cert.sh
│   ├── nginx.conf
│   └── Dockerfile
├── pgadmin/
│   └── servers.json               # Tự động import server PostgreSQL
├── .env.example
├── .gitignore
├── .gitattributes
├── docker-compose.yml
└── README.md
```

## 3. Yêu cầu hệ thống

- Docker Engine 24+ và Docker Compose v2 (Docker Desktop trên Windows/macOS).
- Cổng **80** và **443** đang trống (có thể đổi trong `.env`).
- Git (chỉ cần nếu muốn quản lý phiên bản mã nguồn).

Kiểm tra phiên bản:

```bash
docker --version
docker compose version
```

> Docker Desktop hiện đại dùng lệnh `docker compose` (có dấu cách). Lệnh `docker-compose` (có gạch nối) vẫn dùng được nếu máy đã cài bản standalone; các ví dụ dưới đây dùng `docker compose`.

## 4. Cấu hình biến môi trường

### 4.1. Tạo file `.env`

Sao chép file mẫu:

```bash
cp .env.example .env          # Git Bash / Linux / macOS
```

```powershell
Copy-Item .env.example .env   # PowerShell
```

Sau đó mở `.env` và thay **toàn bộ** giá trị `CHANGE_ME...` bằng mật khẩu ngẫu nhiên mạnh (tối thiểu 32 ký tự). Nên dùng mật khẩu khác nhau cho PostgreSQL và pgAdmin.

### 4.2. Sinh mật khẩu mạnh

Git Bash / Linux / macOS:

```bash
openssl rand -hex 32
```

PowerShell (tương thích Windows PowerShell 5.1):

```powershell
$bytes = New-Object byte[] 32
([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Chạy lệnh trên hai lần để có hai mật khẩu riêng biệt.

Ví dụ nội dung `.env` (chỉ là mẫu — **không dùng các giá trị này**):

```dotenv
POSTGRES_DB=library_db
POSTGRES_USER=library_admin
POSTGRES_PASSWORD=<chuỗi-ngẫu-nhiên-64-ký-tự>

PGADMIN_DEFAULT_EMAIL=admin@library.vn
PGADMIN_DEFAULT_PASSWORD=<chuỗi-ngẫu-nhiên-64-ký-tự-khác>

HTTP_PORT=80
HTTPS_PORT=443
TZ=Asia/Ho_Chi_Minh
```

Lưu ý:

- `PGADMIN_DEFAULT_EMAIL` phải là email hợp lệ; pgAdmin từ chối các tên miền đặc biệt như `.local`.
- File `.env` chứa bí mật thật và **đã được `.gitignore` loại trừ**. Không commit file này.
- Nếu đổi mật khẩu PostgreSQL sau khi volume đã được tạo, mật khẩu trong database **không tự đổi theo**. Xem mục "Đặt lại dữ liệu" hoặc đổi bằng `ALTER USER`.

## 5. Chạy ứng dụng

Từ thư mục gốc của dự án:

```bash
docker compose up -d --build
```

Hoặc với Docker Compose standalone:

```bash
docker-compose up -d --build
```

Lần chạy đầu tiên sẽ:

1. Build image Node.js và Nginx.
2. Tạo volume `postgres-data`, khởi tạo schema và nạp dữ liệu mẫu từ `database/init.sql`.
3. Tạo chứng chỉ TLS self-signed cho `localhost`.
4. Khởi động pgAdmin và import sẵn server "Library PostgreSQL".

Kiểm tra trạng thái (chờ đến khi cả 4 service báo `healthy`):

```bash
docker compose ps
```

Xem log:

```bash
docker compose logs -f
docker compose logs -f app
```

Dừng hệ thống:

```bash
docker compose down
```

Dữ liệu vẫn được giữ trong volume. Thêm `-v` nếu muốn xóa sạch (xem mục 10).

## 6. Truy cập ứng dụng

| Mục đích          | URL                              |
|-------------------|----------------------------------|
| Giao diện chính   | http://localhost                 |
| Giao diện qua TLS | https://localhost                |
| pgAdmin           | http://localhost/pgadmin/        |
| Health check      | http://localhost/health          |
| Nginx health      | http://localhost/healthz         |

HTTPS dùng chứng chỉ tự ký nên trình duyệt sẽ cảnh báo. Chọn "Advanced" → "Proceed to localhost" khi chạy thử cục bộ. Trong môi trường thật, thay chứng chỉ trong volume `nginx-certs` bằng chứng chỉ hợp lệ.

### 6.1. Đăng nhập pgAdmin

- **Email:** giá trị `PGADMIN_DEFAULT_EMAIL` trong `.env` (mặc định mẫu: `admin@library.vn`).
- **Password:** giá trị `PGADMIN_DEFAULT_PASSWORD` trong `.env`.

Server **Library PostgreSQL** đã được import sẵn (host `db`, port `5432`, database `library_db`, user `library_admin`). Lần đầu mở server, pgAdmin sẽ hỏi mật khẩu PostgreSQL — nhập giá trị `POSTGRES_PASSWORD` trong `.env`. Mật khẩu không được lưu trong `servers.json` nhằm tránh lộ bí mật trong mã nguồn.

## 7. Chức năng chính

### Tổng quan
- Thống kê số đầu sách, tổng bản sao, độc giả, phiếu đang mượn và phiếu quá hạn.
- Danh sách phiếu đang lưu hành gần đây.

### Quản lý sách
- Thêm, sửa, xóa sách; tìm kiếm theo tên, tác giả, ISBN, thể loại.
- Quản lý tổng số bản và số bản còn lại.
- Chặn xóa sách đã có lịch sử mượn (ràng buộc khóa ngoại `ON DELETE RESTRICT`).
- Kiểm tra ISBN trùng, dữ liệu nhập không hợp lệ.

### Quản lý độc giả
- Thêm, sửa, xóa độc giả; tìm kiếm theo tên, email, số điện thoại.
- Hiển thị số sách đang mượn và tổng lượt mượn.
- Chặn xóa độc giả còn phiếu mượn hoặc đã có lịch sử mượn.

### Mượn / trả sách
- Lập phiếu mượn: chọn sách còn bản, chọn độc giả, đặt hạn trả.
- Không cho mượn khi hết bản sao.
- Không cho cùng một độc giả mượn trùng một đầu sách khi phiếu trước chưa trả (partial unique index).
- Trả sách: cập nhật trạng thái, ngày trả và tăng số bản còn lại trong cùng một transaction.
- Lọc theo: đang mượn, quá hạn, đã trả, tất cả.

## 8. Bảo mật và hardening

### Hạ tầng
- Mạng riêng `app-network` (bridge); `db` và `pgadmin` không publish cổng ra host.
- Container `app` chạy bằng user không phải root (`node`, UID 1000).
- `app` dùng root filesystem chỉ đọc (`read_only: true`), `/tmp` là tmpfs.
- `cap_drop: ALL` cho `app`; `no-new-privileges:true` cho cả 4 service.
- PostgreSQL xác thực host bằng `scram-sha-256`.
- Mật khẩu dài, ngẫu nhiên, lưu trong `.env` (đã gitignore).

### Ứng dụng
- Truy vấn tham số hóa (parameterized queries) — chống SQL injection.
- EJS escape HTML mặc định — chống XSS; CSP nghiêm ngặt, không có inline script.
- CSRF double-submit cookie với so sánh `timingSafeEqual`; cookie `HttpOnly`, `SameSite=Lax`, `Secure` khi truy cập HTTPS.
- Validate dữ liệu phía server: độ dài, định dạng email/điện thoại/ISBN/ngày, số nguyên dương.
- Transaction + khóa dòng (`SELECT ... FOR UPDATE`) khi mượn/trả để tránh race condition.
- Trang HTML trả về `Cache-Control: no-store`; static asset được cache có kiểm soát.
- Ẩn `X-Powered-By`; giới hạn body 64 KB và số tham số form.
- Trang lỗi 403/404/500 được render thống nhất, không lộ stack trace.

### Nginx
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- `Content-Security-Policy` riêng cho app (chặt) và pgAdmin (nới hơn do pgAdmin cần inline/eval).
- TLS 1.2/1.3, tắt session tickets, HTTP/2 trên cổng 443.
- Ẩn header bảo mật trùng lặp từ upstream để tránh xung đột.

> **Phạm vi đồ án:** ứng dụng chưa có đăng nhập/phân quyền cho người dùng cuối. Không nên triển khai ra Internet công khai khi chưa bổ sung xác thực, rate limiting và giám sát.

## 9. Cơ sở dữ liệu

Ba bảng chính:

| Bảng      | Mô tả                                                                 |
|-----------|------------------------------------------------------------------------|
| `books`   | Tên sách, tác giả, ISBN (unique), thể loại, tổng bản, bản còn lại      |
| `readers` | Họ tên, email (unique), số điện thoại                                  |
| `loans`   | Phiếu mượn: sách, độc giả, ngày mượn, hạn trả, ngày trả, trạng thái    |

Ràng buộc đáng chú ý:

- `available_copies` luôn nằm trong khoảng `0..total_copies`.
- `due_date >= borrowed_at`; `returned_at` không trước `borrowed_at`.
- Trạng thái `borrowed` ⇔ `returned_at IS NULL`; `returned` ⇔ `returned_at` có giá trị.
- Partial unique index `uq_active_loan_book_reader` chặn mượn trùng sách đang giữ.
- Khóa ngoại `ON DELETE RESTRICT` bảo toàn lịch sử mượn.
- Index trên `(status, due_date)`, `book_id`, `reader_id` phục vụ tra cứu.

Dữ liệu mẫu gồm 8 đầu sách, 5 độc giả, 4 phiếu mượn (1 phiếu quá hạn, 1 phiếu đã trả).

Kết nối trực tiếp bằng `psql`:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## 10. Các lệnh thường dùng

```bash
# Trạng thái và health
docker compose ps

# Log theo dõi
docker compose logs -f
docker compose logs -f app

# Build lại và khởi động
docker compose up -d --build

# Khởi động lại một service
docker compose restart app
docker compose restart nginx

# Dừng và xóa container (giữ dữ liệu)
docker compose down

# Dừng và XÓA TOÀN BỘ dữ liệu (volume PostgreSQL, pgAdmin, chứng chỉ)
docker compose down -v

# Kiểm tra cấu hình compose + biến môi trường
docker compose config

# Mở shell trong container app
docker compose exec app sh

# Sao lưu database
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql

# Phục hồi database
cat backup.sql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### Đặt lại dữ liệu về trạng thái ban đầu

`database/init.sql` **chỉ chạy một lần** khi volume PostgreSQL được tạo mới. Muốn nạp lại dữ liệu mẫu:

```bash
docker compose down -v
docker compose up -d --build
```

> `docker compose down -v` xóa vĩnh viễn dữ liệu và cấu hình pgAdmin. Cân nhắc sao lưu trước.

## 11. Xử lý sự cố

### Cổng 80 hoặc 443 đã bị chiếm
Đổi cổng trong `.env`, ví dụ:

```dotenv
HTTP_PORT=8080
HTTPS_PORT=8443
```

Sau đó chạy lại `docker compose up -d` và truy cập `http://localhost:8080`, `http://localhost:8080/pgadmin/`.

### Trình duyệt cảnh báo chứng chỉ
Đây là chứng chỉ self-signed dùng cho môi trường cục bộ. Chấp nhận cảnh báo khi chạy thử. Không dùng chứng chỉ này cho production.

### Trang pgAdmin hiển thị lỗi hoặc tải chậm lần đầu
pgAdmin thực hiện nhiều bước khởi tạo Python khi chạy lần đầu. Chờ container chuyển sang `healthy`:

```bash
docker compose ps
docker compose logs -f pgadmin
```

pgAdmin được host tại subpath `/pgadmin/`; hãy giữ dấu `/` cuối URL.

### Sau khi rebuild chỉ riêng `app`, Nginx trả 502
Nginx phân giải tên container `app` khi khởi động và có thể giữ IP cũ sau khi container được tạo lại. Khởi động lại Nginx:

```bash
docker compose restart nginx
```

### pgAdmin báo không kết nối được PostgreSQL
- Đảm bảo `db` đang `healthy`: `docker compose ps`.
- Host phải là `db` (tên service), port `5432`.
- Nhập đúng `POSTGRES_PASSWORD` trong `.env`.
- Nếu vừa đổi mật khẩu trong `.env` nhưng volume đã tồn tại, mật khẩu database chưa đổi. Đặt lại bằng `docker compose down -v` hoặc đổi trực tiếp bằng `ALTER USER`.

### Dữ liệu mẫu không xuất hiện
Volume database đã tồn tại từ trước nên `init.sql` không chạy lại. Dùng quy trình "Đặt lại dữ liệu" ở mục 10.

### Kiểm tra biến môi trường đã được nạp đúng
```bash
docker compose config
```
Lệnh này hiển thị cấu hình sau khi thay biến. Không chia sẻ output nếu nó chứa mật khẩu.

## 12. Công nghệ sử dụng

- **Node.js 22** + **Express 4**, EJS (server-side rendering), ES Modules.
- **PostgreSQL 16** với SCRAM-SHA-256.
- **pgAdmin 4** (server mode).
- **Nginx 1.27** reverse proxy, TLS, security headers.
- **Docker Compose** với healthcheck, volume, mạng riêng.

## 13. Ghi chú triển khai production

- Thay chứng chỉ self-signed bằng chứng chỉ từ CA thật; bật redirect HTTP → HTTPS trong `nginx/conf.d/default.conf`.
- Thêm xác thực người dùng, phân quyền và rate limiting cho ứng dụng.
- Cân nhắc không public pgAdmin, hoặc giới hạn IP truy cập `/pgadmin/`.
- Bật HSTS sau khi đã chắc chắn chạy HTTPS ổn định.
- Sao lưu định kỳ volume `postgres-data` và kiểm thử quy trình phục hồi.
