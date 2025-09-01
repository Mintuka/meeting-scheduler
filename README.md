# AI Meeting Scheduler

A full-stack application that uses AI to automatically find the earliest common free time for meetings, create meetings, send email invitations, handle rescheduling, and send reminder emails.

## 🏗️ Architecture

This project follows a microservices architecture with:

- **Frontend**: React 18 with TypeScript and Tailwind CSS
- **Backend**: Python FastAPI with async/await support
- **Database**: MongoDB for flexible metadata storage
- **Containerization**: Docker with multi-stage builds
- **Orchestration**: Docker Compose for local development and production

## 📁 Project Structure

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
│   ├── app/               # Application modules
│   │   ├── database.py    # MongoDB connection and configuration
│   │   ├── models.py      # Pydantic models for MongoDB
│   │   ├── services.py    # Business logic and database operations
│   │   └── __init__.py    # Package initialization
│   ├── main.py            # FastAPI application
│   ├── requirements.txt   # Python dependencies
│   ├── init_db.py         # Database initialization script
│   ├── Dockerfile         # Production backend build
│   └── Dockerfile.dev     # Development backend build
├── docker-compose.yml      # Production orchestration
├── docker-compose.dev.yml  # Development orchestration
└── README.md              # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)
- MongoDB (included in Docker setup)

### Production Deployment

```bash
# Clone the repository
git clone <repository-url>
cd meeting-scheduler

# Build and run all services (including MongoDB)
docker compose up --build

# Initialize the database with sample metadata
docker compose exec backend python init_db.py

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Documentation: http://localhost:8000/docs
# MongoDB: localhost:27017
```

### Development Mode

```bash
# Start development environment with hot reloading
docker compose -f docker-compose.dev.yml up --build

# Initialize the database with sample metadata
docker compose -f docker-compose.dev.yml exec backend-dev python init_db.py

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Documentation: http://localhost:8000/docs
# MongoDB: localhost:27017
```

## 🛠️ Local Development

### Frontend Development

```bash
cd frontend
npm install
npm start
```

### Backend Development

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Start MongoDB (if not using Docker)
# Install MongoDB locally or use Docker:
docker run -d -p 27017:27017 --name mongodb mongo:7.0

# Initialize database with sample metadata
python init_db.py

# Start the FastAPI server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 🗄️ Database & Metadata

### MongoDB Integration

The application uses MongoDB for flexible metadata storage with the following collections:

- **meetings**: Stores meeting information with embedded metadata
- **metadata**: Stores application configuration and settings
- **users**: Stores user preferences and settings

### Metadata Management

The application includes a comprehensive metadata system for storing:

- **Application Settings**: Version, configuration, feature flags
- **Meeting Preferences**: Default durations, business hours, timezones
- **User Preferences**: Notification settings, calendar preferences
- **System Configuration**: AI settings, email configuration

#### Metadata API Endpoints

```bash
# Get all metadata
GET /api/metadata

# Get specific metadata by key
GET /api/metadata/{key}

# Create new metadata
POST /api/metadata?key={key}&value={value}&type={type}&description={description}

# Update metadata
PUT /api/metadata/{key}?value={value}&type={type}&description={description}

# Delete metadata
DELETE /api/metadata/{key}

# Update meeting metadata
PUT /api/meetings/{meeting_id}/metadata
```

#### Sample Metadata

The database initialization script creates sample metadata including:

- Application version and configuration
- Meeting duration limits and defaults
- Business hours and timezone settings
- Feature flags for AI and notifications
- Supported meeting types and reminder intervals

## 📋 Features

### Frontend (React)
- **Modern UI**: Built with React 18 and TypeScript
- **Responsive Design**: Tailwind CSS for beautiful, responsive layouts
- **Form Management**: React Hook Form with Zod validation
- **Real-time Updates**: Live updates for meeting status
- **Date Handling**: date-fns for robust date operations

### Backend (FastAPI)
- **High Performance**: FastAPI with async/await support
- **Automatic Documentation**: Interactive API docs at `/docs`
- **Data Validation**: Pydantic models for request/response validation
- **Security**: JWT authentication ready, CORS, rate limiting
- **Health Monitoring**: Built-in health checks and monitoring

### AI Features
- **Smart Scheduling**: AI-powered meeting time optimization
- **Email Integration**: Automatic invitation and reminder emails
- **Rescheduling**: Intelligent handling of meeting conflicts
- **Availability Analysis**: Participant calendar analysis

## 🔧 Configuration

### Environment Variables

#### Frontend
- `REACT_APP_API_URL`: Backend API URL (default: http://localhost:8000)

#### Backend
- `PORT`: Server port (default: 8000)
- `FRONTEND_URL`: Frontend URL for CORS (default: http://localhost:3000)
- `NODE_ENV`: Environment (development/production)
- `MONGODB_URL`: MongoDB connection string (default: mongodb://localhost:27017)
- `MONGODB_DATABASE`: MongoDB database name (default: meeting_scheduler)

## 📚 API Documentation

The backend provides automatic API documentation:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI Schema**: http://localhost:8000/openapi.json

## 🧪 Testing

### Frontend Tests
```bash
cd frontend
npm test
```

### Backend Tests
```bash
cd backend
pytest
```

## 🐳 Docker Commands

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
docker compose -f docker-compose.dev.yml up

# View logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild and restart
docker compose up --build --force-recreate
```

## 🔒 Security

- **Non-root containers**: Production containers run as non-root users
- **Security headers**: Helmet.js for frontend, FastAPI security for backend
- **Rate limiting**: API rate limiting to prevent abuse
- **CORS configuration**: Proper cross-origin resource sharing setup
- **Input validation**: Comprehensive request validation

## 🚀 Deployment

### Production Deployment
```bash
# Build and deploy
docker compose up --build -d

# View logs
docker compose logs -f

# Scale services
docker compose up --scale backend=3
```

### Environment-Specific Configuration
```bash
# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up

# Staging
docker compose -f docker-compose.yml -f docker-compose.staging.yml up
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Run linting and type checking before committing

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check the individual README files in `frontend/` and `backend/`
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Discussions**: Join the community discussions for questions and ideas

## 🔮 Future Enhancements

- **Real-time Notifications**: WebSocket support
- **Calendar Sync**: Google Calendar/Outlook integration
- **Mobile App**: React Native mobile application
- **Advanced AI**: Machine learning for better scheduling
- **Analytics**: Meeting analytics and insights
- **Multi-tenancy**: Support for multiple organizations
- **Advanced Metadata**: Hierarchical metadata with inheritance
- **Data Export**: Export meetings and metadata to various formats
