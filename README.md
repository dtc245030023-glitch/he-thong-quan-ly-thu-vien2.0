# Hệ thống Quản lý Thư viện

Ứng dụng web quản lý thư viện thu nhỏ: quản lý sách, độc giả và nghiệp vụ mượn/trả sách. Toàn bộ hệ thống chạy bằng Docker Compose, gồm Node.js/Express, PostgreSQL 16, pgAdmin 4, Nginx làm reverse proxy và bộ giám sát Prometheus + Grafana.

## 1. Kiến trúc hệ thống

```
                        ┌──────────────────────────────────┐
   Trình duyệt  ──────► │  nginx (80/443)                  │
                        │  Reverse proxy + security headers │
                        └───────┬──────────┬───────────────┘
                                │          │
               ┌────────────────┘          └────────────────┐
               ▼                                            ▼
      ┌─────────────────┐                          ┌─────────────────┐
      │ app             │                          │ pgadmin         │
      │ Node.js/Express │                          │ pgAdmin 4       │
      │ :3000 nội bộ    │                          │ :5050 nội bộ    │
      │ /metrics        │                          └─────────────────┘
      └────────┬────────┘                          ┌─────────────────┐
               │                                   │ grafana         │
               │                                   │ :3000 nội bộ    │
               │                                   └────────┬────────┘
               │                                            │ datasource
               ▼                                            ▼
      ┌─────────────────────────────────────────────────────────────┐
      │ prometheus :9090 (nội bộ)                                   │
      │ scrape: app:3000/metrics · cadvisor:8080                    │
      │         postgres-exporter:9187 · nginx-exporter:9113        │
      └───────┬──────────────────┬──────────────────┬───────────────┘
              ▼                  ▼                  ▼
      ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐
      │ cadvisor     │   │ postgres-exporter│   │ nginx-exporter     │
      │ container    │   │ :9187            │   │ :9113              │
      │ :8080        │   └────────┬─────────┘   └─────────┬──────────┘
      └──────┬───────┘            ▼                       ▼
             │              ┌──────────────┐        ┌─────────────────┐
             │              │ db           │        │ nginx :8081     │
             │              │ PostgreSQL 16│        │ /stub_status    │
             │              │ :5432 nội bộ │        │ (nội bộ)        │
             │              └──────────────┘        └─────────────────┘
             ▼
      Docker host / cgroups (CPU, RAM, network của container)
```

Chỉ service `nginx` được publish cổng ra máy host. `app`, `db`, `pgadmin`, `grafana`, `prometheus` và các exporter chỉ giao tiếp trong mạng `app-network`.

| Service             | Image / Build                         | Cổng nội bộ | Truy cập từ ngoài                        |
|---------------------|---------------------------------------|-------------|------------------------------------------|
| `nginx`             | `nginx/Dockerfile`                    | 80, 443     | `http://localhost`, `https://localhost`  |
| `app`               | `app/Dockerfile`                      | 3000        | Qua Nginx tại `/`                        |
| `db`                | `postgres:16-alpine`                  | 5432        | Không publish ra host                    |
| `pgadmin`           | `dpage/pgadmin4:9.8`                  | 5050        | Qua Nginx tại `/pgadmin/`                |
| `prometheus`        | `prom/prometheus:v2.55.1`             | 9090        | Không publish ra host                    |
| `cadvisor`          | `gcr.io/cadvisor/cadvisor:v0.55.1`    | 8080        | Không publish ra host                    |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.16.0` | 9187 | Không publish ra host                 |
| `nginx-exporter`    | `nginx/nginx-prometheus-exporter:1.3.0` | 9113      | Không publish ra host                    |
| `grafana`           | `grafana/grafana:11.3.0`              | 3000        | Qua Nginx tại `/grafana/`                |

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
├── monitoring/
│   ├── prometheus/
│   │   └── prometheus.yml         # Cấu hình scrape targets
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources/       # Tự động thêm Prometheus datasource
│       │   └── dashboards/        # Provider nạp dashboard từ thư mục
│       └── dashboards/
│           ├── containers.json    # CPU, RAM, network theo container
│           ├── web.json           # HTTP, độ trễ, Nginx, Node.js
│           └── database.json      # PostgreSQL
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

Sau đó mở `.env` và thay **toàn bộ** giá trị `CHANGE_ME...` bằng mật khẩu ngẫu nhiên mạnh (tối thiểu 32 ký tự). Dùng ba mật khẩu khác nhau cho PostgreSQL, pgAdmin và Grafana.

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

Chạy lệnh trên ba lần để có ba mật khẩu riêng biệt.

Ví dụ nội dung `.env` (chỉ là mẫu — **không dùng các giá trị này**):

```dotenv
POSTGRES_DB=library_db
POSTGRES_USER=library_admin
POSTGRES_PASSWORD=<chuỗi-ngẫu-nhiên-64-ký-tự>

PGADMIN_DEFAULT_EMAIL=admin@library.vn
PGADMIN_DEFAULT_PASSWORD=<chuỗi-ngẫu-nhiên-64-ký-tự-khác>

GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<chuỗi-ngẫu-nhiên-64-ký-tự-thứ-ba>
GRAFANA_ROOT_URL=http://localhost/grafana/

HTTP_PORT=80
HTTPS_PORT=443
TZ=Asia/Ho_Chi_Minh
```

> Nếu đổi `HTTP_PORT`/`HTTPS_PORT`, cập nhật `GRAFANA_ROOT_URL` tương ứng (ví dụ `http://localhost:8080/grafana/`) rồi khởi động lại Grafana. Nếu không, Grafana sẽ chuyển hướng sai cổng và có thể gây vòng lặp redirect.

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
5. Khởi động Prometheus, cAdvisor, các exporter và Grafana; Grafana tự nhận Prometheus datasource và 3 dashboard mẫu.

Kiểm tra trạng thái (chờ đến khi 9 service báo `healthy` hoặc `running`):

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

Dữ liệu vẫn được giữ trong volume. Thêm `-v` nếu muốn xóa sạch (xem mục 11).

## 6. Truy cập ứng dụng

| Mục đích          | URL                              |
|-------------------|----------------------------------|
| Giao diện chính   | http://localhost                 |
| Giao diện qua TLS | https://localhost                |
| pgAdmin           | http://localhost/pgadmin/        |
| Grafana           | http://localhost/grafana/        |
| Health check      | http://localhost/health          |
| Nginx health      | http://localhost/healthz         |

HTTPS dùng chứng chỉ tự ký nên trình duyệt sẽ cảnh báo. Chọn "Advanced" → "Proceed to localhost" khi chạy thử cục bộ. Trong môi trường thật, thay chứng chỉ trong volume `nginx-certs` bằng chứng chỉ hợp lệ.

### 6.1. Đăng nhập pgAdmin

- **Email:** giá trị `PGADMIN_DEFAULT_EMAIL` trong `.env` (mặc định mẫu: `admin@library.vn`).
- **Password:** giá trị `PGADMIN_DEFAULT_PASSWORD` trong `.env`.

Server **Library PostgreSQL** đã được import sẵn (host `db`, port `5432`, database `library_db`, user `library_admin`). Lần đầu mở server, pgAdmin sẽ hỏi mật khẩu PostgreSQL — nhập giá trị `POSTGRES_PASSWORD` trong `.env`. Mật khẩu không được lưu trong `servers.json` nhằm tránh lộ bí mật trong mã nguồn.

### 6.2. Đăng nhập Grafana

- **Username:** giá trị `GRAFANA_ADMIN_USER` trong `.env` (mặc định mẫu: `admin`).
- **Password:** giá trị `GRAFANA_ADMIN_PASSWORD` trong `.env`.

Đăng ký tài khoản và truy cập ẩn danh đã bị tắt. Mật khẩu admin trong biến môi trường chỉ được áp dụng khi volume `grafana-data` được tạo lần đầu; nếu đổi mật khẩu trong `.env` sau đó, cần đặt lại bằng lệnh:

```bash
docker compose exec grafana grafana cli admin reset-admin-password '<mật-khẩu-mới>'
```

## 7. Giám sát với Prometheus + Grafana

### 7.1. Nguồn metrics

Prometheus scrape các target sau theo chu kỳ 15 giây (cấu hình tại `monitoring/prometheus/prometheus.yml`):

| Job           | Target                    | Metrics                                                                 |
|---------------|---------------------------|-------------------------------------------------------------------------|
| `library-app` | `app:3000/metrics`        | Request HTTP, latency histogram, mã trạng thái, CPU/RAM/heap/event loop của Node.js (`express-prom-bundle` + `prom-client`) |
| `cadvisor`    | `cadvisor:8080`           | CPU, RAM (working set), network của từng container Docker              |
| `postgres`    | `postgres-exporter:9187`  | Kích thước DB, kết nối, transaction, tuple, cache hit, deadlock          |
| `nginx`       | `nginx-exporter:9113`     | Request, kết nối active/reading/writing/waiting của Nginx               |
| `prometheus`  | `localhost:9090`          | Self-monitoring của Prometheus                                          |

Các container được gắn nhãn từ Docker Compose (`container_label_com_docker_compose_project=library-management`, `container_label_com_docker_compose_service=<tên service>`), nhờ đó dashboard tách được CPU/RAM theo từng service.

`/metrics` của ứng dụng chỉ mở trong mạng Docker. Nginx chặn `/metrics` và `/metrics/` với HTTP 404 để không lộ số liệu ra ngoài. Prometheus, cAdvisor và các exporter cũng không publish cổng ra host.

### 7.2. Dashboard có sẵn

Truy cập **http://localhost/grafana/** → thư mục **Thư viện**. Datasource Prometheus đã được provisioning tự động.

| Dashboard                             | UID                 | Nội dung chính                                                                 |
|---------------------------------------|---------------------|--------------------------------------------------------------------------------|
| **Library – Containers (CPU & RAM)**  | `library-containers` | Số container, tổng RAM/CPU, CPU & RAM theo từng service, network nhận/gửi        |
| **Library – Web & Nginx**             | `library-web`        | Request/giây, p50/p95, lỗi 5xx, request theo route/mã HTTP, Nginx, Node.js      |
| **Library – PostgreSQL**              | `library-database`   | `pg_up`, dung lượng DB, kết nối, transaction, tuple, cache hit, deadlock, temp  |

Dashboard được nạp từ `monitoring/grafana/dashboards/*.json`. Provider kiểm tra thư mục mỗi 30 giây, vì vậy có thể sửa JSON và thấy thay đổi mà không cần restart Grafana. Chỉnh sửa trực tiếp trên UI cũng được lưu, nhưng lần cập nhật provisioning kế tiếp sẽ ghi đè bằng nội dung file JSON. Muốn giữ thay đổi UI, sửa `allowUiUpdates: false` hoặc xuất dashboard ra file.

### 7.3. Kiểm tra Prometheus

Prometheus không publish cổng ra host. Kiểm tra target và truy vấn qua mạng nội bộ:

```bash
# Trạng thái các scrape target
docker compose exec prometheus wget -qO- http://127.0.0.1:9090/api/v1/targets

# Danh sách metric của ứng dụng
docker compose exec prometheus wget -qO- 'http://127.0.0.1:9090/api/v1/label/__name__/values'
```

Có thể dùng **Grafana → Explore** với datasource Prometheus để truy vấn PromQL trực tiếp.

Dữ liệu Prometheus được giữ 15 ngày (`--storage.tsdb.retention.time=15d`) trong volume `prometheus-data`. Cấu hình scrape nằm tại `monitoring/prometheus/prometheus.yml`; sau khi sửa, khởi động lại Prometheus:

```bash
docker compose restart prometheus
```

### 7.4. Lưu ý về cAdvisor

cAdvisor cần quyền truy cập cgroups của host nên chạy `privileged: true`, mount `/sys`, `/var/run`, `/var/lib/docker` ở chế độ chỉ đọc và dùng `cgroup: host`. Đây là yêu cầu của công cụ, không phải quyền của ứng dụng. Chỉ chạy stack này trên máy tin cậy; không cấp quyền tương tự cho các service khác.

Trên Linux, cAdvisor thường chạy trực tiếp với cấu hình trên. Trên Docker Desktop (Windows/macOS), nếu dashboard container trống, kiểm tra:

```bash
docker compose ps cadvisor
docker compose logs cadvisor | tail -50
```

Phiên bản image `v0.55.1` hỗ trợ Docker dùng containerd image store; các bản cũ hơn có thể không thấy container và chỉ báo metric của cgroup gốc.

## 8. Chức năng chính

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

## 9. Bảo mật và hardening

### Hạ tầng
- Mạng riêng `app-network` (bridge); chỉ `nginx` publish cổng 80/443. `db`, `pgadmin`, `grafana`, `prometheus`, `cadvisor` và các exporter không publish cổng ra host.
- Container `app` chạy bằng user không phải root (`node`, UID 1000).
- `app` dùng root filesystem chỉ đọc (`read_only: true`), `/tmp` là tmpfs.
- `cap_drop: ALL` cho `app`; `no-new-privileges:true` cho tất cả service.
- `cadvisor` là ngoại lệ có chủ đích: cần `privileged: true` để đọc cgroups của host. Các mount của nó đều là read-only; không cấp quyền này cho service khác.
- PostgreSQL xác thực host bằng `scram-sha-256`.
- Ba mật khẩu dài, ngẫu nhiên cho PostgreSQL, pgAdmin và Grafana, lưu trong `.env` (đã gitignore).
- Grafana tắt đăng ký tài khoản và truy cập ẩn danh.
- `/metrics` của ứng dụng bị Nginx chặn công khai; Prometheus và exporter chỉ truy cập nội bộ.

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
- `Content-Security-Policy` riêng cho app (chặt), pgAdmin và Grafana (nới hơn do các UI này cần inline/eval; vẫn giới hạn same-origin).
- TLS 1.2/1.3, tắt session tickets, HTTP/2 trên cổng 443.
- Ẩn header bảo mật trùng lặp từ upstream để tránh xung đột.
- Chặn `/metrics`, `/metrics/`; chỉ proxy `/grafana/` và `/pgadmin/` qua đúng prefix.

> **Phạm vi đồ án:** ứng dụng chưa có đăng nhập/phân quyền cho người dùng cuối (Grafana và pgAdmin có đăng nhập riêng). Không nên triển khai ra Internet công khai khi chưa bổ sung xác thực, rate limiting và cảnh báo giám sát.

## 10. Cơ sở dữ liệu

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

## 11. Các lệnh thường dùng

```bash
# Trạng thái và health
docker compose ps

# Log theo dõi
docker compose logs -f
docker compose logs -f app
docker compose logs -f prometheus grafana cadvisor

# Build lại và khởi động
docker compose up -d --build

# Khởi động lại một service
docker compose restart app
docker compose restart nginx
docker compose restart prometheus grafana

# Dừng và xóa container (giữ dữ liệu)
docker compose down

# Dừng và XÓA TOÀN BỘ dữ liệu (PostgreSQL, pgAdmin, Prometheus, Grafana, chứng chỉ)
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

> `docker compose down -v` xóa vĩnh viễn dữ liệu PostgreSQL, cấu hình pgAdmin, metrics Prometheus và trạng thái Grafana. Dashboard mẫu vẫn được provisioning lại từ file JSON; tài khoản admin Grafana được tạo lại với mật khẩu trong `.env`. Cân nhắc sao lưu trước.

## 12. Xử lý sự cố

### Cổng 80 hoặc 443 đã bị chiếm
Đổi cổng trong `.env`, ví dụ:

```dotenv
HTTP_PORT=8080
HTTPS_PORT=8443
```

Cập nhật thêm `GRAFANA_ROOT_URL=http://localhost:8080/grafana/`, sau đó chạy lại `docker compose up -d` và truy cập `http://localhost:8080`, `http://localhost:8080/pgadmin/`, `http://localhost:8080/grafana/`.

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

### Grafana bị vòng lặp chuyển hướng hoặc chuyển sai cổng
`GRAFANA_ROOT_URL` phải khớp URL công khai, gồm cả subpath `/grafana/` và cổng Nginx. Ví dụ khi `HTTP_PORT=8080`:

```dotenv
GRAFANA_ROOT_URL=http://localhost:8080/grafana/
```

Sửa `.env` rồi `docker compose up -d grafana` (biến môi trường chỉ được nạp lại khi container được tạo lại).

### Dashboard container trống hoặc thiếu service
- Kiểm tra target `cadvisor` và `library-app` trong Prometheus (mục 7.3).
- Xem log cAdvisor: `docker compose logs cadvisor | tail -50`.
- Trên Docker Desktop, cần image cAdvisor `v0.55.1` trở lên và `cgroup: host` như cấu hình hiện tại. Khởi động lại Docker Desktop nếu vừa nâng cấp.
- Sau khi container được tạo lại, chờ ít nhất 2 chu kỳ scrape (khoảng 30 giây) để Prometheus có đủ mẫu cho hàm `rate()`.
- Nếu chỉ một vài panel trống, mở dashboard và kiểm tra khoảng thời gian (time range) đang chọn; dữ liệu mới chỉ có sau khi stack chạy.

### Prometheus báo target `down`
```bash
docker compose ps
docker compose logs --tail=80 prometheus postgres-exporter nginx-exporter cadvisor
```

Các nguyên nhân thường gặp:
- Service tương ứng chưa khởi động xong.
- `postgres-exporter` không kết nối được DB do sai `POSTGRES_*` trong `.env`.
- `nginx-exporter` không đọc được `stub_status` (kiểm tra Nginx healthy và port 8081 nội bộ).
- Sau khi rebuild `app`, Nginx giữ IP cũ — chạy `docker compose restart nginx`.

### Dashboard mới sửa không xuất hiện
Grafana kiểm tra thư mục provisioning mỗi 30 giây. Chờ thêm hoặc xem log:

```bash
docker compose logs -f grafana
```

Nếu dashboard sửa trên UI bị ghi đè, đó là do provider `allowUiUpdates: true` kết hợp file JSON; hãy sửa file trong `monitoring/grafana/dashboards/` hoặc xuất dashboard ra JSON.

### Đổi mật khẩu Grafana trong `.env` nhưng không có tác dụng
`GF_SECURITY_ADMIN_PASSWORD` chỉ được dùng khi Grafana khởi tạo database lần đầu. Đặt lại mật khẩu:

```bash
docker compose exec grafana grafana cli admin reset-admin-password '<mật-khẩu-mới>'
```

Hoặc xóa volume `grafana-data` bằng `docker compose down -v` (mất toàn bộ trạng thái Grafana).

### Truy cập `/metrics` trả 404
Đây là hành vi có chủ đích: Nginx chặn metrics công khai. Prometheus scrape trực tiếp `app:3000/metrics` trong mạng Docker. Không mở endpoint này ra ngoài nếu chưa có xác thực.

### Dữ liệu mẫu không xuất hiện
Volume database đã tồn tại từ trước nên `init.sql` không chạy lại. Dùng quy trình "Đặt lại dữ liệu" ở mục 11.

### Kiểm tra biến môi trường đã được nạp đúng
```bash
docker compose config
```
Lệnh này hiển thị cấu hình sau khi thay biến. Không chia sẻ output nếu nó chứa mật khẩu.

## 13. Công nghệ sử dụng

- **Node.js 22** + **Express 4**, EJS (server-side rendering), ES Modules.
- **PostgreSQL 16** với SCRAM-SHA-256.
- **pgAdmin 4** (server mode).
- **Nginx 1.27** reverse proxy, TLS, security headers.
- **Prometheus 2.55** + **Grafana 11.3** cho metrics và dashboard.
- **cAdvisor 0.55**, **postgres-exporter**, **nginx-prometheus-exporter** làm nguồn metrics.
- **express-prom-bundle** + **prom-client** cho metrics của Node.js.
- **Docker Compose** với healthcheck, volume, mạng riêng.

## 14. Ghi chú triển khai production

- Thay chứng chỉ self-signed bằng chứng chỉ từ CA thật; bật redirect HTTP → HTTPS trong `nginx/conf.d/default.conf`.
- Thêm xác thực người dùng, phân quyền và rate limiting cho ứng dụng.
- Cân nhắc không public pgAdmin, hoặc giới hạn IP truy cập `/pgadmin/`.
- Giới hạn IP truy cập `/grafana/`, dùng SSO/OAuth nếu có nhiều người dùng; không public Prometheus, cAdvisor hay `/metrics`.
- cAdvisor cần `privileged`; chỉ chạy trên host tin cậy và theo dõi các bản vá image.
- Bật HSTS sau khi đã chắc chắn chạy HTTPS ổn định.
- Sao lưu định kỳ volume `postgres-data`, `grafana-data` và cấu hình dashboard; cân nhắc lưu metrics dài hạn nếu cần.
- Cấu hình Alertmanager hoặc Grafana Alerting cho các ngưỡng CPU/RAM, lỗi 5xx và DB down.
