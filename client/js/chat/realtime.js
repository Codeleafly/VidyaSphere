/**
 * Chat Realtime Sync Engine, WebSocket Presence/Typing/Events, Send/Reply/React/Edit/Delete & Lazy Attachments
 */

import { apiRequest } from '/js/api.js';
import { getToken } from '/js/auth.js';
import { initIcons, showToast, bindModalBackdropAndEsc, escapeHtml } from '/js/ui.js';
import { chatState, getDom, getDayLabel, renderMessageHtml, renderReactionsHtml, scrollToBottom } from '/js/chat/state.js';

export function renderPinnedBar(pinnedMessages = []) {
  chatState.pinnedMessages = pinnedMessages || [];
  const bar = document.getElementById('pinned-bar');
  const txt = document.getElementById('pinned-bar-text');
  const cnt = document.getElementById('pinned-bar-count');
  const drawer = document.getElementById('pinned-drawer');
  if (!bar || !txt || !cnt) return;

  if (chatState.pinnedMessages.length === 0) {
    bar.classList.add('hidden');
    drawer?.classList.add('hidden');
    return;
  }
  const latest = chatState.pinnedMessages[0];
  txt.innerHTML = `<strong>${escapeHtml(latest.sender_name || 'Faculty')}:</strong> ${escapeHtml(latest.content)}`;
  cnt.textContent = `${chatState.pinnedMessages.length} pinned`;
  if (drawer) {
    drawer.innerHTML = chatState.pinnedMessages.map(pm => `
      <button type="button" class="jump-pinned-btn w-full text-left p-2 rounded-xl bg-white/85 hover:bg-white border border-[var(--md-outline)] flex items-center justify-between gap-2 text-[11px]" data-id="${escapeHtml(pm.id)}">
        <span class="truncate"><strong>${escapeHtml(pm.sender_name || 'Faculty')}:</strong> ${escapeHtml(pm.content)}</span>
        <span class="text-[10px] font-bold text-[var(--md-primary)] shrink-0">Jump</span>
      </button>
    `).join('');
    drawer.querySelectorAll('.jump-pinned-btn').forEach(btn => {
      btn.addEventListener('click', () => highlightMessage(btn.dataset.id));
    });
  }
  bar.classList.remove('hidden');
}

function highlightMessage(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (!el) {
    showToast('Message not in current view', 'info');
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('ring-2', 'ring-[var(--md-primary)]', 'rounded-2xl', 'p-1', 'bg-[var(--md-primary-container)]/30');
  setTimeout(() => {
    el.classList.remove('ring-2', 'ring-[var(--md-primary)]', 'rounded-2xl', 'p-1', 'bg-[var(--md-primary-container)]/30');
  }, 1800);
}

function renderDateDividerIfNeeded(messagesContainer, createdAt) {
  const dayLabel = getDayLabel(createdAt);
  if (!dayLabel || dayLabel === chatState.lastRenderedDateKey) return '';
  chatState.lastRenderedDateKey = dayLabel;
  return `
    <div class="flex items-center justify-center my-2">
      <span class="px-3 py-0.5 rounded-full bg-[var(--md-surface-container)] border border-[var(--md-outline)] text-[10px] font-bold text-[var(--md-on-surface-variant)]">
        ${escapeHtml(dayLabel)}
      </span>
    </div>
  `;
}

function reconcileTempElement(tempEl, serverMsg) {
  if (!tempEl || !serverMsg?.id) return false;
  chatState.knownMessageIds.add(serverMsg.id);
  tempEl.outerHTML = renderMessageHtml(serverMsg);
  attachMessageActionListeners();
  initIcons();
  return true;
}

export function setReplyTarget(msgId, senderName, content) {
  const { replyPreviewBar, replyPreviewAuthor, replyPreviewText, chatInput } = getDom();
  chatState.replyToMessage = { id: msgId, senderName, content };
  if (replyPreviewAuthor) replyPreviewAuthor.textContent = `Replying to ${senderName}`;
  if (replyPreviewText) replyPreviewText.textContent = content;
  replyPreviewBar?.classList.remove('hidden');
  replyPreviewBar?.classList.add('flex');
  chatInput?.focus();
  initIcons();
}

export function clearReplyTarget() {
  const { replyPreviewBar } = getDom();
  chatState.replyToMessage = null;
  replyPreviewBar?.classList.add('hidden');
  replyPreviewBar?.classList.remove('flex');
}

export async function loadMessages() {
  const { messagesContainer } = getDom();
  try {
    const params = [`channel=${encodeURIComponent(chatState.currentChannel)}`];
    if (chatState.searchQuery) params.push(`search=${encodeURIComponent(chatState.searchQuery)}`);

    const res = await apiRequest(`/chat/messages?${params.join('&')}`);
    const messages = res.messages || [];
    renderPinnedBar(res.pinnedMessages || []);

    chatState.knownMessageIds.clear();
    chatState.lastMessageCreatedAt = null;
    chatState.lastRenderedDateKey = null;

    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
          <div class="w-12 h-12 rounded-2xl bg-[var(--md-surface-container)] border border-[var(--md-outline)] flex items-center justify-center mb-3">
            <i data-lucide="message-circle" class="w-6 h-6 text-[var(--md-primary)]"></i>
          </div>
          <p class="text-xs font-bold text-[var(--md-on-surface)]">${chatState.searchQuery ? 'No matching messages found' : 'No messages in the past 7 days'}</p>
          <p class="text-[11px] text-[var(--md-on-surface-variant)] mt-0.5">${chatState.searchQuery ? 'Try another search keyword' : 'Start the conversation below'}</p>
        </div>
      `;
      initIcons();
      startLiveSync();
      return;
    }

    const htmlParts = [];
    messages.forEach(m => {
      chatState.knownMessageIds.add(m.id);
      const ts = m.created_at || m.createdAt;
      if (ts) {
        chatState.lastMessageCreatedAt = ts;
        htmlParts.push(renderDateDividerIfNeeded(messagesContainer, ts));
      }
      htmlParts.push(renderMessageHtml(m));
    });

    messagesContainer.innerHTML = htmlParts.join('');
    attachMessageActionListeners();
    initIcons();
    scrollToBottom(true);
    startLiveSync();
  } catch (err) {
    messagesContainer.innerHTML = `<div class="p-4 text-center text-rose-600 text-xs font-medium">${escapeHtml(err.message)}</div>`;
  }
}

export async function syncNewMessages() {
  const { messagesContainer } = getDom();
  if (chatState.isSyncing || !chatState.currentChannel || chatState.searchQuery) return;
  chatState.isSyncing = true;

  try {
    const queryParams = [`channel=${encodeURIComponent(chatState.currentChannel)}`];
    if (chatState.lastMessageCreatedAt) {
      queryParams.push(`since=${encodeURIComponent(chatState.lastMessageCreatedAt)}`);
    }

    const res = await apiRequest(`/chat/messages?${queryParams.join('&')}`);
    const newMessages = res.messages || [];
    if (res.pinnedMessages) renderPinnedBar(res.pinnedMessages);

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
          const divider = renderDateDividerIfNeeded(messagesContainer, msg.created_at || msg.createdAt);
          if (divider) messagesContainer.insertAdjacentHTML('beforeend', divider);
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
        scrollToBottom(false);
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
  chatState.syncIntervalId = setInterval(syncNewMessages, 3000);
}

export function attachMessageActionListeners() {
  const { messagesContainer, editMsgModal, editMsgInput } = getDom();

  messagesContainer.querySelectorAll('.jump-reply-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => highlightMessage(btn.dataset.targetId));
  });

  messagesContainer.querySelectorAll('.reply-msg-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      setReplyTarget(btn.dataset.msgId, btn.dataset.sender || 'Member', btn.dataset.content || '');
    });
  });

  messagesContainer.querySelectorAll('.react-chip-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const emoji = btn.dataset.emoji;
      try {
        const res = await apiRequest(`/chat/messages/${encodeURIComponent(msgId)}/react`, {
          method: 'POST',
          body: { emoji }
        });
        updateMessageReactionsInDom(msgId, res.reactions || {});
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });

  messagesContainer.querySelectorAll('.preview-image-btn').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const msgId = btn.dataset.msgId;
      const msgEl = document.getElementById(`msg-${msgId}`);
      const slot = msgEl?.querySelector('.img-preview-slot');
      if (!slot) return;
      if (!slot.classList.contains('hidden')) {
        slot.classList.add('hidden');
        return;
      }
      try {
        btn.disabled = true;
        btn.textContent = 'Loading...';
        const res = await fetch(`/api/chat/attachments/${encodeURIComponent(msgId)}`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!res.ok) throw new Error('Failed to load preview');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        slot.innerHTML = `<img src="${url}" alt="Attachment preview" class="max-h-64 w-full object-contain rounded-xl bg-black/5">`;
        slot.classList.remove('hidden');
        btn.textContent = 'Hide';
      } catch (err) {
        showToast(err.message, 'error');
        btn.textContent = 'Preview';
      } finally {
        btn.disabled = false;
      }
    });
  });

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
        document.getElementById(`msg-${msgId}`)?.remove();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

function updateMessageReactionsInDom(msgId, reactions) {
  const msgEl = document.getElementById(`msg-${msgId}`);
  if (!msgEl) return;
  const existingBar = msgEl.querySelector(`[data-reactions-for="${msgId}"]`);
  const newHtml = renderReactionsHtml({ id: msgId, reactions });
  if (existingBar) {
    if (newHtml) {
      existingBar.outerHTML = newHtml;
    } else {
      existingBar.remove();
    }
  } else if (newHtml) {
    const bubble = msgEl.children[1];
    if (bubble) bubble.insertAdjacentHTML('afterend', newHtml);
  }
  attachMessageActionListeners();
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
  const replySnapshot = chatState.replyToMessage;
  const user = chatState.user;

  chatState.isSendingMessage = true;
  if (sendBtn) sendBtn.disabled = true;

  const tempId = 'temp_' + Date.now();
  chatState.knownMessageIds.add(tempId);

  const optimisticMsg = {
    id: tempId,
    sender_id: user.id,
    sender_username: user.username,
    sender_name: user.fullName || user.username,
    sender_role: user.role,
    sender_teacher_type: user.teacherType || null,
    class_name: user.className || '',
    division: user.division || '',
    roll_number: user.rollNumber || '',
    is_root_admin: user.isRootAdmin ? 1 : 0,
    channel: sendChannel,
    content: content || (fileToSend ? `Shared attachment: ${fileToSend.name}` : ''),
    replyPreview: replySnapshot ? { id: replySnapshot.id, senderName: replySnapshot.senderName, content: replySnapshot.content } : null,
    reactions: {},
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
  scrollToBottom(true);

  chatInput.value = '';
  chatState.selectedAttachmentFile = null;
  chatFileInput.value = '';
  attachmentPreviewBar.classList.add('hidden');
  clearReplyTarget();
  chatInput.required = true;

  try {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('channel', sendChannel);
    if (replySnapshot?.id) formData.append('replyToId', replySnapshot.id);
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

    sendTypingSignal(false);
    setTimeout(syncNewMessages, 350);
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

export function sendTypingSignal(isTyping) {
  if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) return;
  if (!chatState.currentChannel || chatState.currentChatType !== 'channel') return;
  try {
    chatState.ws.send(JSON.stringify({
      type: 'typing',
      channel: chatState.currentChannel,
      isTyping: Boolean(isTyping),
    }));
  } catch { /* ignore */ }
}

function renderTypingBar() {
  const { typingIndicatorBar } = getDom();
  if (!typingIndicatorBar) return;
  const names = Array.from(chatState.typingUsers.values()).map(v => v.name);
  if (names.length === 0) {
    typingIndicatorBar.classList.add('hidden');
    typingIndicatorBar.textContent = '';
  } else {
    const label = names.length === 1 ? `${names[0]} is typing...` : `${names.slice(0, 2).join(', ')} are typing...`;
    typingIndicatorBar.textContent = label;
    typingIndicatorBar.classList.remove('hidden');
  }
}

export function connectWebSocket(onDmUpdate) {
  const token = getToken();
  if (!token) return;

  const { connectionStatus, connectionDot, onlineCountBadge, messagesContainer } = getDom();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/chat/ws?token=${encodeURIComponent(token)}`;

  try {
    const ws = new WebSocket(wsUrl);
    chatState.ws = ws;

    ws.onopen = () => {
      if (connectionStatus) connectionStatus.textContent = 'Live';
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
        if ((data.type === 'pong' || data.type === 'presence') && onlineCountBadge && data.onlineCount) {
          onlineCountBadge.textContent = `(${data.onlineCount} online)`;
          onlineCountBadge.classList.remove('hidden');
          if (data.type === 'pong') return;
        }

        const matchesChannel = data.channel && ((data.channel === chatState.currentChannel) ||
          (chatState.currentChannel.startsWith('dm_') && data.channel.replace('dm_', '') === chatState.currentChannel.replace('dm_', '')));

        if (data.type === 'typing' && matchesChannel && data.userId) {
          const existing = chatState.typingUsers.get(data.userId);
          if (existing?.timer) clearTimeout(existing.timer);
          if (data.isTyping) {
            const timer = setTimeout(() => {
              chatState.typingUsers.delete(data.userId);
              renderTypingBar();
            }, 3500);
            chatState.typingUsers.set(data.userId, { name: data.fullName || 'Someone', timer });
          } else {
            chatState.typingUsers.delete(data.userId);
          }
          renderTypingBar();
          return;
        }

        if (data.type === 'message_updated' && matchesChannel) {
          loadMessages();
          return;
        }
        if (data.type === 'message_deleted' && matchesChannel && data.id) {
          document.getElementById(`msg-${data.id}`)?.remove();
          return;
        }
        if (data.type === 'message_pinned' && matchesChannel) {
          loadMessages();
          return;
        }
        if (data.type === 'message_reacted' && matchesChannel && data.id) {
          updateMessageReactionsInDom(data.id, data.reactions || {});
          return;
        }

        if (data.type === 'new_message' && data.message) {
          const msg = data.message;
          const isMatch = (msg.channel === chatState.currentChannel) ||
            (chatState.currentChannel.startsWith('dm_') && msg.channel.replace('dm_', '') === chatState.currentChannel.replace('dm_', ''));

          if (isMatch) {
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
            const divider = renderDateDividerIfNeeded(messagesContainer, msg.created_at || msg.createdAt);
            if (divider) messagesContainer.insertAdjacentHTML('beforeend', divider);
            messagesContainer.insertAdjacentHTML('beforeend', renderMessageHtml(msg));
            attachMessageActionListeners();
            initIcons();
            scrollToBottom(false);

            if (msg.created_at || msg.createdAt) {
              chatState.lastMessageCreatedAt = msg.created_at || msg.createdAt;
            }
          }

          if (onDmUpdate) onDmUpdate();
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (chatState.wsPingTimer) clearInterval(chatState.wsPingTimer);
      if (connectionStatus) connectionStatus.textContent = 'Auto-Sync';
      if (connectionDot) connectionDot.className = 'w-2 h-2 rounded-full bg-amber-500 shrink-0';
      if (onlineCountBadge) onlineCountBadge.classList.add('hidden');
      setTimeout(() => connectWebSocket(onDmUpdate), 4000);
    };

    ws.onerror = () => ws.close();
  } catch {
    setTimeout(() => connectWebSocket(onDmUpdate), 5000);
  }
}
