# Truy vấn LogQL mẫu

Promtail gắn các label sau cho mỗi dòng log lấy từ Docker:

| Label      | Ý nghĩa                                                        |
|------------|----------------------------------------------------------------|
| `service`  | Tên service trong Docker Compose (`app`, `db`, `nginx`, ...)   |
| `container`| Tên container, ví dụ `library-management-app-1`                |
| `project`  | Tên Compose project (`library-management`)                     |

Mở **Grafana → Explore → Loki**, chọn khoảng thời gian (ví dụ 1 giờ gần nhất), dán truy vấn vào ô **Log query** rồi bấm **Run query**.

## 1. Log lỗi của Nginx

```logql
{service="nginx"} |~ `(?i)(error|crit|alert|emerg)]`
```

Truy vấn này đọc luồng stderr của Nginx và chỉ giữ các dòng error log có mức
`error`, `crit`, `alert` hoặc `emerg`. Có thể xem thêm các response 4xx/5xx từ
access log:

```logql
{service="nginx"} |~ `"[A-Z]+ [^"]+" (4|5)[0-9]{2} `
```

Đếm số lỗi Nginx theo phút:

```logql
sum(count_over_time({service="nginx"} |~ `(?i)(error|crit|alert|emerg)]` [1m]))
```

## 2. Log kết nối PostgreSQL

```logql
{service="db"} |~ `(?i)(connection received|connection authenticated|connection authorized|disconnection|FATAL|authentication failed)`
```

PostgreSQL được cấu hình `log_connections=on` và `log_disconnections=on`, nên
mỗi lần có client kết nối/ngắt kết nối sẽ xuất hiện trong Loki. Trường
`application_name` trong dòng `connection authorized` giúp phân biệt app, pgAdmin
và exporter.

Xem riêng các lần xác thực thất bại:

```logql
{service="db"} |~ `(?i)(FATAL|authentication failed|password authentication failed)`
```

## 3. Log truy cập ứng dụng

Ứng dụng ghi mỗi request thành một dòng JSON có dạng:

```json
{"event":"http_request","method":"GET","path":"/books","status":200,"duration_ms":12.4}
```

Lấy toàn bộ access log của app:

```logql
{service="app"} | json | event="http_request"
```

Chỉ xem request lỗi 5xx:

```logql
{service="app"} | json | event="http_request" | status=~"5[0-9]{2}"
```

Hiển thị gọn method, path, status và thời gian xử lý:

```logql
{service="app"} | json | event="http_request" | line_format "{{.method}} {{.path}} -> {{.status}} ({{.duration_ms}} ms)"
```

> Log truy cập cố ý không ghi query string, body hay header để tránh đưa dữ liệu
> cá nhân, mật khẩu hoặc token vào hệ thống log tập trung.

## Kiểm tra nhanh bằng API

Có thể kiểm tra Loki mà không cần mở giao diện:

```bash
# Loki sẵn sàng chưa?
docker compose exec loki wget -qO- http://127.0.0.1:3100/ready

# Các label đã được Promtail gửi lên
docker compose exec loki wget -qO- 'http://127.0.0.1:3100/loki/api/v1/labels'

# 20 dòng log gần nhất của app
docker compose exec loki wget -qO- \
  'http://127.0.0.1:3100/loki/api/v1/query_range?query=%7Bservice%3D%22app%22%7D&limit=20'
```

Nếu chưa thấy log, chờ vài giây sau khi Promtail khởi động rồi kiểm tra:

```bash
docker compose ps loki promtail
docker compose logs --tail=80 loki promtail
```
