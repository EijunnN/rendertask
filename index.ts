import { serve } from "bun";

// Types for our chat application
interface Message {
  id: string;
  // chat-message events + control events
  type:
    | 'join'
    | 'leave'
    | 'message'
    | 'user-list'
    | 'media-offer'
    | 'media-answer'
    | 'media-candidate'
    | 'media-stop';
  username: string;
  content?: string;
  timestamp: number;
  room?: string;

  // For WebRTC signaling (JSON strings)
  // - media-offer / media-answer: SDP
  // - media-candidate: ICE candidate
  payload?: string;
  // kind: 'screen' | 'camera'
  mediaType?: 'screen' | 'camera';
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

          case 'message': {
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
          }

          // WebRTC signaling para compartir pantalla / cámara
          case 'media-offer':
          case 'media-answer':
          case 'media-candidate':
          case 'media-stop': {
            const client = clients.get(ws);
            if (!client || !client.room) return;

            const signal: Message = {
              id: generateId(),
              type: data.type,
              username: client.username,
              timestamp: Date.now(),
              room: client.room,
              payload: data.payload,
              mediaType: data.mediaType,
            };

            // Reenviar a todos en la sala excepto el emisor
            broadcastToRoom(client.room, signal, ws);
            break;
          }

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
    <!-- Tailwind CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Tailwind config for Discord-like dark theme -->
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              bgDark: '#050816',
              bgDarker: '#020817',
              bgPanel: '#111827',
              accent: '#5865F2',
              accentSoft: '#4F46E5',
              accentDanger: '#EF4444',
              textPrimary: '#E5E7EB',
              textMuted: '#9CA3AF',
              borderSoft: 'rgba(148,163,253,0.12)'
            },
            boxShadow: {
              'soft-panel': '0 18px 45px rgba(15,23,42,0.85)',
              'soft-glow': '0 0 25px rgba(88,101,242,0.35)'
            },
            borderRadius: {
              'xl2': '1.25rem'
            }
          }
        }
      }
    </script>
    <!-- Icons -->
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
</head>
<body class="min-h-screen bg-bgDark text-textPrimary">
    <div class="flex h-screen bg-gradient-to-br from-[#020817] via-[#020817] to-[#020817]">
        <!-- Left rail (brand) -->
        <aside class="hidden sm:flex flex-col items-center py-4 w-16 bg-[#050816]/80 border-r border-zinc-800/60 backdrop-blur-xl">
            <div class="w-10 h-10 rounded-2xl bg-accent flex items-center justify-center shadow-soft-glow mb-4">
                <i class="fas fa-comments text-white"></i>
            </div>
            <div class="flex flex-col gap-3 mt-2 text-zinc-600 text-xs">
                <i class="fa-solid fa-hashtag hover:text-accent cursor-pointer"></i>
                <i class="fa-solid fa-user-group hover:text-accent cursor-pointer"></i>
                <i class="fa-solid fa-gear hover:text-accent cursor-pointer mt-2"></i>
            </div>
        </aside>

        <div class="flex-1 flex flex-col">
            <!-- Login overlay -->
            <div id="login-screen" class="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-xl">
                <div class="w-full max-w-md bg-[#020817]/95 border border-borderSoft shadow-soft-panel rounded-2xl px-8 py-7 space-y-6">
                    <div class="flex flex-col items-center gap-2">
                        <div class="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shadow-soft-glow">
                            <i class="fas fa-comments text-white"></i>
                        </div>
                        <div class="text-center">
                            <h1 class="text-xl font-semibold tracking-wide">Modern Chat</h1>
                            <p class="text-textMuted text-sm">Inspired by Discord. Join a room, chat, and share your screen or camera.</p>
                        </div>
                    </div>
                    <form id="login-form" class="space-y-4">
                        <div class="relative">
                            <i class="fas fa-user text-textMuted absolute left-3 top-2.5 text-sm"></i>
                            <input id="username" type="text"
                                class="w-full pl-9 pr-3 py-2.5 bg-[#020817] border border-zinc-800/80 rounded-xl text-sm text-textPrimary placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                                placeholder="Choose your username" required />
                        </div>
                        <div class="relative">
                            <i class="fas fa-hashtag text-textMuted absolute left-3 top-2.5 text-sm"></i>
                            <input id="room" type="text"
                                class="w-full pl-9 pr-3 py-2.5 bg-[#020817] border border-zinc-800/80 rounded-xl text-sm text-textPrimary placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                                placeholder="Room name (default: general)" value="general" />
                        </div>
                        <button type="submit"
                            class="w-full flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accentSoft text-white rounded-xl text-sm font-semibold shadow-soft-glow transition">
                            <i class="fas fa-sign-in-alt"></i>
                            Join the room
                        </button>
                    </form>
                </div>
            </div>

            <!-- Top bar -->
            <header class="flex items-center justify-between px-4 sm:px-6 py-3 bg-[#020817]/95 border-b border-zinc-800/60 backdrop-blur-xl">
                <div class="flex items-center gap-3">
                    <div class="sm:hidden w-9 h-9 rounded-2xl bg-accent flex items-center justify-center shadow-soft-glow">
                        <i class="fas fa-comments text-white text-sm"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-1.5">
                            <i class="fas fa-hashtag text-zinc-500 text-xs"></i>
                            <h2 class="text-sm sm:text-base font-semibold">Modern Chat</h2>
                        </div>
                        <span id="current-room" class="inline-flex items-center gap-1 text-[10px] text-textMuted">
                            <i class="fa-regular fa-circle text-[6px] text-emerald-400"></i>
                            #general
                        </span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1.5" id="media-controls">
                        <button id="share-screen-btn"
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-[#020817] border border-zinc-700/80 text-zinc-400 hover:text-accent hover:border-accent hover:shadow-soft-glow transition"
                            title="Share your screen">
                            <i class="fas fa-display text-xs"></i>
                        </button>
                        <button id="share-camera-btn"
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-[#020817] border border-zinc-700/80 text-zinc-400 hover:text-accent hover:border-accent hover:shadow-soft-glow transition"
                            title="Share your camera">
                            <i class="fas fa-video text-xs"></i>
                        </button>
                        <button id="stop-media-btn"
                            class="w-9 h-9 flex items-center justify-center rounded-xl bg-[#020817] border border-zinc-800/80 text-zinc-600 hover:bg-accentDanger hover:text-white hover:border-accentDanger hover:shadow-soft-glow transition"
                            title="Stop your share">
                            <i class="fas fa-ban text-xs"></i>
                        </button>
                    </div>
                    <button id="leave-btn"
                        class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111827] border border-zinc-700 text-[10px] text-zinc-300 hover:bg-accentDanger hover:text-white hover:border-accentDanger transition">
                        <i class="fas fa-sign-out-alt text-[10px]"></i>
                        Leave
                    </button>
                </div>
            </header>

            <div id="chat-interface" class="flex-1 flex overflow-hidden">
                <!-- Sidebar -->
                <aside class="hidden sm:flex flex-col w-60 bg-[#020817]/98 border-r border-zinc-800/80">
                    <div class="px-4 py-3 border-b border-zinc-800/70">
                        <h3 class="text-[10px] font-semibold text-zinc-500 tracking-[0.16em] uppercase mb-1 flex items-center gap-1.5">
                            <i class="fas fa-users text-[9px] text-zinc-500"></i>
                            Online
                        </h3>
                        <ul id="user-list" class="space-y-1.5 text-xs text-zinc-300">
                            <!-- Users inserted here -->
                        </ul>
                    </div>
                </aside>

                <!-- Main area -->
                <main class="flex-1 flex flex-col bg-[#020817]">
                    <!-- Media area -->
                    <section class="px-3 sm:px-5 pt-3 pb-2 border-b border-zinc-900/80 bg-gradient-to-b from-[#020817] via-[#020817] to-[#020817]/95">
                        <div class="flex items-center justify-between mb-2">
                            <div>
                                <div class="flex items-center gap-1.5 text-[10px] font-semibold text-accent tracking-[0.16em] uppercase">
                                    <i class="fas fa-broadcast-tower text-[9px]"></i>
                                    Live Streams
                                </div>
                                <p class="text-[10px] text-textMuted">
                                    When someone shares screen or camera, it appears here for everyone.
                                </p>
                            </div>
                        </div>
                        <div id="media-grid"
                             class="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 gap-2.5 auto-rows-[130px]">
                            <!-- Media tiles -->
                        </div>
                    </section>

                    <!-- Messages -->
                    <section class="flex-1 flex flex-col">
                        <div id="messages"
                            class="flex-1 px-3 sm:px-5 py-3 space-y-2.5 overflow-y-auto text-[11px]">
                            <!-- Messages -->
                        </div>
                        <form id="message-form"
                              class="px-3 sm:px-5 pb-3 pt-2 bg-[#020817]/98 border-t border-zinc-900/80">
                            <div class="flex items-center gap-2">
                                <input id="message-input" type="text"
                                    class="flex-1 px-3.5 py-2 rounded-2xl bg-[#020817] border border-zinc-800/80 text-[11px] text-textPrimary placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
                                    placeholder="Send a message to the room..." maxlength="500" />
                                <button id="send-btn" type="submit"
                                    class="w-9 h-9 flex items-center justify-center rounded-2xl bg-accent text-white text-xs shadow-soft-glow hover:bg-accentSoft transition disabled:opacity-40 disabled:cursor-not-allowed">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </form>
                    </section>
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
    gap: 0.85rem;
}

.header-info i {
    font-size: 1.6rem;
    color: var(--accent-primary);
    filter: drop-shadow(0 0 10px var(--glow));
}

.title-block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.header-info h2 {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: 0.02em;
}

.room-badge {
    background: var(--accent-primary);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.875rem;
    font-weight: 500;
}

.media-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-right: 0.75rem;
}

.icon-btn {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: radial-gradient(circle at 0% 0%, rgba(88,101,242,0.18), var(--bg-tertiary));
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.22s ease;
    font-size: 0.95rem;
}

.icon-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    box-shadow: 0 0 12px var(--glow);
    transform: translateY(-1px);
}

.icon-btn.danger {
    background: radial-gradient(circle at 0% 0%, rgba(237,66,69,0.22), var(--bg-tertiary));
    color: var(--error);
    border-color: rgba(237,66,69,0.4);
}

.icon-btn.danger:hover {
    background: var(--error);
    color: #fff;
    box-shadow: 0 0 18px rgba(237,66,69,0.5);
}

.leave-btn {
    background: var(--error);
    color: white;
    border: none;
    padding: 0.55rem 1.15rem;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.22s ease;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.9rem;
    font-weight: 500;
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
    gap: 0.5rem;
}

/* Media section */
.media-section {
    padding: 0.85rem 1.5rem 0.5rem;
    background: radial-gradient(circle at top left, rgba(88,101,242,0.15), transparent),
                var(--bg-secondary);
    border-bottom: 1px solid rgba(255,255,255,0.02);
    box-shadow: 0 10px 25px rgba(0,0,0,0.55);
    backdrop-filter: blur(14px);
}

.media-header {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin-bottom: 0.4rem;
}

.media-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.media-subtitle {
    font-size: 0.78rem;
    color: var(--text-muted);
}

.media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.75rem;
    margin-top: 0.25rem;
}

.media-tile {
    position: relative;
    background: radial-gradient(circle at top, rgba(88,101,242,0.12), rgba(15,17,21,1));
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.04);
    overflow: hidden;
    box-shadow: 0 8px 22px rgba(0,0,0,0.7);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
}

.media-tile video {
    width: 100%;
    height: 140px;
    object-fit: cover;
    background: #000;
}

.media-label {
    position: absolute;
    left: 8px;
    bottom: 6px;
    padding: 3px 9px;
    font-size: 0.65rem;
    border-radius: 999px;
    background: rgba(10,11,13,0.88);
    color: var(--accent-primary);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.media-label span {
    color: var(--text-secondary);
    font-weight: 500;
}

/* Messages area */
.messages-section {
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

        // WebRTC state
        this.localStream = null;
        this.peers = new Map(); // key: peerId (username or generated), value: { pc, stream, mediaType }

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

        // Media elements
        this.shareScreenBtn = document.getElementById('share-screen-btn');
        this.shareCameraBtn = document.getElementById('share-camera-btn');
        this.stopMediaBtn = document.getElementById('stop-media-btn');
        this.mediaGrid = document.getElementById('media-grid');
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

        // Media buttons
        this.shareScreenBtn.addEventListener('click', () => this.startShare('screen'));
        this.shareCameraBtn.addEventListener('click', () => this.startShare('camera'));
        this.stopMediaBtn.addEventListener('click', () => this.stopAllMedia());
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

            // WebRTC signaling: create ultra simple mesh so everyone ve la transmisión
            case 'media-offer':
                this.handleMediaOffer(data);
                break;
            case 'media-answer':
                this.handleMediaAnswer(data);
                break;
            case 'media-candidate':
                this.handleMediaCandidate(data);
                break;
            case 'media-stop':
                this.handleMediaStop(data);
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
        // Notificar fin de media si está compartiendo
        this.stopAllMedia(true);

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

    // MEDIA / WEBRTC (simple, pensado para demo en salas pequeñas)

    async startShare(kind) {
        if (!this.isConnected) {
            this.showError('Connect to a room before sharing.');
            return;
        }
        try {
            if (this.localStream) {
                this.showError('You are already sharing. Stop before starting a new share.');
                return;
            }

            const constraints =
                kind === 'screen'
                    ? { video: true, audio: false }
                    : { video: true, audio: true };

            const getMedia =
                kind === 'screen'
                    ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
                    : navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

            this.localStream = await getMedia(constraints);

            // Create an outbound peer connection representing "broadcast"
            const pc = this.createPeer('self-' + kind, kind, true);

            this.localStream.getTracks().forEach((track) => {
                pc.addTrack(track, this.localStream);
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            this.sendWebSocketMessage({
                type: 'media-offer',
                mediaType: kind,
                payload: JSON.stringify(offer),
            });

            this.renderLocalMediaTile(kind);
        } catch (err) {
            console.error(err);
            this.showError('Unable to start ' + (kind === 'screen' ? 'screen share' : 'camera') + '.');
        }
    }

    stopAllMedia(quiet = false) {
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }

        // Close all peers
        for (const [id, peer] of this.peers.entries()) {
            if (peer.pc) {
                peer.pc.close();
            }
        }
        this.peers.clear();
        this.mediaGrid.innerHTML = '';

        if (!quiet) {
            this.sendWebSocketMessage({
                type: 'media-stop',
            });
        }
    }

    createPeer(id, mediaType, isOwner = false) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
            ],
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendWebSocketMessage({
                    type: 'media-candidate',
                    mediaType,
                    payload: JSON.stringify(event.candidate),
                });
            }
        };

        pc.ontrack = (event) => {
            const [stream] = event.streams;
            this.attachRemoteStream(id, stream, mediaType);
        };

        this.peers.set(id, { pc, mediaType, isOwner });

        return pc;
    }

    async handleMediaOffer(data) {
        const id = data.username + '-' + (data.mediaType || 'media');
        const pc = this.createPeer(id, data.mediaType || 'screen', false);

        const offer = JSON.parse(data.payload);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendWebSocketMessage({
            type: 'media-answer',
            mediaType: data.mediaType,
            payload: JSON.stringify(answer),
        });
    }

    async handleMediaAnswer(data) {
        // Apply answer to all local owner peers
        for (const [id, peer] of this.peers.entries()) {
            if (peer.isOwner && peer.pc.signalingState === 'have-local-offer') {
                const answer = JSON.parse(data.payload);
                await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
            }
        }
    }

    async handleMediaCandidate(data) {
        try {
            const candidate = JSON.parse(data.payload);
            for (const [, peer] of this.peers.entries()) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (e) {
            console.error('Error applying ICE candidate', e);
        }
    }

    handleMediaStop(data) {
        // Remote owner stopped sharing → clear UI
        this.mediaGrid.innerHTML = '';
        for (const [id, peer] of this.peers.entries()) {
            if (!peer.isOwner) {
                peer.pc.close();
                this.peers.delete(id);
            }
        }
    }

    attachRemoteStream(id, stream, mediaType) {
        let tile = document.querySelector(\`.media-tile[data-id="\${id}"]\`);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'media-tile';
            tile.dataset.id = id;

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.muted = false;

            const label = document.createElement('div');
            label.className = 'media-label';
            label.innerHTML = \`
                <i class="fas \${mediaType === 'screen' ? 'fa-display' : 'fa-video'}"></i>
                <span>\${mediaType === 'screen' ? 'Screen' : 'Camera'} • Live</span>
            \`;

            tile.appendChild(video);
            tile.appendChild(label);
            this.mediaGrid.appendChild(tile);
        }

        const videoEl = tile.querySelector('video');
        videoEl.srcObject = stream;
    }

    renderLocalMediaTile(mediaType) {
        if (!this.localStream) return;

        const id = 'local-' + mediaType;
        let tile = document.querySelector(\`.media-tile[data-id="\${id}"]\`);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'media-tile';
            tile.dataset.id = id;

            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;

            const label = document.createElement('div');
            label.className = 'media-label';
            label.innerHTML = \`
                <i class="fas \${mediaType === 'screen' ? 'fa-display' : 'fa-video'}"></i>
                <span>You • \${mediaType === 'screen' ? 'Screen' : 'Camera'}</span>
            \`;

            tile.appendChild(video);
            tile.appendChild(label);
            this.mediaGrid.prepend(tile);
        }

        const videoEl = tile.querySelector('video');
        videoEl.srcObject = this.localStream;
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