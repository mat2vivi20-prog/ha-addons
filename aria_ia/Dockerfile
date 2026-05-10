ARG BUILD_FROM
FROM $BUILD_FROM

# Install Node.js
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Copy package files and install deps
COPY package.json .
RUN npm install --production

# Copy application files
COPY server.js .
COPY public/ public/
COPY run.sh /run.sh

RUN chmod +x /run.sh

CMD ["/run.sh"]
