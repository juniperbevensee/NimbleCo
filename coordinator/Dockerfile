FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY shared/llm-adapters/package.json shared/llm-adapters/

# Install dependencies
RUN npm install

# Copy source
COPY coordinator/ coordinator/
COPY shared/ shared/

# Build
RUN npm run build --workspace @nimbleco/llm-adapters
RUN npm run build --workspace @nimbleco/coordinator

# Run
CMD ["node", "coordinator/dist/main.js"]
