import { serve } from "bun";

// Types for our chat application
interface Message {
  id: string;
  type: 'join' | 'leave' | 'message' | 'user-list';
  username: string;
  content?: string;
  timestamp: number;
  room?: string;
}

interface Client {
  ws: any;
  username: string;
  room: string;
}

// Global state
const clients = new Map<any, Client>();
const rooms = new Map<string, Set<any>>();

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function broadcastToRoom(room: string, message: Message, exclude?: any) {
  const roomClients = rooms.get(room);
  if (!roomClients) return;

  const data = JSON.stringify(message);
  roomClients.forEach(client => {
    if (client !== exclude) {
      try {
        client.send(data);
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  });
}

function sendUserList(room: string) {
  const roomClients = rooms.get(room);
  if (!roomClients) return;

  const users = Array.from(roomClients).map(client => {
    const clientData = clients.get(client);
    return clientData?.username || 'Unknown';
  });

  const message: Message = {
    id: generateId(),
    type: 'user-list',
    username: 'System',
    content: JSON.stringify(users),
    timestamp: Date.now(),
    room
  };

  broadcastToRoom(room, message);
}

const PORT = Number(process.env.PORT || 3000);

// Server HTTP + WebSocket nativo Bun.
// Bun acepta upgrade WebSocket automáticamente en la misma ruta a la que
// el cliente se conecta (ws://host:port/). NO usamos `path` aquí porque
// no es parte del tipo oficial y rompe el handler.
serve({
  port: PORT,
  websocket: {
    open(ws) {
      console.log("✅ WebSocket connected");
    },
    message(ws, message) {
      try {
        const data: Message = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'join':
            // Leave previous room if any
            const previousClient = clients.get(ws);
            if (previousClient) {
              const prevRoom = rooms.get(previousClient.room);
              if (prevRoom) {
                prevRoom.delete(ws);
                if (prevRoom.size === 0) {
                  rooms.delete(previousClient.room);
                }
              }
            }

            // Join new room
            clients.set(ws, {
              ws,
              username: data.username,
              room: data.room || 'general'
            });

            const clientRoom = data.room || 'general';
            if (!rooms.has(clientRoom)) {
              rooms.set(clientRoom, new Set());
            }
            rooms.get(clientRoom)!.add(ws);

            // Send join confirmation
            const joinMessage: Message = {
              id: generateId(),
              type: 'join',
              username: data.username,
              timestamp: Date.now(),
              room: clientRoom
            };
            ws.send(JSON.stringify(joinMessage));

            // Broadcast join to room
            const broadcastJoin: Message = {
              id: generateId(),
              type: 'join',
              username: data.username,
              timestamp: Date.now(),
              room: clientRoom,
              content: `${data.username} joined the chat`
            };
            broadcastToRoom(clientRoom, broadcastJoin, ws);

            // Send updated user list
            sendUserList(clientRoom);

            console.log(`${data.username} joined room: ${clientRoom}`);
            break;

          case 'message':
            const client = clients.get(ws);
            if (!client) return;

            const chatMessage: Message = {
              id: generateId(),
              type: 'message',
              username: client.username,
              content: data.content,
              timestamp: Date.now(),
              room: client.room
            };

            broadcastToRoom(client.room, chatMessage);
            console.log(`${client.username}: ${data.content}`);
            break;

          case 'leave':
            const leavingClient = clients.get(ws);
            if (leavingClient) {
              const leaveMessage: Message = {
                id: generateId(),
                type: 'leave',
                username: leavingClient.username,
                timestamp: Date.now(),
                room: leavingClient.room,
                content: `${leavingClient.username} left the chat`
              };

              const roomSet = rooms.get(leavingClient.room);
              if (roomSet) {
                roomSet.delete(ws);
                if (roomSet.size === 0) {
                  rooms.delete(leavingClient.room);
                }
              }

              broadcastToRoom(leavingClient.room, leaveMessage);
              sendUserList(leavingClient.room);
              clients.delete(ws);
            }
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    },
    close(ws) {
      const client = clients.get(ws);
      if (client) {
        const leaveMessage: Message = {
          id: generateId(),
          type: 'leave',
          username: client.username,
          timestamp: Date.now(),
          room: client.room,
          content: `${client.username} disconnected`
        };

        const roomSet = rooms.get(client.room);
        if (roomSet) {
          roomSet.delete(ws);
          if (roomSet.size === 0) {
            rooms.delete(client.room);
          }
        }

        broadcastToRoom(client.room, leaveMessage);
        sendUserList(client.room);
        clients.delete(ws);
        console.log(`${client.username} disconnected`);
      }
    },
  },
  fetch(request, server) {
    const url = new URL(request.url);

    // Si es petición WebSocket explícita, forzamos upgrade correcto.
    // Esto asegura respuesta 101 en lugar de 200.
    if (
      request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      if (!server.upgrade(request)) {
        return new Response("WebSocket Upgrade Failed", { status: 400 });
      }
      return new Response(null, { status: 101 });
    }

    // Rutas HTTP normales
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(getIndexHTML(), {
        headers: { "Content-Type": "text/html" }
      });
    }

    if (url.pathname === "/style.css") {
      return new Response(getStylesCSS(), {
        headers: { "Content-Type": "text/css" }
      });
    }

    if (url.pathname === "/script.js") {
      return new Response(getClientJS(), {
        headers: { "Content-Type": "application/javascript" }
      });
    }

    if (url.pathname === "/websocket-test.html") {
      return new Response(getWebSocketTestHTML(), {
        headers: { "Content-Type": "text/html" }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 Chat server running on http://localhost:3000");
console.log("📱 WebSocket server ready for connections");

// HTML Template
function getIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Modern Chat - Real-time Communication</title>
    <link rel="stylesheet" href="/style.css">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>
<body>
    <div class="app">
        <!-- Login Screen -->
        <div id="login-screen" class="login-screen">
            <div class="login-container">
                <div class="login-header">
                    <i class="fas fa-comments"></i>
                    <h1>Modern Chat</h1>
                    <p>Connect and chat in real-time</p>
                </div>
                <form id="login-form" class="login-form">
                    <div class="input-group">
                        <i class="fas fa-user"></i>
                        <input type="text" id="username" placeholder="Enter your username" required>
                    </div>
                    <div class="input-group">
                        <i class="fas fa-hashtag"></i>
                        <input type="text" id="room" placeholder="Room name (default: general)" value="general">
                    </div>
                    <button type="submit" class="login-btn">
                        <i class="fas fa-sign-in-alt"></i>
                        Join Chat
                    </button>
                </form>
            </div>
        </div>

        <!-- Chat Interface -->
        <div id="chat-interface" class="chat-interface hidden">
            <!-- Header -->
            <header class="chat-header">
                <div class="header-info">
                    <i class="fas fa-comments"></i>
                    <h2>Modern Chat</h2>
                    <span id="current-room" class="room-badge">#general</span>
                </div>
                <div class="header-actions">
                    <button id="leave-btn" class="leave-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        Leave
                    </button>
                </div>
            </header>

            <div class="chat-container">
                <!-- Sidebar -->
                <aside class="chat-sidebar">
                    <div class="sidebar-section">
                        <h3><i class="fas fa-users"></i> Online Users</h3>
                        <ul id="user-list" class="user-list">
                            <!-- Users will be populated here -->
                        </ul>
                    </div>
                </aside>

                <!-- Main Chat Area -->
                <main class="chat-main">
                    <div id="messages" class="messages">
                        <!-- Messages will appear here -->
                    </div>
                    
                    <form id="message-form" class="message-form">
                        <div class="input-container">
                            <input type="text" id="message-input" placeholder="Type your message..." maxlength="500">
                            <button type="submit" id="send-btn" class="send-btn">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </form>
                </main>
            </div>
        </div>
    </div>

    <script src="/script.js"></script>
</body>
</html>`;
}

// WebSocket Test HTML
function getWebSocketTestHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Test</title>
</head>
<body>
    <h1>WebSocket Connection Test</h1>
    <div id="status">Connecting...</div>
    <div id="log"></div>
    <script>
        function log(message) {
            document.getElementById('log').innerHTML += '<p>' + message + '</p>';
        }

        function testWebSocket() {
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = 'Testing WebSocket connection...';
            
            try {
                const ws = new WebSocket('ws://localhost:3000');
                
                ws.onopen = function(event) {
                    log('✅ WebSocket connection opened successfully!');
                    statusDiv.innerHTML = '✅ Connected';
                    
                    // Send a test message
                    ws.send(JSON.stringify({
                        type: 'join',
                        username: 'TestUser',
                        room: 'test'
                    }));
                };
                
                ws.onmessage = function(event) {
                    log('📨 Received: ' + event.data);
                };
                
                ws.onclose = function(event) {
                    log('❌ WebSocket connection closed. Code: ' + event.code + ', Reason: ' + event.reason);
                    statusDiv.innerHTML = '❌ Disconnected';
                };
                
                ws.onerror = function(error) {
                    log('❌ WebSocket error: ' + JSON.stringify(error));
                    statusDiv.innerHTML = '❌ Error';
                };
                
            } catch (error) {
                log('❌ Exception: ' + error.message);
                statusDiv.innerHTML = '❌ Exception: ' + error.message;
            }
        }
        
        // Test connection when page loads
        window.onload = testWebSocket;
    </script>
</body>
</html>`;
}

// CSS Styles
function getStylesCSS(): string {
  return `:root {
    --bg-primary: #0a0b0d;
    --bg-secondary: #16181d;
    --bg-tertiary: #1f2329;
    --bg-hover: #2b3038;
    --text-primary: #e4e6eb;
    --text-secondary: #b8bcc8;
    --text-muted: #8b8d97;
    --accent-primary: #5865f2;
    --accent-hover: #4752c4;
    --success: #57f287;
    --warning: #fee75c;
    --error: #ed4245;
    --border: #2f3336;
    --shadow: rgba(0, 0, 0, 0.3);
    --glow: rgba(88, 101, 242, 0.3);
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: linear-gradient(135deg, var(--bg-primary) 0%, #0f1115 100%);
    color: var(--text-primary);
    height: 100vh;
    overflow: hidden;
}

.app {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

/* Login Screen */
.login-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
    animation: fadeIn 0.5s ease-out;
}

.login-container {
    background: var(--bg-secondary);
    padding: 3rem;
    border-radius: 20px;
    box-shadow: 0 20px 40px var(--shadow);
    border: 1px solid var(--border);
    min-width: 400px;
    animation: slideUp 0.6s ease-out;
}

.login-header {
    text-align: center;
    margin-bottom: 2rem;
}

.login-header i {
    font-size: 3rem;
    color: var(--accent-primary);
    margin-bottom: 1rem;
    text-shadow: 0 0 20px var(--glow);
}

.login-header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
    background: linear-gradient(45deg, var(--accent-primary), var(--success));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.login-header p {
    color: var(--text-secondary);
    font-size: 1.1rem;
}

.login-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.input-group {
    position: relative;
    display: flex;
    align-items: center;
}

.input-group i {
    position: absolute;
    left: 1rem;
    color: var(--text-muted);
    z-index: 2;
}

.input-group input {
    width: 100%;
    padding: 1rem 1rem 1rem 3rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 12px;
    color: var(--text-primary);
    font-size: 1rem;
    transition: all 0.3s ease;
}

.input-group input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--glow);
}

.login-btn {
    background: linear-gradient(45deg, var(--accent-primary), var(--accent-hover));
    color: white;
    border: none;
    padding: 1rem 2rem;
    border-radius: 12px;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px var(--glow);
}

/* Chat Interface */
.chat-interface {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

.hidden {
    display: none !important;
}

.chat-header {
    background: var(--bg-secondary);
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 10px var(--shadow);
}

.header-info {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.header-info i {
    font-size: 1.5rem;
    color: var(--accent-primary);
}

.header-info h2 {
    font-size: 1.5rem;
    margin-right: 1rem;
}

.room-badge {
    background: var(--accent-primary);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.875rem;
    font-weight: 500;
}

.leave-btn {
    background: var(--error);
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.leave-btn:hover {
    background: #c03537;
    transform: translateY(-1px);
}

.chat-container {
    display: flex;
    flex: 1;
    overflow: hidden;
}

/* Sidebar */
.chat-sidebar {
    width: 280px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    padding: 1.5rem;
    overflow-y: auto;
}

.sidebar-section h3 {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.user-list {
    list-style: none;
}

.user-list li {
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 8px;
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transition: all 0.2s ease;
}

.user-list li:hover {
    background: var(--bg-hover);
    transform: translateX(4px);
}

.user-list li::before {
    content: '';
    width: 8px;
    height: 8px;
    background: var(--success);
    border-radius: 50%;
    flex-shrink: 0;
}

/* Main Chat Area */
.chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
}

.messages {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.message {
    display: flex;
    gap: 0.75rem;
    animation: messageSlideIn 0.3s ease-out;
}

.message-avatar {
    width: 40px;
    height: 40px;
    background: linear-gradient(45deg, var(--accent-primary), var(--success));
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    flex-shrink: 0;
}

.message-content {
    flex: 1;
}

.message-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
}

.message-username {
    font-weight: 600;
    color: var(--text-primary);
}

.message-time {
    color: var(--text-muted);
    font-size: 0.875rem;
}

.message-text {
    background: var(--bg-tertiary);
    padding: 0.75rem 1rem;
    border-radius: 12px;
    border-top-left-radius: 4px;
    line-height: 1.5;
    color: var(--text-primary);
    word-wrap: break-word;
}

.message.own .message-content {
    align-items: flex-end;
}

.message.own .message-text {
    background: linear-gradient(45deg, var(--accent-primary), var(--accent-hover));
    border-top-left-radius: 12px;
    border-top-right-radius: 4px;
}

/* System Messages */
.message.system .message-text {
    background: var(--bg-tertiary);
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
}

/* Message Form */
.message-form {
    padding: 1.5rem;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
}

.input-container {
    display: flex;
    gap: 1rem;
    align-items: center;
}

#message-input {
    flex: 1;
    padding: 1rem 1.5rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 25px;
    color: var(--text-primary);
    font-size: 1rem;
    transition: all 0.3s ease;
}

#message-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--glow);
}

.send-btn {
    width: 50px;
    height: 50px;
    background: linear-gradient(45deg, var(--accent-primary), var(--accent-hover));
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
}

.send-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 5px 15px var(--glow);
}

.send-btn:disabled {
    background: var(--bg-tertiary);
    color: var(--text-muted);
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

/* Animations */
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideUp {
    from {
        opacity: 0;
        transform: translateY(30px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes messageSlideIn {
    from {
        opacity: 0;
        transform: translateX(-20px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

/* Responsive Design */
@media (max-width: 768px) {
    .chat-sidebar {
        width: 200px;
    }
    
    .login-container {
        min-width: auto;
        width: 90%;
        max-width: 400px;
        padding: 2rem;
    }
    
    .chat-header {
        padding: 1rem;
    }
    
    .header-info h2 {
        font-size: 1.25rem;
    }
}

@media (max-width: 640px) {
    .chat-container {
        flex-direction: column;
    }
    
    .chat-sidebar {
        width: 100%;
        height: 150px;
        border-right: none;
        border-bottom: 1px solid var(--border);
    }
    
    .input-container {
        gap: 0.5rem;
    }
    
    #message-input {
        padding: 0.875rem 1rem;
    }
}`;
}

// Client-side JavaScript
function getClientJS(): string {
  return `class ChatApp {
    constructor() {
        this.ws = null;
        this.username = '';
        this.room = 'general';
        this.isConnected = false;
        
        this.initializeElements();
        this.bindEvents();
        this.checkWebSocketSupport();
    }

    initializeElements() {
        // Login elements
        this.loginScreen = document.getElementById('login-screen');
        this.loginForm = document.getElementById('login-form');
        this.usernameInput = document.getElementById('username');
        this.roomInput = document.getElementById('room');
        
        // Chat elements
        this.chatInterface = document.getElementById('chat-interface');
        this.messagesContainer = document.getElementById('messages');
        this.messageForm = document.getElementById('message-form');
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.userList = document.getElementById('user-list');
        this.currentRoomSpan = document.getElementById('current-room');
        this.leaveBtn = document.getElementById('leave-btn');
    }

    bindEvents() {
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.messageForm.addEventListener('submit', (e) => this.handleSendMessage(e));
        this.messageInput.addEventListener('input', () => this.toggleSendButton());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage(e);
            }
        });
        this.leaveBtn.addEventListener('click', () => this.handleLeave());
    }

    checkWebSocketSupport() {
        if (!window.WebSocket) {
            this.showError('WebSocket is not supported in this browser');
            return;
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = \`\${protocol}//\${window.location.host}\`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to WebSocket server');
                this.isConnected = true;
                this.sendJoinMessage();
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
            
            this.ws.onclose = () => {
                console.log('Disconnected from WebSocket server');
                this.isConnected = false;
                this.handleDisconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showError('Connection error. Please try again.');
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.showError('Failed to connect to server');
        }
    }

    handleLogin(e) {
        e.preventDefault();
        
        const username = this.usernameInput.value.trim();
        const room = this.roomInput.value.trim() || 'general';
        
        if (!username) {
            this.showError('Please enter a username');
            return;
        }
        
        if (username.length < 2) {
            this.showError('Username must be at least 2 characters');
            return;
        }
        
        if (username.length > 20) {
            this.showError('Username must be less than 20 characters');
            return;
        }
        
        this.username = username;
        this.room = room;
        
        this.loginScreen.style.display = 'none';
        this.chatInterface.classList.remove('hidden');
        
        this.currentRoomSpan.textContent = \`#\${room}\`;
        this.messageInput.placeholder = \`Message #\${room}...\`;
        
        this.connectWebSocket();
    }

    sendJoinMessage() {
        const joinMessage = {
            type: 'join',
            username: this.username,
            room: this.room
        };
        
        this.sendWebSocketMessage(joinMessage);
    }

    handleSendMessage(e) {
        e.preventDefault();
        
        const messageText = this.messageInput.value.trim();
        if (!messageText || !this.isConnected) return;
        
        const message = {
            type: 'message',
            content: messageText
        };
        
        this.sendWebSocketMessage(message);
        this.messageInput.value = '';
        this.toggleSendButton();
    }

    sendWebSocketMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.showError('Not connected to server');
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'join':
                this.addSystemMessage(\`\${data.username} joined the chat\`);
                break;
                
            case 'leave':
                this.addSystemMessage(\`\${data.username} left the chat\`);
                break;
                
            case 'message':
                this.addChatMessage(data);
                break;
                
            case 'user-list':
                this.updateUserList(JSON.parse(data.content));
                break;
        }
    }

    addChatMessage(data) {
        const messageDiv = document.createElement('div');
        messageDiv.className = \`message \${data.username === this.username ? 'own' : ''}\`;
        
        const isOwn = data.username === this.username;
        
        messageDiv.innerHTML = \`
            <div class="message-avatar">
                \${data.username.charAt(0).toUpperCase()}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">\${isOwn ? 'You' : data.username}</span>
                    <span class="message-time">\${this.formatTime(data.timestamp)}</span>
                </div>
                <div class="message-text">\${this.escapeHtml(data.content)}</div>
            </div>
        \`;
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        
        messageDiv.innerHTML = \`
            <div class="message-content">
                <div class="message-text">\${this.escapeHtml(text)}</div>
            </div>
        \`;
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    updateUserList(users) {
        this.userList.innerHTML = '';
        
        users.forEach(user => {
            const li = document.createElement('li');
            li.innerHTML = \`
                <i class="fas fa-user"></i>
                <span>\${user === this.username ? 'You' : user}</span>
            \`;
            this.userList.appendChild(li);
        });
    }

    handleLeave() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const leaveMessage = {
                type: 'leave'
            };
            this.sendWebSocketMessage(leaveMessage);
            this.ws.close();
        }
        
        this.handleDisconnect();
    }

    handleDisconnect() {
        this.isConnected = false;
        this.ws = null;
        
        // Show login screen again
        this.chatInterface.classList.add('hidden');
        this.loginScreen.style.display = 'flex';
        
        // Reset form
        this.loginForm.reset();
        this.messageInput.value = '';
        
        // Clear messages
        this.messagesContainer.innerHTML = '';
        this.userList.innerHTML = '';
        
        this.showInfo('You have left the chat');
    }

    toggleSendButton() {
        const hasMessage = this.messageInput.value.trim().length > 0;
        this.sendBtn.disabled = !hasMessage || !this.isConnected;
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        console.error(message);
        // You could add a toast notification here
        alert(message); // Simple fallback
    }

    showInfo(message) {
        console.log(message);
        // You could add a toast notification here
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.chatApp) {
        // Reconnect if needed when tab becomes visible
        if (!window.chatApp.isConnected) {
            window.chatApp.connectWebSocket();
        }
    }
});`;
}