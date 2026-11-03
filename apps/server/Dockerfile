# co-write server: Gradle build, then a small JRE image. Build from this folder:
#   docker build -t co-write-server apps/server
#
# Everything is configured by environment variables (see apps/server/.env.example):
# DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, PORT, AUTH, PUBLIC_URL, CORS_ALLOWED_HOSTS,
# COMPACT_AFTER, TRUST_PROXY, RATE_LIMIT_PER_MINUTE, OAUTH_*.

FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
# Dependencies first, so source edits do not re-download them.
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
RUN ./gradlew --no-daemon --console=plain dependencies > /dev/null 2>&1 || true
COPY src src
RUN ./gradlew --no-daemon --console=plain installDist -x test

FROM eclipse-temurin:21-jre
ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=${APP_VERSION} \
    PORT=8080 \
    JAVA_OPTS="-XX:MaxRAMPercentage=75"
# Not root: the server needs no privileges.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin cowrite
WORKDIR /app
COPY --from=build --chown=cowrite:cowrite /src/build/install/co-write-server ./
USER cowrite
EXPOSE 8080
# bash is in the image, curl is not: speak HTTP over /dev/tcp.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PORT}; printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3; head -n1 <&3 | grep -q ' 200 '"]
CMD ["bin/co-write-server"]
