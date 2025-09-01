# Meeting Scheduler - Docker Setup

This repository contains Docker configurations for both the frontend React application and backend Node.js API.

## Quick Start

### Production Build
```bash
# Build and run both services
docker-compose up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001
```

### Development Build
```bash
# Build and run both services in development mode with hot reloading
docker-compose -f docker-compose.dev.yml up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001
```

## Services

### Frontend (React)
- **Port**: 3000
- **Technology**: React 18 with TypeScript
- **Styling**: Tailwind CSS
- **Build**: Multi-stage Docker build with nginx for production

### Backend (Python/FastAPI)
- **Port**: 8000
- **Technology**: Python 3.11 with FastAPI
- **Features**: 
  - CORS enabled
  - Rate limiting
  - Security headers
  - Compression
  - Health checks
  - Automatic API documentation
  - Pydantic validation

## Project Structure

```
meeting-scheduler/
├── frontend/              # React application
│   ├── src/              # React source code
│   ├── public/            # Static assets
│   ├── package.json       # Frontend dependencies
│   ├── Dockerfile.frontend # Production frontend build
│   ├── Dockerfile.frontend.dev # Development frontend build
│   └── nginx.conf         # Nginx configuration
├── backend/               # Python FastAPI application
│   ├── main.py            # FastAPI application
│   ├── requirements.txt   # Python dependencies
│   ├── Dockerfile         # Production backend build
│   └── Dockerfile.dev     # Development backend build
├── docker-compose.yml      # Production orchestration
├── docker-compose.dev.yml  # Development orchestration
└── DOCKER_README.md        # This file
```

## Docker Commands

### Build Images
```bash
# Build frontend
docker build -f frontend/Dockerfile.frontend -t meeting-scheduler-frontend ./frontend

# Build backend
docker build -f backend/Dockerfile -t meeting-scheduler-backend ./backend
```

### Run Individual Services
```bash
# Run frontend only
docker run -p 3000:80 meeting-scheduler-frontend

# Run backend only
docker run -p 8000:8000 meeting-scheduler-backend
```

### Development Commands
```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up --build --force-recreate
```

## Environment Variables

### Frontend
- `REACT_APP_API_URL`: Backend API URL (default: http://localhost:3001)

### Backend
- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port (default: 8000)
- `FRONTEND_URL`: Frontend URL for CORS (default: http://localhost:3000)

## Health Checks

The backend service includes health checks:
- Endpoint: `GET /health`
- Interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3
- API Documentation: `GET /docs`

## Network

Both services run on a custom bridge network (`app-network`) for secure inter-service communication.

## Volumes

Development mode uses volumes for hot reloading:
- Source code is mounted for live updates
- Node modules are preserved in containers

## Security Features

- Non-root user in production containers
- Security headers (Helmet)
- Rate limiting
- CORS configuration
- Input validation

## Troubleshooting

### Build Issues
```bash
# Clean up Docker cache
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache
```

### Port Conflicts
If ports 3000 or 8000 are already in use, modify the port mappings in `docker-compose.yml`:
```yaml
ports:
  - "3002:80"  # Change host port
```

### Permission Issues
```bash
# Fix file permissions
sudo chown -R $USER:$USER .
```
