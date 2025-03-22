# Use Node.js as the base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm install --omit=dev

# Copy the application source code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]