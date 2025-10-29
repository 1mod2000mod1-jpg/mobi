// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Complete Server (Single File)
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
      console.log('✅ Data loaded');
    }
  } catch (e) {
    console.error('❌ loadData error', e);
  }
}

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
    console.log('✅ Owner: COLDKING / ColdKing@2025');
  }
}

function createGlobalRoomIfMissing() {
  const globalId = 'global_cold';
  if (!rooms.has(globalId)) {
    rooms.set(globalId, {
      id: globalId,
      name: '❄️ Cold Room - Global',
      description: 'Main room',
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

loadData();
createOwnerIfMissing();
createGlobalRoomIfMissing();
saveData();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/settings', (req, res) => res.json(systemSettings));

io.on('connection', (socket) => {
  console.log('🔗 Connected:', socket.id);
  socket.userIP = socket.handshake.address || '';

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
      socket.emit('login-error', 'Login failed');
    }
  });

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
      socket.emit('register-error', 'Registration failed');
    }
  });

  socket.on('update-profile-picture', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      user.profilePicture = payload.profilePicture || null;
      saveData();
      socket.emit('profile-updated', { userId: socket.userId, profilePicture: user.profilePicture, message: 'Profile updated' });
      if (socket.currentRoom) updateUsersList(socket.currentRoom);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('change-display-name', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      const newName = (payload.newName || '').toString().trim();
      if (!newName || newName.length < 3 || newName.length > 30) return socket.emit('error', 'Name: 3-30 chars');
      for (const [id, u] of users.entries()) {
        if (id !== socket.userId && u.displayName.toLowerCase() === newName.toLowerCase()) return socket.emit('error', 'Name taken');
      }
      if (user.isOwner) {
        user.displayName = newName;
        socket.emit('action-success', 'Name changed');
        saveData();
        if (socket.currentRoom) updateUsersList(socket.currentRoom);
        return;
      }
      const changeCount = user.nameChangeCount || 0;
      if (changeCount >= 2) return socket.emit('error', 'Max changes used. Submit request.');
      user.displayName = newName;
      user.nameChangeCount = changeCount + 1;
      socket.emit('action-success', `Name changed! ${2 - user.nameChangeCount} left`);
      saveData();
      if (socket.currentRoom) updateUsersList(socket.currentRoom);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('request-name-change', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;
      const id = 'namechange_' + uuidv4();
      supportMessages.set(id, {
        id, type: 'name_change_request', from: user.displayName, userId: socket.userId,
        currentName: user.displayName, requestedName: payload.newName,
        message: `Name: "${user.displayName}" → "${payload.newName}"`,
        sentAt: new Date().toISOString()
      });
      saveData();
      socket.emit('action-success', 'Request sent');
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('approve-name-change', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const req = supportMessages.get(payload.requestId);
      if (!req) return;
      const target = users.get(req.userId);
      if (!target) return;
      target.displayName = req.requestedName;
      supportMessages.delete(payload.requestId);
      saveData();
      socket.emit('action-success', 'Approved');
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('send-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(socket.currentRoom);
      if (!user || !room) return;
      if (mutedUsers.has(socket.userId)) return socket.emit('error', 'Muted');
      const message = {
        id: 'msg_' + uuidv4(), userId: socket.userId, username: user.displayName,
        avatar: user.avatar, profilePicture: user.profilePicture,
        text: payload.text.substring(0, 1000), timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(), isOwner: !!user.isOwner,
        isModerator: room.moderators.includes(socket.userId), roomId: socket.currentRoom,
        edited: false, isImage: false, isVideo: false
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('edit-message', (payload) => {
    try {
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const idx = room.messages.findIndex(m => m.id === payload.messageId && m.userId === socket.userId);
      if (idx === -1) return;
      room.messages[idx].text = payload.newText.substring(0, 1000);
      room.messages[idx].edited = true;
      io.to(socket.currentRoom).emit('message-edited', { messageId: payload.messageId, newText: room.messages[idx].text });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('send-image', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.canSendImages) return;
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const msg = {
        id: 'msg_' + uuidv4(), userId: socket.userId, username: user.displayName,
        avatar: user.avatar, profilePicture: user.profilePicture, imageUrl: payload.imageUrl,
        timestamp: new Date().toLocaleTimeString(), isOwner: !!user.isOwner,
        roomId: socket.currentRoom, isImage: true, isVideo: false
      };
      room.messages.push(msg);
      io.to(socket.currentRoom).emit('new-message', msg);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('send-video', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.canSendVideos) return;
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const msg = {
        id: 'msg_' + uuidv4(), userId: socket.userId, username: user.displayName,
        avatar: user.avatar, profilePicture: user.profilePicture, videoUrl: payload.videoUrl,
        timestamp: new Date().toLocaleTimeString(), isOwner: !!user.isOwner,
        roomId: socket.currentRoom, isImage: false, isVideo: true
      };
      room.messages.push(msg);
      io.to(socket.currentRoom).emit('new-message', msg);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('create-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;
      const roomId = 'room_' + uuidv4();
      rooms.set(roomId, {
        id: roomId, name: payload.name.substring(0, 100), description: payload.description,
        createdBy: user.displayName, creatorId: socket.userId, users: [socket.userId],
        messages: [], isOfficial: false, hasPassword: !!payload.password,
        password: payload.password ? bcrypt.hashSync(payload.password, 10) : null,
        moderators: [], isSilenced: false, createdAt: new Date().toISOString()
      });
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.emit('room-created', { roomId, roomName: payload.name });
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('join-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(payload.roomId);
      if (!user || !room) return;
      if (room.hasPassword && !user.isOwner && !bcrypt.compareSync(payload.password, room.password)) {
        return socket.emit('error', 'Wrong password');
      }
      if (socket.currentRoom) {
        const prev = rooms.get(socket.currentRoom);
        if (prev) prev.users = prev.users.filter(u => u !== socket.userId);
        socket.leave(socket.currentRoom);
      }
      if (!room.users.includes(socket.userId)) room.users.push(socket.userId);
      socket.join(room.id);
      socket.currentRoom = room.id;
      socket.emit('room-joined', {
        room: {
          id: room.id, name: room.name, description: room.description,
          messages: room.messages.slice(-50), isCreator: room.creatorId === socket.userId,
          isModerator: room.moderators.includes(socket.userId),
          partyMode: systemSettings.partyMode[room.id] || false, moderators: room.moderators
        },
        video: systemSettings.video
      });
      updateUsersList(room.id);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-rooms', () => {
    try {
      const list = Array.from(rooms.values()).map(r => ({
        id: r.id, name: r.name, description: r.description,
        userCount: r.users.length, hasPassword: !!r.hasPassword,
        isOfficial: !!r.isOfficial, createdBy: r.createdBy
      }));
      socket.emit('rooms-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-users', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('users-list', []);
      const list = room.users.map(uid => {
        const u = users.get(uid);
        if (!u) return null;
        return {
          id: u.id, displayName: u.displayName, avatar: u.avatar,
          profilePicture: u.profilePicture, isOnline: onlineUsers.has(u.id),
          isOwner: !!u.isOwner, isModerator: room.moderators.includes(u.id)
        };
      }).filter(Boolean);
      socket.emit('users-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('send-private-message', (payload) => {
    try {
      const sender = users.get(socket.userId);
      const receiver = users.get(payload.toUserId);
      if (!sender || !receiver) return;
      const blocked = blockedUsers.get(payload.toUserId) || new Set();
      if (blocked.has(socket.userId)) return socket.emit('error', 'Blocked');
      const msg = {
        id: 'pm_' + uuidv4(), from: socket.userId, to: payload.toUserId,
        fromName: sender.displayName, text: payload.text.substring(0, 1000),
        timestamp: new Date().toLocaleTimeString(), edited: false
      };
      if (!privateMessages.has(socket.userId)) privateMessages.set(socket.userId, {});
      const smap = privateMessages.get(socket.userId);
      if (!smap[payload.toUserId]) smap[payload.toUserId] = [];
      smap[payload.toUserId].push(msg);
      if (!privateMessages.has(payload.toUserId)) privateMessages.set(payload.toUserId, {});
      const rmap = privateMessages.get(payload.toUserId);
      if (!rmap[socket.userId]) rmap[socket.userId] = [];
      rmap[socket.userId].push(msg);
      const rSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.toUserId);
      if (rSocket) rSocket.emit('new-private-message', msg);
      socket.emit('private-message-sent', msg);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-private-messages', (payload) => {
    try {
      const list = privateMessages.get(socket.userId)?.[payload.withUserId] || [];
      socket.emit('private-messages-list', { withUserId: payload.withUserId, messages: list.slice(-200) });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('block-user', (payload) => {
    try {
      if (!blockedUsers.has(socket.userId)) blockedUsers.set(socket.userId, new Set());
      blockedUsers.get(socket.userId).add(payload.userId);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unblock-user', (payload) => {
    try {
      if (blockedUsers.has(socket.userId)) blockedUsers.get(socket.userId).delete(payload.userId);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('mute-user', (payload) => {
    try {
      const target = users.get(payload.userId);
      if (!target || target.isOwner) return;
      const expires = payload.duration > 0 ? Date.now() + payload.duration * 60000 : null;
      mutedUsers.set(payload.userId, {
        username: target.displayName, expires, reason: payload.reason,
        mutedBy: users.get(socket.userId).displayName, mutedById: socket.userId,
        temporary: !!expires, byOwner: users.get(socket.userId).isOwner
      });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unmute-user', (payload) => {
    try {
      mutedUsers.delete(payload.userId);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('ban-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      bannedUsers.set(payload.userId, {
        username: payload.username, reason: payload.reason,
        bannedBy: admin.displayName, bannedAt: Date.now()
      });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('update-settings', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      if (payload.siteLogo) systemSettings.siteLogo = payload.siteLogo;
      if (payload.siteTitle) systemSettings.siteTitle = payload.siteTitle;
      if (payload.backgroundColor) systemSettings.backgroundColor = payload.backgroundColor;
      if (payload.loginMusic !== undefined) systemSettings.loginMusic = payload.loginMusic;
      if (payload.chatMusic !== undefined) systemSettings.chatMusic = payload.chatMusic;
      if (payload.loginMusicVolume !== undefined) systemSettings.loginMusicVolume = payload.loginMusicVolume;
      if (payload.chatMusicVolume !== undefined) systemSettings.chatMusicVolume = payload.chatMusicVolume;
      io.emit('settings-updated', systemSettings);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('start-video-watch', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      systemSettings.video = {
        url: payload.url, type: payload.type, startedAt: Date.now(),
        size: payload.size || 'medium', startedBy: user.displayName
      };
      io.to('global_cold').emit('video-started', systemSettings.video);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('stop-video-watch', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      systemSettings.video = null;
      io.to('global_cold').emit('video-stopped');
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-room-media', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return;
      socket.emit('room-media-data', {
        roomId: room.id, videoUrl: room.videoUrl,
        musicUrl: room.musicUrl, musicVolume: room.musicVolume || 0.5
      });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('update-room-media', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      if (payload.type === 'video') room.videoUrl = payload.videoUrl || null;
      if (payload.type === 'music') {
        room.musicUrl = payload.musicUrl || null;
        room.musicVolume = payload.musicVolume || 0.5;
      }
      io.to(payload.roomId).emit('room-media-updated', { ...payload, message: 'Updated' });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('toggle-party-mode', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      setPartyMode(payload.roomId, payload.enabled);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('delete-message', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      room.messages = room.messages.filter(m => m.id !== payload.messageId);
      io.to(payload.roomId).emit('message-deleted', { messageId: payload.messageId });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('delete-account', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      users.delete(payload.userId);
      privateMessages.delete(payload.userId);
      mutedUsers.delete(payload.userId);
      bannedUsers.delete(payload.userId);
      blockedUsers.delete(payload.userId);
      rooms.forEach(room => {
        room.messages = room.messages.filter(m => m.userId !== payload.userId);
        room.users = room.users.filter(u => u !== payload.userId);
        room.moderators = room.moderators.filter(m => m !== payload.userId);
      });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('add-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return;
      if (!room.moderators.includes(payload.userId)) room.moderators.push(payload.userId);
      saveData();
      socket.emit('action-success', 'Moderator added');
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('remove-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return;
      room.moderators = room.moderators.filter(id => id !== payload.userId);
      saveData();
      socket.emit('action-success', 'Moderator removed');
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('update-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      if (payload.name) room.name = payload.name.substring(0, 100);
      if (payload.description !== undefined) room.description = payload.description;
      if (payload.password !== undefined) {
        room.hasPassword = !!payload.password;
        room.password = payload.password ? bcrypt.hashSync(payload.password, 10) : null;
      }
      io.to(room.id).emit('room-updated', { name: room.name, description: room.description });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('delete-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room || room.isOfficial) return;
      io.to(payload.roomId).emit('room-deleted', { message: 'Room deleted' });
      rooms.delete(payload.roomId);
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('clean-chat', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      room.messages = [];
      io.to(payload.roomId).emit('chat-cleaned', { message: 'Chat cleaned' });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('clean-all-rooms', () => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      rooms.forEach(room => {
        room.messages = [];
        io.to(room.id).emit('chat-cleaned', { message: 'All chats cleaned' });
      });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('silence-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      room.isSilenced = true;
      io.to(payload.roomId).emit('room-silenced', { message: 'Room silenced', forceDisable: true });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unsilence-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(payload.roomId);
      if (!room) return;
      room.isSilenced = false;
      io.to(payload.roomId).emit('room-unsilenced', { message: 'Room unsilenced' });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('send-support-message', (payload) => {
    try {
      const id = 'support_' + uuidv4();
      supportMessages.set(id, {
        id, from: payload.from || 'Anonymous',
        message: payload.message.substring(0, 1000),
        sentAt: new Date().toISOString()
      });
      saveData();
      socket.emit('support-message-sent', { message: 'Message sent' });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-support-messages', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      socket.emit('support-messages-list', Array.from(supportMessages.values()));
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('delete-support-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      supportMessages.delete(payload.messageId);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner && !user?.isModerator) return;
      let list = Array.from(mutedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      if (user.isModerator && !user.isOwner) {
        list = list.filter(item => item.mutedById === socket.userId || !item.byOwner);
      }
      socket.emit('muted-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      socket.emit('banned-list', Array.from(bannedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info })));
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unmute-multiple', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      payload.userIds.forEach(uid => mutedUsers.delete(uid));
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unban-multiple', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      payload.userIds.forEach(uid => bannedUsers.delete(uid));
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('unban-user', (payload) => {
    try {
      bannedUsers.delete(payload.userId);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('video-resize', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      if (systemSettings.video) {
        systemSettings.video.size = payload.size || 'medium';
        io.to('global_cold').emit('video-resize', { size: systemSettings.video.size });
        saveData();
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('ping', () => {
    try {
      if (socket.userId) onlineUsers.set(socket.userId, Date.now());
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        rooms.forEach(room => {
          room.users = room.users.filter(u => u !== socket.userId);
        });
      }
      console.log('🔌 Disconnect:', socket.id);
    } catch (e) {
      console.error(e);
    }
  });
});

setInterval(() => {
  try { saveData(); } catch (e) { console.error(e); }
}, 30000);

server.listen(PORT, () => {
  console.log(`🚀 Cold Room V3.0 running on port ${PORT}`);
  console.log(`✅ Owner: COLDKING / ColdKing@2025`);
  console.log(`✅ All features ready!`);
});

// ═══════════════════════════════════════════════════════════════
// END - Cold Room V3.0 Complete Server
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════
