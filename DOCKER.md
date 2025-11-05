# Docker Setup for PDF.js Server

This guide explains how to run the PDF processing server using Docker.

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and start the container
docker-compose up --build

# Run in detached mode (background)
docker-compose up -d

# Stop the container
docker-compose down
```

The server will be available at `http://localhost:3000`

### Using Docker directly

```bash
# Build the image
docker build -t pdf-server .

# Run the container
docker run -p 3000:3000 -v $(pwd)/fittxly/uploads:/app/fittxly/uploads pdf-server

# Run in detached mode
docker run -d -p 3000:3000 -v $(pwd)/fittxly/uploads:/app/fittxly/uploads --name pdf-server pdf-server

# Stop the container
docker stop pdf-server

# Remove the container
docker rm pdf-server
```

## What the Dockerfile Does

1. **Base Image**: Uses Node.js 20 on Debian Bullseye
2. **System Dependencies**: Installs required libraries for Canvas and PDF.js
3. **Root Setup**: 
   - Installs root npm dependencies
   - Runs `gulp dist-install` to build PDF.js
4. **Fittxly Setup**:
   - Changes to fittxly directory
   - Installs fittxly dependencies
   - Creates uploads directory
5. **Starts Server**: Runs `npm run start` on port 3000

## Volume Mounting

The `uploads` directory is mounted as a volume to persist uploaded files and converted images between container restarts.

## Environment Variables

You can customize the server by adding environment variables:

```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
```

## Troubleshooting

### Port already in use
If port 3000 is already in use, change the port mapping:
```bash
docker-compose up
# Edit docker-compose.yml and change ports to "3001:3000"
```

### Container logs
```bash
# Docker Compose
docker-compose logs -f

# Docker
docker logs -f pdf-server
```

### Rebuild after code changes
```bash
docker-compose up --build
```

## Production Considerations

- Use a reverse proxy (nginx) for SSL/HTTPS
- Set up proper logging
- Consider resource limits in docker-compose.yml:
  ```yaml
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 4G
  ```

