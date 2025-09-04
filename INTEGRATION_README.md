# Meeting Scheduler - Frontend-Backend Integration

This project is now fully connected with the frontend React application communicating with the backend FastAPI server.

## Features

- ✅ **Frontend-Backend Integration**: React frontend connects to FastAPI backend
- ✅ **Meeting Management**: Create, read, update, and delete meetings
- ✅ **Real-time Data**: Meetings are stored in MongoDB and retrieved via API
- ✅ **Error Handling**: Proper error handling and loading states
- ✅ **Type Safety**: TypeScript interfaces match backend models

## Quick Start

### Using Docker (Recommended)

1. **Start the development environment:**
   ```bash
   docker-compose -f docker-compose.dev.yml up --build
   ```

2. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

### Manual Setup

1. **Start MongoDB:**
   ```bash
   docker run -d -p 27017:27017 --name mongodb mongo:7.0
   ```

2. **Start the backend:**
   ```bash
   cd backend
   pip install -r requirements.txt
   python main.py
   ```

3. **Start the frontend:**
   ```bash
   cd frontend
   npm install
   npm start
   ```

## API Endpoints

The frontend connects to these backend endpoints:

- `GET /api/meetings` - Get all meetings
- `POST /api/meetings` - Create a new meeting
- `GET /api/meetings/{id}` - Get a specific meeting
- `PUT /api/meetings/{id}` - Update a meeting
- `DELETE /api/meetings/{id}` - Delete a meeting
- `POST /api/meetings/{id}/send-reminder` - Send reminder

## Environment Variables

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:8000
```

### Backend
```
MONGODB_URL=mongodb://admin:password@mongodb:27017
MONGODB_DATABASE=meeting_scheduler
FRONTEND_URL=http://localhost:3000
```

## Data Flow

1. **Create Meeting**: User fills form → Frontend calls `POST /api/meetings` → Backend saves to MongoDB → Meeting appears in list
2. **Load Meetings**: Dashboard loads → Frontend calls `GET /api/meetings` → Backend retrieves from MongoDB → Meetings displayed
3. **Update Meeting**: User reschedules → Frontend calls `PUT /api/meetings/{id}` → Backend updates MongoDB → Meeting updated
4. **Delete Meeting**: User deletes → Frontend calls `DELETE /api/meetings/{id}` → Backend removes from MongoDB → Meeting removed from list

## Troubleshooting

### CORS Issues
The backend is configured with CORS middleware to allow requests from the frontend. If you encounter CORS errors, check that the `FRONTEND_URL` environment variable is set correctly.

### Connection Issues
- Ensure MongoDB is running and accessible
- Check that the backend is running on port 8000
- Verify the `REACT_APP_API_URL` environment variable is set correctly

### Type Errors
The frontend TypeScript interfaces are designed to match the backend Pydantic models. If you encounter type errors, ensure both frontend and backend models are in sync.
