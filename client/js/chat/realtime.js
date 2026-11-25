/**
 * Chat Realtime Sync Engine, WebSocket Heartbeat, Send/Edit/Delete & Attachment Downloads
 */

import { apiRequest } from '/js/api.js';
import { getToken } from '/js/auth.js';
import { initIcons, showToast, bindModalBackdropAndEsc, escapeHtml } from '/js/ui.js';
import { chatState, getDom, renderMessageHtml, scrollToBottom } from '/js/chat/state.js';

function renderPinnedBar(pinnedMessages = []) {
  const bar = document.getElementById('pinned-bar');
  const txt = document.getElementById('pinned-bar-text');
  const cnt = document.getElementById('pinned-bar-count');
  if (!bar || !txt || !cnt) return;
  if (!pinnedMessages || pinnedMessages.length === 0) {
    bar.classList.add('hidden');
    return;
  }
  const latest = pinnedMessages[0];
  txt.innerHTML = `<strong>${escapeHtml(latest.sender_name || 'Faculty')}:</strong> ${escapeHtml(latest.content)}`;
  cnt.textContent = `${pinnedMessages.length} pinned`;
  bar.classList.remove('hidden');
}

function reconcileTempElement(tempEl, serverMsg) {
  if (!tempEl || !serverMsg?.id) return false;
  chatState.knownMessageIds.add(serverMsg.id);
  tempEl.outerHTML = renderMessageHtml(serverMsg);
  attachMessageActionListeners();
  initIcons();
  return true;
}

export async function loadMessages() {
  const { messagesContainer } = getDom();
  try {
    const res = await apiRequest(`/chat/messages?channel=${encodeURIComponent(chatState.currentChannel)}`);
    const messages = res.messages || [];
    renderPinnedBar(res.pinnedMessages || []);

    chatState.knownMessageIds.clear();
    chatState.lastMessageCreatedAt = null;

    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
          <div class="w-11 h-11 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center mb-3 shadow-xs">
            <i data-lucide="message-circle" class="w-5 h-5 text-indigo-500"></i>
          </div>
          <p class="text-xs font-semibold text-slate-600">No messages in the past 7 days</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Start the conversation below</p>
        </div>
      `;
      initIcons();
      startLiveSync();
      return;
    }

    messages.forEach(m => {
      chatState.knownMessageIds.add(m.id);
      if (m.created_at || m.createdAt) chatState.lastMessageCreatedAt = m.created_at || m.createdAt;
    });

    messagesContainer.innerHTML = messages.map(renderMessageHtml).join('');
    attachMessageActionListeners();
    initIcons();
    scrollToBottom();
    startLiveSync();
  } catch (err) {
    messagesContainer.innerHTML = `<div class="p-4 text-center text-rose-600 text-xs font-medium">${err.message}</div>`;
  }
}

export async function syncNewMessages() {
  const { messagesContainer } = getDom();
  if (chatState.isSyncing || !chatState.currentChannel) return;
  chatState.isSyncing = true;

  try {
    const queryParams = [`channel=${encodeURIComponent(chatState.currentChannel)}`];
    if (chatState.lastMessageCreatedAt) {
      queryParams.push(`since=${encodeURIComponent(chatState.lastMessageCreatedAt)}`);
    }

    const res = await apiRequest(`/chat/messages?${queryParams.join('&')}`);
    const newMessages = res.messages || [];

    if (newMessages.length > 0) {
      if (messagesContainer.querySelector('.h-full')) {
        messagesContainer.innerHTML = '';
      }

      let addedAny = false;
      newMessages.forEach(msg => {
        if (!chatState.knownMessageIds.has(msg.id)) {
          const isMyMsg = (msg.sender_id === chatState.user?.id || msg.senderId === chatState.user?.id);
          if (isMyMsg) {
            const tempEl = messagesContainer.querySelector(`[id^="msg-temp_"]`);
            if (reconcileTempElement(tempEl, msg)) return;
          }

          chatState.knownMessageIds.add(msg.id);
          messagesContainer.insertAdjacentHTML('beforeend', renderMessageHtml(msg));
          addedAny = true;
        }
        if (msg.created_at || msg.createdAt) {
          chatState.lastMessageCreatedAt = msg.created_at || msg.createdAt;
        }
      });

      if (addedAny) {
        attachMessageActionListeners();
        initIcons();
        scrollToBottom();
      }
    }
  } catch {
    // Background sync ignores transient errors silently
  } finally {
    chatState.isSyncing = false;
  }
}

export function startLiveSync() {
  if (chatState.syncIntervalId) clearInterval(chatState.syncIntervalId);
  chatState.syncIntervalId = setInterval(syncNewMessages, 2500);
}

export function attachMessageActionListeners() {
  const { messagesContainer, editMsgModal, editMsgInput } = getDom();

  messagesContainer.querySelectorAll('.download-attachment-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const filename = btn.dataset.filename;
      try {
        showToast('Decompressing attachment losslessly...', 'info');
        const res = await fetch(`/api/chat/attachments/${encodeURIComponent(msgId)}`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to download attachment');
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        showToast('Downloaded in original quality!', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });

  messagesContainer.querySelectorAll('.edit-msg-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      chatState.editingMessageId = btn.dataset.msgId;
      editMsgInput.value = btn.dataset.content;
      editMsgModal.classList.remove('hidden');
      editMsgModal.classList.add('flex');
      editMsgInput.focus();
    });
  });

  messagesContainer.querySelectorAll('.pin-msg-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try {
        const res = await apiRequest(`/chat/messages/${encodeURIComponent(btn.dataset.msgId)}/pin`, { method: 'POST' });
        showToast(res.message || 'Pin updated', 'info');
        loadMessages();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });

  messagesContainer.querySelectorAll('.delete-msg-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      if (!confirm('Delete this message? Any attached files will also be permanently removed.')) return;
      try {
        await apiRequest(`/chat/messages/${encodeURIComponent(msgId)}`, { method: 'DELETE' });
        showToast('Message deleted', 'info');
        loadMessages();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

export function initEditMessageModal() {
  const { editMsgModal, editMsgInput } = getDom();
  const closeHandler = () => {
    chatState.editingMessageId = null;
    editMsgModal.classList.add('hidden');
    editMsgModal.classList.remove('flex');
  };

  document.getElementById('close-edit-modal')?.addEventListener('click', closeHandler);
  document.getElementById('cancel-edit-btn')?.addEventListener('click', closeHandler);
  bindModalBackdropAndEsc(editMsgModal, closeHandler);

  document.getElementById('save-edit-btn')?.addEventListener('click', async () => {
    if (!chatState.editingMessageId) return;
    const newContent = editMsgInput.value.trim();
    if (!newContent) {
      showToast('Message cannot be empty', 'warning');
      return;
    }
    try {
      await apiRequest(`/chat/messages/${encodeURIComponent(chatState.editingMessageId)}`, {
        method: 'PUT',
        body: { content: newContent }
      });
      showToast('Message updated', 'success');
      closeHandler();
      loadMessages();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

export async function handleChatSubmit(e) {
  e.preventDefault();
  if (chatState.isSendingMessage) return;

  const {
    chatInput, sendBtn, chatFileInput,
    attachmentPreviewBar, messagesContainer
  } = getDom();

  const content = chatInput.value.trim();
  if (!content && !chatState.selectedAttachmentFile) return;

  const fileToSend = chatState.selectedAttachmentFile;
  const sendChannel = chatState.currentChannel;
  const user = chatState.user;

  chatState.isSendingMessage = true;
  if (sendBtn) sendBtn.disabled = true;

  const tempId = 'temp_' + Date.now();
  chatState.knownMessageIds.add(tempId);

  const optimisticMsg = {
    id: tempId,
    sender_id: user.id,
    sender_name: user.fullName || user.username,
    sender_role: user.role,
    class_name: user.className || null,
    division: user.division || null,
    roll_number: user.rollNumber || null,
    is_root_admin: user.isRootAdmin ? 1 : 0,
    channel: sendChannel,
    content: content || (fileToSend ? `Shared attachment: ${fileToSend.name}` : ''),
    is_edited: 0,
    has_attachment: fileToSend ? 1 : 0,
    attachment_name: fileToSend ? fileToSend.name : null,
    attachment_type: fileToSend ? fileToSend.type : null,
    attachment_size: fileToSend ? fileToSend.size : 0,
    created_at: new Date().toISOString(),
  };

  if (messagesContainer.querySelector('.h-full')) {
    messagesContainer.innerHTML = '';
  }

  messagesContainer.insertAdjacentHTML('beforeend', renderMessageHtml(optimisticMsg));
  attachMessageActionListeners();
  initIcons();
  scrollToBottom();

  chatInput.value = '';
  chatState.selectedAttachmentFile = null;
  chatFileInput.value = '';
  attachmentPreviewBar.classList.add('hidden');
  chatInput.required = true;

  try {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('channel', sendChannel);
    if (fileToSend) formData.append('file', fileToSend);

    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to send message');
    }

    const data = await res.json();
    const tempEl = document.getElementById(`msg-${tempId}`);
    if (tempEl && data.id) {
      reconcileTempElement(tempEl, { ...optimisticMsg, ...data });
    }
    if (data.createdAt || data.created_at) {
      chatState.lastMessageCreatedAt = data.createdAt || data.created_at;
    }

    setTimeout(syncNewMessages, 300);
  } catch (err) {
    const tempEl = document.getElementById(`msg-${tempId}`);
    if (tempEl) {
      tempEl.classList.add('opacity-50');
      tempEl.title = 'Failed to deliver: ' + err.message;
    }
    showToast(err.message, 'error');
  } finally {
    chatState.isSendingMessage = false;
    if (sendBtn) sendBtn.disabled = false;
    chatInput.focus();
  }
}

export function connectWebSocket(onDmUpdate) {
  const token = getToken();
  if (!token) return;

  const { connectionStatus, connectionDot, messagesContainer } = getDom();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/chat/ws?token=${encodeURIComponent(token)}`;

  try {
    const ws = new WebSocket(wsUrl);
    chatState.ws = ws;

    ws.onopen = () => {
      if (connectionStatus) connectionStatus.textContent = 'Live Connected';
      if (connectionDot) connectionDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0';

      if (chatState.wsPingTimer) clearInterval(chatState.wsPingTimer);
      chatState.wsPingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;

        if (data.type === 'new_message' && data.message) {
          const msg = data.message;
          const matchesChannel = (msg.channel === chatState.currentChannel) ||
            (chatState.currentChannel.startsWith('dm_') && msg.channel.replace('dm_', '') === chatState.currentChannel.replace('dm_', ''));

          if (matchesChannel) {
            if (chatState.knownMessageIds.has(msg.id)) return;

            const isMyMessage = (msg.sender_id === chatState.user?.id || msg.senderId === chatState.user?.id);
            if (isMyMessage) {
              const tempEl = messagesContainer.querySelector(`[id^="msg-temp_"]`);
              if (reconcileTempElement(tempEl, msg)) return;
            }

            chatState.knownMessageIds.add(msg.id);
            if (messagesContainer.querySelector('.h-full')) {
              messagesContainer.innerHTML = '';
            }
            messagesContainer.insertAdjacentHTML('beforeend', renderMessageHtml(msg));
            attachMessageActionListeners();
            initIcons();
            scrollToBottom();

            if (msg.created_at || msg.createdAt) {
              chatState.lastMessageCreatedAt = msg.created_at || msg.createdAt;
            }
          }

          if (onDmUpdate && !document.getElementById('dms-list')?.classList.contains('hidden')) {
            onDmUpdate();
          }
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (chatState.wsPingTimer) clearInterval(chatState.wsPingTimer);
      if (connectionStatus) connectionStatus.textContent = 'Auto-Sync Active';
      if (connectionDot) connectionDot.className = 'w-2 h-2 rounded-full bg-amber-500 shrink-0';
      setTimeout(() => connectWebSocket(onDmUpdate), 4000);
    };

    ws.onerror = () => ws.close();
  } catch {
    setTimeout(() => connectWebSocket(onDmUpdate), 5000);
  }
}
