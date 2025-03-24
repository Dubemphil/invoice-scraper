# Use Node.js as the base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY app/package.json app/package-lock.json ./
RUN npm install --omit=dev

# Copy the application source code
COPY . .

# Copy credentials.json if it exists (it will be created in the pipeline)
# COPY credentials.json /app/credentials.json

# Expose port 8080
EXPOSE 8080

# Set environment variables
ENV PORT=8080
ENV GOOGLE_APPLICATION_CREDENTIALS="/app/credentials.json"

# Start the application
CMD ["node", "app/server.js"]