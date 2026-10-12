# CatanDabuVerse: one image = built web app + game server.

# ---- 1. Web app ----------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Public values, baked into the bundle at build time (the anon key is meant to
# be public; Row Level Security protects the data). Empty = no-login mode.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ---- 2. Game server -------------------------------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py rules.py map_layouts.py ./
COPY db/ db/
COPY bot_ai/ bot_ai/
COPY --from=web /app/frontend/dist frontend/dist
RUN useradd --create-home --uid 1000 app && chown -R app /app
USER app
EXPOSE 8080
# Secrets (DATABASE_URL, SUPABASE_URL, IP_HASH_SALT, PUBLIC_URL) come from the
# platform's environment, never from the image.
CMD ["sh", "-c", "exec uvicorn server:socket_app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
