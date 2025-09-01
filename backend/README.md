# Meeting Scheduler Backend (Python/FastAPI)

A modern Python backend API for the AI Meeting Scheduler application built with FastAPI.

## Features

- **FastAPI**: Modern, fast web framework for building APIs
- **Pydantic**: Data validation and settings management
- **Async/Await**: High-performance asynchronous operations
- **Automatic Documentation**: Interactive API docs at `/docs`
- **Type Hints**: Full type safety with Python type hints
- **CORS Support**: Cross-origin resource sharing enabled
- **Security**: JWT authentication ready, rate limiting
- **Health Checks**: Built-in health monitoring
- **Testing**: Pytest integration with async support

## Quick Start

### Local Development

1. **Install Python 3.11+**
2. **Create virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the server**:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. **Access the API**:
   - API: http://localhost:8000
   - Documentation: http://localhost:8000/docs
   - Health Check: http://localhost:8000/health

### Docker Development

```bash
# Build and run with Docker Compose
docker compose -f docker-compose.dev.yml up --build

# Or run backend only
docker build -f backend/Dockerfile.dev -t meeting-scheduler-backend ./backend
docker run -p 8000:8000 meeting-scheduler-backend
```

## API Endpoints

### Health Check
- `GET /health` - Service health status

### Meetings
- `GET /api/meetings` - Get all meetings
- `POST /api/meetings` - Create a new meeting
- `GET /api/meetings/{id}` - Get specific meeting
- `PUT /api/meetings/{id}` - Update meeting
- `DELETE /api/meetings/{id}` - Delete meeting
- `POST /api/meetings/{id}/send-reminder` - Send reminder

### Documentation
- `GET /docs` - Interactive API documentation (Swagger UI)
- `GET /redoc` - Alternative API documentation
- `GET /openapi.json` - OpenAPI schema

## Data Models

### Meeting
```python
{
    "id": "uuid",
    "title": "string",
    "description": "string",
    "participants": [Participant],
    "start_time": "datetime",
    "end_time": "datetime",
    "duration": "integer (minutes)",
    "status": "scheduled|confirmed|cancelled|rescheduled",
    "created_at": "datetime",
    "updated_at": "datetime"
}
```

### Participant
```python
{
    "id": "uuid",
    "name": "string",
    "email": "string",
    "availability": [TimeSlot]
}
```

### TimeSlot
```python
{
    "start": "datetime",
    "end": "datetime",
    "is_available": "boolean"
}
```

## Environment Variables

```bash
# Server Configuration
PORT=8000
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000

# Email Configuration (future)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# JWT Secret (future)
JWT_SECRET=your-super-secret-jwt-key

# Database Configuration (future)
DATABASE_URL=postgresql://username:password@localhost:5432/meeting_scheduler

# AI Service Configuration (future)
AI_SERVICE_URL=http://localhost:8001
AI_API_KEY=your-ai-api-key
```

## Development

### Code Quality

```bash
# Format code
black .

# Sort imports
isort .

# Type checking
mypy .

# Linting
flake8 .
```

### Testing

```bash
# Run tests
pytest

# Run tests with coverage
pytest --cov=app

# Run tests with verbose output
pytest -v
```

### Pre-commit Hooks

```bash
# Install pre-commit hooks
pre-commit install

# Run all hooks
pre-commit run --all-files
```

## Project Structure

```
backend/
├── main.py              # FastAPI application entry point
├── requirements.txt     # Python dependencies
├── pyproject.toml       # Project configuration
├── Dockerfile           # Production Docker image
├── Dockerfile.dev       # Development Docker image
├── .dockerignore        # Docker ignore file
├── env.example          # Environment variables template
├── test_main.py         # API tests
└── app/                 # Application modules (future)
    ├── models/          # Pydantic models
    ├── routes/          # API routes
    ├── services/        # Business logic
    ├── database/        # Database models
    └── utils/           # Utility functions
```

## Future Enhancements

- **Database Integration**: PostgreSQL with SQLAlchemy
- **Authentication**: JWT-based user authentication
- **Email Service**: SendGrid/AWS SES integration
- **AI Integration**: OpenAI/Claude API for scheduling
- **Calendar Sync**: Google Calendar/Outlook integration
- **Real-time Updates**: WebSocket support
- **Caching**: Redis for performance
- **Monitoring**: Prometheus metrics and logging
- **Background Tasks**: Celery for async processing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run code quality checks
6. Submit a pull request

## License

This project is licensed under the MIT License.
