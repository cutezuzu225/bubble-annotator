FROM python:3.13-slim

# Install system dependencies for CAD conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-xlib-2.0-0 libffi-dev shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy application code
COPY server.py .

EXPOSE 5001

CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:5001", "--timeout", "120", "server:app"]
