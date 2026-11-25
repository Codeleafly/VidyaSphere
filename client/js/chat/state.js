/**
 * Shared Chat State, DOM Refs, Safe Message Renderer & Student Cache
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDateTime, formatFileSize, initIcons } from '/js/ui.js';

export const chatState = {
  user: null,
  currentChannel: 'school',
  currentChatType: 'channel',
  activeDmData: null,
  currentGroupId: null,
  currentGroupRole: 'member',
  currentGroupName: '',
  currentGroupMembers: [],
  currentGroupInviteStatus: 'accepted',
  allStudentsCache: [],
  selectedAttachmentFile: null,
  editingMessageId: null,
  lastMessageCreatedAt: null,
  knownMessageIds: new Set(),
  syncIntervalId: null,
  isSyncing: false,
  ws: null,
  wsPingTimer: null,
  isSendingMessage: false,
};

export function getDom() {
  return {
    channelsPanel: document.getElementById('channels-panel'),
    channelsBackdrop: document.getElementById('channels-backdrop'),
    messagesContainer: document.getElementById('messages-container'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    attachBtn: document.getElementById('attach-btn'),
    chatFileInput: document.getElementById('chat-file-input'),
    attachmentPreviewBar: document.getElementById('attachment-preview-bar'),
    attachmentNameText: document.getElementById('attachment-name-text'),
    attachmentSizeText: document.getElementById('attachment-size-text'),
    removeAttachmentBtn: document.getElementById('remove-attachment-btn'),
    channelNameEl: document.getElementById('channel-name'),
    chatSubtitleEl: document.getElementById('chat-subtitle'),
    connectionStatus: document.getElementById('connection-status'),
    connectionDot: document.getElementById('connection-dot'),
    currentChatIcon: document.getElementById('current-chat-icon'),
    dmPermissionBanner: document.getElementById('dm-permission-banner'),
    dmPermissionText: document.getElementById('dm-permission-text'),
    dmPermissionActions: document.getElementById('dm-permission-actions'),
    groupInfoBtn: document.getElementById('group-info-btn'),
    groupMembersCountBadge: document.getElementById('group-members-count-badge'),
    editMsgModal: document.getElementById('edit-msg-modal'),
    editMsgInput: document.getElementById('edit-msg-input'),
  };
}

export function openChannelsDrawer() {
  const { channelsPanel, channelsBackdrop } = getDom();
  channelsBackdrop?.classList.remove('hidden');
  channelsPanel?.classList.remove('hidden');
  channelsPanel?.classList.add('flex');
  initIcons();
}

export function closeChannelsDrawer() {
  const { channelsPanel, channelsBackdrop } = getDom();
  channelsBackdrop?.classList.add('hidden');
  if (window.innerWidth < 768) {
    channelsPanel?.classList.add('hidden');
    channelsPanel?.classList.remove('flex');
  }
}

export function scrollToBottom() {
  const { messagesContainer } = getDom();
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

export function renderMarkdownSafe(md) {
  if (!md) return '';
  let text = escapeHtml(md);
  text = text.replace(/`([^`]+)`/g, '<code class="bg-black/10 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text.replace(/\n/g, '<br>');
}

export function renderMessageHtml(msg) {
  const user = chatState.user;
  const senderId = msg.sender_id || msg.senderId;
  const isMe = !!(senderId && user?.id && String(senderId) === String(user.id));
  const isRoot = (msg.is_root_admin === 1 || msg.isRootAdmin === true || msg.isRootAdmin === 1);
  const isAdmin = isRoot || (msg.sender_role === 'admin' || msg.senderRole === 'admin');
  const isEdited = (msg.is_edited === 1 || msg.isEdited === 1 || msg.isEdited === true);
  const hasAttachment = (msg.has_attachment === 1 || msg.hasAttachment === 1 || msg.hasAttachment === true);
  const senderName = msg.sender_name || msg.senderName || 'Student';
  const className = msg.class_name || msg.className || '';
  const division = msg.division || '';
  const rollNumber = msg.roll_number || msg.rollNumber || '';
  const createdAt = msg.created_at || msg.createdAt || new Date().toISOString();
  const attachmentName = msg.attachment_name || msg.attachmentName || '';
  const attachmentType = msg.attachment_type || msg.attachmentType || '';
  const attachmentSize = msg.attachment_size || msg.attachmentSize || 0;

  let attachmentHtml = '';
  if (hasAttachment && attachmentName) {
    const isPdf = (attachmentType || '').includes('pdf') || attachmentName.toLowerCase().endsWith('.pdf');
    const isImg = (attachmentType || '').includes('image');
    const icon = isPdf ? 'file-text' : (isImg ? 'image' : 'file');

    attachmentHtml = `
      <div class="mt-2 p-2.5 rounded-xl ${isMe ? 'bg-white/15 text-white border-white/20' : 'bg-slate-50 text-slate-800 border-slate-200/80'} border flex items-center justify-between gap-2.5">
        <div class="flex items-center gap-2 overflow-hidden">
          <div class="w-7 h-7 rounded-lg ${isMe ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700'} flex items-center justify-center shrink-0">
            <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
          </div>
          <div class="overflow-hidden">
            <div class="font-semibold text-[11px] truncate max-w-[140px] sm:max-w-[200px]" title="${escapeHtml(attachmentName)}">${escapeHtml(attachmentName)}</div>
            <div class="text-[9px] opacity-75 tabular-nums">${formatFileSize(attachmentSize)} • Tap to download</div>
          </div>
        </div>
        <button type="button" class="download-attachment-btn px-2.5 py-1 rounded-lg ${
          isMe ? 'bg-white text-indigo-700 hover:bg-slate-100' : 'bg-slate-900 text-white hover:bg-indigo-600'
        } font-bold text-[10px] flex items-center gap-1 shrink-0 transition"
          data-msg-id="${escapeHtml(msg.id)}" data-filename="${escapeHtml(attachmentName)}">
          <i data-lucide="download" class="w-3 h-3"></i>
          <span>Get</span>
        </button>
      </div>
    `;
  }

  const isViewerRoot = user?.isRootAdmin || user?.username === 'admin';
  const isViewerAdmin = user?.role === 'admin';
  const isPublicOrGroup = chatState.currentChatType !== 'dm';
  const canEdit = isMe;
  const canDelete = isMe || (isPublicOrGroup && isViewerAdmin && (isViewerRoot || !isRoot));

  let actionsHtml = '';
  if (canEdit || canDelete) {
    actionsHtml = `
      <div class="flex items-center gap-2.5 mt-1 opacity-80 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 text-[10px] transition">
        ${canEdit ? `
          <button type="button" class="edit-msg-btn text-slate-400 hover:text-indigo-600 flex items-center gap-0.5 font-medium"
            data-msg-id="${escapeHtml(msg.id)}" data-content="${escapeHtml(msg.content)}" title="Edit message">
            <i data-lucide="edit-3" class="w-3 h-3"></i> Edit
          </button>
        ` : ''}
        ${canDelete ? `
          <button type="button" class="delete-msg-btn text-slate-400 hover:text-rose-600 flex items-center gap-0.5 font-medium"
            data-msg-id="${escapeHtml(msg.id)}" title="Delete message">
            <i data-lucide="trash-2" class="w-3 h-3"></i> Delete
          </button>
        ` : ''}
      </div>
    `;
  }

  const academicBadge = [
    className ? `${className}${division ? ' (' + division + ')' : ''}` : '',
    rollNumber ? `#${rollNumber}` : ''
  ].filter(Boolean).join(' • ');

  return `
    <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} group" id="msg-${escapeHtml(msg.id)}">
      <div class="flex items-center gap-1.5 mb-1 px-1 flex-wrap ${isMe ? 'justify-end' : ''}">
        <span class="text-[11px] font-bold ${isAdmin ? 'text-rose-600' : (isMe ? 'text-indigo-700' : 'text-slate-700')}">
          ${escapeHtml(senderName)}${isMe ? ' <span class="text-[10px] font-medium text-indigo-400">(You)</span>' : ''}
        </span>
        ${isAdmin ? `<span class="text-[9px] px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-bold uppercase">${isRoot ? 'Lead Admin' : 'Admin'}</span>` : ''}
        ${academicBadge ? `
          <span class="text-[9px] px-1.5 py-0.5 rounded-md ${isMe ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'} font-medium tabular-nums">
            ${escapeHtml(academicBadge)}
          </span>
        ` : ''}
        <span class="text-[10px] text-slate-400 tabular-nums">${formatDateTime(createdAt)}</span>
        ${isEdited ? '<span class="text-[10px] text-slate-400 italic">(edited)</span>' : ''}
      </div>
      <div class="max-w-[86%] sm:max-w-md px-3.5 py-2.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed ${
        isMe
          ? 'bg-indigo-600 text-white rounded-tr-sm shadow-sm shadow-indigo-600/15'
          : 'bg-white border border-slate-200/80 text-slate-800 rounded-tl-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
      }">
        <div>${renderMarkdownSafe(msg.content)}</div>
        ${attachmentHtml}
      </div>
      ${actionsHtml}
    </div>
  `;
}

export async function loadAllStudents(forceRefresh = false) {
  if (!chatState.allStudentsCache.length || forceRefresh) {
    const res = await apiRequest('/students');
    chatState.allStudentsCache = (res.students || []).filter(s => s.id !== chatState.user?.id);
  }
  return chatState.allStudentsCache;
}
