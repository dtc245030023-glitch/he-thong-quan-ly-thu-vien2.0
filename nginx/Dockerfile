FROM nginx:1.27-alpine

# openssl is used once at container start to create a local self-signed
# certificate if none is mounted into /etc/nginx/certs.
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY snippets/ /etc/nginx/snippets/
COPY 40-generate-self-signed-cert.sh /docker-entrypoint.d/40-generate-self-signed-cert.sh

RUN chmod 755 /docker-entrypoint.d/40-generate-self-signed-cert.sh

EXPOSE 80 443
