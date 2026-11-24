/**
 * Chat Page Main Entrypoint
 */

import { apiRequest } from '/js/api.js';
import { initDashboardShell } from '/js/layout.js';
import { formatFileSize, initIcons, showToast } from '/js/ui.js';
import {
  chatState, getDom, openChannelsDrawer, closeChannelsDrawer, loadAllStudents
} from '/js/chat/state.js';
import {
  loadMessages, syncNewMessages, initEditMessageModal, handleChatSubmit, connectWebSocket
} from '/js/chat/realtime.js';
import { loadDmsList, selectDmConversation, initDmUi } from '/js/chat/dms.js';
import { loadGroupsList, initGroupsUi } from '/js/chat/groups.js';

const user = initDashboardShell({
  active: 'chat',
  mobileTitle: 'Realtime Chat',
  mobileRightHtml: `
    <button id="open-new-dm-mob" class="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs">
      <i data-lucide="user-plus" class="w-3 h-3"></i> DM
    </button>
  `
});

if (user) {
  chatState.user = user;
  const dom = getDom();

  const classBtn = document.getElementById('class-channel-btn');
  if (classBtn && user.className) {
    const cleanClass = user.className.toLowerCase().replace(/\s+/g, '_');
    classBtn.dataset.channel = `class_${cleanClass}`;
    classBtn.dataset.title = `${user.className} Hub`;
    classBtn.querySelector('.channel-label').textContent = `#${cleanClass}`;
  }

  document.getElementById('toggle-channels-mob-btn')?.addEventListener('click', openChannelsDrawer);
  document.getElementById('close-channels-mob-btn')?.addEventListener('click', closeChannelsDrawer);
  dom.channelsBackdrop?.addEventListener('click', closeChannelsDrawer);

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
    dom.chatInput.required = false;
    initIcons();
  });

  dom.removeAttachmentBtn?.addEventListener('click', () => {
    chatState.selectedAttachmentFile = null;
    dom.chatFileInput.value = '';
    dom.attachmentPreviewBar.classList.add('hidden');
    dom.chatInput.required = true;
  });

  // Left panel tabs: Hub / DMs / Groups
  document.querySelectorAll('.chat-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chat-tab-btn').forEach(b => {
        b.classList.remove('active', 'bg-white', 'text-indigo-600', 'shadow-xs');
        b.classList.add('text-slate-600');
      });
      btn.classList.add('active', 'bg-white', 'text-indigo-600', 'shadow-xs');
      btn.classList.remove('text-slate-600');

      const targetId = btn.dataset.target;
      ['channels-list', 'dms-list', 'groups-list'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== targetId);
      });

      if (targetId === 'dms-list') loadDmsList();
      if (targetId === 'groups-list') loadGroupsList();
    });
  });

  // Public channel click
  document.querySelectorAll('.channel-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.channel-item').forEach(b => b.classList.remove('active', 'bg-indigo-50', 'text-indigo-700'));
      btn.classList.add('active', 'bg-indigo-50', 'text-indigo-700');

      closeChannelsDrawer();
      chatState.currentChatType = 'channel';
      chatState.currentChannel = btn.dataset.channel;
      chatState.activeDmData = null;
      chatState.currentGroupId = null;
      dom.groupInfoBtn?.classList.add('hidden');

      dom.channelNameEl.textContent = btn.dataset.title;
      dom.chatSubtitleEl.textContent = 'Public stream • Auto-purge after 7 days';
      dom.currentChatIcon.innerHTML = `<i data-lucide="hash" class="w-4 h-4"></i>`;
      dom.dmPermissionBanner.classList.add('hidden');
      dom.chatInput.disabled = false;
      dom.chatInput.placeholder = `Message ${btn.dataset.title}...`;
      dom.sendBtn.disabled = false;
      dom.attachBtn.disabled = false;

      initIcons();
      loadMessages();
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
  loadMessages();
  loadAllStudents().catch(() => {});
  connectWebSocket(loadDmsList);
}
