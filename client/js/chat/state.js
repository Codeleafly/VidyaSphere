/**
 * Shared Chat State, DOM Refs, Safe Material You Message Renderer & Directory Cache
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDateTime, formatFileSize, initIcons, isRootUser, renderRoleBadgeHtml } from '/js/ui.js';

export const QUICK_REACTION_EMOJIS = ['👍', '❤️', '💡', '🔥', '✅'];

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
  replyToMessage: null,
  editingMessageId: null,
  lastMessageCreatedAt: null,
  lastRenderedDateKey: null,
  knownMessageIds: new Set(),
  pinnedMessages: [],
  syncIntervalId: null,
  isSyncing: false,
  searchQuery: '',
  ws: null,
  wsPingTimer: null,
  typingUsers: new Map(), // userId -> { name, timer }
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
    replyPreviewBar: document.getElementById('reply-preview-bar'),
    replyPreviewAuthor: document.getElementById('reply-preview-author'),
    replyPreviewText: document.getElementById('reply-preview-text'),
    cancelReplyBtn: document.getElementById('cancel-reply-btn'),
    channelNameEl: document.getElementById('channel-name'),
    chatSubtitleEl: document.getElementById('chat-subtitle'),
    connectionStatus: document.getElementById('connection-status'),
    connectionDot: document.getElementById('connection-dot'),
    onlineCountBadge: document.getElementById('online-count-badge'),
    currentChatIcon: document.getElementById('current-chat-icon'),
    dmPermissionBanner: document.getElementById('dm-permission-banner'),
    dmPermissionText: document.getElementById('dm-permission-text'),
    dmPermissionActions: document.getElementById('dm-permission-actions'),
    groupInfoBtn: document.getElementById('group-info-btn'),
    groupMembersCountBadge: document.getElementById('group-members-count-badge'),
    editMsgModal: document.getElementById('edit-msg-modal'),
    editMsgInput: document.getElementById('edit-msg-input'),
    typingIndicatorBar: document.getElementById('typing-indicator-bar'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
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

export function scrollToBottom(force = true) {
  const { messagesContainer } = getDom();
  if (!messagesContainer) return;
  if (force || (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 140)) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

export function renderMarkdownSafe(md) {
  if (!md) return '';
  let text = escapeHtml(md);
  text = text.replace(/`([^`]+)`/g, '<code class="bg-black/10 px-1.5 py-0.5 rounded-md text-[11px] font-mono">$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text.replace(/\n/g, '<br>');
}

export function getDayLabel(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderReactionsHtml(msg) {
  const reactions = msg.reactions || {};
  const userId = chatState.user?.id;
  const entries = Object.entries(reactions).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
  if (entries.length === 0) return '';
  return `
    <div class="flex items-center flex-wrap gap-1 mt-1.5" data-reactions-for="${escapeHtml(msg.id)}">
      ${entries.map(([emoji, users]) => {
        const reacted = userId && users.includes(userId);
        return `
          <button type="button" class="react-chip-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${
            reacted
              ? 'bg-[var(--md-secondary-container)] border-[var(--md-primary)]/40 text-[var(--md-on-secondary-container)]'
              : 'bg-white border-[var(--md-outline)] text-slate-700 hover:bg-[var(--md-surface-container)]'
          }" data-msg-id="${escapeHtml(msg.id)}" data-emoji="${escapeHtml(emoji)}">
            <span>${escapeHtml(emoji)}</span>
            <span class="tabular-nums text-[10px]">${users.length}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

export function renderMessageHtml(msg) {
  const user = chatState.user;
  const senderId = msg.sender_id || msg.senderId;
  const isMe = !!(senderId && user?.id && String(senderId) === String(user.id));
  const isRoot = (msg.is_root_admin === 1 || msg.isRootAdmin === true || msg.isRootAdmin === 1 || msg.sender_username === 'admin');
  const isAdmin = isRoot || (msg.sender_role === 'admin' || msg.senderRole === 'admin');
  const isTeacher = (msg.sender_role === 'teacher' || msg.senderRole === 'teacher');
  const senderTeacherType = msg.sender_teacher_type || msg.senderTeacherType || null;
  const isPinned = (msg.is_pinned === 1 || msg.isPinned === true);
  const isEdited = (msg.is_edited === 1 || msg.isEdited === 1 || msg.isEdited === true);
  const hasAttachment = (msg.has_attachment === 1 || msg.hasAttachment === 1 || msg.hasAttachment === true);
  const senderName = msg.sender_name || msg.senderName || 'Member';
  const className = (isRoot || isAdmin) ? '' : (msg.class_name || msg.className || '');
  const division = (isRoot || isAdmin) ? '' : (msg.division || '');
  const rollNumber = (isRoot || isAdmin) ? '' : (msg.roll_number || msg.rollNumber || '');
  const createdAt = msg.created_at || msg.createdAt || new Date().toISOString();
  const attachmentName = msg.attachment_name || msg.attachmentName || '';
  const attachmentType = msg.attachment_type || msg.attachmentType || '';
  const attachmentSize = msg.attachment_size || msg.attachmentSize || 0;
  const replyPreview = msg.replyPreview || null;

  let attachmentHtml = '';
  if (hasAttachment && attachmentName) {
    const isPdf = (attachmentType || '').includes('pdf') || attachmentName.toLowerCase().endsWith('.pdf');
    const isImg = (attachmentType || '').includes('image');
    const icon = isPdf ? 'file-text' : (isImg ? 'image' : 'file');

    attachmentHtml = `
      <div class="mt-2 p-2.5 rounded-2xl ${isMe ? 'bg-white/15 text-white border-white/25' : 'bg-[var(--md-surface-container)] text-[var(--md-on-surface)] border-[var(--md-outline)]'} border space-y-2">
        <div class="flex items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 overflow-hidden">
            <div class="w-8 h-8 rounded-xl ${isMe ? 'bg-white/20 text-white' : 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'} flex items-center justify-center shrink-0">
              <i data-lucide="${icon}" class="w-4 h-4"></i>
            </div>
            <div class="overflow-hidden">
              <div class="font-bold text-[11px] truncate max-w-[140px] sm:max-w-[200px]" title="${escapeHtml(attachmentName)}">${escapeHtml(attachmentName)}</div>
              <div class="text-[9px] opacity-80 tabular-nums">${formatFileSize(attachmentSize)} • Lossless</div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${isImg ? `
              <button type="button" class="preview-image-btn px-2 py-1 rounded-full ${isMe ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-white hover:bg-slate-100 text-[var(--md-primary)] border border-[var(--md-outline)]'} font-bold text-[10px] transition"
                data-msg-id="${escapeHtml(msg.id)}">
                Preview
              </button>
            ` : ''}
            <button type="button" class="download-attachment-btn px-2.5 py-1 rounded-full ${
              isMe ? 'bg-white text-[var(--md-primary)] hover:bg-slate-100' : 'bg-[var(--md-primary)] text-[var(--md-on-primary)] hover:brightness-95'
            } font-bold text-[10px] flex items-center gap-1 shrink-0 transition"
              data-msg-id="${escapeHtml(msg.id)}" data-filename="${escapeHtml(attachmentName)}">
              <i data-lucide="download" class="w-3 h-3"></i>
              <span>Get</span>
            </button>
          </div>
        </div>
        <div class="img-preview-slot hidden rounded-xl overflow-hidden"></div>
      </div>
    `;
  }

  const replyHtml = replyPreview ? `
    <button type="button" class="jump-reply-btn w-full text-left mb-1.5 px-2.5 py-1.5 rounded-xl border-l-2 ${
      isMe ? 'bg-white/15 border-white/80 text-white/95' : 'bg-[var(--md-surface-container)] border-[var(--md-primary)] text-[var(--md-on-surface-variant)]'
    } text-[11px] block hover:opacity-90 transition" data-target-id="${escapeHtml(replyPreview.id)}">
      <span class="font-extrabold block text-[10px]">${escapeHtml(replyPreview.senderName || 'Reply')}</span>
      <span class="line-clamp-1 opacity-90">${escapeHtml(replyPreview.content || '')}</span>
    </button>
  ` : '';

  const isViewerRoot = isRootUser(user);
  const isViewerAdmin = user?.role === 'admin';
  const isViewerTeacher = user?.role === 'teacher';
  const teacherAllowedChannels = new Set([
    'academics',
    ...([...(user?.assignedClasses || []), ...(user?.teacherType === 'class' && user?.className ? [user.className] : [])]
      .map(c => `class_${String(c).trim().toLowerCase().replace(/\s+/g, '_')}`))
  ]);
  const canTeacherModHere = isViewerTeacher && chatState.currentChatType === 'channel' && teacherAllowedChannels.has(chatState.currentChannel);
  const isPublicOrGroup = chatState.currentChatType !== 'dm';
  const canEdit = isMe && !String(msg.id).startsWith('temp_');
  const canDelete = !String(msg.id).startsWith('temp_') && (isMe || (isPublicOrGroup && ((isViewerAdmin && (isViewerRoot || !isRoot)) || (canTeacherModHere && !isAdmin))));
  const canPin = !String(msg.id).startsWith('temp_') && (isViewerAdmin || canTeacherModHere || (chatState.currentChatType === 'group' && chatState.currentGroupRole === 'admin'));

  const actionsHtml = !String(msg.id).startsWith('temp_') ? `
    <div class="flex items-center gap-2 mt-1 opacity-85 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 text-[10px] transition flex-wrap">
      <div class="inline-flex items-center gap-0.5 bg-white border border-[var(--md-outline)] rounded-full px-1.5 py-0.5 shadow-2xs">
        ${QUICK_REACTION_EMOJIS.map(em => `
          <button type="button" class="react-chip-btn px-1 hover:scale-125 transition" data-msg-id="${escapeHtml(msg.id)}" data-emoji="${em}" title="React ${em}">${em}</button>
        `).join('')}
      </div>
      <button type="button" class="reply-msg-btn text-slate-500 hover:text-[var(--md-primary)] flex items-center gap-0.5 font-semibold"
        data-msg-id="${escapeHtml(msg.id)}" data-sender="${escapeHtml(senderName)}" data-content="${escapeHtml(msg.content)}" title="Reply">
        <i data-lucide="corner-up-left" class="w-3 h-3"></i> Reply
      </button>
      ${canPin ? `
        <button type="button" class="pin-msg-btn text-slate-500 hover:text-[var(--md-primary)] flex items-center gap-0.5 font-semibold"
          data-msg-id="${escapeHtml(msg.id)}" title="${isPinned ? 'Unpin' : 'Pin message'}">
          <i data-lucide="pin" class="w-3 h-3"></i> ${isPinned ? 'Unpin' : 'Pin'}
        </button>
      ` : ''}
      ${canEdit ? `
        <button type="button" class="edit-msg-btn text-slate-500 hover:text-[var(--md-primary)] flex items-center gap-0.5 font-semibold"
          data-msg-id="${escapeHtml(msg.id)}" data-content="${escapeHtml(msg.content)}" title="Edit message">
          <i data-lucide="edit-3" class="w-3 h-3"></i> Edit
        </button>
      ` : ''}
      ${canDelete ? `
        <button type="button" class="delete-msg-btn text-slate-500 hover:text-rose-600 flex items-center gap-0.5 font-semibold"
          data-msg-id="${escapeHtml(msg.id)}" title="Delete message">
          <i data-lucide="trash-2" class="w-3 h-3"></i> Delete
        </button>
      ` : ''}
    </div>
  ` : `<div class="text-[9px] text-slate-400 mt-0.5 px-1">Sending...</div>`;

  // Never show class/division/roll for Admin!
  const academicBadge = (isAdmin || isTeacher) ? '' : [
    className ? `${className}${division ? ' (' + division + ')' : ''}` : '',
    rollNumber ? `#${rollNumber}` : ''
  ].filter(Boolean).join(' • ');

  return `
    <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} group" id="msg-${escapeHtml(msg.id)}" data-created-at="${escapeHtml(createdAt)}">
      <div class="flex items-center gap-1.5 mb-1 px-1 flex-wrap ${isMe ? 'justify-end' : ''}">
        <span class="text-[11px] font-bold ${isAdmin ? 'text-amber-800' : (isTeacher ? 'text-[var(--md-primary)]' : (isMe ? 'text-[var(--md-primary)]' : 'text-[var(--md-on-surface)]'))}">
          ${escapeHtml(senderName)}${isMe ? ' <span class="text-[10px] font-medium opacity-70">(You)</span>' : ''}
        </span>
        ${renderRoleBadgeHtml(msg.sender_role || msg.senderRole, senderTeacherType, isRoot)}
        ${isPinned ? `<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">Pinned</span>` : ''}
        ${academicBadge ? `
          <span class="text-[9px] px-2 py-0.5 rounded-full bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] font-semibold tabular-nums">
            ${escapeHtml(academicBadge)}
          </span>
        ` : ''}
        <span class="text-[10px] text-slate-400 tabular-nums">${formatDateTime(createdAt)}</span>
        ${isEdited ? '<span class="text-[10px] text-slate-400 italic">(edited)</span>' : ''}
      </div>
      <div class="max-w-[88%] sm:max-w-md px-3.5 py-2.5 rounded-[22px] text-xs sm:text-[13px] leading-relaxed ${
        isMe
          ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)] rounded-tr-md shadow-sm'
          : 'bg-white border border-[var(--md-outline)] text-[var(--md-on-surface)] rounded-tl-md shadow-2xs'
      }">
        ${replyHtml}
        <div>${renderMarkdownSafe(msg.content)}</div>
        ${attachmentHtml}
      </div>
      ${renderReactionsHtml(msg)}
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
