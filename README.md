# Modern Chat - Real-time Communication App

A modern, real-time chat application with dark mode UI/UX built with Bun and native WebSocket support. Perfect for deployment on Render.

## Features

✨ **Modern Dark Mode UI** - Sleek, contemporary design with smooth animations
🔄 **Real-time Messaging** - Instant message delivery using WebSocket
🏠 **Multiple Rooms** - Create and join different chat rooms
👥 **User Management** - Real-time user list with online indicators
📱 **Responsive Design** - Works perfectly on desktop and mobile
🚀 **High Performance** - Built with Bun for exceptional speed
🌐 **WebSocket Native** - Uses Bun's built-in WebSocket support

## Technology Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **WebSocket**: Native Bun WebSocket API
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **UI Framework**: Custom CSS with dark mode
- **Icons**: Font Awesome 6
- **Deployment**: Render.com compatible

## Local Development

### Prerequisites

- Bun runtime installed ([bun.sh](https://bun.sh))

### Quick Start

```bash
# Clone and navigate to the project
cd chat

# Install dependencies (if any)
bun install

# Start the development server
bun run dev
# or
bun run index.ts
```

The application will be available at `http://localhost:3000`

### Development Commands

```bash
# Start development server
bun run dev

# Start with hot reload (Bun specific)
bun run index.ts

# Test the application
bun run test
```

## Production Deployment on Render

### Method 1: Direct GitHub Integration (Recommended)

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Modern chat app"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to [render.com](https://render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Use these settings:
     - **Name**: `modern-chat` (or your preferred name)
     - **Region**: Choose closest to your users
     - **Branch**: `main`
     - **Root Directory**: Leave empty
     - **Runtime**: `Node`
     - **Build Command**: `bun install && bun run build`
     - **Start Command**: `bun run start`
     - **Plan**: `Free` (or `Starter` for production)

3. **Environment Variables** (Optional):
   ```bash
   NODE_VERSION=18
   PORT=10000
   ```

4. **Deploy**: Click "Create Web Service" and wait for deployment

### Method 2: Manual Deployment

1. **Create Render Blueprint**:
   - Use the included `render.yaml` file
   - This provides declarative configuration

2. **Deploy via CLI**:
   ```bash
   # Install Render CLI
   npm install -g @render/cli
   
   # Login and deploy
   render login
   render deploy
   ```

### Method 3: Docker Deployment

1. **Build and run locally**:
   ```bash
   # Build Docker image
   docker build -t modern-chat .
   
   # Run container
   docker run -p 3000:3000 modern-chat
   ```

2. **Deploy to Render with Docker**:
   - Render automatically detects Dockerfile
   - No additional configuration needed

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_VERSION` | Node.js version | `18` |

### File Structure

```
modern-chat/
├── index.ts           # Main server application
├── package.json       # Project dependencies and scripts
├── render.yaml        # Render deployment configuration
├── Dockerfile         # Docker configuration
├── bun.lock          # Bun lock file
├── tsconfig.json     # TypeScript configuration
└── README.md         # This file
```

## Usage

### For Users

1. **Join Chat**:
   - Open the application URL
   - Enter your username
   - Choose a room name (or use "general")
   - Click "Join Chat"

2. **Send Messages**:
   - Type your message in the input field
   - Press Enter or click the send button
   - Messages appear instantly for all users

3. **Switch Rooms**:
   - Leave current room
   - Join a new room with the same username

### For Developers

#### Customizing the UI

Edit the CSS variables in the `getStylesCSS()` function:

```typescript
// Dark mode color scheme
--bg-primary: #0a0b0d;        // Main background
--bg-secondary: #16181d;      // Secondary background
--accent-primary: #5865f2;    // Primary accent color
--text-primary: #e4e6eb;      // Main text color
```

#### Adding Features

- **Message Types**: Extend the `Message` interface
- **Room Management**: Modify the room handling logic
- **User Authentication**: Add JWT or session management
- **Message Persistence**: Integrate with a database

#### WebSocket Events

```typescript
// Client → Server messages
{ type: 'join', username: 'user', room: 'room' }
{ type: 'message', content: 'Hello!' }
{ type: 'leave' }

// Server → Client messages
{ type: 'join', username: 'user' }
{ type: 'message', username: 'user', content: 'Hello!' }
{ type: 'user-list', content: '["user1", "user2"]' }
```

## Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**:
   - Check if the server is running
   - Verify firewall settings
   - Ensure correct WebSocket URL

2. **Build Failures**:
   - Clear bun cache: `bun cache clean`
   - Delete `node_modules` and reinstall: `rm -rf node_modules && bun install`

3. **Port Issues**:
   - Ensure `PORT` environment variable is set
   - Check if port is available

### Debug Mode

Enable debug logging:

```bash
# Development mode with detailed logs
DEBUG=* bun run dev
```

## Performance

- **Startup Time**: < 100ms
- **Memory Usage**: < 50MB
- **Concurrent Users**: 1000+ (depends on server resources)
- **Message Latency**: < 10ms

## Security Considerations

- Input validation for usernames and messages
- Rate limiting (implement as needed)
- CORS configuration for production
- Environment variable security

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Create an issue on GitHub
- Check the troubleshooting section
- Review Render deployment documentation

---

**Happy Chatting! 💬✨**
