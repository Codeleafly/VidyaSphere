/**
 * Chat Page Main Entrypoint (Rebuilt Material You Engine)
 */

import { apiRequest } from '/js/api.js';
import { initDashboardShell } from '/js/layout.js';
import { CLASS_LIST, escapeHtml, formatFileSize, initIcons, showToast } from '/js/ui.js';
import {
  chatState, getDom, openChannelsDrawer, closeChannelsDrawer, loadAllStudents
} from '/js/chat/state.js';
import {
  loadMessages, syncNewMessages, initEditMessageModal, handleChatSubmit,
  connectWebSocket, clearReplyTarget, sendTypingSignal
} from '/js/chat/realtime.js';
import { loadDmsList, selectDmConversation, initDmUi } from '/js/chat/dms.js';
import { loadGroupsList, initGroupsUi } from '/js/chat/groups.js';

const user = initDashboardShell({
  active: 'chat',
  mobileTitle: 'Realtime Chat',
  mobileRightHtml: `
    <button id="open-new-dm-mob" class="px-2.5 py-1 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] text-[11px] font-bold flex items-center gap-1">
      <i data-lucide="user-plus" class="w-3 h-3"></i> DM
    </button>
  `
});

function toClassChannel(cls) {
  return `class_${String(cls).trim().toLowerCase().replace(/\s+/g, '_')}`;
}

function buildHubChannels(u) {
  const listEl = document.getElementById('channels-list');
  if (!listEl) return;

  const baseChannels = [
    { channel: 'school', title: 'School Hub', label: '#school-hub', icon: 'hash', badge: 'All' },
    { channel: 'academics', title: 'Academics & Study', label: '#academics', icon: 'book-open', badge: 'Doubts' },
    { channel: 'sports', title: 'Sports & Events', label: '#sports', icon: 'trophy', badge: '' },
  ];

  const classChannels = [];
  if (u.role === 'student' && u.className) {
    classChannels.push({
      channel: toClassChannel(u.className),
      title: `${u.className} Hub`,
      label: `#${u.className.toLowerCase().replace(/\s+/g, '-')}`,
      icon: 'users',
      badge: 'My Class',
    });
  } else if (u.role === 'teacher') {
    const unique = [...new Set([...(u.teacherType === 'class' && u.className ? [u.className] : []), ...(u.assignedClasses || [])])];
    unique.forEach(c => {
      classChannels.push({
        channel: toClassChannel(c),
        title: `${c} Hub`,
        label: `#${c.toLowerCase().replace(/\s+/g, '-')}`,
        icon: 'users',
        badge: 'Class',
      });
    });
  }

  const allItems = [baseChannels[0], ...classChannels, baseChannels[1], baseChannels[2]];

  listEl.innerHTML = `
    <div class="space-y-1">
      ${allItems.map((ch, idx) => `
        <button class="channel-item ${idx === 0 ? 'active bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] font-bold' : 'text-[var(--md-on-surface)] font-semibold hover:bg-[var(--md-surface-container)]'} w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition"
          data-channel="${escapeHtml(ch.channel)}" data-title="${escapeHtml(ch.title)}">
          <span class="flex items-center gap-2 truncate">
            <i data-lucide="${ch.icon}" class="w-4 h-4 shrink-0 text-[var(--md-primary)]"></i>
            <span class="channel-label truncate">${escapeHtml(ch.label)}</span>
          </span>
          ${ch.badge ? `<span class="text-[9px] px-2 py-0.5 rounded-full bg-white/80 text-[var(--md-primary)] font-bold shrink-0">${escapeHtml(ch.badge)}</span>` : ''}
        </button>
      `).join('')}
    </div>
    ${u.role === 'admin' ? `
      <div class="pt-3 mt-2 border-t border-[var(--md-outline)] space-y-1.5 px-1">
        <label class="block text-[10px] font-bold uppercase tracking-wider text-[var(--md-on-surface-variant)]">Admin Class Switcher</label>
        <select id="admin-class-channel-picker" class="m3-input w-full px-3 py-2 rounded-2xl border border-[var(--md-outline)] bg-white text-xs font-semibold">
          <option value="">Open any Class Hub...</option>
          ${CLASS_LIST.map(c => `<option value="${escapeHtml(toClassChannel(c))}" data-title="${escapeHtml(c)} Hub">${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
  `;

  listEl.querySelectorAll('.channel-item').forEach(btn => {
    btn.addEventListener('click', () => activateChannel(btn.dataset.channel, btn.dataset.title, btn));
  });

  const adminPicker = document.getElementById('admin-class-channel-picker');
  adminPicker?.addEventListener('change', (e) => {
    const ch = e.target.value;
    if (!ch) return;
    const title = e.target.options[e.target.selectedIndex]?.dataset.title || ch;
    activateChannel(ch, title, null);
  });
}

function activateChannel(channel, title, activeBtn = null) {
  const dom = getDom();
  document.querySelectorAll('.channel-item').forEach(b => {
    b.className = 'channel-item text-[var(--md-on-surface)] font-semibold hover:bg-[var(--md-surface-container)] w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition';
  });
  if (activeBtn) {
    activeBtn.className = 'channel-item active bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] font-bold w-full px-3 py-2.5 rounded-2xl text-left flex items-center justify-between transition';
  }

  closeChannelsDrawer();
  clearReplyTarget();
  chatState.currentChatType = 'channel';
  chatState.currentChannel = channel;
  chatState.activeDmData = null;
  chatState.currentGroupId = null;
  chatState.typingUsers.clear();
  dom.typingIndicatorBar?.classList.add('hidden');
  dom.groupInfoBtn?.classList.add('hidden');
  dom.groupInfoBtn?.classList.remove('inline-flex');

  dom.channelNameEl.textContent = title;
  dom.chatSubtitleEl.textContent = 'Public stream • 7-day auto-purge';
  dom.currentChatIcon.innerHTML = `<i data-lucide="hash" class="w-4 h-4"></i>`;
  dom.dmPermissionBanner.classList.add('hidden');
  dom.chatInput.disabled = false;
  dom.chatInput.placeholder = `Message ${title}...`;
  dom.sendBtn.disabled = false;
  dom.attachBtn.disabled = false;

  initIcons();
  loadMessages();
}

if (user) {
  chatState.user = user;
  const dom = getDom();

  buildHubChannels(user);

  document.getElementById('toggle-channels-mob-btn')?.addEventListener('click', openChannelsDrawer);
  document.getElementById('close-channels-mob-btn')?.addEventListener('click', closeChannelsDrawer);
  dom.channelsBackdrop?.addEventListener('click', closeChannelsDrawer);

  // Reply cancel
  dom.cancelReplyBtn?.addEventListener('click', clearReplyTarget);

  // Pinned drawer toggle
  document.getElementById('pinned-bar-toggle')?.addEventListener('click', () => {
    document.getElementById('pinned-drawer')?.classList.toggle('hidden');
  });

  // In-chat Search bar
  const searchBar = document.getElementById('chat-search-bar');
  const msgSearchInput = document.getElementById('chat-msg-search-input');
  document.getElementById('toggle-chat-search-btn')?.addEventListener('click', () => {
    searchBar?.classList.toggle('hidden');
    if (!searchBar?.classList.contains('hidden')) msgSearchInput?.focus();
  });
  document.getElementById('clear-chat-search-btn')?.addEventListener('click', () => {
    if (msgSearchInput) msgSearchInput.value = '';
    chatState.searchQuery = '';
    searchBar?.classList.add('hidden');
    loadMessages();
  });
  msgSearchInput?.addEventListener('input', (e) => {
    clearTimeout(window._chatMsgSearchTimer);
    window._chatMsgSearchTimer = setTimeout(() => {
      chatState.searchQuery = e.target.value.trim();
      loadMessages();
    }, 300);
  });

  // Emoji popover
  const emojiBar = document.getElementById('composer-emoji-bar');
  document.getElementById('toggle-emoji-btn')?.addEventListener('click', () => emojiBar?.classList.toggle('hidden'));
  document.querySelectorAll('.emoji-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.chatInput.value += btn.textContent;
      dom.chatInput.focus();
    });
  });

  // Typing debounce over WebSocket
  let typingTimeout = null;
  dom.chatInput?.addEventListener('input', () => {
    sendTypingSignal(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => sendTypingSignal(false), 2000);
  });

  // Scroll-to-bottom FAB visibility
  dom.messagesContainer?.addEventListener('scroll', () => {
    const distFromBottom = dom.messagesContainer.scrollHeight - dom.messagesContainer.scrollTop - dom.messagesContainer.clientHeight;
    dom.scrollBottomBtn?.classList.toggle('hidden', distFromBottom < 200);
    dom.scrollBottomBtn?.classList.toggle('flex', distFromBottom >= 200);
  });
  dom.scrollBottomBtn?.addEventListener('click', () => {
    dom.messagesContainer.scrollTo({ top: dom.messagesContainer.scrollHeight, behavior: 'smooth' });
  });

  // Sidebar filter (Hubs / DMs / Groups)
  document.getElementById('sidebar-filter-input')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#channels-list .channel-item, #dms-items-container .dm-item, #groups-items-container .group-item').forEach(el => {
      const txt = el.textContent.toLowerCase();
      el.classList.toggle('hidden', Boolean(q && !txt.includes(q)));
    });
  });

  // Attachment selection
  dom.attachBtn?.addEventListener('click', () => dom.chatFileInput.click());
  dom.chatFileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showToast('File size exceeds the 15MB limit', 'warning');
      dom.chatFileInput.value = '';
      return;
    }
    chatState.selectedAttachmentFile = file;
    dom.attachmentNameText.textContent = file.name;
    dom.attachmentSizeText.textContent = `(${formatFileSize(file.size)})`;
    dom.attachmentPreviewBar.classList.remove('hidden');
    dom.attachmentPreviewBar.classList.add('flex');
    dom.chatInput.required = false;
    initIcons();
  });

  dom.removeAttachmentBtn?.addEventListener('click', () => {
    chatState.selectedAttachmentFile = null;
    dom.chatFileInput.value = '';
    dom.attachmentPreviewBar.classList.add('hidden');
    dom.attachmentPreviewBar.classList.remove('flex');
    dom.chatInput.required = true;
  });

  // Left panel tabs: Hubs / DMs / Groups
  document.querySelectorAll('.chat-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-tab-btn').forEach(b => {
        b.className = 'chat-tab-btn py-1.5 rounded-full text-[var(--md-on-surface-variant)] transition flex items-center justify-center gap-1';
      });
      btn.className = 'chat-tab-btn active py-1.5 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] transition flex items-center justify-center gap-1';

      const targetId = btn.dataset.target;
      ['channels-list', 'dms-list', 'groups-list'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== targetId);
      });

      if (targetId === 'dms-list') loadDmsList();
      if (targetId === 'groups-list') loadGroupsList();
    });
  });

  // Accept / Decline DM or Group invite
  document.getElementById('accept-dm-btn')?.addEventListener('click', async () => {
    if (chatState.currentChatType === 'dm' && chatState.activeDmData) {
      try {
        await apiRequest(`/chat/dms/${encodeURIComponent(chatState.activeDmData.dmId)}/accept`, { method: 'POST' });
        showToast('Chat request accepted!', 'success');
        chatState.activeDmData.status = 'accepted';
        selectDmConversation(chatState.activeDmData);
        loadDmsList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else if (chatState.currentChatType === 'group' && chatState.currentGroupId) {
      try {
        await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/accept`, { method: 'POST' });
        showToast('Joined study group successfully!', 'success');
        chatState.currentGroupInviteStatus = 'accepted';
        dom.dmPermissionBanner.classList.add('hidden');
        dom.chatInput.disabled = false;
        dom.chatInput.placeholder = `Message ${chatState.currentGroupName}...`;
        dom.sendBtn.disabled = false;
        dom.attachBtn.disabled = false;
        loadGroupsList();
        loadMessages();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  document.getElementById('decline-dm-btn')?.addEventListener('click', async () => {
    if (chatState.currentChatType === 'dm' && chatState.activeDmData) {
      try {
        await apiRequest(`/chat/dms/${encodeURIComponent(chatState.activeDmData.dmId)}/decline`, { method: 'POST' });
        showToast('Chat request declined.', 'info');
        loadDmsList();
        document.querySelector('.channel-item[data-channel="school"]')?.click();
      } catch (err) {
        showToast(err.message, 'error');
      }
    } else if (chatState.currentChatType === 'group' && chatState.currentGroupId) {
      try {
        await apiRequest(`/chat/groups/${encodeURIComponent(chatState.currentGroupId)}/decline`, { method: 'POST' });
        showToast('Group invitation declined.', 'info');
        loadGroupsList();
        document.querySelector('.channel-item[data-channel="school"]')?.click();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  dom.chatForm?.addEventListener('submit', handleChatSubmit);
  document.getElementById('refresh-chat-btn')?.addEventListener('click', loadMessages);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncNewMessages();
      if (!chatState.ws || chatState.ws.readyState !== WebSocket.OPEN) connectWebSocket(loadDmsList);
    }
  });
  window.addEventListener('focus', () => syncNewMessages());
  window.addEventListener('online', () => {
    syncNewMessages();
    connectWebSocket(loadDmsList);
  });

  initEditMessageModal();
  initDmUi();
  initGroupsUi();
  initIcons();

  // Check URL deep link params (?dm=..., ?group=..., ?channel=...)
  const urlParams = new URLSearchParams(window.location.search);
  const dmParam = urlParams.get('dm');
  const groupParam = urlParams.get('group');
  const channelParam = urlParams.get('channel');

  if (dmParam) {
    document.querySelector('.chat-tab-btn[data-target="dms-list"]')?.click();
    loadDmsList(dmParam);
  } else if (groupParam) {
    document.querySelector('.chat-tab-btn[data-target="groups-list"]')?.click();
    loadGroupsList(groupParam);
  } else if (channelParam) {
    const chBtn = document.querySelector(`.channel-item[data-channel="${CSS.escape(channelParam)}"]`);
    if (chBtn) {
      chBtn.click();
    } else {
      activateChannel(channelParam, channelParam.replace('class_', 'Class ').replace(/_/g, ' '), null);
    }
  } else {
    loadMessages();
    loadDmsList().catch(() => {});
    loadGroupsList().catch(() => {});
  }

  loadAllStudents().catch(() => {});
  connectWebSocket(() => {
    if (!document.getElementById('dms-list')?.classList.contains('hidden')) loadDmsList();
  });
}
