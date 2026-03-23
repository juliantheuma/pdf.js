# Use Node.js LTS version
FROM node:22-bullseye

# Install system dependencies for canvas and PDF.js
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy root package files
COPY package*.json ./

# Install root dependencies
RUN npm install

# Copy the entire project
COPY . .

# Change to fittxly directory and install dependencies
WORKDIR /app/fittxly

# Copy fittxly package files (if not already copied)
COPY fittxly/package*.json ./

# Install fittxly dependencies
RUN npm install

# Create uploads directory
RUN mkdir -p uploads

# Expose the port the app runs on
EXPOSE 3000

# Start the server
CMD ["npm", "run", "start"]

