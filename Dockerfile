# Lightweight container for running cra-payroll with Chrome + virtual display.
# Usage: docker run --rm ghcr.io/seethruhead/cra-payroll --salary 100000 --table
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    xvfb \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

COPY cra-payroll-linux-x64 /usr/local/bin/cra-payroll
RUN chmod +x /usr/local/bin/cra-payroll

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
