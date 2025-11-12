# Use Node.js 18 with Bun support
FROM node:18-slim

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="$HOME/.bun/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies with Bun
RUN bun install

# Copy source code
COPY . .

# Expose port
EXPOSE 10000

# Start command
CMD ["bun", "run", "start"]