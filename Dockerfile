# Distill Audio — production image.
# Bun runtime + ffmpeg (for the ASMR loop/mix step). Deterministic and
# independent of Nixpacks/Railpack provider quirks.
FROM oven/bun:1

# ffmpeg for the ASMR layer (lands on PATH at /usr/bin/ffmpeg, so asmr.ts finds
# it via the default "ffmpeg" — no FFMPEG_PATH needed in prod).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source.
COPY . .

# Railway injects PORT; the server reads it. EXPOSE is documentation only.
EXPOSE 3000
CMD ["bun", "run", "start"]
