// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Complete Enhanced Server
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(express.json({ limit: '100mb' }));

const DATA_FILE = 'cold_room_data.json';

let systemSettings = {
  siteLogo: 'https://j.top4top.io/p_3585vud691.jpg',
  siteTitle: 'Cold Room',
  backgroundColor: 'blue',
  loginMusic: '',
  chatMusic: '',
  loginMusicVolume: 0.5,
  chatMusicVolume: 0.5,
  partyMode: {},
  video: null
};

let data = {
  users: {},
  rooms: {},
  mutedUsers: {},
  bannedUsers: {},
  bannedIPs: {},
  privateMessages: {},
  supportMessages: {},
  blockedUsers: {},
  systemSettings
};

const users = new Map();
const rooms = new Map();
const mutedUsers = new Map();
const bannedUsers = new Map();
const bannedIPs = new Map();
const privateMessages = new Map();
const supportMessages = new Map();
const onlineUsers = new Map();
const blockedUsers = new Map();

// Load data
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(content);
      data = { ...data, ...loaded };
      
      Object.entries(data.users || {}).forEach(([k,v]) => users.set(k, v));
      Object.entries(data.rooms || {}).forEach(([k,v]) => rooms.set(k, v));
      Object.entries(data.mutedUsers || {}).forEach(([k,v]) => mutedUsers.set(k, v));
      Object.entries(data.bannedUsers || {}).forEach(([k,v]) => bannedUsers.set(k, v));
      Object.entries(data.bannedIPs || {}).forEach(([k,v]) => bannedIPs.set(k, v));
      Object.entries(data.privateMessages || {}).forEach(([k,v]) => privateMessages.set(k, v));
      Object.entries(data.supportMessages || {}).forEach(([k,v]) => supportMessages.set(k, v));
      Object.entries(data.blockedUsers || {}).forEach(([k,v]) => blockedUsers.set(k, new Set(v)));
      
      systemSettings = loaded.systemSettings || systemSettings;
      console.log('✅ Data loaded from', DATA_FILE);
    } else {
      console.log('⚠️ Data file not found — starting fresh');
    }
  } catch (e) {
    console.error('❌ loadData error', e);
  }
}

// Save data
function saveData() {
  try {
    const toSave = {
      users: Object.fromEntries(users),
      rooms: Object.fromEntries(rooms),
      mutedUsers: Object.fromEntries(mutedUsers),
      bannedUsers: Object.fromEntries(bannedUsers),
      bannedIPs: Object.fromEntries(bannedIPs),
      privateMessages: Object.fromEntries(privateMessages),
      supportMessages: Object.fromEntries(supportMessages),
      blockedUsers: Object.fromEntries(
        Array.from(blockedUsers.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      systemSettings
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ saveData error', e);
  }
}

// Initialize owner and global room
function createOwnerIfMissing() {
  const ownerId = 'owner_cold_001';
  if (!users.has(ownerId)) {
    const owner = {
      id: ownerId,
      username: 'COLDKING',
      displayName: 'Cold Room King',
      password: bcrypt.hashSync('ColdKing@2025', 10),
      isOwner: true,
      avatar: '👑',
      gender: 'prince',
      specialBadges: ['👑'],
      joinDate: new Date().toISOString(),
      canSendImages: true,
      canSendVideos: true,
      nameChangeCount: 0,
      profilePicture: null
    };
    users.set(ownerId, owner);
    privateMessages.set(ownerId, {});
    console.log('✅ Owner created: COLDKING / ColdKing@2025');
  }
}

function createGlobalRoomIfMissing() {
  const globalId = 'global_cold';
  if (!rooms.has(globalId)) {
    rooms.set(globalId, {
      id: globalId,
      name: '❄️ Cold Room - Global',
      description: 'Main room for everyone',
      createdBy: 'Cold Room King',
      creatorId: 'owner_cold_001',
      users: [],
      messages: [],
      isOfficial: true,
      moderators: [],
      isSilenced: false,
      hasPassword: false,
      password: null,
      createdAt: new Date().toISOString(),
      videoUrl: null,
      musicUrl: null,
      musicVolume: 0.5
    });
    console.log('✅ Global room created');
  }
}

// Broadcast functions
function updateRoomsList() {
  try {
    const roomsArray = Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdBy: r.createdBy,
      userCount: (r.users || []).length,
      hasPassword: !!r.hasPassword,
      isOfficial: !!r.isOfficial
    }));
    io.emit('rooms-list', roomsArray);
  } catch (e) {
    console.error(e);
  }
}

function updateUsersList(roomId) {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    const usersArray = (room.users || []).map(uid => {
      const u = users.get(uid);
      if (!u) return null;
      return {
        id: u.id,
        displayName: u.displayName,
        avatar: u.avatar,
        profilePicture: u.profilePicture,
        isOwner: !!u.isOwner,
        isModerator: room.moderators.includes(u.id),
        isOnline: onlineUsers.has(u.id)
      };
    }).filter(Boolean);
    io.to(roomId).emit('users-list', usersArray);
  } catch (e) {
    console.error(e);
  }
}

function setPartyMode(roomId, enabled) {
  systemSettings.partyMode = systemSettings.partyMode || {};
  systemSettings.partyMode[roomId] = !!enabled;
  io.to(roomId).emit('party-mode-changed', { enabled: !!enabled, roomId });
  saveData();
}

// Load and initialize
loadData();
createOwnerIfMissing();
createGlobalRoomIfMissing();
saveData();

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/settings', (req, res) => res.json(systemSettings));

// Socket handlers
io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address || socket.conn.remoteAddress || '';

  // LOGIN
  socket.on('login', (payload) => {
    try {
      const { username, password } = payload || {};
      if (!username || !password) return socket.emit('login-error', 'Missing credentials');

      let foundId = null;
      for (const [id, u] of users.entries()) {
        if (u.username.toLowerCase() === username.toLowerCase() &&
            bcrypt.compareSync(password, u.password)) {
          foundId = id;
          break;
        }
      }
      if (!foundId) return socket.emit('login-error', 'Invalid credentials');
      if (bannedUsers.has(foundId)) return socket.emit('banned-user', { reason: 'Banned' });

      const user = users.get(foundId);
      socket.userId = foundId;
      socket.userData = user;
      onlineUsers.set(foundId, Date.now());

      const globalRoom = rooms.get('global_cold');
      if (globalRoom && !globalRoom.users.includes(foundId)) globalRoom.users.push(foundId);
      socket.join('global_cold');
      socket.currentRoom = 'global_cold';

      const userBlockedList = blockedUsers.get(foundId) || new Set();

      socket.emit('login-success', {
        user: {
          id: foundId,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          gender: user.gender,
          isOwner: user.isOwner,
          isModerator: globalRoom ? globalRoom.moderators.includes(foundId) : false,
          canSendImages: user.canSendImages,
          canSendVideos: user.canSendVideos,
          specialBadges: user.specialBadges || [],
          nameChangeCount: user.nameChangeCount || 0,
          profilePicture: user.profilePicture
        },
        room: {
          id: globalRoom.id,
          name: globalRoom.name,
          messages: (globalRoom.messages || []).slice(-50),
          partyMode: systemSettings.partyMode[globalRoom.id] || false,
          moderators: globalRoom.moderators || []
        },
        systemSettings,
        video: systemSettings.video,
        blockedUsers: Array.from(userBlockedList)
      });

      updateRoomsList();
      updateUsersList('global_cold');
    } catch (e) {
      console.error('login error', e);
    }
  });

  // REGISTER
  socket.on('register', (payload) => {
    try {
      const { username, password, displayName, gender } = payload || {};
      if (!username || !password || !displayName) return socket.emit('register-error', 'Missing fields');

      for (const u of users.values()) {
        if (u.username.toLowerCase() === username.toLowerCase()) return socket.emit('register-error', 'Username exists');
        if (u.displayName.toLowerCase() === displayName.toLowerCase()) return socket.emit('register-error', 'Display name exists');
      }

      const userId = 'user_' + uuidv4();
      const newUser = {
        id: userId,
        username,
        displayName,
        password: bcrypt.hashSync(password, 10),
        isOwner: false,
        joinDate: new Date().toISOString(),
        avatar: gender === 'prince' ? '🤴' : '👸',
        gender: gender || 'unknown',
        specialBadges: [],
        canSendImages: false,
        canSendVideos: false,
        nameChangeCount: 0,
        profilePicture: null
      };
      users.set(userId, newUser);
      privateMessages.set(userId, {});
      blockedUsers.set(userId, new Set());
      saveData();
      socket.emit('register-success', { message: 'Account created!', username });
    } catch (e) {
      console.error('register error', e);
    }
  });

  // PROFILE PICTURE
  socket.on('update-profile-picture', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      
      user.profilePicture = payload.profilePicture || null;
      saveData();
      
      socket.emit('profile-updated', {
        userId: socket.userId,
        profilePicture: user.profilePicture,
        message: 'Profile picture updated'
      });
      
      if (socket.currentRoom) updateUsersList(socket.currentRoom);
    } catch (e) {
      console.error('update-profile-picture error', e);
    }
  });

  // NAME CHANGE
  socket.on('change-display-name', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      
      const newName = (payload.newName || '').toString().trim();
      if (!newName || newName.length < 3 || newName.length > 30) {
        return socket.emit('error', 'Name must be 3-30 characters');
      }

      for (const [id, u] of users.entries()) {
        if (id !== socket.userId && u.displayName.toLowerCase() === newName.toLowerCase()) {
          return socket.emit('error', 'Display name already taken');
        }
      }

      if (user.isOwner) {
        user.displayName = newName;
        socket.emit('action-success', 'Name changed successfully');
        saveData();
        if (socket.currentRoom) updateUsersList(socket.currentRoom);
        return;
      }

      const changeCount = user.nameChangeCount || 0;
      if (changeCount >= 2) {
        return socket.emit('error', 'Maximum free changes used. Submit a request instead.');
      }

      user.displayName = newName;
      user.nameChangeCount = changeCount + 1;
      
      const remaining = 2 - user.nameChangeCount;
      socket.emit('action-success', `Name changed! ${remaining} free changes remaining`);
      saveData();
      if (socket.currentRoom) updateUsersList(socket.currentRoom);
    } catch (e) {
      console.error('change-display-name error', e);
    }
  });

  socket.on('request-name-change', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      
      const id = 'namechange_' + uuidv4();
      supportMessages.set(id, {
        id,
        type: 'name_change_request',
        from: user.displayName,
        userId: socket.userId,
        currentName: user.displayName,
        requestedName: (payload.newName || '').toString().trim(),
        message: `Name change request: "${user.displayName}" → "${payload.newName}"`,
        sentAt: new Date().toISOString(),
        fromIP: socket.userIP || ''
      });
      saveData();
      socket.emit('action-success', 'Name change request sent to owner');
    } catch (e) {
      console.error('request-name-change error', e);
    }
  });

  socket.on('approve-name-change', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      
      const request = supportMessages.get(payload.requestId);
      if (!request || request.type !== 'name_change_request') {
        return socket.emit('error', 'Request not found');
      }

      const targetUser = users.get(request.userId);
      if (!targetUser) return socket.emit('error', 'User not found');

      for (const [id, u] of users.entries()) {
        if (id !== request.userId && u.displayName.toLowerCase() === request.requestedName.toLowerCase()) {
          return socket.emit('error', 'Name already taken');
        }
      }

      targetUser.displayName = request.requestedName;
      supportMessages.delete(payload.requestId);
      saveData();
      
      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === request.userId);
      if (targetSocket) {
        targetSocket.emit('action-success', `Your name has been changed to: ${request.requestedName}`);
        if (targetSocket.currentRoom) updateUsersList(targetSocket.currentRoom);
      }
      
      socket.emit('action-success', 'Name change approved');
    } catch (e) {
      console.error('approve-name-change error', e);
    }
  });

  // SEND MESSAGE
  socket.on('send-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(socket.currentRoom);
      if (!user || !room) return socket.emit('error', 'Not in room or not authenticated');

      const mute = mutedUsers.get(socket.userId);
      if (mute && mute.expires && Date.now() > mute.expires) mutedUsers.delete(socket.userId);
      if (mutedUsers.has(socket.userId)) return socket.emit('error', 'You are muted');

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        profilePicture: user.profilePicture,
        text: (payload.text || '').toString().substring(0, 1000),
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        isModerator: room.moderators.includes(socket.userId),
        roomId: socket.currentRoom,
        edited: false,
        isImage: false,
        isVideo: false
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-message error', e);
    }
  });

  // EDIT MESSAGE
  socket.on('edit-message', (payload) => {
    try {
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const idx = (room.messages || []).findIndex(m => m.id === payload.messageId && m.userId === socket.userId);
      if (idx === -1) return socket.emit('error', 'Message not found or permission denied');
      room.messages[idx].text = (payload.newText || '').toString().substring(0, 1000);
      room.messages[idx].edited = true;
      io.to(socket.currentRoom).emit('message-edited', { messageId: payload.messageId, newText: room.messages[idx].text });
      saveData();
    } catch (e) {
      console.error('edit-message error', e);
    }
  });

  // SEND IMAGE
  socket.on('send-image', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendImages) return socket.emit('error', 'No permission to send images');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        profilePicture: user.profilePicture,
        imageUrl: payload.imageUrl || '',
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        roomId: socket.currentRoom,
        isImage: true,
        isVideo: false
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-image error', e);
    }
  });

  // SEND VIDEO
  socket.on('send-video', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendVideos) return socket.emit('error', 'No permission to send videos');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        profilePicture: user.profilePicture,
        videoUrl: payload.videoUrl || '',
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        roomId: socket.currentRoom,
        isImage: false,
        isVideo: true
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-video error', e);
    }
  });

  // Continue in next part...
      // ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Server Part 2 (Continuation)
// ═══════════════════════════════════════════════════════════════

  // ROOM MANAGEMENT
  socket.on('create-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      const roomId = 'room_' + uuidv4();
      const newRoom = {
        id: roomId,
        name: (payload.name || 'Untitled').toString().substring(0, 100),
        description: (payload.description || '').toString().substring(0, 500),
        createdBy: user.displayName,
        creatorId: socket.userId,
        users: [socket.userId],
        messages: [],
        isOfficial: false,
        hasPassword: !!payload.password,
        password: payload.password ? bcrypt.hashSync(payload.password.toString(), 10) : null,
        moderators: [],
        isSilenced: false,
        createdAt: new Date().toISOString(),
        videoUrl: null,
        musicUrl: null,
        musicVolume: 0.5
      };
      rooms.set(roomId, newRoom);
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.emit('room-created', { roomId, roomName: newRoom.name });
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error('create-room error', e);
    }
  });

  socket.on('join-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');

      if (room.hasPassword && !user.isOwner) {
        if (!payload.password || !bcrypt.compareSync(payload.password.toString(), room.password)) {
          return socket.emit('error', 'Wrong password');
        }
      }

      if (socket.currentRoom) {
        const prev = rooms.get(socket.currentRoom);
        if (prev) prev.users = (prev.users || []).filter(u => u !== socket.userId);
        socket.leave(socket.currentRoom);
      }

      if (!room.users.includes(socket.userId)) room.users.push(socket.userId);
      socket.join(room.id);
      socket.currentRoom = room.id;

      socket.emit('room-joined', {
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          messages: (room.messages || []).slice(-50),
          isCreator: room.creatorId === socket.userId,
          isModerator: room.moderators.includes(socket.userId),
          partyMode: systemSettings.partyMode[room.id] || false,
          moderators: room.moderators || []
        },
        video: systemSettings.video
      });

      updateUsersList(room.id);
      saveData();
    } catch (e) {
      console.error('join-room error', e);
    }
  });

  socket.on('update-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      if (payload.name !== undefined) room.name = payload.name.toString().substring(0, 100);
      if (payload.description !== undefined) room.description = payload.description.toString().substring(0, 500);
      if (payload.password !== undefined) {
        room.hasPassword = !!payload.password;
        room.password = payload.password ? bcrypt.hashSync(payload.password.toString(), 10) : null;
      }
      io.to(room.id).emit('room-updated', { name: room.name, description: room.description });
      saveData();
    } catch (e) {
      console.error('update-room error', e);
    }
  });

  socket.on('delete-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room || room.isOfficial) return socket.emit('error', 'Cannot delete room');
      io.to(payload.roomId).emit('room-deleted', { message: 'Room deleted' });
      rooms.delete(payload.roomId);
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error('delete-room error', e);
    }
  });

  socket.on('clean-chat', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.messages = [];
      io.to(payload.roomId).emit('chat-cleaned', { message: 'Chat cleaned' });
      saveData();
    } catch (e) {
      console.error('clean-chat error', e);
    }
  });

  socket.on('clean-all-rooms', () => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      rooms.forEach(room => {
        room.messages = [];
        io.to(room.id).emit('chat-cleaned', { message: 'All chats cleaned' });
      });
      saveData();
    } catch (e) {
      console.error('clean-all-rooms error', e);
    }
  });

  // ROOM MEDIA SETTINGS
  socket.on('get-room-media', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      socket.emit('room-media-data', {
        roomId: room.id,
        videoUrl: room.videoUrl,
        musicUrl: room.musicUrl,
        musicVolume: room.musicVolume || 0.5
      });
    } catch (e) {
      console.error('get-room-media error', e);
    }
  });

  socket.on('update-room-media', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');

      if (payload.type === 'video') {
        room.videoUrl = payload.videoUrl || null;
        io.to(payload.roomId).emit('room-media-updated', {
          roomId: payload.roomId,
          type: 'video',
          videoUrl: room.videoUrl,
          message: room.videoUrl ? 'Room video updated' : 'Room video removed'
        });
      } else if (payload.type === 'music') {
        room.musicUrl = payload.musicUrl || null;
        room.musicVolume = payload.musicVolume || 0.5;
        io.to(payload.roomId).emit('room-media-updated', {
          roomId: payload.roomId,
          type: 'music',
          musicUrl: room.musicUrl,
          musicVolume: room.musicVolume,
          message: room.musicUrl ? 'Room music updated' : 'Room music removed'
        });
      }

      saveData();
    } catch (e) {
      console.error('update-room-media error', e);
    }
  });

  // MODERATION
  socket.on('mute-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      const target = users.get(payload.userId);
      if (!admin || !target) return socket.emit('error', 'Invalid user');
      if (target.isOwner) return socket.emit('error', 'Cannot mute owner');

      const durationMin = parseInt(payload.duration) || 0;
      const expires = durationMin > 0 ? Date.now() + durationMin * 60000 : null;
      mutedUsers.set(payload.userId, {
        username: target.displayName,
        expires,
        reason: payload.reason || 'Rule violation',
        mutedBy: admin.displayName,
        mutedById: socket.userId,
        temporary: !!expires,
        byOwner: !!admin.isOwner,
        roomId: payload.roomId || socket.currentRoom
      });
      saveData();
      socket.emit('action-success', `Muted ${target.displayName}`);
    } catch (e) {
      console.error('mute-user error', e);
    }
  });

  socket.on('unmute-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin) return socket.emit('error', 'Not authenticated');
      
      const muteInfo = mutedUsers.get(payload.userId);
      if (!muteInfo) return socket.emit('action-success', 'User not muted');

      if (admin.isOwner) {
        mutedUsers.delete(payload.userId);
        saveData();
        return socket.emit('action-success', 'User unmuted');
      }

      if (admin.isModerator && (muteInfo.mutedById === socket.userId || !muteInfo.byOwner)) {
        mutedUsers.delete(payload.userId);
        saveData();
        return socket.emit('action-success', 'User unmuted');
      }

      socket.emit('error', 'You can only unmute users you muted');
    } catch (e) {
      console.error('unmute-user error', e);
    }
  });

  socket.on('ban-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      const target = users.get(payload.userId);
      if (!admin?.isOwner) return socket.emit('error', 'Only owner can ban');
      if (!target || target.isOwner) return socket.emit('error', 'Invalid target');
      bannedUsers.set(payload.userId, {
        username: target.displayName,
        reason: payload.reason || 'Violation',
        bannedBy: admin.displayName,
        bannedAt: Date.now()
      });
      saveData();
      const tSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.userId);
      if (tSocket) {
        try { tSocket.emit('banned', { reason: payload.reason || 'Violation' }); tSocket.disconnect(true); } catch {}
      }
      socket.emit('action-success', `Banned ${target.displayName}`);
    } catch (e) {
      console.error('ban-user error', e);
    }
  });

  socket.on('unban-user', (payload) => {
    try {
      bannedUsers.delete(payload.userId);
      saveData();
      socket.emit('action-success', 'User unbanned');
    } catch (e) {
      console.error('unban-user error', e);
    }
  });

  socket.on('add-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      if (!room.moderators.includes(payload.userId)) room.moderators.push(payload.userId);
      saveData();
      socket.emit('action-success', `${payload.username} is now moderator`);
    } catch (e) {
      console.error('add-moderator error', e);
    }
  });

  socket.on('remove-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.moderators = (room.moderators || []).filter(id => id !== payload.userId);
      saveData();
      socket.emit('action-success', `${payload.username} removed from moderators`);
    } catch (e) {
      console.error('remove-moderator error', e);
    }
  });

  // PRIVATE MESSAGES
  socket.on('send-private-message', (payload) => {
    try {
      const sender = users.get(socket.userId);
      const receiver = users.get(payload.toUserId);
      if (!sender || !receiver) return socket.emit('error', 'Invalid users');

      const receiverBlocked = blockedUsers.get(payload.toUserId) || new Set();
      if (receiverBlocked.has(socket.userId)) {
        return socket.emit('error', 'You are blocked by this user');
      }

      const message = {
        id: 'pm_' + uuidv4(),
        from: socket.userId,
        to: payload.toUserId,
        fromName: sender.displayName,
        text: (payload.text || '').toString().substring(0, 1000),
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        edited: false
      };

      if (!privateMessages.has(socket.userId)) privateMessages.set(socket.userId, {});
      const smap = privateMessages.get(socket.userId);
      if (!smap[payload.toUserId]) smap[payload.toUserId] = [];
      smap[payload.toUserId].push(message);

      if (!privateMessages.has(payload.toUserId)) privateMessages.set(payload.toUserId, {});
      const rmap = privateMessages.get(payload.toUserId);
      if (!rmap[socket.userId]) rmap[socket.userId] = [];
      rmap[socket.userId].push(message);

      const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.toUserId);
      if (receiverSocket) receiverSocket.emit('new-private-message', message);

      socket.emit('private-message-sent', message);
      saveData();
    } catch (e) {
      console.error('send-private-message error', e);
    }
  });

  socket.on('get-private-messages', (payload) => {
    try {
      const list = privateMessages.get(socket.userId)?.[payload.withUserId] || [];
      socket.emit('private-messages-list', { withUserId: payload.withUserId, messages: list.slice(-200) });
    } catch (e) {
      console.error('get-private-messages error', e);
    }
  });

  socket.on('block-user', (payload) => {
    try {
      if (!blockedUsers.has(socket.userId)) blockedUsers.set(socket.userId, new Set());
      blockedUsers.get(socket.userId).add(payload.userId);
      saveData();
      socket.emit('action-success', 'User blocked');
    } catch (e) {
      console.error('block-user error', e);
    }
  });

  socket.on('unblock-user', (payload) => {
    try {
      if (blockedUsers.has(socket.userId)) {
        blockedUsers.get(socket.userId).delete(payload.userId);
        saveData();
      }
      socket.emit('action-success', 'User unblocked');
    } catch (e) {
      console.error('unblock-user error', e);
    }
  });

  // Continue to final part...
      // ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Server Final Part
// ═══════════════════════════════════════════════════════════════

  // SUPPORT MESSAGES
  socket.on('send-support-message', (payload) => {
    try {
      const id = 'support_' + uuidv4();
      supportMessages.set(id, {
        id,
        from: payload.from || (socket.userId ? (users.get(socket.userId)?.displayName || 'User') : 'Anonymous'),
        message: (payload.message || '').toString().substring(0, 1000),
        sentAt: new Date().toISOString(),
        fromIP: socket.userIP || ''
      });
      saveData();
      socket.emit('support-message-sent', { message: 'Message sent' });
    } catch (e) {
      console.error('send-support-message error', e);
    }
  });

  socket.on('get-support-messages', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      socket.emit('support-messages-list', Array.from(supportMessages.values()));
    } catch (e) {
      console.error('get-support-messages error', e);
    }
  });

  socket.on('delete-support-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      supportMessages.delete(payload.messageId);
      saveData();
      socket.emit('action-success', 'Message deleted');
    } catch (e) {
      console.error('delete-support-message error', e);
    }
  });

  // LISTS
  socket.on('get-rooms', () => {
    try {
      const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        userCount: (room.users || []).length,
        hasPassword: !!room.hasPassword,
        isOfficial: !!room.isOfficial,
        createdBy: room.createdBy
      })).sort((a, b) => {
        if (a.isOfficial && !b.isOfficial) return -1;
        if (!a.isOfficial && b.isOfficial) return 1;
        return b.userCount - a.userCount;
      });
      socket.emit('rooms-list', roomList);
    } catch (e) {
      console.error('get-rooms error', e);
    }
  });

  socket.on('get-users', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('users-list', []);
      const list = (room.users || []).map(uid => {
        const u = users.get(uid);
        if (!u) return null;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          profilePicture: u.profilePicture,
          isOnline: onlineUsers.has(u.id),
          isOwner: !!u.isOwner,
          isModerator: room.moderators.includes(u.id),
          specialBadges: u.specialBadges || []
        };
      }).filter(Boolean);
      socket.emit('users-list', list);
    } catch (e) {
      console.error('get-users error', e);
    }
  });

  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user || (!user.isOwner && !user.isModerator)) return socket.emit('error', 'No permission');
      
      let list = Array.from(mutedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      
      if (user.isModerator && !user.isOwner) {
        list = list.filter(item => item.mutedById === socket.userId || !item.byOwner);
      }
      
      socket.emit('muted-list', list);
    } catch (e) {
      console.error('get-muted-list error', e);
    }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      const list = Array.from(bannedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      socket.emit('banned-list', list);
    } catch (e) {
      console.error('get-banned-list error', e);
    }
  });

  // DELETE ACCOUNT
  socket.on('delete-account', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const target = users.get(payload.userId);
      if (!target || target.isOwner) return socket.emit('error', 'Invalid target');

      rooms.forEach(room => {
        room.messages = (room.messages || []).filter(m => m.userId !== payload.userId);
        room.users = (room.users || []).filter(u => u !== payload.userId);
        room.moderators = (room.moderators || []).filter(m => m !== payload.userId);
      });

      users.delete(payload.userId);
      privateMessages.delete(payload.userId);
      mutedUsers.delete(payload.userId);
      bannedUsers.delete(payload.userId);
      blockedUsers.delete(payload.userId);

      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.userId);
      if (targetSocket) {
        try { targetSocket.emit('account-deleted', { message: 'Account deleted' }); targetSocket.disconnect(true); } catch {}
      }
      saveData();
      updateRoomsList();
      socket.emit('action-success', `Deleted: ${payload.userId}`);
    } catch (e) {
      console.error('delete-account error', e);
    }
  });

  // DELETE MESSAGE
  socket.on('delete-message', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.messages = (room.messages || []).filter(m => m.id !== payload.messageId);
      io.to(payload.roomId).emit('message-deleted', { messageId: payload.messageId });
      saveData();
    } catch (e) {
      console.error('delete-message error', e);
    }
  });

  // BULK OPERATIONS
  socket.on('unmute-multiple', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      (payload.userIds || []).forEach(uid => mutedUsers.delete(uid));
      saveData();
      socket.emit('action-success', 'Users unmuted');
    } catch (e) {
      console.error('unmute-multiple error', e);
    }
  });

  socket.on('unban-multiple', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      (payload.userIds || []).forEach(uid => bannedUsers.delete(uid));
      saveData();
      socket.emit('action-success', 'Users unbanned');
    } catch (e) {
      console.error('unban-multiple error', e);
    }
  });

  // ROOM CONTROLS
  socket.on('silence-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.isSilenced = true;
      io.to(payload.roomId).emit('room-silenced', { message: 'Room silenced', forceDisable: true });
      saveData();
    } catch (e) {
      console.error('silence-room error', e);
    }
  });

  socket.on('unsilence-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.isSilenced = false;
      io.to(payload.roomId).emit('room-unsilenced', { message: 'Room unsilenced' });
      saveData();
    } catch (e) {
      console.error('unsilence-room error', e);
    }
  });

  // VIDEO WATCH
  socket.on('start-video-watch', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!payload || !payload.url) return socket.emit('error', 'Missing video URL');
      
      systemSettings.video = {
        url: payload.url.toString(),
        type: payload.type || 'youtube',
        startedAt: Date.now(),
        size: payload.size || 'medium',
        startedBy: user.displayName
      };
      
      io.to('global_cold').emit('video-started', systemSettings.video);
      saveData();
    } catch (e) {
      console.error('start-video-watch error', e);
    }
  });

  socket.on('stop-video-watch', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      systemSettings.video = null;
      io.to('global_cold').emit('video-stopped');
      saveData();
    } catch (e) {
      console.error('stop-video-watch error', e);
    }
  });

  socket.on('video-resize', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!systemSettings.video) return socket.emit('error', 'No video session');
      systemSettings.video.size = payload.size || systemSettings.video.size || 'medium';
      io.to('global_cold').emit('video-resize', { size: systemSettings.video.size });
      saveData();
    } catch (e) {
      console.error('video-resize error', e);
    }
  });

  // PARTY MODE
  socket.on('toggle-party-mode', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(payload.roomId || socket.currentRoom);
      if (!user || !room) return socket.emit('error', 'Invalid request');
      const allowed = user.isOwner || room.moderators.includes(socket.userId);
      if (!allowed) return socket.emit('error', 'No permission');
      setPartyMode(room.id, !!payload.enabled);
    } catch (e) {
      console.error('toggle-party-mode error', e);
    }
  });

  // SETTINGS
  socket.on('update-settings', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      
      if (payload.siteLogo !== undefined) systemSettings.siteLogo = payload.siteLogo;
      if (payload.siteTitle !== undefined) systemSettings.siteTitle = payload.siteTitle;
      if (payload.backgroundColor !== undefined) systemSettings.backgroundColor = payload.backgroundColor;
      if (payload.loginMusic !== undefined) {
        systemSettings.loginMusic = payload.loginMusic;
        io.emit('settings-updated', systemSettings);
      }
      if (payload.chatMusic !== undefined) {
        systemSettings.chatMusic = payload.chatMusic;
        io.emit('settings-updated', systemSettings);
      }
      if (payload.loginMusicVolume !== undefined) systemSettings.loginMusicVolume = Number(payload.loginMusicVolume) || 0.5;
      if (payload.chatMusicVolume !== undefined) systemSettings.chatMusicVolume = Number(payload.chatMusicVolume) || 0.5;
      
      if (payload.loginMusic === undefined && payload.chatMusic === undefined) {
        io.emit('settings-updated', systemSettings);
      }
      
      saveData();
      socket.emit('action-success', 'Settings updated');
    } catch (e) {
      console.error('update-settings error', e);
    }
  });

  // PING
  socket.on('ping', () => {
    try {
      if (socket.userId) onlineUsers.set(socket.userId, Date.now());
    } catch (e) {
      console.error('ping error', e);
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        rooms.forEach(room => {
          room.users = (room.users || []).filter(u => u !== socket.userId);
        });
      }
      console.log('🔌 Disconnect:', socket.id);
    } catch (e) {
      console.error('disconnect error', e);
    }
  });
});

// Periodic autosave
setInterval(() => {
  try { saveData(); } catch (e) { console.error(e); }
}, 30000);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Cold Room V3.0 server running on port ${PORT}`);
  console.log(`✅ All features enabled and ready!`);
});

// ═══════════════════════════════════════════════════════════════
// END - Cold Room V3.0 Complete Server
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════
