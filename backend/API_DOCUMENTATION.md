# Unified Server API Documentation

This document describes the unified HTTP server that handles both REST API authentication endpoints and Telegram webhooks.

## Architecture

The server is a unified HTTP application that routes requests based on URL paths:
- **`/api/v1/auth/*`** - REST API authentication endpoints
- **`/webhooks/telegram`** - Telegram webhook endpoint

Both types of requests share the same middleware stack (logging, security headers, CORS, rate limiting).

## Base URL
```
https://your-railway-app.railway.app/api/v1
```

## Authentication Flow

1. **Registration**: User provides invitation token, username, password, and personal details
2. **Login**: User provides username and password, receives JWT token
3. **Authenticated Requests**: Include `Authorization: Bearer <token>` header

## Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "username": "john_doe",
  "password": "SecurePass123!",
  "invitation_token": "abc123xyz789",
  "first_name": "John",
  "middle_name": "Michael",
  "last_name": "Doe"
}
```

**Validation Rules:**
- `username`: Required, 3-50 characters, alphanumeric only
- `password`: Required, 8-128 characters
- `invitation_token`: Required
- `first_name`: Required, max 255 characters
- `middle_name`: Optional, max 255 characters (omitted from response if null)
- `last_name`: Optional, max 255 characters

**Response (201 Created):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 123,
    "username": "john_doe",
    "first_name": "John",
    "middle_name": "Michael",
    "last_name": "Doe",
    "invitation_token_id": 5,
    "created_at": "2024-01-07T10:00:00Z",
    "updated_at": "2024-01-07T10:00:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data or validation failed
- `401 Unauthorized` - Invalid invitation token
- `401 Unauthorized` - Invitation token has expired
- `401 Unauthorized` - Invitation token has reached maximum uses
- `500 Internal Server Error` - Server error

### POST /auth/login
Authenticate an existing user.

**Request Body:**
```json
{
  "username": "john_doe",
  "password": "SecurePass123!"
}
```

**Validation Rules:**
- `username`: Required, 3-50 characters
- `password`: Required, 8-128 characters

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 123,
    "username": "john_doe",
    "first_name": "John",
    "middle_name": "Michael",
    "last_name": "Doe",
    "invitation_token_id": 5,
    "created_at": "2024-01-07T10:00:00Z",
    "updated_at": "2024-01-07T10:00:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data or validation failed
- `401 Unauthorized` - Invalid username or password
- `500 Internal Server Error` - Server error

### GET /auth/me
Get current authenticated user's information.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response (200 OK):**
```json
{
  "id": 123,
  "username": "john_doe",
  "first_name": "John",
  "middle_name": "Michael",
  "last_name": "Doe",
  "invitation_token_id": 5,
  "created_at": "2024-01-07T10:00:00Z",
  "updated_at": "2024-01-07T10:00:00Z"
}
```

**Note:** The `middle_name` field is omitted from the response if null.

**Error Responses:**
- `405 Method Not Allowed` - Non-GET request
- `401 Unauthorized` - Missing or invalid token
- `500 Internal Server Error` - Failed to fetch user data

## Telegram Webhook

### POST /webhooks/telegram
Telegram webhook endpoint for receiving bot updates.

**Headers:**
```
Content-Type: application/json
X-Telegram-Bot-Api-Secret-Token: <secret-token>
```

**Request Body:**
```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 123,
    "from": {
      "id": 123456789,
      "is_bot": false,
      "first_name": "John",
      "username": "john_doe",
      "language_code": "en"
    },
    "chat": {
      "id": 123456789,
      "first_name": "John",
      "username": "john_doe",
      "type": "private"
    },
    "date": 1704628800,
    "text": "Hello bot!"
  }
}
```

**Response (200 OK):**
```json
{
  "method": "sendMessage",
  "chat_id": 123456789,
  "text": "Hello bot!"
}
```

**Configuration:**
- Set `TELEGRAM_BOT_TOKEN` environment variable to enable Telegram functionality
- Set `BACKEND_DOMAIN` environment variable for webhook URL
- If `TELEGRAM_BOT_TOKEN` is not set, Telegram functionality is disabled

**Notes:**
- This endpoint is automatically configured when the server starts
- The webhook secret token is randomly generated on each server startup
- All requests to this endpoint go through the same middleware stack

## Frontend Integration Examples

### React/JavaScript

**Registration:**
```javascript
const register = async (userData) => {
  const response = await fetch('/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    throw new Error('Registration failed');
  }

  const data = await response.json();

  // Store token (use localStorage for web, AsyncStorage for React Native)
  localStorage.setItem('authToken', data.token);

  return data.user;
};
```

**Login:**
```javascript
const login = async (username, password) => {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  const data = await response.json();
  localStorage.setItem('authToken', data.token);
  return data.user;
};
```

**Authenticated Request:**
```javascript
const getCurrentUser = async () => {
  const token = localStorage.getItem('authToken');

  const response = await fetch('/api/v1/auth/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user data');
  }

  return await response.json();
};
```

### React Native (AsyncStorage)

```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Store token
await AsyncStorage.setItem('authToken', token);

// Get token
const token = await AsyncStorage.getItem('authToken');

// Use in requests
const response = await fetch('/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

## Token Management

- **Token Expiration**: JWT tokens expire after 24 hours (configurable)
- **Storage**: Store tokens securely (localStorage for web, AsyncStorage/Keychain for mobile)
- **Automatic Inclusion**: Include `Authorization: Bearer <token>` header in all authenticated requests
- **Token Refresh**: Not implemented - users must re-login after token expiration

## Rate Limiting

- **Registration**: 10 requests per second per IP
- **Login**: 5 requests per second per IP
- **Authenticated endpoints**: 100 requests per second per IP

## Security Features

- **HTTPS Only**: All requests must use HTTPS
- **CORS**: Configured for your frontend domain
- **SQL Injection Protection**: Parameterized queries
- **XSS Protection**: Security headers and input validation
- **Password Security**: bcrypt hashing with salt
- **Rate Limiting**: Prevents brute force attacks
- **Input Validation**: Comprehensive validation on all inputs

## Error Handling

All endpoints return appropriate HTTP status codes and JSON error messages. Always check `response.ok` before parsing the response body.

## Environment Setup

Make sure these environment variables are set in your Railway dashboard:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<secure-random-32-byte-hex-string>
JWT_EXPIRATION_HOURS=24
FRONTEND_URL=https://your-frontend-domain.com
PORT=8080
GO_ENV=production

# Telegram Bot (optional - if not set, Telegram functionality is disabled)
TELEGRAM_BOT_TOKEN=<your-telegram-bot-token>
BACKEND_DOMAIN=https://your-railway-app.railway.app
```

## Invitation Tokens

Before users can register, you need to generate invitation tokens using the CLI tool:

```bash
# Build the token generator
go build -o token-generator ./cmd/token-generator

# Create a token for 10 users, expires in 30 days
./token-generator create --max-uses=10 --expires=720h

# List all tokens
./token-generator list

# Revoke a token
./token-generator revoke --token=<token-value>
```

## Testing

Test the unified server endpoints in this order:

### REST API Testing
1. Generate invitation token using CLI
2. Register user with valid token (POST `/api/v1/auth/register`)
3. Login with username/password (POST `/api/v1/auth/login`)
4. Use JWT token to access protected endpoints (GET `/api/v1/auth/me`)

### Telegram Testing (if configured)
1. Send a message to your Telegram bot
2. Check server logs for webhook processing
3. Verify bot responds (if your handler is implemented)

### Server Logs
The unified server logs all requests:
```
INFO: POST /api/v1/auth/login 200 15ms
INFO: POST /webhooks/telegram 200 8ms
INFO: GET /api/v1/auth/me 200 12ms
```
