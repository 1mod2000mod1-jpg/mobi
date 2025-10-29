// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Complete Enhanced Client
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════
console.log('❄️ Cold Room V3.0 Enhanced loading...');

let socket, currentUser, currentRoom, systemSettings = {}, selectedUserId, selectedUsername;
let currentPrivateChatUser, confirmCallback, editingRoomId, ytPlayer, currentVideoSize = 'medium';
let isReconnecting = false, videoMinimized = false;
let globalVideoState = null;
let blockedUsers = new Set();

// ───────────────────────────────────────────────────────────────
// Fetch settings early
// ───────────────────────────────────────────────────────────────
async function fetchInitialSettings() {
    try {
        const res = await fetch('/settings');
        if (!res.ok) return;
        const s = await res.json();
        systemSettings = s;
        applySiteSettings();
        updateMusicPlayers();
    } catch (e) {
        console.log('Settings fetch skipped');
    }
}

// ═══════════════════════════════════════════════════════════════
// SOCKET INITIALIZATION
// ═══════════════════════════════════════════════════════════════
function initializeSocket() {
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
        timeout: 20000
    });
    setupSocketListeners();
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('✅ Connected');
        isReconnecting = false;
        hideLoading();
        if (currentUser && currentRoom) {
            socket.emit('join-room', { roomId: currentRoom });
            showNotification('✅ Reconnected');
        }
    });

    socket.on('disconnect', () => {
        if (!isReconnecting) {
            showNotification('⚠️ Reconnecting...');
            isReconnecting = true;
        }
    });

    socket.on('reconnect', () => {
        isReconnecting = false;
        if (currentUser && currentRoom) socket.emit('join-room', { roomId: currentRoom });
    });

    socket.on('login-success', handleLoginSuccess);
    socket.on('login-error', (msg) => { hideLoading(); showAlert(msg, 'error'); });
    socket.on('banned-user', (data) => {
        hideLoading();
        showAlert(`Banned: ${data.reason}`, 'error');
        document.getElementById('support-section').style.display = 'block';
    });
    socket.on('register-success', (data) => {
        hideLoading();
        showAlert(data.message, 'success');
        document.getElementById('login-username').value = data.username;
    });
    socket.on('register-error', (msg) => { hideLoading(); showAlert(msg, 'error'); });

    socket.on('new-message', (msg) => {
        if (msg.roomId === currentRoom) { addMessage(msg); scrollToBottom(); }
    });
    socket.on('message-edited', (data) => {
        const el = document.querySelector(`[data-message-id="${data.messageId}"] .message-text`);
        if (el) el.innerHTML = esc(data.newText) + ' <small>(edited)</small>';
    });

    socket.on('new-private-message', (msg) => {
        if (blockedUsers.has(msg.from)) return;
        if (currentPrivateChatUser === msg.from) addPrivateMessage(msg);
        showNotification(`New from ${msg.fromName}`);
    });
    socket.on('private-message-sent', addPrivateMessage);
    socket.on('private-messages-list', (d) => displayPrivateMessages(d.messages, d.withUserId));

    socket.on('room-joined', handleRoomJoined);
    socket.on('room-created', (d) => {
        showAlert('Room created', 'success');
        socket.emit('join-room', { roomId: d.roomId });
        hideModal('create-room-modal');
    });
    socket.on('room-updated', (d) => {
        document.getElementById('room-info').textContent = d.name;
        showNotification('Room updated');
    });

    socket.on('users-list', updateUsersList);
    socket.on('rooms-list', updateRoomsList);
    socket.on('user-joined', (d) => showNotification(`${d.username} joined`));

    socket.on('message-deleted', (d) => {
        const el = document.querySelector(`[data-message-id="${d.messageId}"]`);
        if (el) el.remove();
    });
    socket.on('chat-cleaned', (d) => { clearMessages(); showAlert(d.message, 'info'); });

    socket.on('room-silenced', (d) => {
        const disabled = d.forceDisable ?? true;
        document.getElementById('message-input').disabled = disabled && !currentUser?.isOwner;
        document.querySelector('#message-form button').disabled = disabled && !currentUser?.isOwner;
        showAlert(d.message, 'warning');
    });
    socket.on('room-unsilenced', (d) => {
        document.getElementById('message-input').disabled = false;
        document.querySelector('#message-form button').disabled = false;
        showAlert(d.message, 'success');
    });
    socket.on('room-deleted', (d) => {
        showAlert(d.message, 'error');
        socket.emit('join-room', { roomId: 'global_cold' });
    });
    socket.on('party-mode-changed', (d) => {
        togglePartyEffects(d.enabled);
        showNotification(d.enabled ? '🎉 Party ON!' : 'Party OFF');
    });

    socket.on('video-started', (d) => {
        globalVideoState = d;
        showVideoPlayer(d);
        showNotification(`${d.startedBy} started video`);
    });
    socket.on('video-stopped', () => {
        globalVideoState = null;
        hideVideoPlayer();
    });
    socket.on('video-resize', (d) => resizeVideoPlayer(d.size));

    socket.on('room-media-updated', (d) => {
        if (d.roomId === currentRoom) {
            handleRoomMediaUpdate(d);
        }
    });

    socket.on('profile-updated', (d) => {
        if (d.userId === currentUser?.id) {
            currentUser.profilePicture = d.profilePicture;
            updateCurrentUserAvatar();
        }
        showAlert(d.message, 'success');
    });

    socket.on('action-success', (msg) => showAlert(msg, 'success'));
    socket.on('error', (msg) => showAlert(msg, 'error'));
    socket.on('message-error', (msg) => showAlert(msg, 'error'));

    socket.on('banned', (d) => {
        showAlert(`Banned: ${d.reason}`, 'error');
        setTimeout(() => logout(true), 3000);
    });
    socket.on('account-deleted', (d) => {
        showAlert(d.message, 'error');
        setTimeout(() => logout(true), 2000);
    });

    socket.on('settings-updated', (s) => {
        systemSettings = s;
        applySiteSettings();
        
        if (document.getElementById('chat-screen').classList.contains('active')) {
            const chatMusic = document.getElementById('chat-music');
            if (chatMusic && s.chatMusic) {
                chatMusic.src = s.chatMusic;
                chatMusic.volume = s.chatMusicVolume || 0.5;
                chatMusic.loop = true;
                chatMusic.play().catch(() => {});
            }
        } else {
            const loginMusic = document.getElementById('login-music');
            if (loginMusic && s.loginMusic) {
                loginMusic.src = s.loginMusic;
                loginMusic.volume = s.loginMusicVolume || 0.5;
                loginMusic.play().catch(() => {});
            }
        }
        
        showAlert('Settings updated', 'info');
    });

    socket.on('support-message-sent', (d) => showAlert(d.message, 'success'));
    socket.on('support-messages-list', displaySupportMessages);
    socket.on('muted-list', displayMutedList);
    socket.on('banned-list', displayBannedList);
    socket.on('blocked-users', (list) => {
        blockedUsers = new Set(list);
    });
}

// ═══════════════════════════════════════════════════════════════
// LOGIN & REGISTER
// ═══════════════════════════════════════════════════════════════
function handleLoginSuccess(data) {
    currentUser = data.user;
    currentUser.isModerator = data.room.moderators?.includes(currentUser.id) || false;
    currentRoom = data.room.id;
    systemSettings = data.systemSettings;
    globalVideoState = data.video || null;
    blockedUsers = new Set(data.blockedUsers || []);

    document.getElementById('current-user-name').textContent = currentUser.displayName;
    updateCurrentUserAvatar();
    updateUserBadges();

    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');

    stopLoginMusic();
    handleRoomMusic();
    hideLoading();
    showAlert(`Welcome ${currentUser.displayName}! ❄️`, 'success');

    clearMessages();
    data.room.messages.forEach(addMessage);

    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;

    socket.emit('get-rooms');
    socket.emit('get-users', { roomId: currentRoom });

    if (currentUser.isOwner) {
        document.getElementById('owner-panel-btn').style.display = 'inline-block';
        document.getElementById('owner-tools').style.display = 'flex';
    } else if (currentUser.isModerator) {
        document.getElementById('moderator-panel-btn').style.display = 'inline-block';
    }

    if (data.room.partyMode) togglePartyEffects(true);

    applySiteSettings();
    startHeartbeat();
    createSnowfall();
    drawSnowman();

    if (globalVideoState && currentRoom === data.room.id) {
        showVideoPlayer(globalVideoState);
        resizeVideoPlayer(globalVideoState.size || 'medium');
    }
}

function handleRoomJoined(data) {
    currentRoom = data.room.id;
    document.getElementById('room-info').textContent = data.room.name;
    
    clearMessages();
    data.room.messages.forEach(addMessage);
    
    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;
    
    togglePartyEffects(data.room.partyMode || false);
    socket.emit('get-users', { roomId: currentRoom });
    scrollToBottom();

    handleRoomMusic();

    if (data.video && currentRoom === data.room.id) {
        globalVideoState = data.video;
        showVideoPlayer(globalVideoState);
        resizeVideoPlayer(globalVideoState.size || 'medium');
    } else {
        hideVideoPlayer();
    }
}

function updateCurrentUserAvatar() {
    const avatarImg = document.getElementById('current-user-avatar-img');
    const avatarEmoji = document.getElementById('current-user-avatar');
    
    if (currentUser.profilePicture) {
        avatarImg.src = currentUser.profilePicture;
        avatarImg.style.display = 'block';
        avatarEmoji.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarEmoji.style.display = 'block';
        avatarEmoji.textContent = currentUser.avatar;
    }
}

window.login = function() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return showAlert('Enter username and password', 'error');
    showLoading('Logging in...');
    socket.emit('login', { username, password });
};

window.register = function() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const displayName = document.getElementById('register-displayname').value.trim();
    const gender = document.getElementById('register-gender').value;

    if (!username || !password || !displayName || !gender) {
        return showAlert('Fill all fields', 'error');
    }
    if (username.length < 3 || username.length > 20) {
        return showAlert('Username: 3-20 chars', 'error');
    }
    if (password.length < 6) {
        return showAlert('Password: 6+ chars', 'error');
    }
    if (displayName.length < 3 || displayName.length > 30) {
        return showAlert('Display name: 3-30 chars', 'error');
    }

    showLoading('Creating account...');
    socket.emit('register', { username, password, displayName, gender });
};

window.sendSupportMessage = function() {
    const message = document.getElementById('support-message').value.trim();
    if (!message) return showAlert('Write your message', 'error');
    socket.emit('send-support-message', {
        from: document.getElementById('login-username').value || 'Anonymous',
        message
    });
    document.getElementById('support-message').value = '';
};

window.logout = function(forced = false) {
    if (forced || confirm('Logout?')) {
        showLoading('Logging out...');
        if (socket) socket.disconnect();
        setTimeout(() => location.reload(), 1000);
    }
};

// ═══════════════════════════════════════════════════════════════
// PROFILE SETTINGS
// ═══════════════════════════════════════════════════════════════
window.showProfileSettings = function() {
    document.getElementById('profile-settings-modal').classList.add('active');
    
    const previewImg = document.getElementById('profile-preview-img');
    const previewEmoji = document.getElementById('profile-preview-emoji');
    
    if (currentUser.profilePicture) {
        previewImg.src = currentUser.profilePicture;
        previewImg.style.display = 'block';
        previewEmoji.style.display = 'none';
    } else {
        previewImg.style.display = 'none';
        previewEmoji.style.display = 'block';
        previewEmoji.textContent = currentUser.avatar;
    }
    
    document.getElementById('profile-preview-name').textContent = currentUser.displayName;
    document.getElementById('profile-picture-url').value = currentUser.profilePicture || '';
};

window.updateProfilePicture = function() {
    const url = document.getElementById('profile-picture-url').value.trim();
    if (!url) return showAlert('Enter image URL', 'error');
    
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const isValid = validExtensions.some(ext => url.toLowerCase().includes(ext));
    
    if (!isValid) return showAlert('Only JPG, PNG, GIF, WEBP allowed', 'error');
    
    socket.emit('update-profile-picture', { profilePicture: url });
    hideModal('profile-settings-modal');
};

window.removeProfilePicture = function() {
    socket.emit('update-profile-picture', { profilePicture: null });
    hideModal('profile-settings-modal');
};

window.changeName = function() {
    if (currentUser.isOwner) {
        const newName = prompt('New display name (unique across platform):', currentUser.displayName);
        if (newName && newName.trim()) {
            socket.emit('change-display-name', { newName: newName.trim() });
        }
    } else {
        const changesLeft = 2 - (currentUser.nameChangeCount || 0);
        if (changesLeft > 0) {
            const newName = prompt(`New display name (${changesLeft} free changes left):`, currentUser.displayName);
            if (newName && newName.trim()) {
                socket.emit('change-display-name', { newName: newName.trim() });
            }
        } else {
            const newName = prompt('You have used your free changes.\nSubmit a request to the owner:', currentUser.displayName);
            if (newName && newName.trim() && newName.trim() !== currentUser.displayName) {
                socket.emit('request-name-change', { newName: newName.trim() });
                showAlert('Name change request sent to owner', 'success');
            }
        }
    }
};

// ═══════════════════════════════════════════════════════════════
// SEND MESSAGES
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    const messageForm = document.getElementById('message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', function(e) {
            e.preventDefault();
            sendMessage();
        });
    }

    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    document.getElementById('login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });
    document.getElementById('register-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') register();
    });
});

function sendMessage() {
    const textarea = document.getElementById('message-input');
    const text = textarea.value.trim();
    if (!text) return;
    if (!socket || !socket.connected) return showAlert('Reconnecting...', 'warning');
    socket.emit('send-message', { text, roomId: currentRoom });
    textarea.value = '';
}

function editMessage(messageId, currentText) {
    const newText = prompt('Edit message:', currentText || '');
    if (newText && newText.trim() && newText.trim() !== currentText) {
        socket.emit('edit-message', { messageId, newText: newText.trim() });
    }
}

// Continuing in next part...
// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Part 2 (Continuation)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// MEDIA UPLOAD
// ═══════════════════════════════════════════════════════════════
window.showImageUpload = () => document.getElementById('image-upload-modal').classList.add('active');
window.sendImageMessage = function() {
    const url = document.getElementById('image-url-input').value.trim();
    if (!url) return showAlert('Enter image URL', 'error');
    socket.emit('send-image', { imageUrl: url });
    document.getElementById('image-url-input').value = '';
    hideModal('image-upload-modal');
};

window.showVideoUpload = () => document.getElementById('video-upload-modal').classList.add('active');
window.sendVideoMessage = function() {
    const url = document.getElementById('video-url-input').value.trim();
    if (!url) return showAlert('Enter video URL', 'error');
    if (!url.toLowerCase().endsWith('.mp4')) return showAlert('MP4 only', 'error');
    socket.emit('send-video', { videoUrl: url });
    document.getElementById('video-url-input').value = '';
    hideModal('video-upload-modal');
};

// ═══════════════════════════════════════════════════════════════
// DISPLAY MESSAGES
// ═══════════════════════════════════════════════════════════════
function addMessage(message) {
    const container = document.getElementById('messages');
    if (!container) return;

    const welcomeMsg = container.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.remove();

    const messageDiv = document.createElement('div');
    const isMyMessage = message.userId === currentUser?.id;
    messageDiv.className = `message ${message.isOwner ? 'owner-message' : ''} ${isMyMessage ? 'my-message' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);

    let badges = '';
    if (message.isOwner) badges += '<span class="badge owner-badge">👑</span>';
    else if (message.isModerator) badges += '<span class="badge moderator-badge">⭐</span>';

    let avatarHTML = '';
    if (message.profilePicture) {
        avatarHTML = `<div class="message-user-avatar"><img src="${esc(message.profilePicture)}" alt="avatar"></div>`;
    } else {
        avatarHTML = `<span style="font-size: 1.5rem;">${esc(message.avatar)}</span>`;
    }

    if (message.isVideo) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-user">${avatarHTML} ${esc(message.username)}${badges}</div>
            </div>
            <div class="message-video">
                <video controls style="max-width: 500px; max-height: 400px; border-radius: 10px;">
                    <source src="${esc(message.videoUrl)}" type="video/mp4">
                </video>
            </div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    } else if (message.isImage) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-user">${avatarHTML} ${esc(message.username)}${badges}</div>
            </div>
            <div class="message-image">
                <img src="${esc(message.imageUrl)}" alt="Image" style="max-width: 400px; border-radius: 10px;">
            </div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-user">${avatarHTML} ${esc(message.username)}${badges}</div>
            </div>
            <div class="message-text">${esc(message.text)}${message.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    }

    messageDiv.style.cursor = 'pointer';
    messageDiv.addEventListener('click', (e) => {
        if (!e.target.closest('.badge') && !e.target.closest('video') && !e.target.closest('img')) {
            selectedUserId = message.userId;
            selectedUsername = message.username;
            showMessageActions(message);
        }
    });

    container.appendChild(messageDiv);
    scrollToBottom();
}

function showMessageActions(message) {
    const actions = [];

    if (!message.isImage && !message.isVideo && message.userId === currentUser?.id) {
        actions.push({ text: '✏️ Edit My Message', action: () => editMessage(message.id, message.text) });
    }

    actions.push({ text: '📝 Change My Name', action: changeName });
    actions.push({ text: '🖼️ Profile Settings', action: showProfileSettings });

    if (currentUser?.isOwner) {
        if (message.userId !== currentUser.id) {
            actions.push({ text: '👑 Add Moderator', action: addModerator });
            actions.push({ text: '⭐ Remove Moderator', action: removeModerator });
            actions.push({ text: '🔇 Mute User', action: showMuteDialog });
            actions.push({ text: '🚫 Ban User', action: banUser });
            actions.push({ text: '🗑️ Delete Account', action: deleteAccount });
        }
        actions.push({ text: '❌ Delete Message', action: () => deleteMessage(message.id) });
    } else if (currentUser?.isModerator && message.userId !== currentUser.id) {
        actions.push({ text: '🔇 Mute User', action: showMuteDialog });
    }

    if (message.userId !== currentUser?.id) {
        actions.push({ text: '💬 Private Message', action: () => openPrivateChat(selectedUserId) });
    }

    actions.push({ text: '❌ Cancel', action: hideActionsMenu });
    showActionsMenu(actions);
}

function showActionsMenu(actions) {
    const menu = document.getElementById('message-actions-menu');
    const list = document.getElementById('message-actions-list');
    list.innerHTML = '';
    
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'action-menu-btn';
        btn.textContent = action.text;
        btn.onclick = (e) => { 
            e.stopPropagation();
            hideActionsMenu(); 
            action.action(); 
        };
        list.appendChild(btn);
    });

    menu.style.cssText = `
        display: flex !important;
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
    `;
    
    setTimeout(() => {
        const clickHandler = function(e) {
            if (!menu.contains(e.target) && !e.target.closest('.message')) {
                hideActionsMenu();
                document.removeEventListener('click', clickHandler);
            }
        };
        document.addEventListener('click', clickHandler);
    }, 100);
}

function hideActionsMenu() {
    document.getElementById('message-actions-menu').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// USER ACTIONS
// ═══════════════════════════════════════════════════════════════
window.showMuteDialog = function() {
    const duration = prompt(`Mute ${selectedUsername} for minutes? (0 = permanent):`, '10');
    if (duration === null) return;
    const reason = prompt('Reason:', 'Rule violation');
    if (!reason) return;
    socket.emit('mute-user', {
        userId: selectedUserId,
        username: selectedUsername,
        duration: parseInt(duration),
        reason,
        roomId: currentRoom
    });
};

window.banUser = function() {
    showConfirm(`Ban ${selectedUsername}?\n\nThis will ban IP and kick immediately.`, (ok) => {
        if (ok) {
            const reason = prompt('Reason:', 'Serious violation');
            if (reason) socket.emit('ban-user', { userId: selectedUserId, username: selectedUsername, reason });
        }
    });
};

window.deleteAccount = function() {
    showConfirm(`⚠️ DELETE ${selectedUsername}?\n\nThis CANNOT be undone!`, (ok) => {
        if (ok) socket.emit('delete-account', { userId: selectedUserId });
    });
};

window.addModerator = function() {
    if (!confirm(`Add ${selectedUsername} as moderator?`)) return;
    socket.emit('add-moderator', { userId: selectedUserId, username: selectedUsername, roomId: currentRoom });
};

window.removeModerator = function() {
    if (!confirm(`Remove ${selectedUsername} from moderators?`)) return;
    socket.emit('remove-moderator', { userId: selectedUserId, username: selectedUsername, roomId: currentRoom });
};

function deleteMessage(messageId) {
    socket.emit('delete-message', { messageId, roomId: currentRoom });
}

function openPrivateChat(userId) {
    if (blockedUsers.has(userId)) {
        showAlert('You have blocked this user', 'error');
        return;
    }
    currentPrivateChatUser = userId;
    socket.emit('get-private-messages', { withUserId: userId });
    document.getElementById('private-messages-modal').classList.add('active');
    const user = Array.from(document.querySelectorAll('.user-item')).find(el => el.dataset.userId === userId);
    if (user) {
        document.getElementById('private-chat-name').textContent = user.dataset.userName;
        document.getElementById('block-user-btn').style.display = 'inline-block';
    }
}

// ═══════════════════════════════════════════════════════════════
// PRIVATE MESSAGES
// ═══════════════════════════════════════════════════════════════
window.showPrivateMessages = function() {
    document.getElementById('private-messages-modal').classList.add('active');
    loadPrivateUsersList();
};

function loadPrivateUsersList() {
    const container = document.getElementById('private-users-list');
    container.innerHTML = '';
    socket.emit('get-users', { roomId: currentRoom });
    socket.once('users-list', (users) => {
        users.forEach(user => {
            if (user.id === currentUser?.id) return;
            const div = document.createElement('div');
            div.className = `private-user-item ${blockedUsers.has(user.id) ? 'blocked' : ''}`;
            div.dataset.userId = user.id;
            div.dataset.userName = user.displayName;
            
            let avatarHTML = '';
            if (user.profilePicture) {
                avatarHTML = `<div class="user-avatar"><img src="${esc(user.profilePicture)}"></div>`;
            } else {
                avatarHTML = `<div class="user-avatar"><span>${esc(user.avatar)}</span></div>`;
            }
            
            div.innerHTML = `${avatarHTML}<span>${esc(user.displayName)}</span>`;
            div.onclick = () => openPrivateChat(user.id);
            container.appendChild(div);
        });
    });
}

function updateUserBadges() {
    const container = document.getElementById('user-badges');
    if (!container) return;
    let badges = '';
    if (currentUser.isOwner) badges += '<span class="badge owner-badge">👑 Owner</span>';
    container.innerHTML = badges;
}

window.sendPrivateMessage = function() {
    const input = document.getElementById('private-message-input');
    const text = input.value.trim();
    if (!text || !currentPrivateChatUser) return;
    socket.emit('send-private-message', { toUserId: currentPrivateChatUser, text });
    input.value = '';
};

window.toggleBlockUser = function() {
    if (!currentPrivateChatUser) return;
    
    if (blockedUsers.has(currentPrivateChatUser)) {
        socket.emit('unblock-user', { userId: currentPrivateChatUser });
        blockedUsers.delete(currentPrivateChatUser);
        showAlert('User unblocked', 'success');
        document.getElementById('block-user-btn').textContent = '🚫 Block';
    } else {
        socket.emit('block-user', { userId: currentPrivateChatUser });
        blockedUsers.add(currentPrivateChatUser);
        showAlert('User blocked', 'success');
        document.getElementById('block-user-btn').textContent = '✅ Unblock';
        hideModal('private-messages-modal');
    }
};

function displayPrivateMessages(messages, withUserId) {
    const container = document.getElementById('private-messages');
    if (!container) return;
    container.innerHTML = '';
    messages.forEach(msg => {
        const isFromMe = msg.from === currentUser?.id;
        const div = document.createElement('div');
        div.className = `message ${isFromMe ? 'my-message' : ''}`;
        div.innerHTML = `
            <div class="message-header"><span class="message-user">${esc(msg.fromName)}</span></div>
            <div class="message-text">${esc(msg.text)}${msg.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer"><span class="message-time">${msg.timestamp}</span></div>
        `;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

function addPrivateMessage(message) {
    const container = document.getElementById('private-messages');
    if (!container) return;
    const isFromMe = message.from === currentUser?.id;
    const div = document.createElement('div');
    div.className = `message ${isFromMe ? 'my-message' : ''}`;
    div.innerHTML = `
        <div class="message-header"><span class="message-user">${esc(message.fromName)}</span></div>
        <div class="message-text">${esc(message.text)}</div>
        <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Continue to Part 3...
// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Part 3 (Final)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// ROOM MANAGEMENT
// ═══════════════════════════════════════════════════════════════
window.showCreateRoomModal = () => document.getElementById('create-room-modal').classList.add('active');

window.createRoom = function() {
    const name = document.getElementById('room-name-input').value.trim();
    const description = document.getElementById('room-desc-input').value.trim();
    const password = document.getElementById('room-pass-input').value.trim();
    if (!name) return showAlert('Enter room name', 'error');
    socket.emit('create-room', { name, description, password });
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    document.getElementById('room-pass-input').value = '';
};

window.joinRoom = function(roomId) {
    const room = Array.from(document.querySelectorAll('.room-item')).find(el => el.dataset.roomId === roomId);
    if (room && room.dataset.hasPassword === 'true') {
        const password = prompt('Room password:');
        if (password) socket.emit('join-room', { roomId, password });
    } else {
        socket.emit('join-room', { roomId });
    }
};

window.toggleRoomsList = function() {
    const sidebar = document.getElementById('rooms-sidebar');
    const usersSidebar = document.getElementById('users-sidebar');
    sidebar.classList.toggle('active');
    usersSidebar.classList.remove('active');
};

window.toggleUsersList = function() {
    const sidebar = document.getElementById('users-sidebar');
    const roomsSidebar = document.getElementById('rooms-sidebar');
    sidebar.classList.toggle('active');
    roomsSidebar.classList.remove('active');
};

function updateRoomsList(rooms) {
    const container = document.getElementById('rooms-list');
    if (!container) return;
    container.innerHTML = '';
    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.dataset.roomId = room.id;
        div.dataset.hasPassword = room.hasPassword;
        const lock = room.hasPassword ? '🔒 ' : '';
        const official = room.isOfficial ? '⭐ ' : '';
        div.innerHTML = `
            <div class="room-item-name">${official}${lock}${esc(room.name)}</div>
            <div class="room-item-desc">${esc(room.description)}</div>
            <div class="room-item-info">
                <span>👥 ${room.userCount}</span>
                <span>${esc(room.createdBy)}</span>
            </div>
        `;
        div.onclick = () => joinRoom(room.id);

        if (currentUser?.isOwner) {
            let pressTimer;
            div.addEventListener('mousedown', () => {
                pressTimer = setTimeout(() => showRoomActions(room.id, room.name, room.isOfficial), 500);
            });
            div.addEventListener('mouseup', () => clearTimeout(pressTimer));
            div.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            div.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    e.preventDefault();
                    showRoomActions(room.id, room.name, room.isOfficial);
                }, 500);
            });
            div.addEventListener('touchend', () => clearTimeout(pressTimer));
        }

        container.appendChild(div);
    });
}

function showRoomActions(roomId, roomName, isOfficial) {
    const actions = [
        { text: '✏️ Edit Room', action: () => showEditRoomModal(roomId) },
        { text: '🔇 Silence', action: () => socket.emit('silence-room', { roomId }) },
        { text: '🔊 Unsilence', action: () => socket.emit('unsilence-room', { roomId }) },
        { text: '🧹 Clean Chat', action: () => showConfirm('Clean messages?', ok => ok && socket.emit('clean-chat', { roomId })) }
    ];
    if (!isOfficial) {
        actions.push({ text: '🗑️ Delete Room', action: () => showConfirm(`Delete "${roomName}"?`, ok => ok && socket.emit('delete-room', { roomId })) });
    }
    actions.push({ text: '❌ Cancel', action: hideActionsMenu });
    showActionsMenu(actions);
}

function showEditRoomModal(roomId) {
    editingRoomId = roomId;
    document.getElementById('edit-room-modal').classList.add('active');
}

window.saveRoomEdit = function() {
    const name = document.getElementById('edit-room-name').value.trim();
    const description = document.getElementById('edit-room-desc').value.trim();
    const password = document.getElementById('edit-room-pass').value.trim();
    socket.emit('update-room', { roomId: editingRoomId, name, description, password: password || null });
    hideModal('edit-room-modal');
    document.getElementById('edit-room-name').value = '';
    document.getElementById('edit-room-desc').value = '';
    document.getElementById('edit-room-pass').value = '';
};

function updateUsersList(users) {
    const container = document.getElementById('users-list');
    if (!container) return;
    document.getElementById('users-count').textContent = users.length;
    container.innerHTML = '';
    users.forEach(user => {
        if (user.id === currentUser?.id) return;
        const div = document.createElement('div');
        div.className = 'user-item';
        div.dataset.userId = user.id;
        div.dataset.userName = user.displayName;
        let badges = '';
        if (user.isOwner) badges += '<span class="badge owner-badge">👑</span>';
        else if (user.isModerator) badges += '<span class="badge moderator-badge">⭐</span>';
        
        let avatarHTML = '';
        if (user.profilePicture) {
            avatarHTML = `<img src="${esc(user.profilePicture)}" alt="avatar">`;
        } else {
            avatarHTML = `<span>${esc(user.avatar)}</span>`;
        }
        
        div.innerHTML = `
            <div class="user-avatar-wrapper">
                <div class="user-avatar">${avatarHTML}</div>
                ${user.isOnline ? '<span class="online-indicator"></span>' : ''}
            </div>
            <div class="user-info">
                <div class="user-name">${esc(user.displayName)} ${badges}</div>
            </div>
        `;
        div.onclick = () => {
            selectedUserId = user.id;
            selectedUsername = user.displayName;
            openPrivateChat(user.id);
        };
        container.appendChild(div);
    });
}

// ═══════════════════════════════════════════════════════════════
// ROOM MEDIA SETTINGS
// ═══════════════════════════════════════════════════════════════
window.showRoomMediaSettings = function() {
    if (!currentUser?.isOwner) return showAlert('Owner only', 'error');
    document.getElementById('room-media-modal').classList.add('active');
    document.getElementById('current-room-name').textContent = document.getElementById('room-info').textContent;
    
    socket.emit('get-room-media', { roomId: currentRoom });
};

socket.on('room-media-data', (data) => {
    document.getElementById('room-video-url').value = data.videoUrl || '';
    document.getElementById('room-music-url').value = data.musicUrl || '';
    document.getElementById('room-music-volume').value = data.musicVolume || 0.5;
});

window.updateRoomVideo = function() {
    const url = document.getElementById('room-video-url').value.trim();
    if (!url) return showAlert('Enter video URL', 'error');
    socket.emit('update-room-media', { roomId: currentRoom, videoUrl: url, type: 'video' });
};

window.removeRoomVideo = function() {
    socket.emit('update-room-media', { roomId: currentRoom, videoUrl: null, type: 'video' });
};

window.updateRoomMusic = function() {
    const url = document.getElementById('room-music-url').value.trim();
    const volume = parseFloat(document.getElementById('room-music-volume').value);
    if (!url) return showAlert('Enter music URL', 'error');
    socket.emit('update-room-media', { roomId: currentRoom, musicUrl: url, musicVolume: volume, type: 'music' });
};

window.removeRoomMusic = function() {
    socket.emit('update-room-media', { roomId: currentRoom, musicUrl: null, type: 'music' });
};

function handleRoomMediaUpdate(data) {
    if (data.type === 'video') {
        if (data.videoUrl) {
            showVideoPlayer({ url: data.videoUrl, type: detectVideoType(data.videoUrl), size: 'medium' });
        } else {
            hideVideoPlayer();
        }
    } else if (data.type === 'music') {
        handleRoomMusic();
    }
    showAlert(data.message, 'success');
}

function handleRoomMusic() {
    const audio = document.getElementById('room-music');
    socket.emit('get-room-media', { roomId: currentRoom });
    socket.once('room-media-data', (data) => {
        if (data.musicUrl) {
            audio.src = data.musicUrl;
            audio.volume = data.musicVolume || 0.5;
            audio.loop = true;
            audio.play().catch(() => {});
        } else {
            audio.pause();
            audio.src = '';
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// VIDEO PLAYER (YouTube/MP4/Reels)
// ═══════════════════════════════════════════════════════════════
window.showVideoModal = () => document.getElementById('video-modal').classList.add('active');

window.startVideoWatch = function() {
    const input = document.getElementById('video-play-input').value.trim();
    if (!input) return showAlert('Enter video URL', 'error');
    
    const type = detectVideoType(input);
    let url = input;
    
    if (type === 'youtube') {
        const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        if (match) url = match[1];
    }
    
    socket.emit('start-video-watch', { url, type, size: currentVideoSize });
    hideModal('video-modal');
    document.getElementById('video-play-input').value = '';
};

function detectVideoType(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.toLowerCase().endsWith('.mp4')) return 'mp4';
    return 'youtube'; // default
}

function showVideoPlayer(data) {
    const container = document.getElementById('video-player-container');
    const content = document.getElementById('video-content');
    
    container.style.display = 'block';
    container.className = `video-player-container size-${data.size || 'medium'}`;
    videoMinimized = false;
    document.getElementById('video-minimized').style.display = 'none';
    
    content.innerHTML = '';
    
    if (data.type === 'youtube') {
        content.innerHTML = `<iframe src="https://www.youtube.com/embed/${data.url}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else if (data.type === 'instagram') {
        content.innerHTML = `<iframe src="${data.url}/embed" allowfullscreen></iframe>`;
    } else if (data.type === 'mp4') {
        content.innerHTML = `<video controls autoplay><source src="${data.url}" type="video/mp4"></video>`;
    }
}

function hideVideoPlayer() {
    document.getElementById('video-player-container').style.display = 'none';
    document.getElementById('video-minimized').style.display = 'none';
    videoMinimized = false;
}

window.minimizeVideo = function() {
    document.getElementById('video-player-container').style.display = 'none';
    document.getElementById('video-minimized').style.display = 'flex';
    videoMinimized = true;
    document.getElementById('video-controls').style.display = 'none';
};

window.restoreVideo = function() {
    document.getElementById('video-player-container').style.display = 'block';
    document.getElementById('video-minimized').style.display = 'none';
    videoMinimized = false;
};

window.toggleVideoControls = function() {
    const controls = document.getElementById('video-controls');
    controls.style.display = controls.style.display === 'none' ? 'flex' : 'none';
};

window.resizeVideo = function(size) {
    currentVideoSize = size;
    const container = document.getElementById('video-player-container');
    container.className = `video-player-container size-${size}`;
    if (currentUser?.isOwner) {
        socket.emit('video-resize', { size });
    }
};

function resizeVideoPlayer(size) {
    currentVideoSize = size;
    const container = document.getElementById('video-player-container');
    container.className = `video-player-container size-${size}`;
}

window.closeVideo = function() {
    if (currentUser?.isOwner) socket.emit('stop-video-watch');
    hideVideoPlayer();
};

// ═══════════════════════════════════════════════════════════════
// OWNER PANEL
// ═══════════════════════════════════════════════════════════════
window.showOwnerPanel = function() {
    document.getElementById('owner-panel-modal').classList.add('active');
    switchOwnerTab('muted');
    loadRoomsForClean();
};

window.showModeratorPanel = function() {
    document.getElementById('moderator-panel-modal').classList.add('active');
    socket.emit('get-muted-list');
    socket.once('muted-list', displayModMutedList);
};

window.switchOwnerTab = function(tabName) {
    document.querySelectorAll('.owner-tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`owner-${tabName}`).classList.add('active');
    event.target.classList.add('active');

    if (tabName === 'muted') socket.emit('get-muted-list');
    else if (tabName === 'banned') socket.emit('get-banned-list');
    else if (tabName === 'support') socket.emit('get-support-messages');
    else if (tabName === 'settings') {
        loadSettings();
        loadRoomsForClean();
    }
};

function displayMutedList(list) {
    const container = document.getElementById('muted-list');
    if (!container) return;
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No muted users</div>';
        return;
    }
    list.forEach(item => {
        const timeLeft = item.temporary && item.expires ? Math.ceil((item.expires - Date.now()) / 60000) + ' min' : 'Permanent';
        const div = document.createElement('div');
        div.className = 'owner-item';
        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="muted-checkbox" data-user-id="${item.userId}" style="margin-right: 10px; cursor: pointer;">
                    <strong>${esc(item.username)}</strong><br>
                    <small>By: ${esc(item.mutedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unmute('${item.userId}')">Unmute</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${esc(item.reason)}</small><br>
                <small>Duration: ${timeLeft}</small>
            </div>
        `;
        container.appendChild(div);
    });
}

function displayBannedList(list) {
    const container = document.getElementById('banned-list');
    if (!container) return;
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No banned users</div>';
        return;
    }
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'owner-item';
        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="banned-checkbox" data-user-id="${item.userId}" style="margin-right: 10px; cursor: pointer;">
                    <strong>${esc(item.username)}</strong><br>
                    <small>By: ${esc(item.bannedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unban('${item.userId}')">Unban</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${esc(item.reason)}</small><br>
                <small>Date: ${new Date(item.bannedAt).toLocaleString()}</small>
            </div>
        `;
        container.appendChild(div);
    });
}

function displaySupportMessages(messages) {
    const container = document.getElementById('support-messages-list');
    if (!container) return;
    container.innerHTML = '';
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No support messages</div>';
        return;
    }
    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'owner-item';
        
        const isNameChange = msg.type === 'name_change_request';
        const title = isNameChange ? '📝 Name Change Request' : '📩 Support Message';
        
        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <strong>${title}</strong><br>
                    <strong>From: ${esc(msg.from)}</strong><br>
                    <small>${new Date(msg.sentAt).toLocaleString()}</small>
                </div>
                <div class="owner-item-actions">
                    ${isNameChange ? `<button class="modern-btn small" onclick="approveNameChange('${msg.id}')">✅ Approve</button>` : ''}
                    <button class="modern-btn small" onclick="deleteSupportMessage('${msg.id}')">Delete</button>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 10px; line-height: 1.6;">
                ${esc(msg.message)}
            </div>
        `;
        container.appendChild(div);
    });
}

window.approveNameChange = function(messageId) {
    showConfirm('Approve this name change request?', ok => {
        if (ok) {
            socket.emit('approve-name-change', { requestId: messageId });
            setTimeout(() => socket.emit('get-support-messages'), 500);
        }
    });
};

function displayModMutedList(list) {
    const container = document.getElementById('mod-muted-list');
    if (!container) return;
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No muted users</div>';
        return;
    }
    list.forEach(item => {
        const timeLeft = item.temporary && item.expires ? Math.ceil((item.expires - Date.now()) / 60000) + ' min' : 'Permanent';
        const div = document.createElement('div');
        div.className = 'owner-item';
        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="mod-muted-checkbox" data-user-id="${item.userId}" style="margin-right: 10px; cursor: pointer;">
                    <strong>${esc(item.username)}</strong><br>
                    <small>By: ${esc(item.mutedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unmute('${item.userId}')">Unmute</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${esc(item.reason)}</small><br>
                <small>Duration: ${timeLeft}</small>
            </div>
        `;
        container.appendChild(div);
    });
}

window.selectAllMuted = () => document.querySelectorAll('.muted-checkbox').forEach(cb => cb.checked = true);
window.selectAllBanned = () => document.querySelectorAll('.banned-checkbox').forEach(cb => cb.checked = true);
window.selectAllModMuted = () => document.querySelectorAll('.mod-muted-checkbox').forEach(cb => cb.checked = true);

window.unmuteSelected = function() {
    const selected = Array.from(document.querySelectorAll('.muted-checkbox:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('Select users first', 'error');
    showConfirm(`Unmute ${selected.length} users?`, ok => {
        if (ok) {
            socket.emit('unmute-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-muted-list'), 500);
        }
    });
};

window.unbanSelected = function() {
    const selected = Array.from(document.querySelectorAll('.banned-checkbox:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('Select users first', 'error');
    showConfirm(`Unban ${selected.length} users?`, ok => {
        if (ok) {
            socket.emit('unban-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-banned-list'), 500);
        }
    });
};

window.unmuteModSelected = function() {
    const selected = Array.from(document.querySelectorAll('.mod-muted-checkbox:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('Select users first', 'error');
    showConfirm(`Unmute ${selected.length} users?`, ok => {
        if (ok) {
            selected.forEach(userId => socket.emit('unmute-user', { userId }));
            setTimeout(() => {
                socket.emit('get-muted-list');
                socket.once('muted-list', displayModMutedList);
            }, 500);
        }
    });
};

window.unmute = function(userId) {
    socket.emit('unmute-user', { userId });
    setTimeout(() => socket.emit('get-muted-list'), 500);
};

window.unban = function(userId) {
    socket.emit('unban-user', { userId });
    setTimeout(() => socket.emit('get-banned-list'), 500);
};

window.deleteSupportMessage = function(messageId) {
    socket.emit('delete-support-message', { messageId });
    setTimeout(() => socket.emit('get-support-messages'), 500);
};

// Continue to final utilities...
// ═══════════════════════════════════════════════════════════════
// Cold Room V3.0 - Final Part (Settings & Utilities)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════
function loadSettings() {
    document.getElementById('setting-logo').value = systemSettings.siteLogo || '';
    document.getElementById('setting-title').value = systemSettings.siteTitle || '';
    document.getElementById('setting-color').value = systemSettings.backgroundColor || 'blue';
    document.getElementById('setting-login-music').value = systemSettings.loginMusic || '';
    document.getElementById('setting-chat-music').value = systemSettings.chatMusic || '';
    document.getElementById('setting-login-volume').value = systemSettings.loginMusicVolume || 0.5;
    document.getElementById('setting-chat-volume').value = systemSettings.chatMusicVolume || 0.5;
}

function loadRoomsForClean() {
    socket.emit('get-rooms');
    socket.once('rooms-list', (rooms) => {
        const select = document.getElementById('clean-room-select');
        if (!select) return;
        select.innerHTML = '<option value="">Select Room</option>';
        rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            select.appendChild(option);
        });
    });
}

window.updateLogo = function() {
    const logo = document.getElementById('setting-logo').value.trim();
    if (!logo) return showAlert('Enter logo URL', 'error');
    socket.emit('update-settings', { siteLogo: logo });
};

window.updateTitle = function() {
    const title = document.getElementById('setting-title').value.trim();
    if (!title) return showAlert('Enter title', 'error');
    socket.emit('update-settings', { siteTitle: title });
};

window.updateColor = function() {
    const color = document.getElementById('setting-color').value;
    socket.emit('update-settings', { backgroundColor: color });
};

window.updateLoginMusic = function() {
    const music = document.getElementById('setting-login-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-login-volume').value);
    socket.emit('update-settings', { loginMusic: music, loginMusicVolume: volume });
};

window.updateChatMusic = function() {
    const music = document.getElementById('setting-chat-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-chat-volume').value);
    socket.emit('update-settings', { chatMusic: music, chatMusicVolume: volume });
};

window.cleanSelectedRoom = function() {
    const roomId = document.getElementById('clean-room-select').value;
    if (!roomId) return showAlert('Select a room', 'error');
    showConfirm('Clean messages in selected room?', ok => {
        if (ok) socket.emit('clean-chat', { roomId });
    });
};

window.cleanAllRooms = function() {
    showConfirm('⚠️ Clean ALL messages in ALL rooms?\n\nThis will remove everything permanently!', ok => {
        if (ok) socket.emit('clean-all-rooms');
    });
};

function applySiteSettings() {
    document.querySelectorAll('#main-logo, #header-logo, .welcome-logo').forEach(el => {
        if (el.tagName === 'IMG') el.src = systemSettings.siteLogo;
    });
    document.getElementById('site-favicon').href = systemSettings.siteLogo;
    document.getElementById('site-title').textContent = systemSettings.siteTitle;
    document.getElementById('main-title').textContent = systemSettings.siteTitle;
    document.getElementById('header-title').textContent = systemSettings.siteTitle;

    document.body.classList.remove('black-theme', 'red-theme');
    if (systemSettings.backgroundColor === 'black') {
        document.body.classList.add('black-theme');
    } else if (systemSettings.backgroundColor === 'red') {
        document.body.classList.add('red-theme');
    }

    updateMusicPlayers();
    updateSnowmanTheme();
}

function updateMusicPlayers() {
    const loginMusic = document.getElementById('login-music');
    const chatMusic = document.getElementById('chat-music');

    if (systemSettings.loginMusic) {
        loginMusic.src = systemSettings.loginMusic;
        loginMusic.volume = systemSettings.loginMusicVolume || 0.5;
        loginMusic.play().catch(() => {});
    }

    if (systemSettings.chatMusic) {
        chatMusic.src = systemSettings.chatMusic;
        chatMusic.volume = systemSettings.chatMusicVolume || 0.5;
    }
}

function stopLoginMusic() {
    const audio = document.getElementById('login-music');
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function playChatMusic() {
    const audio = document.getElementById('chat-music');
    if (audio && audio.src && currentRoom === 'global_cold') {
        audio.loop = true;
        audio.play().catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════
// PARTY MODE
// ═══════════════════════════════════════════════════════════════
window.togglePartyMode = function() {
    const enabled = !document.body.classList.contains('party-mode');
    socket.emit('toggle-party-mode', { roomId: currentRoom, enabled });
};

function togglePartyEffects(enabled) {
    if (enabled) {
        document.body.classList.add('party-mode');
        createPartyLights();
    } else {
        document.body.classList.remove('party-mode');
        removePartyLights();
    }
}

function createPartyLights() {
    let container = document.getElementById('party-lights');
    if (container) return;

    container = document.createElement('div');
    container.id = 'party-lights';
    container.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 1;
    `;

    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    
    for (let i = 0; i < 20; i++) {
        const light = document.createElement('div');
        light.style.cssText = `
            position: absolute;
            width: ${Math.random() * 100 + 50}px;
            height: ${Math.random() * 100 + 50}px;
            background: radial-gradient(circle, ${colors[Math.floor(Math.random() * colors.length)]} 0%, transparent 70%);
            border-radius: 50%;
            top: ${Math.random() * 100}%;
            left: ${Math.random() * 100}%;
            animation: partyFloat ${Math.random() * 3 + 2}s infinite ease-in-out;
            opacity: 0.6;
        `;
        container.appendChild(light);
    }
    document.body.appendChild(container);
}

function removePartyLights() {
    const container = document.getElementById('party-lights');
    if (container) container.remove();
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
window.hideModal = (modalId) => document.getElementById(modalId).classList.remove('active');

function clearMessages() {
    const container = document.getElementById('messages');
    if (container) {
        container.innerHTML = `
            <div class="welcome-message glass-card">
                <img src="${systemSettings.siteLogo}" alt="Welcome" class="welcome-logo">
                <h3>Welcome to ${systemSettings.siteTitle}! ❄️</h3>
                <p>Start chatting with others</p>
            </div>
        `;
    }
}

function scrollToBottom() {
    const container = document.getElementById('messages');
    if (container) setTimeout(() => container.scrollTop = container.scrollHeight, 100);
}

function esc(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showAlert(message, type = 'info') {
    const colors = { error: '#dc2626', success: '#10b981', warning: '#f59e0b', info: '#4a90e2' };
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    alertDiv.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: ${colors[type]}; color: white;
        padding: 1rem 1.5rem; border-radius: 12px;
        z-index: 10000; font-weight: 600;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        max-width: 400px; animation: slideIn 0.3s ease-out;
    `;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => alertDiv.remove(), 300);
    }, 4000);
}

function showNotification(message) {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; top: 80px; right: 20px;
        background: rgba(74, 144, 226, 0.9); color: white;
        padding: 1rem 1.5rem; border-radius: 12px;
        z-index: 9999; animation: slideIn 0.3s ease-out;
    `;
    div.textContent = message;
    document.body.appendChild(div);
    
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function showLoading(message = 'Loading...') {
    let div = document.getElementById('loading-overlay');
    if (!div) {
        div = document.createElement('div');
        div.id = 'loading-overlay';
        document.body.appendChild(div);
    }
    div.innerHTML = `
        <div>
            <div class="spinner"></div>
            <div style="margin-top: 1.5rem; font-size: 1.2rem; font-weight: 600;">${message}</div>
        </div>
    `;
}

function hideLoading() {
    const div = document.getElementById('loading-overlay');
    if (div) div.remove();
}

function showConfirm(message, callback) {
    confirmCallback = callback;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('active');
}

window.confirmAction = function(confirmed) {
    hideModal('confirm-modal');
    if (confirmCallback) {
        confirmCallback(confirmed);
        confirmCallback = null;
    }
};

function startHeartbeat() {
    setInterval(() => {
        if (socket && socket.connected) socket.emit('ping');
    }, 30000);
}

// ═══════════════════════════════════════════════════════════════
// VISUAL EFFECTS
// ═══════════════════════════════════════════════════════════════
function createSnowfall() {
    const container = document.getElementById('snowflakes');
    if (!container) return;
    container.innerHTML = '';
    const isRedTheme = document.body.classList.contains('red-theme');
    const symbol = isRedTheme ? '🔥' : '❄';
    
    for (let i = 0; i < 50; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = symbol;
        snowflake.style.cssText = `
            left: ${Math.random() * 100}%;
            animation-duration: ${Math.random() * 3 + 2}s;
            animation-delay: ${Math.random() * 5}s;
            font-size: ${Math.random() * 10 + 10}px;
        `;
        container.appendChild(snowflake);
    }
}

function drawSnowman() {
    const canvas = document.getElementById('snowman-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 250;
    
    const isRedTheme = document.body.classList.contains('red-theme');
    ctx.globalAlpha = 0.25;

    if (isRedTheme) {
        const gradient = ctx.createRadialGradient(100, 180, 20, 100, 180, 50);
        gradient.addColorStop(0, '#ff4500');
        gradient.addColorStop(0.5, '#ff6347');
        gradient.addColorStop(1, '#dc143c');
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle = 'white';
    }

    ctx.beginPath();
    ctx.arc(100, 180, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isRedTheme ? '#ff0000' : '#4a90e2';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(100, 110, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(100, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(90, 45, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(110, 45, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isRedTheme ? '#ff4500' : 'orange';
    ctx.beginPath();
    ctx.moveTo(100, 50);
    ctx.lineTo(120, 50);
    ctx.lineTo(100, 55);
    ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(100, 60, 10, 0, Math.PI);
    ctx.stroke();

    ctx.fillStyle = 'black';
    [100, 115, 130].forEach(y => {
        ctx.beginPath();
        ctx.arc(100, y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    let y = 0, direction = 1;
    setInterval(() => {
        y += direction * 0.5;
        if (y > 10 || y < -10) direction *= -1;
        canvas.style.transform = `translateX(-50%) translateY(${y}px)`;
    }, 50);
}

function updateSnowmanTheme() {
    const canvas = document.getElementById('snowman-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSnowman();
    }
    createSnowfall();
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async function() {
    console.log('❄️ Cold Room V3.0 Ready');
    await fetchInitialSettings();
    initializeSocket();
    createSnowfall();
    drawSnowman();
});

console.log('✅ Cold Room V3.0 Enhanced & Complete - All Features Working');

// ═══════════════════════════════════════════════════════════════
// END - Cold Room V3.0 Final Complete
// © 2025 Cold Room - All Rights Reserved
// Version: 3.0 - Complete with Profile Pictures, Room Media & Advanced Features
// ═══════════════════════════════════════════════════════════════
