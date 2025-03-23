# Use Node.js as the base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY app/package.json app/package-lock.json ./
RUN npm install --omit=dev

# Copy the application source code
COPY . .

# Expose port 8080
EXPOSE 8080

# Set environment variable for Cloud Run
ENV PORT=8080

# Start the application
CMD ["node", "app/server.js"]