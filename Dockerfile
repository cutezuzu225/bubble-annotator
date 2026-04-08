FROM python:3.11-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-xlib-2.0-0 libffi-dev shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# 复制应用代码
COPY server.py .

# 前端静态文件放到 /app/static
COPY index.html app.js style.css /app/static/

# nginx 配置
COPY nginx.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# supervisor 配置
COPY supervisord.conf /etc/supervisor/conf.d/app.conf

# 日志目录
RUN mkdir -p /var/log/nginx /var/log/gunicorn /var/log/supervisor

EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
